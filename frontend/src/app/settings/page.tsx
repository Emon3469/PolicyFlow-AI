"use client";

import { KeyRound, Palette, Server } from "lucide-react";
import { AdminKeyForm } from "@/components/knowledge/upload-dialog";
import { ThemeSegmented } from "@/components/shell/theme-toggle";
import { Badge, Button, Card, CardHeader, Skeleton, StatusDot } from "@/components/ui/primitives";
import { API_URL } from "@/lib/api";
import { useAdminKey, useHealth } from "@/lib/hooks";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

export default function SettingsPage() {
  const { data, error, isLoading } = useHealth();
  const [adminKey, setAdminKey] = useAdminKey();
  const kb = data?.knowledge_base;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-12">
      <h2 className="text-[17px] font-semibold tracking-tight">Settings</h2>
      <p className="mt-1 text-[13px] text-muted">System status, appearance and admin access.</p>

      <div className="mt-6 space-y-4">
        <Card>
          <CardHeader icon={<Server />} title="System status" />
          <div className="divide-y divide-border px-4 pb-2">
            <Row label="API endpoint">
              <code className="rounded bg-surface-3 px-1.5 py-0.5 text-[12px]">{API_URL}</code>
            </Row>
            <Row label="Server">
              {isLoading && !data ? (
                <Skeleton className="h-5 w-20" />
              ) : (
                <Badge tone={error ? "warn" : "ok"}>
                  <StatusDot tone={error ? "warn" : "ok"} pulse={!!error} />
                  {error ? "Unreachable" : `Online · ${data?.environment}`}
                </Badge>
              )}
            </Row>
            <Row label="Knowledge base">
              {kb ? (
                <Badge tone={kb.status === "ready" ? "ok" : kb.status === "error" ? "danger" : "warn"}>
                  {kb.status === "ready" ? `Ready · ${kb.vectors} chunks` : kb.status === "error" ? "Error" : "Preparing"}
                </Badge>
              ) : (
                "—"
              )}
            </Row>
            {kb?.detail && (
              <Row label="Details">
                <span className="text-[12.5px] text-muted">{kb.detail}</span>
              </Row>
            )}
            <Row label="Web search fallback">
              <Badge tone={data?.web_search ? "ok" : "neutral"}>{data?.web_search ? "Enabled" : "Disabled"}</Badge>
            </Row>
            <Row label="Vector index">{data?.index ?? "—"}</Row>
            <Row label="Embedding model">{data?.embedding_model ?? "—"}</Row>
            {(data?.providers ?? []).map((p, index) => (
              <Row key={p.name} label={`LLM provider #${index + 1}`}>
                <span className="inline-flex items-center gap-2">
                  <span className="capitalize">{p.name}</span>
                  <Badge tone={!p.configured ? "neutral" : p.healthy ? "ok" : "warn"}>
                    {!p.configured ? "Not configured" : p.healthy ? "Active" : "Cooling down"}
                  </Badge>
                </span>
              </Row>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader icon={<Palette />} title="Appearance" />
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4">
            <p className="text-[13px] text-muted">Choose light, dark, or follow your system setting.</p>
            <ThemeSegmented />
          </div>
        </Card>

        <Card>
          <CardHeader icon={<KeyRound />} title="Admin access" />
          <div className="px-4 pb-4">
            {adminKey ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[13px] text-muted">You can upload and remove knowledge base documents in this session.</p>
                <Button onClick={() => setAdminKey("")}>Sign out</Button>
              </div>
            ) : (
              <div className="max-w-sm">
                <p className="mb-3 text-[13px] text-muted">Enter the admin key to manage knowledge base documents.</p>
                <AdminKeyForm />
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
