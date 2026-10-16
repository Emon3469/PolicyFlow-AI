"use client";

import { AlertCircle, Check, Copy, ExternalLink, FileText, Globe, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Badge } from "@/components/ui/primitives";
import { LogoMark } from "@/components/ui/logo";
import { sendFeedback } from "@/lib/api";
import { sourceMeta } from "@/lib/sources";
import type { Citation, TraceStep } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TraceTimeline } from "./trace";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "done" | "error";
  trace: TraceStep[];
  citations: Citation[];
  source?: string;
  provider?: string;
  latencyMs?: number;
  queryId?: string;
  rating?: 1 | -1;
  error?: string;
};

const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
});

function CitationList({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {citations.slice(0, 6).map((citation, index) => {
        const web = citation.type === "web";
        const label = web
          ? `${index + 1}. ${citation.title}`
          : `${citation.title}${citation.section ? ` · ${citation.section}` : ""}${citation.page ? ` · p.${citation.page}` : ""}`;
        const className =
          "group inline-flex max-w-[280px] items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-[12px] text-muted transition-colors hover:border-border-strong hover:text-fg";
        const body = (
          <>
            {web ? <Globe className="size-3 shrink-0 text-c-amber" /> : <FileText className="size-3 shrink-0 text-c-blue" />}
            <span className="truncate">{label}</span>
            {web && <ExternalLink className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />}
          </>
        );
        return web && citation.url ? (
          <a key={index} href={citation.url} target="_blank" rel="noopener noreferrer" className={className} title={citation.snippet}>
            {body}
          </a>
        ) : (
          <span key={index} className={className} title={citation.snippet}>
            {body}
          </span>
        );
      })}
    </div>
  );
}

function Actions({ message, onRate, onRetry }: { message: ChatMessage; onRate: (rating: 1 | -1) => void; onRetry?: () => void }) {
  const [copied, setCopied] = useState(false);
  const meta = sourceMeta(message.source ?? "");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  const rate = async (rating: 1 | -1) => {
    if (!message.queryId || message.rating) return;
    onRate(rating);
    try {
      await sendFeedback(message.queryId, rating);
      toast.success("Thanks for the feedback");
    } catch {
      toast.error("Feedback could not be saved");
    }
  };

  const iconButton = "rounded-md p-1.5 text-subtle transition-colors hover:bg-surface-3 hover:text-fg disabled:pointer-events-none";

  return (
    <div className="flex flex-wrap items-center gap-1">
      {message.source && <Badge tone={meta.tone}>{meta.label}</Badge>}
      {(message.provider || message.latencyMs) && (
        <span className="ml-1 text-[11.5px] text-subtle">
          {message.provider}
          {message.provider && message.latencyMs ? " · " : ""}
          {message.latencyMs ? `${(message.latencyMs / 1000).toFixed(1)}s` : ""}
        </span>
      )}
      <span className="flex-1" />
      <button onClick={copy} className={iconButton} aria-label="Copy answer">
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      {onRetry && (
        <button onClick={onRetry} className={iconButton} aria-label="Regenerate">
          <RotateCcw className="size-3.5" />
        </button>
      )}
      <button
        onClick={() => rate(1)}
        disabled={!!message.rating}
        className={cn(iconButton, message.rating === 1 && "text-ok-fg")}
        aria-label="Helpful"
      >
        <ThumbsUp className="size-3.5" />
      </button>
      <button
        onClick={() => rate(-1)}
        disabled={!!message.rating}
        className={cn(iconButton, message.rating === -1 && "text-danger-fg")}
        aria-label="Not helpful"
      >
        <ThumbsDown className="size-3.5" />
      </button>
    </div>
  );
}

export function MessageView({
  message,
  onRate,
  onRetry,
}: {
  message: ChatMessage;
  onRate: (rating: 1 | -1) => void;
  onRetry?: () => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-surface-3 px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap text-fg ring-1 ring-border">
          {message.content}
        </div>
      </div>
    );
  }

  const streaming = message.status === "streaming";
  const waiting = streaming && !message.content;

  return (
    <div className="flex gap-3 animate-fade-in">
      <LogoMark className="mt-0.5 size-7 shrink-0" />
      <div className="min-w-0 flex-1 space-y-3">
        <TraceTimeline steps={message.trace} live={waiting} />
        {message.content && (
          <div className={cn("markdown text-fg", streaming && "streaming")}>
            <Markdown content={message.content} />
          </div>
        )}
        {message.status === "error" && (
          <div className="flex items-start gap-2 rounded-xl border border-danger-fg/20 bg-danger-bg px-3 py-2.5 text-[13px] text-danger-fg">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span className="flex-1">{message.error}</span>
            {onRetry && (
              <button onClick={onRetry} className="font-medium underline-offset-2 hover:underline">
                Retry
              </button>
            )}
          </div>
        )}
        {!streaming && message.status === "done" && (
          <>
            <CitationList citations={message.citations} />
            <Actions message={message} onRate={onRate} onRetry={onRetry} />
          </>
        )}
      </div>
    </div>
  );
}
