"""RAG orchestration: retrieve, build context, generate."""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator

from sqlalchemy.orm import Session

from app.core.config import settings
from app.rag.llm_service import generate_answer, stream_answer
from app.rag.search_service import RetrievedChunk, search_similar_chunks

logger = logging.getLogger(__name__)

NO_CONTEXT_ANSWER = (
    "I could not find anything relevant in this document. It may not cover this "
    "topic, or it may still be processing."
)


def build_context(chunks: list[RetrievedChunk]) -> str:
    """Format passages for the prompt.

    Numbered so the model can cite them, and labelled with the real page.
    The similarity score is deliberately left out: it is useful to the user in
    the UI, but inside the prompt it is noise that the model may try to
    interpret or repeat.
    """
    return "\n\n".join(
        f"[Source {position} · Page {chunk.page_number}]\n{chunk.chunk_text}"
        for position, chunk in enumerate(chunks, start=1)
    )


def serialize_sources(chunks: list[RetrievedChunk]) -> list[dict]:
    """Source payload for the UI, including the passage text so the user can
    verify the answer against the document. The original API returned only page
    and score, which made answers impossible to check."""
    return [
        {
            "position": position,
            "document_id": chunk.document_id,
            "page": chunk.page_number,
            "chunk_index": chunk.chunk_index,
            "similarity": round(chunk.similarity, 4),
            "keyword_hits": chunk.keyword_hits,
            "text": chunk.chunk_text,
        }
        for position, chunk in enumerate(chunks, start=1)
    ]


def _retrieve(
    db: Session,
    question: str,
    document_id: int | None,
    limit: int | None,
) -> tuple[list[RetrievedChunk], float]:
    started = time.perf_counter()
    chunks = search_similar_chunks(
        db=db,
        query=question,
        document_id=document_id,
        limit=limit or settings.retrieval_top_k,
    )
    return chunks, (time.perf_counter() - started) * 1000


def answer_question(
    db: Session,
    question: str,
    document_id: int | None = None,
    limit: int | None = None,
) -> dict:
    chunks, retrieval_ms = _retrieve(db, question, document_id, limit)

    # Skip the model entirely when there is nothing to ground an answer in.
    # Generation is by far the slowest step, so not running it saves the user a
    # long wait for a guaranteed non-answer.
    if not chunks:
        return {
            "answer": NO_CONTEXT_ANSWER,
            "sources": [],
            "meta": {"retrieval_ms": round(retrieval_ms), "generation_ms": 0},
        }

    started = time.perf_counter()
    answer = generate_answer(question=question, context=build_context(chunks))
    generation_ms = (time.perf_counter() - started) * 1000

    return {
        "answer": answer,
        "sources": serialize_sources(chunks),
        "meta": {
            "retrieval_ms": round(retrieval_ms),
            "generation_ms": round(generation_ms),
        },
    }


def stream_question(
    db: Session,
    question: str,
    document_id: int | None = None,
    limit: int | None = None,
) -> Iterator[dict]:
    """Yield events for a streamed answer.

    Event shapes:
      {"type": "sources", "sources": [...], "retrieval_ms": int}
      {"type": "token",   "text": "..."}
      {"type": "done",    "generation_ms": int}
      {"type": "error",   "message": "..."}
    """
    chunks, retrieval_ms = _retrieve(db, question, document_id, limit)

    # Sources go out first so the UI can show evidence while tokens arrive.
    yield {
        "type": "sources",
        "sources": serialize_sources(chunks),
        "retrieval_ms": round(retrieval_ms),
    }

    if not chunks:
        yield {"type": "token", "text": NO_CONTEXT_ANSWER}
        yield {"type": "done", "generation_ms": 0}
        return

    started = time.perf_counter()

    for fragment in stream_answer(question=question, context=build_context(chunks)):
        yield {"type": "token", "text": fragment}

    yield {"type": "done", "generation_ms": round((time.perf_counter() - started) * 1000)}
