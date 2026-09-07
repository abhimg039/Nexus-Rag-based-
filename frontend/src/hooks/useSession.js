import { useCallback, useEffect, useRef, useState } from "react";

import { getHealth, getSession } from "../lib/api";

const HEALTH_INTERVAL_MS = 30000;

/**
 * Resolves which user this local session acts as, and polls system health.
 *
 * The user id used to be hardcoded to 2 in the component, which broke on any
 * machine where that row did not exist. It now comes from the backend.
 */
export function useSession() {
  const [userId, setUserId] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");
  const mounted = useRef(true);

  // Monotonic ticket for health polls. /health/full pings Postgres and checks
  // the Ollama model, so a cold model can take longer than the poll interval;
  // without this a slow failing poll can land after a fast successful one and
  // flip the pill to "offline" while the API is perfectly healthy.
  const healthTicket = useRef(0);

  // Only the first failure in a run raises the banner. Re-raising it every
  // 30 seconds would make it impossible to dismiss while the API stays down.
  const reportedOffline = useRef(false);

  // The flag must be raised on setup, not just lowered on cleanup. In
  // StrictMode React runs setup, cleanup, then setup again on mount, so a
  // write-once-false ref would stay false for the rest of the session and
  // every guarded state update below would silently bail — leaving the app
  // stuck on "Connecting" in dev and nowhere else.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const connect = useCallback(async () => {
    setStatus("connecting");
    try {
      const session = await getSession();
      if (!mounted.current) return;
      setUserId(session.user_id);
      setStatus("ready");
      setError("");
    } catch (caught) {
      if (!mounted.current) return;
      setStatus("offline");
      setError(
        caught.message ||
          "Could not reach the API. Start the backend with: uvicorn app.main:app --reload",
      );
    }
  }, []);

  useEffect(() => {
    connect();
  }, [connect]);

  const refreshHealth = useCallback(async () => {
    const ticket = (healthTicket.current += 1);

    try {
      const result = await getHealth();
      if (!mounted.current || ticket !== healthTicket.current) return null;
      setHealth(result);
      // A reachable health endpoint means the API came back, so clear an
      // earlier offline verdict instead of staying stuck on it.
      setStatus("ready");
      setError("");
      reportedOffline.current = false;
      return result;
    } catch (caught) {
      if (!mounted.current || ticket !== healthTicket.current) return null;
      // If health cannot be reached at all the API is down, so say so rather
      // than falling back to a vague "connecting".
      setHealth(null);
      setStatus("offline");
      if (!reportedOffline.current) {
        reportedOffline.current = true;
        setError(
          caught.message ||
            "Lost contact with the API. Is the backend still running? uvicorn app.main:app --reload",
        );
      }
      return null;
    }
  }, []);

  // Polling is keyed on the session id, not on `status`. Keying it on status
  // meant a single failed poll flipped status to "offline", which tore down the
  // very interval that would have noticed the API coming back — one slow
  // response and the pill read "API offline" until the page was reloaded.
  useEffect(() => {
    if (!userId) return undefined;

    refreshHealth();
    const id = setInterval(refreshHealth, HEALTH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [userId, refreshHealth]);

  /**
   * What the status pill triggers. When the session never came up, re-check
   * means retrying the session itself — refreshing health alone would leave the
   * app permanently inert with no way back other than a page reload.
   */
  const refresh = useCallback(
    () => (userId ? refreshHealth() : connect()),
    [userId, refreshHealth, connect],
  );

  const dismissError = useCallback(() => setError(""), []);

  return { userId, status, health, error, dismissError, refresh };
}
