/**
 * Dashboards › Agent Copilot › Agent Checklists
 *
 * Historical view of interactions that used Agent Copilot checklists.
 *
 * Filter flow:
 *   1. Select copilot(s)        → cascades available queues
 *   2. Select queue(s)          → required before search
 *   3. Choose period            → presets or custom dates
 *   4. Search                   → analytics detail query
 *   5. Status filter            → client-side (All / Completed / Incomplete)
 *   6. Click row                → drill-down to checklist items
 *
 * Data enrichment:
 *   After table renders, checklists are fetched in background batches
 *   to populate the Checklist column and enable status filtering.
 */
import { escapeHtml } from "../../../utils.js";
import { createMultiSelect } from "../../../components/multiSelect.js";
import {
  DEFAULT_RANGE_DAYS,
  RANGE_PRESETS,
  MAX_INTERVAL_DAYS,
  QUERY_PAGE_SIZE,
  ENRICHMENT_BATCH,
  QUEUE_RESOLVE_BATCH,
  MS_PER_DAY,
  MEDIA_KEYS,
  PURPOSE_AGENT,
  METRIC_HANDLE_TIME,
  TICK_STATE,
  STATUS_FILTER,
  TABLE_DATE_FORMAT,
} from "./checklistConfig.js";

/* ── Helpers ───────────────────────────────────────────── */

function todayUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function fmtDate(d) {
  return d.toLocaleString(undefined, TABLE_DATE_FORMAT);
}

