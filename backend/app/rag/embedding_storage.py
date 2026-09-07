"""Persisting chunk embeddings.

The previous implementation loaded full ORM objects and called the embedding
model once per chunk inside a Python for-loop. This version:

  * selects only (id, chunk_text), so the 384-float embedding column is never
    pulled over the wire just to be overwritten;
  * embeds each slice of chunks in a single batched model call;
  * writes results back with one executemany UPDATE per slice instead of one
    statement per row.
"""

from __future__ import annotations

import logging

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import DocumentChunk
from app.rag.embedding_service import embed_texts

logger = logging.getLogger(__name__)

# How many chunks to hold in memory at once. Keeps peak memory bounded on very
# large PDFs while still giving the model plenty of work per call.
WRITE_SLICE_SIZE = 256


def embed_document_chunks(db: Session, document_id: int) -> int:
    """Embed every not-yet-embedded chunk of a document. Returns the count."""
    rows = db.execute(
        select(DocumentChunk.id, DocumentChunk.chunk_text)
        .where(
            DocumentChunk.document_id == document_id,
            DocumentChunk.embedding.is_(None),
        )
        .order_by(DocumentChunk.chunk_index)
    ).all()

    if not rows:
        return 0

    embedded_count = 0

    for start in range(0, len(rows), WRITE_SLICE_SIZE):
        window = rows[start:start + WRITE_SLICE_SIZE]

        vectors = embed_texts([text for _, text in window])

        db.execute(
            update(DocumentChunk),
            [
                {"id": row_id, "embedding": vector}
                for (row_id, _), vector in zip(window, vectors)
            ],
        )

        embedded_count += len(window)

    db.commit()

    logger.info("Embedded %s chunks for document %s", embedded_count, document_id)

    return embedded_count
