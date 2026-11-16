# DeepSeek Setup Guide

Web2AI API connects to DeepSeek's web chat backend using your DeepSeek web **Bearer token**.

## Supported Models

- `deepseek:deepseek-chat` — General chat and coding
- `deepseek:deepseek-reasoner` — Reasoning mode (`reasoning_content` + final answer)

---

## How to Get Your DeepSeek Token (F12 DevTools)

1. Open [chat.deepseek.com](https://chat.deepseek.com) in your browser and sign in.
2. Open Developer Tools by pressing **`F12`** (or **`Cmd + Option + I`** on macOS, **`Ctrl + Shift + I`** on Windows/Linux).
3. Use any of the three methods below to copy your token:

### Method 1: Application → Local Storage (Fastest)

1. Open the **Application** tab (Chrome/Edge) or **Storage** tab (Firefox).
2. In the left sidebar, expand **Local Storage** → `https://chat.deepseek.com`.
3. Click the **`userToken`** key.
4. Copy the token string from its value (if stored as JSON like `{"value":"<token>"}`, copy only the `<token>` string inside `"value"`).

### Method 2: Network → Request Headers

1. Open the **Network** tab and select the **Fetch/XHR** filter.
2. Refresh the page or send a test message in DeepSeek.
3. Click any API request to `chat.deepseek.com/api/v0/...` (for example `current_profile` or `completion`).
4. Under **Headers → Request Headers**, find:
   ```http
   Authorization: Bearer <your_token>
   ```
5. Copy the `<your_token>` part (without `Bearer `).

### Method 3: DevTools Console One-Liner

1. Open the **Console** tab on `chat.deepseek.com`.
2. Run:
   ```js
   (() => {
     const raw = localStorage.getItem("userToken");
     try { return JSON.parse(raw)?.value ?? raw; } catch { return raw; }
   })()
   ```
3. Copy the printed token string (without surrounding quotes).

---

## Add the Token to Web2AI API

1. Open **Web2AI API Desktop** → **Profiles** tab.
2. Click **Add Profile**, choose **DeepSeek**, give it a name (e.g. `DeepSeek Main`), and paste your token.
3. Click **Save** — the status badge will show **Active**.

### Tips

- **Multiple accounts**: Add 2 or more DeepSeek profiles to enable automatic Round-Robin load balancing and 45s cooldown failover if one account hits a rate limit.
- **Token expiration**: If you log out of `chat.deepseek.com` or the session expires, repeat the steps above and update the profile token.
- **Keep it private**: Your `userToken` grants full access to your DeepSeek web account—never commit or share it publicly.
