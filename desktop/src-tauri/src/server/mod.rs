use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        Html, IntoResponse, Response,
    },
    routing::{delete, get, post},
    Json, Router,
};
use futures::StreamExt;
use serde::Deserialize;
use serde_json::json;
use tokio::sync::watch;
use tower_http::cors::CorsLayer;

use crate::chat_service::{execute_chat, execute_stream};
use crate::db::{CreateProfileInput, Database, UpdateProfileInput};
use crate::load_balancer::ProfileLoadBalancer;
use crate::openai::ChatCompletionRequest;
use crate::providers::ProviderRegistry;
use crate::session::VirtualSessionManager;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub registry: Arc<ProviderRegistry>,
    pub load_balancer: Arc<ProfileLoadBalancer>,
    pub session_manager: Arc<VirtualSessionManager>,
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/", get(docs_handler))
        .route("/docs", get(docs_handler))
        .route("/health", get(health_handler))
        .route("/v1/profiles", get(list_profiles_handler).post(create_profile_handler))
        .route(
            "/v1/profiles/{id}",
            get(get_profile_handler)
                .put(update_profile_handler)
                .delete(delete_profile_handler),
        )
        .route("/v1/keys", get(list_keys_handler).post(create_key_handler))
        .route("/v1/keys/revoke", post(revoke_key_handler))
        .route("/v1/keys/{key}", delete(delete_key_handler))
        .route("/v1/models", get(list_all_models_handler))
        .route("/v1/chat/completions", post(unified_chat_completions_handler))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

pub async fn run_http_server(
    addr: SocketAddr,
    state: AppState,
    mut shutdown_rx: watch::Receiver<bool>,
) -> Result<(), std::io::Error> {
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let app = build_router(state);
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            while !*shutdown_rx.borrow() {
                if shutdown_rx.changed().await.is_err() {
                    break;
                }
            }
        })
        .await
}

async fn docs_handler() -> Html<&'static str> {
    Html(
        r#"<!doctype html>
<html>
<head><meta charset="utf-8"><title>Web2AI API</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px;">
  <h1>Web2AI API Gateway</h1>
  <p>OpenAI-compatible base URL: <code>http://127.0.0.1:8088/v1</code></p>
  <ul>
    <li><code>GET /health</code></li>
    <li><code>GET /v1/models</code> (returns <code>provider:model</code> IDs)</li>
    <li><code>POST /v1/chat/completions</code> (<code>model: "deepseek:deepseek-chat"</code>, <code>"gemini:gemini-3-flash"</code>, <code>"metaai:..."</code>)</li>
    <li><code>GET / POST /v1/profiles</code> &middot; <code>PUT / DELETE /v1/profiles/{id}</code></li>
    <li><code>GET / POST /v1/keys</code> &middot; <code>POST /v1/keys/revoke</code> &middot; <code>DELETE /v1/keys/{key}</code></li>
  </ul>
</body>
</html>"#,
    )
}

async fn health_handler(State(state): State<AppState>) -> impl IntoResponse {
    let ds = state
        .load_balancer
        .get_active_profiles(&state.db, "deepseek")
        .map(|v| v.len())
        .unwrap_or(0);
    let gm = state
        .load_balancer
        .get_active_profiles(&state.db, "gemini")
        .map(|v| v.len())
        .unwrap_or(0);
    let ma = state
        .load_balancer
        .get_active_profiles(&state.db, "metaai")
        .map(|v| v.len())
        .unwrap_or(0);

    Json(json!({
        "status": "ok",
        "backend": "rust",
        "deepseek_active_profiles": ds,
        "gemini_active_profiles": gm,
        "metaai_active_profiles": ma,
    }))
}

#[derive(Deserialize)]
struct ProfileQuery {
    #[serde(rename = "type")]
    provider_type: Option<String>,
}

async fn list_profiles_handler(
    State(state): State<AppState>,
    Query(query): Query<ProfileQuery>,
) -> Response {
    let res = match query.provider_type.as_deref() {
        Some(t) => state.db.list_profiles_by_type(t),
        None => state.db.list_profiles(),
    };
    match res {
        Ok(profiles) => Json(json!({ "profiles": profiles })).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "detail": e.to_string() })),
        )
            .into_response(),
    }
}

async fn create_profile_handler(
    State(state): State<AppState>,
    Json(input): Json<CreateProfileInput>,
) -> Response {
    if input.provider_type == "deepseek"
        && input
            .token
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .is_none()
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "detail": "Field 'token' is required for DeepSeek profile." })),
        )
            .into_response();
    }
    if matches!(input.provider_type.as_str(), "gemini" | "metaai")
        && input
            .cookie
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .is_none()
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "detail": format!("Field 'cookie' is required for {} profile.", input.provider_type) })),
        )
            .into_response();
    }

    match state.db.create_profile(input) {
        Ok(p) => (StatusCode::CREATED, Json(p)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "detail": e.to_string() })),
        )
            .into_response(),
    }
}

async fn get_profile_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    match state.db.get_profile(&id) {
        Ok(Some(p)) => Json(p).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "detail": "Profile not found" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "detail": e.to_string() })),
        )
            .into_response(),
    }
}

