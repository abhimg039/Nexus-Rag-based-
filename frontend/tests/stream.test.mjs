/**
 * Runtime tests for the server-sent-event parser in src/lib/api.js.
 *
 *   node tests/stream.test.mjs
 *
 * The streaming path is the hardest part of this app to eyeball, and one of its
 * bugs was severe: when a connection dropped mid-answer the reader loop exited
 * cleanly, so the caller believed the answer was complete and stored a message
 * that was still flagged as typing. These tests drive the real parser with a
 * fake fetch so that behaviour is pinned down.
 */

import assert from "node:assert/strict";

const { streamQuestion } = await import("../src/lib/api.js");

const frame = (object) => `data: ${JSON.stringify(object)}\n\n`;

/** Serve the given chunks (strings or Uint8Arrays) as a streamed response. */
function serve(chunks, { ok = true, status = 200, body = true } = {}) {
  globalThis.fetch = async () => {
    if (!ok) {
      return {
        ok: false,
        status,
        json: async () => ({ detail: "document not found" }),
      };
    }

    if (!body) return { ok: true, status, body: null };

    const encoder = new TextEncoder();
    const queue = chunks.map((chunk) =>
      typeof chunk === "string" ? encoder.encode(chunk) : chunk,
    );
    let index = 0;

    return {
      ok: true,
      status,
      body: {
        getReader() {
          return {
            async read() {
              if (index >= queue.length) return { done: true, value: undefined };
              return { done: false, value: queue[index++] };
            },
            async cancel() {},
          };
        },
      },
    };
  };
}

function collector() {
  const tokens = [];
  const state = { sources: null, retrievalMs: null, doneMs: null, tokens };
  return {
    state,
    handlers: {
      onSources: (sources, ms) => {
        state.sources = sources;
        state.retrievalMs = ms;
      },
      onToken: (text) => tokens.push(text),
      onDone: (ms) => {
        state.doneMs = ms;
      },
    },
  };
}

let passed = 0;
const failures = [];

async function test(name, body) {
  try {
    await body();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log(`FAIL  ${name}`);
  }
}

const ask = (handlers) =>
  streamQuestion({ question: "why?", documentId: 1, ...handlers });

// --- happy path -----------------------------------------------------------

await test("a complete stream delivers sources, tokens and a done event", async () => {
  serve([
    frame({ type: "sources", sources: [{ page: 3 }], retrieval_ms: 42 }),
    frame({ type: "token", text: "Hello" }),
    frame({ type: "token", text: " world" }),
    frame({ type: "done", generation_ms: 900 }),
  ]);

  const { state, handlers } = collector();
  await ask(handlers);

  assert.deepEqual(state.sources, [{ page: 3 }]);
  assert.equal(state.retrievalMs, 42);
  assert.equal(state.tokens.join(""), "Hello world");
  assert.equal(state.doneMs, 900);
});

await test("a frame split across two network chunks is reassembled", async () => {
  const whole = frame({ type: "token", text: "split" }) + frame({ type: "done", generation_ms: 1 });
  const cut = 12;
  serve([whole.slice(0, cut), whole.slice(cut)]);

  const { state, handlers } = collector();
  await ask(handlers);
  assert.equal(state.tokens.join(""), "split");
});

await test("many frames arriving in one chunk are all processed", async () => {
  serve([
    frame({ type: "token", text: "a" }) +
      frame({ type: "token", text: "b" }) +
      frame({ type: "token", text: "c" }) +
      frame({ type: "done", generation_ms: 5 }),
  ]);

  const { state, handlers } = collector();
  await ask(handlers);
  assert.equal(state.tokens.join(""), "abc");
});

await test("CRLF line endings are handled", async () => {
  serve([
    'data: {"type":"token","text":"crlf"}\r\n\r\n',
    'data: {"type":"done","generation_ms":2}\r\n\r\n',
  ]);

  const { state, handlers } = collector();
  await ask(handlers);
  assert.equal(state.tokens.join(""), "crlf");
  assert.equal(state.doneMs, 2);
});

await test("a final frame with no trailing blank line is still processed", async () => {
  serve([
    frame({ type: "token", text: "tail" }),
    'data: {"type":"done","generation_ms":7}',
  ]);

  const { state, handlers } = collector();
  await ask(handlers);
  assert.equal(state.tokens.join(""), "tail");
  assert.equal(state.doneMs, 7);
});

await test("a multi-byte character split across chunks is not corrupted", async () => {
  const text = frame({ type: "token", text: "café ☕" }) + frame({ type: "done", generation_ms: 1 });
  const bytes = new TextEncoder().encode(text);
  // Cut inside the 2-byte "é" so the decoder must carry state across reads.
  const cut = bytes.indexOf(0xc3) + 1;
  serve([bytes.slice(0, cut), bytes.slice(cut)]);

  const { state, handlers } = collector();
  await ask(handlers);
  assert.equal(state.tokens.join(""), "café ☕");
});

await test("comment and keep-alive lines are ignored", async () => {
  serve([
    ": keep-alive\n\n",
    "event: ping\n\n",
    frame({ type: "token", text: "ok" }),
    frame({ type: "done", generation_ms: 1 }),
  ]);

  const { state, handlers } = collector();
  await ask(handlers);
  assert.equal(state.tokens.join(""), "ok");
});

