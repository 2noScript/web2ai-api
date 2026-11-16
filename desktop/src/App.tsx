import { useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  Activity,
  Check,
  Copy,
  Edit2,
  ExternalLink,
  KeyRound,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  Send,
  PawPrint,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { AppFrame } from "@/components/app-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { apiUrl, openApiDocs } from "@/lib/api";
import {
  PET_CATALOG,
  PET_STORAGE_KEY,
  PetSprite,
  getSavedPetId,
  type PetId,
  type PetStatus,
} from "@/components/pet-sprite";

type ProviderType = "deepseek" | "gemini" | "metaai";
type NavTab = "profiles" | "keys" | "playground" | "pets";

interface HealthStatus {
  status: string;
  backend?: string;
  deepseek_active_profiles: number;
  gemini_active_profiles: number;
  metaai_active_profiles: number;
}

interface Profile {
  id: string;
  type: ProviderType;
  name: string;
  token?: string | null;
  cookie?: string | null;
  is_active: boolean;
  total_requests: number;
  created_at: string;
  updated_at: string;
}

interface ApiKeyItem {
  key: string;
  name: string;
  is_active: boolean;
  created_at: string;
  last_used: string;
}

interface TestResult {
  status: "ok" | "error";
  latencyMs: number;
  content: string;
  rawJson?: unknown;
}

const PROVIDER_MODELS: Record<ProviderType, string[]> = {
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  gemini: ["gemini-3-flash", "gemini-3-pro", "gemini-3-flash-thinking"],
  metaai: ["meta-ai", "llama-3.3-70b", "meta-imagine"],
};

const PROVIDER_LABELS: Record<ProviderType, string> = {
  deepseek: "DeepSeek",
  gemini: "Gemini",
  metaai: "Meta AI",
};

const PROVIDER_LOGOS: Record<ProviderType, string> = {
  deepseek: "/providers/deepseek.svg",
  gemini: "/providers/gemini.svg",
  metaai: "/providers/metaai.svg",
};

function maskSecret(val?: string | null): string {
  if (!val) return "—";
  if (val.length <= 14) return "••••••••";
  return `${val.slice(0, 8)}••••${val.slice(-4)}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>("profiles");
  const [providerFilter, setProviderFilter] = useState<"all" | ProviderType>("all");

  // Pet Store state
  const [selectedPetId, setSelectedPetId] = useState<PetId>(() => getSavedPetId());
  const [previewPetStatus, setPreviewPetStatus] = useState<PetStatus>("idle");
  const [appVersion, setAppVersion] = useState("0.1.1");
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [hasAvailableUpdate, setHasAvailableUpdate] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [serverToggling, setServerToggling] = useState(false);

  const handleToggleServer = async () => {
    setServerToggling(true);
    try {
      const isOnline = health?.status === "ok";
      const status = await invoke<{ running: boolean }>(
        isOnline ? "stop_backend" : "start_backend",
      );
      if (status.running) {
        const res = await fetch(apiUrl("/health"));
        if (res.ok) {
          setHealth((await res.json()) as HealthStatus);
        }
      } else {
        setHealth(null);
      }
    } catch {
      // Ignore outside Tauri
    } finally {
      setServerToggling(false);
    }
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateStatus("Checking...");
    try {
      const update = await check();
      if (update) {
        setUpdateStatus(`Downloading v${update.version}...`);
        await update.downloadAndInstall();
        setUpdateStatus(`Restarting to v${update.version}...`);
        await relaunch();
      } else {
        setUpdateStatus("Up to date");
      }
    } catch {
      setUpdateStatus("No release feed yet");
    } finally {
      setCheckingUpdate(false);
    }
  };

  useEffect(() => {
    getVersion()
      .then((v) => setAppVersion(v))
      .catch(() => {});

    const updateTimer = window.setTimeout(() => {
      check()
        .then((update) => {
          if (update) {
            setHasAvailableUpdate(true);
            setUpdateStatus(`Update v${update.version} available`);
          }
        })
        .catch(() => {});
    }, 2000);

    fetch(apiUrl("/v1/pet/state"))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.selected_pet_id) {
          setSelectedPetId(data.selected_pet_id as PetId);
          localStorage.setItem(PET_STORAGE_KEY, data.selected_pet_id);
        }
      })
      .catch(() => {});

    return () => window.clearTimeout(updateTimer);
  }, []);

  const handleSelectPet = async (petId: PetId) => {
    setSelectedPetId(petId);
    localStorage.setItem(PET_STORAGE_KEY, petId);
    try {
      await fetch(apiUrl("/v1/pet/selected"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pet_id: petId }),
      });
    } catch {
      // Ignore if backend unreachable
    }
    try {
      await emit("pet:select", { petId });
    } catch {
      // Ignore outside Tauri
    }
  };

  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);

  // Create / Edit Profile modal
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [formType, setFormType] = useState<ProviderType>("deepseek");
  const [formName, setFormName] = useState("");
  const [formToken, setFormToken] = useState("");
  const [formCookie, setFormCookie] = useState("");
  const [formSaving, setFormSaving] = useState(false);

  // Test Profile modal
  const [testingProfile, setTestingProfile] = useState<Profile | null>(null);
  const [testPrompt, setTestPrompt] = useState("Reply with exactly: OK");
  const [testModel, setTestModel] = useState("deepseek-chat");
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // API Keys
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // Playground
  const [pgProvider, setPgProvider] = useState<ProviderType>("deepseek");
  const [pgModel, setPgModel] = useState("deepseek-chat");
  const [pgStream, setPgStream] = useState(true);
  const [pgPrompt, setPgPrompt] = useState("");
  const [pgSessionId, setPgSessionId] = useState("");
  const [pgRunning, setPgRunning] = useState(false);
  const [pgOutput, setPgOutput] = useState("");
  const [pgReasoning, setPgReasoning] = useState("");
  const [pgError, setPgError] = useState<string | null>(null);

  const fetchHealth = async (): Promise<boolean> => {
    try {
      const res = await fetch(apiUrl("/health"));
      if (!res.ok) return false;
      setHealth(await res.json());
      return true;
    } catch {
      setHealth(null);
      return false;
    }
  };

  const fetchProfiles = async () => {
    try {
      const res = await fetch(apiUrl("/v1/profiles"));
      if (res.ok) {
        const data = await res.json();
        setProfiles(data.profiles ?? []);
      }
    } catch {
      // ignore
    }
  };

  const fetchKeys = async () => {
    try {
      const res = await fetch(apiUrl("/v1/keys"));
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys ?? []);
      }
    } catch {
      // ignore
    }
  };

  const refreshAll = async () => {
    await Promise.all([fetchHealth(), fetchProfiles(), fetchKeys()]);
  };

  useEffect(() => {
    void refreshAll();
    const timer = setInterval(async () => {
      const ok = await fetchHealth();
      if (ok) {
        await Promise.all([fetchProfiles(), fetchKeys()]);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const filteredProfiles = useMemo(() => {
    if (providerFilter === "all") return profiles;
    return profiles.filter((p) => p.type === providerFilter);
  }, [profiles, providerFilter]);

  const openCreateModal = () => {
    setEditingProfile(null);
    setFormType("deepseek");
    setFormName("");
    setFormToken("");
    setFormCookie("");
    setProfileModalOpen(true);
  };

  const openEditModal = (p: Profile) => {
    setEditingProfile(p);
    setFormType(p.type);
    setFormName(p.name);
    setFormToken(p.token ?? "");
    setFormCookie(p.cookie ?? "");
    setProfileModalOpen(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSaving(true);
    try {
      if (editingProfile) {
        const res = await fetch(apiUrl(`/v1/profiles/${editingProfile.id}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName,
            token: formType === "deepseek" ? formToken || null : null,
            cookie: formType !== "deepseek" ? formCookie || null : null,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
      } else {
        const res = await fetch(apiUrl("/v1/profiles"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: formType,
            name: formName.trim() || `${PROVIDER_LABELS[formType]} Profile`,
            token: formType === "deepseek" ? formToken.trim() : null,
            cookie: formType !== "deepseek" ? formCookie.trim() : null,
            is_active: true,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
      }
      setProfileModalOpen(false);
      await refreshAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setFormSaving(false);
    }
  };

  const handleToggleActive = async (p: Profile) => {
    await fetch(apiUrl(`/v1/profiles/${p.id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !p.is_active }),
    });
    await refreshAll();
  };

  const handleDeleteProfile = async (p: Profile) => {
    if (!confirm(`Delete profile "${p.name}"?`)) return;
    await fetch(apiUrl(`/v1/profiles/${p.id}`), { method: "DELETE" });
    await refreshAll();
  };

  const openTestModal = (p: Profile) => {
    setTestingProfile(p);
    setTestModel(PROVIDER_MODELS[p.type][0]);
    setTestPrompt("Reply with exactly: OK");
    setTestResult(null);
  };

  const runProfileTest = async () => {
    if (!testingProfile) return;
    setTestRunning(true);
    setTestResult(null);
    const start = performance.now();
    try {
      const res = await fetch(apiUrl("/v1/chat/completions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `${testingProfile.type}:${testModel}`,
          messages: [{ role: "user", content: testPrompt }],
          stream: false,
        }),
      });
      const latencyMs = Math.round(performance.now() - start);
      const data = await res.json();
      if (!res.ok) {
        setTestResult({
          status: "error",
          latencyMs,
          content: data?.error?.message || `HTTP ${res.status}`,
          rawJson: data,
        });
      } else {
        setTestResult({
          status: "ok",
          latencyMs,
          content: data?.choices?.[0]?.message?.content ?? "",
          rawJson: data,
        });
      }
    } catch (err) {
      setTestResult({
        status: "error",
        latencyMs: Math.round(performance.now() - start),
        content: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setTestRunning(false);
      await fetchProfiles();
    }
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(apiUrl("/v1/keys"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newKeyName }),
    });
    if (res.ok) {
      const data = await res.json();
      setCreatedKey(data.key);
      setNewKeyName("");
      await fetchKeys();
    }
  };

  const handleDeleteKey = async (keyId: string) => {
    if (!confirm("Delete this API key?")) return;
    const res = await fetch(apiUrl(`/v1/keys/${keyId}`), { method: "DELETE" });
    if (res.ok) await fetchKeys();
  };

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 1500);
  };

  const runPlayground = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pgPrompt.trim() || pgRunning) return;
    setPgRunning(true);
    setPgOutput("");
    setPgReasoning("");
    setPgError(null);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (pgSessionId.trim()) headers["X-Session-Id"] = pgSessionId.trim();

      const res = await fetch(apiUrl("/v1/chat/completions"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: `${pgProvider}:${pgModel}`,
          messages: [{ role: "user", content: pgPrompt }],
          stream: pgStream,
        }),
      });

      const returnedSid = res.headers.get("x-session-id");
      if (returnedSid) setPgSessionId(returnedSid);

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error?.message || `HTTP ${res.status}`);
      }

      if (!pgStream) {
        const data = await res.json();
        setPgOutput(data?.choices?.[0]?.message?.content ?? "");
        setPgReasoning(data?.choices?.[0]?.message?.reasoning_content ?? "");
      } else if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload === "[DONE]") break;
            try {
              const parsed = JSON.parse(payload);
              const delta = parsed?.choices?.[0]?.delta;
              if (delta?.content) setPgOutput((prev) => prev + delta.content);
              if (delta?.reasoning_content) setPgReasoning((prev) => prev + delta.reasoning_content);
              if (parsed?.error?.message) setPgError(parsed.error.message);
            } catch {
              // ignore partial frame
            }
          }
        }
      }
    } catch (err) {
      setPgError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setPgRunning(false);
    }
  };

  const titlebarActions = (
    <>
      <Button
        variant="ghost"
        size="xs"
        className="gap-1.5 px-2 text-[11px]"
        onClick={() => void invoke("enter_pet_only_mode").catch(() => {})}
        title="Hide main window and keep only Floating Pet"
      >
        <PawPrint className="h-4 w-4 text-primary" />
        <span>Pet Only</span>
      </Button>
      <Button
        variant="secondary"
        size="xs"
        className="gap-1 px-2 text-[11px]"
        onClick={() => void openApiDocs()}
      >
        <span>API Docs</span>
        <ExternalLink className="h-3 w-3" />
      </Button>
    </>
  );

  return (
    <AppFrame title="Web2AI API" actions={titlebarActions}>
      <div className="flex h-full w-full overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar p-3">
          <div className="mb-4 flex items-center gap-3 px-1.5 py-1">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-card/90 p-1 shadow-[0_0_20px_-6px_rgba(54,181,186,0.45)]">
              <img
                src="/logo.png"
                alt="Web2AI API"
                className="h-full w-full object-contain drop-shadow-[0_2px_6px_rgba(54,181,186,0.3)]"
              />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-sidebar-foreground">
                Web2AI API
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-1">
            <button
              type="button"
              onClick={() => setActiveTab("profiles")}
              className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
                activeTab === "profiles"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <span className="flex items-center gap-2">
                <Users className="h-3.5 w-3.5" />
                Profiles
              </span>
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                {profiles.length}
              </Badge>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("keys")}
              className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
                activeTab === "keys"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <span className="flex items-center gap-2">
                <KeyRound className="h-3.5 w-3.5" />
                API Keys
              </span>
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                {keys.length}
              </Badge>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("playground")}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
                activeTab === "playground"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Playground
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("pets")}
              className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
                activeTab === "pets"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <span className="flex items-center gap-2">
                <PawPrint className="h-4 w-4" />
                Pet Store
              </span>
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                {PET_CATALOG.length}
              </Badge>
            </button>
          </nav>

          {/* Gateway Status Footer */}
          <div className="mt-auto rounded-lg border border-border bg-card p-3 text-xs">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <Activity className="h-3.5 w-3.5 text-primary" />
                Gateway
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                    health?.status === "ok" ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      health?.status === "ok" ? "bg-primary" : "bg-muted-foreground"
                    }`}
                  />
                  {health?.status === "ok" ? "Online" : "Offline"}
                </span>
                <Switch
                  size="sm"
                  checked={health?.status === "ok"}
                  disabled={serverToggling}
                  onCheckedChange={() => void handleToggleServer()}
                  title={health?.status === "ok" ? "Stop Server (:8088)" : "Start Server (:8088)"}
                />
              </div>
            </div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <div className="flex justify-between">
                <span>DeepSeek</span>
                <span className="font-mono text-foreground">
                  {health?.deepseek_active_profiles ?? 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Gemini</span>
                <span className="font-mono text-foreground">
                  {health?.gemini_active_profiles ?? 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Meta AI</span>
                <span className="font-mono text-foreground">
                  {health?.metaai_active_profiles ?? 0}
                </span>
              </div>
            </div>
            <div className="mt-2.5 border-t border-border/60 pt-2">
              <button
                type="button"
                disabled={checkingUpdate}
                onClick={() => void handleCheckUpdate()}
                className={`flex w-full items-center justify-between text-[11px] transition-colors disabled:opacity-50 ${
                  hasAvailableUpdate
                    ? "font-medium text-primary hover:text-primary/80"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <RefreshCw className={`h-3 w-3 ${checkingUpdate ? "animate-spin" : ""}`} />
                  {updateStatus ?? "Check for Updates"}
                </span>
                <span className="font-mono text-[10px]">v{appVersion}</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Main Workspace */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden p-6">
          {activeTab === "profiles" && (
            <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-lg font-semibold tracking-tight">Provider Profiles</h1>
                  <p className="text-xs text-muted-foreground">
                    Manage DeepSeek tokens, Gemini &amp; Meta AI cookies for Round-Robin load balancing.
                  </p>
                </div>
                <Button size="sm" onClick={openCreateModal} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Add Profile
                </Button>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {(["all", "deepseek", "gemini", "metaai"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setProviderFilter(tab)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      providerFilter === tab
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground hover:bg-accent"
                    }`}
                  >
                    {tab !== "all" && (
                      <img
                        src={PROVIDER_LOGOS[tab]}
                        alt={PROVIDER_LABELS[tab]}
                        className="h-3.5 w-3.5 shrink-0"
                      />
                    )}
                    {tab === "all" ? "All" : PROVIDER_LABELS[tab]}
                  </button>
                ))}
              </div>

              <Card className="min-h-0 flex-1 overflow-hidden py-0">
                <CardContent className="h-full p-0">
                  <Table containerClassName="h-full overflow-auto">
                    <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-b-0">
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead>Credential</TableHead>
                        <TableHead>Requests</TableHead>
                        <TableHead>Active</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredProfiles.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="py-10 text-center text-xs text-muted-foreground">
                            No profiles yet. Click &ldquo;Add Profile&rdquo; to add credentials.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredProfiles.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="font-medium text-xs">{p.name}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="gap-1.5 text-[11px]">
                                {PROVIDER_LOGOS[p.type] && (
                                  <img
                                    src={PROVIDER_LOGOS[p.type]}
                                    alt={PROVIDER_LABELS[p.type] ?? p.type}
                                    className="h-3.5 w-3.5 shrink-0"
                                  />
                                )}
                                {PROVIDER_LABELS[p.type] ?? p.type}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-[11px] text-muted-foreground">
                              {maskSecret(p.type === "deepseek" ? p.token : p.cookie)}
                            </TableCell>
                            <TableCell className="font-mono text-xs">{p.total_requests}</TableCell>
                            <TableCell>
                              <Switch
                                size="sm"
                                checked={p.is_active}
                                onCheckedChange={() => void handleToggleActive(p)}
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="inline-flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  title="Test Profile"
                                  onClick={() => openTestModal(p)}
                                >
                                  <Play className="h-3.5 w-3.5 text-primary" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  title="Edit"
                                  onClick={() => openEditModal(p)}
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  title="Delete"
                                  onClick={() => void handleDeleteProfile(p)}
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === "keys" && (
            <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4">
              <div className="shrink-0">
                <h1 className="text-lg font-semibold tracking-tight">API Keys</h1>
                <p className="text-xs text-muted-foreground">
                  Generate Bearer tokens for external clients calling <code>http://127.0.0.1:8088</code>.
                </p>
              </div>

              <Card className="shrink-0">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Create New Key</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCreateKey} className="flex gap-2">
                    <Input
                      placeholder="Friendly key name (e.g. cursor-local)"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      className="h-8 text-xs"
                    />
                    <Button type="submit" size="sm" className="shrink-0 gap-1.5">
                      <Plus className="h-3.5 w-3.5" />
                      Generate
                    </Button>
                  </form>

                  {createdKey && (
                    <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs">
                      <code className="truncate font-mono text-foreground">{createdKey}</code>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="shrink-0 gap-1"
                        onClick={() => void copyText(createdKey)}
                      >
                        {copiedKey ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copiedKey ? "Copied" : "Copy"}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="min-h-0 flex-1 overflow-hidden py-0">
                <CardContent className="h-full p-0">
                  <Table containerClassName="h-full overflow-auto">
                    <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-b-0">
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Key</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {keys.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                            No API keys created yet.
                          </TableCell>
                        </TableRow>
                      ) : (
                        keys.map((k) => (
                          <TableRow key={k.key}>
                            <TableCell className="text-xs font-medium">{k.name}</TableCell>
                            <TableCell className="font-mono text-[11px] text-muted-foreground">
                              {maskSecret(k.key)}
                            </TableCell>
                            <TableCell>
                              <Badge variant={k.is_active ? "default" : "secondary"} className="text-[10px]">
                                {k.is_active ? "Active" : "Revoked"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-[11px] text-muted-foreground">
                              {k.created_at.slice(0, 19).replace("T", " ")}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => void handleDeleteKey(k.key)}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === "playground" && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-4xl space-y-5">
              <div>
                <h1 className="text-lg font-semibold tracking-tight">API Playground</h1>
                <p className="text-xs text-muted-foreground">
                  Test OpenAI-compatible completions directly against the Rust gateway.
                </p>
              </div>

              <Card>
                <CardContent className="space-y-4 pt-5">
                  <form onSubmit={runPlayground} className="space-y-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                          Provider
                        </label>
                        <select
                          value={pgProvider}
                          onChange={(e) => {
                            const next = e.target.value as ProviderType;
                            setPgProvider(next);
                            setPgModel(PROVIDER_MODELS[next][0]);
                          }}
                          className="h-8 w-full rounded-md border border-border bg-input px-2.5 text-xs text-foreground outline-none"
                        >
                          <option value="deepseek">DeepSeek</option>
                          <option value="gemini" disabled className="text-muted-foreground/45">
                            Gemini (Coming soon)
                          </option>
                          <option value="metaai" disabled className="text-muted-foreground/45">
                            Meta AI (Coming soon)
                          </option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                          Model
                        </label>
                        <select
                          value={pgModel}
                          onChange={(e) => setPgModel(e.target.value)}
                          className="h-8 w-full rounded-md border border-border bg-input px-2.5 text-xs text-foreground outline-none"
                        >
                          {PROVIDER_MODELS[pgProvider].map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                          X-Session-Id (optional)
                        </label>
                        <Input
                          value={pgSessionId}
                          onChange={(e) => setPgSessionId(e.target.value)}
                          placeholder="Auto-assigned on first turn"
                          className="h-8 font-mono text-xs"
                        />
                      </div>
                    </div>

                    <Textarea
                      rows={3}
                      placeholder="Enter a prompt..."
                      value={pgPrompt}
                      onChange={(e) => setPgPrompt(e.target.value)}
                      className="text-xs"
                    />

                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Switch checked={pgStream} onCheckedChange={setPgStream} />
                        <span>SSE Streaming</span>
                      </label>
                      <Button type="submit" size="sm" disabled={pgRunning} className="gap-1.5">
                        <Send className="h-3.5 w-3.5" />
                        {pgRunning ? "Generating..." : "Send Request"}
                      </Button>
                    </div>
                  </form>

                  {pgError && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                      {pgError}
                    </div>
                  )}

                  {pgReasoning && (
                    <div className="rounded-md border border-border bg-secondary/50 p-3">
                      <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
                        Reasoning
                      </div>
                      <pre className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                        {pgReasoning}
                      </pre>
                    </div>
                  )}

                  {pgOutput && (
                    <div className="rounded-md border border-border bg-input p-3">
                      <div className="mb-1 text-[11px] font-semibold text-primary">Response</div>
                      <pre className="whitespace-pre-wrap text-xs text-foreground">{pgOutput}</pre>
                    </div>
                  )}
                </CardContent>
              </Card>
              </div>
            </div>
          )}

          {/* PET STORE TAB */}
          {activeTab === "pets" && (
            <div className="flex h-full min-h-0 flex-col gap-4">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold tracking-tight">Pet Store</h2>
                  <p className="text-xs text-muted-foreground">
                    Choose your floating desktop pet companion.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-card p-0.5 text-[11px]">
                    {(
                      [
                        "idle",
                        "happy",
                        "wink",
                        "shy",
                        "annoyed",
                        "typing",
                        "thinking",
                        "waiting",
                        "streaming",
                        "done",
                        "error",
                      ] as PetStatus[]
                    ).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setPreviewPetStatus(st)}
                        className={`rounded px-2 py-1 capitalize transition-colors ${
                          previewPetStatus === st
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => void invoke("summon_pet_window").catch(() => {})}
                  >
                    <PawPrint className="h-4 w-4" />
                    Bring Pet Here
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => void invoke("toggle_pet_window").catch(() => {})}
                  >
                    Show / Hide Pet
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {PET_CATALOG.map((pet) => {
                    const isEquipped = selectedPetId === pet.id;
                    return (
                      <Card
                        key={pet.id}
                        className={`flex flex-col justify-between transition-colors ${
                          isEquipped ? "border-primary/70 bg-primary/5" : "hover:border-border/80"
                        }`}
                      >
                        <CardHeader className="pb-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <CardTitle className="text-sm">{pet.name}</CardTitle>
                              <CardDescription className="text-[11px]">{pet.badge}</CardDescription>
                            </div>
                            {isEquipped && (
                              <Badge variant="default" className="h-5 gap-1 px-1.5 text-[10px]">
                                <Check className="h-3 w-3" />
                                Equipped
                              </Badge>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="flex flex-col items-center gap-3 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              void handleSelectPet(pet.id);
                              void invoke("summon_pet_window").catch(() => {});
                            }}
                            title="Click to equip & summon pet to app window"
                            className="flex h-28 w-full cursor-pointer items-center justify-center rounded-lg border border-border/60 bg-secondary/40 transition-colors hover:border-primary/60 hover:bg-secondary/70"
                          >
                            <PetSprite petId={pet.id} status={previewPetStatus} size="lg" />
                          </button>
                          <p className="text-center text-xs text-muted-foreground">
                            {pet.tagline}
                          </p>
                          <Button
                            size="sm"
                            variant={isEquipped ? "secondary" : "default"}
                            className="h-7 w-full text-xs"
                            onClick={() => {
                              void handleSelectPet(pet.id);
                              void invoke("summon_pet_window").catch(() => {});
                            }}
                          >
                            {isEquipped ? "Equipped · Bring Here" : "Equip & Summon"}
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Create / Edit Profile Modal */}
      {profileModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-sm">
                  {editingProfile ? "Edit Profile" : "Add Profile"}
                </CardTitle>
                <CardDescription className="text-xs">
                  Credentials are stored locally on your device.
                </CardDescription>
              </div>
              <Button variant="ghost" size="icon-xs" onClick={() => setProfileModalOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveProfile} className="space-y-3">
                {!editingProfile && (
                  <div>
                    <label className="mb-1 block text-xs font-medium">Provider</label>
                    <select
                      value={formType}
                      onChange={(e) => setFormType(e.target.value as ProviderType)}
                      className="h-8 w-full rounded-md border border-border bg-input px-2.5 text-xs outline-none"
                    >
                      <option value="deepseek">DeepSeek</option>
                      <option value="gemini">Gemini</option>
                      <option value="metaai">Meta AI</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs font-medium">Profile Name</label>
                  <Input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. account@gmail.com"
                    className="h-8 text-xs"
                    required
                  />
                </div>

                {formType === "deepseek" ? (
                  <div>
                    <label className="mb-1 block text-xs font-medium">Authorization Token</label>
                    <Textarea
                      rows={3}
                      value={formToken}
                      onChange={(e) => setFormToken(e.target.value)}
                      placeholder="Bearer eyJ..."
                      className="font-mono text-xs"
                      required
                    />
                  </div>
                ) : (
                  <div>
                    <label className="mb-1 block text-xs font-medium">Cookie String</label>
                    <Textarea
                      rows={3}
                      value={formCookie}
                      onChange={(e) => setFormCookie(e.target.value)}
                      placeholder="Full cookie header..."
                      className="font-mono text-xs"
                      required
                    />
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setProfileModalOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={formSaving}>
                    {formSaving ? "Saving..." : "Save"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Test Profile Modal */}
      {testingProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card className="w-full max-w-lg">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-sm">Test: {testingProfile.name}</CardTitle>
                <CardDescription className="text-xs">
                  {PROVIDER_LABELS[testingProfile.type]} &middot; {testingProfile.type}:{testModel}
                </CardDescription>
              </div>
              <Button variant="ghost" size="icon-xs" onClick={() => setTestingProfile(null)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Model</label>
                <select
                  value={testModel}
                  onChange={(e) => setTestModel(e.target.value)}
                  className="h-8 w-full rounded-md border border-border bg-input px-2.5 text-xs outline-none"
                >
                  {PROVIDER_MODELS[testingProfile.type].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium">Prompt</label>
                <Textarea
                  rows={2}
                  value={testPrompt}
                  onChange={(e) => setTestPrompt(e.target.value)}
                  className="text-xs"
                />
              </div>

              {testResult && (
                <div
                  className={`rounded-md border p-3 text-xs ${
                    testResult.status === "ok"
                      ? "border-primary/40 bg-primary/10"
                      : "border-destructive/40 bg-destructive/10 text-destructive"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between font-medium">
                    <span>{testResult.status === "ok" ? "Success" : "Error"}</span>
                    <span className="font-mono text-[11px]">{testResult.latencyMs} ms</span>
                  </div>
                  <pre className="whitespace-pre-wrap font-mono text-xs">{testResult.content}</pre>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" size="sm" onClick={() => setTestingProfile(null)}>
                  Close
                </Button>
                <Button size="sm" onClick={() => void runProfileTest()} disabled={testRunning}>
                  {testRunning ? "Testing..." : "Run Test"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </AppFrame>
  );
}
