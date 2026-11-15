---
name: web2ai-chat
description: Chat and code generation via the Web2AI API Rust Desktop gateway using OpenAI /v1/{provider}/chat/completions format with SSE streaming, vision, and X-Session-Id continuity across DeepSeek, Gemini, and MetaAI.
---

# Unofficial API — Chat

Requires the Rust Desktop gateway running on `UNOFFICIAL_API_URL` (default `http://127.0.0.1:8088`).

## Endpoints

`POST $UNOFFICIAL_API_URL/v1/{provider}/chat/completions`

| Provider | URL | Models |
|---|---|---|
| DeepSeek | `/v1/deepseek/chat/completions` | `deepseek-chat`, `deepseek-reasoner` |
| Gemini | `/v1/gemini/chat/completions` | `gemini-3-flash`, `gemini-3-pro`, `gemini-3-flash-thinking` |
| MetaAI | `/v1/metaai/chat/completions` | `meta-ai`, `llama-3.3-70b`, `meta-imagine` |

## Request Format

| Field | Required | Type | Notes |
|---|---|---|---|
| `model` | yes | string | Model ID from `/v1/{provider}/models` |
| `messages` | yes | array | `[{"role": "user", "content": "..."}]` or multimodal parts (`text`, `image_url`) |
| `stream` | no | boolean | Default `false`; set `true` for SSE streaming |

## Multi-Turn Continuity (`X-Session-Id`)

Every `/chat/completions` response includes an `x-session-id` header. Pass `X-Session-Id: <id>` on follow-up requests to continue the same provider conversation and keep sticky profile affinity.

## Examples

### DeepSeek (non-streaming)

```bash
curl -s -X POST http://127.0.0.1:8088/v1/deepseek/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"Write a Rust function to reverse a string"}],"stream":false}'
```

### DeepSeek (streaming SSE)

```bash
curl -N -X POST http://127.0.0.1:8088/v1/deepseek/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-reasoner","messages":[{"role":"user","content":"Explain ownership in Rust"}],"stream":true}'
```

### Gemini

```bash
curl -s -X POST http://127.0.0.1:8088/v1/gemini/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-3-flash","messages":[{"role":"user","content":"Explain quantum computing"}],"stream":false}'
```

### MetaAI (chat & image generation)

```bash
curl -s -X POST http://127.0.0.1:8088/v1/metaai/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"meta-imagine","messages":[{"role":"user","content":"A futuristic city at sunset"}],"stream":false}'
```
