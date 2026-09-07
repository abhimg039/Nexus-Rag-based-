from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class DocumentCreate(BaseModel):
    user_id: int
    filename: str
    file_path: str


class DocumentOut(BaseModel):
    """Document metadata as returned to the client."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    filename: str
    status: str
    file_size: Optional[int] = None
    page_count: Optional[int] = None
    chunk_count: Optional[int] = None
    error_message: Optional[str] = None
    created_at: Optional[datetime] = None

    # Note: file_path is intentionally not exposed. It is a server-side
    # filesystem path and leaking it tells a client where files live on disk.


class UploadResult(DocumentOut):
    embeddings_generated: int = 0
    processing_seconds: float = 0.0
    reused: bool = Field(
        default=False,
        description="True when an identical file was already indexed and its "
        "existing embeddings were reused instead of reprocessing.",
    )
