from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.dependencies import get_db
from app.document_processing.ingestion_service import process_document
from app.document_processing.pdf_extractor import PdfExtractionError
from app.document_processing.storage import UploadTooLargeError, save_upload
from app.models import Document, DocumentChunk, User
from app.schemas import DocumentCreate, DocumentOut, UploadResult

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/documents", tags=["Documents"])


def _require_user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)

    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    return user


@router.post("", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
def create_document(document_data: DocumentCreate, db: Session = Depends(get_db)):
    """Register a document row without uploading a file (kept for API parity)."""
    _require_user(db, document_data.user_id)

    document = Document(
        user_id=document_data.user_id,
        filename=document_data.filename,
        file_path=document_data.file_path,
        status="uploaded",
    )

    db.add(document)
    db.commit()
    db.refresh(document)

    return document


@router.get("", response_model=list[DocumentOut])
def list_documents(
    user_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    documents = db.scalars(
        select(Document)
        .where(Document.user_id == user_id)
        .order_by(Document.created_at.desc(), Document.id.desc())
    ).all()

    # Backfill chunk_count for rows created before the column existed, using one
    # grouped query rather than one query per document.
    missing = [document.id for document in documents if document.chunk_count is None]

    if missing:
        counts = dict(
            db.execute(
                select(DocumentChunk.document_id, func.count(DocumentChunk.id))
                .where(DocumentChunk.document_id.in_(missing))
                .group_by(DocumentChunk.document_id)
            ).all()
        )
        for document in documents:
            if document.chunk_count is None:
                document.chunk_count = counts.get(document.id, 0)

    return documents


@router.get("/{document_id}", response_model=DocumentOut)
def get_document(document_id: int, db: Session = Depends(get_db)):
    document = db.get(Document, document_id)

    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    return document


@router.delete("/{document_id}", status_code=status.HTTP_200_OK)
def delete_document(
    document_id: int,
    remove_file: bool = Query(True, description="Also delete the stored PDF."),
    db: Session = Depends(get_db),
):
    document = db.get(Document, document_id)

    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    stored_path = Path(document.file_path)

    # Bulk-delete the chunks rather than letting the ORM cascade load every row
    # into memory first.
    db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document_id))
    db.delete(document)
    db.commit()

    if remove_file:
        # Only remove the file if no other document row still points at it
        # (deduplicated uploads share one file on disk).
        still_referenced = db.scalar(
            select(func.count(Document.id)).where(Document.file_path == str(stored_path))
        )
        if not still_referenced:
            try:
                stored_path.unlink(missing_ok=True)
            except OSError as error:
                logger.warning("Could not delete %s: %s", stored_path, error)

    return {"deleted": True, "id": document_id}


@router.post("/upload", response_model=UploadResult, status_code=status.HTTP_201_CREATED)
def upload_document(
    user_id: int = Query(..., ge=1),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    _require_user(db, user_id)

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    try:
        stored = save_upload(
            file=file,
            upload_dir=settings.upload_path,
            max_bytes=settings.max_upload_bytes,
        )
    except UploadTooLargeError as error:
        raise HTTPException(status_code=413, detail=str(error)) from error
    except OSError as error:
        logger.exception("Failed to store upload")
        raise HTTPException(status_code=500, detail=f"Could not save the file: {error}") from error

    # If this exact file was already indexed for this user, reuse it. Embedding
    # is the expensive part of ingestion, so this turns a re-upload from a
    # multi-second job into an instant response.
    existing = db.scalars(
        select(Document)
        .where(
            Document.user_id == user_id,
            Document.content_hash == stored.content_hash,
            Document.status == "processed",
        )
        .order_by(Document.id.desc())
        .limit(1)
    ).first()

    if existing is not None:
        logger.info("Reusing already-indexed document %s", existing.id)
        return UploadResult(
            **DocumentOut.model_validate(existing).model_dump(),
            embeddings_generated=existing.chunk_count or 0,
            processing_seconds=0.0,
            reused=True,
        )

    document = Document(
        user_id=user_id,
        filename=stored.original_filename,
        file_path=str(stored.path),
        content_hash=stored.content_hash,
        file_size=stored.size,
        status="processing",
    )

    db.add(document)
    db.commit()
    db.refresh(document)

    try:
        result = process_document(
            db=db,
            document_id=document.id,
            file_path=str(stored.path),
        )
    except PdfExtractionError as error:
        # A readable, user-facing reason (scanned PDF, password protected, ...)
        document.status = "failed"
        document.error_message = str(error)
        db.commit()
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        logger.exception("Ingestion failed for document %s", document.id)
        document.status = "failed"
        document.error_message = str(error)
        db.commit()
        raise HTTPException(
            status_code=500,
            detail=f"Document processing failed: {error}",
        ) from error

    document.status = "processed"
    document.page_count = result.page_count
    document.chunk_count = result.chunk_count
    document.error_message = None
    db.commit()
    db.refresh(document)

    return UploadResult(
        **DocumentOut.model_validate(document).model_dump(),
        embeddings_generated=result.embedded_count,
        processing_seconds=result.duration_seconds,
        reused=False,
    )
