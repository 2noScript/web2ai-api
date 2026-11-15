import { useEffect, useRef, useState } from "react";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { AudioLines, ChevronDown, ChevronUp, Send, SquarePen } from "lucide-react";

import { apiUrl } from "@/lib/api";
import {
  PET_STORAGE_KEY,
  PetSprite,
  getSavedPetId,
  type PetId,
  type PetStatus,
} from "@/components/pet-sprite";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
}

interface ModelItem {
  id: string;
}

interface PetSessionSummary {
  session_id: string;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
}

interface PetMessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
}

interface PetStateResponse {
  selected_pet_id: PetId;
  active_session_id: string | null;
  sessions: PetSessionSummary[];
  messages: PetMessageRow[];
}

const PET_COLLAPSED_SIZE = new LogicalSize(280, 220);
const PET_EXPANDED_SIZE = new LogicalSize(360, 560);
const SESSION_STORAGE_KEY = "web2ai_pet_session_id";

function createSessionId(): string {
  return `pet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function PetOverlay() {
  const [petId, setPetId] = useState<PetId>(() => getSavedPetId());
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<PetStatus>("idle");
  const [activeModelLabel, setActiveModelLabel] = useState<string>("deepseek:deepseek-chat");
  const [lastTitle, setLastTitle] = useState<string>("Web2AI Assistant");
  const [models, setModels] = useState<string[]>([
    "deepseek:deepseek-chat",
    "deepseek:deepseek-reasoner",
    "gemini:gemini-3-flash",
    "gemini:gemini-3-pro",
    "metaai:llama-3.3-70b",
  ]);
  const [selectedModel, setSelectedModel] = useState("deepseek:deepseek-chat");
  const [sessionId, setSessionId] = useState<string>(() => {
    const saved = localStorage.getItem(SESSION_STORAGE_KEY);
    if (saved) return saved;
    const fresh = createSessionId();
    localStorage.setItem(SESSION_STORAGE_KEY, fresh);
    return fresh;
  });
  const [sessions, setSessions] = useState<PetSessionSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const persistPetMessage = async (
    sid: string,
    titleIfNew: string,
    model: string,
    role: "user" | "assistant",
    content: string,
  ) => {
    try {
      await fetch(apiUrl("/v1/pet/messages"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sid,
          title: titleIfNew,
          model,
          role,
          content,
        }),
      });
    } catch {
      // Ignore persistence error
    }
  };

  const refreshPetState = async () => {
    try {
      const res = await fetch(apiUrl("/v1/pet/state"));
      if (!res.ok) return;
      const data = (await res.json()) as PetStateResponse;
      if (data.selected_pet_id) {
        setPetId(data.selected_pet_id);
        localStorage.setItem(PET_STORAGE_KEY, data.selected_pet_id);
      }
      setSessions(data.sessions || []);
      if (data.active_session_id) {
        setSessionId(data.active_session_id);
        localStorage.setItem(SESSION_STORAGE_KEY, data.active_session_id);
        const activeSession = data.sessions.find((s) => s.session_id === data.active_session_id);
        if (activeSession?.title) {
          setLastTitle(activeSession.title);
        }
        if (activeSession?.model) {
          setSelectedModel(activeSession.model);
          setActiveModelLabel(activeSession.model);
        }
      }
      if (Array.isArray(data.messages)) {
        setMessages(
          data.messages.map((m) => ({
            id: `db-${m.id}`,
            role: m.role === "user" ? "user" : "assistant",
            content: m.content,
          })),
        );
      }
    } catch {
      // Ignore if server not ready
    }
  };

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const dragOriginRef = useRef<{ x: number; y: number; dragged: boolean } | null>(null);
  const resetTimerRef = useRef<number | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  const slowWaitTimerRef = useRef<number | null>(null);
  const pokeCountRef = useRef(0);
  const pokeResetRef = useRef<number | null>(null);
  const [pokeMessage, setPokeMessage] = useState<string | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, expanded]);

  useEffect(() => {
    fetch(apiUrl("/v1/models"))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const list = (data?.data as ModelItem[] | undefined)?.map((m) => m.id);
        if (list && list.length > 0) {
          setModels(list);
          const supported = list.filter((id) => id.startsWith("deepseek:"));
          if (supported.length > 0 && !selectedModel.startsWith("deepseek:")) {
            setSelectedModel(supported[0]);
          } else if (!list.includes(selectedModel) && supported.length > 0) {
            setSelectedModel(supported[0]);
          }
        }
      })
      .catch(() => {});
  }, [selectedModel]);

  useEffect(() => {
    void refreshPetState();
  }, []);

  useEffect(() => {
    let unlistenStatus: (() => void) | undefined;
    let unlistenSelect: (() => void) | undefined;
    listen<{ status?: PetStatus; model?: string }>("pet:status", (event) => {
      const next = event.payload?.status;
      if (!next) return;
      if (event.payload?.model) {
        setActiveModelLabel(event.payload.model);
      }
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      setStatus(next);
      if (next === "done" || next === "error") {
        resetTimerRef.current = window.setTimeout(() => {
          setStatus("idle");
        }, 2400);
      }
    }).then((fn) => {
      unlistenStatus = fn;
    });

    listen<{ petId?: PetId }>("pet:select", (event) => {
      const nextPet = event.payload?.petId;
      if (!nextPet) return;
      setPetId(nextPet);
      localStorage.setItem(PET_STORAGE_KEY, nextPet);
    }).then((fn) => {
      unlistenSelect = fn;
    });

    const handleStorage = (e: StorageEvent) => {
      if (e.key === PET_STORAGE_KEY && e.newValue) {
        setPetId(e.newValue as PetId);
      }
    };
    window.addEventListener("storage", handleStorage);

    return () => {
      unlistenStatus?.();
      unlistenSelect?.();
      window.removeEventListener("storage", handleStorage);
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
      }
      if (typingTimerRef.current) {
        window.clearTimeout(typingTimerRef.current);
      }
      if (slowWaitTimerRef.current) {
        window.clearTimeout(slowWaitTimerRef.current);
      }
      if (pokeResetRef.current) {
        window.clearTimeout(pokeResetRef.current);
      }
    };
  }, []);

  const setWindowExpanded = async (next: boolean) => {
    setExpanded(next);
    try {
      const win = getCurrentWebviewWindow();
      await win.setSize(next ? PET_EXPANDED_SIZE : PET_COLLAPSED_SIZE);
    } catch {
      // Ignore outside Tauri
    }
    if (next) {
      window.setTimeout(() => inputRef.current?.focus(), 60);
    }
  };

  const handlePetPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragOriginRef.current = { x: e.clientX, y: e.clientY, dragged: false };
  };

  const handlePetPointerMove = (e: React.PointerEvent) => {
    const origin = dragOriginRef.current;
    if (!origin || origin.dragged) return;
    const dx = e.clientX - origin.x;
    const dy = e.clientY - origin.y;
    if (Math.hypot(dx, dy) > 4) {
      origin.dragged = true;
      void getCurrentWebviewWindow().startDragging();
    }
  };

  const handlePetPointerUp = () => {
    const origin = dragOriginRef.current;
    dragOriginRef.current = null;
    if (!origin || origin.dragged) return;
    if (sending) return;

    pokeCountRef.current += 1;
    if (pokeResetRef.current) {
      window.clearTimeout(pokeResetRef.current);
    }
    pokeResetRef.current = window.setTimeout(() => {
      pokeCountRef.current = 0;
    }, 3500);

    const reactions: Array<{ mood: PetStatus; text: string }> =
      pokeCountRef.current >= 4
        ? [
            { mood: "annoyed", text: "Hmph! Đừng chọc nữa >_<" },
            { mood: "annoyed", text: "Giận rồi nha! 💢" },
          ]
        : [
            { mood: "happy", text: "Hehe! Vui quá ♪" },
            { mood: "wink", text: "Chào bạn nha ★" },
            { mood: "shy", text: "Ngại ghê >///<" },
            { mood: "happy", text: "Sẵn sàng chat nè ♥" },
          ];

    const pick = reactions[Math.floor(Math.random() * reactions.length)];
    setStatus(pick.mood);
    setPokeMessage(pick.text);

    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => {
      setStatus((cur) =>
        cur === "happy" || cur === "annoyed" || cur === "shy" || cur === "wink"
          ? "idle"
          : cur,
      );
      setPokeMessage(null);
    }, 2200);
  };

  const handleComposeClick = () => {
    const fresh = createSessionId();
    localStorage.setItem(SESSION_STORAGE_KEY, fresh);
    setSessionId(fresh);
    setMessages([]);
    setLastTitle("New chat");
    void fetch(apiUrl("/v1/pet/sessions"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: fresh, title: "New chat", model: selectedModel }),
    }).then(() => refreshPetState());
    void setWindowExpanded(true);
  };

  const handleSelectSession = async (nextSid: string) => {
    setSessionId(nextSid);
    localStorage.setItem(SESSION_STORAGE_KEY, nextSid);
    const matched = sessions.find((s) => s.session_id === nextSid);
    if (matched?.title) setLastTitle(matched.title);
    if (matched?.model) {
      setSelectedModel(matched.model);
      setActiveModelLabel(matched.model);
    }
    try {
      const res = await fetch(apiUrl(`/v1/pet/sessions/${encodeURIComponent(nextSid)}`), {
        method: "PUT",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: PetMessageRow[] };
      setMessages(
        (data.messages || []).map((m) => ({
          id: `db-${m.id}`,
          role: m.role === "user" ? "user" : "assistant",
          content: m.content,
        })),
      );
    } catch {
      // Ignore
    }
  };

  const handleSend = async () => {
    const prompt = input.trim();
    if (!prompt || sending) return;

    setLastTitle(prompt.length > 34 ? `${prompt.slice(0, 34)}...` : prompt);
    setActiveModelLabel(selectedModel);

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: prompt,
    };
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "", reasoning: "" },
    ]);
    setInput("");
    setSending(true);
    setStatus("thinking");

    if (typingTimerRef.current) {
      window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    if (slowWaitTimerRef.current) {
      window.clearTimeout(slowWaitTimerRef.current);
    }
    // If response takes > 5.5s to start streaming, switch to impatient/waiting expression
    slowWaitTimerRef.current = window.setTimeout(() => {
      setStatus((cur) => (cur === "thinking" ? "waiting" : cur));
    }, 5500);

    const titlePreview = prompt.length > 34 ? `${prompt.slice(0, 34)}...` : prompt;
    let activeSid = sessionId;
    void persistPetMessage(activeSid, titlePreview, selectedModel, "user", prompt);

    try {
      const res = await fetch(apiUrl("/v1/chat/completions"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Id": activeSid,
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [{ role: "user", content: prompt }],
          stream: true,
        }),
      });

      const returnedSid = res.headers.get("x-session-id");
      if (returnedSid) {
        activeSid = returnedSid;
        setSessionId(returnedSid);
        localStorage.setItem(SESSION_STORAGE_KEY, returnedSid);
      }

      if (!res.ok || !res.body) {
        const errBody = await res.text();
        let errMessage = `HTTP ${res.status}`;
        try {
          errMessage = JSON.parse(errBody)?.error?.message || errMessage;
        } catch {
          // Keep HTTP status fallback
        }
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: `Error: ${errMessage}` } : m)),
        );
        setStatus("error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let contentAcc = "";
      let reasoningAcc = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed?.choices?.[0]?.delta;
            if (delta?.reasoning_content || delta?.content) {
              if (slowWaitTimerRef.current) {
                window.clearTimeout(slowWaitTimerRef.current);
                slowWaitTimerRef.current = null;
              }
              setStatus("streaming");
            }
            if (delta?.reasoning_content) reasoningAcc += delta.reasoning_content;
            if (delta?.content) contentAcc += delta.content;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: contentAcc, reasoning: reasoningAcc }
                  : m,
              ),
            );
          } catch {
            // Skip partial chunk
          }
        }
      }
      if (contentAcc.trim()) {
        await persistPetMessage(activeSid, titlePreview, selectedModel, "assistant", contentAcc);
        void refreshPetState();
      }
      setStatus("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to reach gateway";
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: `Error: ${msg}` } : m)),
      );
      setStatus("error");
    } finally {
      if (slowWaitTimerRef.current) {
        window.clearTimeout(slowWaitTimerRef.current);
        slowWaitTimerRef.current = null;
      }
      setSending(false);
    }
  };

  const handleInputChange = (val: string) => {
    setInput(val);
    if (sending) return;
    if (typingTimerRef.current) {
      window.clearTimeout(typingTimerRef.current);
    }
    if (val.trim().length > 0) {
      setStatus("typing");
      typingTimerRef.current = window.setTimeout(() => {
        setStatus((cur) => (cur === "typing" ? "idle" : cur));
      }, 1400);
    } else {
      setStatus((cur) => (cur === "typing" ? "idle" : cur));
    }
  };

  const statusSubtitle =
    pokeMessage ??
    (status === "typing"
      ? `Listening · ${selectedModel}`
      : status === "thinking"
        ? `Thinking · ${activeModelLabel}`
        : status === "waiting"
          ? `Waiting for response... · ${activeModelLabel}`
          : status === "streaming"
            ? `Replying · ${activeModelLabel}`
            : status === "done"
              ? `Done · ${activeModelLabel}`
              : status === "error"
                ? `Error · ${activeModelLabel}`
                : selectedModel);

  return (
    <div className="flex h-screen w-screen flex-col items-center bg-transparent px-2 pt-1 pb-2 select-none">
      {/* Top: Floating Pixel-Art Pet (drag to move · click to interact/react) */}
      <button
        type="button"
        onPointerDown={handlePetPointerDown}
        onPointerMove={handlePetPointerMove}
        onPointerUp={handlePetPointerUp}
        title="Drag to move · Click to pet!"
        className="relative z-10 -mb-2 flex shrink-0 cursor-grab items-center justify-center bg-transparent outline-none active:cursor-grabbing"
      >
        <PetSprite petId={petId} status={status} />
      </button>

      {/* Middle: Codex-style Frosted Pill Toolbar */}
      <div className="relative z-20 flex shrink-0 items-center divide-x divide-white/10 rounded-full border border-white/15 bg-[#242424]/90 px-1 py-0.5 shadow-xl backdrop-blur-xl">
        <button
          type="button"
          onClick={handleComposeClick}
          title="New Chat"
          className="flex h-7 w-9 items-center justify-center rounded-l-full text-foreground/85 transition-colors hover:bg-white/10 hover:text-foreground"
        >
          <SquarePen className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void setWindowExpanded(!expanded)}
          title={statusSubtitle}
          className={`flex h-7 w-9 items-center justify-center transition-colors hover:bg-white/10 ${
            status === "thinking"
              ? "text-brand"
              : status === "error"
                ? "text-destructive"
                : "text-foreground/85 hover:text-foreground"
          }`}
        >
          <AudioLines className={`h-3.5 w-3.5 ${status === "thinking" ? "animate-pulse" : ""}`} />
        </button>
        <button
          type="button"
          onClick={() => void setWindowExpanded(!expanded)}
          title={expanded ? "Collapse" : "Expand Chat"}
          className="flex h-7 w-9 items-center justify-center rounded-r-full text-foreground/85 transition-colors hover:bg-white/10 hover:text-foreground"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Bottom: Compact Status Pill OR Expanded Quick Chat */}
      {!expanded ? (
        <button
          type="button"
          onClick={() => void setWindowExpanded(true)}
          className="mt-2 w-full max-w-[248px] rounded-2xl border border-white/12 bg-[#222222]/90 px-4 py-2 text-left shadow-xl backdrop-blur-xl transition-colors hover:border-white/25"
        >
          <div className="truncate text-xs font-semibold text-foreground">{lastTitle}</div>
          <div className="truncate text-[11px] text-muted-foreground">{statusSubtitle}</div>
        </button>
      ) : (
        <div className="mt-2 flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#202020]/95 text-foreground shadow-2xl backdrop-blur-xl">
          {/* Session + Model Selector Bar */}
          <div className="flex h-9 shrink-0 items-center justify-between gap-1.5 border-b border-white/10 px-2.5">
            {sessions.length > 0 ? (
              <select
                value={sessionId}
                onChange={(e) => void handleSelectSession(e.target.value)}
                title="Saved pet chat history"
                className="h-6 min-w-0 flex-1 truncate rounded-md border border-border bg-input px-1.5 text-[11px] text-foreground outline-none focus:border-primary"
              >
                {!sessions.some((s) => s.session_id === sessionId) && (
                  <option value={sessionId}>New chat</option>
                )}
                {sessions.map((s) => (
                  <option key={s.session_id} value={s.session_id}>
                    {s.title}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[11px] font-medium text-muted-foreground">Model</span>
            )}
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="h-6 max-w-[160px] truncate rounded-md border border-border bg-input px-1.5 text-[11px] text-foreground outline-none focus:border-primary"
            >
              {models.map((m) => {
                const isSupported = m.startsWith("deepseek:");
                return (
                  <option
                    key={m}
                    value={m}
                    disabled={!isSupported}
                    className={isSupported ? "" : "text-muted-foreground/45"}
                  >
                    {isSupported ? m : `${m} (Soon)`}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Messages */}
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3 text-xs select-text">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-muted-foreground">
                <p className="font-medium text-foreground">Chat with Web2AI</p>
                <p className="text-[11px]">Ready on {selectedModel}</p>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.role === "user" ? "items-end" : "items-start"
                  }`}
                >
                  <div
                    className={`max-w-[88%] rounded-xl px-3 py-2 leading-relaxed ${
                      msg.role === "user"
                        ? "border border-primary/30 bg-primary/15 text-foreground"
                        : "border border-white/10 bg-[#2a2a2a] text-foreground"
                    }`}
                  >
                    {msg.reasoning && (
                      <details className="mb-1.5 rounded bg-black/25 px-2 py-1 text-[11px] text-muted-foreground">
                        <summary className="cursor-pointer font-medium">Reasoning</summary>
                        <pre className="mt-1 whitespace-pre-wrap font-mono">{msg.reasoning}</pre>
                      </details>
                    )}
                    <pre className="whitespace-pre-wrap font-sans">
                      {msg.content || (sending && msg.role === "assistant" ? "..." : "")}
                    </pre>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Bar */}
          <div className="shrink-0 border-t border-white/10 bg-[#1b1b1b]/80 p-2">
            <div className="flex items-end gap-1.5">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={`Message ${selectedModel}...`}
                className="max-h-24 min-h-[34px] flex-1 resize-none rounded-xl border border-white/10 bg-input px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              <button
                type="button"
                disabled={sending || !input.trim()}
                onClick={() => void handleSend()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                title="Send"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
