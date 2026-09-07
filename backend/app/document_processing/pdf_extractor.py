"""PDF text extraction (PyMuPDF)."""

from __future__ import annotations

import logging

import fitz

logger = logging.getLogger(__name__)


class PdfExtractionError(RuntimeError):
    """Raised when a PDF cannot be opened or contains no extractable text."""


def extract_text_from_pdf(file_path: str) -> list[dict]:
    """Return one entry per page: {"page_number": int, "text": str}.

    Page numbers are 1-based. Pages with no extractable text are kept (with an
    empty string) so page numbering in citations stays aligned with the real
    document.
    """
    try:
        document = fitz.open(file_path)
    except Exception as error:
        raise PdfExtractionError(f"Could not open the PDF: {error}") from error

    pages: list[dict] = []

    try:
        if document.needs_pass:
            raise PdfExtractionError(
                "This PDF is password protected. Remove the password and upload again."
            )

        for page_number, page in enumerate(document, start=1):
            try:
                text = page.get_text("text").strip()
            except Exception as error:  # a single damaged page must not kill the upload
                logger.warning("Page %s of %s failed to extract: %s", page_number, file_path, error)
                text = ""

            pages.append({"page_number": page_number, "text": text})
    finally:
        document.close()

    if not pages:
        raise PdfExtractionError("This PDF has no pages.")

    if not any(page["text"] for page in pages):
        raise PdfExtractionError(
            "No selectable text found. This looks like a scanned PDF — it needs "
            "OCR before it can be searched."
        )

    return pages
