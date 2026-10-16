export type Tone = "ok" | "warn" | "info" | "neutral" | "danger";

type SourceMeta = { label: string; short: string; tone: Tone; color: string };

export const SOURCES: Record<string, SourceMeta> = {
  private_kb: { label: "Private KB", short: "Grounded", tone: "ok", color: "var(--c-blue)" },
  web_search: { label: "Web search", short: "Web", tone: "warn", color: "var(--c-amber)" },
  direct: { label: "Direct reply", short: "Direct", tone: "neutral", color: "var(--c-graphite)" },
  insufficient_evidence: { label: "Insufficient", short: "No answer", tone: "danger", color: "var(--danger-fg)" },
};

export const SOURCE_ORDER = ["private_kb", "web_search", "direct", "insufficient_evidence"] as const;

export function sourceMeta(source: string): SourceMeta {
  return SOURCES[source] ?? { label: source || "Unknown", short: source || "—", tone: "neutral", color: "var(--c-faint)" };
}
