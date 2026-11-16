# Web2AI API Desktop — Product Roadmap & Implementation Plan

> Detailed implementation plan for upcoming features across the Tauri v2 Rust backend (`desktop/src-tauri`) and React/TypeScript frontend (`desktop/src`).  
> Check off items (`[x]`) as each milestone is completed and verified.

---

## Phase 1: Desktop Pet Superpowers (UX & Productivity)

### 1.1 Global Hotkey & Spotlight-Style Summon
Allow summoning the Pet or toggling Quick-Chat from any active application on macOS, Windows, and Linux.
- [x] Add `tauri-plugin-global-shortcut` to `desktop/src-tauri/Cargo.toml` and initialize it in `desktop/src-tauri/src/lib.rs`.
- [x] Register default global shortcut (`CmdOrCtrl+Shift+Space`) to toggle the Pet Quick-Chat bar and focus the input field.
- [x] Register secondary shortcut (`CmdOrCtrl+Shift+P`, optional/configurable) to summon the Pet to the active screen or cursor position.
- [ ] Add shortcut configuration UI in `desktop/src/App.tsx` (or Settings modal) and persist custom keybindings in SQLite `system_settings`.
- [x] Emit `pet:toggle-quick-bar` event handled in `desktop/src/hooks/use-pet-bridge.ts` and `desktop/src/components/pet-overlay.tsx`.

### 1.2 Clipboard & Screen Snip Context Capture
Let users ask questions about copied code, errors, or screen regions in one click.
- [x] Add clipboard read capability (`tauri-plugin-clipboard-manager` or native helper) and expose a `read_clipboard_context` command in `desktop/src-tauri/src/lib.rs`.
- [x] Add an **"Ask Clipboard"** action button in the Pet Quick-Chat / Expanded Chat composer (`desktop/src/components/pet-overlay.tsx`).
- [x] Add a **"Snip Screen"** button that captures a region (e.g., `screencapture -i` on macOS / cross-platform capture) and attaches the resulting image to `attachedImages` for multimodal/vision models.
- [x] Auto-truncate or preview long clipboard snippets as a compact chip before sending.

### 1.3 Drag-and-Drop File & Image Support
Drop files directly onto the Pet or chat panel for instant summarization, code review, or Q&A.
- [x] Enable Tauri drag-drop listener on the `pet` window (`onDragDropEvent` / HTML5 drop fallback) in `desktop/src/components/pet-overlay.tsx`.
- [x] Support text/code files (`.ts`, `.tsx`, `.rs`, `.py`, `.md`, `.json`, `.log`, `.txt`) by reading contents into structured prompt context chips.
- [x] Support image drops (`.png`, `.jpg`, `.webp`) directly into `attachedImages`.
- [x] Show visual drop-zone highlight around the Pet chat card during drag-over.

### 1.4 Pet Personas & Multi-Provider Support
Give each pet companion a distinct personality and unlock all configured gateway providers.
- [x] Define persona presets (`fox`, `bot`, `cat`, `owl`, `shiba`) with tailored system prompts and tone in a shared `desktop/src/lib/pet-personas.ts` module.
- [x] Add a toggle in Pet Chat header to enable/disable the active pet's persona system prompt per session.
- [ ] Unlock `gemini:*` and `metaai:*` model selection in `desktop/src/components/pet-overlay.tsx` (currently restricted to `deepseek:*`) once provider endpoints are verified.

---

## Phase 2: Local AI Gateway (`:8088`) Enhancements

### 2.1 Live Request Logs & Token/Latency Inspector
Give developers real-time visibility into requests flowing through `http://localhost:8088`.
- [x] Add an in-memory ring buffer (and optional SQLite table) for recent `/v1/*` requests in `desktop/src-tauri/src/server/mod.rs` (timestamp, endpoint, model, profile ID, status code, latency ms, stream/non-stream).
- [x] Broadcast `gateway:request` events via Tauri `AppHandle` when requests start and finish.
- [x] Add a **Logs / Monitor** tab or drawer in `desktop/src/App.tsx` with live filtering by provider, status, and model.
- [x] Display overall request count, success rate, and average response latency in `LogsTab`.

### 2.2 Smart Auto-Fallback & Resilient Routing
Prevent client errors when a single profile or provider hits rate limits or transient upstream failures.
- [x] Enhance `ProfileLoadBalancer` in `desktop/src-tauri/src/` to automatically retry the next healthy profile on `429` / `5xx` / auth expiry errors before returning an error to the client.
- [ ] Add optional **Model Fallback Rules** in SQLite (e.g., if `deepseek:deepseek-reasoner` is unavailable, fall back to `deepseek:deepseek-chat` or `gemini:gemini-3-flash`).
- [ ] Surface automatic cooldown/recovery notifications in the Main App UI.

---

## Phase 3: Pet ↔ Gateway Live Bridge

### 3.1 Ambient Gateway Activity Reactions
Make the desktop pet react visually when external tools (Cursor, CLI scripts, etc.) use the local gateway.
- [x] Emit throttled `pet:status` events (`thinking` -> `done` / `error`) from `desktop/src-tauri/src/server/mod.rs` for external API traffic (without interrupting active Pet chat streams).
- [x] Add a toggle in Settings / Pet Store: **"React to external API traffic"** (on/off).
- [x] Display a subtle tooltip or mini badge when the pet is docked in `Pet Home` (`atHome = true`) or floating.

---

## Phase 4: Frontend Architecture & Code Cleanliness

### 4.1 Modularize Large Views & Hooks
Keep the codebase maintainable as features grow.
- [x] Extract shared Tauri IPC bridge (`desktop/src/hooks/use-pet-bridge.ts`).
- [x] Extract shared pet selection & cross-window sync (`desktop/src/hooks/use-selected-pet.ts`).
- [x] Split `desktop/src/App.tsx` into focused tab components:
  - [x] `desktop/src/components/tabs/logs-tab.tsx`
  - [x] `desktop/src/components/tabs/profiles-tab.tsx`
  - [x] `desktop/src/components/tabs/keys-tab.tsx`
  - [x] `desktop/src/components/tabs/playground-tab.tsx`
  - [x] `desktop/src/components/tabs/pet-store-tab.tsx`
- [x] Extract Pet session persistence & message encoding from `desktop/src/components/pet-overlay.tsx` into `desktop/src/hooks/use-pet-chat.ts`.
- [x] Add unit tests (`bun test`) for `use-pet-chat` helpers and `pet-personas`.

---

## Release Checklist (Per Version)
- [x] Run `cd desktop && bun run build` (`tsc -b && vite build`) with zero errors.
- [x] Run `cd desktop/src-tauri && cargo check` with zero errors.
- [ ] Bump version in `desktop/package.json`, `desktop/src-tauri/tauri.conf.json`, and `desktop/src-tauri/Cargo.toml`.
- [ ] Update `Cargo.lock` and push release tag `vX.Y.Z` to trigger `.github/workflows/release.yml`.
