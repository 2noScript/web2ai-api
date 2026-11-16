import type { FormEvent } from "react";
import { Check, Copy, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface ApiKeyItem {
  key: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

interface KeysTabProps {
  keys: ApiKeyItem[];
  newKeyName: string;
  onNewKeyNameChange: (v: string) => void;
  onCreateKey: (e: FormEvent) => void;
  createdKey: string | null;
  copiedKey: boolean;
  onCopyKey: (text: string) => void;
  onDeleteKey: (key: string) => void;
  maskSecret: (s: string) => string;
}

export function KeysTab({
  keys,
  newKeyName,
  onNewKeyNameChange,
  onCreateKey,
  createdKey,
  copiedKey,
  onCopyKey,
  onDeleteKey,
  maskSecret,
}: KeysTabProps) {
  return (
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
          <form onSubmit={onCreateKey} className="flex gap-2">
            <Input
              placeholder="Friendly key name (e.g. cursor-local)"
              value={newKeyName}
              onChange={(e) => onNewKeyNameChange(e.target.value)}
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
                onClick={() => onCopyKey(createdKey)}
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
                        onClick={() => onDeleteKey(k.key)}
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
  );
}
