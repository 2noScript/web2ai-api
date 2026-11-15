import { openUrl } from "@tauri-apps/plugin-opener";

export const DEFAULT_BACKEND_URL = "http://127.0.0.1:8088";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  if (isTauri() && import.meta.env.PROD) {
    return DEFAULT_BACKEND_URL;
  }
  return "";
}

export function apiUrl(path: string): string {
  const base = getApiBaseUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

export async function openApiDocs(): Promise<void> {
  if (isTauri()) {
    await openUrl(`${DEFAULT_BACKEND_URL}/docs`);
    return;
  }
  window.open("/docs", "_blank", "noreferrer");
}
