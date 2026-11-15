use std::sync::Arc;

use futures::StreamExt;
use serde_json::{json, Map, Value};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use crate::db::Database;
use crate::http_client::build_browser_client;
use crate::load_balancer::{LoadBalancerError, ProfileLoadBalancer};
use crate::openai::{ChatCompletionRequest, ChatCompletionResponse};
use crate::providers::{ProviderCredentials, ProviderError, ProviderRegistry, StreamEvent};
use crate::session::{
    append_assistant_message, extract_images, extract_text, format_prompt_with_history,
    sync_and_get_history,
};

#[derive(Debug)]
pub struct ChatServiceError {
    pub status: u16,
    pub message: String,
    pub err_type: String,
    pub code: String,
}

impl ChatServiceError {
    pub fn new(status: u16, message: impl Into<String>, err_type: &str, code: &str) -> Self {
        Self {
            status,
            message: message.into(),
            err_type: err_type.to_string(),
            code: code.to_string(),
        }
    }

    pub fn to_json(&self) -> Value {
        json!({
            "error": {
                "message": self.message,
                "type": self.err_type,
                "code": self.code,
            }
        })
    }
}

fn has_provider_session(provider_name: &str, session_data: &Map<String, Value>) -> bool {
    match provider_name {
        "gemini" => {
            let cid = session_data
                .get("gemini_cid")
                .and_then(|v| v.as_str())
                .map(|s| !s.is_empty())
                .unwrap_or(false);
            let meta = session_data
                .get("gemini_metadata")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .and_then(|v| v.as_str())
                .map(|s| !s.is_empty())
                .unwrap_or(false);
            cid || meta
        }
        "deepseek" => {
            let sid = session_data
                .get("deepseek_chat_session_id")
                .and_then(|v| v.as_str())
                .map(|s| !s.is_empty())
                .unwrap_or(false);
            let force_virtual = session_data
                .get("deepseek_force_virtual")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            sid && !force_virtual
        }
        "metaai" => session_data
            .get("metaai_conversation_id")
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false),
        _ => false,
    }
}

fn clear_provider_session(provider_name: &str, session_data: &mut Map<String, Value>) {
    match provider_name {
        "deepseek" => {
            session_data.remove("deepseek_chat_session_id");
            session_data.remove("deepseek_parent_message_id");
        }
        "gemini" => {
            session_data.remove("gemini_cid");
            session_data.remove("gemini_rid");
            session_data.remove("gemini_rcid");
            session_data.remove("gemini_metadata");
        }
        "metaai" => {
            session_data.remove("metaai_conversation_id");
        }
        _ => {}
    }
}

pub fn make_stream_chunk(
    model: &str,
    content: Option<&str>,
    reasoning_content: Option<&str>,
    response_id: &str,
    is_first: bool,
    is_final: bool,
) -> String {
    let mut delta = Map::new();
    if is_first {
        delta.insert("role".to_string(), Value::String("assistant".to_string()));
    }
    if let Some(c) = content {
        if !c.is_empty() {
            delta.insert("content".to_string(), Value::String(c.to_string()));
        }
    }
    if let Some(r) = reasoning_content {
        if !r.is_empty() {
            delta.insert("reasoning_content".to_string(), Value::String(r.to_string()));
        }
    }

    let finish_reason = if is_final {
        Value::String("stop".to_string())
    } else {
        Value::Null
    };

    let chunk = json!({
        "id": response_id,
        "object": "chat.completion.chunk",
        "created": chrono::Utc::now().timestamp(),
        "model": model,
        "choices": [{
            "index": 0,
            "delta": Value::Object(delta),
            "finish_reason": finish_reason,
        }]
    });
    format!("data: {chunk}\n\n")
}

pub fn make_error_chunk(msg: &str, err_type: &str, code: &str) -> String {
    let data = json!({
        "error": {
            "message": msg,
            "type": err_type,
            "code": code,
        }
    });
    format!("data: {data}\n\n")
}

pub const STREAM_END: &str = "data: [DONE]\n\n";

