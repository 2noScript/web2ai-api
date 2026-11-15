# Web2AI API

> **Unofficial & Experimental**
>
> This project interfaces with **undocumented web APIs** from DeepSeek, Google Gemini, and Meta AI. It is not affiliated with or endorsed by any provider. Credentials (tokens/cookies) may expire, and rate limits or upstream changes can occur without notice. Intended for personal use, research, and local prototyping.

**Web2AI API** is a desktop application and local **OpenAI-compatible API gateway** (`http://127.0.0.1:8088`) supporting **DeepSeek**, **Gemini**, and **Meta AI**, with multi-profile Round-Robin load balancing, sticky session continuity, streaming, and Vision support.

---

## Features

- **Desktop App**: Manage provider profiles, generate API keys, monitor gateway health, and test completions in the built-in Playground.
- **Local API Gateway**: Automatically runs on `http://127.0.0.1:8088` alongside the desktop app (or standalone via `bun run server`).
- **OpenAI-Compatible Endpoints**: Standard `/v1/models` and `/v1/chat/completions` using `provider:model` (e.g. `deepseek:deepseek-chat`, `gemini:gemini-3-flash`, `metaai:llama-3.3-70b`) with SSE streaming and `image_url` Vision input.
- **Multi-Profile Load Balancing & Sticky Sessions**: Round-Robin across active profiles with automatic failover, plus `X-Session-Id` affinity to preserve multi-turn conversation context.
- **Persistent Local Storage**: Stores profiles and API keys in your OS application data directory.

---

## Quick Start

```bash
# Install dependencies (first time)
cd desktop && bun install && cd ..

# Launch the desktop app
bun run dev
```

---

## Data Storage

Application data (`web2ai.db`) is stored in your OS application data directory:

- **macOS**: `~/Library/Application Support/com.web2ai.desktop/web2ai.db`
- **Linux**: `${XDG_DATA_HOME:-~/.local/share}/com.web2ai.desktop/web2ai.db`
- **Windows**: `%APPDATA%\com.web2ai.desktop\web2ai.db`

---

## API Reference

Base URL: `http://127.0.0.1:8088`

### System

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Gateway status and active profile counts per provider |
| `GET` | `/docs` | Interactive API documentation |

### OpenAI-Compatible Chat & Models

Base URL for OpenAI SDKs & clients: `http://127.0.0.1:8088/v1`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/v1/models` | List all available models in `provider:model` format |
| `POST` | `/v1/chat/completions` | Chat completion using `model: "provider:model"` (`stream: true` for SSE, `image_url` for Vision) |

### Profiles & API Keys

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/v1/profiles` | List profiles (optional `?type=deepseek\|gemini\|metaai`) |
| `POST` | `/v1/profiles` | Create profile (`token` for DeepSeek, `cookie` for Gemini/Meta AI) |
| `GET` / `PUT` / `DELETE` | `/v1/profiles/{id}` | Read, update, or delete a profile |
| `GET` / `POST` | `/v1/keys` | List or create API keys |
| `POST` | `/v1/keys/revoke` | Revoke an API key |
| `DELETE` | `/v1/keys/{key}` | Delete an API key |

---

## Examples

### Chat Completion

```bash
curl -s http://127.0.0.1:8088/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek:deepseek-chat",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

### Multi-Turn Session (`X-Session-Id`)

```bash
curl -s http://127.0.0.1:8088/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "X-Session-Id: my-session-001" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek:deepseek-chat",
    "messages": [{"role": "user", "content": "Remember this code: 42"}]
  }'
```

### Multimodal Vision (`image_url`)

```bash
curl -s http://127.0.0.1:8088/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek:deepseek-chat",
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

## Documentation

- [Desktop App Guide](desktop/README.md)
- [Architecture Overview](docs/ARCHITECTURE.md)
- [Authentication & Session Management](docs/auth.md)
