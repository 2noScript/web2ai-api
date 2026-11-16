import type { FormEvent } from "react";
import { Send } from "lucide-react";
import {
  CopyMessageButton,
  MarkdownMessage,
  ThinkingIndicator,
} from "@/components/markdown-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export type ProviderType = "deepseek" | "gemini" | "metaai";

export const PROVIDER_MODELS: Record<ProviderType, string[]> = {
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  gemini: ["gemini-3-flash", "gemini-3-pro", "gemini-3-flash-thinking"],
  metaai: ["meta-ai", "llama-3.3-70b", "meta-imagine"],
};

interface PlaygroundTabProps {
  provider: ProviderType;
  onProviderChange: (p: ProviderType) => void;
  model: string;
  onModelChange: (m: string) => void;
  activeProfiles: Record<ProviderType, number>;
  sessionId: string;
  onSessionIdChange: (sid: string) => void;
  prompt: string;
  onPromptChange: (p: string) => void;
  stream: boolean;
  onStreamChange: (s: boolean) => void;
  running: boolean;
  output: string;
  reasoning: string;
  error: string | null;
  onSubmit: (e: FormEvent) => void;
}

export function PlaygroundTab({
  provider,
  onProviderChange,
  model,
  onModelChange,
  activeProfiles,
  sessionId,
  onSessionIdChange,
  prompt,
  onPromptChange,
  stream,
  onStreamChange,
  running,
  output,
  reasoning,
  error,
  onSubmit,
}: PlaygroundTabProps) {
  const hasActiveProviderProfile = (activeProfiles[provider] ?? 0) > 0;
  return (
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
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                    Provider
                  </label>
                  <select
                    value={provider}
                    onChange={(e) => {
                      const next = e.target.value as ProviderType;
                      onProviderChange(next);
                      onModelChange(PROVIDER_MODELS[next][0]);
                    }}
                    className="h-8 w-full rounded-md border border-border bg-input px-2.5 text-xs text-foreground outline-none"
                  >
                    <option value="deepseek" disabled={(activeProfiles.deepseek ?? 0) === 0}>
                      DeepSeek{(activeProfiles.deepseek ?? 0) === 0 ? " (No active profile)" : ""}
                    </option>
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
                    value={model}
                    disabled={!hasActiveProviderProfile}
                    onChange={(e) => onModelChange(e.target.value)}
                    className="h-8 w-full rounded-md border border-border bg-input px-2.5 text-xs text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {!hasActiveProviderProfile ? (
                      <option value={model}>No active profile</option>
                    ) : (
                      PROVIDER_MODELS[provider].map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                    X-Session-Id (optional)
                  </label>
                  <Input
                    value={sessionId}
                    onChange={(e) => onSessionIdChange(e.target.value)}
                    placeholder="Auto-assigned on first turn"
                    className="h-8 font-mono text-xs"
                  />
                </div>
              </div>

              <Textarea
                rows={3}
                placeholder="Enter a prompt..."
                value={prompt}
                onChange={(e) => onPromptChange(e.target.value)}
                className="text-xs"
              />

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch checked={stream} onCheckedChange={onStreamChange} />
                  <span>SSE Streaming</span>
                </label>
                <Button
                  type="submit"
                  size="sm"
                  disabled={running || !hasActiveProviderProfile}
                  className="gap-1.5"
                >
                  <Send className="h-3.5 w-3.5" />
                  {running ? "Generating..." : "Send Request"}
                </Button>
              </div>
            </form>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {error}
              </div>
            )}

            {reasoning && (
              <div className="rounded-md border border-border bg-secondary/50 p-3">
                <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
                  Reasoning
                </div>
                <pre className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                  {reasoning}
                </pre>
              </div>
            )}

            {(output || running) && (
              <div className="rounded-md border border-border bg-input p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-primary">Response</span>
                  {!running && output && <CopyMessageButton text={output} />}
                </div>
                {output ? (
                  <MarkdownMessage
                    content={output}
                    isStreaming={running}
                    className="text-xs text-foreground"
                  />
                ) : (
                  <ThinkingIndicator
                    label={reasoning ? "Thinking..." : "Waiting for response..."}
                  />
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