/** Format milliseconds as m:ss or h:mm:ss. */
function fmtDuration(ms) {
  if (!ms || ms <= 0) return "—";
  const totalSecs = Math.round(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Extract handle time from a participant's session metrics.
 * Falls back to 0 if not found.
 */
function extractDuration(participant) {
  for (const sess of participant.sessions ?? []) {
    for (const metric of sess.metrics ?? []) {
      if (metric.name === METRIC_HANDLE_TIME && metric.value) return metric.value;
    }
  }
  return 0;
}

/** Find the agent participant in an analytics conversation record. */
function findAgentParticipant(conv) {
  return (conv.participants ?? []).find((p) => p.purpose === PURPOSE_AGENT);
}

/** Find the queueId from a participant's sessions/segments. */
function extractQueueId(participant) {
  for (const sess of participant.sessions ?? []) {
    for (const seg of sess.segments ?? []) {
      if (seg.queueId) return seg.queueId;
    }
    if (sess.queueId) return sess.queueId;
  }
  return null;
}

/** Find mediaType from a participant's sessions. */
function extractMediaType(participant) {
  for (const sess of participant.sessions ?? []) {
    if (sess.mediaType) return sess.mediaType;
  }
  return null;
}

/**
 * Determine completion across ALL checklists: "complete" only if
 * every item in every checklist is ticked (by agent or model).
 */
function checklistCompletion(checklists) {
  const all = (Array.isArray(checklists) ? checklists : [checklists]).filter(Boolean);
  const items = all.flatMap((cl) => cl.checklistItems ?? []);
  if (!items.length) return null;
  const allTicked = items.every(
    (it) => it.stateFromAgent === TICK_STATE.TICKED || it.stateFromModel === TICK_STATE.TICKED,
  );
  return allTicked ? STATUS_FILTER.COMPLETE : STATUS_FILTER.INCOMPLETE;
}

/* ── Main render ───────────────────────────────────────── */

export async function render({ route, me, api }) {
  // ── State ──────────────────────────────────────────────
  let conversations = [];         // analytics detail records
  const enriched = new Map();     // convId → { checklists, communicationId, completion }
  const queueNameCache = new Map(); // queueId → name
  const userNameCache = new Map();  // userId → name
  let statusFilter = STATUS_FILTER.ALL;
  let enrichAbort = null;          // AbortController for in-flight enrichment
  let expandedRowId = null;       // conversationId currently drilled-down

  // ── DOM skeleton ───────────────────────────────────────
  const root = document.createElement("div");
  root.className = "checklist-view";

  // Header
  const header = document.createElement("div");
  header.className = "checklist-header";
  header.innerHTML = `<h2>Agent Checklists</h2>`;

  // ── Filter bar ─────────────────────────────────────────
  const filterBar = document.createElement("div");
  filterBar.className = "checklist-filters";

  // Copilot multi-select (with label wrapper)
  const copilotWrap = document.createElement("div");
  copilotWrap.className = "checklist-filter-group";
  const copilotLabel = document.createElement("label");
  copilotLabel.className = "checklist-filter-label";
  copilotLabel.textContent = "Agent Copilots";
  const copilotMs = createMultiSelect({
    placeholder: "Select copilot(s)…",
    onChange: onCopilotSelectionChanged,
  });
  copilotWrap.append(copilotLabel, copilotMs.el);

  // Queue multi-select (cascaded from copilot, with label)
  const queueWrap = document.createElement("div");
  queueWrap.className = "checklist-filter-group";
  const queueLabel = document.createElement("label");
  queueLabel.className = "checklist-filter-label";
  queueLabel.textContent = "Queues";
  const queueMs = createMultiSelect({
    placeholder: "Select queue(s)…",
    onChange: onQueueSelectionChanged,
  });
  queueMs.setEnabled(false);
  queueWrap.append(queueLabel, queueMs.el);

  // Agent multi-select (cascaded from queue, with label)
  const agentWrap = document.createElement("div");
  agentWrap.className = "checklist-filter-group";
  const agentLabel = document.createElement("label");
  agentLabel.className = "checklist-filter-label";
  agentLabel.textContent = "Agents";
  const agentMs = createMultiSelect({
    placeholder: "Select agent(s)…",
    onChange: () => {},
  });
  agentMs.setEnabled(false);
  agentWrap.append(agentLabel, agentMs.el);

  // Period toolbar
  const periodWrap = document.createElement("div");
  periodWrap.className = "checklist-period";

  const presetBtns = RANGE_PRESETS.map(({ label, days }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-sm checklist-preset";
    btn.textContent = label;
    btn.dataset.days = days;
    btn.addEventListener("click", () => loadRange(days));
    return btn;
  });

  const fromInput = document.createElement("input");
  fromInput.type = "date";
  fromInput.className = "checklist-date";
  const toInput = document.createElement("input");
  toInput.type = "date";
  toInput.className = "checklist-date";

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "btn btn-sm checklist-preset";
  applyBtn.textContent = "Apply";
  applyBtn.addEventListener("click", () => {
    if (fromInput.value && toInput.value) {
      setActivePreset(null);
      doSearch(
        new Date(fromInput.value + "T00:00:00Z"),
        new Date(toInput.value + "T23:59:59Z"),
      );
    }
  });

  periodWrap.append(...presetBtns, fromInput, toInput, applyBtn);

  // Search button
  const searchBtn = document.createElement("button");
  searchBtn.type = "button";
  searchBtn.className = "btn btn-sm checklist-search-btn";
  searchBtn.textContent = "🔍 Search";
  searchBtn.addEventListener("click", () => {
    if (fromInput.value && toInput.value) {
      doSearch(
        new Date(fromInput.value + "T00:00:00Z"),
        new Date(toInput.value + "T23:59:59Z"),
      );
    }
  });

  filterBar.append(copilotWrap, queueWrap, agentWrap, periodWrap, searchBtn);

  // ── Status filter bar ──────────────────────────────────
  const statusBar = document.createElement("div");
  statusBar.className = "checklist-status-bar";

  const statusBtns = [
    { val: STATUS_FILTER.ALL, label: "All" },
    { val: STATUS_FILTER.COMPLETE, label: "✅ Completed" },
    { val: STATUS_FILTER.INCOMPLETE, label: "⚠️ Incomplete" },
  ].map(({ val, label }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-sm checklist-status-btn";
    btn.textContent = label;
    btn.dataset.status = val;
    btn.addEventListener("click", () => {
      statusFilter = val;
      syncStatusButtons();
      applyTableFilter();
    });
    return btn;
  });
  statusBar.append(...statusBtns);

  // Export Excel button (hidden until enrichment completes)
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "btn btn-sm checklist-export-btn";
  exportBtn.textContent = "⬇ Export Excel";
  exportBtn.hidden = true;
  exportBtn.addEventListener("click", exportToExcel);
  statusBar.append(exportBtn);

  function syncStatusButtons() {
    for (const btn of statusBtns) {
      btn.classList.toggle(
        "checklist-status-btn--active",
        btn.dataset.status === statusFilter,
      );
    }
  }
  syncStatusButtons();

  // ── Status / loading line ──────────────────────────────
  const statusEl = document.createElement("div");
  statusEl.className = "checklist-status";

  // ── Table ──────────────────────────────────────────────
  const tableWrap = document.createElement("div");
  tableWrap.className = "checklist-table-wrap";

  // ── Drill-down panel ───────────────────────────────────
  const drillPanel = document.createElement("div");
  drillPanel.className = "checklist-drilldown";
  drillPanel.hidden = true;

  root.append(header, filterBar, statusBar, statusEl, tableWrap, drillPanel);

  // ── Preset highlighting ────────────────────────────────
  function setActivePreset(days) {
    for (const btn of presetBtns) {
      btn.classList.toggle(
        "checklist-preset--active",
        btn.dataset.days === String(days),
      );
    }
  }

  // ── Load a preset range ────────────────────────────────
  function loadRange(days) {
    const to = new Date();
    const from =
      days === 0 ? todayUTC() : new Date(to.getTime() - days * MS_PER_DAY);
    fromInput.value = from.toISOString().slice(0, 10);
    toInput.value = to.toISOString().slice(0, 10);
    setActivePreset(days);
    doSearch(from, to);
  }

  // ── Copilot selection changed → cascade queues ─────────
  async function onCopilotSelectionChanged(selectedIds) {
    queueMs.setEnabled(false);
    queueMs.setItems([]);
    agentMs.setEnabled(false);
    agentMs.setItems([]);

    if (!selectedIds.size) return;

    try {
      // Fetch queues for every selected assistant in parallel
      const results = await Promise.all(
        [...selectedIds].map((id) => api.getAssistantQueues(id)),
      );

      // Collect unique queue IDs
      const queueIdSet = new Set();
      for (const queues of results) {
        for (const q of queues) queueIdSet.add(q.id);
      }

      if (!queueIdSet.size) {
        queueMs.setItems([]);
        statusEl.textContent = "No queues assigned to the selected copilot(s).";
        return;
      }

      // Resolve queue names (parallel, with cache)
      const queueItems = await resolveQueueNames([...queueIdSet]);
      queueMs.setItems(queueItems);
      queueMs.setEnabled(true);
    } catch (err) {
      console.error("Failed to load assistant queues:", err);
      statusEl.textContent = `Error loading queues: ${err.message}`;
    }
  }

  /** Resolve an array of queue IDs to [{ id, label }], using cache. */
  async function resolveQueueNames(ids) {
    const uncached = ids.filter((id) => !queueNameCache.has(id));

    // Fetch uncached in parallel batches
    for (let i = 0; i < uncached.length; i += QUEUE_RESOLVE_BATCH) {
      const batch = uncached.slice(i, i + QUEUE_RESOLVE_BATCH);
      const results = await Promise.allSettled(
        batch.map((id) => api.getQueue(id)),
      );
      results.forEach((r, idx) => {
        const name =
          r.status === "fulfilled" && r.value?.name
            ? r.value.name
            : batch[idx];
        queueNameCache.set(batch[idx], name);
      });
    }

    return ids.map((id) => ({ id, label: queueNameCache.get(id) ?? id }));
  }

  // ── Queue selection changed → cascade agents ───────────
  async function onQueueSelectionChanged(selectedQueueIds) {
    agentMs.setEnabled(false);
    agentMs.setItems([]);

    if (!selectedQueueIds.size) return;

    try {
      const results = await Promise.all(
        [...selectedQueueIds].map((id) => api.getQueueMembers(id)),
      );

      // Collect unique agents across all selected queues
      const agentMap = new Map();
      for (const members of results) {
        for (const m of members) {
          const userId = m.id ?? m.user?.id;
          const userName = m.name ?? m.user?.name ?? userId;
          if (userId) {
            agentMap.set(userId, userName);
            userNameCache.set(userId, userName);
          }
        }
      }

      if (!agentMap.size) {
        statusEl.textContent = "No agents found in the selected queue(s).";
        return;
      }

      const sorted = [...agentMap.entries()]
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
      agentMs.setItems(sorted);
      agentMs.setEnabled(true);
    } catch (err) {
      console.error("Failed to load queue members:", err);
      statusEl.textContent = `Error loading agents: ${err.message}`;
    }
  }

  // ── Search: query analytics ────────────────────────────
  async function doSearch(from, to) {
    const copilotIds = copilotMs.getSelected();
    const queueIds = queueMs.getSelected();
    const agentIds = agentMs.getSelected();

    if (!copilotIds.size) {
      statusEl.textContent = "Please select at least one copilot.";
      return;
    }
    if (!queueIds.size) {
      statusEl.textContent = "Please select at least one queue.";
      return;
    }

    // Validate interval does not exceed API limit
    const intervalMs = to.getTime() - from.getTime();
    const intervalDays = intervalMs / MS_PER_DAY;
    if (intervalDays > MAX_INTERVAL_DAYS) {
      statusEl.textContent =
        `The selected period spans ${Math.ceil(intervalDays)} days. ` +
        `Maximum allowed is ${MAX_INTERVAL_DAYS} days.`;
      return;
    }

    statusEl.textContent = "Loading…";
    tableWrap.innerHTML = "";
    exportBtn.hidden = true;
    drillPanel.hidden = true;
    expandedRowId = null;
    conversations = [];
    enriched.clear();

    // Cancel any in-flight enrichment from a previous search
    if (enrichAbort) enrichAbort.abort();
    enrichAbort = new AbortController();

    const interval = `${from.toISOString()}/${to.toISOString()}`;

    // Build segment filter predicates
    const copilotPredicates = [...copilotIds].map((id) => ({
      dimension: "agentAssistantId",
      value: id,
    }));
    const queuePredicates = [...queueIds].map((id) => ({
      dimension: "queueId",
      value: id,
    }));

    const segmentFilters = [
      { type: "or", predicates: copilotPredicates },
      { type: "or", predicates: queuePredicates },
    ];

    // Optional agent filter
    if (agentIds.size) {
      segmentFilters.push({
        type: "or",
        predicates: [...agentIds].map((id) => ({
          dimension: "userId",
          value: id,
        })),
      });
    }

    const body = {
      interval,
      order: "desc",
      orderBy: "conversationStart",
      segmentFilters,
      paging: { pageSize: QUERY_PAGE_SIZE, pageNumber: 1 },
    };

    try {
      // Auto-paginate to collect ALL matching conversations
      let page = 1;
      for (;;) {
        body.paging.pageNumber = page;
        statusEl.textContent = page === 1
          ? "Loading…"
          : `Loading page ${page}…`;

        const res = await api.queryConversationDetails(body);
        const batch = res?.conversations ?? [];
        conversations.push(...batch);

        // Stop when we received fewer than a full page or no results
        if (batch.length < QUERY_PAGE_SIZE) break;
        page++;
      }

      if (!conversations.length) {
        statusEl.textContent =
          "No interactions found for this period and filters.";
        return;
      }

      statusEl.textContent = `${conversations.length} interaction${conversations.length !== 1 ? "s" : ""} found — enriching checklist data…`;

      renderTable();
      enrichConversations(enrichAbort.signal);
    } catch (err) {
      console.error("Analytics query failed:", err);
      statusEl.textContent = `Error: ${err.message}`;
    }
  }

  // ── Render interaction table ───────────────────────────
  function renderTable() {
    tableWrap.innerHTML = "";

    const table = document.createElement("table");
    table.className = "checklist-table";

    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr>
        <th>Time</th>
        <th>Agent</th>
        <th>Queue</th>
        <th>Media</th>
        <th>Duration</th>
        <th>Checklist</th>
        <th>Status</th>
      </tr>
    `;
    table.append(thead);

    const tbody = document.createElement("tbody");

    for (const conv of conversations) {
      const agent = findAgentParticipant(conv);
      const queueId = agent ? extractQueueId(agent) : null;
      const queueName = queueId
        ? (queueNameCache.get(queueId) ?? queueId)
        : "—";
      const userName = agent?.participantName ?? agent?.userId ?? "—";
      const mediaType = agent ? extractMediaType(agent) : "—";
      const duration = agent ? extractDuration(agent) : 0;

      // Cache user name from analytics data
      if (agent?.userId && agent.participantName) {
        userNameCache.set(agent.userId, agent.participantName);
      }

      const tr = document.createElement("tr");
      tr.className = "checklist-row";
      tr.dataset.convId = conv.conversationId;

      tr.innerHTML = `
        <td>${escapeHtml(fmtDate(new Date(conv.conversationStart)))}</td>
        <td>${escapeHtml(userName)}</td>
        <td>${escapeHtml(queueName)}</td>
        <td>${escapeHtml(mediaType)}</td>
        <td>${escapeHtml(fmtDuration(duration))}</td>
        <td class="checklist-cell-name">…</td>
        <td class="checklist-cell-status">
          <span class="checklist-badge checklist-badge--loading">…</span>
        </td>
      `;

      tr.addEventListener("click", () => onRowClick(conv.conversationId));
      tbody.append(tr);
    }

    table.append(tbody);
    tableWrap.append(table);
  }

  // ── Apply status filter visibility ─────────────────────
  function applyTableFilter() {
    const rows = tableWrap.querySelectorAll(".checklist-row");
    for (const row of rows) {
      const info = enriched.get(row.dataset.convId);
      if (statusFilter === STATUS_FILTER.ALL) {
        // "All" shows only interactions that have checklist data
        if (!info) {
          row.hidden = false; // still loading — keep visible
        } else {
          row.hidden = !info.checklists?.length;
        }
        continue;
      }
      // Not yet enriched — hide while filtering
      if (!info) {
        row.hidden = true;
        continue;
      }
      row.hidden = info.completion !== statusFilter;
    }
  }

  // ── Update a single row after enrichment ───────────────
  function updateRowEnrichment(convId) {
    const row = tableWrap.querySelector(
      `tr[data-conv-id="${CSS.escape(convId)}"]`,
    );
    if (!row) return;

    const info = enriched.get(convId);
    const nameCell = row.querySelector(".checklist-cell-name");
    const statusCell = row.querySelector(".checklist-cell-status");

    if (!info || !info.checklists?.length) {
      nameCell.textContent = "—";
      statusCell.innerHTML =
        `<span class="checklist-badge checklist-badge--none">No checklist</span>`;
      return;
    }

    nameCell.textContent = info.checklists.map((c) => c.name).join(", ");

    if (info.completion === STATUS_FILTER.COMPLETE) {
      statusCell.innerHTML =
        `<span class="checklist-badge checklist-badge--complete">✅ Complete</span>`;
    } else {
      statusCell.innerHTML =
        `<span class="checklist-badge checklist-badge--incomplete">⚠️ Incomplete</span>`;
    }
  }

  // ── Background enrichment ──────────────────────────────
  async function enrichConversations(signal) {
    for (let i = 0; i < conversations.length; i += ENRICHMENT_BATCH) {
      if (signal?.aborted) return; // search was re-triggered
      const batch = conversations.slice(i, i + ENRICHMENT_BATCH);
      await Promise.allSettled(batch.map((conv) => enrichOne(conv)));
      if (signal?.aborted) return;
      applyTableFilter();
    }

    // Final status update
    const total = conversations.length;
    const withChecklist = [...enriched.values()].filter(
      (e) => e.checklists?.length,
    ).length;
    statusEl.textContent =
      `${total} interaction${total !== 1 ? "s" : ""} — ` +
      `${withChecklist} with checklist data`;

    // Show export button once enrichment is done
    exportBtn.hidden = !withChecklist;
  }

  async function enrichOne(conv) {
    const convId = conv.conversationId;
    try {
      // Step 1: Get full conversation to find agent communicationId(s)
      const fullConv = await api.getConversation(convId);
      const agentParts = (fullConv.participants ?? []).filter(
        (p) => p.purpose === PURPOSE_AGENT,
      );
      // Communications live under media-specific keys, NOT a generic key.
      const commIds = agentParts.flatMap((p) =>
        MEDIA_KEYS.flatMap((k) => (p[k] ?? []).map((c) => c.id)),
      );
      if (!commIds.length) {
        enriched.set(convId, {
          checklists: [],
          communicationId: null,
          completion: null,
        });
        updateRowEnrichment(convId);
        return;
      }

      // Step 2: Try each communication until we find checklists
      for (const commId of commIds) {
        try {
          const checklistRes = await api.getConversationChecklists(convId, commId);
          // Normalise response – API may return { entities: [...] }, an array, or a single object
          let list;
          if (Array.isArray(checklistRes)) {
            list = checklistRes;
          } else if (Array.isArray(checklistRes?.entities)) {
            list = checklistRes.entities;
          } else if (checklistRes && typeof checklistRes === "object" && checklistRes.id) {
            // Single checklist object returned
            list = [checklistRes];
          } else {
            list = [];
          }

          if (list.length) {
            const completion = checklistCompletion(list);
            enriched.set(convId, { checklists: list, communicationId: commId, completion });
            updateRowEnrichment(convId);
            return;
          }
        } catch (innerErr) {
          // 404 means no checklists for this communication – try next
          console.debug(`[Checklists] No data on comm ${commId} for ${convId}:`, innerErr.message ?? innerErr);
        }
      }

      // None of the communications had checklists
      enriched.set(convId, {
        checklists: [],
        communicationId: commIds[0],
        completion: null,
      });
      updateRowEnrichment(convId);
    } catch (err) {
      console.error(`[Checklists] enrichOne failed for ${convId}:`, err);
      enriched.set(convId, {
        checklists: [],
        communicationId: null,
        completion: null,
      });
      updateRowEnrichment(convId);
    }
  }

  // ── Export to Excel (two-sheet XLSX) ───────────────────
  function exportToExcel() {
    try {
      if (typeof XLSX === "undefined") {
        statusEl.textContent = "⚠ Excel library not loaded. Please reload the page.";
        return;
      }

      // ── Sheet 1: Interactions ────────────────────────────
      const interactionRows = [];
      for (const conv of conversations) {
        const convId = conv.conversationId;
        const info = enriched.get(convId);
        if (!info?.checklists?.length) continue;

        const agent = findAgentParticipant(conv);
        const queueId = agent ? extractQueueId(agent) : null;
        const queueName = queueId ? (queueNameCache.get(queueId) ?? queueId) : "";
        const userName = agent?.participantName ?? agent?.userId ?? "";
        const mediaType = agent ? extractMediaType(agent) : "";
        const duration = agent ? extractDuration(agent) : 0;

        interactionRows.push({
          "Conversation ID": convId,
          "Time": conv.conversationStart ? new Date(conv.conversationStart) : "",
          "Agent": userName,
          "Queue": queueName,
          "Media": mediaType ?? "",
          "Duration (s)": duration ? Math.round(duration / 1000) : 0,
          "Checklist": info.checklists.map((c) => c.name).join(", "),
          "Status": info.completion === STATUS_FILTER.COMPLETE ? "Complete" : "Incomplete",
        });
      }

      if (!interactionRows.length) {
        statusEl.textContent = "⚠ No checklist data to export.";
        return;
      }

      // ── Sheet 2: Checklist Items ─────────────────────────
      const itemRows = [];
      for (const conv of conversations) {
        const convId = conv.conversationId;
        const info = enriched.get(convId);
        if (!info?.checklists?.length) continue;

        for (const cl of info.checklists) {
          for (const item of cl.checklistItems ?? []) {
            itemRows.push({
              "Conversation ID": convId,
              "Checklist": cl.name ?? "",
              "Item": item.name ?? "",
              "Description": item.description ?? "",
              "Agent Ticked": item.stateFromAgent === TICK_STATE.TICKED ? "Yes" : "No",
              "AI Ticked": item.stateFromModel === TICK_STATE.TICKED ? "Yes" : "No",
              "Important": item.important ? "Yes" : "No",
            });
          }
        }
      }

      // ── Build workbook ───────────────────────────────────
      const wb = XLSX.utils.book_new();

      const ws1 = XLSX.utils.json_to_sheet(interactionRows);
      ws1["!cols"] = [
        { wch: 38 }, // Conversation ID
        { wch: 20 }, // Time
        { wch: 24 }, // Agent
        { wch: 22 }, // Queue
        { wch: 10 }, // Media
        { wch: 12 }, // Duration
        { wch: 24 }, // Checklist
        { wch: 12 }, // Status
      ];
      XLSX.utils.book_append_sheet(wb, ws1, "Interactions");

      const ws2 = XLSX.utils.json_to_sheet(itemRows);
      ws2["!cols"] = [
        { wch: 38 }, // Conversation ID
        { wch: 24 }, // Checklist
        { wch: 30 }, // Item
        { wch: 40 }, // Description
        { wch: 12 }, // Agent Ticked
        { wch: 10 }, // AI Ticked
        { wch: 10 }, // Important
      ];
      XLSX.utils.book_append_sheet(wb, ws2, "Checklist Items");

      // ── Download via Blob fallback (works inside iframes) ─
      const today = new Date().toISOString().slice(0, 10);
      const fileName = `Agent_Checklists_${today}.xlsx`;
      const wbOut = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([wbOut], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 200);
    } catch (err) {
      console.error("Export failed:", err);
      statusEl.textContent = `⚠ Export failed: ${err.message}`;
    }
  }

  // ── Row click → drill-down ─────────────────────────────
  function onRowClick(convId) {
    if (expandedRowId === convId) {
      drillPanel.hidden = true;
      expandedRowId = null;
      highlightRow(null);
      return;
    }

    expandedRowId = convId;
    highlightRow(convId);

    const info = enriched.get(convId);
    if (!info || !info.checklists?.length) {
      drillPanel.hidden = false;
      drillPanel.innerHTML = `
        <div class="checklist-drilldown__header">
          <h3>Checklist Detail</h3>
          <button type="button" class="btn btn-sm checklist-drilldown__close">✕</button>
        </div>
        <p class="checklist-drilldown__empty">
          ${info ? "No checklist data for this interaction." : "Still loading checklist data…"}
        </p>
      `;
      drillPanel
        .querySelector(".checklist-drilldown__close")
        ?.addEventListener("click", () => {
          drillPanel.hidden = true;
          expandedRowId = null;
          highlightRow(null);
        });
      return;
    }

    renderDrillDown(info.checklists);
  }

  function highlightRow(convId) {
    for (const row of tableWrap.querySelectorAll(".checklist-row")) {
      row.classList.toggle(
        "checklist-row--active",
        row.dataset.convId === convId,
      );
    }
  }

  function renderDrillDown(checklists) {
    drillPanel.hidden = false;
    drillPanel.innerHTML = "";

    // Header with close button
    const hdr = document.createElement("div");
    hdr.className = "checklist-drilldown__header";
    const h3 = document.createElement("h3");
    h3.textContent = "Checklist Detail";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "btn btn-sm checklist-drilldown__close";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => {
      drillPanel.hidden = true;
      expandedRowId = null;
      highlightRow(null);
    });
    hdr.append(h3, closeBtn);
    drillPanel.append(hdr);

    for (const cl of checklists) {
      const section = document.createElement("div");
      section.className = "checklist-drilldown__section";

      const title = document.createElement("h4");
      title.className = "checklist-drilldown__title";
      title.textContent = cl.name || "Checklist";
      section.append(title);

      // Meta line (status + dates)
      const meta = document.createElement("div");
      meta.className = "checklist-drilldown__meta";
      const parts = [];
      if (cl.status) parts.push(`Status: ${cl.status}`);
      if (cl.evaluationStartDate)
        parts.push(`Started: ${fmtDate(new Date(cl.evaluationStartDate))}`);
      if (cl.evaluationFinalizedDate)
        parts.push(`Finalized: ${fmtDate(new Date(cl.evaluationFinalizedDate))}`);
      meta.textContent = parts.join(" · ");
      section.append(meta);

      // Checklist items
      const itemList = document.createElement("ul");
      itemList.className = "checklist-drilldown__items";

      for (const item of cl.checklistItems ?? []) {
        const agentTicked = item.stateFromAgent === TICK_STATE.TICKED;
        const modelTicked = item.stateFromModel === TICK_STATE.TICKED;
        const ticked = agentTicked || modelTicked;

        const li = document.createElement("li");
        li.className =
          "checklist-drilldown__item " +
          (ticked
            ? "checklist-drilldown__item--ticked"
            : "checklist-drilldown__item--unticked");

        li.innerHTML = `
          <span class="checklist-drilldown__icon">${ticked ? "✅" : "❌"}</span>
          <span class="checklist-drilldown__item-name">${escapeHtml(item.name)}</span>
          ${item.important ? `<span class="checklist-drilldown__important" title="Important">⚡</span>` : ""}
          <span class="checklist-drilldown__ai" title="AI evaluation: ${modelTicked ? TICK_STATE.TICKED : TICK_STATE.UNTICKED}">
            AI: ${modelTicked ? "✓" : "✗"}
          </span>
        `;

        if (item.description) {
          const desc = document.createElement("div");
          desc.className = "checklist-drilldown__item-desc";
          desc.textContent = item.description;
          li.append(desc);
        }

        itemList.append(li);
      }

      section.append(itemList);
      drillPanel.append(section);
    }
  }

  // ── Bootstrap ──────────────────────────────────────────
  statusEl.textContent = "Loading copilot assistants…";

  try {
    const allAssistants = await api.getAllAssistants();
    const copilotsEnabled = allAssistants.filter(
      (a) => a.copilot?.enabled === true || a.copilot?.liveOnQueue === true,
    );

    if (!copilotsEnabled.length) {
      statusEl.textContent =
        "No copilot-enabled assistants found in this org.";
      return root;
    }

    copilotMs.setItems(
      copilotsEnabled.map((a) => ({ id: a.id, label: a.name })),
    );
    statusEl.textContent =
      `${copilotsEnabled.length} copilot assistant${copilotsEnabled.length !== 1 ? "s" : ""} available` +
      ` — select copilot(s) and queue(s), then search.`;

    // Set default date range
    const to = new Date();
    const from =
      DEFAULT_RANGE_DAYS === 0
        ? todayUTC()
        : new Date(to.getTime() - DEFAULT_RANGE_DAYS * MS_PER_DAY);
    fromInput.value = from.toISOString().slice(0, 10);
    toInput.value = to.toISOString().slice(0, 10);
    setActivePreset(DEFAULT_RANGE_DAYS);
  } catch (err) {
    console.error("Failed to load assistants:", err);
    statusEl.textContent = `Error loading assistants: ${err.message}`;
  }

  return root;
}
