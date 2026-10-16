import { afterEach, describe, expect, it, vi } from "vitest";
import { API_URL, ApiError, request, streamChat, uploadDocument } from "@/lib/api";

function sseResponse(chunks: string[], status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

function collect() {
  const events: { type: string; payload: unknown }[] = [];
  return {
    events,
    handlers: {
      onTrace: (p: unknown) => events.push({ type: "trace", payload: p }),
      onMeta: (p: unknown) => events.push({ type: "meta", payload: p }),
      onToken: (p: string) => events.push({ type: "token", payload: p }),
      onDone: (p: unknown) => events.push({ type: "done", payload: p }),
      onError: (p: string) => events.push({ type: "error", payload: p }),
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("streamChat", () => {
  it("parses a full event stream in order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          ": stream-open\n\n",
          'event: trace\ndata: {"step":"Router","detail":"kb","status":"done","ms":5}\n\n',
          'event: meta\ndata: {"source_used":"private_kb","citations":[]}\n\n',
          'event: token\ndata: {"text":"Twenty "}\n\n',
          'event: token\ndata: {"text":"days."}\n\n',
          'event: done\ndata: {"id":"abc","latency_ms":900,"provider":"groq","source_used":"private_kb","rewritten_query":"q"}\n\n',
        ]),
      ),
    );
    const { events, handlers } = collect();
    await streamChat("How much leave?", [], handlers);
    expect(events.map((e) => e.type)).toEqual(["trace", "meta", "token", "token", "done"]);
    expect(events.filter((e) => e.type === "token").map((e) => e.payload).join("")).toBe("Twenty days.");
  });

  it("handles events split across network chunks and CRLF line endings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(["event: tok", 'en\r\ndata: {"te', 'xt":"Hel"}\r\n\r\nevent: token\r\n', 'data: {"text":"lo"}\r\n\r\n'])),
    );
    const { events, handlers } = collect();
    await streamChat("hi", [], handlers);
    expect(events.map((e) => e.payload)).toEqual(["Hel", "lo"]);
  });

  it("handles unicode split across byte boundaries", async () => {
    const bytes = new TextEncoder().encode('event: token\ndata: {"text":"café 👋"}\n\n');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 30));
        controller.enqueue(bytes.slice(30));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    const { events, handlers } = collect();
    await streamChat("hi", [], handlers);
    expect(events[0].payload).toBe("café 👋");
  });

  it("surfaces server error events", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(['event: error\ndata: {"message":"Service unavailable"}\n\n'])));
    const { events, handlers } = collect();
    await streamChat("hi", [], handlers);
    expect(events).toEqual([{ type: "error", payload: "Service unavailable" }]);
  });

  it("reports HTTP errors with the server detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: [{ msg: "String should have at least 1 character" }] }), { status: 422 })),
    );
    const { events, handlers } = collect();
    await streamChat("", [], handlers);
    expect(events[0]).toEqual({ type: "error", payload: "String should have at least 1 character" });
  });

  it("reports network failures as a friendly error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const { events, handlers } = collect();
    await streamChat("hi", [], handlers);
    expect(events[0].type).toBe("error");
    expect(String(events[0].payload)).toContain("Cannot reach the server");
  });

  it("stays silent when the user aborts", async () => {
    const abort = new DOMException("aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(abort)));
    const { events, handlers } = collect();
    await streamChat("hi", [], handlers, new AbortController().signal);
    expect(events).toEqual([]);
  });

  it("sends question and history as JSON to the stream endpoint", async () => {
    const fetchMock = vi.fn(async () => sseResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    await streamChat("And sick leave?", [{ role: "user", content: "Annual leave?" }], {});
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API_URL}/api/chat/stream`);
    expect(JSON.parse(String(init.body))).toEqual({ question: "And sick leave?", history: [{ role: "user", content: "Annual leave?" }] });
  });
});

describe("request helpers", () => {
  it("returns parsed JSON on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 })));
    await expect(request<{ status: string }>("/api/health")).resolves.toEqual({ status: "ok" });
  });

  it("throws ApiError with status and detail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Invalid admin key" }), { status: 401 })));
    const error = (await request("/api/admin/verify").catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.message).toBe("Invalid admin key");
  });

  it("maps network failures to status 0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    const error = (await request("/api/health").catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(0);
  });

  it("uploads documents as multipart with the admin key header", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: "ok", title: "Policy", chunks: 3 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["## Leave\n20 days"], "policy.md", { type: "text/markdown" });
    await uploadDocument(file, "secret");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Admin-Key"]).toBe("secret");
    expect(init.body).toBeInstanceOf(FormData);
  });
});
