"""Safe storage of uploaded files."""

from __future__ import annotations

import hashlib
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

from fastapi import UploadFile

READ_CHUNK_BYTES = 1024 * 1024  # 1 MiB

_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")


class UploadTooLargeError(RuntimeError):
    pass


@dataclass
class StoredFile:
    path: Path
    original_filename: str
    content_hash: str
    size: int


def safe_filename(raw_name: str | None) -> str:
    """Reduce a client-supplied filename to something safe to put on disk.

    `Path(...).name` drops any directory component. Without this, a crafted
    upload named "../../../etc/cron.d/x.pdf" would be written outside the upload
    directory — the original handler joined the raw client filename straight
    onto the upload path.
    """
    candidate = Path(raw_name or "").name
    suffix = Path(candidate).suffix.lower()
    stem = Path(candidate).stem

    stem = _UNSAFE.sub("_", stem).strip("._")
    if not stem:
        stem = "document"

    if suffix != ".pdf":
        suffix = ".pdf"

    return f"{stem[:120]}{suffix}"


def save_upload(
    file: UploadFile,
    upload_dir: Path,
    max_bytes: int,
) -> StoredFile:
    """Stream an upload to disk while hashing it.

    Streaming in 1 MiB blocks means a large PDF is never held in memory in full,
    which the previous `file.file.read()` did. The final name is derived from the
    content hash, so two uploads of different files that happen to share a name
    can no longer overwrite each other.
    """
    upload_dir.mkdir(parents=True, exist_ok=True)

    original_filename = Path(file.filename or "document.pdf").name
    digest = hashlib.sha256()
    size = 0

    temporary_path = upload_dir / f".incoming-{uuid.uuid4().hex}.part"

    try:
        file.file.seek(0)

        with open(temporary_path, "wb") as buffer:
            while True:
                block = file.file.read(READ_CHUNK_BYTES)
                if not block:
                    break

                size += len(block)
                if size > max_bytes:
                    raise UploadTooLargeError(
                        f"File is larger than the {max_bytes // (1024 * 1024)} MB limit."
                    )

                digest.update(block)
                buffer.write(block)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise

    content_hash = digest.hexdigest()
    final_path = upload_dir / f"{content_hash[:12]}-{safe_filename(original_filename)}"

    if final_path.exists():
        # Identical bytes already stored; keep the existing copy.
        temporary_path.unlink(missing_ok=True)
    else:
        temporary_path.replace(final_path)

    return StoredFile(
        path=final_path,
        original_filename=original_filename,
        content_hash=content_hash,
        size=size,
    )
