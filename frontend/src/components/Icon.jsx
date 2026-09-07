/**
 * Inline SVG icons.
 *
 * The previous UI used decorative unicode glyphs (↗ ⌁ ◈ ✦) as interface icons.
 * Those render inconsistently across platforms and are announced by screen
 * readers as meaningless characters. These are consistent and hidden from
 * assistive technology.
 */

const paths = {
  upload: "M12 16V4m0 0L7 9m5-5 5 5M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2",
  file: "M14 3v5h5M6 3h9l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z",
  send: "M4 12h15m0 0-6-6m6 6-6 6",
  trash: "M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12",
  spark: "M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35",
  copy: "M9 9V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-4M5 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z",
  check: "M5 13l4 4L19 7",
  alert: "M12 9v4m0 3h.01M10.3 4.3 2.6 17.6A1.5 1.5 0 0 0 3.9 20h16.2a1.5 1.5 0 0 0 1.3-2.4L13.7 4.3a1.5 1.5 0 0 0-2.6 0Z",
  stop: "M7 7h10v10H7z",
  chevron: "M9 6l6 6-6 6",
  plus: "M12 5v14M5 12h14",
  layers: "M12 3 3 8l9 5 9-5-9-5ZM3 14l9 5 9-5",
  refresh: "M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6 6 18",
};

export default function Icon({ name, size = 18, className = "" }) {
  const path = paths[name];
  if (!path) return null;

  return (
    <svg
      className={`icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}
