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

// How many data-points to keep in the rolling chart history
const CHART_HISTORY_MAX = 120;

// Palette for per-trunk chart lines
const CHART_COLOURS = [
  "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7",
  "#06b6d4", "#ec4899", "#14b8a6", "#f97316", "#6366f1",
];

// ── Threshold: warn when total concurrent calls reaches this number ───
// Set to 1 for testing (any active call triggers). Change per customer before deploying.
const CALL_THRESHOLD = 1;

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
  let chartHistory = [];          // [{ ts, perTrunk: { id→total }, total }]
  let chartTrunkIds = new Set();  // which trunks to graph (empty = "All")
  let chartVisible = false;       // graph panel shown?
  let chartInstance = null;       // Chart.js instance
  let notifService = null;
  let pollTimer = null;          // periodic REST poll handle
  let tabFlashTimer = null;      // tab title flash interval
  const originalTitle = document.title;

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

  // Threshold warning banner (hidden by default)
  const warningBanner = document.createElement("div");
  warningBanner.className = "trunk-threshold-banner hidden";
  warningBanner.setAttribute("role", "alert");

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
      </tr>
    </thead>
    <tbody id="trunkTableBody"></tbody>
  `;
  tableSection.append(table);

  // ── Graph section ──────────────────────────────────────
  const graphSection = document.createElement("section");
  graphSection.className = "card trunk-graph-section hidden";

  // Graph toolbar: trunk picker
  const graphToolbar = document.createElement("div");
  graphToolbar.className = "trunk-graph-toolbar";

  const graphPickerLabel = document.createElement("span");
  graphPickerLabel.className = "trunk-filter-label";
  graphPickerLabel.textContent = "Graph trunks";

  const graphPickerList = document.createElement("div");
  graphPickerList.className = "trunk-graph-picker";

  graphToolbar.append(graphPickerLabel, graphPickerList);

  const canvas = document.createElement("canvas");
  canvas.className = "trunk-graph-canvas";
  canvas.height = 260;

  graphSection.append(graphToolbar, canvas);

  // Toggle graph button (in header)
  const graphToggleBtn = document.createElement("button");
  graphToggleBtn.className = "btn btn-sm trunk-graph-toggle";
  graphToggleBtn.textContent = "📈 Show Graph";
  graphToggleBtn.addEventListener("click", () => {
    chartVisible = !chartVisible;
    graphSection.classList.toggle("hidden", !chartVisible);
    graphToggleBtn.textContent = chartVisible ? "📈 Hide Graph" : "📈 Show Graph";
    if (chartVisible) renderChart();
  });
  header.append(graphToggleBtn);

  // Fullscreen toggle — native API when available, CSS maximized as fallback
  let isMaximized = false;
  const canFullscreen = typeof root.requestFullscreen === "function";

  const fullscreenBtn = document.createElement("button");
  fullscreenBtn.className = "btn btn-sm trunk-fullscreen-toggle";
  fullscreenBtn.textContent = "⛶ Fullscreen";

  function syncFullscreenLabel(active) {
    fullscreenBtn.textContent = active ? "⛶ Exit Fullscreen" : "⛶ Fullscreen";
  }

  fullscreenBtn.addEventListener("click", async () => {
    // Try native fullscreen first
    if (canFullscreen) {
      try {
        if (document.fullscreenElement === root) {
          await document.exitFullscreen();
        } else {
          await root.requestFullscreen();
        }
        return; // onFullscreenChange handles the rest
      } catch (_) {
        // Blocked (iframe sandbox) — fall through to CSS mode
      }
    }
    // CSS maximized fallback
    isMaximized = !isMaximized;
    root.classList.toggle("trunk-activity--fullscreen", isMaximized);
    syncFullscreenLabel(isMaximized);
  });

  // Native fullscreen events
  function onFullscreenChange() {
    const isFs = document.fullscreenElement === root;
    root.classList.toggle("trunk-activity--fullscreen", isFs);
    syncFullscreenLabel(isFs);
    isMaximized = isFs;
  }
  document.addEventListener("fullscreenchange", onFullscreenChange);

  // Esc key for CSS maximized fallback (native fullscreen handles Esc itself)
  function onEscKey(e) {
    if (e.key === "Escape" && isMaximized && !document.fullscreenElement) {
      isMaximized = false;
      root.classList.remove("trunk-activity--fullscreen");
      syncFullscreenLabel(false);
    }
  }
  document.addEventListener("keydown", onEscKey);

  // Open in new tab button (true fullscreen possible outside iframe)
  const popoutBtn = document.createElement("button");
  popoutBtn.className = "btn btn-sm trunk-popout-toggle";
  popoutBtn.textContent = "↗ Open in new tab";
  popoutBtn.addEventListener("click", () => {
    window.open(window.location.href, "_blank");
  });

  header.append(fullscreenBtn, popoutBtn);

  root.append(header, warningBanner, filterSection, graphSection, tableSection);

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
      tbody.innerHTML = `<tr><td colspan="5" class="trunk-empty">Select one or more trunks above</td></tr>`;
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

        return `<tr>
          <td>${escapeHtml(trunk._cleanName)}</td>
          <td><span class="trunk-dot trunk-dot--${status.color}"></span> ${escapeHtml(status.label)}</td>
          <td>${escapeHtml(String(inbound))}</td>
          <td>${escapeHtml(String(outbound))}</td>
          <td>${escapeHtml(String(total))}</td>
        </tr>`;
      })
      .join("");

    // ── Total footer row ──────────────────────────────────
    let sumIn = 0, sumOut = 0, hasAny = false;
    for (const { m } of rows) {
      const ib = m?.calls?.inboundCallCount;
      const ob = m?.calls?.outboundCallCount;
      if (typeof ib === "number") { sumIn += ib; hasAny = true; }
      if (typeof ob === "number") { sumOut += ob; hasAny = true; }
    }
    tbody.innerHTML += `<tr class="trunk-total-row${breached ? ' trunk-total-row--warn' : ''}">
      <td><strong>Total</strong></td>
      <td></td>
      <td><strong>${hasAny ? sumIn : "—"}</strong></td>
      <td><strong>${hasAny ? sumOut : "—"}</strong></td>
      <td><strong>${hasAny ? sumIn + sumOut : "—"}</strong></td>
    </tr>`;

    // ── Threshold check ─────────────────────────────────
    checkThreshold(hasAny ? sumIn + sumOut : 0);
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

  // ── Threshold warning logic ──────────────────────────────
  let breached = false;

  function checkThreshold(totalCalls) {
    const nowBreached = CALL_THRESHOLD > 0 && totalCalls >= CALL_THRESHOLD;

    if (nowBreached && !breached) {
      // Started breaching
      breached = true;
      warningBanner.textContent = `⚠ THRESHOLD EXCEEDED: ${totalCalls} / ${CALL_THRESHOLD} concurrent calls`;
      warningBanner.classList.remove("hidden");
      startTabFlash(totalCalls);
    } else if (nowBreached && breached) {
      // Still breaching — update numbers
      warningBanner.textContent = `⚠ THRESHOLD EXCEEDED: ${totalCalls} / ${CALL_THRESHOLD} concurrent calls`;
      updateTabFlash(totalCalls);
    } else if (!nowBreached && breached) {
      // Recovered
      breached = false;
      warningBanner.classList.add("hidden");
      stopTabFlash();
    }
  }

  function startTabFlash(totalCalls) {
    stopTabFlash();
    let show = true;
    tabFlashTimer = setInterval(() => {
      document.title = show ? `⚠ ${totalCalls} CALLS — Threshold Exceeded` : originalTitle;
      show = !show;
    }, 1000);
  }

  function updateTabFlash(totalCalls) {
    // Restart with updated count
    if (tabFlashTimer) startTabFlash(totalCalls);
  }

  function stopTabFlash() {
    if (tabFlashTimer) {
      clearInterval(tabFlashTimer);
      tabFlashTimer = null;
    }
    document.title = originalTitle;
  }

  // ── Graph trunk picker ──────────────────────────────────
  function renderGraphPicker() {
    graphPickerList.innerHTML = "";

    // "All" checkbox
    const allLabel = document.createElement("label");
    allLabel.className = "trunk-graph-picker-item";
    const allCb = document.createElement("input");
    allCb.type = "checkbox";
    allCb.checked = chartTrunkIds.size === 0;  // "All" when no specific trunks chosen
    allCb.addEventListener("change", () => {
      chartTrunkIds.clear();
      renderGraphPicker();
      if (chartVisible) renderChart();
    });
    const allSpan = document.createElement("span");
    allSpan.textContent = "All (combined)";
    allLabel.append(allCb, allSpan);
    graphPickerList.append(allLabel);

    // Per-trunk checkboxes (only those currently selected in the filter)
    for (const id of selectedIds) {
      const trunk = allTrunks.find((t) => t.id === id);
      if (!trunk) continue;
      const label = document.createElement("label");
      label.className = "trunk-graph-picker-item";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = chartTrunkIds.has(id);
      cb.addEventListener("change", () => {
        if (cb.checked) chartTrunkIds.add(id);
        else chartTrunkIds.delete(id);
        // If nothing specific is selected, revert to "All"
        renderGraphPicker();
        if (chartVisible) renderChart();
      });
      const span = document.createElement("span");
      span.textContent = trunk._cleanName;
      label.append(cb, span);
      graphPickerList.append(label);
    }
  }

  // ── Chart rendering ─────────────────────────────────────
  function pushChartData() {
    const ts = new Date();
    const perTrunk = {};
    let total = 0;
    for (const id of selectedIds) {
      const m = metricsMap.get(id);
      const ib = m?.calls?.inboundCallCount || 0;
      const ob = m?.calls?.outboundCallCount || 0;
      const sum = ib + ob;
      perTrunk[id] = sum;
      total += sum;
    }
    chartHistory.push({ ts, perTrunk, total });
    if (chartHistory.length > CHART_HISTORY_MAX) {
      chartHistory = chartHistory.slice(-CHART_HISTORY_MAX);
    }
  }

  function renderChart() {
    if (!chartVisible || !chartHistory.length) return;
    const Chart = window.Chart;
    if (!Chart) { console.warn("Chart.js not loaded"); return; }

    const labels = chartHistory.map((p) =>
      p.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    );

    let datasets;
    if (chartTrunkIds.size === 0) {
      // "All" mode — single combined line
      datasets = [{
        label: "Total Concurrent Calls",
        data: chartHistory.map((p) => p.total),
        borderColor: CHART_COLOURS[0],
        backgroundColor: CHART_COLOURS[0] + "33",
        fill: true,
        tension: 0.3,
        pointRadius: 2,
      }];
    } else {
      // Per-trunk lines
      let ci = 0;
      datasets = [...chartTrunkIds].map((id) => {
        const trunk = allTrunks.find((t) => t.id === id);
        const colour = CHART_COLOURS[ci++ % CHART_COLOURS.length];
        return {
          label: trunk?._cleanName || id,
          data: chartHistory.map((p) => p.perTrunk[id] ?? 0),
          borderColor: colour,
          backgroundColor: colour + "33",
          fill: false,
          tension: 0.3,
          pointRadius: 2,
        };
      });
    }

    // Threshold reference line
    if (CALL_THRESHOLD > 0) {
      datasets.push({
        label: `Threshold (${CALL_THRESHOLD})`,
        data: chartHistory.map(() => CALL_THRESHOLD),
        borderColor: "#ef4444",
        borderDash: [6, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
      });
    }

    if (chartInstance) {
      chartInstance.data.labels = labels;
      chartInstance.data.datasets = datasets;
      chartInstance.update("none");
    } else {
      chartInstance = new Chart(canvas, {
        type: "line",
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { position: "bottom", labels: { color: "#93a4b8", boxWidth: 12 } },
          },
          scales: {
            x: {
              ticks: { color: "#93a4b8", maxTicksLimit: 12 },
              grid: { color: "rgba(255,255,255,0.06)" },
            },
            y: {
              beginAtZero: true,
              ticks: { color: "#93a4b8", precision: 0 },
              grid: { color: "rgba(255,255,255,0.06)" },
            },
          },
        },
      });
    }
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
    pushChartData();
    renderTable();
    if (chartVisible) renderChart();
  }

  // ── Selection changed → update subscriptions + fetch ────
  function onSelectionChanged() {
    renderGraphPicker();
    // Remove any graph-selected trunks that are no longer in the filter
    for (const id of chartTrunkIds) {
      if (!selectedIds.has(id)) chartTrunkIds.delete(id);
    }
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

    pushChartData();
    renderTable();
    if (chartVisible) renderChart();
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
    renderGraphPicker();
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

        // Only poll when WebSocket is not connected
        if (state === "connected") {
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        } else {
          if (!pollTimer) {
            pollTimer = setInterval(() => {
              if (selectedIds.size) fetchMetrics();
            }, POLL_INTERVAL_MS);
            // Fetch immediately on fallback start
            if (selectedIds.size) fetchMetrics();
          }
        }
      },
      pollFn: fetchMetrics,
      pollInterval: POLL_INTERVAL_MS,
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
      if (pollTimer) clearInterval(pollTimer);
      stopTabFlash();
      if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
      document.removeEventListener("keydown", onEscKey);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
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