async fn update_profile_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<UpdateProfileInput>,
) -> Response {
    match state.db.update_profile(&id, input) {
        Ok(p) => Json(p).into_response(),
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "detail": e.to_string() })),
        )
            .into_response(),
    }
}

async fn delete_profile_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    match state.db.delete_profile(&id) {
        Ok(0) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "detail": "Profile not found" })),
        )
            .into_response(),
        Ok(_) => Json(json!({ "status": "deleted", "id": id })).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "detail": e.to_string() })),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct KeyCreateBody {
    #[serde(default)]
    name: String,
}

#[derive(Deserialize)]
struct KeyRevokeBody {
    api_key: String,
}

async fn list_keys_handler(State(state): State<AppState>) -> Response {
    match state.db.list_api_keys() {
        Ok(keys) => Json(json!({ "keys": keys })).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "detail": e.to_string() })),
        )
            .into_response(),
    }
}

async fn create_key_handler(
    State(state): State<AppState>,
    Json(body): Json<KeyCreateBody>,
) -> Response {
    match state.db.create_api_key(&body.name) {
        Ok(k) => (StatusCode::CREATED, Json(k)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "detail": e.to_string() })),
        )
            .into_response(),
    }
}

async fn revoke_key_handler(
    State(state): State<AppState>,
    Json(body): Json<KeyRevokeBody>,
) -> Response {
    match state.db.revoke_api_key(&body.api_key) {
        Ok(true) => Json(json!({ "status": "revoked", "api_key": body.api_key })).into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "detail": "API key not found or already inactive" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "detail": e.to_string() })),
        )
            .into_response(),
    }
}

async fn delete_key_handler(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Response {
    match state.db.delete_api_key(&key) {
        Ok(_) => Json(json!({ "status": "deleted", "key": key })).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "detail": e.to_string() })),
        )
            .into_response(),
    }
}

async fn list_all_models_handler(State(state): State<AppState>) -> Response {
    Json(state.registry.list_unified_models()).into_response()
}

fn is_auth_disabled() -> bool {
    if cfg!(debug_assertions) {
        return true;
    }
    let disable_auth = std::env::var("DISABLE_AUTH")
        .unwrap_or_default()
        .to_lowercase();
    if matches!(disable_auth.as_str(), "true" | "1" | "yes") {
        return true;
    }
    let require_key = std::env::var("REQUIRE_API_KEY")
        .unwrap_or_default()
        .to_lowercase();
    if matches!(require_key.as_str(), "false" | "0") {
        return true;
    }
    // Default to true in local desktop mode unless explicitly enabled
    std::env::var("DISABLE_AUTH").is_err() && std::env::var("REQUIRE_API_KEY").is_err()
}

fn extract_api_key(headers: &HeaderMap) -> Option<String> {
    if let Some(auth) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        if let Some(token) = auth.strip_prefix("Bearer ") {
            let trimmed = token.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

async fn unified_chat_completions_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut request): Json<ChatCompletionRequest>,
) -> Response {
    let (provider, resolved_model) = match state.registry.resolve_model(&request.model) {
        Ok(pair) => pair,
        Err(message) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": {
                        "message": message,
                        "type": "invalid_request_error",
                        "code": "invalid_model"
                    }
                })),
            )
                .into_response();
        }
    };
    request.model = resolved_model;
    run_chat_completions(state, provider, headers, request).await
}