pub async fn execute_chat(
    db: Arc<Database>,
    registry: Arc<ProviderRegistry>,
    load_balancer: Arc<ProfileLoadBalancer>,
    provider_id: &str,
    request: &ChatCompletionRequest,
    session_data: &mut Map<String, Value>,
) -> Result<ChatCompletionResponse, ChatServiceError> {
    let provider = registry.get(provider_id).ok_or_else(|| {
        ChatServiceError::new(
            404,
            format!("Unknown provider '{provider_id}'"),
            "invalid_request_error",
            "unknown_provider",
        )
    })?;

    let active_profiles = load_balancer
        .get_active_profiles(&db, provider_id)
        .map_err(|e| ChatServiceError::new(500, e.to_string(), "server_error", "db_error"))?;
    if active_profiles.is_empty() {
        return Err(ChatServiceError::new(
            503,
            format!("No active profile available for provider '{provider_id}'."),
            "authentication_error",
            "no_active_profile",
        ));
    }
    let max_profile_attempts = active_profiles.len().max(1);

    let last_content = request.messages.last().and_then(|m| m.content.as_ref());
    let raw_prompt = extract_text(last_content);
    let http_client = build_browser_client()
        .map_err(|e| ChatServiceError::new(500, e.to_string(), "server_error", "http_init"))?;
    let attachments = extract_images(&http_client, last_content).await;

    let history = sync_and_get_history(&request.messages, session_data);
    let mut last_err: Option<ChatServiceError> = None;

    for _p_attempt in 0..max_profile_attempts {
        let (profile, _) = match load_balancer.select_profile(&db, provider_id, Some(session_data))
        {
            Ok(res) => res,
            Err(LoadBalancerError::NoActiveProfile(msg)) => {
                return Err(ChatServiceError::new(
                    503,
                    msg,
                    "authentication_error",
                    "no_active_profile",
                ));
            }
            Err(e) => {
                return Err(ChatServiceError::new(
                    500,
                    e.to_string(),
                    "server_error",
                    "load_balancer_error",
                ));
            }
        };

        let _ = db.record_profile_request(&profile.id);

        let creds = ProviderCredentials {
            profile_id: Some(profile.id.clone()),
            token: profile.token.clone(),
            cookie: profile.cookie.clone(),
        };

        let mut should_failover = false;
        for attempt in 0..2 {
            let has_sess = has_provider_session(provider_id, session_data) && attempt == 0;
            let effective_prompt = if has_sess {
                raw_prompt.clone()
            } else {
                format_prompt_with_history(&history, &raw_prompt)
            };

            let mut eff_req = request.clone();
            if let Some(last) = eff_req.messages.last_mut() {
                last.content = Some(Value::String(effective_prompt));
            }

            match provider
                .chat_completions(&creds, &eff_req, session_data, &attachments)
                .await
            {
                Ok(resp) => {
                    if let Some(choice) = resp.choices.first() {
                        append_assistant_message(session_data, &choice.message.content);
                    }
                    return Ok(resp);
                }
                Err(err) => {
                    let err_str = err.to_string();
                    if ProfileLoadBalancer::is_retryable_error(&err_str) {
                        let is_auth = ProfileLoadBalancer::is_auth_failure(&err_str);
                        load_balancer.handle_profile_failure(
                            &db,
                            &profile.id,
                            Some(session_data),
                            is_auth,
                        );
                        provider.invalidate_profile(&profile.id).await;
                        last_err = Some(ChatServiceError::new(
                            502,
                            format!("Provider error ({provider_id}): {err_str}"),
                            "server_error",
                            "upstream_error",
                        ));
                        should_failover = true;
                        break;
                    }

                    if has_sess && attempt == 0 {
                        clear_provider_session(provider_id, session_data);
                        continue;
                    }

                    let status = match err {
                        ProviderError::MissingCredentials(_) => 503,
                        ProviderError::Upstream { status, .. } => status,
                        _ => 502,
                    };
                    return Err(ChatServiceError::new(
                        status,
                        err_str,
                        "server_error",
                        "upstream_error",
                    ));
                }
            }
        }

        if should_failover {
            if let Ok(rem) = load_balancer.get_active_profiles(&db, provider_id) {
                if !rem.is_empty() {
                    continue;
                }
            }
        }
        break;
    }

    Err(last_err.unwrap_or_else(|| {
        ChatServiceError::new(
            503,
            format!("All active profiles failed for '{provider_id}'."),
            "server_error",
            "no_active_profile",
        )
    }))
}

