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
export const SUPERVISOR_MODE = false;

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
 *         | "language" | "wrapupCode" | "enum" | "datatable"
 *         | "phone" | "email" | "url",
 *   required:  boolean,
 *   min:       number,         // integer / number
 *   max:       number,         // integer / number
 *   minLength: number,         // string
 *   maxLength: number,         // string
 *   pattern:   string,         // regex (string)
 *   options:   string[],       // enum
 *   storeAs:   "name"|"id",    // queue/skill/language — what value to write
 *   datatableId:   string,     // datatable — UUID of source table (preferred)
 *   datatableName: string,     // datatable — table name fallback
 * }
 */
export const TABLE_CONFIGS = [
  {
    tableName: "Demo - Voice - Functions",
    validation: true,
    supervisorEditableFields: [
      "Welcome",
      "Offer Language",
      "Recording",
      "Survey",
      "Callback",
      "Danish",
      "English",
    ],
    columns: {
      // ─── String fields ───────────────────────────────────
      "Brand": {
        type: "enum",
        required: true,
        options: ["TDC Erhverv", "Nuuday", "YouSee"],
      },
      "Queue - Name": {
        type: "queue",
        required: true,
        storeAs: "name",
      },
      "Skill - Name": {
        type: "skill",
        storeAs: "name",
      },
      "IVR Menu - Name": {
        type: "datatable",
        datatableName: "IVR Menus",
      },

      // ─── Integer fields ──────────────────────────────────
      "Survey - Threshold": {
        type: "integer",
        min: 0,
        max: 100,
      },
      "Number In Queue": {
        type: "integer",
        min: 0,
        max: 50,
      },

      // ─── Boolean fields ──────────────────────────────────
      "Welcome":                { type: "boolean" },
      "Offer Language":         { type: "boolean" },
      "Adhoc - Before menu":    { type: "boolean" },
      "Adhoc - After menu":     { type: "boolean" },
      "Recording":              { type: "boolean" },
      "Enter CPR":              { type: "boolean" },
      "IVR Menu":               { type: "boolean" },
      "Survey":                 { type: "boolean" },
      "Survey - Email":         { type: "boolean" },
      "Survey - SMS":           { type: "boolean" },
      "Survey - Voice":         { type: "boolean" },
      "Estimated Waiting Time": { type: "boolean" },
      "Callback":               { type: "boolean" },
      "Queue Message 1":        { type: "boolean" },
      "Queue Message 2":        { type: "boolean" },
      "Danish":                 { type: "boolean" },
      "English":                { type: "boolean" },
      "Close callback":         { type: "boolean" },
      "Speech Recognition":     { type: "boolean" },
    },
  },
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

/**
 * Get the custom column rule for a field, if any.
 * Returns the rule object from TABLE_CONFIGS.columns, or null.
 */
export function getColumnRule(table, fieldId) {
  const cfg = getTableConfig(table);
  if (!cfg?.validation || !cfg.columns) return null;
  return cfg.columns[fieldId] ?? null;
}

/** Column types that render as API-backed dropdowns. */
export const API_DROPDOWN_TYPES = new Set([
  "queue",
  "skill",
  "language",
  "wrapupCode",
]);

/** Column type that renders as a dropdown populated from another data table's keys. */
export const DATATABLE_TYPE = "datatable";

/** Column types that render as static enum dropdowns. */
export const ENUM_TYPE = "enum";

/**
 * Validate a single cell value against schema type + optional custom rule.
 *
 * @param {*}       value     The coerced cell value
 * @param {object}  col       Column def { id, title, type }
 * @param {object|null} rule  Custom rule from config (or null)
 * @param {Set|null} validOptions  For enum/API dropdowns: the set of valid option values
 * @returns {string|null}     Error message, or null if valid
 */
export function validateCell(value, col, rule, validOptions = null) {
  const effectiveType = rule?.type ?? col.type;
  const isRequired = rule?.required === true;
  const isEmpty = value === null || value === undefined || value === "";

  // Required check
  if (isRequired && isEmpty) {
    return `${col.title} is required.`;
  }

  // If empty and not required, skip further checks
  if (isEmpty) return null;

  // Type-specific validation
  switch (effectiveType) {
    case "string":
    case "phone":
    case "email":
    case "url": {
      const s = String(value);
      if (rule?.minLength != null && s.length < rule.minLength) {
        return `Minimum ${rule.minLength} characters.`;
      }
      if (rule?.maxLength != null && s.length > rule.maxLength) {
        return `Maximum ${rule.maxLength} characters.`;
      }
      if (rule?.pattern) {
        try {
          if (!new RegExp(rule.pattern).test(s)) {
            return `Value does not match required pattern.`;
          }
        } catch { /* invalid regex in config — skip */ }
      }
      if (effectiveType === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
        return "Invalid email address.";
      }
      if (effectiveType === "phone" && !/^\+?[\d\s\-().]{5,20}$/.test(s)) {
        return "Invalid phone number.";
      }
      if (effectiveType === "url") {
        try { new URL(s); } catch { return "Invalid URL."; }
      }
      break;
    }
    case "integer": {
      const n = Number(value);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        return "Must be a whole number.";
      }
      if (rule?.min != null && n < rule.min) return `Minimum value is ${rule.min}.`;
      if (rule?.max != null && n > rule.max) return `Maximum value is ${rule.max}.`;
      break;
    }
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) return "Must be a number.";
      if (rule?.min != null && n < rule.min) return `Minimum value is ${rule.min}.`;
      if (rule?.max != null && n > rule.max) return `Maximum value is ${rule.max}.`;
      break;
    }
    case "boolean":
      // Booleans are always valid once coerced
      break;
    case "enum":
      if (validOptions && !validOptions.has(String(value))) {
        return "Value is not in the allowed list.";
      }
      break;
    case "queue":
    case "skill":
    case "language":
    case "wrapupCode":
      if (validOptions && !validOptions.has(String(value))) {
        return `Invalid ${effectiveType} — not found.`;
      }
      break;
    case "datatable":
      if (validOptions && !validOptions.has(String(value))) {
        return "Value not found in the linked data table.";
      }
      break;
  }

  return null;
}
