/**
 * Data Tables › Update
 *
 * Lists all accessible data tables with division info and edit/view-only badges.
 * Selecting a table will (in later steps) load its rows for viewing/editing.
 */

/* ── Constants ─────────────────────────────────────────── */

const LABELS = {
  pageTitle: "Data Tables — Update",
  pageDescription: "Select a data table to view and edit its rows.",
  loading: "Loading data tables…",
  noAccess:
    "You do not have permission to view any data tables. Contact your administrator to request the architect:datatable:view permission.",
  errorPrefix: "Failed to load data tables: ",
  badgeEdit: "Editable",
  badgeView: "View-only",
  division: "Division",
  fields: "fields",
};

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
    // Permissions look like:
    //   architect:datatable:view:*
    //   architect:datatable:edit:div-id-1,div-id-2
    if (!perm.startsWith("architect:datatable:")) continue;

    const parts = perm.split(":");
    // parts = ["architect", "datatable", "view", "div1,div2"]
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

/**
 * Check if a permission set covers a specific division.
 */
function hasDivisionAccess(permSet, divisionId) {
  return permSet.has("*") || permSet.has(divisionId);
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

  card.append(h1, desc);
  root.append(card);

  /* ── Loading state ──────────────────────────────────── */
  const listCard = document.createElement("section");
  listCard.className = "card dt-list-card";

  const spinner = document.createElement("div");
  spinner.className = "dt-spinner";
  spinner.textContent = LABELS.loading;
  listCard.append(spinner);
  root.append(listCard);

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

    /* ── Table list ─────────────────────────────────── */
    const list = document.createElement("ul");
    list.className = "dt-table-list";

    for (const table of tables) {
      const divisionId = table.division?.id ?? "";
      const divisionName = table.division?.name ?? "—";
      const isEditable = hasDivisionAccess(canEdit, divisionId);

      // Count fields from schema (exclude "key")
      const schemaProps = table.schema?.properties ?? {};
      const fieldCount = Object.keys(schemaProps).length;

      const li = document.createElement("li");
      li.className = "dt-table-item";
      li.dataset.tableId = table.id;
      li.dataset.tableName = table.name;

      // Badge
      const badge = document.createElement("span");
      badge.className = isEditable
        ? "dt-badge dt-badge--edit"
        : "dt-badge dt-badge--view";
      badge.textContent = isEditable ? LABELS.badgeEdit : LABELS.badgeView;

      // Table name
      const name = document.createElement("span");
      name.className = "dt-table-name";
      name.textContent = table.name;

      // Meta info line
      const meta = document.createElement("span");
      meta.className = "dt-table-meta";
      meta.textContent = `${LABELS.division}: ${divisionName} · ${fieldCount} ${LABELS.fields}`;

      // Layout
      const info = document.createElement("div");
      info.className = "dt-table-info";
      info.append(name, meta);

      li.append(info, badge);

      // Click handler (placeholder for Step 4)
      li.addEventListener("click", () => {
        list
          .querySelectorAll(".dt-table-item")
          .forEach((el) => el.classList.remove("dt-table-item--active"));
        li.classList.add("dt-table-item--active");
        // Step 4 will load rows here
      });

      list.append(li);
    }

    listCard.append(list);
  } catch (err) {
    spinner.remove();
    const errEl = document.createElement("p");
    errEl.className = "p dt-error";
    errEl.textContent = LABELS.errorPrefix + (err.message || String(err));
    listCard.append(errEl);
  }

  return root;
}
