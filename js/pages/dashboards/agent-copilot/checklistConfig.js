/**
 * Agent Copilot › Checklists — feature-level configuration.
 *
 * All customer-tunable settings for the checklists view live here.
 */

// ── Date range presets ────────────────────────────────────
/** Default range shown when the page loads. */
export const DEFAULT_RANGE_DAYS = 7;

/** Preset buttons in the period toolbar. */
export const RANGE_PRESETS = [
  { label: "Today", days: 0 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
];

/** Maximum interval the Genesys analytics API allows (days). */
export const MAX_INTERVAL_DAYS = 31;

// ── Analytics query ───────────────────────────────────────
/** Max conversations per page returned by the detail query. */
export const QUERY_PAGE_SIZE = 100;

// ── Checklist enrichment ──────────────────────────────────
/** Number of conversations to enrich in parallel per batch. */
export const ENRICHMENT_BATCH = 10;

/** Number of queue-name lookups to run in parallel. */
export const QUEUE_RESOLVE_BATCH = 10;

// ── Time constants ────────────────────────────────────────
/** Milliseconds in one day. */
export const MS_PER_DAY = 86_400_000;

// ── Genesys API constants ─────────────────────────────────
/**
 * Media-specific keys under which communications are nested
 * inside a conversation participant (the API does NOT use a
 * generic "communications" key).
 */
export const MEDIA_KEYS = [
  "messages", "calls", "chats",
  "callbacks", "emails", "socialExpressions", "videos",
];

/** Participant purpose value for agent participants. */
export const PURPOSE_AGENT = "agent";

/** Metric name for handle time on a session. */
export const METRIC_HANDLE_TIME = "tHandle";

/** Checklist tick state values returned by the API. */
export const TICK_STATE = Object.freeze({
  TICKED: "Ticked",
  UNTICKED: "Unticked",
});

/** Client-side status filter values. */
export const STATUS_FILTER = Object.freeze({
  ALL: "all",
  COMPLETE: "complete",
  INCOMPLETE: "incomplete",
});

// ── Date / time formats (Intl.DateTimeFormat options) ─────
export const TABLE_DATE_FORMAT = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

export const TOOLTIP_DATE_FORMAT = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};
