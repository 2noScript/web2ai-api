use std::sync::OnceLock;
use std::time::Duration;

use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use wreq::{
    header::{HeaderMap, HeaderValue},
    multipart, Client,
};
    
use crate::http_client::build_browser_client;
use crate::openai::{ChatCompletionRequest, ChatCompletionResponse, ChatMessage, ModelObject};
use crate::providers::{Provider, ProviderCredentials, ProviderError, ProviderStream, StreamEvent};
use crate::session::ImageAttachment;

const DEEPSEEK_BASE_URL: &str = "https://chat.deepseek.com";
const DEEPSEEK_POW_WASM: &[u8] = include_bytes!("pow.wasm");
static POW_RUNTIME: OnceLock<Result<(wasmtime::Engine, wasmtime::Module), String>> =
    OnceLock::new();

fn pow_runtime() -> Result<&'static (wasmtime::Engine, wasmtime::Module), ProviderError> {
    let entry = POW_RUNTIME.get_or_init(|| {
        let engine = wasmtime::Engine::default();
        let module = wasmtime::Module::from_binary(&engine, DEEPSEEK_POW_WASM)
            .map_err(|e| format!("wasm module load error: {e}"))?;
        Ok((engine, module))
    });
    entry.as_ref().map_err(|e| ProviderError::Other(e.clone()))
}

pub struct DeepSeekProvider {
    client: Client,
}

#[derive(Debug, Deserialize)]
struct PowChallenge {
    algorithm: String,
    challenge: String,
    salt: String,
    expire_at: Value,
    difficulty: f64,
    signature: String,
    target_path: String,
}

#[derive(Debug, Serialize)]
struct PowAnswerPayload<'a> {
    algorithm: &'a str,
    challenge: &'a str,
    salt: &'a str,
    answer: i64,
    signature: &'a str,
    target_path: &'a str,
}

impl DeepSeekProvider {
    pub fn new() -> Result<Self, ProviderError> {
        Ok(Self {
            client: build_browser_client()?,
        })
    }

    pub fn client(&self) -> &Client {
        &self.client
    }

    fn base_headers(token: &str, referer: Option<&str>) -> Result<HeaderMap, ProviderError> {
        let auth = if token.starts_with("Bearer ") {
            token.to_string()
        } else {
            format!("Bearer {token}")
        };

        let mut headers = HeaderMap::new();
        headers.insert("accept", HeaderValue::from_static("*/*"));
        headers.insert(
            "authorization",
            HeaderValue::from_str(&auth)
                .map_err(|e| ProviderError::Other(format!("invalid token header: {e}")))?,
        );
        headers.insert("content-type", HeaderValue::from_static("application/json"));
        headers.insert("origin", HeaderValue::from_static(DEEPSEEK_BASE_URL));
        let ref_val = referer.unwrap_or("https://chat.deepseek.com/");
        headers.insert(
            "referer",
            HeaderValue::from_str(ref_val)
                .map_err(|e| ProviderError::Other(format!("invalid referer header: {e}")))?,
        );
        headers.insert("x-app-version", HeaderValue::from_static("20241129.1"));
        headers.insert("x-client-platform", HeaderValue::from_static("web"));
        headers.insert("x-client-version", HeaderValue::from_static("2.4.0"));
        headers.insert("x-client-locale", HeaderValue::from_static("en_US"));
        headers.insert(
            "x-client-bundle-id",
            HeaderValue::from_static("com.deepseek.chat"),
        );
        Ok(headers)
    }

    async fn create_chat_session(&self, token: &str) -> Result<String, ProviderError> {
        let url = format!("{DEEPSEEK_BASE_URL}/api/v0/chat_session/create");
        let headers = Self::base_headers(token, None)?;
        let resp = self
            .client
            .post(&url)
            .headers(headers)
            .body("{}")
            .send()
            .await?;

        let status = resp.status().as_u16();
        let body_text = resp.text().await?;
        if status != 200 {
            return Err(ProviderError::Upstream {
                status,
                body: body_text,
            });
        }

        let json: Value = serde_json::from_str(&body_text)
            .map_err(|e| ProviderError::Other(format!("invalid create_chat_session json: {e}")))?;

        if json.get("code").and_then(|v| v.as_i64()) != Some(0) {
            return Err(ProviderError::Other(format!(
                "create_chat_session error: {}",
                json
            )));
        }

        let biz = &json["data"]["biz_data"];
        let chat_id = biz
            .get("id")
            .and_then(|v| v.as_str())
            .or_else(|| {
                biz.get("chat_session")
                    .and_then(|cs| cs.get("id"))
                    .and_then(|v| v.as_str())
            })
            .ok_or_else(|| {
                ProviderError::Other(format!("create_chat_session missing id: {biz}"))
            })?;

        Ok(chat_id.to_string())
    }

