import { useEffect, useState, type FormEvent } from "react";
import { Check, Copy, Edit2, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  onRenameKey: (key: string, name: string) => Promise<boolean>;
  onDeleteKey: (key: string) => void;
  onDeleteKeys: (keys: string[]) => void;
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
  onRenameKey,
  onDeleteKey,
  onDeleteKeys,
  maskSecret,
}: KeysTabProps) {
  const [copiedRowKey, setCopiedRowKey] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    const valid = new Set(keys.map((k) => k.key));
    setSelectedKeys((prev) => prev.filter((k) => valid.has(k)));
    if (editingKey && !valid.has(editingKey)) {
      setEditingKey(null);
    }
  }, [keys, editingKey]);

  const startRename = (k: ApiKeyItem) => {
    setEditingKey(k.key);
    setEditingName(k.name);
  };

  const cancelRename = () => {
    setEditingKey(null);
    setEditingName("");
  };

  const submitRename = async () => {
    if (!editingKey || renaming) return;
    const trimmed = editingName.trim();
    if (!trimmed) return;
    setRenaming(true);
    try {
      const ok = await onRenameKey(editingKey, trimmed);
      if (ok) {
        setEditingKey(null);
        setEditingName("");
      }
    } finally {
      setRenaming(false);
    }
  };

  const allSelected = keys.length > 0 && selectedKeys.length === keys.length;
  const someSelected = selectedKeys.length > 0 && selectedKeys.length < keys.length;

  const toggleAll = (checked: boolean) => {
    setSelectedKeys(checked ? keys.map((k) => k.key) : []);
  };

  const toggleOne = (keyValue: string, checked: boolean) => {
    setSelectedKeys((prev) =>
      checked ? (prev.includes(keyValue) ? prev : [...prev, keyValue]) : prev.filter((k) => k !== keyValue),
    );
  };

  const handleCopyRow = (keyValue: string) => {
    onCopyKey(keyValue);
    setCopiedRowKey(keyValue);
    window.setTimeout(() => {
      setCopiedRowKey((prev) => (prev === keyValue ? null : prev));
    }, 1500);
  };

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

      {selectedKeys.length > 0 && (
        <div className="flex shrink-0 items-center justify-between rounded-md border border-destructive/35 bg-destructive/10 px-3 py-1.5 text-xs">
          <span className="font-medium text-foreground">
            {selectedKeys.length} API key{selectedKeys.length > 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="xs" onClick={() => setSelectedKeys([])}>
              Clear
            </Button>
            <Button
              variant="destructive"
              size="xs"
              className="gap-1.5"
              onClick={() => onDeleteKeys(selectedKeys)}
            >
              <Trash2 className="h-3 w-3" />
              Delete Selected ({selectedKeys.length})
            </Button>
          </div>
        </div>
      )}

      <Card className="min-h-0 flex-1 overflow-hidden py-0">
        <CardContent className="h-full p-0">
          <Table containerClassName="h-full overflow-auto">
            <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-b-0">
              <TableRow>
                <TableHead className="w-9 text-center">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onCheckedChange={toggleAll}
                    ariaLabel="Select all API keys"
                  />
                </TableHead>
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
                  <TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                    No API keys created yet.
                  </TableCell>
                </TableRow>
              ) : (
                keys.map((k) => {
                  const isSelected = selectedKeys.includes(k.key);
                  return (
                    <TableRow key={k.key} data-state={isSelected ? "selected" : undefined}>
                      <TableCell className="w-9 text-center">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => toggleOne(k.key, checked)}
                          ariaLabel={`Select ${k.name}`}
                        />
                      </TableCell>
                      <TableCell className="text-xs font-medium">
                        {editingKey === k.key ? (
                          <div className="flex items-center gap-1">
                            <Input
                              value={editingName}
                              autoFocus
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void submitRename();
                                } else if (e.key === "Escape") {
                                  cancelRename();
                                }
                              }}
                              className="h-7 max-w-[180px] text-xs"
                              disabled={renaming}
                            />
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              title="Save name"
                              disabled={renaming || !editingName.trim()}
                              onClick={() => void submitRename()}
                            >
                              <Check className="h-3.5 w-3.5 text-emerald-500" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              title="Cancel"
                              disabled={renaming}
                              onClick={cancelRename}
                            >
                              <X className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          </div>
                        ) : (
                          k.name
                        )}
                      </TableCell>
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
                        <div className="inline-flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            title="Copy API key"
                            onClick={() => handleCopyRow(k.key)}
                          >
                            {copiedRowKey === k.key ? (
                              <Check className="h-3.5 w-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            title="Rename API key"
                            onClick={() => startRename(k)}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            title="Delete API key"
                            onClick={() => onDeleteKey(k.key)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
