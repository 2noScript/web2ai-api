use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use futures::{SinkExt, StreamExt};
use regex::Regex;
use serde_json::{json, Map, Value};
use tokio::sync::{mpsc, RwLock};
use tokio_stream::wrappers::ReceiverStream;
use wreq::{
    header::{HeaderMap, HeaderValue},
    ws::message::Message as WsMessage,
    Client,
};

use crate::http_client::build_browser_client;
use crate::openai::{ChatCompletionRequest, ChatCompletionResponse, ModelObject};
use crate::providers::{Provider, ProviderCredentials, ProviderError, ProviderStream, StreamEvent};
use crate::session::{extract_text, ImageAttachment};

const METAAI_HOME: &str = "https://www.meta.ai/";
const METAAI_GRAPHQL: &str = "https://www.meta.ai/api/graphql";
const WARMUP_MUTATION_DOC_ID: &str = "e7f802582dbfed8e181b012e010993eb";
const DGW_APP_ID: &str = "1522763855472543";
const DGW_APP_VERSION: &str = "1.0.0";
const DGW_AUTH_TYPE: &str = "15:0";
const DGW_VERSION: &str = "5";
const DGW_UUID: &str = "0";
const DGW_TIER: &str = "prod";
const DGW_APP_ORIGIN: &str = "meta.ai";

pub struct MetaAIProvider {
    client: Client,
    tokens: Arc<RwLock<HashMap<String, String>>>,
}

