# OpenAI SDK Integration Tests

End-to-end compatibility tests using the **official OpenAI SDKs** for both **Node.js / TypeScript** (`openai`) and **Python** (`openai` + `pydantic` + `pytest`) against the `web2ai-api` Rust gateway.

## Prerequisites

- At least 1 active DeepSeek profile and 1 active API key in your local `web2ai.db` (or pass `WEB2AI_BASE_URL` and `WEB2AI_API_KEY` pointing to a running server).
- **Node/Bun**: `bun` installed
- **Python**: `uv` (recommended) or `python3` + `pip`

## Quick Run (Both Node & Python)

From the repository root:

```bash
./tests/run_all.sh
```

By default, `run_all.sh` builds/starts `gateway_server` on port `18089` (so it does not collide with the desktop app on `8088`), reads an active key from `web2ai.db`, runs both SDK test suites, and stops the temporary server on exit.

## Run Individually Against a Running Server

```bash
export WEB2AI_BASE_URL="http://127.0.0.1:8088/v1"
export WEB2AI_API_KEY="sk-your-key"

# Node / TypeScript SDK
cd tests/node && bun install && bun test

# Python SDK
cd tests/python && uv sync && uv run pytest -v
```
