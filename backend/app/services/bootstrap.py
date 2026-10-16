import logging
import threading
from collections import defaultdict
from pathlib import Path

from app.core.config import get_settings
from app.rag import vectorstore
from app.rag.embeddings import get_embedder
from app.services import storage
from app.services.ingestion import humanize, ingest_folder

logger = logging.getLogger(__name__)
settings = get_settings()

state = {"status": "starting", "detail": "", "vectors": 0}


def sync_registry() -> None:
    ids = vectorstore.list_ids()
    groups: dict[str, list[str]] = defaultdict(list)
    for vector_id in ids:
        groups[vector_id.split("#", 1)[0]].append(vector_id)
    known = {doc["doc_id"]: doc for doc in storage.list_documents()}
    missing = {doc_id: sorted(members) for doc_id, members in groups.items()
               if doc_id not in known or known[doc_id]["chunks"] != len(members)}
    if missing:
        first_chunks = vectorstore.fetch_metadata([members[0] for members in missing.values()])
        for doc_id, members in missing.items():
            meta = first_chunks.get(members[0], {})
            source = meta.get("source", doc_id)
            storage.upsert_document({
                "doc_id": doc_id,
                "name": source,
                "title": meta.get("title") or humanize(source),
                "file_type": meta.get("file_type") or Path(source).suffix.lstrip(".") or "txt",
                "chunks": len(members),
                "size_bytes": int(meta.get("size_bytes") or known.get(doc_id, {}).get("size_bytes", 0)),
                "origin": meta.get("origin") or known.get(doc_id, {}).get("origin", "upload"),
            })
    for doc_id in set(known) - set(groups):
        storage.delete_document(doc_id)
    state["vectors"] = len(ids)


def prepare_knowledge_base() -> None:
    try:
        state.update(status="loading", detail="Loading embedding model")
        get_embedder()
        if not settings.pinecone_api_key:
            state.update(status="error", detail="PINECONE_API_KEY is not configured")
            return
        state["detail"] = "Connecting to Pinecone"
        vectorstore.get_index()
        folder = Path(settings.knowledge_base_dir)
        if settings.seed_knowledge_base and vectorstore.vector_count() == 0 and folder.is_dir():
            state["detail"] = "Indexing starter knowledge base"
            indexed = ingest_folder(folder, origin="seed")
            state["vectors"] = sum(doc["chunks"] for doc in indexed)
            logger.info("Seeded knowledge base with %s documents", len(indexed))
        else:
            sync_registry()
        state.update(status="ready", detail="")
        logger.info("Knowledge base ready with %s vectors", state["vectors"])
    except Exception as exc:
        logger.exception("Knowledge base preparation failed")
        state.update(status="error", detail=str(exc)[:300])


def start_background_bootstrap() -> None:
    threading.Thread(target=prepare_knowledge_base, name="kb-bootstrap", daemon=True).start()
