import { displayName, formatCount, formatRelativeTime } from "../lib/format";
import Icon from "./Icon";

function statusLabel(document) {
  if (document.status === "failed") return "Failed";
  // "uploaded" is the state between the row being created and indexing
  // starting — it is not yet answerable, so it must not read as ready.
  if (document.status === "processing" || document.status === "uploaded") return "Indexing";
  if (document.chunk_count) return formatCount(document.chunk_count, "passage");
  return "Ready";
}

export default function DocumentLibrary({
  documents,
  loading,
  activeId,
  onSelect,
  onDelete,
  onUploadClick,
  uploadDisabled = false,
}) {
  return (
    <div className="library">
      <div className="library-head">
        <h2 className="library-title">Documents</h2>
        {/* Disabled while a file is indexing: the shared file input is disabled
            then too, and `.click()` on a disabled input does nothing, so this
            would otherwise be a button that silently ignores you. */}
        <button
          type="button"
          className="icon-button"
          onClick={onUploadClick}
          disabled={uploadDisabled}
          title={uploadDisabled ? "Finishing the current upload…" : "Upload a PDF"}
        >
          <Icon name="plus" />
          <span className="sr-only">Upload a PDF</span>
        </button>
      </div>

      {loading && documents.length === 0 && (
        <div className="library-placeholder">
          {[0, 1, 2].map((row) => (
            <div className="skeleton-row" key={row} />
          ))}
        </div>
      )}

      {!loading && documents.length === 0 && (
        <p className="library-empty">
          No documents yet. Upload a PDF to start asking questions.
        </p>
      )}

      <ul className="document-list">
        {documents.map((document) => {
          const isActive = document.id === activeId;
          const failed = document.status === "failed";

          return (
            <li key={document.id}>
              {/* The delete control is a separate button, so the row itself is a
                  plain button rather than nested interactive elements. */}
              <div className={`document-row ${isActive ? "is-active" : ""} ${failed ? "is-failed" : ""}`}>
                <button
                  type="button"
                  className="document-main"
                  onClick={() => onSelect(document)}
                  aria-current={isActive ? "true" : undefined}
                  title={document.filename}
                >
                  <span className="document-icon">
                    <Icon name={failed ? "alert" : "file"} size={16} />
                  </span>
                  <span className="document-text">
                    <span className="document-name">{displayName(document.filename)}</span>
                    <span className="document-meta">
                      {statusLabel(document)}
                      {document.page_count ? ` · ${formatCount(document.page_count, "page")}` : ""}
                      {document.created_at ? ` · ${formatRelativeTime(document.created_at)}` : ""}
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  className="document-delete"
                  onClick={() => onDelete(document)}
                  title={`Delete ${document.filename}`}
                >
                  <Icon name="trash" size={15} />
                  <span className="sr-only">Delete {document.filename}</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
