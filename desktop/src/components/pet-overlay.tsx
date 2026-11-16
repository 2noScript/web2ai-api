import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  AppWindow,
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  ChevronUp,
  GripHorizontal,
  ImagePlus,
  Minimize2,
  PanelLeft,
  Pencil,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";

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
  images?: string[];
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
  pet_api_key?: string;
  active_session_id: string | null;
  sessions: PetSessionSummary[];
  messages: PetMessageRow[];
}

const PET_COLLAPSED_SIZE = new LogicalSize(280, 220);
const PET_EXPANDED_SIZE = new LogicalSize(560, 620);
const SESSION_STORAGE_KEY = "web2ai_pet_session_id";

function createSessionId(): string {
  return `pet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function encodePetMessageContent(text: string, images?: string[]): string {
  if (images && images.length > 0) {
    return JSON.stringify({ text, images });
  }
  return text;
}

function decodePetMessageContent(raw: string): { content: string; images?: string[] } {
  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      const parsed = JSON.parse(raw) as { text?: unknown; images?: unknown };
      if (typeof parsed.text === "string" || Array.isArray(parsed.images)) {
        const imgs = Array.isArray(parsed.images)
          ? parsed.images.filter((v): v is string => typeof v === "string" && v.length > 0)
          : undefined;
        return {
          content: typeof parsed.text === "string" ? parsed.text : "",
          images: imgs && imgs.length > 0 ? imgs : undefined,
        };
      }
    } catch {
      // Fallback to raw text
    }
  }
  return { content: raw };
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>("");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const chatBoxRef = useRef<HTMLDivElement | null>(null);
  const petWalkerRef = useRef<HTMLButtonElement | null>(null);
  const [pawTrail, setPawTrail] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const [petApiKey, setPetApiKey] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      if (data.pet_api_key) {
        setPetApiKey(data.pet_api_key);
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
          data.messages.map((m) => {
            const decoded = decodePetMessageContent(m.content);
            return {
              id: `db-${m.id}`,
              role: m.role === "user" ? "user" : "assistant",
              content: decoded.content,
              images: decoded.images,
            };
          }),
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

  useEffect(() => {
    if (!modelMenuOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModelMenuOpen(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [modelMenuOpen]);

  useEffect(() => {
    if (!expanded) {
      setPawTrail([]);
      if (petWalkerRef.current) {
        petWalkerRef.current.style.transform = "";
      }
      return;
    }

    let rafId = 0;
    let lastTime = performance.now();
    let dist = -1; // -1 = initialize at top-center once box is measured
    let dir: 1 | -1 = 1;
    let currentRot = 0;
    let walkPhase = 0;
    let modeTimer = 5.5; // walk ~5.5s then brief pause
    let paused = false;
    let distSincePaw = 0;
    let pawSeq = 1;

    const shortestAngleDiff = (from: number, to: number) => {
      let diff = ((to - from + 540) % 360) - 180;
      if (diff < -180) diff += 360;
      return diff;
    };

    const tick = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const box = chatBoxRef.current;
      const walker = petWalkerRef.current;
      if (box && walker) {
        const left = box.offsetLeft;
        const top = box.offsetTop;
        const w = box.offsetWidth;
        const h = box.offsetHeight;
        const perim = 2 * (w + h);

        if (perim > 40) {
          if (dist < 0) {
            dist = w * 0.5;
          }

          let isMoving = false;
          if (sending) {
            // Smoothly return to top-center when replying
            const target = w * 0.5;
            const diff = target - dist;
            if (Math.abs(diff) > 3) {
              const step = Math.min(Math.abs(diff), 110 * dt);
              dir = diff >= 0 ? 1 : -1;
              dist += dir * step;
              isMoving = true;
            } else {
              dist = target;
            }
          } else {
            modeTimer -= dt;
            if (modeTimer <= 0) {
              paused = !paused;
              modeTimer = paused ? 1.1 + Math.random() * 0.8 : 4.5 + Math.random() * 3.5;
              if (!paused && Math.random() < 0.3) {
                dir = dir === 1 ? -1 : 1;
              }
            }
            if (!paused) {
              const step = 54 * dt;
              dist = (dist + dir * step + perim) % perim;
              isMoving = true;
              distSincePaw += step;
            }
          }

          // Map perimeter distance -> (footX, footY, targetRot)
          // Offset outward by 24px so the pet's feet rest on the outer border of the chat card
          const wallGap = 24;
          let footX = left + w * 0.5;
          let footY = top;
          let cx = footX;
          let cy = top - wallGap;
          let targetRot = 0;

          if (dist < w) {
            // Top edge (left -> right)
            footX = left + dist;
            footY = top;
            cx = footX;
            cy = top - wallGap;
            targetRot = 0;
          } else if (dist < w + h) {
            // Right edge (top -> bottom)
            const d = dist - w;
            footX = left + w;
            footY = top + d;
            cx = left + w + wallGap;
            cy = footY;
            targetRot = 90;
          } else if (dist < 2 * w + h) {
            // Bottom edge (right -> left)
            const d = dist - (w + h);
            footX = left + w - d;
            footY = top + h;
            cx = footX;
            cy = top + h + wallGap;
            targetRot = 180;
          } else {
            // Left edge (bottom -> top)
            const d = dist - (2 * w + h);
            footX = left;
            footY = top + h - d;
            cx = left - wallGap;
            cy = footY;
            targetRot = -90;
          }

          // Smooth corner rotation
          currentRot += shortestAngleDiff(currentRot, targetRot) * Math.min(1, dt * 12);

          // Walking gait bob + subtle waddle
          if (isMoving) {
            walkPhase += dt * 11;
          } else {
            walkPhase = 0;
          }
          const bob = isMoving ? Math.abs(Math.sin(walkPhase)) * 3.5 : 0;
          const waddle = isMoving ? Math.sin(walkPhase) * 4 : 0;
          const rad = ((currentRot - 90) * Math.PI) / 180;
          const bobX = Math.cos(rad) * bob;
          const bobY = Math.sin(rad) * bob;

          // Center the 84x84 sprite box on (cx, cy)
          const px = cx - 48 + bobX;
          const py = cy - 48 + bobY;
          walker.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) rotate(${(currentRot + waddle).toFixed(1)}deg) scaleX(${dir}) scale(0.78)`;

          if (distSincePaw >= 36 && !sending) {
            distSincePaw = 0;
            const id = pawSeq++;
            setPawTrail((prev) => [...prev.slice(-4), { id, x: footX, y: footY }]);
            window.setTimeout(() => {
              setPawTrail((prev) => prev.filter((p) => p.id !== id));
            }, 850);
          }
        }
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
      setPawTrail([]);
    };
  }, [expanded, sending]);

  const parseModelMeta = (modelId: string) => {
    const colonIdx = modelId.indexOf(":");
    const provider = colonIdx > 0 ? modelId.slice(0, colonIdx) : "deepseek";
    const name = colonIdx > 0 ? modelId.slice(colonIdx + 1) : modelId;
    const isSupported = provider === "deepseek";
    const iconSrc =
      provider === "gemini"
        ? "/providers/gemini.svg"
        : provider === "metaai"
          ? "/providers/metaai.svg"
          : "/providers/deepseek.svg";
    return { provider, name, isSupported, iconSrc };
  };

  const selectedModelMeta = parseModelMeta(selectedModel);

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
        (data.messages || []).map((m) => {
          const decoded = decodePetMessageContent(m.content);
          return {
            id: `db-${m.id}`,
            role: m.role === "user" ? "user" : "assistant",
            content: decoded.content,
            images: decoded.images,
          };
        }),
      );
    } catch {
      // Ignore
    }
  };

  const handleDeleteSession = async (targetSid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(apiUrl(`/v1/pet/sessions/${encodeURIComponent(targetSid)}`), {
        method: "DELETE",
      });
      const remaining = sessions.filter((s) => s.session_id !== targetSid);
      setSessions(remaining);
      if (targetSid === sessionId) {
        if (remaining.length > 0) {
          await handleSelectSession(remaining[0].session_id);
        } else {
          const fresh = createSessionId();
          localStorage.setItem(SESSION_STORAGE_KEY, fresh);
          setSessionId(fresh);
          setMessages([]);
          setLastTitle("New chat");
        }
      }
      await refreshPetState();
    } catch {
      // Ignore
    }
  };

  const startRenameSession = (targetSid: string, currentTitle: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingSessionId(targetSid);
    setEditingTitle(currentTitle);
  };

  const commitRenameSession = async (targetSid: string) => {
    const trimmed = editingTitle.trim();
    setEditingSessionId(null);
    if (!trimmed) return;
    setSessions((prev) =>
      prev.map((s) => (s.session_id === targetSid ? { ...s, title: trimmed } : s)),
    );
    if (targetSid === sessionId) {
      setLastTitle(trimmed);
    }
    try {
      await fetch(apiUrl(`/v1/pet/sessions/${encodeURIComponent(targetSid)}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      await refreshPetState();
    } catch {
      // Ignore
    }
  };

  const appendImageFiles = (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    for (const file of list.slice(0, 4)) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setAttachedImages((prev) => (prev.length >= 4 ? prev : [...prev, reader.result as string]));
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSend = async () => {
    const prompt = input.trim();
    const imagesToSend = attachedImages;
    if ((!prompt && imagesToSend.length === 0) || sending) return;

    const displayPrompt = prompt || "[Image]";
    setLastTitle(displayPrompt.length > 34 ? `${displayPrompt.slice(0, 34)}...` : displayPrompt);
    setActiveModelLabel(selectedModel);

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: prompt,
      images: imagesToSend.length > 0 ? imagesToSend : undefined,
    };
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "", reasoning: "" },
    ]);
    setInput("");
    setAttachedImages([]);
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

    const titlePreview = displayPrompt.length > 34 ? `${displayPrompt.slice(0, 34)}...` : displayPrompt;
    let activeSid = sessionId;
    const dbPayload = encodePetMessageContent(prompt, imagesToSend);
    void persistPetMessage(activeSid, titlePreview, selectedModel, "user", dbPayload);

    let authKey = petApiKey;
    if (!authKey) {
      try {
        const stRes = await fetch(apiUrl("/v1/pet/state"));
        if (stRes.ok) {
          const stData = (await stRes.json()) as PetStateResponse;
          if (stData.pet_api_key) {
            authKey = stData.pet_api_key;
            setPetApiKey(authKey);
          }
        }
      } catch {
        // Ignore
      }
    }

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Session-Id": activeSid,
      };
      if (authKey) {
        headers.Authorization = `Bearer ${authKey}`;
      }
      const messageContent =
        imagesToSend.length > 0
          ? [
              { type: "text", text: prompt || "Describe this image." },
              ...imagesToSend.map((url) => ({
                type: "image_url",
                image_url: { url },
              })),
            ]
          : prompt;
      const res = await fetch(apiUrl("/v1/chat/completions"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: selectedModel,
          messages: [{ role: "user", content: messageContent }],
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
    <div
      className={`relative flex h-screen w-screen flex-col items-center overflow-hidden bg-transparent select-none ${
        expanded ? "px-11 pt-12 pb-11" : "px-2 pt-1 pb-2"
      }`}
    >
      {/* Fading paw/sparkle trail along the chat perimeter */}
      {expanded &&
        pawTrail.map((paw) => (
          <span
            key={paw.id}
            style={{ left: paw.x - 4, top: paw.y - 4 }}
            className="pointer-events-none absolute z-30 h-2 w-2 animate-ping rounded-full bg-primary/55"
          />
        ))}

      {/* Floating Pixel-Art Pet (centered when collapsed; 60fps perimeter walker around chat when expanded) */}
      <button
        ref={petWalkerRef}
        type="button"
        onPointerDown={handlePetPointerDown}
        onPointerMove={handlePetPointerMove}
        onPointerUp={handlePetPointerUp}
        title="Drag to move · Click to pet!"
        className={
          expanded
            ? "absolute top-0 left-0 z-40 flex h-24 w-24 origin-center cursor-grab items-center justify-center bg-transparent outline-none will-change-transform active:cursor-grabbing"
            : "relative z-30 -mb-2 flex shrink-0 cursor-grab items-center justify-center bg-transparent outline-none active:cursor-grabbing"
        }
      >
        <PetSprite petId={petId} status={status} />
      </button>

      {/* Collapsed-only: Codex-style Frosted Pill Toolbar */}
      {!expanded && (
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
            title="Expand Chat"
            className="flex h-7 w-9 items-center justify-center text-foreground/85 transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void invoke("open_main_window").catch(() => {})}
            title="Open Main App"
            className="flex h-7 w-9 items-center justify-center rounded-r-full text-foreground/85 transition-colors hover:bg-white/10 hover:text-primary"
          >
            <AppWindow className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

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
        <div
          ref={chatBoxRef}
          className={`relative flex min-h-0 w-full flex-1 flex-row overflow-hidden rounded-2xl border bg-[#202020]/95 text-foreground backdrop-blur-xl transition-shadow duration-500 ${
            status === "thinking" || status === "streaming" || status === "waiting"
              ? "border-primary/40 shadow-[0_0_28px_-6px_rgba(54,181,186,0.45)]"
              : "border-white/12 shadow-2xl"
          }`}
        >
          {/* Left Sidebar: New Chat + Session History */}
          {sidebarOpen && (
            <aside className="flex w-[156px] shrink-0 flex-col border-r border-white/10 bg-[#191919]/90">
              <div className="p-2">
                <button
                  type="button"
                  onClick={handleComposeClick}
                  className="flex h-7 w-full items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 text-[11px] font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/15"
                >
                  <SquarePen className="h-3 w-3 shrink-0 text-primary" />
                  <span className="truncate">New chat</span>
                </button>
              </div>
              <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-2">
                {!sessions.some((s) => s.session_id === sessionId) && (
                  <button
                    type="button"
                    onClick={() => void handleSelectSession(sessionId)}
                    className="flex w-full items-center rounded-lg border border-primary/30 bg-primary/15 px-2 py-1.5 text-left text-[11px] font-medium text-foreground"
                  >
                    <span className="truncate">{lastTitle || "New chat"}</span>
                  </button>
                )}
                {sessions.map((s) => {
                  const active = s.session_id === sessionId;
                  const isEditing = editingSessionId === s.session_id;
                  return (
                    <div
                      key={s.session_id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (!isEditing) void handleSelectSession(s.session_id);
                      }}
                      onDoubleClick={(e) => startRenameSession(s.session_id, s.title, e)}
                      onKeyDown={(e) => {
                        if (!isEditing && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          void handleSelectSession(s.session_id);
                        }
                      }}
                      className={`group flex w-full cursor-pointer items-center justify-between gap-1 rounded-lg border px-2 py-1.5 text-left text-[11px] transition-colors ${
                        active
                          ? "border-primary/30 bg-primary/15 font-medium text-foreground"
                          : "border-transparent text-muted-foreground hover:bg-white/5 hover:text-foreground"
                      }`}
                    >
                      {isEditing ? (
                        <input
                          type="text"
                          autoFocus
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={() => void commitRenameSession(s.session_id)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void commitRenameSession(s.session_id);
                            } else if (e.key === "Escape") {
                              setEditingSessionId(null);
                            }
                          }}
                          className="h-5 min-w-0 flex-1 rounded border border-primary/60 bg-background/90 px-1.5 text-[11px] text-foreground outline-none"
                        />
                      ) : (
                        <>
                          <span className="min-w-0 flex-1 truncate">{s.title}</span>
                          <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                            <button
                              type="button"
                              onClick={(e) => startRenameSession(s.session_id, s.title, e)}
                              title="Rename chat"
                              className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-white/10 hover:text-foreground"
                            >
                              <Pencil className="h-2.5 w-2.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => void handleDeleteSession(s.session_id, e)}
                              title="Delete chat"
                              className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                            >
                              <Trash2 className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </aside>
          )}

          {/* Right Main Chat Column */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Top Slim Header (Draggable Window Handle + Actions) */}
            <div
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                const target = e.target as HTMLElement;
                if (target.closest("button, input")) return;
                void getCurrentWebviewWindow().startDragging();
              }}
              title="Drag here to move chat window"
              className="flex h-9 shrink-0 cursor-grab items-center gap-2 border-b border-white/10 px-2.5 active:cursor-grabbing"
            >
              <button
                type="button"
                onClick={() => setSidebarOpen((v) => !v)}
                title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
              >
                <PanelLeft className="h-3.5 w-3.5" />
              </button>
              {editingSessionId === `header:${sessionId}` ? (
                <input
                  type="text"
                  autoFocus
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onBlur={() => void commitRenameSession(sessionId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void commitRenameSession(sessionId);
                    } else if (e.key === "Escape") {
                      setEditingSessionId(null);
                    }
                  }}
                  className="h-5 min-w-0 flex-1 rounded border border-primary/60 bg-background/90 px-1.5 text-[11px] text-foreground outline-none"
                />
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span
                    onDoubleClick={() => startRenameSession(`header:${sessionId}`, lastTitle || "New chat")}
                    title="Double-click to rename"
                    className="min-w-0 truncate text-[11px] font-medium text-foreground/90"
                  >
                    {lastTitle || "New chat"}
                  </span>
                  <button
                    type="button"
                    onClick={() => startRenameSession(`header:${sessionId}`, lastTitle || "New chat")}
                    title="Rename chat"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-white/10 hover:text-foreground"
                  >
                    <Pencil className="h-2.5 w-2.5" />
                  </button>
                </div>
              )}
              <div className="flex shrink-0 items-center gap-1.5">
                <GripHorizontal className="h-3.5 w-3.5 text-muted-foreground/45" />
                <button
                  type="button"
                  onClick={() => void invoke("open_main_window").catch(() => {})}
                  title="Open Main App"
                  className="flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/5 text-foreground/80 transition-colors hover:border-primary/50 hover:bg-primary/15 hover:text-primary"
                >
                  <AppWindow className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={handleComposeClick}
                  title="New Chat"
                  className="flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/5 text-foreground/80 transition-colors hover:border-white/25 hover:bg-white/10 hover:text-foreground"
                >
                  <SquarePen className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void setWindowExpanded(false)}
                  title="Collapse Chat"
                  className="flex h-6 items-center gap-1 rounded-md border border-white/15 bg-white/10 px-2 text-[10px] font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-primary/20"
                >
                  <Minimize2 className="h-3 w-3" />
                  <span>Minimize</span>
                </button>
              </div>
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
                    {msg.images && msg.images.length > 0 && (
                      <div className="mb-1.5 flex flex-wrap gap-1.5">
                        {msg.images.map((src, idx) => (
                          <img
                            key={idx}
                            src={src}
                            alt="Uploaded"
                            className="max-h-28 max-w-[160px] rounded-lg border border-white/10 object-cover"
                          />
                        ))}
                      </div>
                    )}
                    {msg.reasoning && (
                      <details className="mb-1.5 rounded bg-black/25 px-2 py-1 text-[11px] text-muted-foreground">
                        <summary className="cursor-pointer font-medium">Reasoning</summary>
                        <pre className="mt-1 whitespace-pre-wrap font-mono">{msg.reasoning}</pre>
                      </details>
                    )}
                    {(msg.content || (sending && msg.role === "assistant")) && (
                      <pre className="whitespace-pre-wrap font-sans">
                        {msg.content || "..."}
                      </pre>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

            {/* Codex-style 2-Row Composer: Input Top + Action/Model Bar Bottom */}
            <div className="shrink-0 bg-[#1a1a1a]/90 p-2.5">
              <div className="rounded-2xl border border-white/12 bg-[#252525]/95 transition-colors focus-within:border-primary/65">
                <div className="px-3 pt-2.5 pb-1.5">
                  {attachedImages.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {attachedImages.map((src, idx) => (
                        <div key={idx} className="group relative">
                          <img
                            src={src}
                            alt="Attachment preview"
                            className="h-11 w-11 rounded-lg border border-white/15 object-cover"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setAttachedImages((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/80 text-white hover:bg-destructive"
                            title="Remove image"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) {
                        appendImageFiles(e.target.files);
                      }
                      e.target.value = "";
                    }}
                  />
                  <textarea
                    ref={inputRef}
                    rows={2}
                    value={input}
                    onChange={(e) => handleInputChange(e.target.value)}
                    onPaste={(e) => {
                      if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
                        const imgs = Array.from(e.clipboardData.files).filter((f) =>
                          f.type.startsWith("image/"),
                        );
                        if (imgs.length > 0) {
                          e.preventDefault();
                          appendImageFiles(imgs);
                        }
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    placeholder={`Ask ${selectedModelMeta.name} anything...`}
                    className="max-h-28 min-h-[54px] w-full resize-none bg-transparent text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/75 focus:outline-none"
                  />
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-white/8 px-2.5 py-1.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => fileInputRef.current?.click()}
                      title="Upload image (or paste image)"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground disabled:opacity-40"
                    >
                      <ImagePlus className="h-3.5 w-3.5" />
                    </button>
                    <div ref={modelMenuRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setModelMenuOpen((v) => !v)}
                        title="Select model"
                        className="flex h-7 max-w-[195px] items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 text-[11px] text-foreground transition-colors hover:border-white/25 hover:bg-white/10"
                      >
                        <img
                          src={selectedModelMeta.iconSrc}
                          alt={selectedModelMeta.provider}
                          className="h-3.5 w-3.5 shrink-0"
                        />
                        <span className="truncate font-medium">{selectedModelMeta.name}</span>
                        <ChevronUp
                          className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${
                            modelMenuOpen ? "rotate-180" : ""
                          }`}
                        />
                      </button>

                      {modelMenuOpen && (
                        <div className="absolute bottom-full left-0 z-50 mb-1.5 w-60 overflow-hidden rounded-xl border border-white/15 bg-[#1e1e1e]/98 p-1 shadow-2xl backdrop-blur-xl">
                          <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                            Select Model
                          </div>
                          <div className="max-h-52 space-y-0.5 overflow-y-auto">
                            {models.map((m) => {
                              const meta = parseModelMeta(m);
                              const isActive = m === selectedModel;
                              return (
                                <button
                                  key={m}
                                  type="button"
                                  disabled={!meta.isSupported}
                                  onClick={() => {
                                    if (!meta.isSupported) return;
                                    setSelectedModel(m);
                                    setModelMenuOpen(false);
                                  }}
                                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors ${
                                    !meta.isSupported
                                      ? "cursor-not-allowed opacity-45"
                                      : isActive
                                        ? "bg-primary/15 text-foreground"
                                        : "text-foreground/85 hover:bg-white/8 hover:text-foreground"
                                  }`}
                                >
                                  <div className="flex min-w-0 items-center gap-2">
                                    <img
                                      src={meta.iconSrc}
                                      alt={meta.provider}
                                      className="h-3.5 w-3.5 shrink-0"
                                    />
                                    <div className="min-w-0">
                                      <div className="truncate font-medium">{meta.name}</div>
                                      <div className="text-[10px] text-muted-foreground capitalize">
                                        {meta.provider}
                                      </div>
                                    </div>
                                  </div>
                                  {!meta.isSupported ? (
                                    <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                                      Soon
                                    </span>
                                  ) : isActive ? (
                                    <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="hidden text-[10px] text-muted-foreground/60 sm:inline">
                      ↵ Send
                    </span>
                    <button
                      type="button"
                      disabled={sending || (!input.trim() && attachedImages.length === 0)}
                      onClick={() => void handleSend()}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-all hover:opacity-90 disabled:opacity-35"
                      title="Send (Enter)"
                    >
                      <ArrowUp className="h-3.5 w-3.5 stroke-[2.5]" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
