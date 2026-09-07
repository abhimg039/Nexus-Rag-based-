"""Hybrid retrieval: vector similarity with a keyword-overlap re-rank."""

from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import DocumentChunk
from app.rag.embedding_service import embed_query

STOP_WORDS = frozenset(
    {
        "about", "all", "also", "and", "any", "are", "but", "can", "details",
        "did", "does", "for", "from", "give", "had", "has", "have", "how",
        "into", "its", "list", "many", "may", "much", "not", "our", "out",
        "show", "some", "tell", "than", "that", "the", "their", "them", "then",
        "there", "these", "they", "this", "those", "was", "were", "what",
        "when", "where", "which", "who", "why", "will", "with", "would", "you",
        "your",
    }
)

_WORD = re.compile(r"[a-zA-Z][a-zA-Z0-9]{2,}")


@dataclass(frozen=True)
class RetrievedChunk:
    """A retrieved passage. Deliberately not an ORM object — the embedding
    column is never loaded, which keeps each result small."""

    chunk_id: int
    document_id: int
    page_number: int
    chunk_index: int
    chunk_text: str
    similarity: float
    keyword_hits: int


def _terms(text: str, drop_stop_words: bool = False) -> set[str]:
    """Lowercased, crudely singularised tokens of 3+ characters."""
    tokens = set()

    for match in _WORD.findall(text.lower()):
        if drop_stop_words and match in STOP_WORDS:
            continue
        tokens.add(match[:-1] if match.endswith("s") and len(match) > 3 else match)

    return tokens


def keyword_overlap(query: str, text: str) -> int:
    """How many distinct meaningful query terms appear in the passage."""
    query_terms = _terms(query, drop_stop_words=True)

    if not query_terms:
        return 0

    return len(query_terms & _terms(text))


def search_similar_chunks(
    db: Session,
    query: str,
    document_id: int | None = None,
    limit: int | None = None,
) -> list[RetrievedChunk]:
    """Retrieve the most relevant passages for a query.

    Vector search finds candidates, then a keyword-overlap bonus re-ranks them.
    The bonus is expressed as a *fraction of matched query terms*, so it stays
    within a predictable range. The previous version added 0.08 per matched
    term, which for a question with a dozen meaningful words could add over 1.0
    — more than the entire cosine similarity range, letting term count silently
    override semantic relevance.
    """
    limit = limit or settings.retrieval_top_k
    limit = max(1, limit)

    query_embedding = embed_query(query)
    distance = DocumentChunk.embedding.cosine_distance(query_embedding)

    # Select explicit columns: loading the ORM entity would also fetch the
    # 384-dimension embedding for every candidate, which is pure overhead here.
    statement = (
        select(
            DocumentChunk.id,
            DocumentChunk.document_id,
            DocumentChunk.page_number,
            DocumentChunk.chunk_index,
            DocumentChunk.chunk_text,
            distance.label("distance"),
        )
        .where(DocumentChunk.embedding.is_not(None))
        .order_by(distance)
        .limit(limit * max(1, settings.retrieval_candidate_multiplier))
    )

    if document_id is not None:
        statement = statement.where(DocumentChunk.document_id == document_id)

    rows = db.execute(statement).all()

    query_term_count = len(_terms(query, drop_stop_words=True)) or 1

    candidates: list[RetrievedChunk] = []

    for row in rows:
        hits = keyword_overlap(query, row.chunk_text)
        candidates.append(
            RetrievedChunk(
                chunk_id=row.id,
                document_id=row.document_id,
                page_number=row.page_number,
                chunk_index=row.chunk_index,
                chunk_text=row.chunk_text,
                # Embeddings are normalised, so cosine distance is in [0, 2]
                # and this maps to the familiar [-1, 1] similarity.
                similarity=1.0 - float(row.distance),
                keyword_hits=hits,
            )
        )

    def rank(candidate: RetrievedChunk) -> tuple[float, float]:
        coverage = candidate.keyword_hits / query_term_count
        return (candidate.similarity + coverage * settings.keyword_boost, candidate.similarity)

    candidates.sort(key=rank, reverse=True)

    return candidates[:limit]
