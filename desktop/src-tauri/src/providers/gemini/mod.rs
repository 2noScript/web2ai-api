use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use futures::StreamExt;
use regex::Regex;
use serde_json::{json, Map, Value};
use tokio::sync::{mpsc, RwLock};
use tokio_stream::wrappers::ReceiverStream;
use wreq::{
    header::{HeaderMap, HeaderValue},
    Client,
};

use crate::http_client::build_browser_client;
use crate::openai::{ChatCompletionRequest, ChatCompletionResponse, ModelObject};
use crate::providers::{Provider, ProviderCredentials, ProviderError, ProviderStream, StreamEvent};
use crate::session::{extract_text, ImageAttachment};

const GEMINI_INIT_URL: &str = "https://gemini.google.com/app";
const GEMINI_GENERATE_URL: &str =
    "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
const GEMINI_UPLOAD_URL: &str = "https://content-push.googleapis.com/upload";

#[derive(Clone, Debug)]
struct GeminiSessionState {
    access_token: String,
    build_label: Option<String>,
    session_id: Option<String>,
    cookie: String,
}

pub struct GeminiProvider {
    client: Client,
    sessions: Arc<RwLock<HashMap<String, GeminiSessionState>>>,
}

impl GeminiProvider {
    pub fn new() -> Result<Self, ProviderError> {
        Ok(Self {
            client: build_browser_client()?,
            sessions: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    async fn get_or_init_session(
        &self,
        profile_key: &str,
        cookie: &str,
    ) -> Result<GeminiSessionState, ProviderError> {
        {
            let guard = self.sessions.read().await;
            if let Some(st) = guard.get(profile_key) {
                if st.cookie == cookie {
                    return Ok(st.clone());
                }
            }
        }

        let mut headers = HeaderMap::new();
        headers.insert(
            "cookie",
            HeaderValue::from_str(cookie)
                .map_err(|e| ProviderError::Other(format!("invalid cookie header: {e}")))?,
        );
        headers.insert(
            "referer",
            HeaderValue::from_static("https://gemini.google.com/"),
        );

        let resp = self
            .client
            .get(GEMINI_INIT_URL)
            .headers(headers)
            .send()
            .await?;

        let status = resp.status().as_u16();
        let html = resp.text().await?;
        if status != 200 {
            return Err(ProviderError::Upstream { status, body: html });
        }

        let snlm0e = extract_regex(&html, r#""SNlM0e":"([^"]+)""#).ok_or_else(|| {
            ProviderError::Other(
                "401 unauthorized: Failed to extract SNlM0e token from Gemini. Cookie may be expired."
                    .to_string(),
            )
        })?;
        let cfb2h = extract_regex(&html, r#""cfb2h":"([^"]+)""#);
        let fdrfje = extract_regex(&html, r#""FdrFJe":"([^"]+)""#);

        let st = GeminiSessionState {
            access_token: snlm0e,
            build_label: cfb2h,
            session_id: fdrfje,
            cookie: cookie.to_string(),
        };

        self.sessions
            .write()
            .await
            .insert(profile_key.to_string(), st.clone());
        Ok(st)
    }

    async fn upload_attachments(
        &self,
        cookie: &str,
        attachments: &[ImageAttachment],
    ) -> Result<Vec<Value>, ProviderError> {
        let mut uploaded = Vec::new();
        for att in attachments {
            let mut headers = HeaderMap::new();
            headers.insert("x-tenant-id", HeaderValue::from_static("bard-storage"));
            headers.insert("push-id", HeaderValue::from_static("feeds/mcudyrk2a4khkz"));
            headers.insert(
                "cookie",
                HeaderValue::from_str(cookie)
                    .map_err(|e| ProviderError::Other(format!("invalid cookie: {e}")))?,
            );

            let resp = self
                .client
                .post(GEMINI_UPLOAD_URL)
                .headers(headers)
                .body(att.bytes.clone())
                .send()
                .await?;

            if resp.status().as_u16() == 200 {
                let path = resp.text().await?.trim().to_string();
                if !path.is_empty() {
                    uploaded.push(json!([[path], att.filename]));
                }
            }
        }
        Ok(uploaded)
    }

    fn model_headers(model_name: &str, uuid_val: &str) -> HeaderMap {
        let (model_id, tail) = match model_name.trim().to_lowercase().as_str() {
            "gemini-3-pro" => ("9d8ca3786ebdfbea", 1),
            "gemini-3-flash-thinking" => ("5bf011840784117a", 1),
            "gemini-3-pro-plus" => ("e6fa609c3fa255c0", 4),
            "gemini-3-flash-plus" => ("56fdd199312815e2", 4),
            "gemini-3-flash-thinking-plus" => ("e051ce1aa80aa576", 4),
            "gemini-3-pro-advanced" => ("e6fa609c3fa255c0", 2),
            "gemini-3-flash-advanced" => ("56fdd199312815e2", 2),
            "gemini-3-flash-thinking-advanced" => ("e051ce1aa80aa576", 2),
            _ => ("fbb127bbb056c959", 1), // gemini-3-flash default
        };

        let mut headers = HeaderMap::new();
        headers.insert(
            "content-type",
            HeaderValue::from_static("application/x-www-form-urlencoded;charset=utf-8"),
        );
        headers.insert("origin", HeaderValue::from_static("https://gemini.google.com"));
        headers.insert(
            "referer",
            HeaderValue::from_static("https://gemini.google.com/"),
        );
        headers.insert("x-same-domain", HeaderValue::from_static("1"));
        if let Ok(v) = HeaderValue::from_str(&format!(
            r#"[1,null,null,null,"{model_id}",null,null,0,[4],null,null,{tail}]"#
        )) {
            headers.insert("x-goog-ext-525001261-jspb", v);
        }
        headers.insert("x-goog-ext-73010989-jspb", HeaderValue::from_static("[0]"));
        headers.insert("x-goog-ext-73010990-jspb", HeaderValue::from_static("[0]"));
        if let Ok(v) = HeaderValue::from_str(&format!(r#"["{uuid_val}",1]"#)) {
            headers.insert("x-goog-ext-525005358-jspb", v);
        }
        headers
    }

    fn build_request_form(
        state: &GeminiSessionState,
        prompt: &str,
        file_data: Vec<Value>,
        session_data: &Map<String, Value>,
        uuid_val: &str,
    ) -> String {
        let mut inner_req: Vec<Value> = vec![Value::Null; 69];
        let req_files = if file_data.is_empty() {
            Value::Null
        } else {
            Value::Array(file_data)
        };
        inner_req[0] = json!([prompt, 0, Value::Null, req_files, Value::Null, Value::Null, 0]);
        inner_req[1] = json!(["en"]);
        let metadata = session_data
            .get("gemini_metadata")
            .cloned()
            .unwrap_or_else(|| json!(["", "", "", Value::Null, Value::Null, Value::Null, Value::Null, Value::Null, Value::Null, ""]));
        inner_req[2] = metadata;
        inner_req[6] = json!([1]);
        inner_req[7] = json!(1);
        inner_req[10] = json!(1);
        inner_req[11] = json!(0);
        inner_req[17] = json!([[0]]);
        inner_req[18] = json!(0);
        inner_req[27] = json!(1);
        inner_req[30] = json!([4]);
        inner_req[41] = json!([1]);
        inner_req[53] = json!(0);
        inner_req[59] = Value::String(uuid_val.to_string());
        inner_req[61] = json!([]);
        inner_req[68] = json!(2);

        let inner_json = serde_json::to_string(&inner_req).unwrap_or_default();
        let f_req = serde_json::to_string(&json!([Value::Null, inner_json])).unwrap_or_default();

        format!(
            "at={}&f.req={}",
            form_urlencode(&state.access_token),
            form_urlencode(&f_req)
        )
    }
}

fn form_urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn extract_regex(haystack: &str, pattern: &str) -> Option<String> {
    Regex::new(pattern)
        .ok()?
        .captures(haystack)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
}

#[derive(Default)]
struct GeminiChunkResult {
    text: String,
    thoughts: String,
    metadata: Option<Value>,
    cid: Option<String>,
    rid: Option<String>,
    rcid: Option<String>,
}

fn parse_gemini_wrb_payload(raw_line: &str) -> Option<GeminiChunkResult> {
    let trimmed = raw_line.trim();
    if !trimmed.starts_with('[') {
        return None;
    }
    let outer: Value = serde_json::from_str(trimmed).ok()?;
    let items = outer.as_array()?;

    let mut res = GeminiChunkResult::default();
    for item in items {
        let Some(arr) = item.as_array() else {
            continue;
        };
        if arr.first().and_then(|v| v.as_str()) != Some("wrb.fr") {
            continue;
        }
        let Some(inner_str) = arr.get(2).and_then(|v| v.as_str()) else {
            continue;
        };
        let Ok(body) = serde_json::from_str::<Value>(inner_str) else {
            continue;
        };

        if let Some(meta) = body.get(1).and_then(|v| v.as_array()) {
            let cid = meta.first().and_then(|v| v.as_str()).map(|s| s.to_string());
            let rid = meta.get(1).and_then(|v| v.as_str()).map(|s| s.to_string());
            if cid.is_some() || rid.is_some() {
                res.cid = cid.clone();
                res.rid = rid.clone();
                res.metadata = Some(body.get(1).cloned().unwrap_or(Value::Null));
            }
        }

        if let Some(candidates) = body.get(4).and_then(|v| v.as_array()) {
            if let Some(first_cand) = candidates.first() {
                if let Some(rcid) = first_cand.get(0).and_then(|v| v.as_str()) {
                    res.rcid = Some(rcid.to_string());
                }
                if let Some(t) = first_cand
                    .get(1)
                    .and_then(|v| v.get(0))
                    .and_then(|v| v.as_str())
                {
                    res.text = t.to_string();
                }
                if let Some(th) = first_cand
                    .get(37)
                    .and_then(|v| v.get(0))
                    .and_then(|v| v.get(0))
                    .and_then(|v| v.as_str())
                {
                    res.thoughts = th.to_string();
                }
            }
        }
    }

    if res.text.is_empty() && res.thoughts.is_empty() && res.metadata.is_none() {
        None
    } else {
        Some(res)
    }
}

#[async_trait]
impl Provider for GeminiProvider {
    fn id(&self) -> &'static str {
        "gemini"
    }

    fn models(&self) -> Vec<ModelObject> {
        vec![
            ModelObject::new(
                "gemini-3-flash",
                "gemini",
                "Gemini Flash model via unofficial web API",
            ),
            ModelObject::new(
                "gemini-3-pro",
                "gemini",
                "Gemini Pro model via unofficial web API",
            ),
            ModelObject::new(
                "gemini-3-flash-thinking",
                "gemini",
                "Gemini Flash Thinking model via unofficial web API",
            ),
        ]
    }

    async fn invalidate_profile(&self, profile_id: &str) {
        self.sessions.write().await.remove(profile_id);
    }

    async fn chat_completions(
        &self,
        credentials: &ProviderCredentials,
        request: &ChatCompletionRequest,
        session_data: &mut Map<String, Value>,
        attachments: &[ImageAttachment],
    ) -> Result<ChatCompletionResponse, ProviderError> {
        let cookie = credentials
            .cookie
            .as_deref()
            .map(str::trim)
            .filter(|c| !c.is_empty())
            .ok_or(ProviderError::MissingCredentials("gemini"))?;

        let profile_key = credentials
            .profile_id
            .as_deref()
            .unwrap_or("default");
        let state = self.get_or_init_session(profile_key, cookie).await?;
        let uploaded = self.upload_attachments(cookie, attachments).await?;

        let prompt = request
            .messages
            .last()
            .map(|m| extract_text(m.content.as_ref()))
            .unwrap_or_default();

        let uuid_val = uuid::Uuid::new_v4().to_string().to_uppercase();
        let mut headers = Self::model_headers(&request.model, &uuid_val);
        headers.insert(
            "cookie",
            HeaderValue::from_str(cookie)
                .map_err(|e| ProviderError::Other(format!("invalid cookie: {e}")))?,
        );

        let form = Self::build_request_form(&state, &prompt, uploaded, session_data, &uuid_val);
        let reqid = (chrono::Utc::now().timestamp_millis() % 90000) + 10000;
        let mut url = format!("{GEMINI_GENERATE_URL}?hl=en&_reqid={reqid}&rt=c");
        if let Some(ref bl) = state.build_label {
            url.push_str(&format!("&bl={bl}"));
        }
        if let Some(ref fsid) = state.session_id {
            url.push_str(&format!("&f.sid={fsid}"));
        }

        let resp = self
            .client
            .post(&url)
            .headers(headers)
            .body(form)
            .send()
            .await?;

        let status = resp.status().as_u16();
        let body = resp.text().await?;
        if status != 200 {
            self.invalidate_profile(profile_key).await;
            return Err(ProviderError::Upstream { status, body });
        }

        let mut best_text = String::new();
        let mut best_thoughts = String::new();
        let mut latest_meta: Option<GeminiChunkResult> = None;

        for line in body.lines() {
            if let Some(parsed) = parse_gemini_wrb_payload(line) {
                if !parsed.text.is_empty() {
                    best_text = parsed.text.clone();
                }
                if !parsed.thoughts.is_empty() {
                    best_thoughts = parsed.thoughts.clone();
                }
                if parsed.metadata.is_some() || parsed.rcid.is_some() {
                    latest_meta = Some(parsed);
                }
            }
        }

        if let Some(meta) = latest_meta {
            if let Some(cid) = meta.cid {
                session_data.insert("gemini_cid".to_string(), Value::String(cid));
            }
            if let Some(rid) = meta.rid {
                session_data.insert("gemini_rid".to_string(), Value::String(rid));
            }
            if let Some(rcid) = meta.rcid {
                session_data.insert("gemini_rcid".to_string(), Value::String(rcid));
            }
            if let Some(m) = meta.metadata {
                session_data.insert("gemini_metadata".to_string(), m);
            }
        }

        if best_text.is_empty() && best_thoughts.is_empty() {
            return Err(ProviderError::Other(
                "Gemini returned an empty response".to_string(),
            ));
        }

        let reasoning = if best_thoughts.is_empty() {
            None
        } else {
            Some(best_thoughts)
        };
        Ok(ChatCompletionResponse::simple(
            &request.model,
            best_text,
            reasoning,
        ))
    }

    async fn chat_completions_stream(
        &self,
        credentials: &ProviderCredentials,
        request: &ChatCompletionRequest,
        session_data: &Map<String, Value>,
        attachments: &[ImageAttachment],
    ) -> Result<ProviderStream, ProviderError> {
        let cookie = credentials
            .cookie
            .as_deref()
            .map(str::trim)
            .filter(|c| !c.is_empty())
            .ok_or(ProviderError::MissingCredentials("gemini"))?
            .to_string();

        let profile_key = credentials
            .profile_id
            .as_deref()
            .unwrap_or("default")
            .to_string();
        let state = self.get_or_init_session(&profile_key, &cookie).await?;
        let uploaded = self.upload_attachments(&cookie, attachments).await?;

        let prompt = request
            .messages
            .last()
            .map(|m| extract_text(m.content.as_ref()))
            .unwrap_or_default();

        let uuid_val = uuid::Uuid::new_v4().to_string().to_uppercase();
        let mut headers = Self::model_headers(&request.model, &uuid_val);
        headers.insert(
            "cookie",
            HeaderValue::from_str(&cookie)
                .map_err(|e| ProviderError::Other(format!("invalid cookie: {e}")))?,
        );

        let form = Self::build_request_form(&state, &prompt, uploaded, session_data, &uuid_val);
        let reqid = (chrono::Utc::now().timestamp_millis() % 90000) + 10000;
        let mut url = format!("{GEMINI_GENERATE_URL}?hl=en&_reqid={reqid}&rt=c");
        if let Some(ref bl) = state.build_label {
            url.push_str(&format!("&bl={bl}"));
        }
        if let Some(ref fsid) = state.session_id {
            url.push_str(&format!("&f.sid={fsid}"));
        }

        let resp = self
            .client
            .post(&url)
            .headers(headers)
            .body(form)
            .send()
            .await?;

        let status = resp.status().as_u16();
        if status != 200 {
            let body = resp.text().await.unwrap_or_default();
            self.invalidate_profile(&profile_key).await;
            return Err(ProviderError::Upstream { status, body });
        }

        let (tx, rx) = mpsc::channel::<Result<StreamEvent, ProviderError>>(64);
        let mut byte_stream = resp.bytes_stream();

        tokio::spawn(async move {
            let mut buf = String::new();
            let mut last_text = String::new();
            let mut last_thought = String::new();
            let mut meta_map = Map::new();

            while let Some(chunk_res) = byte_stream.next().await {
                match chunk_res {
                    Ok(bytes) => {
                        buf.push_str(&String::from_utf8_lossy(&bytes));
                        while let Some(pos) = buf.find('\n') {
                            let line = buf[..pos].to_string();
                            buf.drain(..=pos);
                            if let Some(parsed) = parse_gemini_wrb_payload(&line) {
                                if !parsed.thoughts.is_empty() && parsed.thoughts.len() > last_thought.len() {
                                    let delta = parsed.thoughts[last_thought.len()..].to_string();
                                    last_thought = parsed.thoughts;
                                    let _ = tx.send(Ok(StreamEvent::Reasoning(delta))).await;
                                }
                                if !parsed.text.is_empty() && parsed.text.len() > last_text.len() {
                                    let delta = parsed.text[last_text.len()..].to_string();
                                    last_text = parsed.text;
                                    let _ = tx.send(Ok(StreamEvent::Content(delta))).await;
                                }
                                if let Some(cid) = parsed.cid {
                                    meta_map.insert("gemini_cid".to_string(), Value::String(cid));
                                }
                                if let Some(rid) = parsed.rid {
                                    meta_map.insert("gemini_rid".to_string(), Value::String(rid));
                                }
                                if let Some(rcid) = parsed.rcid {
                                    meta_map.insert("gemini_rcid".to_string(), Value::String(rcid));
                                }
                                if let Some(m) = parsed.metadata {
                                    meta_map.insert("gemini_metadata".to_string(), m);
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

            if !meta_map.is_empty() {
                let _ = tx.send(Ok(StreamEvent::SessionMeta(meta_map))).await;
            }
        });

        Ok(Box::pin(ReceiverStream::new(rx)))
    }
}