    async fn create_pow_challenge(
        &self,
        token: &str,
        chat_session_id: &str,
        target_path: &str,
    ) -> Result<PowChallenge, ProviderError> {
        let url = format!("{DEEPSEEK_BASE_URL}/api/v0/chat/create_pow_challenge");
        let referer = format!("{DEEPSEEK_BASE_URL}/a/chat/s/{chat_session_id}");
        let mut headers = Self::base_headers(token, Some(&referer))?;
        if let Ok(hv) = HeaderValue::from_str(&referer) {
            headers.insert("referrer", hv);
        }

        let resp = self
            .client
            .post(&url)
            .headers(headers)
            .json(&json!({ "target_path": target_path }))
            .send()
            .await?;

        let status = resp.status().as_u16();
        let body_text = resp.text().await?;
        if status != 200 {
            return Err(ProviderError::Upstream {
                status,
                body: body_text,
            });
        }

        let json: Value = serde_json::from_str(&body_text)
            .map_err(|e| ProviderError::Other(format!("invalid pow challenge json: {e}")))?;

        if json.get("code").and_then(|v| v.as_i64()) != Some(0) {
            return Err(ProviderError::Other(format!(
                "create_pow_challenge error: {json}"
            )));
        }

        let challenge_val = json["data"]["biz_data"]["challenge"].clone();
        serde_json::from_value(challenge_val)
            .map_err(|e| ProviderError::Other(format!("invalid challenge payload: {e}")))
    }

    async fn upload_attachments(
        &self,
        token: &str,
        chat_session_id: &str,
        attachments: &[ImageAttachment],
    ) -> Result<Vec<String>, ProviderError> {
        if attachments.is_empty() {
            return Ok(Vec::new());
        }

        let mut file_ids = Vec::with_capacity(attachments.len());
        for att in attachments {
            let challenge = self
                .create_pow_challenge(token, chat_session_id, "/api/v0/file/upload_file")
                .await?;
            let pow_response = Self::solve_pow_challenge_async(challenge).await?;

            let url = format!("{DEEPSEEK_BASE_URL}/api/v0/file/upload_file");
            let referer = format!("{DEEPSEEK_BASE_URL}/a/chat/s/{chat_session_id}");
            let mut headers = Self::base_headers(token, Some(&referer))?;
            headers.remove("content-type");
            headers.insert(
                "x-ds-pow-response",
                HeaderValue::from_str(&pow_response)
                    .map_err(|e| ProviderError::Other(format!("invalid pow header: {e}")))?,
            );
            headers.insert("x-thinking-enabled", HeaderValue::from_static("0"));
            headers.insert("x-model-type", HeaderValue::from_static("vision"));

            let part = multipart::Part::bytes(att.bytes.clone())
                .file_name(att.filename.clone())
                .mime_str(&att.mime_type)
                .map_err(|e| ProviderError::Other(format!("invalid mime: {e}")))?;
            let form = multipart::Form::new().part("file", part);

            let resp = self
                .client
                .post(&url)
                .headers(headers)
                .multipart(form)
                .send()
                .await?;

            let status = resp.status().as_u16();
            let body_text = resp.text().await?;
            if status != 200 {
                return Err(ProviderError::Upstream {
                    status,
                    body: body_text,
                });
            }
            let json: Value = serde_json::from_str(&body_text)
                .map_err(|e| ProviderError::Other(format!("upload_file json error: {e}")))?;
            let file_id = json["data"]["biz_data"]["id"]
                .as_str()
                .ok_or_else(|| ProviderError::Other(format!("upload_file missing id: {json}")))?;
            file_ids.push(file_id.to_string());
        }

        Ok(file_ids)
    }

