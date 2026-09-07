/**
 * Runtime tests for the pure browser-storage and formatting helpers.
 *
 * These run under plain node with no build step and no test framework:
 *
 *   node tests/storage.test.mjs
 *
 * They exist because the persistence layer is where the nastiest bug in this
 * app lived — a message stored while still flagged `streaming` rendered as
 * forever-typing on every reload AND blocked all later writes to that thread.
 * A regex-based checker cannot catch that; executing the code can.
 */

import assert from "node:assert/strict";

// --- localStorage stub, installed before the module under test is imported ---

class MemoryStorage {
  #data = new Map();
  #failNextWrite = false;

  failNextWrite() {
    this.#failNextWrite = true;
  }

  getItem(key) {
    return this.#data.has(key) ? this.#data.get(key) : null;
  }

  setItem(key, value) {
    if (this.#failNextWrite) {
      this.#failNextWrite = false;
      const error = new Error("QuotaExceededError");
      error.name = "QuotaExceededError";
      throw error;
    }
    this.#data.set(key, String(value));
  }

  removeItem(key) {
    this.#data.delete(key);
  }

  clear() {
    this.#data.clear();
  }

  get size() {
    return this.#data.size;
  }
}

const store = new MemoryStorage();
globalThis.localStorage = store;

const { STORAGE_KEY, INTERRUPTED_TEXT, settle, loadThread, saveThread, clearThread, pruneThreads } =
  await import("../src/lib/storage.js");
const { formatBytes, formatCount, formatDuration, formatRelativeTime, displayName, truncate } =
  await import("../src/lib/format.js");

// --- tiny harness ---------------------------------------------------------

let passed = 0;
const failures = [];

function test(name, body) {
  store.clear();
  try {
    body();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log(`FAIL  ${name}`);
  }
}

const raw = () => JSON.parse(store.getItem(STORAGE_KEY) ?? "null");

// --- storage --------------------------------------------------------------

test("a missing key loads as an empty thread", () => {
  assert.deepEqual(loadThread(7), []);
});

test("a falsy document id never touches storage", () => {
  saveThread(null, [{ id: "a", role: "user", text: "hi" }]);
  assert.equal(store.size, 0);
  assert.deepEqual(loadThread(null), []);
  assert.deepEqual(loadThread(undefined), []);
});

test("a saved thread round-trips", () => {
  const messages = [
    { id: "a", role: "user", text: "what is this?" },
    { id: "b", role: "assistant", text: "a document", sources: [{ page: 1 }] },
  ];
  saveThread(12, messages);
  assert.deepEqual(loadThread(12), messages);
});

test("numeric and string document ids address the same thread", () => {
  saveThread(12, [{ id: "a", role: "user", text: "x" }]);
  assert.equal(loadThread("12").length, 1);
});

test("threads are isolated per document", () => {
  saveThread(1, [{ id: "a", role: "user", text: "one" }]);
  saveThread(2, [{ id: "b", role: "user", text: "two" }]);
  assert.equal(loadThread(1)[0].text, "one");
  assert.equal(loadThread(2)[0].text, "two");
});

test("saving an empty thread deletes the entry rather than storing []", () => {
  saveThread(3, [{ id: "a", role: "user", text: "x" }]);
  saveThread(3, []);
  assert.equal(raw()?.["3"], undefined);
});

test("clearThread removes only its own document", () => {
  saveThread(1, [{ id: "a", role: "user", text: "one" }]);
  saveThread(2, [{ id: "b", role: "user", text: "two" }]);
  clearThread(1);
  assert.deepEqual(loadThread(1), []);
  assert.equal(loadThread(2).length, 1);
});

test("a thread is trimmed to the newest 100 messages", () => {
  const many = Array.from({ length: 150 }, (_, index) => ({
    id: `m${index}`,
    role: "user",
    text: String(index),
  }));
  saveThread(4, many);
  const stored = loadThread(4);
  assert.equal(stored.length, 100);
  // The trim must keep the END of the conversation, not the beginning.
  assert.equal(stored[0].text, "50");
  assert.equal(stored[99].text, "149");
});

test("corrupt JSON is ignored instead of throwing", () => {
  store.setItem(STORAGE_KEY, "{not json");
  assert.deepEqual(loadThread(1), []);
});

test("a stored array (wrong shape) is rejected, not spread into a map", () => {
  store.setItem(STORAGE_KEY, JSON.stringify(["nope"]));
  assert.deepEqual(loadThread(1), []);
  // A write after the bad value must produce a clean object.
  saveThread(5, [{ id: "a", role: "user", text: "x" }]);
  assert.equal(Array.isArray(raw()), false);
  assert.equal(loadThread(5).length, 1);
});

test("a stored null is rejected", () => {
  store.setItem(STORAGE_KEY, "null");
  assert.deepEqual(loadThread(1), []);
});

test("a non-array thread value is rejected", () => {
  store.setItem(STORAGE_KEY, JSON.stringify({ 9: { not: "an array" } }));
  assert.deepEqual(loadThread(9), []);
});

