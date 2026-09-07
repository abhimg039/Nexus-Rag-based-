/** Small formatting helpers. */

export function formatBytes(bytes) {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCount(value, singular, plural = `${singular}s`) {
  const count = Number(value ?? 0);
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

export function formatDuration(milliseconds) {
  const ms = Number(milliseconds ?? 0);
  if (ms <= 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatRelativeTime(value) {
  if (!value) return "";

  // Backend timestamps are naive UTC; mark them as UTC so the browser converts
  // to local time instead of assuming the local zone.
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";

  const seconds = Math.round((Date.now() - then.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function truncate(text, limit = 240) {
  const value = String(text ?? "");
  if (value.length <= limit) return value;
  return `${value.slice(0, limit).trimEnd()}…`;
}

/** Strip the file extension for display, keeping the full name for tooltips. */
export function displayName(filename) {
  return String(filename ?? "Untitled").replace(/\.pdf$/i, "");
}
