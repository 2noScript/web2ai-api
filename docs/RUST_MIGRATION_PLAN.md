# Kế hoạch chuyển đổi hoàn toàn Backend & Providers sang Rust (`desktop/src-tauri`)

Tài liệu này mô tả lộ trình thay thế hoàn toàn Python FastAPI backend (`core/`) bằng native Rust server nhúng trực tiếp trong Tauri (`desktop/src-tauri`), giúp ứng dụng Desktop chạy độc lập không cần Python, `.venv` hay `uv`.

---

## Mục tiêu kiến trúc

```text
External OpenAI Clients (curl, SDK, IDE...) ──┐
                                              ▼
Desktop UI (desktop/src/) ──HTTP──► Embedded Axum Server (127.0.0.1:8088)
                                      ├── VirtualSessionMiddleware (API Key + X-Session-Id)
                                      ├── ProfileLoadBalancer (Round-Robin + Sticky + Failover)
                                      ├── ChatExecutionService (History + Retry + SSE/JSON)
                                      ├── Providers (wreq Chrome136): DeepSeek | Gemini | MetaAI
                                      └── SQLite (Diesel WAL: unofficial_api.db)
```

---

## Phase 1: Hoàn thiện Core Layer (`db/`, `load_balancer.rs`, `session/`)

Mục tiêu: Đạt 100% parity với `core/db.py`, `core/profile.py`, `core/load_balancer.py`, `core/session/`.

- [ ] **Mở rộng `desktop/src-tauri/src/db/mod.rs`**
  - **Profiles**: bổ sung `get_profile`, `list_profiles_by_type`, `deactivate_profile`, `record_profile_request` (tăng `total_requests` và cập nhật `request_counts[YYYY-MM-DD][HH]`).
  - **API Keys**: bổ sung `validate_api_key`, `revoke_api_key` (`is_active = 0`), `touch_api_key_last_used`, đồng bộ format key & `machine_id` trong `system_settings`.
  - **Sessions & Assistant Cache**: bổ sung `get_session`, `save_session`, `cleanup_expired_sessions(ttl_days)`, `lookup_assistant_hash`, `save_assistant_hash`.
- [ ] **Tạo `desktop/src-tauri/src/load_balancer.rs`** (port từ `core/load_balancer.py`)
  - `ProfileLoadBalancer` với Round-Robin index theo từng provider (`deepseek`, `gemini`, `metaai`).
  - Sticky session affinity (`session_data.profile_id`) + auto-failover khi profile bị tắt hoặc lỗi.
  - Phân loại lỗi:
    - `is_auth_failure`: chỉ deactivate profile khi gặp lỗi credential chết (`401`, `invalid token`, `invalid cookie`, `unauthorized`, ...).
    - `is_retryable_error`: retry/failover cho lỗi tạm thời (`429`, `40300`, `too frequent`, `session is not authenticated`) mà không deactivate profile.
- [ ] **Tạo `desktop/src-tauri/src/session/`** (port từ `core/session/manager.py`, `history.py`, `middleware.py`)
  - Resolve `X-Session-Id` theo thứ tự ưu tiên:
    1. Request headers (`x-session-id`, `session-id`, `session_id`, `x-client-request-id`, `x-conversation-id`)
    2. Request body (`session_id`, `conversation_id`, `prompt_cache_key`)
    3. Hash 50 ký tự đầu của tin nhắn `assistant` gần nhất
    4. Fallback API key hash / IP + User-Agent fingerprint
  - Lock theo từng `session_id` (`DashMap<String, Arc<tokio::sync::Mutex<()>>>`) để tránh race condition.
  - `sync_and_get_history` & `format_prompt_with_history` để nối ngữ cảnh khi provider session hết hạn.

---

## Phase 2: Embedded HTTP Server bằng Axum (`src/server/`)

Mục tiêu: Thay thế FastAPI (`core/server.py`) bằng `axum` lắng nghe trên `127.0.0.1:8088`.

- [ ] **Thêm crates vào `desktop/src-tauri/Cargo.toml`**: `axum`, `tower-http` (CORS), `tokio-stream`, `futures`, `dashmap`.
- [ ] **Tạo `desktop/src-tauri/src/server/mod.rs` & routes**:
  - `GET /health` → `{ status, deepseek_active_profiles, gemini_active_profiles, metaai_active_profiles }`
  - `GET / POST / PUT / DELETE /v1/profiles` (khớp schema `ProfileResponse`)
  - `GET /v1/keys`, `POST /v1/keys/generate`, `POST /v1/keys/revoke`, `DELETE /v1/keys/{key}`
  - `GET /v1/{provider}/models`
  - `POST /v1/{provider}/chat/completions` (hỗ trợ cả JSON và `text/event-stream` SSE)
- [ ] **Auth & Session Middleware**:
  - Kiểm tra `Authorization: Bearer <key>` / `X-Api-Key` (tôn trọng biến môi trường `DISABLE_AUTH`).
  - Trả header `x-session-id` trong response và lưu `session_data` vào SQLite sau khi request/stream kết thúc.

---

## Phase 3: Port đầy đủ 3 Providers sang Rust (`src/providers/`)

Mục tiêu: Hoàn thiện cả 3 provider bằng `wreq` (`Chrome136` TLS/HTTP2 emulation) với đầy đủ streaming, session continuation và multimodal.

