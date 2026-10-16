export type SourceUsed = "private_kb" | "web_search" | "direct" | "insufficient_evidence" | string;

export type TraceStep = {
  step: string;
  detail: string;
  status: "running" | "done" | string;
  ms: number;
};

export type Citation = {
  type: "private_kb" | "web";
  title: string;
  url?: string;
  source?: string;
  section?: string;
  page?: number | null;
  score?: number;
  snippet?: string;
};

export type Provider = {
  name: string;
  configured: boolean;
  healthy: boolean;
  model: string | null;
  fast_model: string | null;
  successes: number;
  failures: number;
  last_error: string;
};

export type KnowledgeBaseState = {
  status: "starting" | "loading" | "ready" | "error" | string;
  detail: string;
  vectors: number;
};

export type Health = {
  status: string;
  service: string;
  environment: string;
  knowledge_base: KnowledgeBaseState;
  web_search: boolean;
  providers: Provider[];
  embedding_model: string;
  index: string;
};

export type QueryLog = {
  id: string;
  created_at: string;
  question: string;
  answer: string;
  source_used: SourceUsed;
  provider: string;
  latency_ms: number;
  rewritten_query: string;
  trace: TraceStep[];
  citations: Citation[];
  rating: number | null;
};

export type Stats = {
  total_queries: number;
  queries_today: number;
  sources: Record<string, number>;
  avg_latency_ms: number;
  feedback_total: number;
  feedback_positive: number;
  trend: { day: string; count: number }[];
  documents: number;
  chunks: number;
  providers: Provider[];
  knowledge_base: KnowledgeBaseState;
  recent: QueryLog[];
  web_search: boolean;
};

export type DocumentRecord = {
  doc_id: string;
  name: string;
  title: string;
  file_type: string;
  chunks: number;
  size_bytes: number;
  origin: "seed" | "upload" | string;
  created_at: string;
  updated_at: string;
};

export type DocumentList = { items: DocumentRecord[]; total: number; chunks: number };

export type LogPage = { items: QueryLog[]; total: number; limit: number; offset: number };

export type ChatTurn = { role: "user" | "assistant"; content: string };
