from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.dependencies import get_db
from app.rag.llm_service import check_ollama

router = APIRouter(tags=["Health"])


@router.get("/health")
def health():
    return {
        "status": "healthy",
        "app": settings.app_name,
        "version": settings.app_version,
        "environment": settings.environment,
    }


@router.get("/health/db")
def database_health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1")).scalar()

    vector_version = db.execute(
        text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
    ).scalar()

    return {
        "status": "healthy",
        "database": "connected",
        "pgvector": vector_version or "not installed",
    }


@router.get("/health/full")
def full_health(db: Session = Depends(get_db)):
    """Everything the app depends on, in one call.

    Useful for the UI status indicator, which previously just claimed
    "LOCAL AI ONLINE" without checking anything.
    """
    try:
        db.execute(text("SELECT 1")).scalar()
        database = {"status": "healthy"}
    except Exception as error:  # noqa: BLE001
        database = {"status": "unavailable", "detail": str(error)}

    llm = check_ollama()

    overall = "healthy" if database["status"] == "healthy" and llm["status"] == "healthy" else "degraded"

    return {
        "status": overall,
        "database": database,
        "llm": llm,
        "embedding_model": settings.embedding_model,
    }
