import { Edit2, Play, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProviderType } from "@/components/tabs/playground-tab";

export interface Profile {
  id: string;
  name: string;
  type: ProviderType;
  token?: string | null;
  cookie?: string | null;
  is_active: boolean;
  total_requests: number;
  created_at: string;
  updated_at?: string;
}

export const PROVIDER_LOGOS: Record<string, string> = {
  deepseek: "/providers/deepseek.svg",
  gemini: "/providers/gemini.svg",
  metaai: "/providers/metaai.svg",
};

export const PROVIDER_LABELS: Record<string, string> = {
  deepseek: "DeepSeek",
  gemini: "Gemini",
  metaai: "Meta AI",
};

interface ProfilesTabProps {
  profiles: Profile[];
  providerFilter: "all" | ProviderType;
  onProviderFilterChange: (filter: "all" | ProviderType) => void;
  onAddProfile: () => void;
  onToggleActive: (p: Profile) => void;
  onTestProfile: (p: Profile) => void;
  onEditProfile: (p: Profile) => void;
  onDeleteProfile: (p: Profile) => void;
  maskSecret: (s?: string | null) => string;
}

export function ProfilesTab({
  profiles,
  providerFilter,
  onProviderFilterChange,
  onAddProfile,
  onToggleActive,
  onTestProfile,
  onEditProfile,
  onDeleteProfile,
  maskSecret,
}: ProfilesTabProps) {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Provider Profiles</h1>
          <p className="text-xs text-muted-foreground">
            Manage DeepSeek tokens, Gemini &amp; Meta AI cookies for Round-Robin load balancing.
          </p>
        </div>
        <Button size="sm" onClick={onAddProfile} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Profile
        </Button>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {(["all", "deepseek", "gemini", "metaai"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onProviderFilterChange(tab)}
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
              {profiles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-xs text-muted-foreground">
                    No profiles yet. Click &ldquo;Add Profile&rdquo; to add credentials.
                  </TableCell>
                </TableRow>
              ) : (
                profiles.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs font-medium">{p.name}</TableCell>
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
                        onCheckedChange={() => onToggleActive(p)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title="Test Profile"
                          onClick={() => onTestProfile(p)}
                        >
                          <Play className="h-3.5 w-3.5 text-primary" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title="Edit"
                          onClick={() => onEditProfile(p)}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title="Delete"
                          onClick={() => onDeleteProfile(p)}
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
  );
}
