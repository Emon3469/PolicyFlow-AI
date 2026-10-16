"use client";

import { Activity, ChevronDown, ChevronLeft, ChevronRight, MessagesSquare, ThumbsDown, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TraceTimeline } from "@/components/chat/trace";
import { Badge, Button, Card, EmptyState, Skeleton } from "@/components/ui/primitives";
import { useLogs } from "@/lib/hooks";
import { SOURCE_ORDER, sourceMeta } from "@/lib/sources";
import type { QueryLog } from "@/lib/types";
import { cn, formatDate, timeAgo } from "@/lib/utils";

const PAGE_SIZE = 15;

function Row({ item, defaultOpen }: { item: QueryLog; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const meta = sourceMeta(item.source_used);
  return (
    <li id={item.id} className={cn(defaultOpen && "bg-surface-2/60")}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-surface-2">
        <span className="mt-[7px] size-1.5 shrink-0 rounded-full" style={{ background: meta.color }} />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-1 text-[13px] font-medium">{item.question}</span>
          <span className="mt-0.5 block text-[12px] text-muted">
            {timeAgo(item.created_at)} · {item.provider || "—"} · {(item.latency_ms / 1000).toFixed(1)}s
          </span>
        </span>
        {item.rating === 1 && <ThumbsUp className="mt-0.5 size-3.5 text-ok-fg" />}
        {item.rating === -1 && <ThumbsDown className="mt-0.5 size-3.5 text-danger-fg" />}
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-subtle transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="grid grid-cols-1 gap-4 px-4 pb-5 pl-[34px] animate-fade-in lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-3">
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="mb-2 text-[11.5px] font-medium tracking-wide text-subtle uppercase">Answer</p>
              <div className="markdown text-[13.5px]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.answer || "_No answer recorded._"}</ReactMarkdown>
              </div>
            </div>
            {item.rewritten_query && item.rewritten_query !== item.question && (
              <p className="text-[12.5px] text-muted">
                Rewritten query: <span className="text-fg">{item.rewritten_query}</span>
              </p>
            )}
          </div>
          <div className="min-w-0 space-y-3">
            <TraceTimeline steps={item.trace} live={false} />
            {item.citations.length > 0 && (
              <div className="rounded-xl border border-border bg-surface p-3">
                <p className="mb-2 text-[11.5px] font-medium tracking-wide text-subtle uppercase">Sources</p>
                <ul className="space-y-1.5 text-[12.5px]">
                  {item.citations.map((c, i) => (
                    <li key={i} className="truncate">
                      {c.url ? (
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-info-fg hover:underline">
                          {c.title}
                        </a>
                      ) : (
                        <span>
                          {c.title}
                          {c.section && <span className="text-muted"> · {c.section}</span>}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[12px] text-subtle">{formatDate(item.created_at, true)} · ID {item.id.slice(0, 12)}</p>
          </div>
        </div>
      )}
    </li>
  );
}

export function ActivityLog() {
  const params = useSearchParams();
  const focus = params.get("focus");
  const [source, setSource] = useState<string | null>(params.get("source"));
  const [page, setPage] = useState(0);
  const { data, isLoading } = useLogs(page, PAGE_SIZE, source);
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  useEffect(() => {
    if (focus && data) document.getElementById(focus)?.scrollIntoView({ block: "center" });
  }, [focus, data]);

  const filters: (string | null)[] = [null, ...SOURCE_ORDER];

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-6 lg:py-12">
      <div>
        <h2 className="text-[17px] font-semibold tracking-tight">Audit Log</h2>
        <p className="mt-1 text-[13px] text-muted">Every question with its answer, sources and the decisions the agent made.</p>
      </div>

      <div className="mt-6 flex flex-wrap gap-1.5">
        {filters.map((value) => (
          <button
            key={value ?? "all"}
            onClick={() => {
              setSource(value);
              setPage(0);
            }}
            className={cn(
              "h-8 rounded-lg border px-3 text-[12.5px] transition-colors",
              source === value ? "border-border-strong bg-surface font-medium text-fg shadow-sm" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {value ? sourceMeta(value).label : "All"}
          </button>
        ))}
      </div>

      <Card className="mt-3 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-[13px] font-medium">
          <Activity className="size-4 text-muted" />
          {data ? `${data.total.toLocaleString()} ${data.total === 1 ? "entry" : "entries"}` : "Loading"}
        </div>
        {isLoading && !data ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : !data?.items.length ? (
          <EmptyState
            icon={<MessagesSquare />}
            title="Nothing here yet"
            description="Questions asked through the assistant are logged here for transparency and review."
            action={
              <Link href="/assistant">
                <Button variant="primary" size="sm">Open assistant</Button>
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {data.items.map((item) => (
              <Row key={item.id} item={item} defaultOpen={item.id === focus} />
            ))}
          </ul>
        )}
        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-end gap-1 border-t border-border px-4 py-3 text-[12.5px] text-muted">
            <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              <ChevronLeft /> Previous
            </Button>
            <span className="px-2 text-fg tabular-nums">
              {page + 1} / {pages}
            </span>
            <Button variant="ghost" size="sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
              Next <ChevronRight />
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
