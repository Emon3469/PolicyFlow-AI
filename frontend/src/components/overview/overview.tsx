"use client";

import {
  Activity as ActivityIcon,
  ChevronRight,
  FileText,
  Info,
  Layers,
  Library,
  Lightbulb,
  MessagesSquare,
  Plus,
  ShieldCheck,
  Timer,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { DocumentsTable } from "@/components/knowledge/documents-table";
import { UploadDialog } from "@/components/knowledge/upload-dialog";
import { Badge, Button, Card, CardHeader, EmptyState, Skeleton } from "@/components/ui/primitives";
import { useDocuments, useStats } from "@/lib/hooks";
import { sourceMeta } from "@/lib/sources";
import type { DocumentRecord, Stats } from "@/lib/types";
import { cn, formatDate, greeting, splitNumber } from "@/lib/utils";

const SEGMENT_COLORS = ["var(--c-blue)", "var(--c-amber)", "var(--c-graphite)", "var(--c-green)", "var(--border-strong)"];

function Stat({
  icon,
  label,
  value,
  fraction,
  footer,
  loading,
  className,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  fraction?: ReactNode;
  footer: ReactNode;
  loading: boolean;
  className?: string;
}) {
  return (
    <div className={cn("bg-surface p-4 sm:p-5", className)}>
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <span className="text-muted [&_svg]:size-4">{icon}</span>
        {label}
      </div>
      {loading ? (
        <>
          <Skeleton className="mt-6 h-8 w-24" />
          <Skeleton className="mt-3 h-4 w-32" />
        </>
      ) : (
        <>
          <p className="mt-5 flex items-baseline gap-1 text-[28px] leading-none font-semibold tracking-tight tabular-nums">
            {value}
            {fraction && <span className="text-[13px] font-medium text-muted">{fraction}</span>}
          </p>
          <div className="mt-3 text-[12.5px] text-muted">{footer}</div>
        </>
      )}
    </div>
  );
}

function StatsRow({ stats, loading }: { stats?: Stats; loading: boolean }) {
  const total = stats?.total_queries ?? 0;
  const sources = stats?.sources ?? {};
  const answerable = total - (sources.direct ?? 0);
  const grounded = answerable > 0 ? Math.round(((sources.private_kb ?? 0) / answerable) * 100) : null;
  const latency = splitNumber((stats?.avg_latency_ms ?? 0) / 1000, 1);
  const quality =
    grounded === null ? null : grounded >= 70 ? { label: "Good", tone: "text-ok-fg" } : grounded >= 40 ? { label: "Fair", tone: "text-warn-fg" } : { label: "Needs content", tone: "text-danger-fg" };

  return (
    <Card className="grid grid-cols-1 gap-px overflow-hidden bg-border sm:grid-cols-2 xl:grid-cols-4">
      <Stat
        icon={<Library />}
        label="Knowledge Base"
        loading={loading}
        value={(stats?.documents ?? 0).toLocaleString()}
        fraction={stats?.documents === 1 ? "document" : "documents"}
        footer={
          <>
            <span className="font-medium text-fg">{(stats?.chunks ?? 0).toLocaleString()}</span> searchable chunks
          </>
        }
      />
      <Stat
        icon={<MessagesSquare />}
        label="Questions Answered"
        loading={loading}
        value={total.toLocaleString()}
        footer={
          <>
            <span className="font-medium text-fg">{stats?.queries_today ?? 0}</span> asked today
          </>
        }
      />
      <Stat
        icon={<Timer />}
        label="Avg. Response Time"
        loading={loading}
        value={total ? latency.whole : "—"}
        fraction={total ? `${latency.fraction}s` : undefined}
        footer={total ? "Across the last 100 questions" : "No questions yet"}
      />
      <Stat
        icon={<ShieldCheck />}
        label="Grounded Answers"
        loading={loading}
        value={grounded ?? "—"}
        fraction={grounded !== null ? "/100" : undefined}
        footer={quality ? <span className={cn("font-medium", quality.tone)}>{quality.label}</span> : "Answered from private KB"}
        className="glow-tr"
      />
    </Card>
  );
}

function CoverageCard({ docs, loading }: { docs?: DocumentRecord[]; loading: boolean }) {
  const items = [...(docs ?? [])].sort((a, b) => b.chunks - a.chunks);
  const total = items.reduce((sum, doc) => sum + doc.chunks, 0);
  const segments = items.slice(0, 4);
  const rest = items.slice(4).reduce((sum, doc) => sum + doc.chunks, 0);
  const display = rest ? [...segments.map((d) => ({ label: d.title, value: d.chunks })), { label: "Other", value: rest }] : segments.map((d) => ({ label: d.title, value: d.chunks }));

  return (
    <Card>
      <CardHeader
        icon={<Layers />}
        title="Knowledge coverage by document"
        action={<span className="text-[12px] text-muted tabular-nums">{total.toLocaleString()} chunks total</span>}
      />
      <div className="px-4 pb-4">
        {loading && !docs ? (
          <Skeleton className="h-2.5 w-full rounded-full" />
        ) : (
          <div className="flex h-2.5 w-full gap-1 overflow-hidden rounded-full">
            {total === 0 ? (
              <div className="h-full w-full rounded-full bg-c-faint" />
            ) : (
              display.map((segment, index) => (
                <div
                  key={segment.label}
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${(segment.value / total) * 100}%`, background: SEGMENT_COLORS[index] }}
                  title={`${segment.label}: ${segment.value} chunks`}
                />
              ))
            )}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-muted">
          {display.map((segment, index) => (
            <span key={segment.label} className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-[3px]" style={{ background: SEGMENT_COLORS[index] }} />
              {segment.label}
              <span className="font-medium text-fg tabular-nums">{segment.value}</span>
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

function ActivityCard({ stats, loading }: { stats?: Stats; loading: boolean }) {
  const recent = stats?.recent ?? [];
  return (
    <Card className="flex flex-col">
      <CardHeader
        icon={<ActivityIcon />}
        title="Activity"
        action={
          <Link href="/activity" className="text-[12.5px] text-muted hover:text-fg">
            View All
          </Link>
        }
      />
      <div className="h-px bg-border" />
      {loading && !stats ? (
        <div className="space-y-4 p-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : recent.length === 0 ? (
        <EmptyState
          icon={<MessagesSquare />}
          title="No questions yet"
          description="Questions employees ask will appear here with their source and response time."
          action={
            <Link href="/assistant">
              <Button variant="primary" size="sm">Ask a question</Button>
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {recent.slice(0, 4).map((item) => {
            const meta = sourceMeta(item.source_used);
            return (
              <li key={item.id}>
                <Link href={`/activity?focus=${item.id}`} className="flex items-start gap-3 px-4 py-3.5 hover:bg-surface-2">
                  <span className="w-12 shrink-0 pt-0.5 text-[12.5px] text-muted">{formatDate(item.created_at)}</span>
                  <span className="mt-[7px] size-1.5 shrink-0 rounded-full" style={{ background: meta.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-[13px] font-medium">{item.question}</span>
                    <span className="mt-0.5 block text-[12px] text-muted">
                      {meta.label}
                      {item.provider && ` · ${item.provider}`} · {(item.latency_ms / 1000).toFixed(1)}s
                    </span>
                  </span>
                  <Badge tone={meta.tone}>{meta.short}</Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function RecommendationCard({ stats }: { stats?: Stats }) {
  const web = stats?.sources.web_search ?? 0;
  const missing = stats?.sources.insufficient_evidence ?? 0;
  const gaps = web + missing;
  const kbReady = stats?.knowledge_base.status === "ready";

  const content = !stats
    ? { title: "Checking your assistant…", body: "Gathering recent activity.", tip: "Recommendations update automatically.", href: "/insights" }
    : !kbReady
      ? {
          title: "Knowledge base is warming up",
          body: stats.knowledge_base.detail || "The index will be ready in a moment.",
          tip: "Free hosting can take up to a minute after idle periods.",
          href: "/settings",
        }
      : gaps > 0
        ? {
            title: "We found knowledge gaps",
            body: `${gaps} question${gaps === 1 ? "" : "s"} could not be answered from internal documents.`,
            tip: "Upload policies that cover these topics to keep answers grounded.",
            href: "/activity?source=web_search",
          }
        : {
            title: "Your assistant looks healthy",
            body: "Recent questions were answered from approved company knowledge.",
            tip: "Keep the knowledge base current as policies change.",
            href: "/insights",
          };

  return (
    <Card className="glow-tl relative overflow-hidden p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-c-blue/25 to-c-blue/5 text-info-fg ring-1 ring-c-blue/20">
          <Lightbulb className="size-5" />
        </div>
        <Link href={content.href} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-ok-fg hover:underline">
          View Recommendation <ChevronRight className="size-3" />
        </Link>
      </div>
      <p className="mt-3 text-[14px] font-medium">{content.title}</p>
      <p className="mt-1 text-[12.5px] text-muted">{content.body}</p>
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px] text-muted">
        <Info className="size-3.5 shrink-0" />
        {content.tip}
      </div>
    </Card>
  );
}

export function Overview() {
  const { data: stats, isLoading: statsLoading } = useStats();
  const { data: docs, isLoading: docsLoading } = useDocuments();
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-6 lg:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight">{greeting()}, HR Team!</h2>
          <p className="mt-1 text-[13px] text-muted">Here&apos;s how your HR policy assistant is performing today.</p>
        </div>
        <Button variant="primary" onClick={() => setUploadOpen(true)} className="h-9 px-4">
          <Plus /> Add Document
        </Button>
      </div>

      <div className="mt-6 space-y-4">
        <StatsRow stats={stats} loading={statsLoading && !stats} />
        <CoverageCard docs={docs?.items} loading={docsLoading} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <Card className="min-w-0">
            <CardHeader
              icon={<FileText />}
              title="Knowledge Documents"
              action={
                <Link href="/knowledge" className="text-[12.5px] text-muted hover:text-fg">
                  View All
                </Link>
              }
            />
            <DocumentsTable
              docs={docs?.items}
              loading={docsLoading}
              compact
              onRequireAdmin={() => setUploadOpen(true)}
              onUpload={() => setUploadOpen(true)}
            />
          </Card>
          <div className="min-w-0 space-y-4">
            <ActivityCard stats={stats} loading={statsLoading} />
            <RecommendationCard stats={stats} />
          </div>
        </div>
      </div>

      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}
