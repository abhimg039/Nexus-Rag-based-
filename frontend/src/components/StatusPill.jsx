import Icon from "./Icon";

const STATE = {
  healthy: { label: "All systems ready", tone: "ok" },
  degraded: { label: "Partly available", tone: "warn" },
  offline: { label: "API offline", tone: "bad" },
  connecting: { label: "Connecting", tone: "idle" },
};

function describe(sessionStatus, health) {
  if (sessionStatus === "connecting") return STATE.connecting;
  if (sessionStatus === "offline") return STATE.offline;
  if (!health) return STATE.connecting;
  return STATE[health.status] ?? STATE.degraded;
}

/**
 * System status.
 *
 * The old header showed a hardcoded "LOCAL AI ONLINE" pill that was true even
 * when Postgres and Ollama were both down. This reflects the real health check.
 */
export default function StatusPill({ sessionStatus, health, onRefresh }) {
  const state = describe(sessionStatus, health);

  const details = [];
  if (health?.database) details.push(`Database: ${health.database.status}`);
  if (health?.llm) {
    details.push(`Model: ${health.llm.model} (${health.llm.status.replace("_", " ")})`);
  }

  return (
    <button
      type="button"
      className={`status-pill tone-${state.tone}`}
      onClick={onRefresh}
      title={details.length ? `${details.join("\n")}\n\nClick to re-check` : "Click to re-check"}
    >
      <span className="status-dot" aria-hidden="true" />
      <span className="status-label">{state.label}</span>
      <Icon name="refresh" size={13} className="status-refresh" />
    </button>
  );
}
