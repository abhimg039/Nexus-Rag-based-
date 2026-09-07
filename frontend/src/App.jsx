import { useCallback, useEffect, useRef, useState } from "react";

import ChatThread from "./components/ChatThread";
import Composer from "./components/Composer";
import DocumentLibrary from "./components/DocumentLibrary";
import EmptyState from "./components/EmptyState";
import ErrorBanner from "./components/ErrorBanner";
import Icon from "./components/Icon";
import StatusPill from "./components/StatusPill";
import UploadDropzone from "./components/UploadDropzone";
import { useChat } from "./hooks/useChat";
import { useDocuments } from "./hooks/useDocuments";
import { useSession } from "./hooks/useSession";
import { displayName, formatBytes, formatCount } from "./lib/format";
import "./styles/app.css";

export default function App() {
  const {
    userId,
    status,
    health,
    error: sessionError,
    dismissError: dismissSessionError,
    refresh,
  } = useSession();
  const {
    documents,
    loading,
    error: documentError,
    setError: setDocumentError,
    upload,
    refresh: refreshDocuments,
    add,
    remove,
  } = useDocuments(userId);

  const [activeId, setActiveId] = useState(null);
  const [localError, setLocalError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const fileInputRef = useRef(null);

  const activeDocument = documents.find((document) => document.id === activeId) ?? null;
  const { messages, busy, ask, stop, clear } = useChat(activeDocument?.id ?? null);

  // Keep a valid selection: pick the newest document, and recover if the
  // selected one is deleted.
  useEffect(() => {
    if (documents.length === 0) {
      setActiveId(null);
      return;
    }
    if (!documents.some((document) => document.id === activeId)) {
      const ready = documents.find((document) => document.status === "processed");
      setActiveId((ready ?? documents[0]).id);
    }
  }, [documents, activeId]);

  const handleFile = useCallback(
    async (file) => {
      setLocalError("");
      try {
        const created = await add(file);
        if (created?.id) setActiveId(created.id);
        setSidebarOpen(false);
      } catch (caught) {
        setLocalError(caught.message || "Upload failed.");
      }
    },
    [add],
  );

  const handleDelete = useCallback(
    async (document) => {
      const confirmed = window.confirm(
        `Delete "${document.filename}"? This removes its embeddings and conversation.`,
      );
      if (!confirmed) return;

      try {
        await remove(document.id);
      } catch {
        // The row is back (useDocuments re-syncs or restores it), so put the
        // selection back on it. If it turns out to be genuinely gone, the
        // effect above immediately picks a valid document instead.
        setActiveId(document.id);
      }
    },
    [remove],
  );

  const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);

  // Re-checking has to refetch the library too. The document list is only
  // fetched when the user id changes, so after a backend restart the pill would
  // otherwise go green next to a sidebar that stays permanently empty.
  const recheck = useCallback(() => {
    refresh();
    refreshDocuments();
  }, [refresh, refreshDocuments]);

  const error = localError || documentError || sessionError;
  const dismissError = () => {
    setLocalError("");
    setDocumentError("");
    // The session error has to be cleared too, or dismissing does nothing
    // whenever the backend is the thing that is down.
    dismissSessionError();
  };

  const isProcessed = activeDocument?.status === "processed";

  return (
    <div className="shell">
      <div className="backdrop" aria-hidden="true">
        <span className="glow glow-one" />
        <span className="glow glow-two" />
        <span className="glow glow-three" />
      </div>

      {/* One file input for the whole app. Two dropzones can be on screen at
          once, and giving them a shared input ref left it null as soon as
          either unmounted, which silently killed every browse button.

          It is visually hidden rather than display:none so `.click()` still
          opens the picker, and taken out of the tab order because it sits
          first in the DOM — otherwise the very first Tab press landed on an
          invisible 1px control. It keeps its label and is not aria-hidden:
          clicking a file input focuses it, and a screen reader landing inside
          an aria-hidden subtree would have nothing at all to announce. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="dropzone-input"
        disabled={upload.active}
        tabIndex={-1}
        aria-label="Choose a PDF"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset first so picking the same file twice still fires a change.
          event.target.value = "";
          if (file) handleFile(file);
        }}
      />

      <aside className={`sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="spark" size={16} />
          </span>
          <span className="brand-text">
            <strong>Nexus RAG</strong>
            <small>Private document intelligence</small>
          </span>
        </div>

        {documents.length > 0 && (
          <UploadDropzone
            upload={upload}
            onFile={handleFile}
            onBrowse={openFilePicker}
            variant="compact"
          />
        )}

        <DocumentLibrary
          documents={documents}
          loading={loading}
          activeId={activeId}
          onSelect={(document) => {
            setActiveId(document.id);
            setSidebarOpen(false);
          }}
          onDelete={handleDelete}
          onUploadClick={openFilePicker}
          uploadDisabled={upload.active}
        />

        <div className="sidebar-foot">
          <StatusPill sessionStatus={status} health={health} onRefresh={recheck} />
        </div>
      </aside>

      {sidebarOpen && (
        <button
          type="button"
          className="scrim"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close the document list"
        />
      )}

      <main className="workspace">
        <header className="workspace-head">
          <button
            type="button"
            className="icon-button sidebar-toggle"
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <Icon name="menu" />
            <span className="sr-only">Toggle the document list</span>
          </button>

          <div className="workspace-title">
            {activeDocument ? (
              <>
                <h1 title={activeDocument.filename}>{displayName(activeDocument.filename)}</h1>
                <p>
                  {[
                    activeDocument.page_count && formatCount(activeDocument.page_count, "page"),
                    formatCount(activeDocument.chunk_count ?? 0, "searchable passage"),
                    formatBytes(activeDocument.file_size),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </>
            ) : (
              <>
                <h1>Workspace</h1>
                <p>Upload a PDF to begin</p>
              </>
            )}
          </div>

          {messages.length > 0 && (
            <button type="button" className="ghost-button" onClick={clear}>
              Clear chat
            </button>
          )}
        </header>

        <ErrorBanner message={error} onDismiss={dismissError} />

        {activeDocument?.status === "failed" && (
          <div className="notice">
            This document could not be indexed.
            {activeDocument.error_message ? ` ${activeDocument.error_message}` : ""}
          </div>
        )}

        {activeDocument ? (
          <>
            <ChatThread
              messages={messages}
              documentName={displayName(activeDocument.filename)}
              onStarter={(prompt) => ask(prompt)}
              disabled={!isProcessed}
            />
            <Composer
              busy={busy}
              disabled={!isProcessed}
              onSend={ask}
              onStop={stop}
              placeholder={
                isProcessed
                  ? "Ask something about this document…"
                  : "This document is not ready yet."
              }
            />
          </>
        ) : (
          <EmptyState upload={upload} onFile={handleFile} onBrowse={openFilePicker} />
        )}
      </main>
    </div>
  );
}