    async fn solve_pow_challenge_async(challenge: PowChallenge) -> Result<String, ProviderError> {
        tokio::task::spawn_blocking(move || Self::solve_pow_challenge(&challenge))
            .await
            .map_err(|e| ProviderError::Other(format!("pow task join error: {e}")))?
    }

    fn solve_pow_challenge(challenge: &PowChallenge) -> Result<String, ProviderError> {
        use wasmtime::{Instance, Store};

        let (engine, module) = pow_runtime()?;
        let mut store = Store::new(engine, ());
        let instance = Instance::new(&mut store, module, &[])
            .map_err(|e| ProviderError::Other(format!("wasm instantiate error: {e}")))?;

        let memory = instance
            .get_memory(&mut store, "memory")
            .ok_or_else(|| ProviderError::Other("wasm missing `memory` export".to_string()))?;
        let alloc = instance
            .get_typed_func::<(i32, i32), i32>(&mut store, "__wbindgen_export_0")
            .map_err(|e| ProviderError::Other(format!("wasm missing alloc: {e}")))?;
        let add_stack_ptr = instance
            .get_typed_func::<i32, i32>(&mut store, "__wbindgen_add_to_stack_pointer")
            .map_err(|e| ProviderError::Other(format!("wasm missing stack_ptr: {e}")))?;
        let wasm_solve = instance
            .get_typed_func::<(i32, i32, i32, i32, i32, f64), ()>(&mut store, "wasm_solve")
            .map_err(|e| ProviderError::Other(format!("wasm missing wasm_solve: {e}")))?;

        let expire_str = match &challenge.expire_at {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            other => other.to_string(),
        };
        let prefix = format!("{}_{}_", challenge.salt, expire_str);

        let challenge_bytes = challenge.challenge.as_bytes();
        let prefix_bytes = prefix.as_bytes();

        let challenge_ptr = alloc
            .call(&mut store, (challenge_bytes.len() as i32, 1))
            .map_err(|e| ProviderError::Other(format!("wasm alloc challenge failed: {e}")))?;
        let prefix_ptr = alloc
            .call(&mut store, (prefix_bytes.len() as i32, 1))
            .map_err(|e| ProviderError::Other(format!("wasm alloc prefix failed: {e}")))?;

        memory
            .write(&mut store, challenge_ptr as usize, challenge_bytes)
            .map_err(|e| ProviderError::Other(format!("wasm write challenge failed: {e}")))?;
        memory
            .write(&mut store, prefix_ptr as usize, prefix_bytes)
            .map_err(|e| ProviderError::Other(format!("wasm write prefix failed: {e}")))?;

        let stack_ptr = add_stack_ptr
            .call(&mut store, -16)
            .map_err(|e| ProviderError::Other(format!("wasm stack alloc failed: {e}")))?;

        let solve_res = wasm_solve.call(
            &mut store,
            (
                stack_ptr,
                challenge_ptr,
                challenge_bytes.len() as i32,
                prefix_ptr,
                prefix_bytes.len() as i32,
                challenge.difficulty,
            ),
        );

        let mut result_bytes = [0u8; 16];
        let read_res = memory.read(&store, stack_ptr as usize, &mut result_bytes);
        let _ = add_stack_ptr.call(&mut store, 16);

        solve_res.map_err(|e| ProviderError::Other(format!("wasm_solve failed: {e}")))?;
        read_res.map_err(|e| ProviderError::Other(format!("wasm read result failed: {e}")))?;

        let status = i32::from_le_bytes(result_bytes[0..4].try_into().unwrap());
        let answer_f64 = f64::from_le_bytes(result_bytes[8..16].try_into().unwrap());

        if status == 0 {
            return Err(ProviderError::Other(
                "DeepSeek PoW solver failed to find an answer".to_string(),
            ));
        }

        let payload = PowAnswerPayload {
            algorithm: &challenge.algorithm,
            challenge: &challenge.challenge,
            salt: &challenge.salt,
            answer: answer_f64 as i64,
            signature: &challenge.signature,
            target_path: &challenge.target_path,
        };

        let json_str = serde_json::to_string(&payload)
            .map_err(|e| ProviderError::Other(format!("pow payload serialize error: {e}")))?;
        Ok(BASE64.encode(json_str.as_bytes()))
    }
}

