/**
 * API client.
 *
 * All paths are same-origin and relative: Vite proxies /api to the backend in
 * development (see vite.config.js). Set VITE_API_BASE_URL only if you deploy
 * the frontend on a different origin from the API.
 */

// Optional chaining so this module can also be imported by the node-based
// tests, where `import.meta.env` does not exist. Vite still substitutes the
// env object at build time.
const BASE = import.meta.env?.VITE_API_BASE_URL ?? "";

function url(path) {
  return `${BASE}${path}`;
}

async function readError(response, fallback) {
  try {
    const data = await response.json();
    if (typeof data?.detail === "string") return data.detail;
    // FastAPI validation errors arrive as an array of issue objects.
    if (Array.isArray(data?.detail)) {
      return data.detail.map((issue) => issue.msg).filter(Boolean).join("; ") || fallback;
    }
  } catch {
    /* body was not JSON */
  }
  return fallback;
}

async function getJson(path, fallback) {
  const response = await fetch(url(path));
  if (!response.ok) throw new Error(await readError(response, fallback));
  return response.json();
}

export function getSession() {
  return getJson("/api/session", "Could not start a session.");
}

export function getHealth() {
  return getJson("/health/full", "Could not read system health.");
}

export function listDocuments(userId) {
  return getJson(`/api/documents?user_id=${encodeURIComponent(userId)}`, "Could not load your documents.");
}

export async function deleteDocument(documentId) {
  const response = await fetch(url(`/api/documents/${documentId}`), { method: "DELETE" });
  if (!response.ok) throw new Error(await readError(response, "Could not delete the document."));
  return response.json();
}

/**
 * Upload a PDF.
 *
 * Uses XMLHttpRequest rather than fetch because fetch cannot report upload
 * progress — this lets the UI show a real percentage instead of an
 * indeterminate spinner.
 */
export function uploadDocument({ file, userId, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url(`/api/documents/upload?user_id=${encodeURIComponent(userId)}`));
    request.responseType = "json";

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    request.addEventListener("load", () => {
      const body = request.response;

      if (request.status >= 200 && request.status < 300) {
        resolve(body);
        return;
      }

      const detail = typeof body?.detail === "string" ? body.detail : null;
      reject(new Error(detail || `Upload failed (${request.status}).`));
    });

    request.addEventListener("error", () => reject(new Error("Network error during upload.")));
    request.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));

    if (signal) {
      if (signal.aborted) {
        request.abort();
        return;
      }
      signal.addEventListener("abort", () => request.abort(), { once: true });
    }

    const form = new FormData();
    form.append("file", file);
    request.send(form);
  });
}

/** Non-streaming question, kept as a fallback. */
export async function askQuestion({ question, documentId, limit = 5, signal }) {
  const response = await fetch(url("/api/questions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, document_id: documentId, limit }),
    signal,
  });

  if (!response.ok) throw new Error(await readError(response, "Could not get an answer."));
  return response.json();
}

/**
 * Ask a question and receive the answer as it is generated.
 *
 * Reads the server-sent event stream directly. EventSource is not used because
 * it only supports GET, and this endpoint takes a JSON body.
 */
export async function streamQuestion({
  question,
  documentId,
  limit = 5,
  signal,
  onSources,
  onToken,
  onDone,
}) {
  const response = await fetch(url("/api/questions/stream"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ question, document_id: documentId, limit }),
    signal,
  });

  if (!response.ok) throw new Error(await readError(response, "Could not get an answer."));
  if (!response.body) throw new Error("Streaming is not supported by this browser.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  const handle = (payload) => {
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }

    if (event.type === "sources") onSources?.(event.sources ?? [], event.retrieval_ms ?? 0);
    else if (event.type === "token") onToken?.(event.text ?? "");
    else if (event.type === "done") {
      completed = true;
      onDone?.(event.generation_ms ?? 0);
    } else if (event.type === "error") {
      throw new Error(event.message || "The model reported an error.");
    }
  };

  const drain = (chunk) => {
    // Frames are separated by a blank line. Anything after the last blank line
    // is a partial frame, so it stays in the buffer until more bytes arrive.
    buffer += chunk.replace(/\r\n/g, "\n");
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        if (line.startsWith("data:")) handle(line.slice(5).trim());
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      drain(decoder.decode(value, { stream: true }));
    }

    // Flush any multi-byte character straddling the final chunk boundary, then
    // process a last frame that arrived without a trailing blank line.
    drain(decoder.decode());
    for (const line of buffer.split("\n")) {
      if (line.startsWith("data:")) handle(line.slice(5).trim());
    }
  } finally {
    // Releases the lock whether we finished, threw, or were aborted.
    reader.cancel().catch(() => {});
  }

  // The server always ends with a `done` frame. Reaching here without one means
  // the connection dropped mid-answer, which the caller must be told about —
  // otherwise the message would sit in the UI looking like it is still typing.
  if (!completed) throw new Error("The answer stream ended before the model finished.");
}
