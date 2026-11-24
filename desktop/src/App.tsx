import { useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  Activity,
  ExternalLink,
  KeyRound,
  MessageSquare,
  RefreshCw,
  ScrollText,
  Settings,
  PawPrint,
  Users,
  X,
} from "lucide-react";

import { AppFrame } from "@/components/app-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiUrl, openApiDocs } from "@/lib/api";
import { petBridge } from "@/hooks/use-pet-bridge";
import { useSelectedPet } from "@/hooks/use-selected-pet";
import { KeysTab, type ApiKeyItem } from "@/components/tabs/keys-tab";
import { LogsTab, type GatewayRequestLog } from "@/components/tabs/logs-tab";
import { PetStoreTab } from "@/components/tabs/pet-store-tab";
import {
  PlaygroundTab,
  PROVIDER_MODELS,
  type ProviderType,
} from "@/components/tabs/playground-tab";
import {
  ProfilesTab,
  PROVIDER_LABELS,
  type Profile,
} from "@/components/tabs/profiles-tab";
import { SettingsTab } from "@/components/tabs/settings-tab";
import { PET_CATALOG, type PetStatus } from "@/components/pet-sprite";

type NavTab = "profiles" | "keys" | "playground" | "logs" | "pets" | "settings";

interface HealthStatus {
  status: string;
  backend?: string;
  deepseek_active_profiles: number;
  gemini_active_profiles: number;
  metaai_active_profiles: number;
}

interface TestResult {
  status: "ok" | "error";
  latencyMs: number;
  content: string;
  rawJson?: unknown;
}

