# Web2AI Desktop

Desktop application for **Web2AI API**, managing DeepSeek, Gemini, and Meta AI profiles, API keys, and the local OpenAI-compatible gateway on `http://127.0.0.1:8088`.

---

## Features

- **Embedded Local Gateway**: Automatically starts on `http://127.0.0.1:8088` on launch and stops cleanly on exit.
- **System Tray Menu**:
  - **Open Web2AI API** — Show and focus the main window
  - **Open API Docs** — Open `http://127.0.0.1:8088/docs` in your browser
  - **Restart Backend** — Restart the embedded HTTP server
  - **Quit** — Stop the server and exit
- **Unified Dashboard**: Manage profiles, generate/revoke API keys, monitor gateway health, and test completions in the Playground.

---

## Development

```bash
cd desktop
bun install
bun run desktop:dev
```

| Command | Description |
|---|---|
| `bun run dev` | Run frontend dev server only (`http://localhost:5288`) |
| `bun run desktop:dev` | Launch the desktop app with hot-reload |
| `bun run typecheck` | Run TypeScript type checking |
| `bun run lint` | Run ESLint |
| `bun run desktop:build` | Build production frontend and desktop bundle |