await test("malformed JSON in one frame does not abort the stream", async () => {
  serve([
    "data: {not json}\n\n",
    frame({ type: "token", text: "survived" }),
    frame({ type: "done", generation_ms: 1 }),
  ]);

  const { state, handlers } = collector();
  await ask(handlers);
  assert.equal(state.tokens.join(""), "survived");
});

await test("an unknown event type is ignored", async () => {
  serve([
    frame({ type: "heartbeat" }),
    frame({ type: "token", text: "x" }),
    frame({ type: "done", generation_ms: 1 }),
  ]);

  const { state, handlers } = collector();
  await ask(handlers);
  assert.equal(state.tokens.join(""), "x");
});

// --- failure paths --------------------------------------------------------

// This is the regression that matters most: without the completion check the
// call resolved successfully and the caller left the message marked streaming.
await test("a stream that ends without a done frame throws", async () => {
  serve([frame({ type: "token", text: "half an ans" })]);

  const { state, handlers } = collector();
  await assert.rejects(() => ask(handlers), /ended before the model finished/);
  // The partial text still reached the caller, so it can be kept on screen.
  assert.equal(state.tokens.join(""), "half an ans");
  assert.equal(state.doneMs, null);
});

await test("an entirely empty stream throws rather than resolving", async () => {
  serve([]);
  const { handlers } = collector();
  await assert.rejects(() => ask(handlers), /ended before the model finished/);
});

await test("a server error frame surfaces its message", async () => {
  serve([
    frame({ type: "token", text: "start" }),
    frame({ type: "error", message: "Ollama is not running" }),
  ]);

  const { handlers } = collector();
  await assert.rejects(() => ask(handlers), /Ollama is not running/);
});

await test("an error frame with no message still throws something readable", async () => {
  serve([frame({ type: "error" })]);
  const { handlers } = collector();
  await assert.rejects(() => ask(handlers), /model reported an error/);
});

await test("a non-ok response reports the server's detail", async () => {
  serve([], { ok: false, status: 404 });
  const { handlers } = collector();
  await assert.rejects(() => ask(handlers), /document not found/);
});

await test("a response with no body is reported clearly", async () => {
  serve([], { body: false });
  const { handlers } = collector();
  await assert.rejects(() => ask(handlers), /Streaming is not supported/);
});

await test("a done frame with no timing still completes", async () => {
  serve([frame({ type: "done" })]);
  const { state, handlers } = collector();
  await ask(handlers);
  assert.equal(state.doneMs, 0);
});

await test("missing callbacks do not throw", async () => {
  serve([
    frame({ type: "sources", sources: [] }),
    frame({ type: "token", text: "x" }),
    frame({ type: "done" }),
  ]);
  await assert.doesNotReject(() => streamQuestion({ question: "q", documentId: 1 }));
});

// --- abort ----------------------------------------------------------------

// useChat needs the AbortError to arrive *as* an AbortError: that name is how it
// tells "the user pressed Stop" apart from a real failure, and it picks between
// a calm "Stopped before the model replied." and a red error bubble on that
// alone. If the completion check at the end of streamQuestion ran on this path
// it would replace the abort with "the stream ended before the model finished",
// so every Stop would look like a crash.
await test("aborting mid-stream rejects with an AbortError, not a stream error", async () => {
  const controller = new AbortController();
  let cancelled = false;

  globalThis.fetch = async (_path, options) => ({
    ok: true,
    status: 200,
    body: {
      getReader() {
        let servedFirst = false;
        return {
          async read() {
            if (options?.signal?.aborted) {
              throw new DOMException("The operation was aborted.", "AbortError");
            }
            if (servedFirst) {
              // The user presses Stop while we are waiting for the next token.
              controller.abort();
              throw new DOMException("The operation was aborted.", "AbortError");
            }
            servedFirst = true;
            return {
              done: false,
              value: new TextEncoder().encode(frame({ type: "token", text: "partial" })),
            };
          },
          async cancel() {
            cancelled = true;
          },
        };
      },
    },
  });

  const { state, handlers } = collector();

  await assert.rejects(
    () => streamQuestion({ question: "why?", documentId: 1, signal: controller.signal, ...handlers }),
    (error) => {
      assert.equal(error.name, "AbortError");
      assert.doesNotMatch(error.message, /ended before the model finished/);
      return true;
    },
  );

  // What did arrive still reached the caller, so the UI can keep it on screen.
  assert.equal(state.tokens.join(""), "partial");
  // And the reader lock is released even on this path.
  assert.equal(cancelled, true);
});

await test("an already-aborted signal fails before any token is delivered", async () => {
  const controller = new AbortController();
  controller.abort();

  globalThis.fetch = async (_path, options) => {
    if (options?.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    throw new Error("the signal was not passed through to fetch");
  };

  const { state, handlers } = collector();

  await assert.rejects(
    () => streamQuestion({ question: "why?", documentId: 1, signal: controller.signal, ...handlers }),
    (error) => error.name === "AbortError",
  );
  assert.equal(state.tokens.length, 0);
});

// --- report ---------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`);

if (failures.length > 0) {
  console.log("\nFAILURES:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}

console.log("FAILURES: none");
