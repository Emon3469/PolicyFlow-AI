import threading

from app.core.config import get_settings

_model = None
_lock = threading.Lock()


def get_embedder():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                from fastembed import TextEmbedding

                settings = get_settings()
                _model = TextEmbedding(settings.embedding_model, cache_dir=settings.model_cache_dir)
    return _model


def embed_documents(texts: list[str]) -> list[list[float]]:
    return [vector.tolist() for vector in get_embedder().embed(texts, batch_size=32)]


def embed_query(text: str) -> list[float]:
    return next(iter(get_embedder().query_embed(text))).tolist()
