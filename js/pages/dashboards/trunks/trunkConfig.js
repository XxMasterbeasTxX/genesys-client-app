/**
 * Trunk Activity — feature-level configuration.
 *
 * All customer-tunable settings for the trunk activity dashboard
 * live here. Internal implementation details stay in activity.js.
 *
 * Alert threshold is now stored in the backend (AlertConfig table)
 * and managed from the in-app alert panel.
 */

// ── Polling & batching ────────────────────────────────────
// How often (ms) to poll the REST API when WebSocket is unavailable.
export const POLL_INTERVAL_MS = 15_000;

// Max trunk IDs per single metrics REST call (API limit safeguard).
export const METRICS_BATCH_SIZE = 100;

// ── Chart ─────────────────────────────────────────────────
// Maximum number of data-points kept in the rolling chart history.
export const CHART_HISTORY_MAX = 120;

// Colour palette for per-trunk chart lines (cycles if more trunks than colours).
export const CHART_COLOURS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#a855f7", // purple
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
  "#6366f1", // indigo
];
