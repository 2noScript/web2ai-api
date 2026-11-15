use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use regex::Regex;
use serde_json::{json, Map, Value};
use tokio::sync::Mutex as AsyncMutex;

use crate::openai::ChatMessage;

const DEDUP_LEN: usize = 80;
const MAX_HISTORY_TURNS: usize = 50;

pub struct VirtualSessionManager {
    session_locks: Mutex<HashMap<String, Arc<AsyncMutex<()>>>>,
}

impl Default for VirtualSessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl VirtualSessionManager {
    pub fn new() -> Self {
        Self {
            session_locks: Mutex::new(HashMap::new()),
        }
    }

    pub fn get_lock(&self, session_id: &str) -> Arc<AsyncMutex<()>> {
        let mut locks = self.session_locks.lock().unwrap_or_else(|e| e.into_inner());
        if locks.len() >= 2000 {
            let unlocked: Vec<String> = locks
                .iter()
                .filter(|(_, l)| l.try_lock().is_ok())
                .take(500)
                .map(|(k, _)| k.clone())
                .collect();
            for k in unlocked {
                locks.remove(&k);
            }
        }
        locks
            .entry(session_id.to_string())
            .or_insert_with(|| Arc::new(AsyncMutex::new(())))
            .clone()
    }

    pub fn resolve_session_id(&self, header_val: Option<&str>) -> String {
        if let Some(raw) = header_val {
            let trimmed = raw.trim();
            if !trimmed.is_empty() && trimmed.len() <= 256 {
                return trimmed.to_string();
            }
        }
        let ts = chrono::Utc::now().timestamp_millis();
        format!("{}{}", uuid::Uuid::new_v4().simple(), ts)
    }
}

