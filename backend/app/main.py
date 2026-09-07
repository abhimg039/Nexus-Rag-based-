from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.documents import router as documents_router
from app.api.health import router as health_router
from app.api.questions import router as questions_router
from app.api.session import router as session_router
from app.core.config import settings

# Registers every model on Base.metadata (moved out of db/database.py, where it
# was a circular import).
from app import models  # noqa: F401

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(name)s  %(message)s",
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.warm_up_embedding_model:
        # Loading BGE takes a few seconds. Doing it on a background thread means
        # the server starts accepting requests immediately, while the first
        # upload no longer pays the cost.
        from app.rag.embedding_service import warm_up

        threading.Thread(target=warm_up, name="embedding-warmup", daemon=True).start()

    logger.info(
        "%s v%s ready (env=%s, llm=%s, embeddings=%s)",
        settings.app_name,
        settings.app_version,
        settings.environment,
        settings.llm_model,
        settings.embedding_model,
    )

    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# NOTE: no GZip middleware here on purpose. Starlette's GZipMiddleware would
# also compress the text/event-stream response, and its internal buffering
# holds back small chunks — which would defeat token-by-token streaming. The
# payloads are a few KB over localhost, so there is nothing to gain.

app.include_router(health_router)
app.include_router(session_router)
app.include_router(documents_router)
app.include_router(questions_router)


@app.get("/", tags=["Health"])
def root():
    return {
        "message": "AI Document Intelligence API is running",
        "version": settings.app_version,
        "docs": "/docs",
    }
