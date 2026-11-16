import Image from "next/image";
import {
  Cpu,
  Database,
  ExternalLink,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DownloadsGrid,
  HeroDownloadAction,
} from "@/components/download-section";
import { PetPreview } from "@/components/pet-preview";
import { REPO_URL } from "@/lib/releases";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const FEATURES = [
  {
    icon: Terminal,
    title: "OpenAI-Compatible Local Gateway",
    description:
      "Drop-in /v1/chat/completions and /v1/models on http://127.0.0.1:8088 with SSE streaming, reasoning_content, and X-Session-Id continuity.",
  },
  {
    icon: RefreshCw,
    title: "Round-Robin Profile Load Balancing",
    description:
      "Register multiple DeepSeek tokens and rotate requests automatically with cooldown handling on auth or rate-limit errors.",
  },
  {
    icon: Sparkles,
    title: "Interactive Floating Desktop Pet",
    description:
      "Codex-inspired always-on-top pixel companion with 5 customizable pets, instruments, 11 reactive expressions, and instant quick chat.",
  },
  {
    icon: Database,
    title: "SQLite Persistence via Diesel",
    description:
      "Profiles, API keys, virtual chat sessions, Pet Store selection, and pet chat history are stored locally in SQLite.",
  },
  {
    icon: KeyRound,
    title: "Local API Keys & Playground",
    description:
      "Create and revoke local sk-... access keys and test streaming or multi-turn chats directly from the built-in Playground.",
  },
  {
    icon: ShieldCheck,
    title: "Rust Core & Signed Auto-Updates",
    description:
      "Embedded Axum + Tokio server inside a lightweight Tauri v2 desktop app with one-click signed updates from GitHub Releases.",
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 border-b border-border bg-muted/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <a href="#" className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-card p-1 shadow-sm">
              <Image
                src={`${BASE_PATH}/logo.png`}
                alt="Web2AI API"
                width={36}
                height={36}
                priority
                className="size-8 rounded-lg object-contain"
              />
            </div>
            <span className="text-base font-semibold tracking-tight">Web2AI API</span>
          </a>
          <nav className="flex items-center gap-5 text-xs text-muted-foreground">
            <a href="#features" className="transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#quickstart" className="transition-colors hover:text-foreground">
              Quick Start
            </a>
            <a href="#downloads" className="transition-colors hover:text-foreground">
              Download
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-foreground transition-colors hover:bg-secondary"
            >
              GitHub
              <ExternalLink className="h-3 w-3" />
            </a>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="mx-auto max-w-5xl px-6 pt-16 pb-14">
          <div className="flex flex-col-reverse items-start justify-between gap-8 md:flex-row md:items-center md:gap-12">
            <div className="flex flex-col items-start gap-6">
              <Badge className="gap-1.5">
                <Cpu className="h-3 w-3" />
                Rust + Tauri v2 · Open Source
              </Badge>
              <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
                Turn DeepSeek into an{" "}
                <span className="text-primary">OpenAI-Compatible</span> Local Gateway
              </h1>
              <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
                Web2AI API Desktop bundles an embedded Rust Axum server, Diesel SQLite persistence,
                multi-profile load balancing, and a floating Codex-style Desktop Pet in a single
                native app.
              </p>
              <HeroDownloadAction />
            </div>

            <div className="shrink-0">
              <div className="relative flex size-28 items-center justify-center rounded-3xl border border-primary/35 bg-card/90 p-3 shadow-[0_0_50px_-12px_rgba(54,181,186,0.45)] sm:size-36 sm:p-4">
                <Image
                  src={`${BASE_PATH}/logo.png`}
                  alt="Web2AI API App Logo"
                  width={128}
                  height={128}
                  priority
                  className="size-full object-contain drop-shadow-[0_4px_16px_rgba(54,181,186,0.28)]"
                />
              </div>
            </div>
          </div>

          {/* Code & Pet Preview Card */}
          <div className="mt-12 grid grid-cols-1 gap-4 rounded-2xl border border-border bg-muted/60 p-5 md:grid-cols-5">
            <div className="flex flex-col justify-between rounded-xl border border-border bg-background p-4 md:col-span-3">
              <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-mono">POST http://127.0.0.1:8088/v1/chat/completions</span>
                <Badge variant="secondary">SSE Stream</Badge>
              </div>
              <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-foreground/90">
{`curl http://127.0.0.1:8088/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "X-Session-Id: my-thread-1" \\
  -d '{
    "model": "deepseek:deepseek-chat",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'`}
              </pre>
            </div>
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card p-5 text-center md:col-span-2">
              <PetPreview />
              <div>
                <div className="text-sm font-semibold">Floating Desktop Pet</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  5 pixel-art companions (Guitarist Fox, Vocalist Bot, Flutist Neko, Maestro Owl,
                  Drummer Shiba) with live chat &amp; SQLite history.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Screenshots Showcase */}
        <section id="screenshots" className="mx-auto max-w-5xl px-6 py-12">
          <div className="mb-8">
            <h2 className="text-2xl font-bold tracking-tight">Inside Web2AI API Desktop</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage provider profiles, test completions in the Playground, or chat directly from
              the floating Desktop Pet.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-muted-foreground">
                Provider Profiles &amp; Load Balancing
              </div>
              <Image
                src={`${BASE_PATH}/images/app-main.png`}
                alt="Web2AI API Provider Profiles"
                width={1240}
                height={820}
                className="w-full object-cover"
              />
            </div>
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-muted-foreground">
                API Playground
              </div>
              <Image
                src={`${BASE_PATH}/images/app-chat.png`}
                alt="Web2AI API Playground"
                width={1240}
                height={820}
                className="w-full object-cover"
              />
            </div>
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-muted-foreground">
                Pet Store — 5 Pixel-Art Companions
              </div>
              <Image
                src={`${BASE_PATH}/images/app-pets.png`}
                alt="Web2AI Pet Store"
                width={1240}
                height={820}
                className="w-full object-cover"
              />
            </div>
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-muted-foreground">
                Floating Desktop Pet &amp; Quick Chat
              </div>
              <div className="flex justify-center bg-[#121316] p-2">
                <Image
                  src={`${BASE_PATH}/images/pet-chat.png`}
                  alt="Web2AI Floating Desktop Pet Chat"
                  width={600}
                  height={660}
                  className="max-h-[340px] w-auto object-contain"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section id="features" className="mx-auto max-w-5xl px-6 py-12">
          <div className="mb-8">
            <h2 className="text-2xl font-bold tracking-tight">Built for Local AI Workflows</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Everything runs locally on your machine with zero Python runtime required.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <Card key={f.title}>
                  <CardHeader>
                    <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <CardTitle className="text-sm">{f.title}</CardTitle>
                    <CardDescription className="pt-1 text-xs leading-relaxed">
                      {f.description}
                    </CardDescription>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Quick Start */}
        <section id="quickstart" className="mx-auto max-w-5xl px-6 py-12">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold">Use with any OpenAI SDK</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Point <code className="font-mono text-foreground">base_url</code> to{" "}
              <code className="font-mono text-primary">http://127.0.0.1:8088/v1</code> in Cursor,
              Continue, OpenCode, or your own scripts.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-background p-4 font-mono text-xs text-foreground/90">
{`from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8088/v1", api_key="local")
resp = client.chat.completions.create(
    model="deepseek:deepseek-reasoner",
    messages=[{"role": "user", "content": "Explain Rust lifetimes simply."}],
)
print(resp.choices[0].message.content)`}
            </pre>
          </div>
        </section>

        {/* Downloads */}
        <section id="downloads" className="mx-auto max-w-5xl px-6 py-12">
          <div className="mb-8">
            <h2 className="text-2xl font-bold tracking-tight">Download Web2AI API</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Automated multi-platform builds published via GitHub Releases with built-in auto-updates.
            </p>
          </div>
          <DownloadsGrid />
        </section>
      </main>

      <footer className="border-t border-border bg-muted/40 py-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 text-xs text-muted-foreground">
          <span>Web2AI API Desktop · Built with Rust, Tauri v2 &amp; React</span>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            github.com/2noScript/web2ai-api
          </a>
        </div>
      </footer>
    </div>
  );
}
