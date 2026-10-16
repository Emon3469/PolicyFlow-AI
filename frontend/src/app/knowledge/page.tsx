"use client";

import { Database, FileText, KeyRound, Plus, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { DocumentsTable } from "@/components/knowledge/documents-table";
import { UploadDialog } from "@/components/knowledge/upload-dialog";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { useAdminKey, useDocuments, useHealth } from "@/lib/hooks";

export default function KnowledgePage() {
  const { data, isLoading } = useDocuments();
  const { data: health } = useHealth();
  const [adminKey, setAdminKey] = useAdminKey();
  const [uploadOpen, setUploadOpen] = useState(false);

  const facts = [
    { icon: FileText, label: "Documents", value: data?.total ?? "—" },
    { icon: Database, label: "Searchable chunks", value: data?.chunks ?? "—" },
    { icon: ShieldCheck, label: "Embedding model", value: health?.embedding_model.split("/").pop() ?? "—" },
  ];

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-6 lg:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight">Knowledge Base</h2>
          <p className="mt-1 text-[13px] text-muted">Approved HR documents the assistant searches before anything else.</p>
        </div>
        <div className="flex items-center gap-2">
          {adminKey ? (
            <Button variant="ghost" onClick={() => setAdminKey("")}>
              <KeyRound /> Sign out admin
            </Button>
          ) : (
            <Badge tone="neutral">
              <KeyRound className="size-3" /> Read-only
            </Badge>
          )}
          <Button variant="primary" onClick={() => setUploadOpen(true)} className="px-4">
            <Plus /> Add Document
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {facts.map(({ icon: Icon, label, value }) => (
          <Card key={label} className="flex items-center gap-3 p-4">
            <span className="flex size-9 items-center justify-center rounded-lg bg-surface-3 text-muted">
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[12px] text-muted">{label}</p>
              <p className="truncate text-[15px] font-semibold tabular-nums">{value}</p>
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardHeader icon={<FileText />} title="All documents" action={<span className="text-[12px] text-muted">Index: {health?.index ?? "—"}</span>} />
        <DocumentsTable
          docs={data?.items}
          loading={isLoading}
          onRequireAdmin={() => setUploadOpen(true)}
          onUpload={() => setUploadOpen(true)}
        />
      </Card>

      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}
