import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface GatewayRequestLog {
  id: string;
  timestamp: string;
  endpoint: string;
  model: string;
  status_code: number;
  latency_ms: number;
  stream: boolean;
  error?: string | null;
}

interface LogsTabProps {
  logs: GatewayRequestLog[];
  filter: "all" | "ok" | "error";
  onFilterChange: (next: "all" | "ok" | "error") => void;
  onClear: () => void;
}

export function LogsTab({ logs, filter, onFilterChange, onClear }: LogsTabProps) {
  const total = logs.length;
  const okCount = logs.filter((l) => l.status_code < 400).length;
  const successRate = total > 0 ? Math.round((okCount / total) * 100) : 100;
  const avgLatency =
    total > 0 ? Math.round(logs.reduce((acc, l) => acc + l.latency_ms, 0) / total) : 0;

  const filtered = logs.filter((l) =>
    filter === "all" ? true : filter === "ok" ? l.status_code < 400 : l.status_code >= 400,
  );

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-1 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Gateway Request Logs</h2>
          <p className="text-xs text-muted-foreground">
            Live traffic flowing through <code className="font-mono">http://127.0.0.1:8088</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5 text-[11px]">
            {(["all", "ok", "error"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => onFilterChange(f)}
                className={`rounded px-2 py-1 capitalize transition-colors ${
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={onClear}>
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      </div>

      {/* Summary Metrics */}
      <div className="grid shrink-0 grid-cols-3 gap-3">
        <Card className="py-2.5">
          <CardContent className="px-3.5 py-0">
            <div className="text-[11px] text-muted-foreground">Total Requests</div>
            <div className="mt-0.5 font-mono text-base font-semibold text-foreground">{total}</div>
          </CardContent>
        </Card>
        <Card className="py-2.5">
          <CardContent className="px-3.5 py-0">
            <div className="text-[11px] text-muted-foreground">Success Rate</div>
            <div className="mt-0.5 font-mono text-base font-semibold text-primary">
              {total > 0 ? `${successRate}%` : "—"}
            </div>
          </CardContent>
        </Card>
        <Card className="py-2.5">
          <CardContent className="px-3.5 py-0">
            <div className="text-[11px] text-muted-foreground">Avg Latency</div>
            <div className="mt-0.5 font-mono text-base font-semibold text-foreground">
              {total > 0 ? `${avgLatency}ms` : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="min-h-0 flex-1 overflow-hidden py-0">
        <CardContent className="h-full p-0">
          <Table containerClassName="h-full overflow-auto">
            <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-b-0">
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Latency</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-xs text-muted-foreground">
                    No gateway requests recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {l.timestamp.slice(11, 19)}
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium">{l.model}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">
                        {l.stream ? "SSE" : "JSON"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={l.status_code < 400 ? "default" : "destructive"}
                        className="text-[10px]"
                      >
                        {l.status_code}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {l.latency_ms}ms
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate text-[11px] text-muted-foreground">
                      {l.error || l.endpoint}
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
