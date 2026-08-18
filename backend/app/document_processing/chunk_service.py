from sqlalchemy.orm import Session

from app.document_processing.chunker import chunk_text
from app.models import DocumentChunk


def save_document_chunks(
    db: Session,
    document_id: int,
    pages: list[dict],
    chunk_size: int = 1000,
    chunk_overlap: int = 200
) -> int:
    chunk_count = 0

    for page in pages:
        chunks = chunk_text(
            page["text"],
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap
        )

        for chunk_index, chunk in enumerate(chunks):
            document_chunk = DocumentChunk(
                document_id=document_id,
                page_number=page["page_number"],
                chunk_index=chunk_index,
                chunk_text=chunk
            )

            db.add(document_chunk)
            chunk_count += 1

    db.commit()

    return chunk_count