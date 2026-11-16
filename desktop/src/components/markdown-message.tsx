import { isValidElement, memo, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Copy } from "lucide-react";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";

const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_HIGHLIGHT_PLUGINS: Parameters<typeof ReactMarkdown>[0]["rehypePlugins"] = [
  rehypeKatex,
  [rehypeHighlight, { detect: true, ignoreMissing: true }],
];
const REHYPE_STREAMING_PLUGINS: Parameters<typeof ReactMarkdown>[0]["rehypePlugins"] = [
  rehypeKatex,
];

/**
 * Converts LaTeX `\[...\]` and `\(...\)` delimiters (commonly emitted by DeepSeek)
 * into `$$...$$` and `$...$` outside fenced/inline code blocks so remark-math renders them.
 */
function normalizeMathDelimiters(markdown: string): string {
  const lines = markdown.split("\n");
  let fenceChar: "`" | "~" | null = null;
  let fenceLen = 0;

  return lines
    .map((line) => {
      const fenceMatch = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (fenceMatch) {
        const marker = fenceMatch[1];
        const ch = marker[0] as "`" | "~";
        const rest = fenceMatch[2].trim();
        if (!fenceChar) {
          fenceChar = ch;
          fenceLen = marker.length;
        } else if (ch === fenceChar && marker.length >= fenceLen && rest.length === 0) {
          fenceChar = null;
          fenceLen = 0;
        }
        return line;
      }

      if (fenceChar) return line;

      // Split by inline code spans so we don't rewrite delimiters inside `...`.
      return line
        .split(/(`[^`]*`)/g)
        .map((segment) => {
          if (segment.startsWith("`") && segment.endsWith("`")) {
            return segment;
          }
          return segment
            .replace(/\\\[([\s\S]*?)\\\]/g, (_, inner: string) => `$$${inner}$$`)
            .replace(/\\\(([\s\S]*?)\\\)/g, (_, inner: string) => `$${inner}$`);
        })
        .join("");
    })
    .join("\n");
}

/**
 * Temporarily closes unterminated code fences, math blocks, inline code, and
 * bold markers while streaming so partial tokens render cleanly without flicker.
 */
function repairStreamingMarkdown(markdown: string): string {
  const lines = markdown.split("\n");
  let fenceChar: "`" | "~" | null = null;
  let fenceLen = 0;

  for (const line of lines) {
    const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!match) continue;
    const marker = match[1];
    const ch = marker[0] as "`" | "~";
    const rest = match[2].trim();
    if (!fenceChar) {
      fenceChar = ch;
      fenceLen = marker.length;
    } else if (ch === fenceChar && marker.length >= fenceLen && rest.length === 0) {
      fenceChar = null;
      fenceLen = 0;
    }
  }

  let repaired = markdown;
  if (fenceChar) {
    repaired += `\n${fenceChar.repeat(fenceLen)}`;
    return repaired;
  }

  // Close an unclosed $$ math block outside code fences.
  const mathBlockCount = (repaired.match(/(^|\n)\s*\$\$/g) ?? []).length;
  if (mathBlockCount % 2 === 1) {
    repaired += "\n$$";
    return repaired;
  }

  // Close an unclosed inline backtick or bold ** on the active trailing line.
  const lastLine = lines[lines.length - 1] ?? "";
  let inlineTicks = 0;
  for (let i = 0; i < lastLine.length; i += 1) {
    if (lastLine[i] === "`" && lastLine[i - 1] !== "\\") {
      inlineTicks += 1;
    }
  }
  if (inlineTicks % 2 === 1) {
    repaired += "`";
    return repaired;
  }

  const boldCount = (lastLine.match(/\*\*/g) ?? []).length;
  if (boldCount % 2 === 1) {
    repaired += "**";
  }

  return repaired;
}

/**
 * Splits markdown into top-level blocks on blank lines outside fenced code/math
 * blocks so settled blocks can be memoized independently during streaming.
 */
function splitMarkdownBlocks(markdown: string): string[] {
  const lines = markdown.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let fenceChar: "`" | "~" | null = null;
  let fenceLen = 0;
  let inMathBlock = false;

  for (const line of lines) {
    const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (match) {
      const marker = match[1];
      const ch = marker[0] as "`" | "~";
      const rest = match[2].trim();
      if (!fenceChar) {
        fenceChar = ch;
        fenceLen = marker.length;
      } else if (ch === fenceChar && marker.length >= fenceLen && rest.length === 0) {
        fenceChar = null;
        fenceLen = 0;
      }
    } else if (!fenceChar && /^\s*\$\$\s*$/.test(line)) {
      inMathBlock = !inMathBlock;
    }

    if (!fenceChar && !inMathBlock && line.trim() === "" && current.length > 0) {
      blocks.push(current.join("\n"));
      current = [];
      continue;
    }

    current.push(line);
  }

  if (current.length > 0) {
    blocks.push(current.join("\n"));
  }

  return blocks.length > 0 ? blocks : [markdown];
}

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractText(node.props.children);
  }
  return "";
}

