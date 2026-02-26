/**
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  DATA TABLES CONFIG — EXAMPLE                                    │
 * │                                                                  │
 * │  This file shows how to configure TABLE_CONFIGS entries          │
 * │  using the real "Demo - Voice - Functions" table as a reference. │
 * │                                                                  │
 * │  Copy the parts you need into dataTablesConfig.js → TABLE_CONFIGS│
 * │  This file is NOT imported anywhere — it's documentation only.   │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * ── How it works ─────────────────────────────────────────────────────
 *
 * 1.  Each entry in TABLE_CONFIGS matches ONE data table
 *     (by tableId or tableName).
 *
 * 2.  `validation: true` enables custom column rules.
 *     `validation: false` (or omitted) = free-text editing with only
 *     basic type checking from the Genesys schema.
 *
 * 3.  `columns` defines per-column rules (keyed by the API field ID,
 *     NOT the display title). To find the API field ID:
 *       • Open the table in Genesys Admin → look at the JSON schema
 *       • Or check the column headers in our app's developer console
 *       • API field IDs are typically camelCase versions of the title
 *
 * 4.  `supervisorEditableFields` (only matters when SUPERVISOR_MODE = true)
 *     lists which field IDs supervisors are allowed to edit.
 *     All other fields become read-only for supervisors.
 *
 * ── Column rule reference ────────────────────────────────────────────
 *
 *   type         Description                       Renders as
 *   ─────────    ──────────────────────────────     ──────────────
 *   "string"     Free text                          Text input
 *   "integer"    Whole number                       Number input (step=1)
 *   "number"     Decimal number                     Number input
 *   "boolean"    True / false                       Checkbox
 *   "enum"       Pick from a static list            <select> dropdown
 *   "queue"      Pick from Genesys queues           <select> dropdown (API)
 *   "skill"      Pick from Genesys skills           <select> dropdown (API)
 *   "language"   Pick from Genesys languages        <select> dropdown (API)
 *   "wrapupCode" Pick from Genesys wrap-up codes    <select> dropdown (API)
 *   "datatable"  Pick from another data table's keys <select> dropdown (API)
 *   "phone"      Phone number (basic validation)    Text input
 *   "email"      Email address                      Text input
 *   "url"        URL                                Text input
 *
 *   Additional rule properties:
 *     required   : boolean   — red asterisk, blocks save if empty
 *     min / max  : number    — for integer / number types
 *     minLength  : number    — minimum string length
 *     maxLength  : number    — maximum string length
 *     pattern    : string    — regex the value must match
 *     options    : string[]  — allowed values for "enum" type
 *     storeAs    : "name"|"id" — for queue/skill/language/wrapupCode:
 *                                what value gets written to the table
 *     datatableId  : string  — for "datatable" type: UUID of the source table
 *     datatableName: string  — for "datatable" type: name fallback (case-insensitive)
 */

// ─────────────────────────────────────────────────────────────────────
// EXAMPLE: "Demo - Voice - Functions" table
// ─────────────────────────────────────────────────────────────────────
//
// Screenshot columns (Genesys Admin):
//
//  Column title            API Field ID               Type      Values seen
//  ──────────────────────  ────────────────────────   ───────   ──────────────────
//  DID                     key                        string    +4576776550 (KEY)
//  Brand                   Brand                      string    "TDC Erhverv"
//  Queue - Name            Queue - Name               string    "Demo - Salg"
//  Skill - Name            Skill - Name               string    "—"
//  Welcome                 Welcome                    boolean   True / False
//  Offer Language          Offer Language              boolean   True / False
//  Adhoc - Before menu     Adhoc - Before menu        boolean   True / False
//  Adhoc - After menu      Adhoc - After menu         boolean   True / False
//  Recording               Recording                  boolean   True / False
//  Enter CPR               Enter CPR                  boolean   True / False
//  IVR Menu                IVR Menu                   boolean   True / False
//  IVR Menu - Name         IVR Menu - Name            string    "Menu_4_Choices", "Default"
//  Survey                  Survey                     boolean   True / False
//  Survey - Email          Survey - Email             boolean   True / False
//  Survey - SMS            Survey - SMS               boolean   True / False
//  Survey - Voice          Survey - Voice             boolean   True / False
//  Survey - Threshold      Survey - Threshold         integer   0
//  Number In Queue         Number In Queue            integer   0
//  Estimated Waiting Time  Estimated Waiting Time     boolean   True / False
//  Callback                Callback                   boolean   True / False
//  Queue Message 1         Queue Message 1            boolean   True / False
//  Queue Message 2         Queue Message 2            boolean   True / False
//  Danish                  Danish                     boolean   True / False
//  English                 English                    boolean   True / False
//  Close callback          Close callback             boolean   True / False
//  Speech Recognition      Speech Recognition         boolean   True / False
//
// ℹ️  In Genesys Data Tables, the API Field ID is usually identical
//     to the Field Label (including spaces, dashes, and casing).
//     You can verify this in Genesys Admin: click a column → look for
//     "API Field ID" at the bottom of the String/Boolean Field Options panel.

