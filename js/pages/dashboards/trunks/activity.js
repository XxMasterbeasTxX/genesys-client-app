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

// Polling interval for periodic metric refresh (ms)
const POLL_INTERVAL_MS = 15_000;

/**
 * Strip trailing UUID / ID suffix from trunk names returned by the API.
 * E.g. "MyTrunk_abc12345-def6-7890-abcd-ef1234567890" → "MyTrunk"
 */
function cleanTrunkName(raw) {
  return raw
    .replace(/[_\s-]+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "")
    .trim();
}

/**
 * Main render entry point — called by the page registry.
 */
export async function render({ route, me, api }) {
  // ── State ───────────────────────────────────────────────
  let allTrunks = [];            // full list from API (deduplicated)
  let selectedIds = new Set();   // trunk IDs the user wants to see
  let metricsMap = new Map();    // trunkId → latest metrics object
  let notifService = null;
  let pollTimer = null;          // periodic REST poll handle

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
        <th>Status</th>
        <th>Inbound</th>
        <th>Outbound</th>
        <th>Total Calls</th>
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
      t._cleanName.toLowerCase().includes(q),
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
      span.textContent = trunk._cleanName;

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
      .sort((a, b) => a.trunk._cleanName.localeCompare(b.trunk._cleanName));

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="trunk-empty">Select one or more trunks above</td></tr>`;
      return;
    }

    tbody.innerHTML = rows
      .map(({ trunk, m }) => {
        const status = resolveStatus(trunk, m);
        const inbound  = m?.calls?.inboundCallCount  ?? "—";
        const outbound = m?.calls?.outboundCallCount ?? "—";
        const total = (typeof inbound === "number" && typeof outbound === "number")
          ? inbound + outbound
          : "—";
        const updated = m
          ? new Date(m.eventTime || Date.now()).toLocaleTimeString()
          : "—";

        return `<tr>
          <td>${escapeHtml(trunk._cleanName)}</td>
          <td><span class="trunk-dot trunk-dot--${status.color}"></span> ${escapeHtml(status.label)}</td>
          <td>${escapeHtml(String(inbound))}</td>
          <td>${escapeHtml(String(outbound))}</td>
          <td>${escapeHtml(String(total))}</td>
          <td>${escapeHtml(updated)}</td>
        </tr>`;
      })
      .join("");
  }

  function resolveStatus(trunk, _metrics) {
    // connectedStatus lives on the Trunk object from the list endpoint,
    // NOT on TrunkMetrics.  Trunk.state is "active"/"inactive"/"deleted".
    const cs = trunk?.connectedStatus;
    if (cs?.connected === true)  return { label: "Connected",    color: "green" };
    if (cs?.connected === false) return { label: "Disconnected", color: "red" };

    // Fallback: treat inService / enabled flags
    if (trunk?.inService && trunk?.enabled) return { label: "In Service", color: "green" };

    return { label: trunk?.state ?? "Unknown", color: "gray" };
  }

  // ── Metrics fetching (REST) ─────────────────────────────
  async function fetchMetrics() {
    // Collect ALL trunk instance IDs (including duplicate edge instances)
    const allIds = [...selectedIds].flatMap((id) => {
      const t = allTrunks.find((tr) => tr.id === id);
      return t?._allIds || [id];
    });
    if (!allIds.length) return;

    for (let i = 0; i < allIds.length; i += METRICS_BATCH_SIZE) {
      const batch = allIds.slice(i, i + METRICS_BATCH_SIZE);
      try {
        const res = await api.getTrunkMetrics(batch);
        const entities = res?.entities || res || [];
        for (const m of entities) {
          const tid = m.trunk?.id;
          if (!tid) continue;
          // Map back to the representative (deduplicated) trunk
          const rep = allTrunks.find((tr) => tr._allIds?.includes(tid));
          const repId = rep?.id || tid;
          const prev = metricsMap.get(repId);
          // Keep whichever instance has the highest call activity
          const mCalls = (m.calls?.inboundCallCount || 0) + (m.calls?.outboundCallCount || 0);
          const pCalls = (prev?.calls?.inboundCallCount || 0) + (prev?.calls?.outboundCallCount || 0);
          if (!prev || mCalls >= pCalls) metricsMap.set(repId, m);
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
    // Subscribe to ALL instance IDs (including duplicates from multiple edges)
    const allIds = [...selectedIds].flatMap((id) => {
      const t = allTrunks.find((tr) => tr.id === id);
      return t?._allIds || [id];
    });
    const topics = allIds.flatMap((id) => [
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
    if (!trunkId) return;

    // Map the raw trunk instance ID back to the deduplicated representative
    const rep = allTrunks.find((t) => t._allIds?.includes(trunkId));
    const repId = rep?.id || trunkId;
    if (!selectedIds.has(repId)) return;

    if (topicName.endsWith(".metrics")) {
      metricsMap.set(repId, { ...metricsMap.get(repId), ...eventBody });
    } else {
      // Trunk-level event — update connectedStatus + state on our cached object
      if (rep) {
        if (eventBody.connectedStatus) rep.connectedStatus = eventBody.connectedStatus;
        if (eventBody.state) rep.state = eventBody.state;
      }
    }

    renderTable();
  }

  // ── Bootstrap ───────────────────────────────────────────
  try {
    // 1. Load EXTERNAL trunk list and deduplicate by trunkBase
    const rawTrunks = await api.getAllTrunks({ trunkType: "EXTERNAL" });
    const groups = new Map();
    for (const t of rawTrunks) {
      t._cleanName = cleanTrunkName(t.name);
      const key = t.trunkBase?.id || t._cleanName;
      if (!groups.has(key)) {
        groups.set(key, { trunk: t, allIds: [t.id] });
      } else {
        const g = groups.get(key);
        g.allIds.push(t.id);
        // Prefer the connected instance as representative
        if (t.connectedStatus?.connected && !g.trunk.connectedStatus?.connected) {
          g.trunk = t;
        }
      }
    }
    allTrunks = [...groups.values()].map(({ trunk, allIds }) => {
      trunk._allIds = allIds;
      return trunk;
    });
    allTrunks.sort((a, b) => a._cleanName.localeCompare(b._cleanName));

    renderFilterList();
    renderTable();

    // 2. Start notification service (WebSocket for instant updates)
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
      pollInterval: POLL_INTERVAL_MS,
    });

    await notifService.connect();
    statusBadge.textContent = "Live";
    statusBadge.className = "pill trunk-status-badge trunk-status--connected";

    // 3. Start periodic REST poll (belt-and-suspenders with WebSocket)
    pollTimer = setInterval(() => {
      if (selectedIds.size) fetchMetrics();
    }, POLL_INTERVAL_MS);
  } catch (e) {
    statusBadge.textContent = "Error";
    statusBadge.className = "pill trunk-status-badge trunk-status--closed";
    console.error("Trunk activity init failed:", e);
  }

  // ── Cleanup when page navigates away ────────────────────
  const observer = new MutationObserver(() => {
    if (!root.isConnected) {
      if (pollTimer) clearInterval(pollTimer);
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
