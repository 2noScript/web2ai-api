use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        Html, IntoResponse, Response,
    },
    routing::{delete, get, post, put},
    Json, Router,
};
use futures::StreamExt;
use serde::Deserialize;
use serde_json::json;
use tauri::Emitter;
use tokio::sync::watch;
use tower_http::cors::CorsLayer;

use crate::chat_service::{execute_chat, execute_stream};
use crate::db::{CreateProfileInput, Database, GatewayLogEntry, UpdateProfileInput};
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
    pub app_handle: Option<tauri::AppHandle>,
}

static PET_REACT_TO_TRAFFIC: AtomicBool = AtomicBool::new(true);

pub fn set_pet_react_to_traffic(enabled: bool) {
    PET_REACT_TO_TRAFFIC.store(enabled, Ordering::Relaxed);
}

fn record_gateway_log(state: &AppState, log: GatewayLogEntry) {
    let _ = state.db.insert_gateway_log(&log);
    if let Some(handle) = &state.app_handle {
        let _ = handle.emit("gateway:request", log);
    }
}

fn emit_pet_status(state: &AppState, status: &str, model: &str) {
    if !PET_REACT_TO_TRAFFIC.load(Ordering::Relaxed) {
        return;
    }
    if let Some(handle) = &state.app_handle {
        let _ = handle.emit(
            "pet:status",
            json!({
                "status": status,
                "model": model,
            }),
        );
    }
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/", get(docs_handler))
        .route("/docs", get(docs_handler))
        .route("/openapi.json", get(openapi_handler))
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
        .route("/v1/gateway/logs", get(get_gateway_logs_handler).delete(clear_gateway_logs_handler))
        .route("/v1/settings/cache", get(get_cache_settings_handler).put(set_cache_settings_handler))
        .route("/v1/pet/react-traffic", get(get_pet_react_handler).put(set_pet_react_handler))
        .route("/v1/pet/custom", get(get_custom_pets_handler).put(set_custom_pets_handler))
        .route("/v1/pet/state", get(get_pet_state_handler))
        .route("/v1/pet/selected", put(set_pet_selected_handler))
        .route("/v1/pet/sessions", post(create_pet_session_handler))
        .route(
            "/v1/pet/sessions/{session_id}",
            put(select_pet_session_handler)
                .patch(rename_pet_session_handler)
                .delete(delete_pet_session_handler),
        )
        .route("/v1/pet/messages", post(append_pet_message_handler))
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
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Web2AI API — Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; background: #fafafa; }
    .swagger-ui .topbar { background-color: #181818; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis],
      layout: 'BaseLayout'
    });
  </script>
</body>
</html>"#,
    )
}

