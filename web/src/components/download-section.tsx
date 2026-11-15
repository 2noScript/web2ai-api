"use client";

import { useEffect, useState } from "react";
import { Apple, Download, ExternalLink, Monitor, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  RELEASES_LATEST_URL,
  detectVisitorPlatform,
  fetchLatestRelease,
  formatBytes,
  type LatestReleaseInfo,
  type PlatformKey,
} from "@/lib/releases";

const PLATFORM_CARDS: {
  key: PlatformKey;
  label: string;
  subtitle: string;
  ext: string;
  icon: typeof Apple;
}[] = [
  {
    key: "macos-arm64",
    label: "macOS (Apple Silicon)",
    subtitle: "M1 / M2 / M3 / M4 Macs",
    ext: ".dmg",
    icon: Apple,
  },
  {
    key: "macos-x64",
    label: "macOS (Intel)",
    subtitle: "x86_64 Macs",
    ext: ".dmg",
    icon: Apple,
  },
  {
    key: "windows",
    label: "Windows",
    subtitle: "Windows 10 & 11 (64-bit)",
    ext: ".msi / .exe",
    icon: Monitor,
  },
  {
    key: "linux-appimage",
    label: "Linux (AppImage)",
    subtitle: "Universal portable binary",
    ext: ".AppImage",
    icon: Terminal,
  },
  {
    key: "linux-deb",
    label: "Linux (Debian / Ubuntu)",
    subtitle: "x86_64 .deb package",
    ext: ".deb",
    icon: Terminal,
  },
];

export function HeroDownloadAction() {
  const [release, setRelease] = useState<LatestReleaseInfo | null>(null);
  const [platform, setPlatform] = useState<PlatformKey>("macos-arm64");

  useEffect(() => {
    setPlatform(detectVisitorPlatform());
    void fetchLatestRelease().then(setRelease);
  }, []);

  const matched = release?.assets[platform];
  const href = matched?.browser_download_url ?? release?.htmlUrl ?? RELEASES_LATEST_URL;
  const label =
    platform === "windows"
      ? "Download for Windows"
      : platform.startsWith("linux")
        ? "Download for Linux"
        : "Download for macOS";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        <Download className="h-4 w-4" />
        {label}
        {release?.tagName ? (
          <span className="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[11px]">
            {release.tagName}
          </span>
        ) : null}
      </a>
      <a
        href="#downloads"
        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
      >
        All Platforms
      </a>
    </div>
  );
}

export function DownloadsGrid() {
  const [release, setRelease] = useState<LatestReleaseInfo | null>(null);

  useEffect(() => {
    void fetchLatestRelease().then(setRelease);
  }, []);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {PLATFORM_CARDS.map((card) => {
        const asset = release?.assets[card.key];
        const sizeLabel = formatBytes(asset?.size);
        const Icon = card.icon;
        return (
          <Card key={card.key} className="flex flex-col justify-between">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <Badge variant="outline" className="font-mono text-[11px]">
                  {card.ext}
                </Badge>
              </div>
              <CardTitle className="pt-2 text-sm">{card.label}</CardTitle>
              <CardDescription className="text-xs">{card.subtitle}</CardDescription>
            </CardHeader>
            <CardContent>
              <a
                href={asset?.browser_download_url ?? release?.htmlUrl ?? RELEASES_LATEST_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border bg-secondary px-3 text-xs font-medium text-foreground transition-colors hover:border-primary/60 hover:bg-secondary/80"
              >
                <Download className="h-3.5 w-3.5" />
                {asset ? `Download (${sizeLabel ?? card.ext})` : "View on GitHub Releases"}
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
