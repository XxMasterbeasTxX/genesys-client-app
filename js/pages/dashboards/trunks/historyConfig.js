/**
 * Trunk History — feature-level configuration.
 *
 * All customer-tunable settings for the trunk history page live here.
 */

// ── Date range presets ────────────────────────────────────
// Default range (in days) shown when the page loads.
export const DEFAULT_RANGE_DAYS = 7;

// ── Chart ─────────────────────────────────────────────────
// Colour for the "Peak Calls" line.
export const CHART_LINE_COLOUR = "#3b82f6";

// Colour for the "Avg Calls" line (faded / dashed).
export const CHART_AVG_COLOUR = "#3b82f6";

// Colour for the peak marker dot.
export const CHART_PEAK_COLOUR = "#ef4444";

// ── Date label formats (Intl.DateTimeFormat options) ──────
// Controls the x-axis labels at each aggregation level.
export const LABEL_FORMAT_RAW  = { hour: "2-digit", minute: "2-digit" };
export const LABEL_FORMAT_HOUR = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
export const LABEL_FORMAT_DAY  = { month: "short", day: "numeric" };

// Tooltip date format (shown on hover).
export const TOOLTIP_DATE_FORMAT = { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
