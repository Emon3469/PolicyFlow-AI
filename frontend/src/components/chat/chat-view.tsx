"use client";

import { ArrowUp, CalendarDays, Clock, Globe2, Laptop, Square, SquarePen, Wallet } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useSWRConfig } from "swr";
import { Button } from "@/components/ui/primitives";
import { LogoMark } from "@/components/ui/logo";
import { streamChat } from "@/lib/api";
import type { ChatTurn, TraceStep } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MessageView, type ChatMessage } from "./message";

const STORAGE_KEY = "policyflow.conversation.v1";
const HISTORY_TURNS = 6;

const SUGGESTIONS = [
  { icon: CalendarDays, label: "Leave", text: "How many annual leave days do employees receive?" },
  { icon: Laptop, label: "Remote work", text: "What is the remote work policy?" },
  { icon: Wallet, label: "Payroll", text: "How do I report a payroll discrepancy?" },
  { icon: Globe2, label: "Public info", text: "What are the upcoming public holidays in Bangladesh this year?" },
];

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function loadConversation(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    return parsed.filter((m) => m.status !== "streaming");
  } catch {
    return [];
  }
}

function saveConversation(messages: ChatMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.filter((m) => m.status !== "streaming").slice(-40)));
  } catch {}
}

function mergeTrace(trace: TraceStep[], step: TraceStep) {
  const last = trace[trace.length - 1];
  if (last && last.step === step.step && last.status === "running") return [...trace.slice(0, -1), step];
  return [...trace, step];
}

