from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.dependencies import get_db
from app.models import Document, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/session", tags=["Session"])

DEFAULT_USER_EMAIL = "local@nexus.rag"


def resolve_default_user(db: Session) -> User:
    """Pick the user this single-user local install should act as.

    The frontend used to hardcode `USER_ID = 2`, which silently breaks on any
    machine where that row does not exist. Preference order:

      1. the user who owns the most documents (matches existing local data)
      2. the lowest-id user
      3. a freshly created local user
    """
    busiest = db.execute(
        select(Document.user_id, func.count(Document.id).label("total"))
        .group_by(Document.user_id)
        .order_by(func.count(Document.id).desc(), Document.user_id)
        .limit(1)
    ).first()

    if busiest is not None:
        user = db.get(User, busiest.user_id)
        if user is not None:
            return user

    user = db.scalars(select(User).order_by(User.id).limit(1)).first()

    if user is not None:
        return user

    user = User(email=DEFAULT_USER_EMAIL, password_hash="local-no-auth")
    db.add(user)
    db.commit()
    db.refresh(user)
    logger.info("Created default local user id=%s", user.id)

    return user


@router.get("")
def get_session(db: Session = Depends(get_db)):
    """Identity for the current local session.

    This project has no authentication. The endpoint exists so the frontend can
    discover which user id to use instead of hardcoding one.
    """
    user = resolve_default_user(db)

    document_count = db.scalar(
        select(func.count(Document.id)).where(Document.user_id == user.id)
    )

    return {
        "user_id": user.id,
        "email": user.email,
        "document_count": document_count or 0,
    }
