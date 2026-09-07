import { useEffect, useRef, useState } from "react";

import Icon from "./Icon";

const MAX_HEIGHT = 200;

export default function Composer({ busy, disabled, onSend, onStop, placeholder }) {
  const [value, setValue] = useState("");
  const textareaRef = useRef(null);

  // Grow with the content instead of being locked to a fixed 5 rows.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const submit = () => {
    const question = value.trim();
    if (!question || busy || disabled) return;
    onSend(question);
    setValue("");
  };

  const handleKeyDown = (event) => {
    // Esc interrupts a streaming answer without reaching for the mouse.
    if (event.key === "Escape" && busy) {
      event.preventDefault();
      onStop();
      return;
    }
    // Enter sends, Shift+Enter makes a newline — the convention people expect.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer">
      <div className={`composer-box ${disabled ? "is-disabled" : ""}`}>
        <textarea
          ref={textareaRef}
          className="composer-input"
          value={value}
          rows={1}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Ask a question about your document"
        />

        {busy ? (
          <button type="button" className="composer-button is-stop" onClick={onStop}>
            <Icon name="stop" size={16} />
            <span className="sr-only">Stop generating</span>
          </button>
        ) : (
          <button
            type="button"
            className="composer-button"
            onClick={submit}
            disabled={disabled || !value.trim()}
          >
            <Icon name="send" size={18} />
            <span className="sr-only">Send question</span>
          </button>
        )}
      </div>

      {/* The textarea stays usable while an answer streams so the next question
          can be drafted, but Enter is ignored until it finishes — say so,
          rather than letting the keypress vanish without explanation. */}
      <p className="composer-hint">
        {busy ? (
          <>Answering… press <kbd>Esc</kbd> or Stop to interrupt</>
        ) : (
          <>
            <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
          </>
        )}
      </p>
    </div>
  );
}