async fn openapi_handler() -> impl IntoResponse {
    Json(json!({
        "openapi": "3.0.3",
        "info": {
            "title": "Web2AI API Gateway",
            "version": "0.1.0",
            "description": "OpenAI-compatible local AI gateway backed by Rust Axum + Diesel SQLite."
        },
        "servers": [
            { "url": "http://127.0.0.1:8088", "description": "Local Gateway" }
        ],
        "components": {
            "securitySchemes": {
                "BearerAuth": {
                    "type": "http",
                    "scheme": "bearer",
                    "description": "Optional local API key created via /v1/keys"
                }
            },
            "schemas": {
                "ChatMessage": {
                    "type": "object",
                    "required": ["role", "content"],
                    "properties": {
                        "role": { "type": "string", "enum": ["system", "user", "assistant"] },
                        "content": { "type": "string" }
                    }
                },
                "ChatCompletionRequest": {
                    "type": "object",
                    "required": ["model", "messages"],
                    "properties": {
                        "model": { "type": "string", "example": "deepseek:deepseek-chat" },
                        "messages": {
                            "type": "array",
                            "items": { "$ref": "#/components/schemas/ChatMessage" }
                        },
                        "stream": { "type": "boolean", "default": false }
                    }
                },
                "CreateProfileInput": {
                    "type": "object",
                    "required": ["type", "name"],
                    "properties": {
                        "type": { "type": "string", "enum": ["deepseek", "gemini", "metaai"] },
                        "name": { "type": "string", "example": "DeepSeek Main" },
                        "token": { "type": "string" },
                        "cookie": { "type": "string" },
                        "is_active": { "type": "boolean", "default": true }
                    }
                }
            }
        },
        "paths": {
            "/health": {
                "get": {
                    "tags": ["System"],
                    "summary": "Gateway health & active profile counts",
                    "responses": { "200": { "description": "OK" } }
                }
            },
            "/v1/models": {
                "get": {
                    "tags": ["OpenAI"],
                    "summary": "List available provider:model IDs",
                    "responses": { "200": { "description": "Model list" } }
                }
            },
            "/v1/chat/completions": {
                "post": {
                    "tags": ["OpenAI"],
                    "summary": "Create chat completion (supports SSE streaming & X-Session-Id)",
                    "security": [{ "BearerAuth": [] }],
                    "parameters": [
                        {
                            "name": "X-Session-Id",
                            "in": "header",
                            "required": false,
                            "schema": { "type": "string" }
                        }
                    ],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": { "$ref": "#/components/schemas/ChatCompletionRequest" }
                            }
                        }
                    },
                    "responses": { "200": { "description": "Chat completion or SSE stream" } }
                }
            },
            "/v1/profiles": {
                "get": {
                    "tags": ["Profiles"],
                    "summary": "List provider profiles",
                    "parameters": [
                        { "name": "type", "in": "query", "required": false, "schema": { "type": "string" } }
                    ],
                    "responses": { "200": { "description": "Profiles list" } }
                },
                "post": {
                    "tags": ["Profiles"],
                    "summary": "Create provider profile",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": { "$ref": "#/components/schemas/CreateProfileInput" }
                            }
                        }
                    },
                    "responses": { "201": { "description": "Created" } }
                }
            },
            "/v1/profiles/{id}": {
                "get": {
                    "tags": ["Profiles"],
                    "summary": "Get profile by ID",
                    "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
                    "responses": { "200": { "description": "Profile" } }
                },
                "put": {
                    "tags": ["Profiles"],
                    "summary": "Update profile",
                    "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "name": { "type": "string" },
                                        "token": { "type": "string" },
                                        "cookie": { "type": "string" },
                                        "is_active": { "type": "boolean" }
                                    }
                                }
                            }
                        }
                    },
                    "responses": { "200": { "description": "Updated" } }
                },
                "delete": {
                    "tags": ["Profiles"],
                    "summary": "Delete profile",
                    "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
                    "responses": { "200": { "description": "Deleted" } }
                }
            },
            "/v1/keys": {
                "get": { "tags": ["API Keys"], "summary": "List local API keys", "responses": { "200": { "description": "Keys" } } },
                "post": {
                    "tags": ["API Keys"],
                    "summary": "Create local API key",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "required": ["name"],
                                    "properties": {
                                        "name": { "type": "string", "example": "Cursor IDE" }
                                    }
                                }
                            }
                        }
                    },
                    "responses": { "201": { "description": "Created" } }
                }
            },
            "/v1/keys/revoke": {
                "post": {
                    "tags": ["API Keys"],
                    "summary": "Revoke local API key",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "required": ["key"],
                                    "properties": {
                                        "key": { "type": "string", "example": "sk-..." }
                                    }
                                }
                            }
                        }
                    },
                    "responses": { "200": { "description": "Revoked" } }
                }
            },
            "/v1/keys/{key}": {
                "delete": {
                    "tags": ["API Keys"],
                    "summary": "Delete local API key",
                    "parameters": [{ "name": "key", "in": "path", "required": true, "schema": { "type": "string" } }],
                    "responses": { "200": { "description": "Deleted" } }
                }
            },
            "/v1/pet/state": {
                "get": { "tags": ["Pet"], "summary": "Get persisted pet selection & chat history", "responses": { "200": { "description": "Pet state" } } }
            },
            "/v1/pet/selected": {
                "put": {
                    "tags": ["Pet"],
                    "summary": "Save selected pet ID in SQLite",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "required": ["pet_id"],
                                    "properties": {
                                        "pet_id": { "type": "string", "enum": ["fox", "bot", "cat", "owl", "shiba"] }
                                    }
                                }
                            }
                        }
                    },
                    "responses": { "200": { "description": "Saved" } }
                }
            },
            "/v1/pet/sessions": {
                "post": {
                    "tags": ["Pet"],
                    "summary": "Create or activate a pet chat session",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "required": ["session_id"],
                                    "properties": {
                                        "session_id": { "type": "string" },
                                        "title": { "type": "string" },
                                        "model": { "type": "string", "example": "deepseek:deepseek-chat" }
                                    }
                                }
                            }
                        }
                    },
                    "responses": { "200": { "description": "PetSession" } }
                }
            },
            "/v1/pet/sessions/{session_id}": {
                "put": {
                    "tags": ["Pet"],
                    "summary": "Switch active pet session and load its messages",
                    "parameters": [{ "name": "session_id", "in": "path", "required": true, "schema": { "type": "string" } }],
                    "responses": { "200": { "description": "Session messages" } }
                },
                "patch": {
                    "tags": ["Pet"],
                    "summary": "Rename pet chat session",
                    "parameters": [{ "name": "session_id", "in": "path", "required": true, "schema": { "type": "string" } }],
                    "responses": { "200": { "description": "Updated" } }
                },
                "delete": {
                    "tags": ["Pet"],
                    "summary": "Delete pet chat session",
                    "parameters": [{ "name": "session_id", "in": "path", "required": true, "schema": { "type": "string" } }],
                    "responses": { "200": { "description": "Deleted" } }
                }
            },
            "/v1/pet/messages": {
                "post": {
                    "tags": ["Pet"],
                    "summary": "Append a message to a pet chat session in SQLite",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "required": ["session_id", "role", "content"],
                                    "properties": {
                                        "session_id": { "type": "string" },
                                        "title": { "type": "string" },
                                        "model": { "type": "string" },
                                        "role": { "type": "string", "enum": ["user", "assistant"] },
                                        "content": { "type": "string" }
                                    }
                                }
                            }
                        }
                    },
                    "responses": { "200": { "description": "PetMessage" } }
                }
            }
        }
    }))
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

    let model_label = format!("{provider}:{}", request.model);
    let started_at = Instant::now();
    emit_pet_status(&state, "thinking", &model_label);

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
                let state_for_stream = state.clone();
                let model_for_stream = model_label.clone();
                let sse_stream = rx_stream.map(move |raw_sse| {
                    let payload = raw_sse
                        .strip_prefix("data: ")
                        .unwrap_or(&raw_sse)
                        .trim_end_matches("\n\n")
                        .to_string();
                    if payload == "[DONE]" {
                        emit_pet_status(&state_for_stream, "done", &model_for_stream);
                        let _ = state_for_stream.db.prune_old_sessions();
                        record_gateway_log(
                            &state_for_stream,
                            GatewayLogEntry {
                                id: uuid::Uuid::new_v4().to_string(),
                                timestamp: chrono::Utc::now().to_rfc3339(),
                                endpoint: "/v1/chat/completions".to_string(),
                                model: model_for_stream.clone(),
                                status_code: 200,
                                latency_ms: started_at.elapsed().as_millis() as u64,
                                stream: true,
                                error: None,
                            },
                        );
                    }
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
                emit_pet_status(&state, "error", &model_label);
                record_gateway_log(
                    &state,
                    GatewayLogEntry {
                        id: uuid::Uuid::new_v4().to_string(),
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        endpoint: "/v1/chat/completions".to_string(),
                        model: model_label,
                        status_code: err.status,
                        latency_ms: started_at.elapsed().as_millis() as u64,
                        stream: true,
                        error: Some(err.message.clone()),
                    },
                );
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
                emit_pet_status(&state, "done", &model_label);
                record_gateway_log(
                    &state,
                    GatewayLogEntry {
                        id: uuid::Uuid::new_v4().to_string(),
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        endpoint: "/v1/chat/completions".to_string(),
                        model: model_label,
                        status_code: 200,
                        latency_ms: started_at.elapsed().as_millis() as u64,
                        stream: false,
                        error: None,
                    },
                );
                let _ = state.db.save_session_data(
                    &session_id,
                    &session_data,
                    api_key_hash.as_deref(),
                );
                let _ = state.db.prune_old_sessions();
                let mut resp = Json(completion).into_response();
                if let Ok(hv) = HeaderValue::from_str(&session_id) {
                    resp.headers_mut().insert("x-session-id", hv);
                }
                resp
            }
            Err(err) => {
                emit_pet_status(&state, "error", &model_label);
                record_gateway_log(
                    &state,
                    GatewayLogEntry {
                        id: uuid::Uuid::new_v4().to_string(),
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        endpoint: "/v1/chat/completions".to_string(),
                        model: model_label,
                        status_code: err.status,
                        latency_ms: started_at.elapsed().as_millis() as u64,
                        stream: false,
                        error: Some(err.message.clone()),
                    },
                );
                let status = StatusCode::from_u16(err.status).unwrap_or(StatusCode::BAD_GATEWAY);
                (status, Json(err.to_json())).into_response()
            }
        }
    }
}

