/**
 * Data Tables › Update
 *
 * Lists all accessible data tables with division info and edit/view-only badges.
 * Selecting a table loads all its rows into a sortable, searchable table.
 * Respects supervisor / admin mode from the config file.
 */

import {
  SUPERVISOR_MODE,
  getTableConfig,
  getEditableFields,
  getColumnRule,
  validateCell,
  API_DROPDOWN_TYPES,
  DATATABLE_TYPE,
  ENUM_TYPE,
} from "./dataTablesConfig.js";

/* ── Constants ─────────────────────────────────────────── */

const LABELS = {
  pageTitle: "Data Tables — Update",
  pageDescription: "Select a data table to view and edit its rows.",
  loading: "Loading data tables…",
  loadingRows: "Loading rows…",
  noAccess:
    "You do not have permission to view any data tables. Contact your administrator to request the architect:datatable:view permission.",
  noRows: "This table has no rows.",
  noMatch: "No rows match the search.",
  errorPrefix: "Failed to load data tables: ",
  errorRows: "Failed to load rows: ",
  badgeEdit: "Editable",
  badgeView: "View-only",
  division: "Division",
  fields: "fields",
  searchPlaceholder: "Search rows…",
  rowCount: (shown, total) =>
    shown === total ? `${total} rows` : `${shown} of ${total} rows`,
  modeSupervisor: "Supervisor Mode",
  modeAdmin: "Administrator Mode",
  readOnlyBanner: (reason) => reason,
  lockTooltip: "This field is read-only in Supervisor Mode.",
  editableTooltip: "This field is editable.",
  keyTooltip: "The key column is always read-only.",
  actions: "Actions",
  save: "Save",
  discard: "Discard",
  saving: "Saving…",
  saveSuccess: "Saved",
  saveError: (msg) => `Save failed: ${msg}`,
  unsavedChanges: "You have unsaved changes.",
  required: "*",
  validationBlocksSave: "Fix validation errors before saving.",
  dropdownPlaceholder: "— select —",
  loadingOptions: "Loading options…",
};

/** Debounce delay for search input (ms). */
const SEARCH_DEBOUNCE_MS = 250;

/* ── Permission helpers ────────────────────────────────── */

/**
 * Parse the user's authorization grants and determine which divisions
 * the user can view / edit data tables in.
 *
 * Returns { canView: Set<string>, canEdit: Set<string> }
 * where each set contains division IDs (or "*" for all).
 */
function parseDataTablePermissions(authorization) {
  const canView = new Set();
  const canEdit = new Set();

  for (const perm of authorization?.permissions ?? []) {
    if (!perm.startsWith("architect:datatable:")) continue;

    const parts = perm.split(":");
    const actions = (parts[2] ?? "").split(",");
    const divisionsPart = parts[3] ?? "";
    const divisionIds =
      divisionsPart === "*"
        ? ["*"]
        : divisionsPart.split(",").filter(Boolean);

    for (const action of actions) {
      for (const divId of divisionIds) {
        if (
          action === "view" ||
          action === "edit" ||
          action === "add" ||
          action === "delete"
        ) {
          canView.add(divId);
        }
        if (action === "edit" || action === "add") {
          canEdit.add(divId);
        }
      }
    }
  }

  return { canView, canEdit };
}

function hasDivisionAccess(permSet, divisionId) {
  return permSet.has("*") || permSet.has(divisionId);
}

/* ── Schema helpers ────────────────────────────────────── */

/**
 * Extract ordered column definitions from a data table schema.
 * Returns [{ id, title, type }] with "key" always first.
 */
function columnsFromSchema(schema) {
  const props = schema?.properties ?? {};
  const cols = [];
  // Key first
  if (props.key) {
    cols.push({ id: "key", title: props.key.title || "Key", type: "string" });
  }
  for (const [id, def] of Object.entries(props)) {
    if (id === "key") continue;
    cols.push({ id, title: def.title || id, type: def.type || "string" });
  }
  return cols;
}

/**
 * Format a cell value for display.
 */
function formatCell(value, type) {
  if (value === null || value === undefined) return "—";
  if (type === "boolean") return value ? "✔" : "✘";
  return String(value);
}

