import logging
import threading
import time
from dataclasses import dataclass

from pinecone import Pinecone, ServerlessSpec

from app.core.config import get_settings
from app.rag.embeddings import embed_documents, embed_query

logger = logging.getLogger(__name__)
settings = get_settings()

UPSERT_BATCH = 96
FETCH_BATCH = 100
METADATA_TEXT_LIMIT = 8000

_client: Pinecone | None = None
_index = None
_lock = threading.Lock()


@dataclass
class Chunk:
    id: str
    text: str
    score: float
    metadata: dict

    @property
    def source(self) -> str:
        return self.metadata.get("source", "Private KB")

    def as_dict(self) -> dict:
        return {"id": self.id, "text": self.text, "score": self.score, "metadata": self.metadata}


def _pinecone() -> Pinecone:
    global _client
    if _client is None:
        if not settings.pinecone_api_key:
            raise RuntimeError("PINECONE_API_KEY is not configured")
        _client = Pinecone(api_key=settings.pinecone_api_key)
    return _client


def get_index():
    global _index
    if _index is not None:
        return _index
    with _lock:
        if _index is not None:
            return _index
        pc = _pinecone()
        name = settings.pinecone_index_name
        if not pc.has_index(name):
            logger.info("Creating Pinecone index %s (%s dims)", name, settings.embedding_dimension)
            pc.create_index(
                name=name,
                dimension=settings.embedding_dimension,
                metric="cosine",
                spec=ServerlessSpec(cloud=settings.pinecone_cloud, region=settings.pinecone_region),
            )
        for _ in range(60):
            description = pc.describe_index(name)
            if description.status.get("ready"):
                break
            time.sleep(1)
        if description.dimension != settings.embedding_dimension:
            raise RuntimeError(
                f"Pinecone index '{name}' has dimension {description.dimension}, but the embedding model "
                f"produces {settings.embedding_dimension}. Use a different PINECONE_INDEX_NAME."
            )
        _index = pc.Index(host=description.host)
        return _index


def vector_count() -> int:
    stats = get_index().describe_index_stats()
    namespace = stats.namespaces.get(settings.pinecone_namespace)
    return int(namespace.vector_count) if namespace else 0


def upsert_chunks(doc_id: str, texts: list[str], metadatas: list[dict]) -> int:
    index = get_index()
    vectors = embed_documents(texts)
    records = [
        {
            "id": f"{doc_id}#{position:04d}",
            "values": vector,
            "metadata": {**meta, "doc_id": doc_id, "text": text[:METADATA_TEXT_LIMIT]},
        }
        for position, (text, vector, meta) in enumerate(zip(texts, vectors, metadatas))
    ]
    for start in range(0, len(records), UPSERT_BATCH):
        index.upsert(vectors=records[start:start + UPSERT_BATCH], namespace=settings.pinecone_namespace)
    return len(records)


def list_ids(prefix: str | None = None) -> list[str]:
    ids: list[str] = []
    kwargs = {"namespace": settings.pinecone_namespace}
    if prefix:
        kwargs["prefix"] = prefix
    for page in get_index().list(**kwargs):
        for item in getattr(page, "vectors", page):
            ids.append(item if isinstance(item, str) else item.id)
    return ids


def chunk_ids(doc_id: str, count: int) -> list[str]:
    return [f"{doc_id}#{position:04d}" for position in range(count)]


def delete_document(doc_id: str, known_chunks: int = 0) -> int:
    listed = list_ids(prefix=f"{doc_id}#")
    ids = sorted(set(listed) | set(chunk_ids(doc_id, known_chunks)))
    index = get_index()
    for start in range(0, len(ids), FETCH_BATCH):
        index.delete(ids=ids[start:start + FETCH_BATCH], namespace=settings.pinecone_namespace)
    return max(len(listed), known_chunks)


def fetch_metadata(ids: list[str]) -> dict[str, dict]:
    index = get_index()
    found: dict[str, dict] = {}
    for start in range(0, len(ids), FETCH_BATCH):
        response = index.fetch(ids=ids[start:start + FETCH_BATCH], namespace=settings.pinecone_namespace)
        for vector_id, vector in response.vectors.items():
            found[vector_id] = dict(vector.metadata or {})
    return found


def search(query: str, top_k: int | None = None) -> list[Chunk]:
    vector = embed_query(query)
    response = get_index().query(
        vector=vector,
        top_k=top_k or settings.top_k,
        namespace=settings.pinecone_namespace,
        include_metadata=True,
    )
    chunks = []
    for match in response.matches:
        metadata = dict(match.metadata or {})
        text = metadata.pop("text", "")
        chunks.append(Chunk(id=match.id, text=text, score=round(float(match.score), 4), metadata=metadata))
    return chunks
