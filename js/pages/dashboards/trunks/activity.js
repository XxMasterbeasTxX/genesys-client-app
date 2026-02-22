/**
 * Dashboards › Trunks › Activity
 *
 * Shows live trunk metrics with a multi-select filter.
 * Hybrid: REST initial load + WebSocket live updates + polling fallback.
 */
import { NotificationService } from "../../../services/notificationService.js";
import { escapeHtml } from "../../../utils.js";

// How many trunk IDs to batch per metrics REST call
const METRICS_BATCH_SIZE = 100;

/**
 * Main render entry point — called by the page registry.
 */
export async function render({ route, me, api }) {
  // ── State ───────────────────────────────────────────────
  let allTrunks = [];            // full list from API
  let selectedIds = new Set();   // trunk IDs the user wants to see
  let metricsMap = new Map();    // trunkId → latest metrics object
  let notifService = null;

  // ── DOM skeleton ────────────────────────────────────────
  const root = document.createElement("div");
  root.className = "trunk-activity";

  // Header bar
  const header = document.createElement("div");
  header.className = "trunk-header";

  const title = document.createElement("h1");
  title.className = "h1";
  title.textContent = "Trunk Activity";

  const statusBadge = document.createElement("span");
  statusBadge.className = "pill trunk-status-badge";
  statusBadge.textContent = "Loading…";

  header.append(title, statusBadge);

  // Filter section
  const filterSection = document.createElement("section");
  filterSection.className = "card trunk-filter-section";

  const filterHeader = document.createElement("div");
  filterHeader.className = "trunk-filter-header";

  const filterLabel = document.createElement("span");
  filterLabel.className = "trunk-filter-label";
  filterLabel.textContent = "Filter trunks";

  const selectAllBtn = document.createElement("button");
  selectAllBtn.className = "btn btn-sm";
  selectAllBtn.textContent = "Select all";
  selectAllBtn.addEventListener("click", () => toggleAll(true));

  const clearBtn = document.createElement("button");
  clearBtn.className = "btn btn-sm";
  clearBtn.textContent = "Clear";
  clearBtn.addEventListener("click", () => toggleAll(false));

  filterHeader.append(filterLabel, selectAllBtn, clearBtn);

  const filterSearch = document.createElement("input");
  filterSearch.type = "text";
  filterSearch.className = "trunk-filter-search";
  filterSearch.placeholder = "Search trunks…";
  filterSearch.addEventListener("input", () => renderFilterList());

  const filterList = document.createElement("div");
  filterList.className = "trunk-filter-list";

  filterSection.append(filterHeader, filterSearch, filterList);

  // Metrics table
  const tableSection = document.createElement("section");
  tableSection.className = "card trunk-table-section";

  const table = document.createElement("table");
  table.className = "trunk-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Trunk Name</th>
        <th>Type</th>
        <th>Status</th>
        <th>Active Calls</th>
        <th>Edge</th>
        <th>Updated</th>
      </tr>
    </thead>
    <tbody id="trunkTableBody"></tbody>
  `;
  tableSection.append(table);

  root.append(header, filterSection, tableSection);

  // ── Helper: render the filter checkbox list ─────────────
  function renderFilterList() {
    const q = filterSearch.value.toLowerCase();
    const filtered = allTrunks.filter((t) =>
      t.name.toLowerCase().includes(q),
    );

    filterList.innerHTML = "";
    for (const trunk of filtered) {
      const label = document.createElement("label");
      label.className = "trunk-filter-item";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selectedIds.has(trunk.id);
      cb.addEventListener("change", () => {
        if (cb.checked) selectedIds.add(trunk.id);
        else selectedIds.delete(trunk.id);
        onSelectionChanged();
      });

      const span = document.createElement("span");
      span.textContent = trunk.name;

      label.append(cb, span);
      filterList.append(label);
    }
  }

  function toggleAll(on) {
    if (on) allTrunks.forEach((t) => selectedIds.add(t.id));
    else selectedIds.clear();
    renderFilterList();
    onSelectionChanged();
  }

  // ── Helper: render the metrics table body ───────────────
  function renderTable() {
    const tbody = root.querySelector("#trunkTableBody");
    if (!tbody) return;

    const rows = [...selectedIds]
      .map((id) => {
        const trunk = allTrunks.find((t) => t.id === id);
        const m = metricsMap.get(id);
        return { trunk, m };
      })
      .filter((r) => r.trunk)
      .sort((a, b) => a.trunk.name.localeCompare(b.trunk.name));

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="trunk-empty">Select one or more trunks above</td></tr>`;
      return;
    }

    tbody.innerHTML = rows
      .map(({ trunk, m }) => {
        const status = resolveStatus(trunk, m);
        const calls = m?.calls?.inProgress ?? m?.activeCalls ?? "—";
        const edge = trunk.edge?.name || trunk.edgeGroup?.name || "—";
        const updated = m
          ? new Date(m.eventTime || Date.now()).toLocaleTimeString()
          : "—";

        return `<tr>
          <td>${escapeHtml(trunk.name)}</td>
          <td>${escapeHtml(trunk.trunkType || "—")}</td>
          <td><span class="trunk-dot trunk-dot--${status.color}"></span> ${escapeHtml(status.label)}</td>
          <td>${escapeHtml(String(calls))}</td>
          <td>${escapeHtml(edge)}</td>
          <td>${escapeHtml(updated)}</td>
        </tr>`;
      })
      .join("");
  }

  function resolveStatus(trunk, metrics) {
    const connected =
      metrics?.connectedStatus?.connected ??
      metrics?.connected ??
      trunk?.state === "connected";

    if (connected === true) return { label: "Connected", color: "green" };
    if (connected === false) return { label: "Disconnected", color: "red" };
    return { label: trunk.state ?? "Unknown", color: "gray" };
  }

  // ── Metrics fetching (REST) ─────────────────────────────
  async function fetchMetrics() {
    const ids = [...selectedIds];
    if (!ids.length) return;

    for (let i = 0; i < ids.length; i += METRICS_BATCH_SIZE) {
      const batch = ids.slice(i, i + METRICS_BATCH_SIZE);
      try {
        const res = await api.getTrunkMetrics(batch);
        const entities = res?.entities || res || [];
        for (const m of entities) {
          if (m.trunk?.id) metricsMap.set(m.trunk.id, m);
        }
      } catch (e) {
        console.warn("Trunk metrics fetch failed:", e);
      }
    }
    renderTable();
  }

  // ── Selection changed → update subscriptions + fetch ────
  function onSelectionChanged() {
    renderTable();
    fetchMetrics();
    updateSubscriptions();
  }

  function updateSubscriptions() {
    if (!notifService) return;
    const topics = [...selectedIds].flatMap((id) => [
      `v2.telephony.providers.edges.trunks.${id}`,
      `v2.telephony.providers.edges.trunks.${id}.metrics`,
    ]);
    notifService.setTopics(topics);
  }

  // ── WebSocket event handler ─────────────────────────────
  function handleNotification(topicName, eventBody) {
    const parts = topicName.split(".");
    const trunkIdx = parts.indexOf("trunks");
    if (trunkIdx < 0) return;
    const trunkId = parts[trunkIdx + 1];
    if (!trunkId || !selectedIds.has(trunkId)) return;

    if (topicName.endsWith(".metrics")) {
      metricsMap.set(trunkId, { ...metricsMap.get(trunkId), ...eventBody });
    } else {
      const trunk = allTrunks.find((t) => t.id === trunkId);
      if (trunk && eventBody.state) trunk.state = eventBody.state;
    }

    renderTable();
  }

  // ── Bootstrap ───────────────────────────────────────────
  try {
    // 1. Load trunk list
    allTrunks = await api.getAllTrunks();
    allTrunks.sort((a, b) => a.name.localeCompare(b.name));

    renderFilterList();
    renderTable();

    // 2. Start notification service
    notifService = new NotificationService({
      api,
      onEvent: handleNotification,
      onStateChange: (state) => {
        const labels = {
          connected: "Live",
          reconnecting: "Reconnecting…",
          polling: "Polling (WS down)",
          closed: "Disconnected",
        };
        statusBadge.textContent = labels[state] || state;
        statusBadge.className = `pill trunk-status-badge trunk-status--${state}`;
      },
      pollFn: fetchMetrics,
      pollInterval: 15_000,
    });

    await notifService.connect();
    statusBadge.textContent = "Live";
    statusBadge.className = "pill trunk-status-badge trunk-status--connected";
  } catch (e) {
    statusBadge.textContent = "Error";
    statusBadge.className = "pill trunk-status-badge trunk-status--closed";
    console.error("Trunk activity init failed:", e);
  }

  // ── Cleanup when page navigates away ────────────────────
  const observer = new MutationObserver(() => {
    if (!root.isConnected) {
      notifService?.destroy();
      observer.disconnect();
    }
  });
  requestAnimationFrame(() => {
    if (root.parentElement) {
      observer.observe(root.parentElement, { childList: true });
    }
  });

  return root;
}
