import { useEffect, useRef } from "react";

import Message from "./Message";

const STARTERS = [
  "Summarise this document in five bullet points.",
  "What are the key dates and deadlines?",
  "List every requirement mentioned.",
  "What are the main risks or limitations?",
];

export default function ChatThread({ messages, documentName, onStarter, disabled = false }) {
  const endRef = useRef(null);
  const containerRef = useRef(null);
  const pinnedRef = useRef(true);
  const selfScrollRef = useRef(false);

  // Follow the stream, but stop following if the user scrolls up to read.
  const handleScroll = () => {
    // Ignore the scroll events our own scrollIntoView generates, otherwise the
    // programmatic scroll can unpin itself part-way through.
    if (selfScrollRef.current) return;
    const element = containerRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    pinnedRef.current = distance < 120;
  };

  useEffect(() => {
    if (!pinnedRef.current) return;

    selfScrollRef.current = true;
    endRef.current?.scrollIntoView({ block: "end", behavior: "instant" });
    const release = setTimeout(() => {
      selfScrollRef.current = false;
    }, 0);

    return () => clearTimeout(release);
  }, [messages]);

  const last = messages[messages.length - 1];
  const isStreaming = Boolean(last?.streaming);

  // Announce only the transitions, not the tokens. Putting aria-live on the
  // thread itself would make a screen reader re-read the whole answer on every
  // token that arrives, which is unusable.
  //
  // Computed before the early return below so the live region is already in the
  // DOM when the first question is asked. Most screen readers announce changes
  // to an existing region but stay silent about one that appears already
  // populated, so a region rendered only alongside messages would miss the
  // very first "Answering…".
  const announcement = isStreaming
    ? "Answering…"
    : last?.role === "assistant" && last?.text
      ? "Answer ready."
      : "";

  const liveRegion = (
    <p className="sr-only" role="status">
      {announcement}
    </p>
  );

  if (messages.length === 0) {
    return (
      <div className="thread thread-empty">
        {liveRegion}
        <div className="starter-block">
          <h2>Ask anything about {documentName || "this document"}</h2>
          <p>Answers are grounded in the retrieved passages, and cite the page they came from.</p>
          {!disabled && (
            <div className="starters">
              {STARTERS.map((prompt) => (
                <button
                  type="button"
                  className="starter"
                  key={prompt}
                  onClick={() => onStarter(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="thread" ref={containerRef} onScroll={handleScroll}>
      {liveRegion}
      {/* role="log" describes the structure, but its implicit aria-live would
          re-read the growing answer on every token — so it is switched off and
          the status region above stays the single voice. */}
      <div className="thread-inner" role="log" aria-live="off">
        {messages.map((message) => (
          <Message message={message} key={message.id} />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
