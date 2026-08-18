from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.dependencies import get_db
from app.models import Document, User
from app.schemas import DocumentCreate


router = APIRouter(
    prefix="/api/documents",
    tags=["Documents"]
)


@router.post("")
def create_document(
    document_data: DocumentCreate,
    db: Session = Depends(get_db)
):
    user = db.get(User, document_data.user_id)

    if user is None:
        raise HTTPException(
            status_code=404,
            detail="User not found"
        )

    document = Document(
        user_id=document_data.user_id,
        filename=document_data.filename,
        file_path=document_data.file_path,
        status="uploaded"
    )

    db.add(document)
    db.commit()
    db.refresh(document)

    return {
        "id": document.id,
        "user_id": document.user_id,
        "filename": document.filename,
        "file_path": document.file_path,
        "status": document.status
    }


@router.get("")
def list_documents(
    user_id: int,
    db: Session = Depends(get_db)
):
    documents = (
        db.query(Document)
        .filter(Document.user_id == user_id)
        .order_by(Document.created_at.desc())
        .all()
    )

    return [
        {
            "id": document.id,
            "user_id": document.user_id,
            "filename": document.filename,
            "file_path": document.file_path,
            "status": document.status
        }
        for document in documents
    ]