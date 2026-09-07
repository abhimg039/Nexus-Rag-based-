"""Text chunking.

The original implementation sliced the page text every N characters. That
splits words and sentences at arbitrary points, which hurts embedding quality:
a chunk ending "...the total contract valu" embeds poorly and retrieves badly.

This version packs whole sentences (falling back to words, then to a hard cut)
up to the target size, and carries a sentence-aligned overlap between
neighbouring chunks so a fact spanning a boundary stays retrievable.
"""

from __future__ import annotations

import re

# Collapse runs of whitespace but keep paragraph breaks meaningful.
_MULTI_NEWLINE = re.compile(r"\n\s*\n+")
_INLINE_WHITESPACE = re.compile(r"[ \t\r\f\v]+")
# Split after ., !, ? or a newline. Kept deliberately simple and dependency-free.
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+|\n+")


def normalize_text(text: str) -> str:
    """Tidy extracted PDF text without destroying paragraph structure."""
    if not text:
        return ""

    text = text.replace(" ", " ")
    # PDF extraction often hyphenates across line breaks: "agree-\nment".
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
    text = _MULTI_NEWLINE.sub("\n\n", text)
    text = _INLINE_WHITESPACE.sub(" ", text)

    return "\n".join(line.strip() for line in text.split("\n")).strip()


def _hard_split(unit: str, limit: int) -> list[str]:
    """Break an oversized unit on word boundaries, then characters if needed."""
    if len(unit) <= limit:
        return [unit]

    pieces: list[str] = []
    current = ""

    for word in unit.split(" "):
        candidate = f"{current} {word}".strip()

        if len(candidate) <= limit:
            current = candidate
            continue

        if current:
            pieces.append(current)
            current = ""

        # A single "word" longer than the limit (long URLs, base64, table runs).
        while len(word) > limit:
            pieces.append(word[:limit])
            word = word[limit:]

        current = word

    if current:
        pieces.append(current)

    return pieces


def _split_units(text: str, limit: int) -> list[str]:
    units: list[str] = []

    for sentence in _SENTENCE_BOUNDARY.split(text):
        sentence = sentence.strip()
        if sentence:
            units.extend(_hard_split(sentence, limit))

    return units


def _overlap_tail(units: list[str], overlap: int, room: int) -> list[str]:
    """Trailing units of the finished chunk, to carry into the next one.

    Bounded by two things: `overlap` (how much context we want to repeat) and
    `room` (how much space is actually left once the next unit is placed).
    Without the `room` bound, a carried tail plus the next unit could exceed the
    target size on its own, and the following chunk would be emitted oversized.
    """
    budget = min(overlap, room)

    if budget <= 0:
        return []

    tail: list[str] = []
    total = 0

    for unit in reversed(units):
        addition = len(unit) + (1 if tail else 0)

        if total + addition > budget:
            break

        tail.insert(0, unit)
        total += addition

    return tail


def _joined_length(units: list[str]) -> int:
    if not units:
        return 0
    return sum(len(unit) for unit in units) + len(units) - 1


def chunk_text(
    text: str,
    chunk_size: int = 1000,
    chunk_overlap: int = 200,
) -> list[str]:
    """Split text into overlapping, sentence-aligned chunks."""
    normalized = normalize_text(text)

    if not normalized:
        return []

    chunk_size = max(1, chunk_size)
    # Guard against a caller passing an overlap at or above the chunk size. The
    # old character-window loop would never advance and would spin forever.
    chunk_overlap = max(0, min(chunk_overlap, chunk_size - 1))

    units = _split_units(normalized, chunk_size)

    chunks: list[str] = []
    current: list[str] = []
    current_length = 0

    for unit in units:
        addition = len(unit) + (1 if current else 0)

        if current and current_length + addition > chunk_size:
            chunks.append(" ".join(current))

            # Leave space for `unit` plus the joining space.
            carried = _overlap_tail(
                current,
                chunk_overlap,
                room=chunk_size - len(unit) - 1,
            )
            current = [*carried, unit]
            current_length = _joined_length(current)
            continue

        current.append(unit)
        current_length += addition

    if current:
        chunks.append(" ".join(current))

    return [chunk for chunk in (piece.strip() for piece in chunks) if chunk]