const EXAMPLE_CONFIG = {
  // ── Match by name (case-insensitive) ──
  tableName: "Demo - Voice - Functions",

  // ── Enable custom validation rules ──
  validation: true,

  // ── Supervisor mode: which fields can supervisors edit? ──
  // (Only matters when SUPERVISOR_MODE = true in dataTablesConfig.js)
  supervisorEditableFields: [
    "Welcome",
    "Offer Language",
    "Recording",
    "Survey",
    "Callback",
    "Danish",
    "English",
  ],

  // ── Per-column validation rules ──
  // NOTE: Keys must match the EXACT API Field ID (with spaces, dashes, etc.)
  // Use quoted keys for IDs that contain special characters.
  columns: {
    // ─── String fields ───────────────────────────────────

    // "Brand" — must be one of your known brands → enum dropdown
    "Brand": {
      type: "enum",
      required: true,
      options: ["TDC Erhverv", "Nuuday", "YouSee"],
    },

    // "Queue - Name" — pick from actual Genesys queues → API dropdown
    "Queue - Name": {
      type: "queue",
      required: true,
      storeAs: "name", // writes the queue NAME into the cell (not the UUID)
    },

    // "Skill - Name" — pick from actual Genesys skills → API dropdown
    "Skill - Name": {
      type: "skill",
      storeAs: "name",
      // required: false → skill can be empty ("—")
    },

    // "IVR Menu - Name" — lookup keys from another data table → datatable dropdown
    //   The dropdown is populated with all key values from the "IVR Menus" table.
    //   Use datatableId (UUID, preferred) or datatableName (case-insensitive fallback).
    "IVR Menu - Name": {
      type: "datatable",
      // datatableId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", // preferred
      datatableName: "IVR Menus", // fallback — matches by name
    },

    // ─── Integer fields ──────────────────────────────────

    // "Survey - Threshold" — 0 to 100
    "Survey - Threshold": {
      type: "integer",
      min: 0,
      max: 100,
    },

    // "Number In Queue" — 0 to 50
    "Number In Queue": {
      type: "integer",
      min: 0,
      max: 50,
    },

    // ─── Boolean fields ──────────────────────────────────
    // Booleans don't need rules — they render as checkboxes automatically.
    // But you CAN mark them required if the field must be explicitly set:

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
};

// ─────────────────────────────────────────────────────────────────────
// HOW TO USE: Copy into dataTablesConfig.js → TABLE_CONFIGS array
// ─────────────────────────────────────────────────────────────────────
//
// In dataTablesConfig.js, paste inside the TABLE_CONFIGS array:
//
//   export const TABLE_CONFIGS = [
//     {
//       tableName: "Demo - Voice - Functions",
//       validation: true,
//       supervisorEditableFields: ["Welcome", "Offer Language", ...],
//       columns: {
//         "Brand": { type: "enum", required: true, options: ["TDC Erhverv", ...] },
//         "Queue - Name": { type: "queue", required: true, storeAs: "name" },
//         "Survey - Threshold": { type: "integer", min: 0, max: 100 },
//         // ... etc
//       },
//     },
//   ];
//
// ─────────────────────────────────────────────────────────────────────
// MINIMAL EXAMPLE (no custom validation, just free-text editing):
// ─────────────────────────────────────────────────────────────────────
//
//   {
//     tableName: "Demo - Voice - Functions",
//     validation: false,
//   }
//
// This lets users edit all non-key fields as free text with only the
// built-in schema type checking (string stays string, boolean stays
// boolean, etc). No dropdowns, no custom min/max, no required markers.
//
// ─────────────────────────────────────────────────────────────────────
// SUPERVISOR MODE EXAMPLE (restrict which fields supervisors can edit):
// ─────────────────────────────────────────────────────────────────────
//
// In dataTablesConfig.js, set:
//   export const SUPERVISOR_MODE = true;
//
// Then in the table config:
//   {
//     tableName: "Demo - Voice - Functions",
//     validation: true,
//     supervisorEditableFields: ["Welcome", "Recording", "Callback"],
//     columns: { ... },
//   }
//
// Result: Supervisors can ONLY toggle Welcome, Recording, and Callback.
// All other columns show a 🔒 lock icon and are read-only.
// Administrators (SUPERVISOR_MODE = false) can still edit everything.