pub async fn execute_stream(
    db: Arc<Database>,
    registry: Arc<ProviderRegistry>,
    load_balancer: Arc<ProfileLoadBalancer>,
    provider_id: String,
    request: ChatCompletionRequest,
    session_id: String,
    api_key_hash: Option<String>,
    mut session_data: Map<String, Value>,
) -> Result<ReceiverStream<String>, ChatServiceError> {
    let provider = registry.get(&provider_id).ok_or_else(|| {
        ChatServiceError::new(
            404,
            format!("Unknown provider '{provider_id}'"),
            "invalid_request_error",
            "unknown_provider",
        )
    })?;

    let active_profiles = load_balancer
        .get_active_profiles(&db, &provider_id)
        .map_err(|e| ChatServiceError::new(500, e.to_string(), "server_error", "db_error"))?;
    if active_profiles.is_empty() {
        return Err(ChatServiceError::new(
            503,
            format!("No active profile available for provider '{provider_id}'."),
            "authentication_error",
            "no_active_profile",
        ));
    }

    let last_content = request.messages.last().and_then(|m| m.content.as_ref());
    let raw_prompt = extract_text(last_content);
    let http_client = build_browser_client()
        .map_err(|e| ChatServiceError::new(500, e.to_string(), "server_error", "http_init"))?;
    let attachments = extract_images(&http_client, last_content).await;
    let history = sync_and_get_history(&request.messages, &mut session_data);

    let (profile, _) = load_balancer
        .select_profile(&db, &provider_id, Some(&mut session_data))
        .map_err(|e| match e {
            LoadBalancerError::NoActiveProfile(m) => {
                ChatServiceError::new(503, m, "authentication_error", "no_active_profile")
            }
            other => ChatServiceError::new(500, other.to_string(), "server_error", "lb_error"),
        })?;

    let _ = db.record_profile_request(&profile.id);

    let creds = ProviderCredentials {
        profile_id: Some(profile.id.clone()),
        token: profile.token.clone(),
        cookie: profile.cookie.clone(),
    };

    let has_sess = has_provider_session(&provider_id, &session_data);
    let effective_prompt = if has_sess {
        raw_prompt
    } else {
        format_prompt_with_history(&history, &raw_prompt)
    };

    let mut eff_req = request.clone();
    if let Some(last) = eff_req.messages.last_mut() {
        last.content = Some(Value::String(effective_prompt));
    }

    let mut provider_stream = provider
        .chat_completions_stream(&creds, &eff_req, &session_data, &attachments)
        .await
        .map_err(|e| {
            let err_str = e.to_string();
            if ProfileLoadBalancer::is_retryable_error(&err_str) {
                let is_auth = ProfileLoadBalancer::is_auth_failure(&err_str);
                load_balancer.handle_profile_failure(
                    &db,
                    &profile.id,
                    Some(&mut session_data),
                    is_auth,
                );
            }
            ChatServiceError::new(502, err_str, "server_error", "upstream_error")
        })?;

    let (tx, rx) = mpsc::channel::<String>(64);
    let model_name = request.model.clone();

    tokio::spawn(async move {
        let resp_id = format!("chatcmpl-{}", uuid::Uuid::new_v4().simple());
        let mut is_first = true;
        let mut accumulated = String::new();

        while let Some(item) = provider_stream.next().await {
            match item {
                Ok(StreamEvent::Content(delta)) => {
                    accumulated.push_str(&delta);
                    let sse = make_stream_chunk(
                        &model_name,
                        Some(&delta),
                        None,
                        &resp_id,
                        is_first,
                        false,
                    );
                    is_first = false;
                    if tx.send(sse).await.is_err() {
                        break;
                    }
                }
                Ok(StreamEvent::Reasoning(delta)) => {
                    let sse = make_stream_chunk(
                        &model_name,
                        None,
                        Some(&delta),
                        &resp_id,
                        is_first,
                        false,
                    );
                    is_first = false;
                    if tx.send(sse).await.is_err() {
                        break;
                    }
                }
                Ok(StreamEvent::SessionMeta(meta)) => {
                    for (k, v) in meta {
                        session_data.insert(k, v);
                    }
                }
                Err(e) => {
                    let _ = tx
                        .send(make_error_chunk(&e.to_string(), "server_error", "stream_error"))
                        .await;
                    break;
                }
            }
        }

        let _ = tx
            .send(make_stream_chunk(&model_name, None, None, &resp_id, false, true))
            .await;
        let _ = tx.send(STREAM_END.to_string()).await;

        append_assistant_message(&mut session_data, &accumulated);
        let _ = db.save_session_data(&session_id, &session_data, api_key_hash.as_deref());
    });

    Ok(ReceiverStream::new(rx))
}