- [ ] **Cập nhật `Provider` trait (`desktop/src-tauri/src/providers/mod.rs`)**
  - Bổ sung `chat_completions_stream(...)` trả về stream các delta chunks.
  - Truyền/nhận `ProviderSessionState` và danh sách `Attachment` (tải ảnh từ HTTP URL hoặc decode Base64 Data URI).
- [ ] **Hoàn thiện `DeepSeekProvider` (`desktop/src-tauri/src/providers/deepseek/mod.rs`)**
  - Giữ nguyên `wasmi` PoW solver (`pow.wasm`) & SSE parser hiện có.
  - Bổ sung **Real SSE streaming** (đọc `resp.bytes_stream()` thay vì buffer toàn bộ `resp.text().await`).
  - Bổ sung **Session continuation** (`deepseek_chat_session_id`, `parent_message_id`).
  - Bổ sung **Vision / File upload** (giải PoW cho `/api/v0/file/upload_file` và truyền `ref_file_ids`).
- [ ] **Viết mới `GeminiProvider` (`desktop/src-tauri/src/providers/gemini/mod.rs`)**
  - Client pool theo `profile_id` giữ cookies (`__Secure-1PSID`, `__Secure-1PSIDTS`) và tokens (`SNlM0e`, `cfb2h`, `f.sid`) lấy từ `https://gemini.google.com/app`.
  - Gửi prompt tới `/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate`, parse chunk nhiều lớp để tách `text`, `thoughts` (`reasoning_content`) và metadata `(cid, rid, rcid)`.
  - Hỗ trợ upload ảnh qua `content-push.googleapis.com/upload` và các model `gemini-3-flash`, `gemini-3-pro`, `gemini-3-flash-thinking`.
- [ ] **Viết mới `MetaAIProvider` (`desktop/src-tauri/src/providers/metaai/mod.rs`)**
  - Khởi tạo session từ cookie trên `https://www.meta.ai/` để lấy `fb_dtsg`, `lsd`, token.
  - Gọi GraphQL (`https://www.meta.ai/api/graphql/`), hỗ trợ chat thường, `/imagine` (`meta-imagine` trả markdown `![Generated Image](...)`), `conversation_id` multi-turn và streaming.
  - Đồng bộ danh sách model: `meta-ai`, `llama-3.3-70b`, `meta-imagine`.

---

## Phase 4: Unified Chat Service (`src/chat_service.rs`)

Mục tiêu: Port `core/services/chat_service.py` để gom logic điều phối dùng chung cho cả 3 provider:

- [ ] Vòng lặp failover qua các active profiles (`max_profile_attempts`).
- [ ] Tự động fallback từ provider session sang virtual history prompt nếu session cũ bị lỗi.
- [ ] Ghi nhận `record_profile_request` bất đồng bộ.
- [ ] Chuẩn hóa output sang OpenAI `ChatCompletionResponse` và SSE chunks (`data: {"choices":[{"delta":{...}}]}` + `data: [DONE]`).

---

## Phase 5: Cắt bỏ Python Backend & Kiểm thử (`lib.rs`)

- [ ] **Cập nhật `desktop/src-tauri/src/lib.rs`**:
  - Khởi động Axum server bằng `tauri::async_runtime::spawn` khi app setup.
  - Xóa `spawn_backend`, `find_uv_binary`, `has_server_py`, `BackendState.child` — loại bỏ hoàn toàn phụ thuộc Python / `.venv` / `uv`.
  - Nút **Restart Backend** trên System Tray restart task Axum server qua shutdown signal (`CancellationToken` / `watch` channel).
- [ ] **Kiểm thử**:
  - Unit tests (`cargo test`) cho SQLite CRUD, LoadBalancer failover, Session ID resolution, DeepSeek PoW & SSE parser, Gemini/MetaAI parser.
  - Integration tests Axum cho `/health`, `/v1/profiles`, `/v1/keys`, `/v1/{provider}/models`.
  - Smoke test end-to-end trên Desktop app (`bun run desktop:dev` & `bun run desktop:build`) với profile thật cho cả non-stream và `stream: true`.

---

## Phase 6: Loại bỏ hoàn toàn Python (Pure Rust Desktop)

Mục tiêu: Sau khi Phase 1–5 chạy ổn định và vượt qua toàn bộ test, xóa bỏ hoàn toàn mã nguồn và cấu hình Python để repo chỉ còn ứng dụng **Rust + Tauri Desktop**.

- [ ] **Xóa mã nguồn & SDK Python**:
  - Xóa `core/` (FastAPI server, routers, services, session, load balancer)
  - Xóa các vendored Python SDKs: `deepseek-api/`, `Gemini-API/`, `metaai-api/`
  - Xóa cấu hình Python/Docker cũ: `pyproject.toml`, `uv.lock`, `run.sh`, `Dockerfile`, `docker-compose.yml`, `tests/` (sau khi đã chuyển toàn bộ test sang `cargo test`)
- [ ] **Hoàn tất Desktop Standalone**:
  - Cập nhật `desktop/src-tauri/tauri.conf.json` và `README.md` / `docs/` để phản ánh repo thuần **Rust + Tauri v2**.
  - Đóng gói binary desktop (`bun run desktop:build`) chạy độc lập trên macOS/Windows/Linux mà không cần cài Python hay bất kỳ runtime bên ngoài nào.

