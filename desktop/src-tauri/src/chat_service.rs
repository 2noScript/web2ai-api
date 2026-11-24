use std::sync::Arc;

use futures::StreamExt;
use serde_json::{json, Map, Value};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use crate::db::Database;
use crate::http_client::build_browser_client;
use crate::load_balancer::{LoadBalancerError, ProfileLoadBalancer};
use crate::openai::{ChatCompletionRequest, ChatCompletionResponse, ResponseFormat};
use crate::providers::{ProviderCredentials, ProviderError, ProviderRegistry, StreamEvent};
use crate::session::{
    append_assistant_message, extract_images, extract_text, format_prompt_with_history,
    sync_and_get_history,
};
use crate::structured_output::{
    build_json_prompt, build_json_retry_prompt, repair_and_validate_json,
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
    let response_format = request.parse_response_format().map_err(|msg| {
        ChatServiceError::new(
            400,
            msg,
            "invalid_request_error",
            "invalid_response_format",
        )
    })?;
    let json_format = response_format.as_ref().filter(|f| f.is_json_mode());

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
    let mut attempted_profiles: Vec<String> = Vec::with_capacity(max_profile_attempts);

    for _p_attempt in 0..max_profile_attempts {
        let (profile, _) = match load_balancer.select_profile_excluding(
            &db,
            provider_id,
            Some(session_data),
            &attempted_profiles,
        ) {
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
            let base_prompt = if has_sess {
                raw_prompt.clone()
            } else {
                format_prompt_with_history(&history, &raw_prompt)
            };
            let effective_prompt = match json_format {
                Some(fmt) => build_json_prompt(&base_prompt, fmt),
                None => base_prompt,
            };

            let mut eff_req = request.clone();
            if let Some(last) = eff_req.messages.last_mut() {
                last.content = Some(Value::String(effective_prompt));
            }

            match provider
                .chat_completions(&creds, &eff_req, session_data, &attachments)
                .await
            {
                Ok(mut resp) => {
                    if let Some(fmt) = json_format {
                        let raw_content = resp
                            .choices
                            .first()
                            .map(|c| c.message.content.clone())
                            .unwrap_or_default();
                        match repair_and_validate_json(&raw_content, fmt) {
                            Ok(clean_json) => {
                                if let Some(first) = resp.choices.first_mut() {
                                    first.message.content = clean_json;
                                }
                            }
                            Err(first_err) => {
                                let retry_prompt =
                                    build_json_retry_prompt(fmt, &raw_content, &first_err.message);
                                let mut retry_req = request.clone();
                                if let Some(last) = retry_req.messages.last_mut() {
                                    last.content = Some(Value::String(retry_prompt));
                                }
                                let mut retry_resp = provider
                                    .chat_completions(&creds, &retry_req, session_data, &attachments)
                                    .await
                                    .map_err(|e| {
                                        ChatServiceError::new(
                                            502,
                                            format!(
                                                "JSON validation failed ({}) and retry errored: {e}",
                                                first_err.message
                                            ),
                                            "server_error",
                                            first_err.code,
                                        )
                                    })?;
                                let retry_raw = retry_resp
                                    .choices
                                    .first()
                                    .map(|c| c.message.content.clone())
                                    .unwrap_or_default();
                                let clean_retry = repair_and_validate_json(&retry_raw, fmt)
                                    .map_err(|retry_err| {
                                        ChatServiceError::new(
                                            502,
                                            retry_err.message,
                                            "server_error",
                                            retry_err.code,
                                        )
                                    })?;
                                if let Some(first) = retry_resp.choices.first_mut() {
                                    first.message.content = clean_retry;
                                }
                                resp = retry_resp;
                            }
                        }
                    }

                    if let Some(choice) = resp.choices.first() {
                        append_assistant_message(session_data, &choice.message.content);
                    }
                    return Ok(resp);
                }
                Err(err) => {
                    let err_str = err.to_string();
                    let policy = provider.error_policy();
                    if ProfileLoadBalancer::is_retryable_error_for(policy, &err_str) {
                        let is_auth = ProfileLoadBalancer::is_auth_failure_for(policy, &err_str);
                        load_balancer.handle_profile_failure(
                            &db,
                            &profile.id,
                            Some(session_data),
                            is_auth,
                        );
                        attempted_profiles.push(profile.id.clone());
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
    let response_format: Option<ResponseFormat> =
        request.parse_response_format().map_err(|msg| {
            ChatServiceError::new(
                400,
                msg,
                "invalid_request_error",
                "invalid_response_format",
            )
        })?;
    let json_format = response_format.clone().filter(|f| f.is_json_mode());

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

    let max_profile_attempts = active_profiles.len().max(1);
    let mut attempted_profiles: Vec<String> = Vec::with_capacity(max_profile_attempts);
    let mut selected_profile = None;
    let mut provider_stream_opt = None;
    let mut last_stream_err: Option<ChatServiceError> = None;

    for _p_attempt in 0..max_profile_attempts {
        let (profile, _) = load_balancer
            .select_profile_excluding(
                &db,
                &provider_id,
                Some(&mut session_data),
                &attempted_profiles,
            )
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
        let base_prompt = if has_sess {
            raw_prompt.clone()
        } else {
            format_prompt_with_history(&history, &raw_prompt)
        };
        let effective_prompt = match json_format.as_ref() {
            Some(fmt) => build_json_prompt(&base_prompt, fmt),
            None => base_prompt,
        };

        let mut eff_req = request.clone();
        if let Some(last) = eff_req.messages.last_mut() {
            last.content = Some(Value::String(effective_prompt));
        }

        match provider
            .chat_completions_stream(&creds, &eff_req, &session_data, &attachments)
            .await
        {
            Ok(stream) => {
                selected_profile = Some(profile);
                provider_stream_opt = Some(stream);
                break;
            }
            Err(e) => {
                let err_str = e.to_string();
                let policy = provider.error_policy();
                if ProfileLoadBalancer::is_retryable_error_for(policy, &err_str) {
                    let is_auth = ProfileLoadBalancer::is_auth_failure_for(policy, &err_str);
                    load_balancer.handle_profile_failure(
                        &db,
                        &profile.id,
                        Some(&mut session_data),
                        is_auth,
                    );
                    attempted_profiles.push(profile.id.clone());
                    provider.invalidate_profile(&profile.id).await;
                    last_stream_err = Some(ChatServiceError::new(
                        502,
                        err_str,
                        "server_error",
                        "upstream_error",
                    ));
                    continue;
                }
                return Err(ChatServiceError::new(
                    502,
                    err_str,
                    "server_error",
                    "upstream_error",
                ));
            }
        }
    }

    let profile = selected_profile.ok_or_else(|| {
        last_stream_err.unwrap_or_else(|| {
            ChatServiceError::new(
                503,
                "All profiles failed for streaming request",
                "server_error",
                "all_profiles_failed",
            )
        })
    })?;
    let mut provider_stream = provider_stream_opt.ok_or_else(|| {
        ChatServiceError::new(
            500,
            "Missing provider stream",
            "server_error",
            "stream_init_error",
        )
    })?;
    let _ = &profile;

    let (tx, rx) = mpsc::channel::<String>(64);
    let model_name = request.model.clone();
    let creds_for_retry = ProviderCredentials {
        profile_id: Some(profile.id.clone()),
        token: profile.token.clone(),
        cookie: profile.cookie.clone(),
    };
    let request_for_retry = request.clone();
    let attachments_for_retry = attachments.clone();
    let provider_for_retry = provider.clone();

    tokio::spawn(async move {
        let resp_id = format!("chatcmpl-{}", uuid::Uuid::new_v4().simple());
        let mut is_first = true;
        let mut accumulated = String::new();
        let mut stream_failed = false;
        let buffer_for_json = json_format.is_some();

        while let Some(item) = provider_stream.next().await {
            match item {
                Ok(StreamEvent::Content(delta)) => {
                    accumulated.push_str(&delta);
                    if !buffer_for_json {
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
                            return;
                        }
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
                        return;
                    }
                }
                Ok(StreamEvent::SessionMeta(meta)) => {
                    for (k, v) in meta {
                        session_data.insert(k, v);
                    }
                }
                Err(e) => {
                    stream_failed = true;
                    let _ = tx
                        .send(make_error_chunk(&e.to_string(), "server_error", "stream_error"))
                        .await;
                    break;
                }
            }
        }

        if stream_failed {
            let _ = tx.send(STREAM_END.to_string()).await;
            return;
        }

        if let Some(ref fmt) = json_format {
            let clean_result = match repair_and_validate_json(&accumulated, fmt) {
                Ok(clean) => Ok(clean),
                Err(first_err) => {
                    let retry_prompt =
                        build_json_retry_prompt(fmt, &accumulated, &first_err.message);
                    let mut retry_req = request_for_retry.clone();
                    retry_req.stream = false;
                    if let Some(last) = retry_req.messages.last_mut() {
                        last.content = Some(Value::String(retry_prompt));
                    }
                    match provider_for_retry
                        .chat_completions(
                            &creds_for_retry,
                            &retry_req,
                            &mut session_data,
                            &attachments_for_retry,
                        )
                        .await
                    {
                        Ok(retry_resp) => {
                            let retry_raw = retry_resp
                                .choices
                                .first()
                                .map(|c| c.message.content.clone())
                                .unwrap_or_default();
                            repair_and_validate_json(&retry_raw, fmt).map_err(|e| (e.code, e.message))
                        }
                        Err(e) => Err((
                            first_err.code,
                            format!(
                                "JSON validation failed ({}) and retry errored: {e}",
                                first_err.message
                            ),
                        )),
                    }
                }
            };

            match clean_result {
                Ok(clean_json) => {
                    accumulated = clean_json.clone();
                    let sse = make_stream_chunk(
                        &model_name,
                        Some(&clean_json),
                        None,
                        &resp_id,
                        is_first,
                        false,
                    );
                    if tx.send(sse).await.is_err() {
                        return;
                    }
                }
                Err((err_code, err_msg)) => {
                    let _ = tx
                        .send(make_error_chunk(&err_msg, "server_error", err_code))
                        .await;
                    let _ = tx.send(STREAM_END.to_string()).await;
                    return;
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
