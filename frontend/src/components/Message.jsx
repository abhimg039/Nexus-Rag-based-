import { useEffect, useRef, useState } from "react";

import { formatDuration } from "../lib/format";
import AnswerText from "./AnswerText";
import Icon from "./Icon";
import SourceList from "./SourceList";

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — nothing useful to show the user */
    }
  };

  return (
    <button type="button" className="ghost-button" onClick={copy}>
      <Icon name={copied ? "check" : "copy"} size={14} />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function Message({ message }) {
  if (message.role === "user") {
    return (
      <article className="message message-user">
        <div className="message-bubble">{message.text}</div>
      </article>
    );
  }

  const { text, streaming, sources, meta, error, stopped, interrupted } = message;
  const showThinking = streaming && !text;

  return (
    <article className={`message message-assistant ${error ? "is-error" : ""}`}>
      <div className="message-avatar" aria-hidden="true">
        <Icon name={error ? "alert" : "spark"} size={15} />
      </div>

      <div className="message-content">
        {showThinking ? (
          <div className="thinking">
            <span className="thinking-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>{sources?.length ? "Reading the passages…" : "Searching the document…"}</span>
          </div>
        ) : (
          <div className="answer">
            <AnswerText text={text} />
            {streaming && <span className="caret" aria-hidden="true" />}
          </div>
        )}

        {/* Shown while the answer is still streaming: the passages are retrieved
            before the first token, so the evidence is available immediately and
            can be read while the model writes. */}
        {sources?.length > 0 && <SourceList sources={sources} />}

        {!streaming && !error && text && (
          <div className="message-actions">
            <CopyButton text={text} />
            {meta?.generation_ms ? (
              <span className="message-timing">
                {formatDuration(meta.retrieval_ms)} retrieval ·{" "}
                {formatDuration(meta.generation_ms)} generation
              </span>
            ) : null}
            {stopped && <span className="message-timing">stopped</span>}
            {interrupted && <span className="message-timing">ended early</span>}
          </div>
        )}
      </div>
    </article>
  );
}
