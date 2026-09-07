/**
 * Per-document conversation persistence.
 *
 * Threads are kept in localStorage so switching documents — or reloading the
 * page — does not lose the conversation. Everything is namespaced and version
 * tagged so the format can change safely later.
 */

const KEY = "nexus-rag:threads:v2";
const MAX_MESSAGES_PER_DOCUMENT = 100;

/** Exported so the error boundary can offer to clear it without duplicating the literal. */
export const STORAGE_KEY = KEY;

export const INTERRUPTED_TEXT = "This answer was interrupted before it finished.";

/**
 * Clear in-flight flags so a thread is safe to store and re-render later.
 *
 * A message still flagged `streaming` renders as forever-typing on reload, and
 * because the chat hook refuses to persist a streaming thread it would also
 * silently block every later write to that document. So this lives here, next
 * to the only code that can leak such a message to a future page load, and
 * `saveThread` applies it unconditionally.
 *
 * An empty answer needs replacement text as well as a cleared flag: with
 * `streaming` false and `text` empty, the bubble would render neither the
 * thinking dots nor the actions row, leaving a permanently blank message.
 */
export const settle = (messages) =>
  messages.map((message) =>
    message.streaming
      ? {
          ...message,
          streaming: false,
          interrupted: true,
          text: message.text || INTERRUPTED_TEXT,
        }
      : message,
  );

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    // An array is also `typeof "object"`, so reject it explicitly — the value
    // must be a plain map of documentId -> messages.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    // Corrupt or unavailable storage (private mode, quota) must never break the app.
    return {};
  }
}

function writeAll(threads) {
  try {
    localStorage.setItem(KEY, JSON.stringify(threads));
  } catch {
    /* storage full or unavailable — the in-memory thread still works */
  }
}

export function loadThread(documentId) {
  if (!documentId) return [];
  const thread = readAll()[String(documentId)];
  return Array.isArray(thread) ? thread : [];
}

export function saveThread(documentId, messages) {
  if (!documentId) return;

  const threads = readAll();
  // `settle` here rather than only at the call sites: this is the boundary
  // where an in-flight message would become a permanent one, so the guarantee
  // belongs where it cannot be forgotten by a future caller.
  const trimmed = settle(messages.slice(-MAX_MESSAGES_PER_DOCUMENT));

  if (trimmed.length === 0) delete threads[String(documentId)];
  else threads[String(documentId)] = trimmed;

  writeAll(threads);
}

export function clearThread(documentId) {
  saveThread(documentId, []);
}

/** Drop threads whose document no longer exists, so storage cannot grow forever. */
export function pruneThreads(existingDocumentIds) {
  const keep = new Set(existingDocumentIds.map(String));
  const threads = readAll();
  let changed = false;

  for (const key of Object.keys(threads)) {
    if (!keep.has(key)) {
      delete threads[key];
      changed = true;
    }
  }

  if (changed) writeAll(threads);
}
