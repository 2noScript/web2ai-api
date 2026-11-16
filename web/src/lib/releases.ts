export type PlatformKey =
  | "macos-arm64"
  | "macos-x64"
  | "windows"
  | "linux-appimage"
  | "linux-deb";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
  download_count?: number;
}

export interface LatestReleaseInfo {
  tagName: string;
  htmlUrl: string;
  assets: Partial<Record<PlatformKey, ReleaseAsset>>;
  totalDownloads: number;
}

export const REPO_URL = "https://github.com/2noScript/web2ai-api";
export const RELEASES_LATEST_URL = `${REPO_URL}/releases/latest`;
const ALL_RELEASES_API_URL =
  "https://api.github.com/repos/2noScript/web2ai-api/releases?per_page=100";
const CACHE_KEY = "web2ai_releases_cache_v1";
const CACHE_TTL_MS = 5 * 60 * 1000;

interface GitHubReleaseItem {
  tag_name?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: ReleaseAsset[];
}

function isInstallerAsset(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.endsWith(".dmg") ||
    lower.endsWith(".msi") ||
    lower.endsWith("-setup.exe") ||
    lower.endsWith(".appimage") ||
    lower.endsWith(".deb") ||
    lower.endsWith(".rpm")
  );
}

export function matchAssetPlatform(filename: string): PlatformKey | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".dmg")) {
    if (lower.includes("aarch64") || lower.includes("arm64")) {
      return "macos-arm64";
    }
    return "macos-x64";
  }
  if (lower.endsWith(".msi") || lower.endsWith("-setup.exe")) {
    return "windows";
  }
  if (lower.endsWith(".appimage")) {
    return "linux-appimage";
  }
  if (lower.endsWith(".deb")) {
    return "linux-deb";
  }
  return null;
}

export function detectVisitorPlatform(): PlatformKey {
  if (typeof navigator === "undefined") return "macos-arm64";
  const ua = navigator.userAgent.toLowerCase();
  const platform =
    (
      navigator as Navigator & {
        userAgentData?: { platform?: string };
      }
    ).userAgentData?.platform?.toLowerCase() ??
    navigator.platform?.toLowerCase() ??
    "";

  if (ua.includes("win") || platform.includes("win")) {
    return "windows";
  }
  if (ua.includes("linux") || platform.includes("linux")) {
    return "linux-appimage";
  }
  return "macos-arm64";
}

let pendingReleaseFetch: Promise<LatestReleaseInfo | null> | null = null;

function readCachedRelease(): LatestReleaseInfo | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      timestamp?: number;
      data?: LatestReleaseInfo;
    };
    if (
      typeof parsed.timestamp === "number" &&
      Date.now() - parsed.timestamp < CACHE_TTL_MS &&
      parsed.data
    ) {
      return parsed.data;
    }
  } catch {
    // Ignore storage access or parse errors
  }
  return null;
}

function writeCachedRelease(data: LatestReleaseInfo): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ timestamp: Date.now(), data }),
    );
  } catch {
    // Ignore storage quota errors
  }
}

export async function fetchLatestRelease(): Promise<LatestReleaseInfo | null> {
  const cached = readCachedRelease();
  if (cached) return cached;

  if (pendingReleaseFetch) return pendingReleaseFetch;

  pendingReleaseFetch = (async () => {
    try {
      const res = await fetch(ALL_RELEASES_API_URL, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) return null;
      const releases = (await res.json()) as GitHubReleaseItem[];
      const published = releases.filter((r) => !r.draft);
      const latest =
        published.find((r) => !r.prerelease) ?? published[0] ?? releases[0];
      if (!latest) return null;

      let totalDownloads = 0;
      for (const rel of published) {
        for (const asset of rel.assets ?? []) {
          if (isInstallerAsset(asset.name)) {
            totalDownloads += asset.download_count ?? 0;
          }
        }
      }

      const assets: Partial<Record<PlatformKey, ReleaseAsset>> = {};
      for (const asset of latest.assets ?? []) {
        const key = matchAssetPlatform(asset.name);
        if (key && !assets[key]) {
          assets[key] = asset;
        }
      }

      const result: LatestReleaseInfo = {
        tagName: latest.tag_name ?? "v0.1.0",
        htmlUrl: latest.html_url ?? RELEASES_LATEST_URL,
        assets,
        totalDownloads,
      };
      writeCachedRelease(result);
      return result;
    } catch {
      return null;
    } finally {
      pendingReleaseFetch = null;
    }
  })();

  return pendingReleaseFetch;
}

export function formatBytes(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export function formatDownloadCount(count?: number): string | null {
  if (typeof count !== "number" || count < 0) return null;
  return new Intl.NumberFormat("en-US").format(count);
}
