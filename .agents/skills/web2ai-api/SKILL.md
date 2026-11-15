---
name: web2ai-api
description: Entry point for Web2AI API Desktop (Rust + Tauri v2) — OpenAI-compatible local gateway for DeepSeek, Gemini, and MetaAI. Use when the user mentions Web2AI API, Unofficial API, UNOFFICIAL_API_URL, local port 8088, or wants to call DeepSeek/Gemini/MetaAI via OpenAI format.
---

# Unofficial API (Rust Desktop Gateway)

OpenAI-compatible REST gateway embedded in the **Tauri v2 + Rust** Desktop application (`desktop/src-tauri`), aggregating **DeepSeek**, **Gemini**, and **MetaAI** on `http://127.0.0.1:8088` with SQLite persistence (`data/unofficial_api.db`) and Round-Robin multi-profile load balancing.

## Setup

```bash
export UNOFFICIAL_API_URL="http://127.0.0.1:8088"
```

Start the Desktop app (`cd desktop && bun run desktop:dev`) or the standalone headless server (`cd desktop/src-tauri && cargo run --bin gateway_server`).

Verify:
```bash
curl -s $UNOFFICIAL_API_URL/health
# {"backend":"rust","deepseek_active_profiles":...,"gemini_active_profiles":...,"metaai_active_profiles":...,"status":"ok"}
```

## Authentication

By default in local desktop mode, `DISABLE_AUTH` is `true` unless `DISABLE_AUTH=false` or `REQUIRE_API_KEY=true` is set. When auth is enabled, generate an API key:

```bash
curl -X POST $UNOFFICIAL_API_URL/v1/keys/generate \
  -H "Content-Type: application/json" \
  -d '{"name": "my-key"}'
```

Pass it on `/v1/{provider}/chat/completions` requests:
```
Authorization: Bearer sk-...
```

## Profiles & Multi-Account Load Balancing

Profiles are stored in SQLite (`data/unofficial_api.db`, `profiles` table) and managed via `/v1/profiles` or the Desktop UI. Requests load-balance across active profiles (`is_active: true`) using Round-Robin with sticky `X-Session-Id` affinity and automatic failover.

| Provider | Prefix | Credential Field |
|---|---|---|
| DeepSeek | `/v1/deepseek` | `token` |
| Gemini | `/v1/gemini` | `cookie` |
| MetaAI | `/v1/metaai` | `cookie` |

## Discover Models

```bash
curl -s $UNOFFICIAL_API_URL/v1/deepseek/models
curl -s $UNOFFICIAL_API_URL/v1/gemini/models
curl -s $UNOFFICIAL_API_URL/v1/metaai/models
```

## Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check + active profile counts per provider |
| `GET` | `/docs` | Gateway endpoint summary page |
| `POST` | `/v1/{provider}/chat/completions` | OpenAI-compatible chat completion (JSON & SSE) |
| `GET` | `/v1/{provider}/models` | List models for provider |
| `GET` / `POST` | `/v1/profiles` | List or create profiles |
| `GET` / `PUT` / `DELETE` | `/v1/profiles/{id}` | Get, update, or delete a profile |
| `GET` / `POST` | `/v1/keys` | List keys or create key (UI format) |
| `POST` | `/v1/keys/generate` | Generate a new API key (`{"api_key", "name"}`) |
| `POST` | `/v1/keys/revoke` | Deactivate an API key |
| `DELETE` | `/v1/keys/{key}` | Delete an API key |
