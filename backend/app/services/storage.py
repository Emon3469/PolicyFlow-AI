import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.core.config import get_settings

settings = get_settings()
_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS queries (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL DEFAULT '',
    source_used TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT '',
    latency_ms INTEGER NOT NULL DEFAULT 0,
    rewritten_query TEXT NOT NULL DEFAULT '',
    trace_json TEXT NOT NULL DEFAULT '[]',
    citations_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_queries_created ON queries(created_at);
CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query_id TEXT NOT NULL,
    rating INTEGER NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
    doc_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    title TEXT NOT NULL,
    file_type TEXT NOT NULL,
    chunks INTEGER NOT NULL DEFAULT 0,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    origin TEXT NOT NULL DEFAULT 'upload',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def _connect():
    with _lock:
        conn = sqlite3.connect(settings.audit_db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()


def init_db() -> None:
    Path(settings.audit_db_path).parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.executescript(SCHEMA)


def record_query(
    question: str,
    answer: str,
    source_used: str,
    provider: str,
    latency_ms: int,
    rewritten_query: str,
    trace: list,
    citations: list,
) -> str:
    query_id = uuid.uuid4().hex
    with _connect() as conn:
        conn.execute(
            """INSERT INTO queries (id, created_at, question, answer, source_used, provider, latency_ms,
                                    rewritten_query, trace_json, citations_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (query_id, _now(), question, answer, source_used, provider, latency_ms,
             rewritten_query, json.dumps(trace), json.dumps(citations)),
        )
    return query_id


def record_feedback(query_id: str, rating: int, comment: str) -> bool:
    with _connect() as conn:
        exists = conn.execute("SELECT 1 FROM queries WHERE id = ?", (query_id,)).fetchone()
        if not exists:
            return False
        conn.execute(
            "INSERT INTO feedback (query_id, rating, comment, created_at) VALUES (?, ?, ?, ?)",
            (query_id, rating, comment, _now()),
        )
    return True


def _query_row(row: sqlite3.Row) -> dict:
    data = dict(row)
    data["trace"] = json.loads(data.pop("trace_json") or "[]")
    data["citations"] = json.loads(data.pop("citations_json") or "[]")
    return data


def list_queries(limit: int = 50, offset: int = 0, source: str | None = None) -> tuple[list[dict], int]:
    where, params = "", []
    if source:
        where, params = "WHERE q.source_used = ?", [source]
    with _connect() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM queries q {where}", params).fetchone()[0]
        rows = conn.execute(
            f"""SELECT q.*, (SELECT rating FROM feedback f WHERE f.query_id = q.id ORDER BY f.id DESC LIMIT 1) AS rating
                FROM queries q {where} ORDER BY q.created_at DESC LIMIT ? OFFSET ?""",
            [*params, limit, offset],
        ).fetchall()
    return [_query_row(row) for row in rows], total


def upsert_document(record: dict) -> None:
    now = _now()
    with _connect() as conn:
        conn.execute(
            """INSERT INTO documents (doc_id, name, title, file_type, chunks, size_bytes, origin, created_at, updated_at)
               VALUES (:doc_id, :name, :title, :file_type, :chunks, :size_bytes, :origin, :now, :now)
               ON CONFLICT(doc_id) DO UPDATE SET
                   name = excluded.name, title = excluded.title, file_type = excluded.file_type,
                   chunks = excluded.chunks, size_bytes = CASE WHEN excluded.size_bytes > 0
                   THEN excluded.size_bytes ELSE documents.size_bytes END,
                   origin = excluded.origin, updated_at = excluded.updated_at""",
            {**record, "now": now},
        )


def list_documents() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute("SELECT * FROM documents ORDER BY updated_at DESC").fetchall()
    return [dict(row) for row in rows]


def get_document(doc_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM documents WHERE doc_id = ?", (doc_id,)).fetchone()
    return dict(row) if row else None


def delete_document(doc_id: str) -> bool:
    with _connect() as conn:
        cursor = conn.execute("DELETE FROM documents WHERE doc_id = ?", (doc_id,))
    return cursor.rowcount > 0


def stats() -> dict:
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = (today - timedelta(days=6)).isoformat()
    with _connect() as conn:
        total = conn.execute("SELECT COUNT(*) FROM queries").fetchone()[0]
        today_count = conn.execute(
            "SELECT COUNT(*) FROM queries WHERE created_at >= ?", (today.isoformat(),)
        ).fetchone()[0]
        sources = {
            row["source_used"]: row["n"]
            for row in conn.execute("SELECT source_used, COUNT(*) AS n FROM queries GROUP BY source_used")
        }
        latency = conn.execute(
            "SELECT AVG(latency_ms) FROM (SELECT latency_ms FROM queries ORDER BY created_at DESC LIMIT 100)"
        ).fetchone()[0]
        feedback = conn.execute(
            "SELECT COUNT(*) AS n, SUM(CASE WHEN rating > 0 THEN 1 ELSE 0 END) AS up FROM feedback"
        ).fetchone()
        daily = conn.execute(
            """SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM queries
               WHERE created_at >= ? GROUP BY day ORDER BY day""",
            (week_ago,),
        ).fetchall()
        docs = conn.execute("SELECT COUNT(*) AS n, COALESCE(SUM(chunks), 0) AS chunks FROM documents").fetchone()

    days = {row["day"]: row["n"] for row in daily}
    trend = [
        {"day": (today - timedelta(days=offset)).date().isoformat(),
         "count": days.get((today - timedelta(days=offset)).date().isoformat(), 0)}
        for offset in range(6, -1, -1)
    ]
    return {
        "total_queries": total,
        "queries_today": today_count,
        "sources": sources,
        "avg_latency_ms": int(latency or 0),
        "feedback_total": feedback["n"] or 0,
        "feedback_positive": feedback["up"] or 0,
        "trend": trend,
        "documents": docs["n"],
        "chunks": docs["chunks"],
    }
