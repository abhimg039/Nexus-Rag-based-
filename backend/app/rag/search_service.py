from sqlalchemy.orm import Session

from app.models import DocumentChunk
from app.rag.embedding_service import generate_embedding


def search_similar_chunks(
    db: Session,
    query: str,
    limit: int = 5
) -> list[tuple[DocumentChunk, float]]:
    query_embedding = generate_embedding(query)

    distance = DocumentChunk.embedding.cosine_distance(
        query_embedding
    )

    results = (
        db.query(DocumentChunk, distance)
        .filter(DocumentChunk.embedding.is_not(None))
        .order_by(distance)
        .limit(limit)
        .all()
    )

    return [
        (chunk, 1 - float(distance_value))
        for chunk, distance_value in results
    ]