"""Turning extracted pages into stored chunks."""

from __future__ import annotations

import logging

from sqlalchemy import delete, insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.document_processing.chunker import chunk_text
from app.models import DocumentChunk

logger = logging.getLogger(__name__)


def save_document_chunks(
    db: Session,
    document_id: int,
    pages: list[dict],
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
) -> int:
    """Chunk every page and insert the rows. Returns the number of chunks.

    Two fixes over the original version:

    * `chunk_index` is now sequential across the whole document. It used to
      restart at 0 on every page, so index 3 was ambiguous in any document with
      more than one page — which corrupted source citations and ordering.
    * Rows are inserted with a single executemany instead of one `db.add()` per
      chunk, which is dramatically faster on large PDFs.
    """
    chunk_size = chunk_size or settings.chunk_size
    chunk_overlap = chunk_overlap if chunk_overlap is not None else settings.chunk_overlap

    # Make reprocessing the same document idempotent.
    db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document_id))

    rows: list[dict] = []
    chunk_index = 0

    for page in pages:
        for chunk in chunk_text(
            page["text"],
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        ):
            rows.append(
                {
                    "document_id": document_id,
                    "page_number": page["page_number"],
                    "chunk_index": chunk_index,
                    "chunk_text": chunk,
                }
            )
            chunk_index += 1

    if rows:
        db.execute(insert(DocumentChunk), rows)

    db.commit()

    logger.info("Saved %s chunks for document %s", len(rows), document_id)

    return len(rows)
