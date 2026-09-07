from datetime import datetime
from typing import Optional

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, ForeignKey, Index, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.clock import utcnow
from app.core.config import settings
from app.db.database import Base


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id: Mapped[int] = mapped_column(
        primary_key=True,
        autoincrement=True
    )

    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id"),
        nullable=False,
        index=True
    )

    page_number: Mapped[int] = mapped_column(
        Integer,
        nullable=False
    )

    # Sequential across the whole document (not restarted per page), so it is a
    # stable identifier for a passage and can be used for ordering.
    chunk_index: Mapped[int] = mapped_column(
        Integer,
        nullable=False
    )

    chunk_text: Mapped[str] = mapped_column(
        Text,
        nullable=False
    )

    embedding: Mapped[Optional[list[float]]] = mapped_column(
        Vector(settings.embedding_dimensions),
        nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=utcnow,
        nullable=False
    )

    document: Mapped["Document"] = relationship(
        "Document",
        back_populates="chunks"
    )

    __table_args__ = (
        # Supports the per-document ordered reads done during ingestion and
        # when rebuilding context.
        Index("ix_document_chunks_document_id_chunk_index", "document_id", "chunk_index"),
    )
