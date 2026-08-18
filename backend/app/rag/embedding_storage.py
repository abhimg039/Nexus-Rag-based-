from sqlalchemy.orm import Session

from app.models import DocumentChunk
from app.rag.embedding_service import generate_embedding


def embed_document_chunks(
    db: Session,
    document_id: int
) -> int:
    chunks = (
        db.query(DocumentChunk)
        .filter(
            DocumentChunk.document_id == document_id,
            DocumentChunk.embedding.is_(None)
        )
        .order_by(DocumentChunk.chunk_index)
        .all()
    )

    embedded_count = 0

    for chunk in chunks:
        chunk.embedding = generate_embedding(chunk.chunk_text)
        embedded_count += 1

    db.commit()

    return embedded_count