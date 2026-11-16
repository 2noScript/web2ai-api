import { useEffect, useState, type FormEvent } from "react";
import { Check, Database, Save, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { apiUrl } from "@/lib/api";

interface CacheStats {
  api_sessions_count: number;
  pet_sessions_count: number;
  logs_count: number;
}

interface SettingsTabProps {
  petReactTraffic: boolean;
  onToggleReactTraffic: (enabled: boolean) => void;
  onLogsPruned?: () => void;
}

export function SettingsTab({
  petReactTraffic,
  onToggleReactTraffic,
  onLogsPruned,
}: SettingsTabProps) {
  const [maxSessions, setMaxSessions] = useState(50);
  const [maxLogs, setMaxLogs] = useState(200);
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const loadSettings = async () => {
    try {
      const res = await fetch(apiUrl("/v1/settings/cache"));
      if (!res.ok) return;
      const data = (await res.json()) as {
        settings?: { max_sessions: number; max_logs: number };
        stats?: CacheStats;
      };
      if (data.settings) {
        setMaxSessions(data.settings.max_sessions);
        setMaxLogs(data.settings.max_logs);
      }
      if (data.stats) setStats(data.stats);
    } catch {
      // Ignore if backend unreachable
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(false);
    try {
      const res = await fetch(apiUrl("/v1/settings/cache"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          max_sessions: Number(maxSessions) || 50,
          max_logs: Number(maxLogs) || 200,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          settings?: { max_sessions: number; max_logs: number };
          stats?: CacheStats;
        };
        if (data.settings) {
          setMaxSessions(data.settings.max_sessions);
          setMaxLogs(data.settings.max_logs);
        }
        if (data.stats) setStats(data.stats);
        setSavedNotice(true);
        onLogsPruned?.();
        window.setTimeout(() => setSavedNotice(false), 2200);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto pr-1">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <p className="text-xs text-muted-foreground">
          Configure history retention limits, automatic cleanup, and pet behavior.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm">History &amp; Retention</CardTitle>
            </div>
            {stats && (
              <div className="flex items-center gap-1.5 text-[10px]">
                <Badge variant="secondary">
                  Chats: {stats.api_sessions_count} API / {stats.pet_sessions_count} Pet
                </Badge>
                <Badge variant="secondary">Logs: {stats.logs_count}</Badge>
              </div>
            )}
          </div>
          <CardDescription className="text-xs">
            When saved history exceeds these limits, the oldest chats and request logs are automatically deleted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground">
                  Max Saved Chats
                </label>
                <Input
                  type="number"
                  min={5}
                  max={5000}
                  value={maxSessions}
                  onChange={(e) => setMaxSessions(Number(e.target.value))}
                  className="h-8 font-mono text-xs"
                />
                <div className="flex flex-wrap gap-1">
                  {[20, 50, 100, 500].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setMaxSessions(preset)}
                      className={`rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
                        maxSessions === preset
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground">
                  Max Request Logs
                </label>
                <Input
                  type="number"
                  min={10}
                  max={5000}
                  value={maxLogs}
                  onChange={(e) => setMaxLogs(Number(e.target.value))}
                  className="h-8 font-mono text-xs"
                />
                <div className="flex flex-wrap gap-1">
                  {[50, 200, 500, 1000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setMaxLogs(preset)}
                      className={`rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
                        maxLogs === preset
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-muted-foreground">
                Valid range: 5–5000 chats · 10–5000 logs
              </span>
              <Button type="submit" size="sm" disabled={saving} className="gap-1.5">
                {savedNotice ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                {savedNotice ? "Saved & Pruned" : saving ? "Saving..." : "Save & Prune Now"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm">Desktop Pet & Shortcuts</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 px-3 py-2.5">
            <div>
              <div className="font-medium text-foreground">React to Gateway Traffic</div>
              <div className="text-[11px] text-muted-foreground">
                Show thinking/done/error animations when external tools call :8088
              </div>
            </div>
            <Switch checked={petReactTraffic} onCheckedChange={onToggleReactTraffic} />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 px-3 py-2.5">
            <div>
              <div className="font-medium text-foreground">Global Shortcuts</div>
              <div className="text-[11px] text-muted-foreground">
                Summon Quick-Chat or bring Pet to active monitor from anywhere
              </div>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-[11px]">
              <code className="rounded bg-background px-1.5 py-0.5">⌘⇧Space</code>
              <code className="rounded bg-background px-1.5 py-0.5">⌘⇧P</code>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
