import type { ChatTurn, Citation, TraceStep } from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function parseError(response: Response) {
  try {
    const body = await response.json();
    const detail = body?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((d) => d.msg).join(", ");
  } catch {}
  return `Request failed (${response.status})`;
}

export async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 70000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_URL}${path}`, { ...init, signal: init.signal ?? controller.signal });
    if (!response.ok) throw new ApiError(await parseError(response), response.status);
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as Error).name === "AbortError") throw new ApiError("The server took too long to respond", 408);
    throw new ApiError("Cannot reach the server", 0);
  } finally {
    clearTimeout(timer);
  }
}

export const fetcher = <T,>(path: string) => request<T>(path);

export function uploadDocument(file: File, adminKey: string) {
  const body = new FormData();
  body.append("file", file);
  return request<{ message: string; title: string; chunks: number }>(
    "/api/ingest",
    { method: "POST", body, headers: { "X-Admin-Key": adminKey } },
    180000,
  );
}

export function deleteDocument(docId: string, adminKey: string) {
  return request<{ status: string }>(`/api/documents/${encodeURIComponent(docId)}`, {
    method: "DELETE",
    headers: { "X-Admin-Key": adminKey },
  });
}

export function verifyAdmin(adminKey: string) {
  return request<{ status: string }>("/api/admin/verify", { headers: { "X-Admin-Key": adminKey } });
}

export function sendFeedback(queryId: string, rating: 1 | -1) {
  return request<{ status: string }>("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query_id: queryId, rating }),
  });
}

export type StreamHandlers = {
  onTrace?: (step: TraceStep) => void;
  onMeta?: (meta: { source_used: string; citations: Citation[] }) => void;
  onToken?: (text: string) => void;
  onDone?: (done: { id: string; latency_ms: number; provider: string; source_used: string; rewritten_query: string }) => void;
  onError?: (message: string) => void;
};

export async function streamChat(
  question: string,
  history: ChatTurn[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ question, history }),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    handlers.onError?.("Cannot reach the server. It may be waking up — please try again in a few seconds.");
    return;
  }
  if (!response.ok || !response.body) {
    handlers.onError?.(await parseError(response));
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (raw: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    let payload: any;
    try {
      payload = JSON.parse(data.join("\n"));
    } catch {
      return;
    }
    if (event === "token") handlers.onToken?.(payload.text);
    else if (event === "trace") handlers.onTrace?.(payload);
    else if (event === "meta") handlers.onMeta?.(payload);
    else if (event === "done") handlers.onDone?.(payload);
    else if (event === "error") handlers.onError?.(payload.message);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        dispatch(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim()) dispatch(buffer);
  } catch (error) {
    if ((error as Error).name !== "AbortError") handlers.onError?.("The connection was interrupted.");
  }
}
