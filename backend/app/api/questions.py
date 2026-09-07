from __future__ import annotations

import json
import logging
from collections.abc import Iterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.db.dependencies import get_db
from app.rag.llm_service import LlmUnavailableError
from app.rag.rag_service import answer_question, stream_question
from app.schemas import QuestionRequest, QuestionResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/questions", tags=["Questions"])


@router.post("", response_model=QuestionResponse)
def ask_question(request: QuestionRequest, db: Session = Depends(get_db)):
    """Answer a question and return the complete response."""
    try:
        return answer_question(
            db=db,
            question=request.question,
            document_id=request.document_id,
            limit=request.limit,
        )
    except LlmUnavailableError as error:
        # 503: the request was fine, the local model just is not there.
        raise HTTPException(status_code=503, detail=str(error)) from error


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


def _event_stream(request: QuestionRequest) -> Iterator[str]:
    """Produce the SSE body.

    The session is opened here rather than injected: this generator is consumed
    *after* the endpoint function returns, by which point a dependency-managed
    session may already have been closed.
    """
    session = SessionLocal()

    try:
        for event in stream_question(
            db=session,
            question=request.question,
            document_id=request.document_id,
            limit=request.limit,
        ):
            yield _sse(event)
    except LlmUnavailableError as error:
        yield _sse({"type": "error", "message": str(error)})
    except Exception as error:  # noqa: BLE001 - must not break the stream contract
        logger.exception("Streaming failed")
        yield _sse({"type": "error", "message": f"Unexpected error: {error}"})
    finally:
        session.close()


@router.post("/stream")
def ask_question_stream(request: QuestionRequest):
    """Answer a question, streaming tokens as server-sent events.

    Retrieval finishes first and the sources event is emitted immediately, so
    the UI can show its evidence while the model is still writing.
    """
    return StreamingResponse(
        _event_stream(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            # Stops reverse proxies from buffering the stream into one blob.
            "X-Accel-Buffering": "no",
        },
    )
