"""Document ingestion pipeline: extract -> chunk -> embed."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.document_processing.chunk_service import save_document_chunks
from app.document_processing.pdf_extractor import extract_text_from_pdf
from app.rag.embedding_storage import embed_document_chunks

logger = logging.getLogger(__name__)


@dataclass
class IngestionResult:
    page_count: int
    chunk_count: int
    embedded_count: int
    duration_seconds: float


def process_document(
    db: Session,
    document_id: int,
    file_path: str,
) -> IngestionResult:
    started = time.perf_counter()

    pages = extract_text_from_pdf(file_path)

    chunk_count = save_document_chunks(
        db=db,
        document_id=document_id,
        pages=pages,
    )

    embedded_count = embed_document_chunks(db=db, document_id=document_id)

    duration = time.perf_counter() - started

    logger.info(
        "Processed document %s: %s pages, %s chunks, %s embeddings in %.2fs",
        document_id,
        len(pages),
        chunk_count,
        embedded_count,
        duration,
    )

    return IngestionResult(
        page_count=len(pages),
        chunk_count=chunk_count,
        embedded_count=embedded_count,
        duration_seconds=round(duration, 2),
    )
