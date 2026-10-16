"use client";

import { Check, ChevronDown, Loader2, Workflow } from "lucide-react";
import { useState } from "react";
import type { TraceStep } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TraceTimeline({ steps, live }: { steps: TraceStep[]; live: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? live;
  const total = steps.reduce((sum, step) => sum + (step.status === "done" ? step.ms : 0), 0);
  const current = [...steps].reverse().find((step) => step.status === "running") ?? steps[steps.length - 1];

  if (!steps.length && !live) return null;

  return (
    <div className="rounded-xl border border-border bg-surface-2/60">
      <button
        onClick={() => setOpen(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-muted hover:text-fg"
      >
        {live ? <Loader2 className="size-3.5 animate-spin text-c-blue" /> : <Workflow className="size-3.5" />}
        <span className="min-w-0 flex-1 truncate">
          {live ? (current ? `${current.step}…` : "Understanding your question…") : `Agent workflow · ${steps.length} steps`}
        </span>
        {!live && total > 0 && <span className="tabular-nums text-subtle">{(total / 1000).toFixed(1)}s</span>}
        <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && steps.length > 0 && (
        <ol className="relative space-y-2.5 px-3 pt-1 pb-3">
          {steps.map((step, index) => {
            const running = step.status === "running";
            return (
              <li key={`${step.step}-${index}`} className="relative flex gap-2.5 animate-fade-in">
                {index < steps.length - 1 && <span className="absolute top-5 left-[7px] h-[calc(100%-6px)] w-px bg-border" />}
                <span
                  className={cn(
                    "relative mt-0.5 flex size-[15px] shrink-0 items-center justify-center rounded-full",
                    running ? "bg-info-bg text-info-fg" : "bg-ok-bg text-ok-fg",
                  )}
                >
                  {running ? <Loader2 className="size-2.5 animate-spin" /> : <Check className="size-2.5" strokeWidth={3} />}
                </span>
                <div className="min-w-0 flex-1 text-[12.5px]">
                  <span className="font-medium text-fg">{step.step}</span>
                  <span className="text-muted"> — {step.detail}</span>
                </div>
                {!running && step.ms > 0 && <span className="text-[11.5px] text-subtle tabular-nums">{step.ms} ms</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