/**
 * Coerce an input string back to the correct JS type for the API.
 */
function coerceValue(raw, type) {
  if (raw === "" || raw === null || raw === undefined) return null;
  switch (type) {
    case "boolean":
      return raw === true || raw === "true";
    case "integer":
      return Number.isFinite(Number(raw)) ? Math.round(Number(raw)) : raw;
    case "number":
      return Number.isFinite(Number(raw)) ? Number(raw) : raw;
    default:
      return String(raw);
  }
}

/**
 * Deep-compare two values (primitive-level, sufficient for data table cells).
 */
function valuesEqual(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  return false;
}

/* ── Dropdown options cache ────────────────────────────── */

/**
 * Cache of API-backed dropdown options.
 * Key: "queue"|"skill"|"language"|"wrapupCode"|"datatable:<id>"  →  [{ id, name }]
 * Prevents redundant API calls across table switches.
 */
const dropdownCache = new Map();

/**
 * Fetch (or return cached) dropdown options for an API type.
 * Returns [{ id, name }]. Caches per-type across the session.
 *
 * For "datatable" type, pass the source data table's ID as `datatableId`.
 */
async function fetchDropdownOptions(api, type, datatableId) {
  const cacheKey = type === "datatable" ? `datatable:${datatableId}` : type;
  if (dropdownCache.has(cacheKey)) return dropdownCache.get(cacheKey);

  let items = [];
  try {
    switch (type) {
      case "queue":          items = await api.getAllQueues(); break;
      case "skill":          items = await api.getAllSkills(); break;
      case "language":       items = await api.getAllLanguages(); break;
      case "wrapupCode":     items = await api.getAllWrapupCodes(); break;
      case "schedule":       items = await api.getAllSchedules(); break;
      case "scheduleGroup": items = await api.getAllScheduleGroups(); break;
      case "datatable": {
        if (!datatableId) break;
        const rows = await api.getDataTableRows(datatableId);
        // Normalise rows to { id, name } using the key field
        items = rows.map((r) => ({ id: r.key, name: r.key }));
        break;
      }
    }
  } catch { /* swallow — will show empty options */ }

  // Normalise to { id, name }
  const opts = items.map((i) => ({ id: i.id, name: i.name }));
  opts.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  dropdownCache.set(cacheKey, opts);
  return opts;
}

/**
 * Check whether a column is required.
 * Checks: Genesys schema `required` array  +  config rule `required`.
 */
function isColumnRequired(schema, colId, rule) {
  if (rule?.required) return true;
  const req = schema?.required ?? [];
  return req.includes(colId);
}

/* ── Render ────────────────────────────────────────────── */

