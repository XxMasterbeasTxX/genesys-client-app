/**
 * Trunk Alert — feature-level configuration.
 *
 * Defines the available alert channels and default values.
 * Channel keys are used as identifiers in the saved config and
 * must match what the backend expects when wiring up Data Actions later.
 *
 * No Data Action IDs or per-channel fields here — those are added
 * in a later phase once the Data Actions are defined.
 */

// ── Available notification channels ───────────────────────
export const ALERT_CHANNELS = [
  { key: "email", label: "Email" },
  { key: "sms", label: "SMS" },
];

// ── Defaults (used when no config is saved yet) ───────────
export const DEFAULT_THRESHOLD = 0; // 0 = disabled
export const DEFAULT_COOLDOWN_MINUTES = 15;
