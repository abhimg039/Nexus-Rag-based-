import { useState } from "react";

import Icon from "./Icon";

const PHASE_TEXT = {
  uploading: "Uploading",
  indexing: "Extracting text and building embeddings",
};

/**
 * PDF drop target.
 *
 * `variant="hero"` is the large empty-state version; "compact" is the small one
 * shown in the sidebar once documents exist.
 *
 * This renders no <input> of its own. The file input lives once in App, because
 * two dropzones can be mounted at the same time and sharing a single input ref
 * between them left the ref null once either unmounted — which silently broke
 * every click-to-browse button.
 */
export default function UploadDropzone({ upload, onFile, onBrowse, variant = "hero" }) {
  const [dragging, setDragging] = useState(false);
  const busy = upload.active;

  return (
    <div
      className={`dropzone dropzone-${variant} ${dragging ? "is-dragging" : ""} ${busy ? "is-busy" : ""}`}
    >
      <button
        type="button"
        className="dropzone-surface"
        disabled={busy}
        onClick={onBrowse}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
      >
        <span className="dropzone-icon">
          <Icon name="upload" size={variant === "hero" ? 22 : 16} />
        </span>

        <span className="dropzone-copy">
          <span className="dropzone-title">
            {busy
              ? PHASE_TEXT[upload.phase] || "Working"
              : dragging
                ? "Drop to upload"
                : variant === "hero"
                  ? "Drop a PDF here"
                  : "Upload a PDF"}
          </span>
          {variant === "hero" && !busy && (
            <span className="dropzone-subtitle">or click to browse · PDF only</span>
          )}
          {busy && <span className="dropzone-subtitle">{upload.filename}</span>}
        </span>
      </button>

      {busy && (
        <div className="upload-progress">
          {/* A real percentage while bytes are in flight; indeterminate once the
              server takes over and there is nothing meaningful to measure. */}
          <div
            className={`upload-bar ${upload.phase === "indexing" ? "is-indeterminate" : ""}`}
            style={upload.phase === "uploading" ? { width: `${upload.percent}%` } : undefined}
          />
        </div>
      )}
    </div>
  );
}
