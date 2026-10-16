"use client";

import { BarChart3, Cpu, PieChart, ThumbsUp } from "lucide-react";
import { Badge, Card, CardHeader, Skeleton, StatusDot } from "@/components/ui/primitives";
import { useStats } from "@/lib/hooks";
import { SOURCE_ORDER, sourceMeta } from "@/lib/sources";

export default function InsightsPage() {
  const { data: stats, isLoading } = useStats();
  const trend = stats?.trend ?? [];
  const peak = Math.max(1, ...trend.map((d) => d.count));
  const total = stats?.total_queries ?? 0;
  const satisfaction = stats?.feedback_total ? Math.round((stats.feedback_positive / stats.feedback_total) * 100) : null;

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-6 lg:py-12">
      <h2 className="text-[17px] font-semibold tracking-tight">Insights</h2>
      <p className="mt-1 text-[13px] text-muted">How employees use the assistant and where answers come from.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader icon={<BarChart3 />} title="Questions · last 7 days" action={<span className="text-[12px] text-muted">{total} all-time</span>} />
          <div className="px-4 pb-4">
            {isLoading && !stats ? (
              <Skeleton className="h-44 w-full" />
            ) : (
              <div className="flex h-44 items-end gap-2 sm:gap-3">
                {trend.map((day) => (
                  <div key={day.day} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                    <span className="text-[11px] text-muted tabular-nums">{day.count || ""}</span>
                    <div
                      className="w-full max-w-10 rounded-md bg-gradient-to-t from-c-blue/70 to-c-blue transition-all duration-700"
                      style={{ height: `${Math.max(4, (day.count / peak) * 100)}%`, opacity: day.count ? 1 : 0.25 }}
                    />
                    <span className="text-[11px] text-subtle">
                      {new Date(`${day.day}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader icon={<PieChart />} title="Answer sources" />
          <div className="space-y-3 px-4 pb-4">
            {SOURCE_ORDER.map((key) => {
              const meta = sourceMeta(key);
              const count = stats?.sources[key] ?? 0;
              const pct = total ? Math.round((count / total) * 100) : 0;
              return (
                <div key={key}>
                  <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
                    <span className="flex items-center gap-2">
                      <span className="size-2 rounded-[3px]" style={{ background: meta.color }} />
                      {meta.label}
                    </span>
                    <span className="text-muted tabular-nums">
                      {count} · {pct}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-c-faint">
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: meta.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader icon={<Cpu />} title="Model providers" action={<span className="text-[12px] text-muted">Automatic failover</span>} />
          <div className="overflow-x-auto px-4 pb-2">
            <table className="w-full min-w-[440px] text-[13px]">
              <thead className="border-b border-border text-[12px] text-muted">
                <tr>
                  <th className="py-2.5 text-left font-medium">Priority</th>
                  <th className="px-3 py-2.5 text-left font-medium">Provider</th>
                  <th className="px-3 py-2.5 text-left font-medium">Model</th>
                  <th className="px-3 py-2.5 text-right font-medium">Calls</th>
                  <th className="py-2.5 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(stats?.providers ?? []).map((p, i) => (
                  <tr key={p.name}>
                    <td className="py-3 text-muted tabular-nums">#{i + 1}</td>
                    <td className="px-3 py-3 font-medium capitalize">{p.name}</td>
                    <td className="max-w-[160px] truncate px-3 py-3 text-muted">{p.model ?? "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{p.successes}</td>
                    <td className="py-3 text-right">
                      <Badge tone={!p.configured ? "neutral" : p.healthy ? "ok" : "warn"}>
                        <StatusDot tone={!p.configured ? "neutral" : p.healthy ? "ok" : "warn"} />
                        {!p.configured ? "Not set" : p.healthy ? "Active" : "Cooling down"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader icon={<ThumbsUp />} title="Answer satisfaction" />
          <div className="px-4 pb-5">
            <p className="flex items-baseline gap-1 text-[28px] leading-none font-semibold tabular-nums">
              {satisfaction ?? "—"}
              {satisfaction !== null && <span className="text-[13px] font-medium text-muted">%</span>}
            </p>
            <p className="mt-2 text-[12.5px] text-muted">
              {stats?.feedback_total
                ? `${stats.feedback_positive} of ${stats.feedback_total} rated answers were helpful.`
                : "Thumbs up or down on answers to start measuring quality."}
            </p>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-c-faint">
              <div className="h-full rounded-full bg-c-green transition-all duration-700" style={{ width: `${satisfaction ?? 0}%` }} />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
