/**
 * Data Tables — Feature Configuration
 *
 * Controls supervisor/admin mode and per-table validation rules.
 *
 * Two separate Genesys Cloud Premium App deployments are expected:
 *   1. Administrator version  → SUPERVISOR_MODE = false  → all fields editable
 *   2. Supervisor version     → SUPERVISOR_MODE = true   → only listed fields editable
 */

/**
 * When true, only fields listed in a table's `supervisorEditableFields`
 * array are editable. All other fields are read-only.
 *
 * When false (Administrator mode), all non-key fields are editable
 * (subject to the user's API permissions).
 */
export const SUPERVISOR_MODE = true;

/**
 * Per-table configuration.
 *
 * Tables NOT listed here: all non-key fields are editable as free text
 * with basic type validation from the Genesys schema.
 *
 * Match order: `tableId` takes precedence; if absent, `tableName` is
 * matched case-insensitively.
 *
 * Each entry can contain:
 * - tableId          {string}   Exact data table UUID (preferred)
 * - tableName        {string}   Human-readable name (case-insensitive fallback)
 * - validation       {boolean}  true = apply custom column rules; false = free text
 * - supervisorEditableFields {string[]}  API Field IDs editable in supervisor mode
 * - columns          {Object}   Per-column validation rules (keyed by API Field ID)
 *
 * Column rule shape:
 * {
 *   type: "string" | "integer" | "number" | "boolean" | "queue" | "skill"
 *         | "language" | "wrapupCode" | "enum" | "phone" | "email" | "url",
 *   required:  boolean,
 *   min:       number,      // integer / number
 *   max:       number,      // integer / number
 *   minLength: number,      // string
 *   maxLength: number,      // string
 *   pattern:   string,      // regex (string)
 *   options:   string[],    // enum
 *   storeAs:   "name"|"id", // queue/skill/language — what value to write
 * }
 */
export const TABLE_CONFIGS = [
  // ── Example entries (update with your real tables) ──────────
  // {
  //   tableName: "Queue Routing Config",
  //   validation: true,
  //   supervisorEditableFields: ["priority", "enabled"],
  //   columns: {
  //     targetQueue: { type: "queue", required: true, storeAs: "name" },
  //     priority:    { type: "integer", min: 1, max: 10, required: true },
  //     enabled:     { type: "boolean" },
  //   },
  // },
  // {
  //   tableName: "Phrases",
  //   validation: false,
  // },
];

/**
 * Look up the config entry for a given data table.
 * Returns the matching TABLE_CONFIGS entry, or null if none matches.
 */
export function getTableConfig(table) {
  if (!table) return null;
  return (
    TABLE_CONFIGS.find(
      (c) =>
        (c.tableId && c.tableId === table.id) ||
        (c.tableName &&
          c.tableName.toLowerCase() === (table.name ?? "").toLowerCase()),
    ) ?? null
  );
}

/**
 * Determine which fields are editable for a given table.
 *
 * @param {object}  table       The data table object (with schema)
 * @param {boolean} hasEditPerm Whether the user has edit permission (from API)
 * @returns {{ editableFields: Set<string>, readOnlyReason: string|null }}
 *
 * - The `key` field is NEVER editable on existing rows.
 * - If the user lacks edit permission, all fields are read-only.
 * - In supervisor mode, only `supervisorEditableFields` are editable.
 * - In admin mode, all non-key fields are editable.
 */
export function getEditableFields(table, hasEditPerm) {
  const allFieldIds = Object.keys(table.schema?.properties ?? {}).filter(
    (id) => id !== "key",
  );

  // No API edit permission → everything read-only
  if (!hasEditPerm) {
    return {
      editableFields: new Set(),
      readOnlyReason: "You do not have edit permission for this table.",
    };
  }

  // Admin mode → all non-key fields editable
  if (!SUPERVISOR_MODE) {
    return { editableFields: new Set(allFieldIds), readOnlyReason: null };
  }

  // Supervisor mode → check per-table config
  const cfg = getTableConfig(table);
  if (!cfg || !cfg.supervisorEditableFields?.length) {
    return {
      editableFields: new Set(),
      readOnlyReason:
        "Supervisor mode: no editable fields configured for this table.",
    };
  }

  // Only fields that actually exist in the schema
  const allowed = new Set(
    cfg.supervisorEditableFields.filter((f) => allFieldIds.includes(f)),
  );

  return {
    editableFields: allowed,
    readOnlyReason: allowed.size
      ? null
      : "Supervisor mode: no editable fields configured for this table.",
  };
}
