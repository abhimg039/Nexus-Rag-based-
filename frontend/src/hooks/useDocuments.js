import { useCallback, useEffect, useRef, useState } from "react";

import { deleteDocument, listDocuments, uploadDocument } from "../lib/api";
import { pruneThreads } from "../lib/storage";

const IDLE_UPLOAD = { active: false, percent: 0, phase: "", filename: "" };

/** Loads, uploads and deletes the user's documents. */
export function useDocuments(userId) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [upload, setUpload] = useState(IDLE_UPLOAD);

  // Monotonic request id. Uploads and deletes both trigger a refresh, so two
  // list requests can easily overlap; without this a slow earlier response
  // lands last and resurrects rows the newer response had already dropped.
  const requestRef = useRef(0);

  // The last rendered list, kept in sync during render so `remove` can fall
  // back to it without taking `documents` as a dependency.
  const documentsRef = useRef(documents);
  documentsRef.current = documents;

  /** Resolves to the server's list, or to null if the server could not be reached. */
  const refresh = useCallback(async () => {
    if (!userId) return [];

    const ticket = (requestRef.current += 1);
    setLoading(true);

    try {
      const result = await listDocuments(userId);
      if (ticket !== requestRef.current) return result;

      setDocuments(result);
      // Forget conversations belonging to documents that no longer exist.
      pruneThreads(result.map((document) => document.id));
      setError("");
      return result;
    } catch (caught) {
      if (ticket === requestRef.current) {
        setError(caught.message || "Could not load your documents.");
      }
      // null, not [], so callers can tell "the server says you have no
      // documents" apart from "the server did not answer".
      return null;
    } finally {
      // Only the newest request owns the loading flag, so an earlier one
      // finishing cannot clear the spinner out from under it.
      if (ticket === requestRef.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(
    async (file) => {
      if (!userId) throw new Error("Still connecting to the API — try again in a moment.");
      if (!file) return null;

      if (!file.name.toLowerCase().endsWith(".pdf")) {
        throw new Error("Only PDF files are supported.");
      }

      setError("");
      setUpload({ active: true, percent: 0, phase: "uploading", filename: file.name });

      try {
        const document = await uploadDocument({
          file,
          userId,
          onProgress: (percent) => {
            setUpload((previous) => ({
              ...previous,
              percent,
              // Once bytes are all sent, the server is extracting and embedding.
              phase: percent >= 100 ? "indexing" : "uploading",
            }));
          },
        });

        await refresh();
        return document;
      } finally {
        setUpload(IDLE_UPLOAD);
      }
    },
    [refresh, userId],
  );

  const remove = useCallback(
    async (documentId) => {
      // Optimistic: the row disappears immediately.
      const snapshot = documentsRef.current;
      setDocuments((current) => current.filter((document) => document.id !== documentId));

      try {
        await deleteDocument(documentId);
        await refresh();
      } catch (caught) {
        // Prefer the server's own list over a snapshot: one taken before an
        // interleaved delete would put another document back on screen even
        // though it is gone. But when the backend is down both the delete and
        // the re-sync fail, and without the snapshot the row we optimistically
        // removed would stay gone even though nothing was deleted.
        const synced = await refresh();
        if (!synced) setDocuments(snapshot);
        setError(caught.message || "Could not delete the document.");
        throw caught;
      }
    },
    [refresh],
  );

  return { documents, loading, error, setError, upload, refresh, add, remove };
}
