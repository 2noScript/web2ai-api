import { useCallback, useState } from "react";
import { apiUrl } from "@/lib/api";
import { PET_STORAGE_KEY, type PetId } from "@/components/pet-sprite";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  images?: string[];
}

export interface PetSessionSummary {
  session_id: string;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
}

export interface PetMessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
}

export interface PetStateResponse {
  selected_pet_id: PetId;
  pet_api_key?: string;
  docked?: boolean;
  active_session_id: string | null;
  sessions: PetSessionSummary[];
  messages: PetMessageRow[];
}

export const SESSION_STORAGE_KEY = "web2ai_pet_session_id";

export function createSessionId(): string {
  return `pet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function encodePetMessageContent(text: string, images?: string[]): string {
  if (images && images.length > 0) {
    return JSON.stringify({ text, images });
  }
  return text;
}

export function decodePetMessageContent(raw: string): { content: string; images?: string[] } {
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

export function usePetChatSession(options: {
  onPetIdSync?: (petId: PetId) => void;
  onDockedSync?: (docked: boolean) => void;
  onTitleSync?: (title: string) => void;
  onModelSync?: (model: string) => void;
}) {
  const [sessionId, setSessionId] = useState<string>(() => {
    const saved = localStorage.getItem(SESSION_STORAGE_KEY);
    if (saved) return saved;
    const fresh = createSessionId();
    localStorage.setItem(SESSION_STORAGE_KEY, fresh);
    return fresh;
  });
  const [sessions, setSessions] = useState<PetSessionSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [petApiKey, setPetApiKey] = useState<string>("");

  const persistPetMessage = useCallback(
    async (
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
    },
    [],
  );

  const refreshPetState = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/v1/pet/state"), { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as PetStateResponse;
      if (data.selected_pet_id) {
        options.onPetIdSync?.(data.selected_pet_id);
        localStorage.setItem(PET_STORAGE_KEY, data.selected_pet_id);
      }
      if (data.pet_api_key) {
        setPetApiKey(data.pet_api_key);
      }
      if (typeof data.docked === "boolean") {
        options.onDockedSync?.(data.docked);
      }
      setSessions(data.sessions || []);
      if (data.active_session_id) {
        setSessionId(data.active_session_id);
        localStorage.setItem(SESSION_STORAGE_KEY, data.active_session_id);
        const activeSession = data.sessions.find((s) => s.session_id === data.active_session_id);
        if (activeSession?.title) {
          options.onTitleSync?.(activeSession.title);
        }
        if (activeSession?.model) {
          options.onModelSync?.(activeSession.model);
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
  }, [options]);

  return {
    sessionId,
    setSessionId,
    sessions,
    setSessions,
    messages,
    setMessages,
    petApiKey,
    setPetApiKey,
    persistPetMessage,
    refreshPetState,
  };
}
