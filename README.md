# Web2AI API

> **Unofficial & Experimental**
>
> This project interfaces with **undocumented web APIs** from DeepSeek, Google Gemini, and Meta AI. It is not affiliated with or endorsed by any provider. Credentials (tokens/cookies) may expire, and rate limits or upstream changes can occur without notice. Intended for personal use, research, and local prototyping.

**Web2AI API** is a **Rust + Tauri v2** desktop application and embedded **OpenAI-compatible local gateway** (`http://127.0.0.1:8088`) supporting **DeepSeek**, **Gemini**, and **Meta AI**, with multi-profile Round-Robin load balancing, sticky session continuity, SSE streaming, and Vision support.

---

## Features

- **Native Desktop App (Tauri v2 + React)**: Manage provider profiles, generate API keys, monitor gateway health, and test completions in the built-in Playground.
- **Embedded Rust Gateway (Axum)**: Runs on `http://127.0.0.1:8088` automatically with the desktop app (or standalone via `bun run server`).
- **OpenAI-Compatible Endpoints**: Drop-in `/v1/{provider}/models` and `/v1/{provider}/chat/completions` (`deepseek`, `gemini`, `metaai`) with SSE streaming and `image_url` Vision input.
- **Multi-Profile Load Balancing & Sticky Sessions**: Round-Robin across active profiles with automatic failover, plus `X-Session-Id` affinity to preserve multi-turn conversation context.
- **Local SQLite Persistence**: Stores profiles and API keys securely in your OS application data directory.

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (or Node.js)
- [Rust](https://www.rust-lang.org/tools/install) toolchain

### Install & Run

```bash
# Install frontend dependencies (first time)
cd desktop && bun install && cd ..

# Run the desktop app + embedded Rust gateway (Vite dev server on :5288)
bun run dev
```

### Root Scripts

| Command | Description |
|---|---|
| `bun run dev` | Launch the Tauri desktop app in development mode |
| `bun run build` | Build production desktop bundle |
| `bun run server` | Run standalone Rust HTTP gateway (`gateway_server`) without UI |
| `bun run typecheck` | Run TypeScript typecheck (`tsc --noEmit`) |
| `bun run lint` | Run frontend linter |
| `bun run test` | Run Rust unit tests (`cargo test`) |

---

## Data Storage & Configuration

### Database Location

By default, SQLite persistence (`web2ai.db`) is stored in your OS application data directory:

- **macOS**: `~/Library/Application Support/com.web2ai.desktop/web2ai.db`
- **Linux**: `${XDG_DATA_HOME:-~/.local/share}/com.web2ai.desktop/web2ai.db`
- **Windows**: `%APPDATA%\com.web2ai.desktop\web2ai.db`

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `WEB2AI_DATA_DIR` | OS app data dir | Custom directory for `web2ai.db` (falls back to `UNOFFICIAL_API_DATA_DIR` if set) |
| `DISABLE_AUTH` | `true` in debug | Disable Bearer API key validation (`true` / `false`) |
| `API_KEY_SECRET` | — | HMAC secret used for API key signing |
| `SESSION_TTL_DAYS` | `7` | Session lifetime in days after last use (`0` = never expire) |
| `SESSION_MAX_SESSIONS` | `5000` | Maximum sessions kept in memory |

---

## API Reference

Base URL: `http://127.0.0.1:8088`

### System

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Gateway status and active profile counts per provider |
| `GET` | `/docs` (or `/`) | Interactive API documentation |

### OpenAI-Compatible Chat & Models

Replace `{provider}` with `deepseek`, `gemini`, or `metaai`:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/v1/{provider}/models` | List available models for the provider |
| `POST` | `/v1/{provider}/chat/completions` | Chat completion (`stream: true` for SSE, `image_url` for Vision) |

### Profiles & API Keys

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/v1/profiles` | List profiles (optional `?type=deepseek\|gemini\|metaai`) |
| `POST` | `/v1/profiles` | Create profile (`token` for DeepSeek, `cookie` for Gemini/Meta AI) |
| `GET` / `PUT` / `DELETE` | `/v1/profiles/{id}` | Read, update, or delete a profile |
| `GET` / `POST` | `/v1/keys` | List or create API keys |
| `POST` | `/v1/keys/generate` | Generate a new Bearer API key |
| `POST` | `/v1/keys/revoke` | Revoke an API key |
| `DELETE` | `/v1/keys/{key}` | Delete an API key |

---

## Examples

### Chat Completion

```bash
curl -s http://127.0.0.1:8088/v1/deepseek/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

### Multi-Turn Session (`X-Session-Id`)

```bash
curl -s http://127.0.0.1:8088/v1/gemini/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "X-Session-Id: my-session-001" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3-flash",
    "messages": [{"role": "user", "content": "Remember this code: 42"}]
  }'
```

### Multimodal Vision (`image_url`)

```bash
curl -s http://127.0.0.1:8088/v1/gemini/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3-flash",
    "messages": [
      {
        "role": "user",
        "content": [
          { "type": "text", "text": "Describe this image." },
          {
            "type": "image_url",
            "image_url": { "url": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png" }
          }
        ]
      }
    ]
  }'
```

---

## Project Structure & Docs

```text
web2ai-api/
├── package.json              # Root convenience scripts (dev, build, server, test)
├── desktop/
│   ├── src/                  # React + Tailwind + shadcn/ui frontend
│   └── src-tauri/            # Rust + Tauri v2 + Axum gateway + Diesel SQLite
└── docs/                     # Architecture, auth, and provider docs
```

- [Desktop App Guide](desktop/README.md)
- [Architecture Overview](docs/ARCHITECTURE.md)
- [Authentication & Session Management](docs/auth.md)
- [Provider Conversion Details](docs/CONVERSION.md)
