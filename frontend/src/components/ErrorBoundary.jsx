import { Component } from "react";

import { STORAGE_KEY } from "../lib/storage";

/**
 * Last line of defence. Without this, a single render-time throw anywhere in
 * the tree unmounts everything and leaves a blank page with the reason only
 * visible in the console.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the component stack in the console — it is far more useful than the
    // message alone when tracking down which component threw.
    console.error("Nexus RAG crashed while rendering:", error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash">
        <div className="crash-card">
          <h1>Something broke on this screen</h1>
          <p>
            The interface hit an unexpected error and stopped rendering. Your documents and
            their embeddings are stored in Postgres and are unaffected.
          </p>
          <pre className="crash-detail">{error.message || String(error)}</pre>
          <div className="crash-actions">
            <button type="button" className="primary-button" onClick={() => location.reload()}>
              Reload the app
            </button>
            {/* Escape hatch for the one failure mode a reload cannot fix: a
                stored conversation that makes the thread throw on render. */}
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                try {
                  localStorage.removeItem(STORAGE_KEY);
                } catch {
                  /* storage unavailable — reloading is still worth a try */
                }
                location.reload();
              }}
            >
              Clear saved chats and reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
