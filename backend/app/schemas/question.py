from typing import Optional

from pydantic import BaseModel, Field


class QuestionRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    document_id: Optional[int] = None
    limit: int = Field(default=5, ge=1, le=20)


class SourceOut(BaseModel):
    position: int
    document_id: int
    page: int
    chunk_index: int
    similarity: float
    keyword_hits: int = 0
    text: str


class QuestionMeta(BaseModel):
    retrieval_ms: int = 0
    generation_ms: int = 0


class QuestionResponse(BaseModel):
    answer: str
    sources: list[SourceOut] = []
    meta: QuestionMeta = QuestionMeta()
