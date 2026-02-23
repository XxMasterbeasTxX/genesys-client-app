/**
 * Trunk History — feature-level configuration.
 *
 * All customer-tunable settings for the trunk history page live here.
 */

// ── Date range presets ────────────────────────────────────
// Default range (in days) shown when the page loads.
export const DEFAULT_RANGE_DAYS = 7;

// ── Chart ─────────────────────────────────────────────────
// Max data-points before the chart auto-downsamples (keeps every Nth point).
export const CHART_MAX_POINTS = 500;

// Colour for the main "Total Calls" line.
export const CHART_LINE_COLOUR = "#3b82f6";

// Colour for the peak marker.
export const CHART_PEAK_COLOUR = "#ef4444";