pub fn extract_text(content: Option<&Value>) -> String {
    let Some(val) = content else {
        return String::new();
    };
    match val {
        Value::String(s) => s.clone(),
        Value::Array(arr) => arr
            .iter()
            .filter_map(|part| {
                if part.get("type").and_then(|v| v.as_str()) == Some("text") {
                    part.get("text")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join(" "),
        other => other.to_string(),
    }
}

pub fn parse_cookie(cookie_str: &str, name: &str) -> Option<String> {
    let escaped = regex::escape(name);
    let pattern = format!(r"(?:^|;\s*){escaped}=([^;]+)");
    let re = Regex::new(&pattern).ok()?;
    re.captures(cookie_str)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_string())
}

#[derive(Debug, Clone)]
pub struct ImageAttachment {
    pub filename: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

pub async fn extract_images(
    client: &wreq::Client,
    content: Option<&Value>,
) -> Vec<ImageAttachment> {
    let Some(Value::Array(parts)) = content else {
        return Vec::new();
    };

    let mut results = Vec::new();
    for (idx, part) in parts.iter().enumerate() {
        let part_type = part.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let url_opt = if part_type == "image_url" {
            match part.get("image_url") {
                Some(Value::Object(obj)) => obj.get("url").and_then(|v| v.as_str()),
                Some(Value::String(s)) => Some(s.as_str()),
                _ => None,
            }
        } else if part_type == "input_file" || part_type == "file_url" {
            part.get("file_url")
                .or_else(|| part.get("url"))
                .and_then(|v| v.as_str())
        } else {
            None
        };

        let Some(raw_url) = url_opt.map(str::trim).filter(|u| !u.is_empty()) else {
            continue;
        };

        if let Some(rest) = raw_url.strip_prefix("data:") {
            if let Some((meta, b64)) = rest.split_once(";base64,") {
                let mime = if meta.is_empty() {
                    "image/png".to_string()
                } else {
                    meta.to_string()
                };
                let ext = mime
                    .split('/')
                    .nth(1)
                    .unwrap_or("png")
                    .replace("jpeg", "jpg");
                if let Ok(bytes) = BASE64.decode(b64.trim()) {
                    results.push(ImageAttachment {
                        filename: format!("image_{idx}.{ext}"),
                        mime_type: mime,
                        bytes,
                    });
                }
            }
        } else if raw_url.starts_with("http://") || raw_url.starts_with("https://") {
            if let Ok(resp) = client
                .get(raw_url)
                .timeout(std::time::Duration::from_secs(15))
                .send()
                .await
            {
                if resp.status().as_u16() == 200 {
                    let mime = resp
                        .headers()
                        .get("content-type")
                        .and_then(|v| v.to_str().ok())
                        .and_then(|s| s.split(';').next())
                        .map(|s| s.trim().to_lowercase())
                        .unwrap_or_else(|| "image/jpeg".to_string());
                    let ext = mime
                        .split('/')
                        .nth(1)
                        .unwrap_or("jpg")
                        .replace("jpeg", "jpg");
                    if let Ok(bytes) = resp.bytes().await {
                        results.push(ImageAttachment {
                            filename: format!("image_{idx}.{ext}"),
                            mime_type: mime,
                            bytes: bytes.to_vec(),
                        });
                    }
                }
            }
        }
    }

    results
}

fn msg_fingerprint(role: &str, content: &str) -> String {
    let prefix: String = content.chars().take(DEDUP_LEN).collect();
    format!("{role}:{prefix}")
}

pub fn sync_and_get_history(
    messages: &[ChatMessage],
    session_data: &mut Map<String, Value>,
) -> Vec<(String, String)> {
    let mut history: Vec<(String, String)> = session_data
        .get("history")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let r = item.get("role")?.as_str()?.to_string();
                    let c = item.get("content")?.as_str()?.to_string();
                    Some((r, c))
                })
                .collect()
        })
        .unwrap_or_default();

    let mut existing: HashSet<String> = history
        .iter()
        .map(|(r, c)| msg_fingerprint(r, c))
        .collect();

    for msg in messages {
        if msg.role.is_empty() || msg.content.is_none() {
            continue;
        }
        let text = extract_text(msg.content.as_ref());
        let fp = msg_fingerprint(&msg.role, &text);
        if existing.contains(&fp) {
            continue;
        }
        existing.insert(fp);
        history.push((msg.role.clone(), text));
    }

    if history.len() > MAX_HISTORY_TURNS {
        let start = history.len() - MAX_HISTORY_TURNS;
        history = history.split_off(start);
    }

    let json_hist: Vec<Value> = history
        .iter()
        .map(|(r, c)| json!({ "role": r, "content": c }))
        .collect();
    session_data.insert("history".to_string(), Value::Array(json_hist));
    history
}

pub fn append_assistant_message(session_data: &mut Map<String, Value>, content: &str) {
    if content.is_empty() {
        return;
    }
    let mut arr = session_data
        .get("history")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    arr.push(json!({ "role": "assistant", "content": content }));
    session_data.insert("history".to_string(), Value::Array(arr));
}

pub fn format_prompt_with_history(history: &[(String, String)], current_user_prompt: &str) -> String {
    let system_msgs: Vec<&str> = history
        .iter()
        .filter(|(r, _)| r == "system")
        .map(|(_, c)| c.as_str())
        .collect();
    let mut prior: Vec<(&str, &str)> = history
        .iter()
        .filter(|(r, _)| r != "system")
        .map(|(r, c)| (r.as_str(), c.as_str()))
        .collect();

    if let Some((role, content)) = prior.last() {
        if *role == "user" && content.trim() == current_user_prompt.trim() {
            prior.pop();
        }
    }

    let mut sections = Vec::new();
    if !system_msgs.is_empty() {
        sections.push(format!("[System]\n{}", system_msgs.join("\n")));
    }
    if !prior.is_empty() {
        let lines: Vec<String> = prior
            .iter()
            .map(|(r, c)| {
                let label = if *r == "assistant" { "Assistant" } else { "User" };
                format!("{label}: {c}")
            })
            .collect();
        sections.push(format!("[Previous conversation]\n{}", lines.join("\n")));
    }
    if sections.is_empty() {
        return current_user_prompt.to_string();
    }
    sections.push(format!("[Current message]\n{current_user_prompt}"));
    sections.join("\n\n")
}