impl MetaAIProvider {
    pub fn new() -> Result<Self, ProviderError> {
        Ok(Self {
            client: build_browser_client()?,
            tokens: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    fn base_headers(cookie: &str) -> Result<HeaderMap, ProviderError> {
        let mut headers = HeaderMap::new();
        headers.insert(
            "cookie",
            HeaderValue::from_str(cookie)
                .map_err(|e| ProviderError::Other(format!("invalid cookie header: {e}")))?,
        );
        headers.insert("origin", HeaderValue::from_static("https://www.meta.ai"));
        headers.insert("referer", HeaderValue::from_static("https://www.meta.ai/"));
        Ok(headers)
    }

    async fn get_or_extract_token(
        &self,
        profile_key: &str,
        cookie: &str,
    ) -> Result<String, ProviderError> {
        if let Some(tok) = self.tokens.read().await.get(profile_key).cloned() {
            return Ok(tok);
        }

        let headers = Self::base_headers(cookie)?;
        let mut resp = self.client.get(METAAI_HOME).headers(headers.clone()).send().await?;
        let mut html = resp.text().await.unwrap_or_default();

        if html.contains("__rd_verify") {
            if let Some(verify_path) = Regex::new(r#"fetch\(['"](/__rd_verify[^'"]+)['"]"#)
                .ok()
                .and_then(|re| re.captures(&html))
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_string())
            {
                let _ = self
                    .client
                    .post(format!("https://www.meta.ai{verify_path}"))
                    .headers(headers.clone())
                    .send()
                    .await;
                resp = self.client.get(METAAI_HOME).headers(headers).send().await?;
                html = resp.text().await.unwrap_or_default();
            }
        }

        let token = Regex::new(r"(ecto1:[A-Za-z0-9._~+/-]+)")
            .ok()
            .and_then(|re| re.captures(&html))
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_else(|| "anonymous".to_string());

        self.tokens
            .write()
            .await
            .insert(profile_key.to_string(), token.clone());
        Ok(token)
    }

    async fn warmup_conversation(&self, cookie: &str, conversation_id: &str) {
        if let Ok(mut headers) = Self::base_headers(cookie) {
            headers.insert("content-type", HeaderValue::from_static("application/json"));
            let _ = self
                .client
                .post(METAAI_GRAPHQL)
                .headers(headers)
                .json(&json!({
                    "doc_id": WARMUP_MUTATION_DOC_ID,
                    "variables": { "conversationId": conversation_id }
                }))
                .send()
                .await;
        }
    }

    fn ws_url(token: &str) -> String {
        let auth_val = if token.starts_with("ecto1:") || token == "anonymous" {
            token.to_string()
        } else {
            format!("ecto1:{token}")
        };
        let req_id = uuid::Uuid::new_v4().to_string();
        let encoded_auth = urlencoding_simple(&auth_val);
        format!(
            "wss://gateway.meta.ai/ws/clippy?x-dgw-appid={DGW_APP_ID}&x-dgw-appversion={DGW_APP_VERSION}&x-dgw-authtype={DGW_AUTH_TYPE}&x-dgw-version={DGW_VERSION}&x-dgw-uuid={DGW_UUID}&x-dgw-tier={DGW_TIER}&Authorization={encoded_auth}&x-dgw-app-origin={DGW_APP_ORIGIN}&x-dgw-app-clippy-request-id={req_id}"
        )
    }
}

fn urlencoding_simple(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn build_estab_stream_frame(conversation_id: &str) -> Result<Vec<u8>, ProviderError> {
    let payload = serde_json::to_vec(&json!({
        "x-dgw-app-x-ecto-conversation-id": conversation_id,
        "x-dgw-app-client-payload-type": "PROTO_INSIDE_JSON"
    }))
    .map_err(|e| ProviderError::Other(e.to_string()))?;

    if payload.len() > 127 {
        return Err(ProviderError::Other(
            "MetaAI estab frame payload exceeds 127 bytes".to_string(),
        ));
    }

    let mut frame = Vec::with_capacity(6 + payload.len());
    frame.extend_from_slice(&[0x0F, 0x00, 0x00, payload.len() as u8, 0x00, 0x00]);
    frame.extend_from_slice(&payload);
    Ok(frame)
}

fn build_data_frame(payload_json: &[u8], seq_num: u8, stream_id: u16) -> Vec<u8> {
    let len = payload_json.len();
    let len_bytes = [
        (len & 0xFF) as u8,
        ((len >> 8) & 0xFF) as u8,
        ((len >> 16) & 0xFF) as u8,
    ];
    let mut frame = Vec::with_capacity(8 + len);
    frame.push(0x0D);
    frame.extend_from_slice(&stream_id.to_be_bytes());
    frame.extend_from_slice(&len_bytes);
    frame.push(seq_num & 0x7F);
    frame.push(0x80);
    frame.extend_from_slice(payload_json);
    frame
}

fn is_media_url(url: &str) -> bool {
    if url.is_empty() {
        return false;
    }
    let static_patterns = ["rsrc.php", "static.xx.fbcdn", "/rsrc/", "/y_/"];
    if static_patterns.iter().any(|p| url.contains(p)) {
        return false;
    }
    ["scontent", "metaaiusercontent", "video"]
        .iter()
        .any(|d| url.contains(d))
}

fn parse_dgw_frame(buf: &[u8]) -> (Option<Value>, String, Vec<String>) {
    let mut payload_slice = buf;
    if buf.len() >= 8 && matches!(buf[0], 0x0D | 0x0E | 0x08) {
        let len = (buf[3] as usize) | ((buf[4] as usize) << 8) | ((buf[5] as usize) << 16);
        let end = (8 + len).min(buf.len());
        payload_slice = &buf[8..end];
    } else if buf.len() >= 6 && buf[0] == 0x0F {
        let len = buf[3] as usize;
        let end = (6 + len).min(buf.len());
        payload_slice = &buf[6..end];
    }

    if let Some(pos) = payload_slice.iter().position(|&b| b == b'{') {
        if let Ok(json_val) = serde_json::from_slice::<Value>(&payload_slice[pos..]) {
            return (Some(json_val), String::new(), Vec::new());
        }
    }

    let text = String::from_utf8_lossy(payload_slice).to_string();
    let mut imgs = Vec::new();
    if let Ok(re) = Regex::new(r#"https?://[^\s"'\\<>]+"#) {
        for m in re.find_iter(&text) {
            if is_media_url(m.as_str()) {
                imgs.push(m.as_str().to_string());
            }
        }
    }
    (None, text, imgs)
}

#[async_trait]
impl Provider for MetaAIProvider {
    fn id(&self) -> &'static str {
        "metaai"
    }

    fn models(&self) -> Vec<ModelObject> {
        vec![
            ModelObject::new("meta-ai", "meta", "Meta AI default assistant model"),
            ModelObject::new(
                "llama-3.3-70b",
                "meta",
                "Llama 3.3 70B powered by Meta AI",
            ),
            ModelObject::new("meta-imagine", "meta", "Meta AI Image Generation model"),
        ]
    }

    async fn invalidate_profile(&self, profile_id: &str) {
        self.tokens.write().await.remove(profile_id);
    }

    async fn chat_completions(
        &self,
        credentials: &ProviderCredentials,
        request: &ChatCompletionRequest,
        session_data: &mut Map<String, Value>,
        attachments: &[ImageAttachment],
    ) -> Result<ChatCompletionResponse, ProviderError> {
        let mut stream = self
            .chat_completions_stream(credentials, request, session_data, attachments)
            .await?;

        let mut content = String::new();
        let mut thought = String::new();

        while let Some(item) = stream.next().await {
            match item? {
                StreamEvent::Content(c) => content.push_str(&c),
                StreamEvent::Reasoning(r) => thought.push_str(&r),
                StreamEvent::SessionMeta(meta) => {
                    for (k, v) in meta {
                        session_data.insert(k, v);
                    }
                }
            }
        }

        if content.is_empty() && !thought.is_empty() {
            content = std::mem::take(&mut thought);
        }

        let reasoning = if thought.is_empty() {
            None
        } else {
            Some(thought)
        };
        Ok(ChatCompletionResponse::simple(
            &request.model,
            content,
            reasoning,
        ))
    }

    async fn chat_completions_stream(
        &self,
        credentials: &ProviderCredentials,
        request: &ChatCompletionRequest,
        session_data: &Map<String, Value>,
        _attachments: &[ImageAttachment],
    ) -> Result<ProviderStream, ProviderError> {
        let cookie = credentials
            .cookie
            .as_deref()
            .map(str::trim)
            .filter(|c| !c.is_empty())
            .ok_or(ProviderError::MissingCredentials("metaai"))?
            .to_string();

        let profile_key = credentials
            .profile_id
            .as_deref()
            .unwrap_or("default")
            .to_string();

        let token = self.get_or_extract_token(&profile_key, &cookie).await?;
        let conv_id = session_data
            .get("metaai_conversation_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        self.warmup_conversation(&cookie, &conv_id).await;

        let mut prompt = request
            .messages
            .last()
            .map(|m| extract_text(m.content.as_ref()))
            .unwrap_or_default();
        if request.model.eq_ignore_ascii_case("meta-imagine")
            && !prompt.trim_start().starts_with("/imagine")
        {
            prompt = format!("/imagine {}", prompt.trim());
        }

        let ws_url = Self::ws_url(&token);
        let headers = Self::base_headers(&cookie)?;
        let ws = self
            .client
            .websocket(&ws_url)
            .headers(headers)
            .send()
            .await?
            .into_websocket()
            .await?;

        let estab = build_estab_stream_frame(&conv_id)?;
        let client_payload = serde_json::to_vec(&json!({
            "message": prompt,
            "conversation_id": conv_id,
            "thinking_mode": false
        }))
        .map_err(|e| ProviderError::Other(e.to_string()))?;
        let data_frame = build_data_frame(&client_payload, 1, 0);

        let (tx, rx) = mpsc::channel::<Result<StreamEvent, ProviderError>>(64);

        tokio::spawn(async move {
            let (mut sink, mut stream) = ws.split();

            let _ = tokio::time::timeout(Duration::from_secs(2), stream.next()).await;
            if let Err(e) = sink.send(WsMessage::binary(estab)).await {
                let _ = tx.send(Err(ProviderError::Http(e))).await;
                return;
            }
            let _ = tokio::time::timeout(Duration::from_secs(2), stream.next()).await;
            if let Err(e) = sink.send(WsMessage::binary(data_frame)).await {
                let _ = tx.send(Err(ProviderError::Http(e))).await;
                return;
            }

            let mut image_urls = Vec::new();
            let mut got_content = false;

            loop {
                match tokio::time::timeout(Duration::from_secs(15), stream.next()).await {
                    Ok(Some(Ok(msg))) => {
                        let bytes = match msg {
                            WsMessage::Binary(b) => b.to_vec(),
                            WsMessage::Text(t) => t.as_bytes().to_vec(),
                            WsMessage::Close(_) => break,
                            _ => continue,
                        };
                        let is_end = !bytes.is_empty() && bytes[0] == 0x0E;
                        let (json_opt, _, imgs) = parse_dgw_frame(&bytes);
                        for u in imgs {
                            if !image_urls.contains(&u) {
                                image_urls.push(u);
                            }
                        }
                        if let Some(pj) = json_opt {
                            if let Some(th) = pj
                                .get("thought")
                                .or_else(|| pj.get("reasoning"))
                                .and_then(|v| v.as_str())
                            {
                                if !th.is_empty() {
                                    let _ = tx
                                        .send(Ok(StreamEvent::Reasoning(th.to_string())))
                                        .await;
                                }
                            }
                            if let Some(txt) = pj
                                .get("text")
                                .or_else(|| pj.get("content"))
                                .or_else(|| pj.get("snippet"))
                                .and_then(|v| v.as_str())
                            {
                                if !txt.is_empty() {
                                    got_content = true;
                                    let _ = tx
                                        .send(Ok(StreamEvent::Content(txt.to_string())))
                                        .await;
                                }
                            }
                            if pj.get("is_final").and_then(|v| v.as_bool()) == Some(true)
                                || pj.get("done").and_then(|v| v.as_bool()) == Some(true)
                            {
                                break;
                            }
                        }
                        if is_end && got_content {
                            break;
                        }
                    }
                    Ok(Some(Err(e))) => {
                        if !got_content {
                            let _ = tx.send(Err(ProviderError::Http(e))).await;
                        }
                        break;
                    }
                    Ok(None) | Err(_) => break,
                }
            }

            if !image_urls.is_empty() {
                let md = image_urls
                    .iter()
                    .map(|u| format!("![Generated Image]({u})"))
                    .collect::<Vec<_>>()
                    .join("\n");
                let _ = tx
                    .send(Ok(StreamEvent::Content(format!("\n\n{md}"))))
                    .await;
            }

            let mut meta = Map::new();
            meta.insert(
                "metaai_conversation_id".to_string(),
                Value::String(conv_id),
            );
            let _ = tx.send(Ok(StreamEvent::SessionMeta(meta))).await;
        });

        Ok(Box::pin(ReceiverStream::new(rx)))
    }
}
