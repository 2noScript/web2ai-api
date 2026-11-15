# Unofficial API Desktop

Tauri v2 + React + Vite + Tailwind desktop application for **Unofficial API Gateway**.

## Features

- Automatically starts and manages the local FastAPI backend (`core.server:app` on `127.0.0.1:8088`) when it is not already running, and stops it cleanly on app exit.
- System tray menu with **Open Unofficial API**, **Open API Docs**, **Restart Backend**, and **Quit**.
- Reuses the dashboard UI for managing DeepSeek, Gemini, and MetaAI profiles, API keys, and chat completions.

## Development

```bash
cd desktop
bun install
bun run desktop:dev
```

## Build

```bash
cd desktop
bun run desktop:build
```

If the backend lives outside the repo root, set `UNOFFICIAL_API_DIR=/path/to/unofficial-api` before launching.