export function ChatView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { mutate } = useSWRConfig();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pending = useRef("");
  const frame = useRef<number | null>(null);
  const handledQuery = useRef<string | null>(null);

  useEffect(() => {
    setMessages(loadConversation());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveConversation(messages);
  }, [messages, hydrated]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const patch = useCallback((id: string, update: (message: ChatMessage) => ChatMessage) => {
    setMessages((current) => current.map((message) => (message.id === id ? update(message) : message)));
  }, []);

  const flush = useCallback(
    (id: string, all = false) => {
      if (!pending.current) return;
      const take = all ? pending.current.length : Math.max(3, Math.ceil(pending.current.length / 6));
      const chunk = pending.current.slice(0, take);
      pending.current = pending.current.slice(take);
      patch(id, (m) => ({ ...m, content: m.content + chunk }));
    },
    [patch],
  );

  const startTypewriter = useCallback(
    (id: string) => {
      const tick = () => {
        flush(id);
        frame.current = requestAnimationFrame(tick);
      };
      if (frame.current === null) frame.current = requestAnimationFrame(tick);
    },
    [flush],
  );

  const stopTypewriter = useCallback(
    (id: string) => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      flush(id, true);
    },
    [flush],
  );

  const ask = useCallback(
    async (raw: string, base?: ChatMessage[]) => {
      const question = raw.trim();
      if (!question || busy) return;

      const prior = base ?? messages;
      const history: ChatTurn[] = prior
        .filter((m) => m.status === "done" && m.content)
        .slice(-HISTORY_TURNS)
        .map((m) => ({ role: m.role, content: m.content }));

      const userMessage: ChatMessage = { id: uid(), role: "user", content: question, status: "done", trace: [], citations: [] };
      const assistantId = uid();
      const assistant: ChatMessage = { id: assistantId, role: "assistant", content: "", status: "streaming", trace: [], citations: [] };

      setMessages([...prior, userMessage, assistant]);
      setInput("");
      setBusy(true);
      stickToBottom.current = true;
      pending.current = "";

      const controller = new AbortController();
      abortRef.current = controller;
      let failed = false;

      await streamChat(
        question,
        history,
        {
          onTrace: (step) => patch(assistantId, (m) => ({ ...m, trace: mergeTrace(m.trace, step) })),
          onMeta: (meta) => patch(assistantId, (m) => ({ ...m, source: meta.source_used, citations: meta.citations })),
          onToken: (text) => {
            pending.current += text;
            startTypewriter(assistantId);
          },
          onDone: (done) =>
            patch(assistantId, (m) => ({
              ...m,
              queryId: done.id,
              latencyMs: done.latency_ms,
              provider: done.provider,
              source: done.source_used || m.source,
            })),
          onError: (message) => {
            failed = true;
            patch(assistantId, (m) => ({ ...m, status: "error", error: message }));
          },
        },
        controller.signal,
      );

      stopTypewriter(assistantId);
      patch(assistantId, (m) => {
        if (failed || m.status === "error") return { ...m, status: "error" };
        if (controller.signal.aborted) return { ...m, status: "done", content: m.content || "_Stopped._" };
        if (!m.content) return { ...m, status: "error", error: "No answer was returned. Please try again." };
        return { ...m, status: "done" };
      });
      abortRef.current = null;
      setBusy(false);
      mutate((key) => typeof key === "string" && (key.startsWith("/api/stats") || key.startsWith("/api/logs") || key.startsWith("/api/health")));
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [busy, messages, patch, startTypewriter, stopTypewriter, mutate],
  );

  useEffect(() => {
    const q = searchParams.get("q");
    if (!hydrated || !q || handledQuery.current === q) return;
    handledQuery.current = q;
    router.replace("/assistant");
    ask(q);
  }, [hydrated, searchParams, router, ask]);

  const retry = (index: number) => {
    const question = messages[index - 1];
    if (question?.role !== "user") return;
    ask(question.content, messages.slice(0, index - 1));
  };

  const newChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setInput("");
    textareaRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      ask(input);
    }
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  const empty = hydrated && messages.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {empty ? (
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center px-4 py-10">
            <div className="glow-tl flex size-14 items-center justify-center rounded-2xl border border-border bg-surface shadow-sm">
              <LogoMark className="size-9" />
            </div>
            <h2 className="mt-5 text-center text-[22px] font-semibold tracking-tight">How can I help you today?</h2>
            <p className="mt-2 max-w-md text-center text-[13.5px] text-muted">
              Ask about leave, benefits, payroll, remote work or onboarding. Answers come from approved company policy first, with
              sources you can check.
            </p>
            <div className="mt-8 grid w-full gap-2.5 sm:grid-cols-2">
              {SUGGESTIONS.map(({ icon: Icon, label, text }) => (
                <button
                  key={text}
                  onClick={() => ask(text)}
                  className="card group flex items-start gap-3 p-3.5 text-left transition-colors hover:border-border-strong hover:bg-surface-2"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-muted group-hover:text-fg">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11.5px] font-medium text-subtle">{label}</span>
                    <span className="mt-0.5 block text-[13px] leading-snug text-fg">{text}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-7 px-4 py-8">
            {messages.map((message, index) => (
              <MessageView
                key={message.id}
                message={message}
                onRate={(rating) => patch(message.id, (m) => ({ ...m, rating }))}
                onRetry={message.role === "assistant" && !busy && index === messages.length - 1 ? () => retry(index) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 pb-4 sm:pb-6">
        <div className="mx-auto w-full max-w-3xl">
          {messages.length > 0 && (
            <div className="mb-2 flex justify-center">
              <Button variant="ghost" size="sm" onClick={newChat} disabled={busy}>
                <SquarePen /> New conversation
              </Button>
            </div>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              ask(input);
            }}
            className="card flex items-end gap-2 p-2 pl-4 shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-1 focus-within:ring-border-strong"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              maxLength={3000}
              placeholder="Ask an HR policy question…"
              className="max-h-[180px] min-h-[24px] flex-1 resize-none bg-transparent py-2 text-[14px] leading-6 outline-none placeholder:text-subtle"
              autoFocus
            />
            {busy ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-3 text-fg hover:bg-surface-2"
                aria-label="Stop generating"
              >
                <Square className="size-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className={cn(
                  "btn-primary flex size-9 shrink-0 items-center justify-center rounded-xl transition-opacity",
                  !input.trim() && "opacity-40",
                )}
                aria-label="Send message"
              >
                <ArrowUp className="size-4" />
              </button>
            )}
          </form>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11.5px] text-subtle">
            <Clock className="size-3" />
            Answers are grounded in company documents. Confirm important decisions with HR.
          </p>
        </div>
      </div>
    </div>
  );
}
