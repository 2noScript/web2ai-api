# Gemini

> 📁 **GitHub Repository**: [HanaokaYuzu/Gemini-API](https://github.com/HanaokaYuzu/Gemini-API)

## Credentials

1. Go to https://gemini.google.com and sign in
2. Open DevTools (F12) → **Network** tab → reload → click any request to `gemini.google.com`
3. In **Request Headers**, find the `Cookie:` line and copy the entire value (or use **Application** → **Cookies** to get individual cookie values)

| Cookie name | Env var | Required |
|---|---|---|
| `__Secure-1PSID` | part of `GEMINI_COOKIE` | ✅ |
| `__Secure-1PSIDTS` | part of `GEMINI_COOKIE` | ❌ (account-dependent) |

> Cookies expire. Re-extract them when requests start failing.

## Environment

| Env var | Required | Description |
|---|---|---|
| `GEMINI_COOKIE` | ✅ | Full cookie string: `__Secure-1PSID=xxx; __Secure-1PSIDTS=yyy` |

## Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/v1/gemini/models` | GET | List available models |
| `/v1/gemini/chat/completions` | POST | Chat completions (streaming supported) |

### Chat Completions — Multimodal Vision Support

Gemini chat completions natively support standard **OpenAI Vision format** (`image_url`) as well as direct `files`:

| Field / Format | Type | Required | Description |
|---|---|---|---|
| `messages[].content[].image_url` | object / string | ❌ | Image URL or Base64 Data URI (`data:image/png;base64,...`) |
| `files` | array | ❌ | Local file paths to attach (images, PDFs, etc.) |

> Thinking models return `reasoning_content` in `choices[].message`.

## Examples

```bash
# Basic chat
curl -s http://localhost:8088/v1/gemini/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <key>" \
  -d '{
    "model": "gemini-3-flash",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Streaming
curl -s http://localhost:8088/v1/gemini/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <key>" \
  -d '{
    "model": "gemini-3-flash",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'

# Multimodal Vision (OpenAI format - Single / Multiple Images)
curl -s http://localhost:8088/v1/gemini/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <key>" \
  -d '{
    "model": "gemini-3-flash",
    "messages": [
      {
        "role": "user",
        "content": [
          { "type": "text", "text": "Describe the contents of this image." },
          {
            "type": "image_url",
            "image_url": { "url": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png" }
          }
        ]
      }
    ]
  }'

# List models
curl -s http://localhost:8088/v1/gemini/models \
  -H "Authorization: Bearer <key>"
```
