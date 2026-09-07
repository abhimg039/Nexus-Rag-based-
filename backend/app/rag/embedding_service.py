"""Embedding generation.

Two things in here matter a lot for speed:

1. The model is loaded lazily and exactly once. It used to be constructed at
   import time, which blocked server startup and made every module that
   imported this file pay the cost.
2. Text is encoded in batches. The previous ingestion path called the model
   once per chunk in a Python loop, which wastes almost all of the available
   throughput — a transformer forward pass on 32 texts at once costs barely
   more than on one.
"""

from __future__ import annotations

import logging
import threading
from functools import lru_cache

from app.core.config import settings

logger = logging.getLogger(__name__)

# BGE retrieval models are trained asymmetrically: the *query* gets an
# instruction prefix while stored passages do not. Using it measurably improves
# retrieval quality, and costs nothing.
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "

_model = None
_model_lock = threading.Lock()


def get_model():
    """Return the shared SentenceTransformer, loading it on first use.

    Thread-safe: FastAPI runs sync endpoints in a worker thread pool, so two
    requests can race here on a cold start.
    """
    global _model

    if _model is not None:
        return _model

    with _model_lock:
        if _model is None:
            # Imported lazily so that merely importing this module (for tests,
            # or for the CLI) does not pull in torch.
            import torch
            from sentence_transformers import SentenceTransformer

            logger.info("Loading embedding model %s", settings.embedding_model)
            model = SentenceTransformer(settings.embedding_model)
            model.eval()
            # Inference only — no autograd graph needs to be built.
            torch.set_grad_enabled(False)
            _model = model
            logger.info("Embedding model ready")

    return _model


def warm_up() -> None:
    """Load the model and run one tiny encode so the first real request is fast."""
    try:
        get_model().encode(["warm up"], normalize_embeddings=True)
        logger.info("Embedding model warmed up")
    except Exception as error:  # pragma: no cover - warm-up must never break boot
        logger.warning("Embedding warm-up skipped: %s", error)


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed many texts in one batched pass. Order is preserved."""
    if not texts:
        return []

    embeddings = get_model().encode(
        texts,
        batch_size=settings.embedding_batch_size,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )

    return [vector.tolist() for vector in embeddings]


def generate_embedding(text: str) -> list[float]:
    """Embed a single passage."""
    return embed_texts([text])[0]


@lru_cache(maxsize=512)
def _cached_query_embedding(query: str) -> tuple[float, ...]:
    embedding = get_model().encode(
        QUERY_PREFIX + query,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    return tuple(embedding.tolist())


def embed_query(query: str) -> list[float]:
    """Embed a search query, with the BGE instruction prefix applied.

    Results are memoised: asking the same question twice skips the model
    entirely, which makes repeated or retried questions noticeably snappier.
    """
    return list(_cached_query_embedding(query.strip()))
