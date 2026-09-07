import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { streamQuestion } from "../lib/api";
import { clearThread, loadThread, saveThread, settle } from "../lib/storage";

const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * A per-document conversation with streamed answers.
 *
 * The assistant message is created empty and filled in as tokens arrive, so the
 * answer types out instead of appearing all at once after a long wait.
 *
 * Messages are held together with the id of the document they belong to. That
 * pairing matters: the loading effect and the saving effect both run in the same
 * commit when the active document changes, and without it the outgoing
 * document's messages get written under the incoming document's key.
 */
export function useChat(documentId) {
  const [thread, setThread] = useState({ documentId: null, messages: [] });
  const [busy, setBusy] = useState(false);
  const abortRef = useRef(null);

  // `busy` is also tracked in a ref because `ask` reads it to refuse a second
  // concurrent question. Two sends dispatched inside a single frame would both
  // see the state as false and both start streaming, and the second would
  // overwrite `abortRef`, leaving the first stream with no way to be stopped.
  const busyRef = useRef(false);

  const setBusyFlag = useCallback((value) => {
    busyRef.current = value;
    setBusy(value);
  }, []);

  // Kept in sync during render rather than in an effect. Effect cleanups run
  // before effect bodies within a commit, so an effect-synced ref would still
  // hold the previous render's messages at the moment the switch-away cleanup
  // below tries to save them, dropping the last tokens received.
  const threadRef = useRef(thread);
  threadRef.current = thread;

  // Swap in the stored thread whenever the active document changes, and flush
  // the outgoing one on the way out so an in-flight answer is not lost.
  //
  // A layout effect, not a passive one: `messages` is derived from
  // `thread.documentId === documentId`, so with a passive effect the render
  // where the document has changed but the thread has not is painted — one
  // frame of the empty starter screen between two conversations, with clickable
  // starter buttons that a click would be silently dropped from.
  useLayoutEffect(() => {
    // `settle` on the way in as well as out: a thread stored by an older build,
    // or by a tab that was closed mid-answer, can still hold `streaming: true`.
    // Left alone it renders as forever-typing, and — because the save effect
    // below refuses to persist a streaming message — it would also silently
    // block every future write to this document's thread.
    setThread({ documentId, messages: settle(loadThread(documentId)) });
    setBusyFlag(false);
    abortRef.current?.abort();
    abortRef.current = null;

    return () => {
      const outgoing = threadRef.current;
      if (outgoing.documentId) {
        saveThread(outgoing.documentId, settle(outgoing.messages));
      }
    };
  }, [documentId, setBusyFlag]);

  // Persist once the answer has settled. A message still marked `streaming`
  // must never reach storage, or it would render as forever-typing on reload.
  useEffect(() => {
    if (!thread.documentId || thread.documentId !== documentId) return;
    if (thread.messages.some((message) => message.streaming)) return;
    saveThread(thread.documentId, thread.messages);
  }, [thread, documentId]);

  /**
   * Update one message, but only while its document is still the active one —
   * a stream that outlives a document switch must not write into the thread
   * that replaced it.
   */
  const patchIn = useCallback((ownerId, messageId, changes) => {
    setThread((current) => {
      if (current.documentId !== ownerId) return current;
      return {
        ...current,
        messages: current.messages.map((message) =>
          message.id === messageId ? { ...message, ...changes } : message,
        ),
      };
    });
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusyFlag(false);
  }, [setBusyFlag]);

  const ask = useCallback(
    async (rawQuestion) => {
      const question = rawQuestion.trim();
      // The ref, not the state, so two sends in the same frame cannot both pass.
      if (!question || busyRef.current || !documentId) return;

      // `thread` trails `documentId` by one commit, because it is replaced in an
      // effect. Sending during that window would post the question to the
      // server while the state updater below discarded the message, so the
      // answer would arrive nowhere. Wait for the swap instead.
      if (threadRef.current.documentId !== documentId) return;

      const owner = documentId;
      const answerId = newId();

      setThread((current) =>
        current.documentId !== owner
          ? current
          : {
              ...current,
              messages: [
                ...current.messages,
                { id: newId(), role: "user", text: question },
                { id: answerId, role: "assistant", text: "", sources: [], streaming: true },
              ],
            },
      );

      const controller = new AbortController();
      abortRef.current = controller;
      setBusyFlag(true);

      let received = "";
      let retrievalMs = 0;

      try {
        await streamQuestion({
          question,
          documentId: owner,
          signal: controller.signal,
          onSources: (sources, ms) => {
            retrievalMs = ms;
            // Evidence arrives before the first token, so show it straight away.
            patchIn(owner, answerId, { sources });
          },
          onToken: (fragment) => {
            received += fragment;
            patchIn(owner, answerId, { text: received });
          },
          onDone: (generationMs) => {
            patchIn(owner, answerId, {
              streaming: false,
              meta: { retrieval_ms: retrievalMs, generation_ms: generationMs },
            });
          },
        });
      } catch (caught) {
        const reason = caught?.message || "Something went wrong while answering.";

        if (caught?.name === "AbortError") {
          patchIn(owner, answerId, {
            streaming: false,
            stopped: true,
            text: received || "Stopped before the model replied.",
          });
        } else if (received) {
          // Keep what the model already wrote rather than throwing it away.
          patchIn(owner, answerId, {
            streaming: false,
            interrupted: true,
            text: `${received}\n\n(${reason})`,
          });
        } else {
          patchIn(owner, answerId, { streaming: false, error: true, text: reason });
        }
      } finally {
        abortRef.current = null;
        setBusyFlag(false);
        // Belt and braces: whatever happened above, this message is no longer
        // streaming, so it is safe to persist.
        patchIn(owner, answerId, { streaming: false });
      }
    },
    [documentId, patchIn, setBusyFlag],
  );

  const clear = useCallback(() => {
    stop();
    // Guarded for the same reason as `ask`: during the one commit where the
    // document has changed but the thread has not been swapped in yet, an
    // unguarded reset would empty the outgoing document's messages.
    setThread((current) =>
      current.documentId === documentId ? { ...current, messages: [] } : current,
    );
    clearThread(documentId);
  }, [documentId, stop]);

  // Abort any in-flight stream when the component unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Never hand back the outgoing document's messages during the one commit
  // where `documentId` has changed but the thread has not been swapped yet —
  // that briefly renders the previous conversation under the new document.
  const messages = thread.documentId === documentId ? thread.messages : [];

  return { messages, busy, ask, stop, clear };
}
