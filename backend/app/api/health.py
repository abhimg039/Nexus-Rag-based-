from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.dependencies import get_db


router = APIRouter()


@router.get("/health")
def health():
    return {
        "status": "healthy"
    }


@router.get("/health/db")
def database_health(db: Session = Depends(get_db)):
    result = db.execute(text("SELECT 1"))
    result.scalar()

    return {
        "status": "healthy",
        "database": "connected"
    }