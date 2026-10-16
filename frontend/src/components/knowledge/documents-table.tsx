"use client";

import { ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, FileText, MoreHorizontal, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { Badge, Button, EmptyState, Skeleton } from "@/components/ui/primitives";
import { deleteDocument } from "@/lib/api";
import { useAdminKey } from "@/lib/hooks";
import type { DocumentRecord } from "@/lib/types";
import { cn, formatBytes, formatDate } from "@/lib/utils";

type SortKey = "title" | "chunks" | "size_bytes" | "updated_at";

function RowMenu({ doc, onRequireAdmin }: { doc: DocumentRecord; onRequireAdmin: () => void }) {
  const [open, setOpen] = useState(false);
  const [adminKey] = useAdminKey();
  const { mutate } = useSWRConfig();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => !ref.current?.contains(event.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const remove = async () => {
    setOpen(false);
    if (!adminKey) return onRequireAdmin();
    if (!window.confirm(`Remove “${doc.title}” from the knowledge base?`)) return;
    try {
      await deleteDocument(doc.doc_id, adminKey);
      toast.success(`${doc.title} removed`);
      mutate((key) => typeof key === "string" && (key.startsWith("/api/documents") || key.startsWith("/api/stats")));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove document");
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className="rounded-md p-1 text-subtle hover:bg-surface-3 hover:text-fg"
        aria-label="Document actions"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <div className="card absolute right-0 z-20 mt-1 w-40 p-1 shadow-lg animate-fade-in">
          <button
            onClick={remove}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-danger-fg hover:bg-danger-bg"
          >
            <Trash2 className="size-3.5" />
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string;
  column: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  return (
    <th className={cn("px-3 py-2.5 text-left font-medium", className)}>
      <button onClick={() => onSort(column)} className="inline-flex items-center gap-1 hover:text-fg">
        {label}
        <ChevronsUpDown className={cn("size-3", sort.key === column ? "text-fg" : "text-subtle")} />
      </button>
    </th>
  );
}

export function DocumentsTable({
  docs,
  loading,
  compact = false,
  onRequireAdmin,
  onUpload,
}: {
  docs: DocumentRecord[] | undefined;
  loading: boolean;
  compact?: boolean;
  onRequireAdmin: () => void;
  onUpload?: () => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "updated_at", dir: -1 });
  const [pageSize, setPageSize] = useState(compact ? 5 : 10);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const items = [...(docs ?? [])];
    items.sort((a, b) => {
      const left = a[sort.key];
      const right = b[sort.key];
      return (left > right ? 1 : left < right ? -1 : 0) * sort.dir;
    });
    return items;
  }, [docs, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1);
  const rows = sorted.slice(current * pageSize, current * pageSize + pageSize);
  const onSort = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : -1 }));

  if (loading && !docs) {
    return (
      <div className="space-y-3 px-4 pb-4">
        {Array.from({ length: compact ? 5 : 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (!sorted.length) {
    return (
      <EmptyState
        icon={<FileText />}
        title="No documents yet"
        description="Upload handbooks, policies or runbooks to give the assistant trusted company knowledge."
        action={onUpload && <Button variant="primary" onClick={onUpload}>Add document</Button>}
      />
    );
  }

  return (
    <div>
      <div className="overflow-x-auto px-4">
        <table className="w-full min-w-[520px] text-[13px]">
          <thead className="border-b border-border text-[12px] text-muted">
            <tr>
              <SortHeader label="Document" column="title" sort={sort} onSort={onSort} className="pl-0" />
              <SortHeader label="Chunks" column="chunks" sort={sort} onSort={onSort} />
              <SortHeader label={compact ? "Size" : "File size"} column="size_bytes" sort={sort} onSort={onSort} />
              {!compact && <SortHeader label="Updated" column="updated_at" sort={sort} onSort={onSort} />}
              <th className="px-3 py-2.5 text-left font-medium">Status</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((doc) => (
              <tr key={doc.doc_id} className="group">
                <td className="py-3 pr-3">
                  <p className="font-medium text-fg">{doc.title}</p>
                  <p className="mt-0.5 max-w-[240px] truncate text-[11.5px] text-subtle">
                    <span className="uppercase">{doc.file_type}</span> · {doc.name}
                  </p>
                </td>
                <td className="px-3 py-3 tabular-nums">{doc.chunks.toLocaleString()}</td>
                <td className="px-3 py-3 tabular-nums text-muted">{formatBytes(doc.size_bytes)}</td>
                {!compact && <td className="px-3 py-3 text-muted">{formatDate(doc.updated_at, true)}</td>}
                <td className="px-3 py-3">
                  <Badge tone={doc.origin === "seed" ? "neutral" : "ok"}>{doc.origin === "seed" ? "Starter" : "Indexed"}</Badge>
                </td>
                <td className="py-3 text-right">
                  <RowMenu doc={doc} onRequireAdmin={onRequireAdmin} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-[12.5px] text-muted">
        <label className="flex items-center gap-2">
          Rows per page
          <span className="relative">
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(0);
              }}
              className="h-7 appearance-none rounded-md border border-border bg-surface pr-6 pl-2 text-[12px] text-fg outline-none"
            >
              {[5, 10, 25].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1.5 right-1.5 size-3.5" />
          </span>
        </label>
        <div className="flex items-center gap-1">
          <span className="mr-2 hidden sm:inline">
            {current * pageSize + 1}–{Math.min(sorted.length, (current + 1) * pageSize)} of {sorted.length}
          </span>
          <Button variant="ghost" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
            <ChevronLeft /> Previous
          </Button>
          <span className="min-w-6 text-center text-fg tabular-nums">{current + 1}</span>
          <Button variant="ghost" size="sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Next <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
