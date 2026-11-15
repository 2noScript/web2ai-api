# Architecture

## Overview

**Web2AI API** is a local **OpenAI-compatible API gateway** and desktop application for **DeepSeek**, **Gemini**, and **Meta AI**.

- **Desktop UI (`desktop/src/`)**: Manages provider profiles, API keys, gateway status, and a built-in chat playground.
- **Local Gateway (`desktop/src-tauri/`)**: Runs an embedded HTTP server on `http://127.0.0.1:8088` alongside the desktop app (or standalone via `gateway_server`).
- **Unified Routing (`/v1`)**: `GET /v1/models` returns `provider:model` IDs across all registered providers, and `POST /v1/chat/completions` dispatches to the matching provider via `ProviderRegistry`.
- **Load Balancing & Sessions**: Active profiles are selected via Round-Robin (`ProfileLoadBalancer`) with `X-Session-Id` sticky affinity and automatic failover.
- **Persistence**: Profiles, API keys, and session state are stored in local SQLite (`web2ai.db`) in the OS application data directory.

---

## Project Structure

```text
web2ai-api/
├── package.json              # Root scripts (dev, build, server, test)
├── desktop/
│   ├── src/                  # Desktop UI
│   └── src-tauri/
│       └── src/
│           ├── lib.rs        # App setup, tray menu, Tauri commands, DB path resolution
│           ├── db/           # SQLite persistence (profiles, api_keys, sessions)
│           ├── load_balancer.rs # Round-Robin & sticky session failover
│           ├── session/      # VirtualSessionManager & session locking
│           ├── chat_service.rs  # Chat & SSE streaming execution
│           ├── providers/    # ProviderRegistry + DeepSeek, Gemini, MetaAI
│           ├── server/       # HTTP router (/health, /docs, /v1/*)
│           └── bin/gateway_server.rs # Standalone HTTP server binary
└── docs/                     # Project documentation
```
