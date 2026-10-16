import { ArrowDown, CheckCircle2, CornerDownRight, Database, FileSearch, Globe, PenLine, Route, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Workflow" };

function Node({ n, icon, title, body, tone = "default" }: { n: number; icon: ReactNode; title: string; body: string; tone?: "default" | "grade" | "answer" }) {
  const ring = tone === "grade" ? "ring-c-amber/40 bg-warn-bg/50" : tone === "answer" ? "ring-c-green/30 bg-ok-bg/60" : "ring-border bg-surface";
  return (
    <div className={`flex items-start gap-3 rounded-xl p-3.5 ring-1 ${ring}`}>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-semibold text-primary-fg">{n}</span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[13px] font-medium">
          <span className="text-muted [&_svg]:size-3.5">{icon}</span>
          {title}
        </p>
        <p className="mt-0.5 text-[12.5px] text-muted">{body}</p>
      </div>
    </div>
  );
}

function Arrow({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-1.5 pl-[22px] text-[11.5px] text-subtle">
      <ArrowDown className="size-3.5" />
      {label}
    </div>
  );
}

export default function WorkflowPage() {
  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-6 lg:py-12">
      <h2 className="text-[17px] font-semibold tracking-tight">Agent Workflow</h2>
      <p className="mt-1 max-w-2xl text-[13px] text-muted">
        Unlike a fixed retrieve-then-generate pipeline, PolicyFlow decides at every step: it grades evidence before answering, falls back to
        the web only when internal knowledge is weak, and refuses to guess when nothing reliable is found.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-6 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="card p-5">
          <Node n={1} icon={<Route />} title="Route the question" body="Classifies HR questions vs. small talk while prefetching knowledge in parallel." />
          <Arrow />
          <Node n={2} icon={<Database />} title="Retrieve from Pinecone" body="Semantic search over private HR documents (top-k chunks)." />
          <Arrow />
          <Node n={3} icon={<ShieldCheck />} title="Grade KB evidence" body="Relevance threshold plus an LLM judge decide if evidence is sufficient." tone="grade" />
          <div className="my-2 ml-[22px] flex items-center gap-2 text-[12px] text-ok-fg">
            <CornerDownRight className="size-3.5" /> Good → <span className="font-medium">Generate answer from company knowledge</span>
          </div>
          <Arrow label="Weak" />
          <Node n={4} icon={<Globe />} title="Web search (Tavily)" body="Controlled fallback for public or recent information." />
          <Arrow />
          <Node n={5} icon={<FileSearch />} title="Grade web evidence" body="Only sufficient, relevant results are used." tone="grade" />
          <div className="my-2 ml-[22px] flex items-center gap-2 text-[12px] text-ok-fg">
            <CornerDownRight className="size-3.5" /> Good → <span className="font-medium">Generate answer, clearly labelled as external</span>
          </div>
          <Arrow label="Weak" />
          <Node n={6} icon={<PenLine />} title="Rewrite & retry" body="Rewrites the query with precise HR terms and runs retrieval again (bounded retries)." />
          <Arrow label="Still weak" />
          <Node n={7} icon={<XCircle />} title="Decline safely" body="Explains that no reliable evidence was found and points to HR." tone="answer" />
        </div>

        <div className="space-y-4">
          <div className="card p-5">
            <p className="flex items-center gap-2 text-[13px] font-medium">
              <Sparkles className="size-4 text-muted" /> What makes it reliable
            </p>
            <ul className="mt-3 space-y-2.5 text-[13px]">
              {[
                "Private knowledge first, web only as a labelled fallback",
                "Evidence is graded before any answer is generated",
                "Automatic failover across OpenAI, Anthropic and Groq",
                "Streaming answers with sources and a full decision trace",
                "Every interaction is audited for review",
              ].map((text) => (
                <li key={text} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok-fg" />
                  <span className="text-muted">{text}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card p-5">
            <p className="text-[13px] font-medium">Stack</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {["LangGraph", "FastAPI", "Pinecone", "MiniLM embeddings", "Tavily", "SQLite audit", "Next.js", "Tailwind CSS"].map((t) => (
                <span key={t} className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-muted">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
