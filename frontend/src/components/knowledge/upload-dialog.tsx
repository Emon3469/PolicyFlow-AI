"use client";

import { CheckCircle2, FileUp, KeyRound, Loader2, UploadCloud } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/primitives";
import { ApiError, uploadDocument, verifyAdmin } from "@/lib/api";
import { useAdminKey } from "@/lib/hooks";
import { cn, formatBytes } from "@/lib/utils";

const ACCEPT = ".pdf,.docx,.md,.txt";
const MAX_MB = 10;

export function AdminKeyForm({ onVerified }: { onVerified?: () => void }) {
  const [, setKey] = useAdminKey();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!value.trim()) return;
    setBusy(true);
    setError("");
    try {
      await verifyAdmin(value.trim());
      setKey(value.trim());
      toast.success("Admin access granted for this session");
      onVerified?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="space-y-3"
    >
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3">
        <KeyRound className="size-4 text-subtle" />
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Admin key"
          autoComplete="off"
          className="h-10 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle"
        />
      </div>
      {error && <p className="text-[12.5px] text-danger-fg">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={busy || !value.trim()}>
        {busy && <Loader2 className="animate-spin" />}
        Verify access
      </Button>
      <p className="text-[12px] text-subtle">Stored only in this browser tab and cleared when you close it.</p>
    </form>
  );
}

export function UploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [adminKey, setAdminKey] = useAdminKey();
  const { mutate } = useSWRConfig();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const pick = (candidate: File | undefined) => {
    if (!candidate) return;
    const extension = candidate.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ACCEPT.includes(`.${extension}`)) {
      toast.error("Unsupported file type. Use PDF, DOCX, Markdown or TXT.");
      return;
    }
    if (candidate.size > MAX_MB * 1024 * 1024) {
      toast.error(`File is larger than ${MAX_MB} MB`);
      return;
    }
    setFile(candidate);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    pick(event.dataTransfer.files?.[0]);
  };

  const close = () => {
    if (busy) return;
    setFile(null);
    onClose();
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const result = await uploadDocument(file, adminKey);
      toast.success(`${result.title} indexed`, { description: `${result.chunks} chunks are now searchable.` });
      mutate((key) => typeof key === "string" && (key.startsWith("/api/documents") || key.startsWith("/api/stats") || key.startsWith("/api/health")));
      setFile(null);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAdminKey("");
        toast.error("Admin key is no longer valid");
      } else {
        toast.error(err instanceof Error ? err.message : "Upload failed");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={adminKey ? "Add HR document" : "Admin access required"}
      description={
        adminKey
          ? "PDF, DOCX, Markdown or TXT up to 10 MB. Uploading a file with the same name replaces the previous version."
          : "Only authorized HR staff can add documents to the knowledge base."
      }
    >
      {!adminKey ? (
        <AdminKeyForm />
      ) : (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex w-full flex-col items-center justify-center rounded-xl border border-dashed px-6 py-8 text-center transition-colors",
              dragging ? "border-c-blue bg-info-bg" : "border-border-strong bg-surface-2 hover:bg-surface-3",
            )}
          >
            {file ? (
              <>
                <CheckCircle2 className="mb-2 size-6 text-ok-fg" />
                <p className="max-w-full truncate text-[13px] font-medium">{file.name}</p>
                <p className="mt-0.5 text-[12px] text-muted">{formatBytes(file.size)} · click to change</p>
              </>
            ) : (
              <>
                <UploadCloud className="mb-2 size-6 text-subtle" />
                <p className="text-[13px] font-medium">Drop a file here or click to browse</p>
                <p className="mt-0.5 text-[12px] text-muted">Policies, handbooks, runbooks, forms</p>
              </>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(event) => {
              pick(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <div className="flex justify-end gap-2">
            <Button onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={!file || busy}>
              {busy ? <Loader2 className="animate-spin" /> : <FileUp />}
              {busy ? "Indexing…" : "Upload & index"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