function maskSecret(val?: string | null): string {
  if (!val) return "—";
  if (val.length <= 14) return "••••••••";
  return `${val.slice(0, 8)}••••${val.slice(-4)}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>("profiles");
  const [providerFilter, setProviderFilter] = useState<"all" | ProviderType>("all");

  // Pet Store state
  const { petId: selectedPetId, selectPet: handleSelectPet } = useSelectedPet({
    syncFromServerOnMount: true,
  });
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

    return () => window.clearTimeout(updateTimer);
  }, []);

  const petHomeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const syncHomeOffset = () => {
      const rect = petHomeRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        void petBridge.setPetHomeOffset({
          offsetX: rect.left + rect.width / 2,
          offsetY: rect.top + rect.height / 2,
          width: rect.width,
          height: rect.height,
        });
      }
    };
    syncHomeOffset();
    const el = petHomeRef.current;
    const ro = el ? new ResizeObserver(syncHomeOffset) : null;
    if (el && ro) ro.observe(el);
    window.addEventListener("resize", syncHomeOffset);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", syncHomeOffset);
    };
  }, []);

  const summonPetToHome = () => {
    const rect = petHomeRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      void petBridge.summonPet({
        offsetX: rect.left + rect.width / 2,
        offsetY: rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
      });
      return;
    }
    void petBridge.summonPet();
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

  // Live Gateway Logs & Pet Traffic Reaction
  const [gatewayLogs, setGatewayLogs] = useState<GatewayRequestLog[]>([]);
  const [logFilter, setLogFilter] = useState<"all" | "ok" | "error">("all");
  const [petReactTraffic, setPetReactTraffic] = useState(true);

  useEffect(() => {
    fetch(apiUrl("/v1/gateway/logs"))
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (Array.isArray(res?.data)) {
          setGatewayLogs(res.data as GatewayRequestLog[]);
        }
      })
      .catch(() => {});

    fetch(apiUrl("/v1/pet/react-traffic"))
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (typeof res?.enabled === "boolean") {
          setPetReactTraffic(res.enabled);
        }
      })
      .catch(() => {});

    let unlisten: (() => void) | undefined;
    listen<GatewayRequestLog>("gateway:request", (event) => {
      if (!event.payload) return;
      setGatewayLogs((prev) => [event.payload, ...prev].slice(0, 100));
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, []);

  const handleClearGatewayLogs = async () => {
    setGatewayLogs([]);
    await fetch(apiUrl("/v1/gateway/logs"), { method: "DELETE" }).catch(() => {});
  };

  const handleTogglePetReactTraffic = async (enabled: boolean) => {
    setPetReactTraffic(enabled);
    await fetch(apiUrl("/v1/pet/react-traffic"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }).catch(() => {});
  };

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

  const resolveInternalApiKey = async (): Promise<string | null> => {
    const active = keys.find((k) => k.is_active)?.key;
    if (active) return active;
    try {
      const stRes = await fetch(apiUrl("/v1/pet/state"));
      if (stRes.ok) {
        const stData = await stRes.json();
        if (stData?.pet_api_key) {
          void fetchKeys();
          return String(stData.pet_api_key);
        }
      }
    } catch {
      // Ignore fallback lookup errors
    }
    return null;
  };

  const runProfileTest = async () => {
    if (!testingProfile) return;
    setTestRunning(true);
    setTestResult(null);
    const start = performance.now();
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const authKey = await resolveInternalApiKey();
      if (authKey) headers.Authorization = `Bearer ${authKey}`;
      const res = await fetch(apiUrl("/v1/chat/completions"), {
        method: "POST",
        headers,
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
      const authKey = await resolveInternalApiKey();
      if (authKey) headers.Authorization = `Bearer ${authKey}`;
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
    <Button
      variant="secondary"
      size="xs"
      className="gap-1 px-2 text-[11px]"
      onClick={() => void openApiDocs()}
    >
      <span>API Docs</span>
      <ExternalLink className="h-3 w-3" />
    </Button>
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
                  ? "bg-primary/15 font-semibold text-primary"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <span className="flex items-center gap-2">
                <Users className={`h-3.5 w-3.5 ${activeTab === "profiles" ? "text-primary" : ""}`} />
                Profiles
              </span>
              <Badge
                variant="secondary"
                className={`h-4 px-1.5 text-[10px] ${
                  activeTab === "profiles" ? "bg-primary/20 text-primary" : ""
                }`}
              >
                {profiles.length}
              </Badge>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("keys")}
              className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
                activeTab === "keys"
                  ? "bg-primary/15 font-semibold text-primary"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <span className="flex items-center gap-2">
                <KeyRound className={`h-3.5 w-3.5 ${activeTab === "keys" ? "text-primary" : ""}`} />
                API Keys
              </span>
              <Badge
                variant="secondary"
                className={`h-4 px-1.5 text-[10px] ${
                  activeTab === "keys" ? "bg-primary/20 text-primary" : ""
                }`}
              >
                {keys.length}
              </Badge>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("playground")}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
                activeTab === "playground"
                  ? "bg-primary/15 font-semibold text-primary"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <MessageSquare
                className={`h-3.5 w-3.5 ${activeTab === "playground" ? "text-primary" : ""}`}
              />
              Playground
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("logs")}
              className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
                activeTab === "logs"
                  ? "bg-primary/15 font-semibold text-primary"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <span className="flex items-center gap-2">
                <ScrollText className={`h-3.5 w-3.5 ${activeTab === "logs" ? "text-primary" : ""}`} />
                Logs
              </span>
              <Badge
                variant="secondary"
                className={`h-4 px-1.5 text-[10px] ${
                  activeTab === "logs" ? "bg-primary/20 text-primary" : ""
                }`}
              >
                {gatewayLogs.length}
              </Badge>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("pets")}
              className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
                activeTab === "pets"
                  ? "bg-primary/15 font-semibold text-primary"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <span className="flex items-center gap-2">
                <PawPrint className={`h-4 w-4 ${activeTab === "pets" ? "text-primary" : ""}`} />
                Pet Store
              </span>
              <Badge
                variant="secondary"
                className={`h-4 px-1.5 text-[10px] ${
                  activeTab === "pets" ? "bg-primary/20 text-primary" : ""
                }`}
              >
                {PET_CATALOG.length}
              </Badge>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("settings")}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
                activeTab === "settings"
                  ? "bg-primary/15 font-semibold text-primary"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <Settings className={`h-3.5 w-3.5 ${activeTab === "settings" ? "text-primary" : ""}`} />
              Settings
            </button>
          </nav>

          {/* Pet Home Spot: Empty slot for the floating pet to return to */}
          <button
            ref={petHomeRef}
            type="button"
            onClick={summonPetToHome}
            title="Click to call Pet back into this spot"
            className="mt-auto mb-2 flex h-24 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border/70 bg-background/40 px-2 text-center transition-colors hover:border-primary/60 hover:bg-primary/5"
          >
            <PawPrint className="h-4 w-4 text-muted-foreground/50" />
            <span className="text-[11px] font-medium text-muted-foreground/80">Pet Home</span>
            <span className="text-[10px] text-muted-foreground/55">Click để gọi pet về đây</span>
          </button>

          {/* Gateway Status Footer */}
          <div className="rounded-lg border border-border bg-card p-3 text-xs">
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
            <ProfilesTab
              profiles={filteredProfiles}
              providerFilter={providerFilter}
              onProviderFilterChange={setProviderFilter}
              onAddProfile={openCreateModal}
              onToggleActive={(p) => void handleToggleActive(p)}
              onTestProfile={openTestModal}
              onEditProfile={openEditModal}
              onDeleteProfile={(p) => void handleDeleteProfile(p)}
              maskSecret={maskSecret}
            />
          )}

          {activeTab === "keys" && (
            <KeysTab
              keys={keys}
              newKeyName={newKeyName}
              onNewKeyNameChange={setNewKeyName}
              onCreateKey={handleCreateKey}
              createdKey={createdKey}
              copiedKey={copiedKey}
              onCopyKey={(text) => void copyText(text)}
              onDeleteKey={(key) => void handleDeleteKey(key)}
              maskSecret={maskSecret}
            />
          )}

          {activeTab === "playground" && (
            <PlaygroundTab
              provider={pgProvider}
              onProviderChange={setPgProvider}
              model={pgModel}
              onModelChange={setPgModel}
              activeProfiles={{
                deepseek: health?.deepseek_active_profiles ?? 0,
                gemini: health?.gemini_active_profiles ?? 0,
                metaai: health?.metaai_active_profiles ?? 0,
              }}
              sessionId={pgSessionId}
              onSessionIdChange={setPgSessionId}
              prompt={pgPrompt}
              onPromptChange={setPgPrompt}
              stream={pgStream}
              onStreamChange={setPgStream}
              running={pgRunning}
              output={pgOutput}
              reasoning={pgReasoning}
              error={pgError}
              onSubmit={runPlayground}
            />
          )}

          {activeTab === "logs" && (
            <LogsTab
              logs={gatewayLogs}
              filter={logFilter}
              onFilterChange={setLogFilter}
              onClear={() => void handleClearGatewayLogs()}
            />
          )}

          {activeTab === "pets" && (
            <PetStoreTab
              selectedPetId={selectedPetId}
              previewPetStatus={previewPetStatus}
              onPreviewStatusChange={setPreviewPetStatus}
              onSelectPet={(id) => void handleSelectPet(id)}
              onSummonPet={summonPetToHome}
              onTogglePetWindow={() => void petBridge.togglePetWindow()}
              petReactTraffic={petReactTraffic}
              onToggleReactTraffic={(v) => void handleTogglePetReactTraffic(v)}
            />
          )}

          {activeTab === "settings" && (
            <SettingsTab
              petReactTraffic={petReactTraffic}
              onToggleReactTraffic={(v) => void handleTogglePetReactTraffic(v)}
              onLogsPruned={() => {
                fetch(apiUrl("/v1/gateway/logs"))
                  .then((r) => (r.ok ? r.json() : null))
                  .then((res) => {
                    if (Array.isArray(res?.data)) {
                      setGatewayLogs(res.data as GatewayRequestLog[]);
                    }
                  })
                  .catch(() => {});
              }}
            />
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