fn resolve_model(raw: &str) -> (&'static str, bool) {
    let lower = raw.trim().to_lowercase();
    match lower.as_str() {
        "deepseek-r1" | "deepseek-reasoner" => ("deepseek-reasoner", true),
        "deepseek-v3" | "deepseek-chat" => ("deepseek-chat", false),
        _ if lower.contains("reason") || lower.contains("r1") => ("deepseek-reasoner", true),
        _ => ("deepseek-chat", false),
    }
}

fn extract_message_text(msg: &ChatMessage) -> String {
    match &msg.content {
        None => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(arr)) => arr
            .iter()
            .filter_map(|part| {
                part.get("text")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
            .collect::<Vec<_>>()
            .join("\n"),
        Some(other) => other.to_string(),
    }
}

fn build_prompt(messages: &[ChatMessage]) -> String {
    if messages.len() == 1 {
        return extract_message_text(&messages[0]);
    }
    if let Some(last) = messages.last() {
        return extract_message_text(last);
    }
    String::new()
}

fn is_retryable_error(msg: &str) -> bool {
    let lower = msg.to_lowercase();
    [
        "invalid message id",
        "40300",
        "missing_header",
        "too frequent",
        "session",
        "being generated",
        "please try again later",
    ]
    .iter()
    .any(|kw| lower.contains(kw))
}

#[derive(Default)]
struct SseAccumulator {
    event: String,
    generate_mode: String,
    thinking_enabled: bool,
    content: String,
    thought: String,
    title: Option<String>,
    response_message_id: Option<i64>,
}

impl SseAccumulator {
    fn parse_item(&mut self, item: &Value, delta_content: &mut String, delta_thought: &mut String) {
        match item {
            Value::Null | Value::Bool(_) | Value::Number(_) => {}
            Value::String(s) => {
                if matches!(s.as_str(), "FINISHED" | "FINISH" | "STOP" | "TRUNCATED") {
                    return;
                }
                if self.generate_mode == "THINK" {
                    self.thought.push_str(s);
                    delta_thought.push_str(s);
                    if !self.thinking_enabled {
                        self.content.push_str(s);
                        delta_content.push_str(s);
                    }
                } else if self.generate_mode == "RESPONSE" || self.generate_mode.is_empty() {
                    self.content.push_str(s);
                    delta_content.push_str(s);
                }
            }
            Value::Array(arr) => {
                for sub in arr {
                    self.parse_item(sub, delta_content, delta_thought);
                }
            }
            Value::Object(map) => {
                if let Some(mid) = map.get("message_id").and_then(|v| v.as_i64()) {
                    self.response_message_id = Some(mid);
                }
                if self.generate_mode == "SEARCH" {
                    if let Some(url) = map.get("url").and_then(|v| v.as_str()) {
                        let cite = map
                            .get("cite_index")
                            .map(|v| v.to_string())
                            .unwrap_or_else(|| "?".to_string());
                        let label = map
                            .get("title")
                            .or_else(|| map.get("site_name"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("UNKNOWN");
                        let chunk = format!("{cite}. [{label}]({url})\n");
                        self.content.push_str(&chunk);
                        delta_content.push_str(&chunk);
                        return;
                    }
                }

                if map.len() == 1 {
                    if let Some(v) = map.get("v") {
                        self.parse_item(v, delta_content, delta_thought);
                        return;
                    }
                    if let Some(r) = map.get("response") {
                        self.parse_item(r, delta_content, delta_thought);
                        return;
                    }
                }

                if map.contains_key("message_id") || map.contains_key("parent_id") {
                    if let Some(Value::Array(frags)) = map.get("fragments") {
                        for frag in frags {
                            if let Some(c) = frag.get("content") {
                                self.parse_item(c, delta_content, delta_thought);
                            }
                        }
                    }
                } else if let Some(p) = map.get("p").and_then(|v| v.as_str()) {
                    let tp = p.rsplit('/').next().unwrap_or("");
                    if matches!(tp, "status" | "finish_reason" | "state" | "completion_state") {
                        return;
                    }
                    if matches!(tp, "response" | "content" | "fragment" | "fragments") {
                        if let Some(v) = map.get("v") {
                            self.parse_item(v, delta_content, delta_thought);
                        }
                    } else if tp == "results" && self.generate_mode == "SEARCH" {
                        if let Some(v) = map.get("v") {
                            self.parse_item(v, delta_content, delta_thought);
                        }
                    }
                } else if let Some(t) = map.get("type").and_then(|v| v.as_str()) {
                    if !t.is_empty() {
                        self.generate_mode = t.to_string();
                        if let Some(c) = map.get("content") {
                            self.parse_item(c, delta_content, delta_thought);
                        }
                    }
                }
            }
        }
    }

    fn feed_line(&mut self, raw_line: &str) -> Result<(String, String), String> {
        let mut delta_content = String::new();
        let mut delta_thought = String::new();
        let line = raw_line.trim();
        if line.is_empty() {
            return Ok((delta_content, delta_thought));
        }
        if let Some(ev) = line.strip_prefix("event: ") {
            self.event = ev.trim().to_string();
            return Ok((delta_content, delta_thought));
        }
        if let Some(raw_data) = line.strip_prefix("data: ") {
            let data_str = raw_data.trim();
            if data_str == "[DONE]" {
                return Ok((delta_content, delta_thought));
            }
            let Ok(parsed) = serde_json::from_str::<Value>(data_str) else {
                return Ok((delta_content, delta_thought));
            };

            if parsed.get("code").and_then(|v| v.as_i64()) == Some(40300)
                || parsed.to_string().to_lowercase().contains("missing_header")
            {
                return Err(parsed.to_string());
            }

            if self.event == "ready" {
                if let Some(rid) = parsed.get("response_message_id").and_then(|v| v.as_i64()) {
                    self.response_message_id = Some(rid);
                }
            }

            let is_update = parsed.is_object()
                && (parsed.get("p").is_some()
                    || parsed.get("v").is_some()
                    || parsed.get("response").is_some());

            if self.event == "update_session" || is_update {
                self.parse_item(&parsed, &mut delta_content, &mut delta_thought);
            } else if self.event == "title" {
                if let Some(t) = parsed.get("content").and_then(|v| v.as_str()) {
                    self.title = Some(t.to_string());
                }
            } else if self.event == "toast"
                && parsed.get("type").and_then(|v| v.as_str()) == Some("error")
            {
                let content = parsed
                    .get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown toast error");
                return Err(format!("DeepSeek Error: {content}"));
            }
        }
        Ok((delta_content, delta_thought))
    }

    fn feed_sse_text(&mut self, sse_body: &str) -> Result<(), String> {
        for raw_line in sse_body.lines() {
            let _ = self.feed_line(raw_line)?;
        }
        Ok(())
    }
}

#[async_trait]
impl Provider for DeepSeekProvider {
    fn id(&self) -> &'static str {
        "deepseek"
    }

    fn models(&self) -> Vec<ModelObject> {
        vec![
            ModelObject::new(
                "deepseek-chat",
                "deepseek",
                "DeepSeek V3 chat model via unofficial web API",
            ),
            ModelObject::new(
                "deepseek-reasoner",
                "deepseek",
                "DeepSeek R1 reasoning model via unofficial web API",
            ),
        ]
    }

    async fn chat_completions(
        &self,
        credentials: &ProviderCredentials,
        request: &ChatCompletionRequest,
        session_data: &mut Map<String, Value>,
        attachments: &[ImageAttachment],
    ) -> Result<ChatCompletionResponse, ProviderError> {
        let token = credentials
            .token
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .ok_or(ProviderError::MissingCredentials("deepseek"))?;

        let (resolved_model, thinking_enabled) = resolve_model(&request.model);
        let prompt = build_prompt(&request.messages);

        let existing_sid = session_data
            .get("deepseek_chat_session_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let existing_parent = session_data
            .get("deepseek_parent_message_id")
            .and_then(|v| v.as_i64());

        let mut last_err = String::new();
        for attempt in 0..3 {
            let (chat_session_id, parent_message_id) = if attempt == 0 {
                if let Some(ref sid) = existing_sid {
                    (sid.clone(), existing_parent)
                } else {
                    match self.create_chat_session(token).await {
                        Ok(id) => (id, None),
                        Err(e) => {
                            last_err = e.to_string();
                            if attempt < 2 {
                                tokio::time::sleep(Duration::from_millis(1200)).await;
                                continue;
                            }
                            return Err(e);
                        }
                    }
                }
            } else {
                match self.create_chat_session(token).await {
                    Ok(id) => (id, None),
                    Err(e) => {
                        last_err = e.to_string();
                        continue;
                    }
                }
            };

            let ref_file_ids = self
                .upload_attachments(token, &chat_session_id, attachments)
                .await?;

            let challenge = match self
                .create_pow_challenge(token, &chat_session_id, "/api/v0/chat/completion")
                .await
            {
                Ok(c) => c,
                Err(e) => {
                    last_err = e.to_string();
                    if attempt < 2 {
                        tokio::time::sleep(Duration::from_millis(1200)).await;
                        continue;
                    }
                    return Err(e);
                }
            };

            let pow_response = Self::solve_pow_challenge_async(challenge).await?;

            let url = format!("{DEEPSEEK_BASE_URL}/api/v0/chat/completion");
            let referer = format!("{DEEPSEEK_BASE_URL}/a/chat/s/{chat_session_id}");
            let mut headers = Self::base_headers(token, Some(&referer))?;
            headers.insert("accept", HeaderValue::from_static("text/event-stream"));
            headers.insert(
                "x-ds-pow-response",
                HeaderValue::from_str(&pow_response)
                    .map_err(|e| ProviderError::Other(format!("invalid pow header: {e}")))?,
            );
            if let Ok(hv) = HeaderValue::from_str(&referer) {
                headers.insert("referrer", hv);
            }

            let payload = json!({
                "chat_session_id": chat_session_id,
                "parent_message_id": parent_message_id,
                "model_type": "default",
                "prompt": prompt,
                "ref_file_ids": ref_file_ids,
                "thinking_enabled": thinking_enabled,
                "search_enabled": false,
                "action": Value::Null,
                "preempt": false,
            });

            let resp = self
                .client
                .post(&url)
                .headers(headers)
                .json(&payload)
                .send()
                .await?;

            let status = resp.status().as_u16();
            let content_type = resp
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_string();
            let body_text = resp.text().await?;

            if status != 200 || !content_type.contains("text/event-stream") {
                last_err = format!("HTTP {status}: {body_text}");
                if attempt < 2 && is_retryable_error(&last_err) {
                    tokio::time::sleep(Duration::from_millis(1200)).await;
                    continue;
                }
                return Err(ProviderError::Upstream {
                    status,
                    body: body_text,
                });
            }

            let mut acc = SseAccumulator {
                thinking_enabled,
                ..Default::default()
            };

            if let Err(err_msg) = acc.feed_sse_text(&body_text) {
                last_err = err_msg.clone();
                if attempt < 2 && is_retryable_error(&err_msg) {
                    tokio::time::sleep(Duration::from_millis(1200)).await;
                    continue;
                }
                return Err(ProviderError::Other(err_msg));
            }

            session_data.insert(
                "deepseek_chat_session_id".to_string(),
                Value::String(chat_session_id),
            );
            if let Some(mid) = acc.response_message_id {
                session_data.insert(
                    "deepseek_parent_message_id".to_string(),
                    Value::Number(mid.into()),
                );
            }

            let reasoning = if acc.thought.is_empty() {
                None
            } else {
                Some(acc.thought)
            };
            let mut completion =
                ChatCompletionResponse::simple(resolved_model, acc.content, reasoning);
            completion.title = acc.title;
            return Ok(completion);
        }

        Err(ProviderError::Other(last_err))
    }

    async fn chat_completions_stream(
        &self,
        credentials: &ProviderCredentials,
        request: &ChatCompletionRequest,
        session_data: &Map<String, Value>,
        attachments: &[ImageAttachment],
    ) -> Result<ProviderStream, ProviderError> {
        let token = credentials
            .token
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .ok_or(ProviderError::MissingCredentials("deepseek"))?
            .to_string();

        let (_, thinking_enabled) = resolve_model(&request.model);
        let prompt = build_prompt(&request.messages);

        let existing_sid = session_data
            .get("deepseek_chat_session_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let parent_message_id = session_data
            .get("deepseek_parent_message_id")
            .and_then(|v| v.as_i64());

        let chat_session_id = match existing_sid {
            Some(sid) => sid,
            None => self.create_chat_session(&token).await?,
        };

        let ref_file_ids = self
            .upload_attachments(&token, &chat_session_id, attachments)
            .await?;

        let challenge = self
            .create_pow_challenge(&token, &chat_session_id, "/api/v0/chat/completion")
            .await?;
        let pow_response = Self::solve_pow_challenge_async(challenge).await?;

        let url = format!("{DEEPSEEK_BASE_URL}/api/v0/chat/completion");
        let referer = format!("{DEEPSEEK_BASE_URL}/a/chat/s/{chat_session_id}");
        let mut headers = Self::base_headers(&token, Some(&referer))?;
        headers.insert("accept", HeaderValue::from_static("text/event-stream"));
        headers.insert(
            "x-ds-pow-response",
            HeaderValue::from_str(&pow_response)
                .map_err(|e| ProviderError::Other(format!("invalid pow header: {e}")))?,
        );
        if let Ok(hv) = HeaderValue::from_str(&referer) {
            headers.insert("referrer", hv);
        }

        let payload = json!({
            "chat_session_id": chat_session_id,
            "parent_message_id": parent_message_id,
            "model_type": "default",
            "prompt": prompt,
            "ref_file_ids": ref_file_ids,
            "thinking_enabled": thinking_enabled,
            "search_enabled": false,
            "action": Value::Null,
            "preempt": false,
        });

        let resp = self
            .client
            .post(&url)
            .headers(headers)
            .json(&payload)
            .send()
            .await?;

        let status = resp.status().as_u16();
        let content_type = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        if status != 200 || !content_type.contains("text/event-stream") {
            let body_text = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Upstream {
                status,
                body: body_text,
            });
        }

        let (tx, rx) = mpsc::channel::<Result<StreamEvent, ProviderError>>(64);
        let mut byte_stream = resp.bytes_stream();

        tokio::spawn(async move {
            let mut acc = SseAccumulator {
                thinking_enabled,
                ..Default::default()
            };
            let mut buf = String::new();

            while let Some(chunk_res) = byte_stream.next().await {
                match chunk_res {
                    Ok(bytes) => {
                        let s = String::from_utf8_lossy(&bytes);
                        buf.push_str(&s);
                        while let Some(pos) = buf.find('\n') {
                            let line = buf[..pos].to_string();
                            buf.drain(..=pos);
                            match acc.feed_line(&line) {
                                Ok((dc, dt)) => {
                                    if !dt.is_empty() && thinking_enabled {
                                        let _ = tx.send(Ok(StreamEvent::Reasoning(dt))).await;
                                    }
                                    if !dc.is_empty() {
                                        let _ = tx.send(Ok(StreamEvent::Content(dc))).await;
                                    }
                                }
                                Err(e) => {
                                    let _ = tx.send(Err(ProviderError::Other(e))).await;
                                    return;
                                }
                            }
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(Err(ProviderError::Http(e))).await;
                        return;
                    }
                }
            }

            if !buf.trim().is_empty() {
                if let Ok((dc, dt)) = acc.feed_line(&buf) {
                    if !dt.is_empty() && thinking_enabled {
                        let _ = tx.send(Ok(StreamEvent::Reasoning(dt))).await;
                    }
                    if !dc.is_empty() {
                        let _ = tx.send(Ok(StreamEvent::Content(dc))).await;
                    }
                }
            }

            let mut meta = Map::new();
            meta.insert(
                "deepseek_chat_session_id".to_string(),
                Value::String(chat_session_id),
            );
            if let Some(mid) = acc.response_message_id {
                meta.insert(
                    "deepseek_parent_message_id".to_string(),
                    Value::Number(mid.into()),
                );
            }
            let _ = tx.send(Ok(StreamEvent::SessionMeta(meta))).await;
        });

        Ok(Box::pin(ReceiverStream::new(rx)))
    }
}
