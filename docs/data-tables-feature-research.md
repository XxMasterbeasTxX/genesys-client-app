# Data Tables Feature — Research & Findings

Investigation into building a validated Data Table editor inside the Genesys Client App.

---

## Table of Contents

1. [Genesys Cloud Data Tables API](#1-genesys-cloud-data-tables-api)
2. [Permissions & Divisions (Access Control)](#2-permissions--divisions-access-control)
3. [Detecting User Permissions at Runtime](#3-detecting-user-permissions-at-runtime)
4. [Supervisor vs Administrator Mode](#4-supervisor-vs-administrator-mode)
5. [Validation Engine Design](#5-validation-engine-design)
6. [Required OAuth Scopes](#6-required-oauth-scopes)
7. [Integration with Existing App](#7-integration-with-existing-app)
8. [Limitations & Constraints](#8-limitations--constraints)
9. [Proposed Config File Structure](#9-proposed-config-file-structure)
10. [Supporting APIs for Validation](#10-supporting-apis-for-validation)
11. [Implementation Plan](#11-implementation-plan)

---

## 1. Genesys Cloud Data Tables API

Data tables are managed under the Architect domain. All endpoints live under `/api/v2/flows/datatables`.

### 1.1 Key Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/v2/flows/datatables` | **List all data tables** the user has access to. Returns id, name, division. Respects division-based access control — tables in divisions the user cannot view are automatically excluded. Paginated (default page size 25). |
| `GET` | `/api/v2/flows/datatables/{datatableId}` | **Get a single data table** (id, name, division). Add `?expand=schema` to include the full JSON Schema definition (column names, types, required fields). The `expand=schema` is essential — without it, only the table metadata is returned. |
| `GET` | `/api/v2/flows/datatables/{datatableId}/rows` | **List rows** in a data table. Paginated (max 500 per page). Our implementation **auto-paginates** through all pages to always retrieve the full row set, regardless of table size. Query params: `pageNumber`, `pageSize` (max 500), `showbrief=false` (required for full row data), `sortBy` (optional, e.g. `key:asc`). |
| `GET` | `/api/v2/flows/datatables/{datatableId}/rows/{rowId}` | **Get a single row** by its key value (the `key` field value is the rowId). Useful for **direct key lookup** — can jump straight to a specific row without fetching all rows first. |
| `POST` | `/api/v2/flows/datatables/{datatableId}/rows` | **Create a new row.** Body is validated against the table's JSON Schema. |
| `PUT` | `/api/v2/flows/datatables/{datatableId}/rows/{rowId}` | **Update an existing row.** The `key` field must appear in both the URL path (rowId) and the request body. Body is validated against the table's JSON Schema. |
| `DELETE` | `/api/v2/flows/datatables/{datatableId}/rows/{rowId}` | **Delete a row.** |
| `POST` | `/api/v2/flows/datatables` | **Create a new data table.** (Not needed for this feature — we only read/edit existing tables.) |

### 1.2 Table Schema Structure

When fetched with `?expand=schema`, the response includes a JSON Schema (draft-04) under the `schema` property:

```json
{
  "id": "abc123",
  "name": "Queue Routing Config",
  "division": { "id": "div-1", "name": "Division A" },
  "schema": {
    "$schema": "http://json-schema.org/draft-04/schema#",
    "type": "object",
    "required": ["key"],
    "properties": {
      "key": {
        "title": "Reference Key",
        "type": "string",
        "$id": "/properties/key"
      },
      "targetQueue": {
        "title": "Target Queue",
        "type": "string",
        "$id": "/properties/targetQueue"
      },
      "priority": {
        "title": "Priority",
        "type": "integer",
        "$id": "/properties/priority"
      },
      "enabled": {
        "title": "Enabled",
        "type": "boolean",
        "$id": "/properties/enabled"
      }
    },
    "additionalProperties": false
  }
}
```

**Column types recognised by Genesys:**

| JSON Schema `type` | Genesys UI Type | Notes |
| --- | --- | --- |
| `string` | Text | Free text, max 256 chars for the key field |
| `integer` | Integer | Whole numbers only |
| `number` | Decimal | Floating-point |
| `boolean` | Boolean | `true` / `false` |

The schema's `title` property is the human-readable column label. The property key (e.g. `targetQueue`) is the **API Field ID** — this never changes even if the label is updated. We must use the API Field ID when reading or writing rows.

### 1.3 Row Data Format

Rows are simple flat JSON objects keyed by API Field IDs:

```json
{
  "key": "sales-inbound",
  "targetQueue": "Sales Queue",
  "priority": 5,
  "enabled": true
}
```

### 1.4 Important Limits

| Limit | Value |
| --- | --- |
| Max data tables per org | 200 (can request increase) |
| Max rows per table | 5,000 (can request increase) |
| Max fields per table | 50 |
| Max key field length | 256 characters |

---

## 2. Permissions & Divisions (Access Control)

### 2.1 Relevant Permissions

Data tables fall under the **Architect** permission domain. The specific permissions are:

| Permission | Allows |
| --- | --- |
| `architect:datatable:view` | List data tables, view schema, read rows |
| `architect:datatable:edit` | Update existing rows |
| `architect:datatable:add` | Create new data tables and add rows |
| `architect:datatable:delete` | Delete data tables and rows |

These permissions are **division-scoped** — a user can have `architect:datatable:view` in Division A but not Division B.

### 2.2 Division-Based Filtering (Automatic)

Genesys Cloud's Fine-Grained Access Control (FGAC) automatically filters API responses based on the calling user's grants:

- `GET /api/v2/flows/datatables` **only returns tables in divisions the user has `architect:datatable:view` for**. No extra filtering needed on our side.
- If a user has view permission in Division A but not Division B, tables in Division B simply don't appear in the listing.
- Similarly, attempts to read/write a table in a division the user lacks access to will return `403`.

**This means:** Our app can simply call the list endpoint and display whatever comes back — Genesys handles the division filtering server-side.

### 2.3 View vs Edit Detection

The API does not return a "you can edit this table" flag directly on the list response. To determine edit capability we have two strategies:

**Strategy A — Check user permissions (recommended):**

1. Call `GET /api/v2/users/me?expand=authorization` — returns the user's full permission set including division-scoped grants (e.g. `architect:datatable:edit:div-id-1,div-id-2`).
2. Parse the permission strings to determine which divisions the user can view vs edit.
3. Cross-reference with each table's `division.id` to determine the access level per table.

**Strategy B — Attempt write + handle 403:**

1. When the user tries to save, if the API returns `403`, display "You don't have permission to edit this table."
2. Simpler to implement but worse UX (the user doesn't know they can't edit until they try).

**Recommendation:** Use Strategy A for initial access-level detection (disable edit buttons for view-only tables), with Strategy B as a safety net for edge cases.

### 2.4 Permission String Format

Permission strings from `/api/v2/users/me?expand=authorization` follow this pattern:

```text
architect:datatable:view:div-id-1,div-id-2
architect:datatable:edit:div-id-1
architect:datatable:add:div-id-1
```

- A wildcard `*` at the division level means "all divisions" (and all future divisions).
- Multiple actions at the same level are comma-separated: `architect:datatable:edit,view:div-id-1`.

---

## 3. Detecting User Permissions at Runtime

### 3.1 Permission Check Endpoint

`GET /api/v2/users/me?expand=authorization`

This returns the `authorization` object with the user's full list of permission strings. Example:

```json
{
  "id": "user-123",
  "name": "Jane Doe",
  "authorization": {
    "permissions": [
      "architect:datatable:view:*",
      "architect:datatable:edit:div-1,div-2",
      "architect:datatable:add:div-1",
      "routing:queue:view:*"
    ],
    "roles": [...]
  }
}
```

### 3.2 Permission Parsing Logic

To determine per-table access:

```text
For each data table:
  1. Get the table's division.id
  2. Check if user has architect:datatable:view for that division (or *)
     → If no: table should not appear (API already filters this)
  3. Check if user has architect:datatable:edit for that division (or *)
     → If no: show table as read-only
     → If yes: allow editing
  4. Check if user has architect:datatable:add for that division (or *)
     → If yes: allow adding new rows
  5. Check if user has architect:datatable:delete for that division (or *)
     → If yes: allow deleting rows
```

### 3.3 No Permission at All

If `GET /api/v2/flows/datatables` returns an empty list (or 403), display:

> "You do not have permission to view any data tables. Contact your administrator to request `architect:datatable:view` permission."

---

## 4. Supervisor vs Administrator Mode

### 4.1 Approach: Config-Driven Role Parameter

As requested, the simplest approach is a boolean in the app's config:

```javascript
// In a new config file, e.g. js/pages/data-tables/dataTablesConfig.js
export const DATA_TABLES_CONFIG = {
  /** true = Supervisor mode (restricted fields), false = Administrator mode (all fields). */
  supervisorMode: false,
};
```

Two separate Genesys Cloud Premium App integrations would be deployed:

1. **Admin version** → `supervisorMode: false` → can edit all fields
2. **Supervisor version** → `supervisorMode: true` → can only edit fields explicitly listed as supervisor-editable in the per-table config

### 4.2 How It Affects the UI

| Mode | Behaviour |
| --- | --- |
| **Administrator** (`supervisorMode: false`) | All columns in the table are editable (subject to API permissions). The key field is always read-only (Genesys does not allow changing key values). |
| **Supervisor** (`supervisorMode: true`) | Only columns listed in the table's `supervisorEditableFields` config array are editable. All other columns are displayed as read-only text. |

This keeps the implementation simple — one codebase, two deployments with a single config difference.

---

## 5. Validation Engine Design

### 5.1 Per-Table Validation Config

Tables are listed in a config file with optional validation rules per column. If a table is **not** in the config, it uses the Genesys schema types for basic validation only (string/integer/number/boolean).

```javascript
{
  tableId: "abc-123-...",           // Or match by table name
  tableName: "Queue Routing Config", // Human-readable (for matching if preferred)
  validation: true,                  // true = apply custom rules, false = free-text mode
  supervisorEditableFields: ["priority", "enabled"],  // Only used when supervisorMode = true
  columns: {
    targetQueue: {
      type: "queue",                 // Special type → fetches queues from API for dropdown
      required: true,
      label: "Target Queue",         // Override display label (optional)
    },
    priority: {
      type: "integer",
      min: 1,
      max: 10,
      required: true,
    },
    enabled: {
      type: "boolean",
      required: false,
      defaultValue: true,
    },
  },
}
```

### 5.2 Supported Validation Types

| Config `type` | Input Control | Validation |
| --- | --- | --- |
| `"string"` | Text input | Optional `minLength`, `maxLength`, `pattern` (regex) |
| `"integer"` | Number input | `min`, `max`, step = 1 |
| `"number"` | Number input | `min`, `max`, `step` |
| `"boolean"` | Toggle / checkbox | — |
| `"queue"` | Dropdown (fetched from `/api/v2/routing/queues`) | Value must be a valid queue name or ID |
| `"user"` | Dropdown / searchable select (fetched from `/api/v2/users`) | Value must be a valid user |
| `"skill"` | Dropdown (fetched from `/api/v2/routing/skills`) | Value must be a valid skill name |
| `"language"` | Dropdown (fetched from `/api/v2/routing/languages`) | Value must be a valid language |
| `"wrapupCode"` | Dropdown (fetched from `/api/v2/routing/wrapupcodes`) | Value must be a valid wrap-up code |
| `"enum"` | Dropdown (static list) | `options: ["optionA", "optionB", ...]` |
| `"phone"` | Tel input | Regex validation for E.164 or local format |
| `"email"` | Email input | Standard email validation |
| `"url"` | URL input | Standard URL validation |
| `"datetime"` | Datetime-local input | Optional `min`, `max` |

### 5.3 Tables Without Validation Config

If `validation: false` (or table not in config at all):

- All fields are free-text editable (respecting the Genesys schema type for basic type coercion)
- Integer fields still only accept integers, booleans still show toggles
- No dropdown lookups, no range checks, no regex

This handles the "free text / phrases" use case.

---

## 6. Required OAuth Scopes

The PKCE OAuth client needs the following **additional** scope:

| Scope | Purpose |
| --- | --- |
| `architect` | Read/write access to data tables (covers `architect:datatable:view`, `edit`, `add`, `delete`) |

If read-only access is sufficient for some deployments, `architect:readonly` would suffice for viewing only.

**For validation dropdowns**, the existing scopes already cover most needs:

- `routing:readonly` → queues, skills, languages, wrap-up codes (already in use for Agent Checklists)
- `users:readonly` → user lookups (not currently requested — would need adding if `"user"` type validation is used)

The current OAuth client already has the `routing` scope (for queue member lookups in Agent Checklists). The `architect` scope would need to be added.

**Permission requirements on the user's Genesys role:**

- `architect:datatable:view` — minimum for read access
- `architect:datatable:edit` — to modify rows
- `architect:datatable:add` — to add rows
- `architect:datatable:delete` — to delete rows

---

## 7. Integration with Existing App

### 7.1 Navigation

Add a new top-level menu item in `navConfig.js`:

```javascript
{
  label: "Data Tables",
  path: "data-tables",
  enabled: true,
  children: [
    { label: "Update", path: "update", enabled: true },
  ],
},
```

### 7.2 Page Registry

Add a route in `pageRegistry.js`:

```javascript
"/data-tables/update": (ctx) =>
  import("./pages/data-tables/update.js").then((m) => m.render(ctx)),
```

### 7.3 API Client Additions

New methods needed in `apiClient.js`:

```javascript
// ── Data Tables ──────────────────────────────────────────
/** List all data tables the user can view. */
getDataTables: async (opts = {}) => {
  const all = [];
  let page = 1;
  let total = Infinity;
  while (all.length < total) {
    const qs = new URLSearchParams({
      pageNumber: page,
      pageSize: 25,
      expand: "schema",
      ...(opts.divisionId ? { divisionId: opts.divisionId } : {}),
    });
    const res = await request(`/api/v2/flows/datatables?${qs}`);
    total = res.total ?? res.entities?.length ?? 0;
    if (res.entities) all.push(...res.entities);
    if (!res.entities?.length) break;
    page++;
  }
  return all;
},

/** Get a single data table with schema. */
getDataTable: (datatableId) =>
  request(`/api/v2/flows/datatables/${datatableId}?expand=schema`),

/**
 * List ALL rows of a data table.
 * Auto-paginates through every page (500 rows/page) so the caller
 * always receives the complete row set, even for tables with 5 000 rows.
 */
getDataTableRows: async (datatableId) => {
  const all = [];
  let page = 1;
  let total = Infinity;
  while (all.length < total) {
    const qs = new URLSearchParams({
      pageNumber: page,
      pageSize: 500,        // API maximum per page
      showbrief: false,     // Required to get full row data
    });
    const res = await request(
      `/api/v2/flows/datatables/${datatableId}/rows?${qs}`,
    );
    total = res.total ?? res.entities?.length ?? 0;
    if (res.entities) all.push(...res.entities);
    if (!res.entities?.length) break;
    page++;
  }
  return all;
},

/**
 * Look up a single row by its key value (exact match).
 * Calls the /rows/{rowId} endpoint directly — no need to
 * fetch the full row set first.
 * Returns the row object, or null if not found (404).
 */
lookupDataTableRow: async (datatableId, keyValue) => {
  try {
    return await request(
      `/api/v2/flows/datatables/${datatableId}/rows/${encodeURIComponent(keyValue)}?showbrief=false`,
    );
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
},

/** Update a single row. */
updateDataTableRow: (datatableId, rowId, body) =>
  request(`/api/v2/flows/datatables/${datatableId}/rows/${rowId}`, {
    method: "PUT",
    body,
  }),

/** Create a new row. */
createDataTableRow: (datatableId, body) =>
  request(`/api/v2/flows/datatables/${datatableId}/rows`, {
    method: "POST",
    body,
  }),

/** Delete a row. */
deleteDataTableRow: (datatableId, rowId) =>
  request(`/api/v2/flows/datatables/${datatableId}/rows/${rowId}`, {
    method: "DELETE",
  }),

/** Get current user's permissions (for edit detection). */
getUsersMeWithAuth: () => request("/api/v2/users/me?expand=authorization"),

// ── Validation lookup APIs ─────────────────────────────────
/** Fetch all queues (for validation dropdowns). */
getAllQueues: async () => {
  const all = [];
  let page = 1;
  let total = Infinity;
  while (all.length < total) {
    const qs = new URLSearchParams({ pageNumber: page, pageSize: 100 });
    const res = await request(`/api/v2/routing/queues?${qs}`);
    total = res.total ?? 0;
    if (res.entities) all.push(...res.entities);
    if (!res.entities?.length) break;
    page++;
  }
  return all;
},

/** Fetch all skills. */
getAllSkills: async () => { /* same pagination pattern */ },

/** Fetch all languages. */
getAllLanguages: async () => { /* same pagination pattern */ },

/** Fetch all wrap-up codes. */
getAllWrapupCodes: async () => { /* same pagination pattern */ },
```

### 7.4 File Structure

```text
js/pages/data-tables/
├── update.js                # Main page: list tables → select → view/edit rows
├── dataTablesConfig.js      # Feature config (supervisorMode, per-table validation rules)
└── validationEngine.js      # Shared validation logic (type checks, API lookups cache)
```

---

## 8. Limitations & Constraints

### 8.1 API Limitations

| Limitation | Impact |
| --- | --- |
| **Key field is immutable** | Cannot rename/change a row's primary key via PUT — must delete and re-create. The UI should make the key column read-only (or at least warn). |
| **Schema columns cannot be deleted** | Once a column is added in Genesys, it cannot be removed from the schema. Irrelevant columns must be ignored. |
| **API Field ID is immutable** | Column API names never change, even if the label changes. We should use the API Field ID, not the title. |
| **500 rows per page max** | Our `getDataTableRows` auto-paginates through all pages, so the full row set is always loaded regardless of size. |
| **5,000 row limit** | All rows are fetched up-front; client-side key search and column filtering handle large tables efficiently. |
| **No built-in column metadata** | The Genesys schema only stores type (string/integer/number/boolean) — no min/max/enum/reference. All custom validation must be defined in our config. |
| **No "which permissions do I have for this object" API** | Must parse permission strings from `/api/v2/users/me?expand=authorization`. |

### 8.2 Data Table Columns Have No Reference to Other Objects

Genesys data table columns are all plain primitives. A column of type `string` that is *intended* to hold a queue name has no metadata linking it to the queues API. This is exactly why we need the config file — to declare that "column X should be validated against the queues list."

### 8.3 Rate Limits

The standard Genesys Cloud rate limit is **300 requests per minute per OAuth token** (for most endpoints). If the app pre-fetches many validation lookup lists (queues, skills, languages, etc.), these should be:

- Fetched once and cached for the session (or with a TTL)
- Fetched lazily (only when a table with that validation type is opened)

### 8.4 Real-time Concurrency

Data tables have no locking mechanism. If two users edit the same row simultaneously, the last PUT wins. Consider showing a "last modified" timestamp if available in the row metadata.

---

## 9. Proposed Config File Structure

```javascript
// js/pages/data-tables/dataTablesConfig.js

/**
 * true  = Supervisor mode — only supervisorEditableFields are editable.
 * false = Administrator mode — all fields are editable.
 *
 * Deploy two separate Premium Apps in Genesys Cloud,
 * each pointing to a different build/config of this app.
 */
export const SUPERVISOR_MODE = false;

/**
 * Per-table validation configuration.
 *
 * Tables NOT listed here: all fields are free-text editable (basic type
 * validation from the Genesys schema only).
 *
 * Tables listed with `validation: false`: same as not listed (free-text).
 *
 * Tables listed with `validation: true`: custom validation rules apply
 * per column as defined in the `columns` object.
 */
export const TABLE_CONFIGS = [
  {
    /** Match by data table name (case-insensitive). */
    tableName: "Queue Routing Config",
    /** Alternative: match by table ID (takes precedence over name). */
    // tableId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    /** Enable custom validation for this table. */
    validation: true,
    /**
     * Columns editable by supervisors (only applies when SUPERVISOR_MODE = true).
     * Uses API Field IDs. If omitted or empty, supervisors cannot edit anything
     * in this table.
     */
    supervisorEditableFields: ["priority", "enabled"],
    /**
     * Per-column validation rules. Key = API Field ID.
     * Columns not listed here fall back to basic Genesys schema type validation.
     */
    columns: {
      targetQueue: {
        type: "queue",
        required: true,
        // Optional: store queue ID or queue name
        storeAs: "name",  // "name" | "id" — what value is written to the cell
      },
      priority: {
        type: "integer",
        min: 1,
        max: 10,
        required: true,
      },
      enabled: {
        type: "boolean",
      },
    },
  },
  {
    tableName: "Phrases",
    validation: false,  // Free-text, no custom validation
  },
  {
    tableName: "Skill Mapping",
    validation: true,
    supervisorEditableFields: [],  // Supervisors cannot edit this table
    columns: {
      skillName: {
        type: "skill",
        required: true,
      },
      level: {
        type: "integer",
        min: 0,
        max: 5,
      },
    },
  },
];

/** Labels / strings used in the Data Tables UI. */
export const LABELS = Object.freeze({
  pageTitle: "Data Tables",
  noAccess: "You do not have permission to view any data tables. Contact your administrator.",
  readOnly: "Read-only — you do not have edit permission for this table.",
  supervisorReadOnly: "This field is not editable in Supervisor mode.",
  saveSuccess: "Row saved successfully.",
  saveError: "Failed to save row.",
  validationError: "Please fix the highlighted fields before saving.",
  confirmDelete: "Are you sure you want to delete this row?",
  addRow: "+ Add Row",
  save: "💾 Save",
  cancel: "Cancel",
  delete: "🗑 Delete",
  search: "Search rows…",
});
```

---

## 10. Supporting APIs for Validation

These APIs are called lazily (only when a table with the matching validation type is opened) and cached for the session:

| Validation Type | API Endpoint | Returns |
| --- | --- | --- |
| `"queue"` | `GET /api/v2/routing/queues` (paginated) | `{ id, name }` |
| `"user"` | `GET /api/v2/users` (paginated) or `POST /api/v2/users/search` | `{ id, name, email }` |
| `"skill"` | `GET /api/v2/routing/skills` (paginated) | `{ id, name }` |
| `"language"` | `GET /api/v2/routing/languages` (paginated) | `{ id, name }` |
| `"wrapupCode"` | `GET /api/v2/routing/wrapupcodes` (paginated) | `{ id, name }` |
| `"enum"` | Static — defined in config `options` array | No API call needed |
| `"phone"` | None — client-side regex | — |
| `"email"` | None — client-side regex | — |

**Caching strategy:**

- First load → fetch all entities, store in a `Map` keyed by type
- Subsequent tables with the same type reuse the cache
- Optional: add a "Refresh" button to bust the cache if the user knows data has changed

---

## 11. Implementation Plan

> **Testing gate:** After each step, manually verify the new functionality in the browser before proceeding to the next step. Each step is a natural commit point.
>
> **Architecture guidelines — apply throughout all steps:**
>
> - **No hardcoded values.** API base URLs, OAuth scopes, page sizes, labels, and per-table rules all live in config files (`config.js`, `dataTablesConfig.js`). Magic numbers and inline strings are not acceptable.
> - **Single Responsibility.** Each module does one thing: API calls in `apiClient.js`, validation logic in `validationEngine.js`, page rendering in `update.js`, config in `dataTablesConfig.js`.
> - **Reuse existing patterns.** Follow the same coding conventions as the rest of the app (ES module imports, `render(ctx)` page signature, CSS custom properties for theming, auto-pagination helpers).
> - **Config-driven behaviour.** Supervisor/Admin mode, per-table validation rules, editable field lists, dropdown types — all declared in config, never scattered through rendering code.
> - **Separation of concerns.** UI rendering must not contain API logic; API methods must not contain UI logic; validation must be callable independently of the UI.
> - **Graceful error handling.** Every API call must handle failures (network errors, 403, 404) with clear user-facing messages from the `LABELS` config.

---

### Step 1 — Scaffolding & Navigation

| Item | Detail |
| --- | --- |
| Add `architect` scope | In `config.js`, append `"architect"` to the OAuth scopes array. |
| Navigation entry | In `navConfig.js`, add a top-level **"Data Tables"** node with a child **"Update"**. |
| Route registration | In `pageRegistry.js`, map `"/data-tables/update"` → lazy import of `js/pages/data-tables/update.js`. |
| Placeholder page | Create `js/pages/data-tables/update.js` with a minimal `render(ctx)` that displays a heading. |

**Test:** App loads → "Data Tables → Update" appears in the sidebar → clicking it renders the placeholder page without errors.

---

### Step 2 — API Client Methods

| Method | Purpose |
| --- | --- |
| `getDataTables()` | List all accessible data tables (auto-paginated, with `expand=schema`). |
| `getDataTable(id)` | Get a single table with schema. |
| `getDataTableRows(id)` | Fetch **all** rows (auto-paginated, 500/page, `showbrief=false`). |
| `lookupDataTableRow(id, key)` | Get a single row by exact key value (handle 404 → `null`). |
| `updateDataTableRow(id, rowId, body)` | PUT an updated row. |
| `createDataTableRow(id, body)` | POST a new row. |
| `deleteDataTableRow(id, rowId)` | DELETE a row. |
| `getUsersMeWithAuth()` | GET `/users/me?expand=authorization` for permission detection. |

All pagination page sizes and API paths must reference constants or config, not inline literals.

**Test:** Open browser console → call each new method → verify correct responses from the Genesys API.

---

### Step 3 — Table Listing & Permission Detection

| Item | Detail |
| --- | --- |
| Fetch tables | On page load, call `getDataTables()` and render a selectable list showing table name, division, and row count. |
| Permission parsing | Call `getUsersMeWithAuth()`, extract `architect:datatable:*` permission strings, determine per-division view/edit/add/delete capabilities. |
| Access badges | Each table in the list shows an **Editable** or **View-only** badge based on the user's permissions for that table's division. |
| Empty state | If no tables are returned, display the `LABELS.noAccess` message. |

**Test:** Log in with different roles/divisions → verify tables appear with correct badges → verify empty-state message when no access.

---

### Step 4 — Row Viewing & Key Search

| Item | Detail |
| --- | --- |
| Load all rows | On table selection, auto-paginate to fetch the **complete** row set. Show a loading spinner during fetch. |
| Render table | Build columns dynamically from the schema (`title` for headers, API Field ID for data). Key column displayed first. |
| Sortable columns | Click a column header to sort ascending/descending. |
| Key search input | Text input above the table — filters displayed rows by `key` column (case-insensitive substring match), debounced at ~250 ms. |
| Exact key lookup | A "Go to key" action (e.g. Enter in search or a button) that calls `lookupDataTableRow()` to fetch a single row by exact key, without needing the full row set. |

**Test:** Select a table → all rows load (verify count matches Genesys admin UI) → type in search → rows filter instantly → exact key lookup returns the correct row.

---

### Step 5 — Config File & Supervisor/Admin Mode

| Item | Detail |
| --- | --- |
| Create config file | `js/pages/data-tables/dataTablesConfig.js` with `SUPERVISOR_MODE`, `TABLE_CONFIGS`, and `LABELS` (as documented in §9). |
| Wire config | On table selection, find the matching `TABLE_CONFIGS` entry (by ID or name). Determine which fields are editable based on `SUPERVISOR_MODE` + `supervisorEditableFields`. |
| Key always read-only | The `key` column is never editable on existing rows (immutable in Genesys). |
| Read-only banner | If the table is view-only (permissions), display `LABELS.readOnly`. If a field is locked by supervisor mode, show `LABELS.supervisorReadOnly` on hover/focus. |

**Test:** Toggle `SUPERVISOR_MODE` between `true`/`false` → verify the correct fields become editable/locked → verify key column is always read-only.

---

### Step 6 — Inline Row Editing

| Item | Detail |
| --- | --- |
| Cell editors | Click an editable cell → it becomes an input control matching the schema type: text input (string), number input (integer/number), toggle (boolean). |
| Dirty tracking | Track modified rows. Highlight changed cells visually. |
| Save | "Save" button per row (or per table). Calls `updateDataTableRow()`. On success → show `LABELS.saveSuccess`, clear dirty state. On failure → show `LABELS.saveError` with API error detail. |
| View-only enforcement | If the user only has view permission, all cells remain non-editable. Save button is hidden. |
| Basic type validation | Before PUT, coerce values to the correct type (e.g. parse integer). Reject non-numeric input for integer/number fields. |

**Test:** Edit a cell → visual dirty indicator appears → save → verify the change persists in Genesys admin UI → test with a view-only user → editing is blocked.

---

### Step 7 — Validation Engine & Dropdowns

| Item | Detail |
| --- | --- |
| Validation engine | Create `js/pages/data-tables/validationEngine.js`. Reads per-column rules from `TABLE_CONFIGS`. Validates before save. Returns a list of field-level errors. |
| API-backed dropdowns | For columns with `type: "queue"`, `"skill"`, `"language"`, `"wrapupCode"` — fetch entities lazily from the API, cache in a `Map`, render as searchable `<select>` / dropdown. |
| Static enum dropdowns | For `type: "enum"` — render a `<select>` from the `options` array in config. |
| Range & pattern validation | `min` / `max` for integers/numbers; `pattern` (regex) for strings. |
| Required fields | Block save if a `required: true` field is empty. |
| Inline error display | Show validation errors next to the offending field. Display `LABELS.validationError` as a summary. |

**Test:** Open a table with validation config → dropdown fields show correct options from the API → enter out-of-range values → validation errors appear → fix errors → save succeeds.

---

### Step 8 — Add Row, Delete Row & Polish

| Item | Detail |
| --- | --- |
| Add row | "Add Row" button → inserts an empty row at the top with the `key` field editable. On save → `createDataTableRow()`. |
| Delete row | Delete button per row → confirmation dialog (`LABELS.confirmDelete`) → `deleteDataTableRow()`. |
| Full-text search | Extend key search to match across **all** column values (not just key). |
| Unsaved changes warning | If dirty rows exist, warn before navigating away (hash change / sidebar click). |
| Theme consistency | Verify all new components render correctly in both light and dark mode (use CSS custom properties, no hardcoded colours). |

**Test:** Add a new row → verify it appears in Genesys admin UI → delete a row → verify removal → edit a row, then navigate away → unsaved changes prompt appears → test in both light and dark mode.

---

### Estimated Complexity

| Component | Effort |
| --- | --- |
| API client additions | Small — follows existing pagination patterns |
| Permission parsing | Medium — string parsing + division cross-reference |
| Table list + row viewing | Medium — new page, similar to Agent Checklists |
| Inline row editing | Medium–Large — per-cell editors, type adaptation |
| Validation engine | Medium — config-driven, extensible |
| API-backed dropdowns | Medium — async fetch, cache, searchable select |
| Supervisor mode | Small — boolean flag filters editable columns |

---

## Summary of Key Findings

1. **The API supports everything needed.** List, read, create, update, delete — all available via REST, all division-scoped automatically.
2. **Schema is available.** `?expand=schema` returns column names, types, and the required key field. This is the foundation for auto-generating the edit UI.
3. **No built-in column semantics.** Genesys does not know that a string column "should" hold a queue name. Our config file bridges this gap.
4. **Division filtering is automatic.** The API only returns tables the user can see. No extra logic needed.
5. **View vs edit detection requires parsing permission strings.** `GET /api/v2/users/me?expand=authorization` provides what we need but requires string parsing.
6. **Supervisor/Admin split via config flag is the simplest approach.** Two deployed apps, one boolean difference.
7. **Validation dropdowns need lazy-loaded, cached API data.** Queues, skills, etc. are fetched on demand.
8. **No additional Azure Functions backend is needed.** Everything runs client-side using the existing PKCE token.
9. **One new OAuth scope is needed**: `architect` (or `architect:readonly` for view-only deployments).