async fn get_gateway_logs_handler(State(state): State<AppState>) -> Json<serde_json::Value> {
    let limit = state
        .db
        .get_cache_settings()
        .map(|s| s.max_logs)
        .unwrap_or(200);
    let logs = state.db.list_gateway_logs(limit).unwrap_or_default();
    Json(json!({ "data": logs }))
}

async fn clear_gateway_logs_handler(State(state): State<AppState>) -> Json<serde_json::Value> {
    let _ = state.db.clear_gateway_logs();
    Json(json!({ "ok": true }))
}

#[derive(Deserialize)]
struct UpdateCacheSettingsRequest {
    max_sessions: i64,
    max_logs: i64,
}

async fn get_cache_settings_handler(State(state): State<AppState>) -> Response {
    match (state.db.get_cache_settings(), state.db.get_cache_stats()) {
        (Ok(settings), Ok(stats)) => Json(json!({
            "settings": settings,
            "stats": stats,
        }))
        .into_response(),
        (Err(e), _) | (_, Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "detail": e.to_string() })),
        )
            .into_response(),
    }
}

async fn set_cache_settings_handler(
    State(state): State<AppState>,
    Json(body): Json<UpdateCacheSettingsRequest>,
) -> Response {
    match state.db.set_cache_settings(body.max_sessions, body.max_logs) {
        Ok(settings) => {
            let stats = state.db.get_cache_stats().ok();
            Json(json!({
                "settings": settings,
                "stats": stats,
            }))
            .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "detail": e.to_string() })),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct SetPetReactRequest {
    enabled: bool,
}

