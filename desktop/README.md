# Unofficial API Desktop

Desktop application for **Unofficial API Gateway**, built with **Tauri v2**, **React 19**, **Vite**, **Tailwind CSS v4**, and a **Rust** native layer (`src-tauri`) that manages the local gateway backend.

---

## Features

- **Managed Local Gateway**: Automatically detects or starts the FastAPI backend (`core.server:app`) on `127.0.0.1:8088` on launch, and stops the managed process cleanly on exit.
- **System Tray Integration**:
  - **Open Unofficial API** — Show and focus the main window
  - **Open API Docs** — Open `http://127.0.0.1:8088/docs` in your default browser
  - **Restart Backend** — Restart the managed local server
  - **Quit** — Stop the managed server (if spawned by the app) and exit
- **Unified Dashboard UI**: Manage **DeepSeek**, **Gemini**, and **MetaAI** profiles, generate/delete API keys, monitor backend health, and test chat completions directly inside the app.
- **Shared SQLite Persistence**: Uses `unofficial_api.db` (WAL mode) for profiles, API keys, sessions, and system settings.

---

## Prerequisites

- **Bun** (for frontend dependencies and scripts)
- **Rust** (`rustup` / `cargo`) + platform Tauri v2 build dependencies
- **Python 3.12+** with **uv** (or a project `.venv` with `uvicorn`) — required because the desktop app currently spawns `core.server:app` as its local HTTP gateway

---

## Development

```bash
cd desktop
bun install
bun run desktop:dev
```

Useful scripts inside `desktop/`:

| Command | Description |
|---|---|
| `bun run dev` | Run Vite frontend dev server only (`http://localhost:5173`) |
| `bun run desktop:dev` | Launch Tauri desktop window with Vite hot-reload |
| `bun run typecheck` | Run TypeScript type checking (`tsc --noEmit`) |
| `bun run lint` | Run ESLint |
| `bun run desktop:build` | Build production frontend (`dist/`) and native desktop bundle |

---

## Configuration

| Environment Variable | Description |
|---|---|
| `UNOFFICIAL_API_DIR` | Path to the repository root containing `core/server.py`. Useful when running the built binary outside the repo tree. |
| `UNOFFICIAL_API_DATA_DIR` | Directory containing `unofficial_api.db`. Defaults to `<project_dir>/data/unofficial_api.db`, or Tauri's `app_data_dir` if no project root is found. |
| `VITE_API_BASE_URL` | Override the frontend API base URL (defaults to `http://127.0.0.1:8088` in production Tauri builds). |

---

## Architecture & Rust Migration Status (`src-tauri`)

The desktop app is currently in a **hybrid transition**:

### 1. Active Runtime Flow
- `desktop/src/App.tsx` communicates over HTTP (`http://127.0.0.1:8088`) with the FastAPI server (`core/server.py`) for `/health`, `/v1/profiles`, `/v1/keys`, and `/v1/{provider}/chat/completions`.
- `desktop/src-tauri/src/lib.rs` resolves the project root, finds `.venv/bin/uvicorn` or `uv`, and manages the `core.server:app` child process.

### 2. Native Rust Modules (`desktop/src-tauri/src/`)

| Module | Status | Notes |
|---|---|---|
| `lib.rs` | Active | Window/tray lifecycle, Python backend process manager, and Tauri IPC commands (`get_backend_status`, `restart_backend`, `list_provider_models`, `provider_chat_completions`, `db_*`). |
| `db/mod.rs` | Implemented (SQLite/Diesel) | Defines the 5 SQLite tables (`profiles`, `api_keys`, `sessions`, `assistant_cache`, `system_settings`) and exposes CRUD for profiles & API keys. |
| `openai.rs` | Implemented | OpenAI-compatible request/response structs (`ChatCompletionRequest`, `ChatCompletionResponse`, `ModelList`). |
| `http_client.rs` | Implemented | `wreq` client with `Chrome136` TLS/HTTP2 fingerprint emulation. |
| `providers/deepseek/mod.rs` | Partial | Non-streaming chat completion, `wasmi` PoW solver (`pow.wasm`), SSE response parsing, and retry logic. Missing: SSE streaming output, multimodal image upload, and session continuation. |
| `providers/gemini/mod.rs` | Stub | Model list only; `chat_completions` returns `NotImplemented`. |
| `providers/metaai/mod.rs` | Stub | Model list only; `chat_completions` returns `NotImplemented`. |

### 3. Remaining Gaps Before Removing Python Backend
- Embedded HTTP server (e.g. Axum) on `127.0.0.1:8088` for external OpenAI-compatible clients
- Full `Gemini` and `MetaAI` provider implementations
- Round-Robin load balancer, sticky session affinity, auto-failover, and request count tracking
- Virtual session resolution (`X-Session-Id`, assistant history hashing) & API key auth middleware
- SSE streaming responses and multimodal vision (`image_url`) support
