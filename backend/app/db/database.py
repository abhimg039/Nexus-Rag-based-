from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

# pool_pre_ping avoids "server closed the connection unexpectedly" errors after
# the database or a laptop lid has been idle. pool_recycle drops connections
# before Postgres times them out.
engine = create_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_recycle=settings.db_pool_recycle,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


# NOTE: models are imported by app.db.init_db and app.main so that
# Base.metadata is fully populated. Importing them here would create a circular
# import (models import Base from this module).
