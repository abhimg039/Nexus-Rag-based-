"""Idempotent database setup and migration.

Run it any time — it only makes changes that are missing:

    cd backend
    source venv/bin/activate
    python -m app.db.init_db

What it does:
  1. Enables the pgvector extension.
  2. Creates any missing tables.
  3. Adds columns introduced after the first version of the schema.
  4. Creates an approximate-nearest-neighbour index on the embedding column
     (HNSW where the installed pgvector supports it, otherwise IVFFlat).
  5. Repairs `chunk_index` values written by the old ingestion code, which
     restarted numbering on every page instead of running document-wide.
  6. Ensures a default local user exists.
"""

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
from app.db.database import Base, SessionLocal, engine

# Importing the models package registers every table on Base.metadata.
from app import models  # noqa: F401
from app.models import User

DEFAULT_USER_EMAIL = "local@nexus.rag"

# Columns added after the initial release. ADD COLUMN IF NOT EXISTS keeps this
# safe to re-run and avoids needing a full migration tool for this project.
ADDITIVE_COLUMNS = [
    ("documents", "content_hash", "VARCHAR(64)"),
    ("documents", "file_size", "INTEGER"),
    ("documents", "page_count", "INTEGER"),
    ("documents", "chunk_count", "INTEGER"),
    ("documents", "error_message", "TEXT"),
]

SUPPORTING_INDEXES = [
    (
        "ix_documents_content_hash",
        "CREATE INDEX IF NOT EXISTS ix_documents_content_hash "
        "ON documents (content_hash)",
    ),
    (
        "ix_documents_status",
        "CREATE INDEX IF NOT EXISTS ix_documents_status ON documents (status)",
    ),
    (
        "ix_document_chunks_document_id_chunk_index",
        "CREATE INDEX IF NOT EXISTS ix_document_chunks_document_id_chunk_index "
        "ON document_chunks (document_id, chunk_index)",
    ),
]


def _enable_extension(connection) -> None:
    connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    print("  pgvector extension ready")


def _pgvector_version(connection) -> tuple[int, ...]:
    raw = connection.execute(
        text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
    ).scalar()

    if not raw:
        return ()

    parts = []
    for piece in str(raw).split("."):
        digits = "".join(character for character in piece if character.isdigit())
        parts.append(int(digits) if digits else 0)

    return tuple(parts)


def _add_missing_columns(connection) -> None:
    for table, column, column_type in ADDITIVE_COLUMNS:
        connection.execute(
            text(
                f"ALTER TABLE {table} "
                f"ADD COLUMN IF NOT EXISTS {column} {column_type}"
            )
        )
    print(f"  checked {len(ADDITIVE_COLUMNS)} additive columns")


def _create_vector_index(connection) -> None:
    version = _pgvector_version(connection)
    dimensions = settings.embedding_dimensions

    # HNSW landed in pgvector 0.5.0 and gives much better recall/latency than
    # IVFFlat. Fall back gracefully on older extension builds.
    if version >= (0, 5, 0):
        statement = (
            "CREATE INDEX IF NOT EXISTS ix_document_chunks_embedding_hnsw "
            "ON document_chunks USING hnsw (embedding vector_cosine_ops) "
            "WITH (m = 16, ef_construction = 64)"
        )
        label = "HNSW"
    else:
        statement = (
            "CREATE INDEX IF NOT EXISTS ix_document_chunks_embedding_ivfflat "
            "ON document_chunks USING ivfflat (embedding vector_cosine_ops) "
            "WITH (lists = 100)"
        )
        label = "IVFFlat"

    try:
        connection.execute(text(statement))
        printable = ".".join(str(part) for part in version) or "unknown"
        print(f"  {label} vector index ready (pgvector {printable}, dim {dimensions})")
    except SQLAlchemyError as error:
        # An index is an optimisation, not a correctness requirement — never
        # let this abort setup.
        print(f"  warning: could not create the {label} index: {error}")


def _create_supporting_indexes(connection) -> None:
    for name, statement in SUPPORTING_INDEXES:
        try:
            connection.execute(text(statement))
        except SQLAlchemyError as error:
            print(f"  warning: could not create {name}: {error}")
    print(f"  checked {len(SUPPORTING_INDEXES)} supporting indexes")


def _repair_chunk_indexes(connection) -> None:
    """Renumber chunk_index so it is sequential across each whole document.

    The original ingestion code called enumerate() once per page, so page 2
    started again at 0. That made chunk_index ambiguous within a document and
    broke both ordering and source citations.
    """
    duplicates = connection.execute(
        text(
            """
            SELECT COUNT(*) FROM (
                SELECT document_id, chunk_index
                FROM document_chunks
                GROUP BY document_id, chunk_index
                HAVING COUNT(*) > 1
            ) AS collisions
            """
        )
    ).scalar()

    if not duplicates:
        print("  chunk_index numbering is already correct")
        return

    connection.execute(
        text(
            """
            WITH renumbered AS (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY document_id
                        ORDER BY page_number, chunk_index, id
                    ) - 1 AS new_index
                FROM document_chunks
            )
            UPDATE document_chunks AS c
            SET chunk_index = r.new_index
            FROM renumbered AS r
            WHERE c.id = r.id
              AND c.chunk_index <> r.new_index
            """
        )
    )
    print(f"  repaired chunk_index numbering ({duplicates} colliding groups)")


def _backfill_chunk_counts(connection) -> None:
    connection.execute(
        text(
            """
            UPDATE documents AS d
            SET chunk_count = counts.total
            FROM (
                SELECT document_id, COUNT(*) AS total
                FROM document_chunks
                GROUP BY document_id
            ) AS counts
            WHERE d.id = counts.document_id
              AND (d.chunk_count IS NULL OR d.chunk_count <> counts.total)
            """
        )
    )
    print("  backfilled document chunk counts")


def ensure_default_user() -> int:
    """Return the id of the default local user, creating it if needed."""
    with SessionLocal() as session:
        user = session.query(User).order_by(User.id).first()

        if user is None:
            user = User(
                email=DEFAULT_USER_EMAIL,
                # This project has no authentication yet. The column is
                # NOT NULL, so store an explicit non-credential placeholder
                # rather than something that looks like a real hash.
                password_hash="local-no-auth",
            )
            session.add(user)
            session.commit()
            session.refresh(user)
            print(f"  created default user id={user.id} ({user.email})")
        else:
            print(f"  default user is id={user.id} ({user.email})")

        return user.id


def init_db() -> None:
    print("Setting up the database...")

    with engine.begin() as connection:
        _enable_extension(connection)

    Base.metadata.create_all(bind=engine)
    print("  tables ready")

    with engine.begin() as connection:
        _add_missing_columns(connection)
        _create_supporting_indexes(connection)
        _create_vector_index(connection)
        _repair_chunk_indexes(connection)
        _backfill_chunk_counts(connection)

    ensure_default_user()
    print("Database setup complete.")


if __name__ == "__main__":
    init_db()
