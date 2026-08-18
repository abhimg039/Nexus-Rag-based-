from sqlalchemy.orm import Session

from app.document_processing.chunk_service import save_document_chunks
from app.document_processing.pdf_extractor import extract_text_from_pdf
from app.rag.embedding_storage import embed_document_chunks


def process_document(
    db: Session,
    document_id: int,
    file_path: str
) -> int:
    pages = extract_text_from_pdf(file_path)

    save_document_chunks(
        db=db,
        document_id=document_id,
        pages=pages
    )

    embedded_count = embed_document_chunks(
        db=db,
        document_id=document_id
    )

    return embedded_count