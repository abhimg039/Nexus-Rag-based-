"""Ollama client.

Improvements over the first version:

  * A module-level `requests.Session`, so repeated questions reuse the TCP
    connection instead of completing a fresh handshake each time.
  * `keep_alive`, which tells Ollama to hold the model in memory. Without it
    the model can be evicted between questions and every question pays a
    multi-second reload.
  * A streaming generator, so the UI can render tokens as they are produced
    rather than waiting for the whole answer.
  * Explicit, friendly errors when Ollama is not running, instead of a raw
    stack trace surfacing as a 500.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator

import requests

from app.core.config import settings

logger = logging.getLogger(__name__)

_session = requests.Session()


class LlmUnavailableError(RuntimeError):
    """Ollama is unreachable, or the requested model is not installed."""


SYSTEM_RULES = """You are a document analysis assistant. Answer the user's question using only the numbered context passages provided.

Rules:
1. Use only information present in the context. Do not add outside knowledge.
2. Read every passage before concluding. Content may be in a table, form, or list rather than prose — extract the requested values when they are present.
3. Cite the page you used, like (page 4), after the relevant statement.
4. If the answer genuinely is not in the context, reply exactly: "I could not find the answer in the provided document."
5. Be direct and concise. Do not restate the question or describe your process."""


def build_prompt(question: str, context: str) -> str:
    return (
        f"{SYSTEM_RULES}\n\n"
        f"--- CONTEXT ---\n{context}\n--- END CONTEXT ---\n\n"
        f"Question: {question}\n\nAnswer:"
    )


def _payload(question: str, context: str, stream: bool) -> dict:
    return {
        "model": settings.llm_model,
        "prompt": build_prompt(question, context),
        "stream": stream,
        "keep_alive": settings.llm_keep_alive,
        "options": {
            # Low temperature: this is extraction, not creative writing.
            "temperature": settings.llm_temperature,
            "num_predict": settings.llm_max_tokens,
        },
    }


def _unavailable(error: Exception) -> LlmUnavailableError:
    failure = LlmUnavailableError(
        f"Could not reach the local model at {settings.ollama_base_url}. "
        f"Make sure Ollama is running (`ollama serve`) and that the model "
        f"'{settings.llm_model}' is installed (`ollama pull {settings.llm_model}`)."
    )
    # Preserve the original traceback without needing `raise ... from` at every
    # call site.
    failure.__cause__ = error
    return failure


def generate_answer(question: str, context: str) -> str:
    """Generate a complete answer in one call."""
    try:
        response = _session.post(
            settings.ollama_generate_url,
            json=_payload(question, context, stream=False),
            timeout=settings.llm_timeout,
        )
        response.raise_for_status()
    except requests.exceptions.ConnectionError as error:
        raise _unavailable(error)
    except requests.exceptions.Timeout as error:
        raise LlmUnavailableError(
            f"The model did not respond within {settings.llm_timeout}s."
        ) from error
    except requests.exceptions.HTTPError as error:
        raise LlmUnavailableError(f"Ollama rejected the request: {error}") from error

    return response.json().get("response", "").strip()


def stream_answer(question: str, context: str) -> Iterator[str]:
    """Yield answer fragments as the model produces them."""
    try:
        response = _session.post(
            settings.ollama_generate_url,
            json=_payload(question, context, stream=True),
            timeout=settings.llm_timeout,
            stream=True,
        )
        response.raise_for_status()
    except requests.exceptions.ConnectionError as error:
        raise _unavailable(error)
    except requests.exceptions.Timeout as error:
        raise LlmUnavailableError(
            f"The model did not respond within {settings.llm_timeout}s."
        ) from error
    except requests.exceptions.HTTPError as error:
        raise LlmUnavailableError(f"Ollama rejected the request: {error}") from error

    with response:
        for line in response.iter_lines(decode_unicode=True):
            if not line:
                continue

            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                logger.debug("Skipping malformed Ollama line: %r", line)
                continue

            if event.get("error"):
                raise LlmUnavailableError(str(event["error"]))

            fragment = event.get("response")
            if fragment:
                yield fragment

            if event.get("done"):
                break


def check_ollama() -> dict:
    """Report Ollama reachability and whether the configured model is present."""
    try:
        response = _session.get(settings.ollama_tags_url, timeout=5)
        response.raise_for_status()
    except requests.exceptions.RequestException as error:
        return {
            "status": "unavailable",
            "model": settings.llm_model,
            "detail": str(error),
        }

    installed = [entry.get("name", "") for entry in response.json().get("models", [])]

    # Ollama reports tags as "llama3.2:3b"; tolerate a bare "llama3.2".
    wanted = settings.llm_model
    model_present = any(
        name == wanted or name.split(":")[0] == wanted.split(":")[0] for name in installed
    )

    return {
        "status": "healthy" if model_present else "model_missing",
        "model": wanted,
        "models_installed": installed,
    }
