import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "@/lib/api";
import {
  PET_STORAGE_KEY,
  getSavedPetId,
} from "@/components/pet-sprite";
import { petBridge, usePetBridgeEvents } from "@/hooks/use-pet-bridge";

export function useSelectedPet(options?: { syncFromServerOnMount?: boolean }) {
  const [petId, setPetId] = useState<string>(() => {
    const saved = localStorage.getItem(PET_STORAGE_KEY);
    return saved || getSavedPetId();
  });

  useEffect(() => {
    if (!options?.syncFromServerOnMount) return;
    fetch(apiUrl("/v1/pet/state"))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.selected_pet_id) {
          const next = String(data.selected_pet_id);
          setPetId(next);
          localStorage.setItem(PET_STORAGE_KEY, next);
        }
      })
      .catch(() => {});
  }, [options?.syncFromServerOnMount]);

  usePetBridgeEvents({
    onSelect: (nextPet) => {
      setPetId(nextPet);
      localStorage.setItem(PET_STORAGE_KEY, nextPet);
    },
  });

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === PET_STORAGE_KEY && e.newValue) {
        setPetId(e.newValue);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const selectPet = useCallback(async (nextPet: string) => {
    setPetId(nextPet);
    localStorage.setItem(PET_STORAGE_KEY, nextPet);
    try {
      await fetch(apiUrl("/v1/pet/selected"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pet_id: nextPet }),
      });
    } catch {
      // Ignore if backend unreachable
    }
    await petBridge.emitPetSelect(nextPet);
  }, []);

  return { petId, setPetId, selectPet };
}