function extractLanguage(node: ReactNode): string | null {
  if (!isValidElement<{ className?: string }>(node)) return null;
  const cls = node.props.className ?? "";
  const match = /language-([a-z0-9_+-]+)/i.exec(cls);
  return match ? match[1] : null;
}

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const language = extractLanguage(children);
  const rawCode = extractText(children).replace(/\n$/, "");

  const handleCopy = () => {
    if (!rawCode) return;
    void navigator.clipboard.writeText(rawCode).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-white/10 bg-[#121212]">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] text-white/60">
        <span className="font-mono uppercase tracking-wider">{language ?? "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-2.5 font-mono text-[11.5px] leading-relaxed text-zinc-100 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit">
        {children}
      </pre>
    </div>
  );
}

const MARKDOWN_COMPONENTS: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ className, children, ...props }) => (
    <code
      className={cn(
        "rounded bg-white/10 px-1 py-0.5 font-mono text-[0.9em] text-primary",
        className,
      )}
      {...props}
    >
      {children}
    </code>
  ),
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  h1: ({ children }) => (
    <h1 className="mt-3 mb-1.5 first:mt-0 text-sm font-bold tracking-tight">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-2.5 mb-1.5 first:mt-0 text-[13px] font-bold tracking-tight">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-2 mb-1 first:mt-0 text-xs font-semibold">{children}</h3>
  ),
  ul: ({ children }) => <ul className="mb-2 last:mb-0 list-disc space-y-1 pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 last:mb-0 list-decimal space-y-1 pl-4">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-primary/60 pl-2.5 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-2.5 border-white/10" />,
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        if (!href) return;
        e.preventDefault();
        void openUrl(href).catch(() => window.open(href, "_blank", "noopener,noreferrer"));
      }}
      className="text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full border-collapse text-left text-[11.5px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-white/[0.05]">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-white/10 px-2.5 py-1.5 font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border-t border-white/5 px-2.5 py-1.5">{children}</td>,
};

const MemoizedMarkdownBlock = memo(function MemoizedMarkdownBlock({
  content,
  highlight,
}: {
  content: string;
  highlight: boolean;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={highlight ? REHYPE_HIGHLIGHT_PLUGINS : REHYPE_STREAMING_PLUGINS}
      components={MARKDOWN_COMPONENTS}
    >
      {content}
    </ReactMarkdown>
  );
});

export function ThinkingIndicator({
  label = "Thinking...",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 text-[11.5px] text-muted-foreground",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/85 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/85 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/85" />
      </span>
      <span>{label}</span>
    </div>
  );
}

export function CopyMessageButton({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy response"
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-white/55 transition-colors hover:bg-white/10 hover:text-white",
        className,
      )}
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-emerald-400" />
          <span className="text-emerald-400">Copied</span>
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

interface MarkdownMessageProps {
  content: string;
  className?: string;
  isStreaming?: boolean;
}

export const MarkdownMessage = memo(function MarkdownMessage({
  content,
  className,
  isStreaming = false,
}: MarkdownMessageProps) {
  const blocks = useMemo(() => {
    const mathReady = normalizeMathDelimiters(content);
    const normalized = isStreaming ? repairStreamingMarkdown(mathReady) : mathReady;
    return splitMarkdownBlocks(normalized);
  }, [content, isStreaming]);

  return (
    <div className={cn("markdown-body min-w-0 space-y-2 break-words", className)}>
      {blocks.map((block, index) => {
        const isActiveTrailingBlock = isStreaming && index === blocks.length - 1;
        return (
          <MemoizedMarkdownBlock
            key={index}
            content={block}
            highlight={!isActiveTrailingBlock}
          />
        );
      })}
      {isStreaming && (
        <span
          aria-hidden="true"
          className="inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-[1px] bg-primary/85 align-baseline"
        />
      )}
    </div>
  );
});
