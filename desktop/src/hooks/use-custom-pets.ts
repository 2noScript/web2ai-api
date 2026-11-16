import { useCallback, useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { apiUrl } from "@/lib/api";
import type { PetId } from "@/components/pet-sprite";
import { getPetPersona } from "@/lib/pet-personas";

export type SkillPresetId = "reviewer" | "translator" | "debugger" | "summarizer" | "custom";

export interface SkillPreset {
  id: SkillPresetId;
  label: string;
  prompt: string;
}

export const SKILL_PRESETS: SkillPreset[] = [
  {
    id: "reviewer",
    label: "Code Reviewer",
    prompt:
      "You are an expert senior code reviewer. Focus on bugs, edge cases, security issues, and concrete refactoring suggestions with concise code examples.",
  },
  {
    id: "translator",
    label: "Translator (EN ↔ VI)",
    prompt:
      "You are a natural, accurate bilingual translator (English ↔ Vietnamese). Preserve technical terms and formatting while keeping phrasing smooth and idiomatic.",
  },
  {
    id: "debugger",
    label: "Bug Hunter",
    prompt:
      "You are a systematic debugging assistant. Identify root causes from stack traces, logs, and snippets, then give step-by-step fixes.",
  },
  {
    id: "summarizer",
    label: "Quick Summarizer",
    prompt:
      "Summarize the user's text, document, or code into crisp bullet points highlighting key takeaways and action items.",
  },
  {
    id: "custom",
    label: "Custom Skill",
    prompt: "You are a helpful AI assistant tailored to the user's custom instructions.",
  },
];

export interface CustomPet {
  id: string;
  name: string;
  tagline: string;
  uiSprite: PetId;
  customAvatarUrl?: string;
  skillPreset: SkillPresetId;
  systemPrompt: string;
  defaultModel?: string;
}

const CUSTOM_PETS_STORAGE_KEY = "web2ai_custom_pets_v1";

function loadCustomPets(): CustomPet[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomPet[]) : [];
  } catch {
    return [];
  }
}

export function useCustomPets() {
  const [customPets, setCustomPets] = useState<CustomPet[]>(() => loadCustomPets());

  useEffect(() => {
    fetch(apiUrl("/v1/pet/custom"))
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (Array.isArray(res?.data) && res.data.length > 0) {
          const list = res.data as CustomPet[];
          setCustomPets(list);
          localStorage.setItem(CUSTOM_PETS_STORAGE_KEY, JSON.stringify(list));
        }
      })
      .catch(() => {});

    const sync = () => setCustomPets(loadCustomPets());
    const handleStorage = (e: StorageEvent) => {
      if (e.key === CUSTOM_PETS_STORAGE_KEY) sync();
    };
    window.addEventListener("storage", handleStorage);
    let unlisten: (() => void) | undefined;
    listen("pet:custom-sync", sync)
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      window.removeEventListener("storage", handleStorage);
      unlisten?.();
    };
  }, []);

  const saveAll = useCallback(async (next: CustomPet[]) => {
    setCustomPets(next);
    localStorage.setItem(CUSTOM_PETS_STORAGE_KEY, JSON.stringify(next));
    await fetch(apiUrl("/v1/pet/custom"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pets: next }),
    }).catch(() => {});
    await emit("pet:custom-sync", true).catch(() => {});
  }, []);

  const upsertCustomPet = useCallback(
    async (pet: CustomPet) => {
      const exists = customPets.some((p) => p.id === pet.id);
      const next = exists
        ? customPets.map((p) => (p.id === pet.id ? pet : p))
        : [...customPets, pet];
      await saveAll(next);
    },
    [customPets, saveAll],
  );

  const deleteCustomPet = useCallback(
    async (id: string) => {
      const next = customPets.filter((p) => p.id !== id);
      await saveAll(next);
    },
    [customPets, saveAll],
  );

  return { customPets, upsertCustomPet, deleteCustomPet };
}

export function resolvePetConfig(selectedId: string, customPets: CustomPet[]): {
  isCustom: boolean;
  name: string;
  uiSprite: PetId;
  customAvatarUrl?: string;
  systemPrompt: string;
  defaultModel?: string;
} {
  const found = customPets.find((p) => p.id === selectedId);
  if (found) {
    return {
      isCustom: true,
      name: found.name,
      uiSprite: found.uiSprite,
      customAvatarUrl: found.customAvatarUrl,
      systemPrompt: found.systemPrompt,
      defaultModel: found.defaultModel,
    };
  }
  const builtinId: PetId =
    selectedId === "fox" ||
    selectedId === "bot" ||
    selectedId === "cat" ||
    selectedId === "owl" ||
    selectedId === "shiba"
      ? selectedId
      : "fox";
  const persona = getPetPersona(builtinId);
  return {
    isCustom: false,
    name: persona.name,
    uiSprite: builtinId,
    systemPrompt: persona.systemPrompt,
  };
}