async fn run_chat_completions(
    state: AppState,
    provider: String,
    headers: HeaderMap,
    request: ChatCompletionRequest,
) -> Response {
    let disable_auth = is_auth_disabled();
    let api_key = extract_api_key(&headers);

    let effective_key = if disable_auth {
        api_key.unwrap_or_else(|| "dev-key".to_string())
    } else {
        let Some(k) = api_key else {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({
                    "error": {
                        "message": "API key required. Set Authorization: Bearer <key> or X-Api-Key header.",
                        "type": "auth_error",
                        "code": "missing_api_key"
                    }
                })),
            )
                .into_response();
        };
        if !state.db.validate_api_key(&k).unwrap_or(false) {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({
                    "error": {
                        "message": "Invalid or deactivated API key.",
                        "type": "auth_error",
                        "code": "invalid_api_key"
                    }
                })),
            )
                .into_response();
        }
        k
    };

    let api_key_hash = Some(Database::get_api_key_hash(&effective_key));
    let header_sid = headers
        .get("x-session-id")
        .and_then(|v| v.to_str().ok());
    let session_id = state.session_manager.resolve_session_id(header_sid);
    let session_lock = state.session_manager.get_lock(&session_id);
    let _guard = session_lock.lock().await;

    let mut session_data = state
        .db
        .get_session_data(&session_id)
        .ok()
        .flatten()
        .unwrap_or_default();

    if request.stream {
        match execute_stream(
            state.db.clone(),
            state.registry.clone(),
            state.load_balancer.clone(),
            provider,
            request,
            session_id.clone(),
            api_key_hash,
            session_data,
        )
        .await
        {
            Ok(rx_stream) => {
                let sse_stream = rx_stream.map(|raw_sse| {
                    let payload = raw_sse
                        .strip_prefix("data: ")
                        .unwrap_or(&raw_sse)
                        .trim_end_matches("\n\n")
                        .to_string();
                    Ok::<Event, Infallible>(Event::default().data(payload))
                });
                let mut resp = Sse::new(sse_stream)
                    .keep_alive(KeepAlive::default())
                    .into_response();
                if let Ok(hv) = HeaderValue::from_str(&session_id) {
                    resp.headers_mut().insert("x-session-id", hv);
                }
                resp
            }
            Err(err) => {
                let status = StatusCode::from_u16(err.status).unwrap_or(StatusCode::BAD_GATEWAY);
                (status, Json(err.to_json())).into_response()
            }
        }
    } else {
        match execute_chat(
            state.db.clone(),
            state.registry.clone(),
            state.load_balancer.clone(),
            &provider,
            &request,
            &mut session_data,
        )
        .await
        {
            Ok(completion) => {
                let _ = state.db.save_session_data(
                    &session_id,
                    &session_data,
                    api_key_hash.as_deref(),
                );
                let mut resp = Json(completion).into_response();
                if let Ok(hv) = HeaderValue::from_str(&session_id) {
                    resp.headers_mut().insert("x-session-id", hv);
                }
                resp
            }
            Err(err) => {
                let status = StatusCode::from_u16(err.status).unwrap_or(StatusCode::BAD_GATEWAY);
                (status, Json(err.to_json())).into_response()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    #[tokio::test]
    async fn health_and_models_routes_work() {
        let tmp = std::env::temp_dir().join(format!(
            "uapi_test_{}.db",
            uuid::Uuid::new_v4().simple()
        ));
        let db = Arc::new(Database::open(&tmp).unwrap());
        let state = AppState {
            db,
            registry: Arc::new(ProviderRegistry::with_defaults().unwrap()),
            load_balancer: Arc::new(ProfileLoadBalancer::new()),
            session_manager: Arc::new(VirtualSessionManager::new()),
        };
        let app = build_router(state);

        let res = app
            .clone()
            .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        let res_unified_models = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/models")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res_unified_models.status(), StatusCode::OK);
        let models_bytes = axum::body::to_bytes(res_unified_models.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let models_text = String::from_utf8_lossy(&models_bytes);
        assert!(models_text.contains("deepseek:deepseek-chat"));
        assert!(models_text.contains("gemini:gemini-3-flash"));

        let res_bad_model = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/chat/completions")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"model":"unknown-model","messages":[{"role":"user","content":"hi"}]}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res_bad_model.status(), StatusCode::BAD_REQUEST);

        let _ = std::fs::remove_file(tmp);
    }

    #[tokio::test]
    #[ignore]
    async fn live_deepseek_chat_and_stream_against_repo_db() {
        let db_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("data")
            .join("unofficial_api.db");
        assert!(db_path.is_file(), "Missing DB at {:?}", db_path);

        let db = Arc::new(Database::open(&db_path).unwrap());
        let state = AppState {
            db,
            registry: Arc::new(ProviderRegistry::with_defaults().unwrap()),
            load_balancer: Arc::new(ProfileLoadBalancer::new()),
            session_manager: Arc::new(VirtualSessionManager::new()),
        };
        let app = build_router(state);

        // 1. Health check
        let health_res = app
            .clone()
            .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(health_res.status(), StatusCode::OK);
        let health_bytes = axum::body::to_bytes(health_res.into_body(), 1024 * 64)
            .await
            .unwrap();
        println!("HEALTH: {}", String::from_utf8_lossy(&health_bytes));

        // 2. Non-streaming DeepSeek chat completion
        let req_body = serde_json::json!({
            "model": "deepseek:deepseek-chat",
            "messages": [{"role": "user", "content": "Reply with exactly: RUST_OK"}],
            "stream": false
        });
        let chat_res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/chat/completions")
                    .header("content-type", "application/json")
                    .body(Body::from(req_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = chat_res.status();
        let session_id = chat_res
            .headers()
            .get("x-session-id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let chat_bytes = axum::body::to_bytes(chat_res.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let chat_text = String::from_utf8_lossy(&chat_bytes);
        println!("NON-STREAM ({status}) [session={session_id}]: {chat_text}");
        assert_eq!(status, StatusCode::OK, "Chat failed: {chat_text}");

        // 3. Streaming DeepSeek chat completion reusing X-Session-Id
        let stream_body = serde_json::json!({
            "model": "deepseek:deepseek-chat",
            "messages": [{"role": "user", "content": "Say hello in 3 words."}],
            "stream": true
        });
        let stream_res = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/chat/completions")
                    .header("content-type", "application/json")
                    .header("x-session-id", &session_id)
                    .body(Body::from(stream_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let s_status = stream_res.status();
        let s_bytes = axum::body::to_bytes(stream_res.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let s_text = String::from_utf8_lossy(&s_bytes);
        println!("STREAM ({s_status}):\n{s_text}");
        assert_eq!(s_status, StatusCode::OK, "Stream failed: {s_text}");
        assert!(s_text.contains("[DONE]"), "Missing [DONE] marker in SSE");
    }
}
