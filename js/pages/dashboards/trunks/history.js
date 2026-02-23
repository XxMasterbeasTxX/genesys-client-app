/**
 * Dashboards › Trunks › History
 *
 * Shows historical peak concurrent-call data collected by the
 * Azure Function timer (collectTrunkMetrics).
 * Fetches time-series from the getTrunkHistory HTTP function.
 */
import { CONFIG } from "../../../config.js";
import { escapeHtml } from "../../../utils.js";
import {
  DEFAULT_RANGE_DAYS,
  CHART_MAX_POINTS,
  CHART_LINE_COLOUR,
  CHART_PEAK_COLOUR,
} from "./historyConfig.js";

/* ── Helpers ───────────────────────────────────────────── */

/** Return Date for start-of-today (UTC). */
function todayUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Return Date for now (end of range). */
function nowUTC() {
  return new Date();
}

/** Downsample an array to at most `max` evenly-spaced items. */
function downsample(arr, max) {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out = [];
  for (let i = 0; i < max; i++) {
    out.push(arr[Math.floor(i * step)]);
  }
  // Always include the last point
  if (out[out.length - 1] !== arr[arr.length - 1]) {
    out.push(arr[arr.length - 1]);
  }
  return out;
}

/** Format a Date to a short readable string. */
function fmtDate(d) {
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ── Main render ───────────────────────────────────────── */

export async function render() {
  let chartInstance = null;
  let rawData = []; // fetched rows

  // ── DOM skeleton ──────────────────────────────────────
  const root = document.createElement("div");
  root.className = "trunk-history";

  // Header
  const header = document.createElement("div");
  header.className = "trunk-history-header";
  header.innerHTML = `<h2>Trunk History</h2>`;

  // Range toolbar
  const toolbar = document.createElement("div");
  toolbar.className = "trunk-history-toolbar";

  const presets = [
    { label: "Today", days: 0 },
    { label: "7 days", days: 7 },
    { label: "30 days", days: 30 },
    { label: "90 days", days: 90 },
  ];

  const presetBtns = presets.map(({ label, days }) => {
    const btn = document.createElement("button");
    btn.className = "btn btn-sm trunk-history-preset";
    btn.textContent = label;
    btn.dataset.days = days;
    btn.addEventListener("click", () => loadRange(days));
    return btn;
  });

  // Custom date inputs
  const fromInput = document.createElement("input");
  fromInput.type = "date";
  fromInput.className = "trunk-history-date";
  const toInput = document.createElement("input");
  toInput.type = "date";
  toInput.className = "trunk-history-date";

  const customBtn = document.createElement("button");
  customBtn.className = "btn btn-sm trunk-history-preset";
  customBtn.textContent = "Apply";
  customBtn.addEventListener("click", () => {
    if (fromInput.value && toInput.value) {
      const from = new Date(fromInput.value + "T00:00:00Z");
      const to = new Date(toInput.value + "T23:59:59Z");
      fetchAndRender(from, to);
      setActivePreset(null);
    }
  });

  toolbar.append(...presetBtns, fromInput, toInput, customBtn);

  // Status / loading
  const statusEl = document.createElement("div");
  statusEl.className = "trunk-history-status";

  // Stats cards
  const statsRow = document.createElement("div");
  statsRow.className = "trunk-history-stats";

  // Chart container
  const chartWrap = document.createElement("div");
  chartWrap.className = "trunk-history-chart-wrap";
  const canvas = document.createElement("canvas");
  canvas.id = "trunkHistoryCanvas";
  chartWrap.append(canvas);

  root.append(header, toolbar, statusEl, statsRow, chartWrap);

  // ── Preset highlighting ─────────────────────────────────
  function setActivePreset(days) {
    for (const btn of presetBtns) {
      btn.classList.toggle(
        "trunk-history-preset--active",
        btn.dataset.days === String(days),
      );
    }
  }

  // ── Load a preset range ─────────────────────────────────
  function loadRange(days) {
    const to = nowUTC();
    const from = days === 0 ? todayUTC() : new Date(to.getTime() - days * 86_400_000);
    fromInput.value = from.toISOString().slice(0, 10);
    toInput.value = to.toISOString().slice(0, 10);
    setActivePreset(days);
    fetchAndRender(from, to);
  }

  // ── Fetch data + render chart ───────────────────────────
  async function fetchAndRender(from, to) {
    statusEl.textContent = "Loading…";
    statsRow.innerHTML = "";

    try {
      const url =
        `${CONFIG.functionsBase}/api/getTrunkHistory` +
        `?from=${from.toISOString()}&to=${to.toISOString()}`;

      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body}`);
      }

      const json = await res.json();
      rawData = json.data || [];

      if (!rawData.length) {
        statusEl.textContent =
          "No data for this period. The collector may not have run yet.";
        destroyChart();
        return;
      }

      statusEl.textContent = `${rawData.length} data point(s)`;
      renderStats(rawData);
      renderChart(rawData);
    } catch (err) {
      console.error("Trunk history fetch failed:", err);
      statusEl.textContent = `Error: ${err.message}`;
      destroyChart();
    }
  }

  // ── Stats cards ─────────────────────────────────────────
  function renderStats(data) {
    let peak = 0;
    let peakTs = "";
    let sum = 0;

    for (const row of data) {
      const tc = row.totalCalls ?? 0;
      sum += tc;
      if (tc > peak) {
        peak = tc;
        peakTs = row.timestamp;
      }
    }

    const avg = data.length ? (sum / data.length).toFixed(1) : "0";
    const peakTime = peakTs ? fmtDate(new Date(peakTs)) : "—";

    statsRow.innerHTML = `
      <div class="trunk-history-stat">
        <div class="trunk-history-stat__value">${escapeHtml(String(peak))}</div>
        <div class="trunk-history-stat__label">Peak Concurrent Calls</div>
      </div>
      <div class="trunk-history-stat">
        <div class="trunk-history-stat__value">${escapeHtml(peakTime)}</div>
        <div class="trunk-history-stat__label">Peak Occurred</div>
      </div>
      <div class="trunk-history-stat">
        <div class="trunk-history-stat__value">${escapeHtml(avg)}</div>
        <div class="trunk-history-stat__label">Avg Concurrent Calls</div>
      </div>
      <div class="trunk-history-stat">
        <div class="trunk-history-stat__value">${escapeHtml(String(data.length))}</div>
        <div class="trunk-history-stat__label">Samples</div>
      </div>
    `;
  }

  // ── Chart rendering ─────────────────────────────────────
  function renderChart(data) {
    const Chart = window.Chart;
    if (!Chart) {
      statusEl.textContent = "Chart.js not loaded.";
      return;
    }

    // Downsample for large ranges
    const plotData = downsample(data, CHART_MAX_POINTS);

    // Find peak index for annotation
    let peakIdx = 0;
    for (let i = 1; i < plotData.length; i++) {
      if ((plotData[i].totalCalls ?? 0) > (plotData[peakIdx].totalCalls ?? 0)) {
        peakIdx = i;
      }
    }

    const labels = plotData.map((r) => {
      const d = new Date(r.timestamp);
      // Show date+time for multi-day, time-only for single day
      return plotData.length < 300
        ? d.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    });

    const values = plotData.map((r) => r.totalCalls ?? 0);

    // Point colours — highlight the peak
    const pointBg = values.map((_, i) =>
      i === peakIdx ? CHART_PEAK_COLOUR : CHART_LINE_COLOUR,
    );
    const pointRadius = values.map((_, i) => (i === peakIdx ? 6 : 1));

    const datasets = [
      {
        label: "Concurrent Calls",
        data: values,
        borderColor: CHART_LINE_COLOUR,
        backgroundColor: CHART_LINE_COLOUR + "22",
        fill: true,
        tension: 0.3,
        pointBackgroundColor: pointBg,
        pointRadius,
        pointHoverRadius: 5,
      },
    ];

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
            legend: {
              display: false,
            },
            tooltip: {
              callbacks: {
                title: (items) => {
                  const idx = items[0]?.dataIndex;
                  if (idx == null) return "";
                  const d = new Date(plotData[idx].timestamp);
                  return fmtDate(d);
                },
              },
            },
          },
          scales: {
            x: {
              ticks: { color: "#93a4b8", maxTicksLimit: 14, maxRotation: 45 },
              grid: { color: "rgba(255,255,255,0.06)" },
            },
            y: {
              beginAtZero: true,
              title: { display: true, text: "Concurrent Calls", color: "#93a4b8" },
              ticks: { color: "#93a4b8", precision: 0 },
              grid: { color: "rgba(255,255,255,0.06)" },
            },
          },
        },
      });
    }
  }

  function destroyChart() {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
  }

  // ── Cleanup on navigation ──────────────────────────────
  const observer = new MutationObserver(() => {
    if (!root.isConnected) {
      destroyChart();
      observer.disconnect();
    }
  });
  requestAnimationFrame(() => {
    if (root.parentElement) {
      observer.observe(root.parentElement, { childList: true });
    }
  });

  // ── Initial load ────────────────────────────────────────
  loadRange(DEFAULT_RANGE_DAYS);

  return root;
}
