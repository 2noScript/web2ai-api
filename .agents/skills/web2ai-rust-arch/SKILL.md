---
name: web2ai-rust-arch
description: Internal Rust architecture reference for the embedded Axum server, Diesel SQLite persistence, ProfileLoadBalancer, VirtualSessionManager, and providers in desktop/src-tauri. Use when modifying backend logic, adding providers, or debugging sessions/auth.
---

# Rust Desktop Backend Architecture (`desktop/src-tauri/src/`)

Internal developer reference for the pure-Rust gateway embedded in the Tauri v2 Desktop app.

## Module Map

```
desktop/src-tauri/src/
├── lib.rs                      # Tauri setup, tray menu, embedded Axum server lifecycle
├── bin/gateway_server.rs       # Standalone headless server binary (127.0.0.1:8088)
├── server/mod.rs               # Axum router, API key auth, X-Session-Id & SSE response
├── chat_service.rs             # Failover loop, history fallback, OpenAI JSON/SSE formatting
├── load_balancer.rs            # Round-Robin, sticky profile affinity, auth vs retryable errors
├── db/mod.rs                   # Diesel SQLite (WAL): profiles, api_keys, sessions, assistant_cache, system_settings
├── session/mod.rs              # VirtualSessionManager, per-session AsyncMutex, history sync, image extraction
├── http_client.rs              # wreq Client with Chrome136 TLS/HTTP2 emulation
├── openai.rs                   # OpenAI request/response/model structs
└── providers/
    ├── mod.rs                  # Provider trait (chat_completions + chat_completions_stream) & ProviderRegistry
    ├── deepseek/
    │   ├── mod.rs              # PoW (wasmi), SSE streaming, session continuation, vision upload
    │   └── pow.wasm            # DeepSeek PoW WebAssembly module
    ├── gemini/mod.rs           # SNlM0e/cfb2h init, StreamGenerate, cid/rid/rcid metadata, image upload
    └── metaai/mod.rs           # ecto1 token, GraphQL warmup, DGW WebSocket streaming & /imagine
```

## Request Lifecycle (`server/mod.rs` → `chat_service.rs`)

1. **Auth**: Extracts `Authorization: Bearer <key>` or `X-Api-Key`. Validates HMAC-signed key (`sk-<mid8>-<key_id6>-<crc8>`) against `api_keys` table when `DISABLE_AUTH=false` or `REQUIRE_API_KEY=true`.
2. **Session Resolution**: `VirtualSessionManager::resolve_session_id` reads `x-session-id` header or generates a new ID; acquires per-session `tokio::sync::Mutex` lock and loads `session_data` from SQLite `sessions` table.
3. **History Sync**: `sync_and_get_history` merges incoming `messages` into `session_data["history"]` (deduped, capped at 50 turns).
4. **Load Balancing & Failover**: `ProfileLoadBalancer::select_profile` reuses `session_data["profile_id"]` if active, otherwise picks next active profile via Round-Robin. Permanent auth failures (`401`, `invalid token`, `invalid cookie`) deactivate the profile; transient errors (`429`, `40300`, `too frequent`) trigger failover without deactivation.
5. **Persistence**: Saves updated `session_data` (provider session IDs + assistant reply) back to SQLite and echoes `x-session-id` in response headers.
