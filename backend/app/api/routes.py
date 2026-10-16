import asyncio
import json
import logging
import secrets
import tempfile
import time
from pathlib import Path

from fastapi import APIRouter, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from app.api.schemas import ChatRequest, FeedbackRequest
from app.core.config import get_settings
from app.llm.providers import AllProvidersFailed, get_router
from app.rag import vectorstore, workflow
from app.services import bootstrap, storage
from app.services.ingestion import SUPPORTED, ingest_file, slugify

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter(prefix="/api")

FRIENDLY_LLM_ERROR = "The language model service is temporarily unavailable. Please try again in a moment."


def require_admin(key: str) -> None:
    if not settings.admin_api_key:
        raise HTTPException(status_code=503, detail="Admin access is not configured on the server")
    if not secrets.compare_digest(key.encode(), settings.admin_api_key.encode()):
        raise HTTPException(status_code=401, detail="Invalid admin key")


def history_of(payload: ChatRequest) -> list[dict]:
    return [turn.model_dump() for turn in payload.history]


def persist(question: str, final: dict, started: float) -> tuple[str, int]:
    latency = int((time.perf_counter() - started) * 1000)
    query_id = storage.record_query(
        question=question,
        answer=final.get("answer", ""),
        source_used=final.get("source_used", "unknown"),
        provider=final.get("provider", ""),
        latency_ms=latency,
        rewritten_query=final.get("current_query", question),
        trace=final.get("trace", []),
        citations=final.get("citations", []),
    )
    return query_id, latency


@router.get("/health")
def health():
    return {
        "status": "ok",
        "service": settings.app_name,
        "environment": settings.app_env,
        "knowledge_base": bootstrap.state,
        "web_search": bool(settings.tavily_api_key),
        "providers": get_router().status(),
        "embedding_model": settings.embedding_model,
        "index": settings.pinecone_index_name,
    }


@router.post("/chat")
async def chat(payload: ChatRequest):
    started = time.perf_counter()
    try:
        final = await workflow.run(payload.question.strip(), history_of(payload))
    except AllProvidersFailed as exc:
        logger.error("All providers failed: %s", exc)
        raise HTTPException(status_code=503, detail=FRIENDLY_LLM_ERROR) from exc
    query_id, latency = await run_in_threadpool(persist, payload.question, final, started)
    return {
        "id": query_id,
        "answer": final.get("answer", ""),
        "source_used": final.get("source_used", ""),
        "provider": final.get("provider", ""),
        "citations": final.get("citations", []),
        "trace": final.get("trace", []),
        "rewritten_query": final.get("current_query", payload.question),
        "latency_ms": latency,
    }


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/chat/stream")
async def chat_stream(payload: ChatRequest):
    question = payload.question.strip()
    history = history_of(payload)

    async def events():
        started = time.perf_counter()
        yield ": stream-open\n\n"
        try:
            async for item in workflow.run_stream(question, history):
                kind = item.pop("type")
                if kind == "final":
                    final = item["state"]
                    query_id, latency = await run_in_threadpool(persist, question, final, started)
                    yield sse("done", {
                        "id": query_id,
                        "latency_ms": latency,
                        "provider": final.get("provider", ""),
                        "source_used": final.get("source_used", ""),
                        "rewritten_query": final.get("current_query", question),
                    })
                else:
                    yield sse(kind, item)
        except asyncio.CancelledError:
            raise
        except AllProvidersFailed as exc:
            logger.error("All providers failed: %s", exc)
            yield sse("error", {"message": FRIENDLY_LLM_ERROR})
        except Exception:
            logger.exception("Streaming chat failed")
            yield sse("error", {"message": "Something went wrong while generating the answer. Please try again."})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.post("/feedback")
def feedback(payload: FeedbackRequest):
    if not storage.record_feedback(payload.query_id, payload.rating, payload.comment.strip()):
        raise HTTPException(status_code=404, detail="Conversation turn not found")
    return {"status": "recorded"}


@router.get("/stats")
def stats():
    data = storage.stats()
    data["providers"] = get_router().status()
    data["knowledge_base"] = bootstrap.state
    data["recent"] = storage.list_queries(limit=6)[0]
    data["web_search"] = bool(settings.tavily_api_key)
    return data


@router.get("/logs")
def logs(
    limit: int = Query(default=25, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    source: str | None = Query(default=None, max_length=40),
):
    items, total = storage.list_queries(limit=limit, offset=offset, source=source)
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/documents")
def documents():
    items = storage.list_documents()
    return {"items": items, "total": len(items), "chunks": sum(d["chunks"] for d in items)}


@router.get("/admin/verify")
def verify_admin(x_admin_key: str = Header(default="")):
    require_admin(x_admin_key)
    return {"status": "ok"}


@router.post("/ingest")
async def ingest(file: UploadFile = File(...), x_admin_key: str = Header(default="")):
    require_admin(x_admin_key)
    name = Path(file.filename or "").name
    suffix = Path(name).suffix.lower()
    if suffix not in SUPPORTED:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{suffix or 'unknown'}'. Supported: {', '.join(sorted(SUPPORTED))}",
        )
    content = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(content) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds the {settings.max_upload_mb} MB limit")
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty")

    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / f"{slugify(name)}{suffix}"
        path.write_bytes(content)
        try:
            record = await run_in_threadpool(ingest_file, path, name, "upload")
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("Ingestion failed for %s", name)
            raise HTTPException(status_code=500, detail="Indexing failed. Check the server logs.") from exc
    return {"message": "Document indexed", **record}


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: str, x_admin_key: str = Header(default="")):
    require_admin(x_admin_key)
    record = storage.get_document(doc_id)
    removed = vectorstore.delete_document(doc_id, record["chunks"] if record else 0)
    existed = storage.delete_document(doc_id)
    if not removed and not existed:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"status": "deleted", "doc_id": doc_id, "chunks_removed": removed}
