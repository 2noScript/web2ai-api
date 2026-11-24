#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${WEB2AI_PORT:-18089}"
HOST="${WEB2AI_HOST:-127.0.0.1}"

if [ -z "${WEB2AI_API_KEY:-}" ]; then
  DB_PATH="${HOME}/Library/Application Support/com.web2ai.desktop/web2ai.db"
  if [ -f "$DB_PATH" ]; then
    WEB2AI_API_KEY="$(sqlite3 "$DB_PATH" "SELECT key FROM api_keys WHERE is_active = 1 LIMIT 1;")"
  fi
fi

if [ -z "${WEB2AI_API_KEY:-}" ]; then
  echo "Error: WEB2AI_API_KEY is not set and no active key was found in web2ai.db." >&2
  exit 1
fi

export WEB2AI_API_KEY

unset DISABLE_AUTH

if [ -z "${WEB2AI_BASE_URL:-}" ]; then
  echo "==> Building release gateway_server (production mode)..."
  (cd "$ROOT_DIR/desktop/src-tauri" && cargo build --release --bin gateway_server)

  echo "==> Starting temporary gateway_server on http://${HOST}:${PORT}..."
  WEB2AI_HOST="$HOST" WEB2AI_PORT="$PORT" \
    "$ROOT_DIR/desktop/src-tauri/target/release/gateway_server" \
    >/tmp/web2ai_test_gateway.log 2>&1 &
  GW_PID=$!
  trap 'kill "$GW_PID" 2>/dev/null || true; wait "$GW_PID" 2>/dev/null || true' EXIT

  for _ in $(seq 1 20); do
    if curl -sf -m 1 "http://${HOST}:${PORT}/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done

  export WEB2AI_BASE_URL="http://${HOST}:${PORT}/v1"
  export WEB2AI_AUTH_ENABLED="1"
fi

echo "==> Running Node/TypeScript OpenAI SDK tests (bun)..."
(cd "$ROOT_DIR/tests/node" && bun install --silent && bun test --timeout 60000)

echo "==> Running Python OpenAI SDK tests (uv + pytest)..."
(cd "$ROOT_DIR/tests/python" && uv sync --quiet && uv run pytest -v)

echo "==> All Node & Python OpenAI SDK tests passed!"