export async function render({ api }) {
  const root = document.createElement("div");
  root.className = "dt-update";

  /* ── Header ─────────────────────────────────────────── */
  const card = document.createElement("section");
  card.className = "card";

  const h1 = document.createElement("h1");
  h1.className = "h1";
  h1.textContent = LABELS.pageTitle;

  const desc = document.createElement("p");
  desc.className = "p";
  desc.textContent = LABELS.pageDescription;

  /* Mode badge */
  const modeBadge = document.createElement("span");
  modeBadge.className = SUPERVISOR_MODE
    ? "dt-mode-badge dt-mode-badge--supervisor"
    : "dt-mode-badge dt-mode-badge--admin";
  modeBadge.textContent = SUPERVISOR_MODE
    ? LABELS.modeSupervisor
    : LABELS.modeAdmin;

  card.append(h1, modeBadge, desc);
  root.append(card);

  /* ── Loading state ──────────────────────────────────── */
  const listCard = document.createElement("section");
  listCard.className = "card dt-list-card";

  const spinner = document.createElement("div");
  spinner.className = "dt-spinner";
  spinner.textContent = LABELS.loading;
  listCard.append(spinner);
  root.append(listCard);

  /* ── Row detail area (populated on table select) ────── */
  const rowCard = document.createElement("section");
  rowCard.className = "card dt-row-card";
  rowCard.style.display = "none";
  root.append(rowCard);

  /* ── Fetch tables + permissions in parallel ─────────── */
  try {
    const [tables, meAuth] = await Promise.all([
      api.getDataTables(),
      api.getUsersMeWithAuth(),
    ]);

    const { canView, canEdit } = parseDataTablePermissions(
      meAuth.authorization,
    );

    spinner.remove();

    if (!tables.length) {
      const empty = document.createElement("p");
      empty.className = "p dt-empty";
      empty.textContent = LABELS.noAccess;
      listCard.append(empty);
      return root;
    }

    // Sort tables alphabetically by name
    tables.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

    // Build a lookup map for quick access
    const tableMap = new Map(tables.map((t) => [t.id, t]));

    /* ── Table selector (searchable dropdown) ──────── */
    const selectorWrap = document.createElement("div");
    selectorWrap.className = "dt-table-selector";

    const selectorInput = document.createElement("input");
    selectorInput.type = "text";
    selectorInput.className = "dt-table-selector__input";
    selectorInput.placeholder = "Search data tables…";

    const selectorDropdown = document.createElement("ul");
    selectorDropdown.className = "dt-table-selector__list";

    // Build list items
    const selectorItems = [];
    for (const table of tables) {
      const divisionName = table.division?.name ?? "—";
      const divisionId = table.division?.id ?? "";
      const isEditable = hasDivisionAccess(canEdit, divisionId);
      const schemaProps = table.schema?.properties ?? {};
      const fieldCount = Object.keys(schemaProps).length;

      const li = document.createElement("li");
      li.className = "dt-table-selector__item";
      li.dataset.tableId = table.id;

      const nameSpan = document.createElement("span");
      nameSpan.className = "dt-table-selector__name";
      nameSpan.textContent = table.name;

      const metaSpan = document.createElement("span");
      metaSpan.className = "dt-table-selector__meta";
      metaSpan.textContent = `${divisionName} · ${fieldCount} ${LABELS.fields}`;

      const badge = document.createElement("span");
      badge.className = isEditable
        ? "dt-badge dt-badge--edit"
        : "dt-badge dt-badge--view";
      badge.textContent = isEditable ? LABELS.badgeEdit : LABELS.badgeView;

      li.append(nameSpan, metaSpan, badge);

      li.addEventListener("click", () => {
        selectorInput.value = table.name;
        selectorDropdown.classList.remove("dt-table-selector__list--open");
        loadTableRows(table.id);
      });

      selectorDropdown.append(li);
      selectorItems.push({ li, name: table.name.toLowerCase() });
    }

    // Filter items as user types
    selectorInput.addEventListener("input", () => {
      const q = selectorInput.value.trim().toLowerCase();
      for (const { li, name } of selectorItems) {
        li.style.display = name.includes(q) ? "" : "none";
      }
    });

    // Show dropdown on focus / click
    selectorInput.addEventListener("focus", () => {
      selectorDropdown.classList.add("dt-table-selector__list--open");
    });

    // Hide dropdown when clicking outside
    document.addEventListener("click", (e) => {
      if (!selectorWrap.contains(e.target)) {
        selectorDropdown.classList.remove("dt-table-selector__list--open");
      }
    });

    selectorWrap.append(selectorInput, selectorDropdown);
    listCard.append(selectorWrap);

    /* ── Load rows for a selected table ─────────────── */

    /** Currently loaded state */
    let currentTableId = null;
    let allRows = [];
    let columns = [];
    let sortCol = "key";
    let sortAsc = true;
    /** Editability state for the current table */
    let editableFields = new Set();
    let readOnlyReason = null;
    let currentTableConfig = null;

    /**
     * Dirty row tracking.
     * Map<rowKey, { original: object, edits: object }>
     * `original` = snapshot at load time; `edits` = field→newValue overrides.
     */
    const dirtyRows = new Map();

    /** Track rows currently being saved (Set of key strings). */
    const savingRows = new Set();

    function isDirty(rowKey) {
      return dirtyRows.has(rowKey);
    }

    function getDirtyEdits(rowKey) {
      return dirtyRows.get(rowKey)?.edits ?? {};
    }

    function markDirty(rowKey, colId, newValue, originalRow) {
      if (!dirtyRows.has(rowKey)) {
        // Snapshot the original row values
        dirtyRows.set(rowKey, { original: { ...originalRow }, edits: {} });
      }
      const entry = dirtyRows.get(rowKey);
      const orig = entry.original[colId];
      // If value reverted to original, remove from edits
      if (valuesEqual(newValue, orig)) {
        delete entry.edits[colId];
        // If no remaining edits, remove dirty entry entirely
        if (!Object.keys(entry.edits).length) {
          dirtyRows.delete(rowKey);
        }
      } else {
        entry.edits[colId] = newValue;
      }
    }

    function discardDirty(rowKey) {
      dirtyRows.delete(rowKey);
    }

    function clearAllDirty() {
      dirtyRows.clear();
      savingRows.clear();
      validationErrors.clear();
    }

    /**
     * Per-cell validation errors.
     * Map<rowKey, Map<colId, string>>
     */
    const validationErrors = new Map();

    /**
     * Loaded dropdown options for the current table.
     * Map<colId, { options: [{id,name}], validSet: Set<string> }>
     */
    const dropdownOptions = new Map();

    function getCellError(rowKey, colId) {
      return validationErrors.get(rowKey)?.get(colId) ?? null;
    }

    function rowHasErrors(rowKey) {
      const errs = validationErrors.get(rowKey);
      return errs ? errs.size > 0 : false;
    }

    /**
     * Run validation on all dirty cells of a row.
     * Updates validationErrors map in place.
     */
    function validateRow(rowKey, row, schema) {
      const edits = getDirtyEdits(rowKey);
      if (!Object.keys(edits).length) {
        validationErrors.delete(rowKey);
        return;
      }
      const errMap = new Map();
      for (const [colId, value] of Object.entries(edits)) {
        const col = columns.find((c) => c.id === colId);
        if (!col) continue;
        const rule = getColumnRule(tableMap.get(currentTableId), colId);
        const optsEntry = dropdownOptions.get(colId);
        const validSet = optsEntry?.validSet ?? null;
        const err = validateCell(value, col, rule, validSet);
        if (err) errMap.set(colId, err);
      }
      if (errMap.size) {
        validationErrors.set(rowKey, errMap);
      } else {
        validationErrors.delete(rowKey);
      }
    }

    async function loadTableRows(tableId) {
      currentTableId = tableId;
      const table = tableMap.get(tableId);
      if (!table) return;

      columns = columnsFromSchema(table.schema);
      allRows = [];
      sortCol = "key";
      sortAsc = true;
      clearAllDirty();

      // Editability
      const divisionId = table.division?.id ?? "";
      const hasEditPerm = hasDivisionAccess(canEdit, divisionId);
      const editability = getEditableFields(table, hasEditPerm);
      editableFields = editability.editableFields;
      readOnlyReason = editability.readOnlyReason;
      currentTableConfig = getTableConfig(table);

      // Show loading
      rowCard.style.display = "";
      rowCard.innerHTML = "";

      const header = document.createElement("div");
      header.className = "dt-row-header";

      const tTitle = document.createElement("h2");
      tTitle.className = "dt-row-title";
      tTitle.textContent = table.name;

      header.append(tTitle);

      /* Read-only banner */
      if (readOnlyReason) {
        const banner = document.createElement("div");
        banner.className = "dt-readonly-banner";
        banner.textContent = LABELS.readOnlyBanner(readOnlyReason);
        header.append(banner);
      }

      rowCard.append(header);

      const loadingEl = document.createElement("div");
      loadingEl.className = "dt-spinner";
      loadingEl.textContent = LABELS.loadingRows;
      rowCard.append(loadingEl);

      try {
        allRows = await api.getDataTableRows(tableId);

        // Abort if user switched tables while loading
        if (currentTableId !== tableId) return;

        loadingEl.remove();

        if (!allRows.length) {
          const noRows = document.createElement("p");
          noRows.className = "p";
          noRows.textContent = LABELS.noRows;
          rowCard.append(noRows);
          return;
        }

        // Prefetch dropdown options for columns that need them
        await prefetchDropdownOptions(table);

        // Abort if user switched tables while prefetching
        if (currentTableId !== tableId) return;

        renderRowsUI();
      } catch (err) {
        if (currentTableId !== tableId) return;
        loadingEl.remove();
        const errEl = document.createElement("p");
        errEl.className = "p dt-error";
        errEl.textContent =
          LABELS.errorRows + (err.message || String(err));
        rowCard.append(errEl);
      }
    }

    /* ── Prefetch dropdown options ─────────────────────── */

    async function prefetchDropdownOptions(table) {
      dropdownOptions.clear();
      const cfg = getTableConfig(table);
      if (!cfg?.validation || !cfg.columns) return;

      const fetches = [];
      for (const col of columns) {
        const rule = cfg.columns[col.id];
        if (!rule) continue;

        if (API_DROPDOWN_TYPES.has(rule.type)) {
          fetches.push(
            fetchDropdownOptions(api, rule.type).then((opts) => {
              const storeAs = rule.storeAs ?? "name";
              const validSet = new Set(opts.map((o) => String(o[storeAs])));
              dropdownOptions.set(col.id, { options: opts, validSet, storeAs });
            }),
          );
        } else if (rule.type === DATATABLE_TYPE) {
          // Resolve data table ID from rule config
          let srcId = rule.datatableId ?? null;
          if (!srcId && rule.datatableName) {
            // Look up by name (case-insensitive) from the loaded tables list
            const match = [...tableMap.values()].find(
              (t) => t.name.toLowerCase() === rule.datatableName.toLowerCase(),
            );
            if (match) srcId = match.id;
          }
          if (srcId) {
            fetches.push(
              fetchDropdownOptions(api, "datatable", srcId).then((opts) => {
                const validSet = new Set(opts.map((o) => String(o.name)));
                dropdownOptions.set(col.id, {
                  options: opts,
                  validSet,
                  storeAs: "name",
                });
              }),
            );
          }
        } else if (rule.type === ENUM_TYPE && rule.options?.length) {
          const validSet = new Set(rule.options.map(String));
          dropdownOptions.set(col.id, {
            options: rule.options.map((o) => ({ id: o, name: o })),
            validSet,
            storeAs: "name",
          });
        }
      }

      await Promise.all(fetches);
    }

    /* ── Rows UI: search bar + sortable table ───────── */

    function renderRowsUI() {
      // Remove any previous rows UI but keep the header
      rowCard
        .querySelectorAll(".dt-search-bar, .dt-rows-wrap, .dt-row-status")
        .forEach((el) => el.remove());

      /* Search bar */
      const searchBar = document.createElement("div");
      searchBar.className = "dt-search-bar";

      const searchInput = document.createElement("input");
      searchInput.type = "text";
      searchInput.className = "dt-search-input";
      searchInput.placeholder = LABELS.searchPlaceholder;

      const rowCount = document.createElement("span");
      rowCount.className = "dt-row-count";
      rowCount.textContent = LABELS.rowCount(allRows.length, allRows.length);

      /* Action buttons container (Save All / Discard All) */
      const actionBtns = document.createElement("div");
      actionBtns.className = "dt-action-btns";

      const saveAllBtn = document.createElement("button");
      saveAllBtn.className = "dt-btn dt-btn--save";
      saveAllBtn.textContent = "Save All";
      saveAllBtn.addEventListener("click", () => {
        for (const rowKey of [...dirtyRows.keys()]) {
          if (!rowHasErrors(rowKey)) saveRow(rowKey);
        }
      });

      const discardAllBtn = document.createElement("button");
      discardAllBtn.className = "dt-btn dt-btn--discard";
      discardAllBtn.textContent = "Discard All";
      discardAllBtn.addEventListener("click", () => {
        clearAllDirty();
        renderTable();
      });

      actionBtns.append(saveAllBtn, discardAllBtn);

      searchBar.append(searchInput, rowCount, actionBtns);
      rowCard.append(searchBar);

      /* Table wrapper */
      const wrap = document.createElement("div");
      wrap.className = "dt-rows-wrap";
      rowCard.append(wrap);

      /* No-match message (hidden by default) */
      const noMatch = document.createElement("p");
      noMatch.className = "p dt-row-status";
      noMatch.textContent = LABELS.noMatch;
      noMatch.style.display = "none";
      rowCard.append(noMatch);

      /** Current search term */
      let searchTerm = "";

      /** Get sorted + filtered rows */
      function getVisibleRows() {
        let rows = allRows;

        // Filter by all columns (case-insensitive substring)
        if (searchTerm) {
          const lc = searchTerm.toLowerCase();
          rows = rows.filter((r) =>
            columns.some((col) =>
              String(r[col.id] ?? "")
                .toLowerCase()
                .includes(lc),
            ),
          );
        }

        // Sort
        rows = [...rows].sort((a, b) => {
          const va = a[sortCol] ?? "";
          const vb = b[sortCol] ?? "";
          let cmp;
          if (typeof va === "number" && typeof vb === "number") {
            cmp = va - vb;
          } else if (typeof va === "boolean" && typeof vb === "boolean") {
            cmp = va === vb ? 0 : va ? -1 : 1;
          } else {
            cmp = String(va).localeCompare(String(vb), undefined, {
              numeric: true,
              sensitivity: "base",
            });
          }
          return sortAsc ? cmp : -cmp;
        });

        return rows;
      }

      /** Render the HTML table */
      function renderTable() {
        wrap.innerHTML = "";

        const visible = getVisibleRows();

        // Update count
        rowCount.textContent = LABELS.rowCount(
          visible.length,
          allRows.length,
        );

        // Show/hide Save All / Discard All buttons
        const hasDirty = dirtyRows.size > 0;
        actionBtns.style.display = hasDirty ? "" : "none";
        // Disable Save All if any dirty row has errors
        const anyErrors = [...dirtyRows.keys()].some((k) => rowHasErrors(k));
        saveAllBtn.disabled = anyErrors;
        saveAllBtn.classList.toggle("dt-btn--disabled", anyErrors);
        saveAllBtn.title = anyErrors ? LABELS.validationBlocksSave : "";

        // No match?
        if (!visible.length) {
          noMatch.style.display = "";
          return;
        }
        noMatch.style.display = "none";

        const table = document.createElement("table");
        table.className = "dt-table";

        // <thead>
        const thead = document.createElement("thead");
        const headRow = document.createElement("tr");

        for (const col of columns) {
          const th = document.createElement("th");
          th.className = "dt-th";
          th.dataset.colId = col.id;

          /* Editability indicator on header */
          const isKey = col.id === "key";
          const isEditable = !isKey && editableFields.has(col.id);
          if (isKey) {
            th.classList.add("dt-th--key");
            th.title = LABELS.keyTooltip;
          } else if (isEditable) {
            th.classList.add("dt-th--editable");
            th.title = LABELS.editableTooltip;
          } else if (SUPERVISOR_MODE && !readOnlyReason) {
            th.classList.add("dt-th--locked");
            th.title = LABELS.lockTooltip;
          }

          const label = document.createElement("span");
          label.textContent = col.title;

          /* Required asterisk */
          const table_ = tableMap.get(currentTableId);
          const colRule = getColumnRule(table_, col.id);
          if (!isKey && isColumnRequired(table_?.schema, col.id, colRule)) {
            const req = document.createElement("span");
            req.className = "dt-required";
            req.textContent = LABELS.required;
            req.title = "Required";
            label.append(req);
          }

          /* Lock / pencil icon */
          const icon = document.createElement("span");
          icon.className = "dt-col-icon";
          if (isKey) {
            icon.textContent = " 🔑";
          } else if (isEditable) {
            icon.textContent = " ✏️";
          } else if (SUPERVISOR_MODE && !readOnlyReason) {
            icon.textContent = " 🔒";
          }

          const arrow = document.createElement("span");
          arrow.className = "dt-sort-arrow";
          if (col.id === sortCol) {
            arrow.textContent = sortAsc ? " ▲" : " ▼";
          }

          th.append(label, icon, arrow);
          th.addEventListener("click", () => {
            if (sortCol === col.id) {
              sortAsc = !sortAsc;
            } else {
              sortCol = col.id;
              sortAsc = true;
            }
            renderTable();
          });
          headRow.append(th);
        }

        thead.append(headRow);
        table.append(thead);

        // <tbody>
        const tbody = document.createElement("tbody");
        for (const row of visible) {
          const rowKey = String(row.key ?? "");
          const rowDirty = isDirty(rowKey);
          const rowSaving = savingRows.has(rowKey);
          const edits = getDirtyEdits(rowKey);

          const tr = document.createElement("tr");
          tr.className = "dt-tr";
          tr.dataset.rowKey = rowKey;
          if (rowDirty) tr.classList.add("dt-tr--dirty");
          if (rowSaving) tr.classList.add("dt-tr--saving");

          for (const col of columns) {
            const td = document.createElement("td");
            td.className = "dt-td";

            const isKey = col.id === "key";
            const cellEditable = !isKey && editableFields.has(col.id) && !rowSaving;

            // Show edited value if dirty, else original
            const displayValue = col.id in edits ? edits[col.id] : row[col.id];

            // Per-cell validation error
            const cellError = getCellError(rowKey, col.id);

            // Column rule (for dropdown type detection)
            const colRule = getColumnRule(tableMap.get(currentTableId), col.id);
            const isDropdown =
              colRule &&
              (API_DROPDOWN_TYPES.has(colRule.type) || colRule.type === ENUM_TYPE || colRule.type === DATATABLE_TYPE);

            if (cellEditable) {
              td.classList.add("dt-td--editable");
              if (col.id in edits) td.classList.add("dt-td--changed");
              if (cellError) td.classList.add("dt-td--error");

              if (col.type === "boolean" || colRule?.type === "boolean") {
                // Boolean → checkbox
                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.className = "dt-cell-checkbox";
                cb.checked = displayValue === true || displayValue === "true";
                cb.disabled = rowSaving;
                cb.addEventListener("change", () => {
                  const coerced = coerceValue(cb.checked, "boolean");
                  markDirty(rowKey, col.id, coerced, row);
                  validateRow(rowKey, row, tableMap.get(currentTableId)?.schema);
                  renderTable();
                });
                td.append(cb);
              } else if (isDropdown && dropdownOptions.has(col.id)) {
                // Dropdown (enum, API-backed, or datatable)
                const optsEntry = dropdownOptions.get(col.id);
                const sel = document.createElement("select");
                sel.className = "dt-cell-select";
                sel.disabled = rowSaving;

                // Placeholder option
                const placeholder = document.createElement("option");
                placeholder.value = "";
                placeholder.textContent = LABELS.dropdownPlaceholder;
                placeholder.disabled = true;
                if (!displayValue && displayValue !== false) placeholder.selected = true;
                sel.append(placeholder);

                const normalised = String(displayValue ?? "").trim();
                let matched = false;
                for (const opt of optsEntry.options) {
                  const o = document.createElement("option");
                  const storeVal = String(opt[optsEntry.storeAs] ?? opt.name);
                  o.value = storeVal;
                  o.textContent = opt.name;
                  if (normalised === storeVal.trim()) {
                    o.selected = true;
                    matched = true;
                  }
                  sel.append(o);
                }

                // If current value isn't in the option list, add it so it's visible
                if (normalised && !matched) {
                  const extra = document.createElement("option");
                  extra.value = normalised;
                  extra.textContent = `${normalised} ⚠️`;
                  extra.selected = true;
                  sel.insertBefore(extra, sel.children[1]); // after placeholder
                }

                // Set value explicitly after all options exist
                if (normalised) sel.value = normalised;

                sel.addEventListener("change", () => {
                  markDirty(rowKey, col.id, sel.value, row);
                  validateRow(rowKey, row, tableMap.get(currentTableId)?.schema);
                  renderTable();
                });

                td.append(sel);
              } else {
                // Text / number → click-to-edit
                const span = document.createElement("span");
                span.className = "dt-cell-text";
                span.textContent = formatCell(displayValue, col.type);
                td.append(span);

                td.addEventListener("click", (e) => {
                  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
                  const input = document.createElement("input");
                  input.type = col.type === "integer" || col.type === "number" ? "number" : "text";
                  input.className = "dt-cell-input";
                  input.value = displayValue ?? "";
                  if (col.type === "integer") input.step = "1";

                  td.innerHTML = "";
                  td.append(input);
                  input.focus();
                  input.select();

                  const commit = () => {
                    const coerced = coerceValue(input.value, col.type);
                    markDirty(rowKey, col.id, coerced, row);
                    validateRow(rowKey, row, tableMap.get(currentTableId)?.schema);
                    renderTable();
                  };

                  input.addEventListener("blur", commit);
                  input.addEventListener("keydown", (ke) => {
                    if (ke.key === "Enter") { ke.preventDefault(); commit(); }
                    if (ke.key === "Escape") { ke.preventDefault(); renderTable(); }
                  });
                });
              }

              // Show validation error tooltip
              if (cellError) {
                td.title = cellError;
                const errSpan = document.createElement("span");
                errSpan.className = "dt-cell-error";
                errSpan.textContent = cellError;
                td.append(errSpan);
              }
            } else {
              // Read-only cell
              td.textContent = formatCell(displayValue, col.type);
              if (col.type === "boolean") {
                td.classList.add(
                  displayValue ? "dt-bool--true" : "dt-bool--false",
                );
              }
            }

            tr.append(td);
          }

          tbody.append(tr);
        }
        table.append(tbody);

        wrap.append(table);
      }

      /* ── Save a dirty row via API ──────────────── */
      async function saveRow(rowKey) {
        const entry = dirtyRows.get(rowKey);
        if (!entry) return;

        // Run validation one more time before saving
        const originalRow = allRows.find((r) => String(r.key ?? "") === rowKey);
        if (!originalRow) return;
        validateRow(rowKey, originalRow, tableMap.get(currentTableId)?.schema);
        if (rowHasErrors(rowKey)) {
          renderTable();
          return;
        }

        // Build the full row payload (original + edits)
        const payload = { ...originalRow };
        for (const [field, val] of Object.entries(entry.edits)) {
          payload[field] = val;
        }

        // Mark as saving
        savingRows.add(rowKey);
        renderTable();

        // Remove any previous error for this row
        rowCard.querySelectorAll(`.dt-row-error[data-row-key="${CSS.escape(rowKey)}"]`)
          .forEach((el) => el.remove());

        try {
          const saved = await api.updateDataTableRow(currentTableId, rowKey, payload);

          // Update the row in allRows with the server response
          const idx = allRows.findIndex((r) => String(r.key ?? "") === rowKey);
          if (idx !== -1) allRows[idx] = saved;

          // Clear dirty state
          dirtyRows.delete(rowKey);
          savingRows.delete(rowKey);
          renderTable();

          // Brief success flash
          const successRow = wrap.querySelector(`tr[data-row-key="${CSS.escape(rowKey)}"]`);
          if (successRow) {
            successRow.classList.add("dt-tr--saved");
            setTimeout(() => successRow.classList.remove("dt-tr--saved"), 1500);
          }
        } catch (err) {
          savingRows.delete(rowKey);
          renderTable();

          // Show inline error beneath the table
          const errEl = document.createElement("div");
          errEl.className = "dt-row-error";
          errEl.dataset.rowKey = rowKey;
          errEl.textContent = LABELS.saveError(err.message || String(err));
          // Insert after wrap
          wrap.insertAdjacentElement("afterend", errEl);
        }
      }

      // Initial render
      renderTable();

      // Debounced search
      let debounceTimer;
      searchInput.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          searchTerm = searchInput.value.trim();
          renderTable();
        }, SEARCH_DEBOUNCE_MS);
      });
    }
  } catch (err) {
    spinner.remove();
    const errEl = document.createElement("p");
    errEl.className = "p dt-error";
    errEl.textContent = LABELS.errorPrefix + (err.message || String(err));
    listCard.append(errEl);
  }

  return root;
}
