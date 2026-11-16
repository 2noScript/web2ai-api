import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { PetStatus } from "@/components/pet-sprite";

export interface PetHomeRectPayload {
  [key: string]: unknown;
  offsetX: number;
  offsetY: number;
  width?: number;
  height?: number;
}

export const petBridge = {
  summonPet(rect?: PetHomeRectPayload): Promise<boolean> {
    return invoke<boolean>("summon_pet_window", rect ?? {}).catch(() => false);
  },

  setPetHomeOffset(rect: PetHomeRectPayload): Promise<void> {
    return invoke<void>("set_pet_home_offset", rect).catch(() => {});
  },

  toggleMainWindow(): Promise<boolean> {
    return invoke<boolean>("toggle_main_window");
  },

  openMainWindow(): Promise<void> {
    return invoke<void>("open_main_window").catch(() => {});
  },

  isMainWindowVisible(): Promise<boolean> {
    return invoke<boolean>("is_main_window_visible").catch(() => false);
  },

  togglePetWindow(): Promise<boolean> {
    return invoke<boolean>("toggle_pet_window").catch(() => false);
  },

  enterPetOnlyMode(): Promise<void> {
    return invoke<void>("enter_pet_only_mode").catch(() => {});
  },

  emitPetSelect(petId: string): Promise<void> {
    return emit("pet:select", { petId }).catch(() => {});
  },

  readClipboardContext(): Promise<string> {
    return invoke<string>("read_clipboard_context").catch(() => "");
  },

  captureScreenSnip(): Promise<string | null> {
    return invoke<string | null>("capture_screen_snip").catch(() => null);
  },
};

interface UsePetBridgeEventsOptions {
  onStatus?: (payload: { status?: PetStatus; model?: string }) => void;
  onSelect?: (petId: string) => void;
  onDocked?: (docked: boolean) => void;
  onMainVisibility?: (visible: boolean) => void;
  onToggleQuickBar?: () => void;
}

export function usePetBridgeEvents(options: UsePetBridgeEventsOptions) {
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let disposed = false;

    const register = async <T,>(
      event: string,
      handler: (payload: T) => void,
    ) => {
      try {
        const unlisten = await listen<T>(event, (e) => handler(e.payload));
        if (disposed) {
          unlisten();
        } else {
          unlisteners.push(unlisten);
        }
      } catch {
        // Ignore outside Tauri
      }
    };

    void register<{ status?: PetStatus; model?: string }>("pet:status", (payload) => {
      callbacksRef.current.onStatus?.(payload);
    });
    void register<{ petId?: string }>("pet:select", (payload) => {
      if (payload?.petId) callbacksRef.current.onSelect?.(payload.petId);
    });
    void register<boolean>("pet:docked", (payload) => {
      callbacksRef.current.onDocked?.(Boolean(payload));
    });
    void register<boolean>("main_window_visibility", (payload) => {
      callbacksRef.current.onMainVisibility?.(Boolean(payload));
    });
    void register<unknown>("pet:toggle-quick-bar", () => {
      callbacksRef.current.onToggleQuickBar?.();
    });

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, []);
}
