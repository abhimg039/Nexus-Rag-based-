"""Chunker tests.

Dependency-free on purpose — run without installing anything:

    cd backend
    python -m tests.test_chunker
"""

from __future__ import annotations

import random
import string
import sys

from app.document_processing.chunker import chunk_text, normalize_text

failures: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    print(f"{'PASS  ' if condition else 'FAIL  '}{name}" + ("" if condition else f"  <- {detail}"))
    if not condition:
        failures.append(name)


def main() -> int:
    check("empty string yields no chunks", chunk_text("") == [])
    check("whitespace yields no chunks", chunk_text("   \n\n \t ") == [])

    short = "This is a short sentence. Here is a second one."
    chunks = chunk_text(short, 1000, 200)
    check("short text stays one chunk", len(chunks) == 1, chunks)
    check("short text is preserved verbatim", chunks[0] == short, chunks)

    # Regression: the original character-window loop never advanced when the
    # overlap met or exceeded the chunk size, and looped forever.
    chunk_text("word " * 500, chunk_size=100, chunk_overlap=100)
    chunk_text("word " * 500, chunk_size=50, chunk_overlap=999)
    check("overlap >= chunk_size still terminates", True)

    text = ". ".join(f"Sentence number {index} has some words in it" for index in range(400)) + "."
    chunks = chunk_text(text, 500, 100)

    check("no chunk exceeds chunk_size", all(len(chunk) <= 500 for chunk in chunks))
    check("long text splits into many chunks", len(chunks) > 5, len(chunks))

    # Regression: blind character slicing cut words in half, which degrades
    # embedding quality.
    source_tokens = set(text.replace(".", " ").split())
    stray = [
        token
        for chunk in chunks
        for token in chunk.replace(".", " ").split()
        if token not in source_tokens
    ]
    check("no word is split mid-token", not stray, stray[:5])

    overlapping = sum(
        1
        for first, second in zip(chunks, chunks[1:])
        if set(first.split()[-8:]) & set(second.split()[:8])
    )
    check(
        "consecutive chunks share context",
        overlapping >= len(chunks) - 2,
        f"{overlapping}/{len(chunks) - 1}",
    )

    rejoined = " ".join(chunks)
    dropped = [
        index for index in range(0, 400, 37) if f"Sentence number {index} has" not in rejoined
    ]
    check("no content is dropped", not dropped, dropped)

    giant = "A" * 5000
    pieces = chunk_text(giant, 500, 50)
    check(
        "a single oversized token is split, not dropped",
        sum(piece.count("A") for piece in pieces) >= 5000,
        len(pieces),
    )

    check("hyphenation across a line break is repaired", "agreement" in normalize_text("agree-\nment"))

    random.seed(7)
    alphabet = string.ascii_letters + " .\n\t!?-"
    for _ in range(2000):
        noise = "".join(random.choice(alphabet) for _ in range(random.randint(0, 800)))
        size = random.randint(1, 200)
        overlap = random.randint(0, 300)
        for chunk in chunk_text(noise, size, overlap):
            if len(chunk) > size:
                check("fuzz respects the size bound", False, (size, overlap, len(chunk)))
                return 1
    check("2000 fuzz cases respect the size bound", True)

    print()
    print("FAILURES:", failures if failures else "none")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