test("a failed write does not throw", () => {
  store.failNextWrite();
  assert.doesNotThrow(() => saveThread(1, [{ id: "a", role: "user", text: "x" }]));
});

test("pruneThreads drops threads whose document is gone", () => {
  saveThread(1, [{ id: "a", role: "user", text: "keep" }]);
  saveThread(2, [{ id: "b", role: "user", text: "drop" }]);
  pruneThreads([1]);
  assert.equal(loadThread(1).length, 1);
  assert.deepEqual(loadThread(2), []);
});

test("pruneThreads matches ids across string/number types", () => {
  saveThread(1, [{ id: "a", role: "user", text: "keep" }]);
  pruneThreads(["1"]);
  assert.equal(loadThread(1).length, 1);
});

test("pruneThreads with no surviving documents empties storage", () => {
  saveThread(1, [{ id: "a", role: "user", text: "x" }]);
  pruneThreads([]);
  assert.deepEqual(raw(), {});
});

// The regression that motivated this file: whatever reaches storage must be
// renderable, and a message flagged `streaming` is not. These exercise the real
// `settle` and the real `saveThread` — an earlier version of this test defined
// its own copy of `settle`, which meant it could not fail even if the
// production one were deleted outright.
test("saveThread never stores a message still flagged as streaming", () => {
  // Deliberately not settled by the caller: the guarantee has to hold even for
  // a caller that forgets, because one poisoned thread also blocks every later
  // write to that document.
  saveThread(6, [
    { id: "a", role: "user", text: "q" },
    { id: "b", role: "assistant", text: "half an ans", streaming: true },
  ]);

  const stored = loadThread(6);
  assert.equal(
    stored.some((message) => message.streaming),
    false,
  );
  assert.equal(stored[1].interrupted, true);
  // Partial text is kept — it is what the model actually managed to say.
  assert.equal(stored[1].text, "half an ans");
});

test("settle gives an empty interrupted answer replacement text", () => {
  const [question, answer] = settle([
    { id: "a", role: "user", text: "q" },
    { id: "b", role: "assistant", text: "", streaming: true },
  ]);

  // An empty bubble renders neither the thinking dots nor the actions row, so
  // it needs words of its own or it is just a blank box forever.
  assert.equal(answer.text, INTERRUPTED_TEXT);
  assert.equal(answer.streaming, false);
  assert.equal(answer.interrupted, true);
  // The question is untouched.
  assert.equal(question.text, "q");
});

test("settle leaves finished messages exactly as they were", () => {
  const finished = [
    { id: "a", role: "user", text: "q" },
    { id: "b", role: "assistant", text: "done", sources: [{ page: 2 }], meta: { generation_ms: 5 } },
  ];
  const settled = settle(finished);

  assert.deepEqual(settled, finished);
  // No stray `interrupted` flag on a perfectly good answer.
  assert.equal(settled[1].interrupted, undefined);
});

// --- formatting -----------------------------------------------------------

test("formatBytes covers each unit and rejects junk", () => {
  assert.equal(formatBytes(0), "");
  assert.equal(formatBytes(null), "");
  assert.equal(formatBytes(-5), "");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
});

test("formatCount pluralises", () => {
  assert.equal(formatCount(1, "page"), "1 page");
  assert.equal(formatCount(2, "page"), "2 pages");
  assert.equal(formatCount(0, "page"), "0 pages");
  assert.equal(formatCount(null, "page"), "0 pages");
  assert.equal(formatCount(3, "passage"), "3 passages");
});

test("formatDuration switches to seconds above 1s", () => {
  assert.equal(formatDuration(0), "");
  assert.equal(formatDuration(null), "");
  assert.equal(formatDuration(250), "250ms");
  assert.equal(formatDuration(1500), "1.5s");
});

test("formatRelativeTime treats naive backend timestamps as UTC", () => {
  const naive = new Date(Date.now() - 5 * 60 * 1000).toISOString().replace("Z", "").slice(0, 19);
  assert.equal(formatRelativeTime(naive), "5m ago");
  assert.equal(formatRelativeTime(""), "");
  assert.equal(formatRelativeTime("not a date"), "");
});

test("formatRelativeTime respects an explicit offset", () => {
  const withZ = new Date(Date.now() - 30 * 1000).toISOString();
  assert.equal(formatRelativeTime(withZ), "just now");
});

test("displayName strips only a trailing .pdf", () => {
  assert.equal(displayName("report.pdf"), "report");
  assert.equal(displayName("report.PDF"), "report");
  assert.equal(displayName("a.pdf.backup.pdf"), "a.pdf.backup");
  assert.equal(displayName(null), "Untitled");
});

test("truncate adds an ellipsis only when it cuts", () => {
  assert.equal(truncate("short", 10), "short");
  assert.equal(truncate("abcdefghij", 5), "abcde…");
  assert.equal(truncate(null), "");
});

// --- report ---------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`);

if (failures.length > 0) {
  console.log("\nFAILURES:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}

console.log("FAILURES: none");
