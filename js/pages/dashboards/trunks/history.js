/**
 * Dashboards › Trunks › History
 *
 * Shows historical trunk call data collected by the
 * Azure Function timer (collectTrunkMetrics).
 *
 * Uses server-side aggregation:
 *   Today       → raw 1-min samples
 *   2–7 days    → hourly buckets  (peak + avg per hour)
 *   8–90+ days  → daily  buckets  (peak + avg per day)
 */
import { CONFIG } from "../../../config.js";
import { escapeHtml } from "../../../utils.js";
import {
  DEFAULT_RANGE_DAYS,
  CHART_LINE_COLOUR,
  CHART_AVG_COLOUR,
  CHART_PEAK_COLOUR,
  LABEL_FORMAT_RAW,
  LABEL_FORMAT_HOUR,
  LABEL_FORMAT_DAY,
  TOOLTIP_DATE_FORMAT,
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

/** Choose the right aggregation bucket for a date range. */
function chooseBucket(from, to) {
  const days = (to - from) / 86_400_000;
  if (days <= 1) return "raw";
  if (days <= 7) return "hour";
  return "day";
}

/** Format a Date to a short readable string (tooltip). */
function fmtDate(d) {
  return d.toLocaleDateString(undefined, TOOLTIP_DATE_FORMAT);
}

/** Format a Date as an x-axis label, adapted to the bucket size. */
function fmtLabel(d, bucket) {
  const formats = { raw: LABEL_FORMAT_RAW, hour: LABEL_FORMAT_HOUR, day: LABEL_FORMAT_DAY };
  return d.toLocaleString(undefined, formats[bucket] || formats.day);
}

/* ── Main render ───────────────────────────────────────── */

export async function render() {
  let chartInstance = null;
  let plotData = [];       // data currently shown in the chart
  let currentBucket = "raw";

  // Re-render chart when OS theme changes so colours update
  const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
  themeMedia.addEventListener("change", () => {
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    if (plotData.length) renderChart(plotData, currentBucket);
  });

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

    const bucket = chooseBucket(from, to);
    currentBucket = bucket;

    try {
      const url =
        `${CONFIG.functionsBase}/api/getTrunkHistory` +
        `?from=${from.toISOString()}&to=${to.toISOString()}&bucket=${bucket}`;

      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body}`);
      }

      const json = await res.json();
      plotData = json.data || [];

      if (!plotData.length) {
        statusEl.textContent =
          "No data for this period. The collector may not have run yet.";
        destroyChart();
        return;
      }

      const bucketLabel = bucket === "raw" ? "samples" : `${bucket}ly buckets`;
      statusEl.textContent = `${plotData.length} ${bucketLabel}`;

      renderStats(plotData, bucket);
      renderChart(plotData, bucket);
    } catch (err) {
      console.error("Trunk history fetch failed:", err);
      statusEl.textContent = `Error: ${err.message}`;
      destroyChart();
    }
  }

  // ── Stats cards ─────────────────────────────────────────
  function renderStats(data, bucket) {
    let peak = 0;
    let peakTs = "";
    let sum = 0;
    let totalSamples = 0;

    for (const row of data) {
      // "raw" rows have totalCalls; aggregated rows have peakCalls + avgCalls
      const tc = row.peakCalls ?? row.totalCalls ?? 0;
      const avg = row.avgCalls ?? row.totalCalls ?? 0;
      const samples = row.samples ?? 1;

      if (tc > peak) {
        peak = tc;
        peakTs = row.timestamp;
      }
      sum += avg * samples;
      totalSamples += samples;
    }

    const avg = totalSamples ? (sum / totalSamples).toFixed(1) : "0";
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
        <div class="trunk-history-stat__value">${escapeHtml(String(totalSamples))}</div>
        <div class="trunk-history-stat__label">Total Samples</div>
      </div>
    `;
  }

  // ── Chart rendering ─────────────────────────────────────
  function renderChart(data, bucket) {
    const Chart = window.Chart;
    if (!Chart) {
      statusEl.textContent = "Chart.js not loaded.";
      return;
    }

    const isRaw = bucket === "raw";

    // Axis labels
    const labels = data.map((r) => fmtLabel(new Date(r.timestamp), bucket));

    // Primary values → peak (aggregated) or totalCalls (raw)
    const peakValues = data.map((r) => r.peakCalls ?? r.totalCalls ?? 0);

    // Find peak index for highlighted dot
    let peakIdx = 0;
    for (let i = 1; i < peakValues.length; i++) {
      if (peakValues[i] > peakValues[peakIdx]) peakIdx = i;
    }

    const pointBg = peakValues.map((_, i) =>
      i === peakIdx ? CHART_PEAK_COLOUR : CHART_LINE_COLOUR,
    );
    const pointRadius = peakValues.map((_, i) => (i === peakIdx ? 6 : 1));

    const datasets = [
      {
        label: isRaw ? "Concurrent Calls" : "Peak Calls",
        data: peakValues,
        borderColor: CHART_LINE_COLOUR,
        backgroundColor: CHART_LINE_COLOUR + "22",
        fill: true,
        tension: 0.3,
        pointBackgroundColor: pointBg,
        pointRadius,
        pointHoverRadius: 5,
      },
    ];

    // Add average line for aggregated data
    if (!isRaw) {
      const avgValues = data.map((r) => r.avgCalls ?? 0);
      datasets.push({
        label: "Avg Calls",
        data: avgValues,
        borderColor: CHART_AVG_COLOUR + "88",
        backgroundColor: "transparent",
        borderDash: [6, 4],
        borderWidth: 1.5,
        fill: false,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
      });
    }

    // Theme-aware chart metadata colours
    const cs = getComputedStyle(document.documentElement);
    const cText = cs.getPropertyValue("--chart-text").trim() || "#93a4b8";
    const cGrid = cs.getPropertyValue("--chart-grid").trim() || "rgba(255,255,255,0.06)";

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
              display: !isRaw,
              position: "bottom",
              labels: { color: cText, boxWidth: 12 },
            },
            tooltip: {
              callbacks: {
                title: (items) => {
                  const idx = items[0]?.dataIndex;
                  if (idx == null) return "";
                  const d = new Date(data[idx].timestamp);
                  return fmtDate(d);
                },
                afterBody: (items) => {
                  const idx = items[0]?.dataIndex;
                  if (idx == null || isRaw) return "";
                  const row = data[idx];
                  return row.samples ? `Samples: ${row.samples}` : "";
                },
              },
            },
          },
          scales: {
            x: {
              ticks: { color: cText, maxTicksLimit: 14, maxRotation: 45 },
              grid: { color: cGrid },
            },
            y: {
              beginAtZero: true,
              title: { display: true, text: "Concurrent Calls", color: cText },
              ticks: { color: cText, precision: 0 },
              grid: { color: cGrid },
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
