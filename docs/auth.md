# Authentication & Session Management

## API Key Authentication

External HTTP requests to `POST /v1/chat/completions` can be authenticated with a Bearer token generated in the **API Keys** tab or via `POST /v1/keys`.

Provide the key in one of the following headers:

```http
Authorization: Bearer <api_key>
```

or

```http
X-Api-Key: <api_key>
```

### Managing API Keys

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/v1/keys` | List all API keys (masked) |
| `POST` | `/v1/keys` | Create a new API key (`{"name": "cursor-local"}`) |
| `POST` | `/v1/keys/revoke` | Deactivate an API key (`{"api_key": "..."}`) |
| `DELETE` | `/v1/keys/{key}` | Delete an API key |

> In debug/development builds, API key enforcement is bypassed by default so local testing works out of the box.

---

## Session Management (`X-Session-Id`)

Pass an `X-Session-Id` header on `POST /v1/chat/completions` to maintain multi-turn conversation context across requests:

- The gateway binds the session to a specific active profile (sticky affinity).
- Concurrent requests sharing the same `X-Session-Id` are serialized per session to prevent context corruption.
- If the bound profile becomes inactive or fails, the gateway automatically fails over to another active profile for that provider.
- The resolved `x-session-id` is returned in the response headers.