async fn get_pet_react_handler() -> Json<serde_json::Value> {
    Json(json!({ "enabled": PET_REACT_TO_TRAFFIC.load(Ordering::Relaxed) }))
}

async fn set_pet_react_handler(
    State(state): State<AppState>,
    Json(body): Json<SetPetReactRequest>,
) -> Json<serde_json::Value> {
    PET_REACT_TO_TRAFFIC.store(body.enabled, Ordering::Relaxed);
    let _ = state
        .db
        .set_setting("pet_react_traffic", if body.enabled { "true" } else { "false" });
    Json(json!({ "enabled": body.enabled }))
}

#[derive(Deserialize)]
struct SetCustomPetsRequest {
    pets: serde_json::Value,
}

async fn get_custom_pets_handler(State(state): State<AppState>) -> Json<serde_json::Value> {
    let pets: serde_json::Value = state
        .db
        .get_setting("pet_custom_list")
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| json!([]));
    Json(json!({ "data": pets }))
}

async fn set_custom_pets_handler(
    State(state): State<AppState>,
    Json(body): Json<SetCustomPetsRequest>,
) -> Json<serde_json::Value> {
    let serialized = serde_json::to_string(&body.pets).unwrap_or_else(|_| "[]".to_string());
    let _ = state.db.set_setting("pet_custom_list", &serialized);
    Json(json!({ "ok": true, "data": body.pets }))
}

#[derive(Deserialize)]
struct SetPetSelectedRequest {
    pet_id: String,
}

#[derive(Deserialize)]
struct CreatePetSessionRequest {
    session_id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    model: String,
}

#[derive(Deserialize)]
struct AppendPetMessageRequest {
    session_id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    model: String,
    role: String,
    content: String,
}

async fn get_pet_state_handler(State(state): State<AppState>) -> Response {
    match state.db.get_pet_state() {
        Ok(pet_state) => Json(pet_state).into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "detail": err.to_string() })),
        )
            .into_response(),
    }
}

async fn set_pet_selected_handler(
    State(state): State<AppState>,
    Json(body): Json<SetPetSelectedRequest>,
) -> Response {
    match state.db.set_selected_pet(&body.pet_id) {
        Ok(()) => Json(serde_json::json!({ "ok": true, "pet_id": body.pet_id })).into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "detail": err.to_string() })),
        )
            .into_response(),
    }
}

async fn create_pet_session_handler(
    State(state): State<AppState>,
    Json(body): Json<CreatePetSessionRequest>,
) -> Response {
    match state
        .db
        .create_pet_session(&body.session_id, &body.title, &body.model)
    {
        Ok(session) => {
            let _ = state.db.prune_old_sessions();
            Json(session).into_response()
        }
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "detail": err.to_string() })),
        )
            .into_response(),
    }
}

async fn select_pet_session_handler(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Response {
    match state.db.select_pet_session(&session_id) {
        Ok(messages) => {
            Json(serde_json::json!({ "session_id": session_id, "messages": messages }))
                .into_response()
        }
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "detail": err.to_string() })),
        )
            .into_response(),
    }
}

#[derive(Debug, Deserialize)]
struct RenamePetSessionRequest {
    title: String,
}

async fn rename_pet_session_handler(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(body): Json<RenamePetSessionRequest>,
) -> Response {
    match state.db.rename_pet_session(&session_id, &body.title) {
        Ok(updated) => Json(serde_json::json!({ "updated": updated })).into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "detail": err.to_string() })),
        )
            .into_response(),
    }
}

async fn delete_pet_session_handler(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Response {
    match state.db.delete_pet_session(&session_id) {
        Ok(deleted) => Json(serde_json::json!({ "deleted": deleted })).into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "detail": err.to_string() })),
        )
            .into_response(),
    }
}

async fn append_pet_message_handler(
    State(state): State<AppState>,
    Json(body): Json<AppendPetMessageRequest>,
) -> Response {
    match state.db.append_pet_message(
        &body.session_id,
        &body.title,
        &body.model,
        &body.role,
        &body.content,
    ) {
        Ok(msg) => Json(msg).into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "detail": err.to_string() })),
        )
            .into_response(),
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
            app_handle: None,
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
            app_handle: None,
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
