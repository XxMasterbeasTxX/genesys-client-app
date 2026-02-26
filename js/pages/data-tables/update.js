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
  searchPlaceholder: "Search by key…",
  rowCount: (shown, total) =>
    shown === total ? `${total} rows` : `${shown} of ${total} rows`,
  modeSupervisor: "Supervisor Mode",
  modeAdmin: "Administrator Mode",
  readOnlyBanner: (reason) => reason,
  lockTooltip: "This field is read-only in Supervisor Mode.",
  editableTooltip: "This field is editable.",
  keyTooltip: "The key column is always read-only.",
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

    /* ── Table list ─────────────────────────────────── */
    const list = document.createElement("ul");
    list.className = "dt-table-list";

    for (const table of tables) {
      const divisionId = table.division?.id ?? "";
      const divisionName = table.division?.name ?? "—";
      const isEditable = hasDivisionAccess(canEdit, divisionId);

      const schemaProps = table.schema?.properties ?? {};
      const fieldCount = Object.keys(schemaProps).length;

      const li = document.createElement("li");
      li.className = "dt-table-item";
      li.dataset.tableId = table.id;

      const badge = document.createElement("span");
      badge.className = isEditable
        ? "dt-badge dt-badge--edit"
        : "dt-badge dt-badge--view";
      badge.textContent = isEditable ? LABELS.badgeEdit : LABELS.badgeView;

      const name = document.createElement("span");
      name.className = "dt-table-name";
      name.textContent = table.name;

      const meta = document.createElement("span");
      meta.className = "dt-table-meta";
      meta.textContent = `${LABELS.division}: ${divisionName} · ${fieldCount} ${LABELS.fields}`;

      const info = document.createElement("div");
      info.className = "dt-table-info";
      info.append(name, meta);

      li.append(info, badge);

      li.addEventListener("click", () => {
        list
          .querySelectorAll(".dt-table-item")
          .forEach((el) => el.classList.remove("dt-table-item--active"));
        li.classList.add("dt-table-item--active");
        loadTableRows(table.id);
      });

      list.append(li);
    }

    listCard.append(list);

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

    async function loadTableRows(tableId) {
      currentTableId = tableId;
      const table = tableMap.get(tableId);
      if (!table) return;

      columns = columnsFromSchema(table.schema);
      allRows = [];
      sortCol = "key";
      sortAsc = true;

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

      searchBar.append(searchInput, rowCount);
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

        // Filter by key (case-insensitive substring)
        if (searchTerm) {
          const lc = searchTerm.toLowerCase();
          rows = rows.filter((r) =>
            String(r.key ?? "")
              .toLowerCase()
              .includes(lc),
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
          const tr = document.createElement("tr");
          tr.className = "dt-tr";

          for (const col of columns) {
            const td = document.createElement("td");
            td.className = "dt-td";
            td.textContent = formatCell(row[col.id], col.type);
            if (col.type === "boolean") {
              td.classList.add(
                row[col.id] ? "dt-bool--true" : "dt-bool--false",
              );
            }
            tr.append(td);
          }
          tbody.append(tr);
        }
        table.append(tbody);

        wrap.append(table);
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
