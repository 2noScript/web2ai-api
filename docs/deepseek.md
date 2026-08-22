# DeepSeek

> 📁 **GitHub Repository**: [2noScript/deepseek-api](https://github.com/2noScript/deepseek-api)

## Credentials

1. Go to https://chat.deepseek.com and sign in
2. Open DevTools (F12) → **Network** tab → reload → click any request to `chat.deepseek.com`
3. Copy the values:

| Source | Env var | Required | How to get |
|---|---|---|---|
| `authorization` header | `DEEPSEEK_AUTH_TOKEN` | ✅ | DevTools → Network → Request Headers → copy the `authorization: ...` value |

> The `authorization` value looks like `Bearer eyJhbGciOiJIUzI1NiIs...`. Copy the **entire value**. The server auto-prepends `Bearer ` if missing from `DEEPSEEK_AUTH_TOKEN`.

Or use **Cookie-Editor** extension to export all cookies at once.

## Model IDs

| Model | Description |
|---|---|
| `deepseek-chat` | Default standard chat model (DeepSeek-V3) |
| `deepseek-reasoner` | Reasoning model with DeepThink extended thinking (DeepSeek-R1) |

## Endpoints

DeepSeek supports the standard [common OpenAI-compatible endpoints](../README.md#common-openai-compatible) (`/models`, `/chat/completions`).

### Multimodal Vision Support

You can pass images in OpenAI Vision format via `image_url` (both direct URLs and Base64 Data URIs). DeepSeek automatically uploads the files with PoW solving and switches to vision recognition mode.

### Response — Additional fields

| Field | Type | Description |
|---|---|---|
| `choices[].message.reasoning_content` | string | Extended thinking trace (for R1 model) |
| `citation` | object | Web search citation data (when search is available) |
| `title` | string | Auto-generated conversation title |

## Examples

```bash
# Basic chat
curl -s http://localhost:8088/v1/deepseek/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Reasoning model (returns reasoning_content)
curl -s http://localhost:8088/v1/deepseek/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-reasoner",
    "messages": [{"role": "user", "content": "Solve 2+2"}]
  }'

# Multimodal Vision analysis
curl -s http://localhost:8088/v1/deepseek/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [
      {
        "role": "user",
        "content": [
          { "type": "text", "text": "What is in this picture?" },
          { "type": "image_url", "image_url": { "url": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png" } }
        ]
      }
    ],
    "stream": false
  }'
```
