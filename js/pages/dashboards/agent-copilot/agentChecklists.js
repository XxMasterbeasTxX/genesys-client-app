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
  QUERY_PAGE_SIZE,
  ENRICHMENT_BATCH,
  TABLE_DATE_FORMAT,
} from "./checklistConfig.js";

/* ── Helpers ───────────────────────────────────────────── */

function todayUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function nowUTC() {
  return new Date();
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
      if (metric.name === "tHandle" && metric.value) return metric.value;
    }
  }
  return 0;
}

/** Find the agent participant in an analytics conversation record. */
function findAgentParticipant(conv) {
  return (conv.participants ?? []).find((p) => p.purpose === "agent");
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
  return "unknown";
}

/**
 * Determine overall completion: "complete" if every item is ticked
 * by the agent, "incomplete" otherwise, null if no items.
 */
function checklistCompletion(checklistResponse) {
  const items = checklistResponse?.checklistItems ?? [];
  if (!items.length) return null;
  // An item is ticked if either the agent or the AI model marked it
  const allTicked = items.every(
    (it) => it.stateFromAgent === "Ticked" || it.stateFromModel === "Ticked",
  );
  return allTicked ? "complete" : "incomplete";
}

/* ── Main render ───────────────────────────────────────── */

export async function render({ route, me, api }) {
  // ── State ──────────────────────────────────────────────
  let conversations = [];         // analytics detail records
  const enriched = new Map();     // convId → { checklists, communicationId, completion }
  const queueNameCache = new Map(); // queueId → name
  const userNameCache = new Map();  // userId → name
  let statusFilter = "all";       // "all" | "complete" | "incomplete"
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

  const statusBtns = ["all", "complete", "incomplete"].map((val) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-sm checklist-status-btn";
    btn.textContent =
      val === "all" ? "All" : val === "complete" ? "✅ Completed" : "⚠️ Incomplete";
    btn.dataset.status = val;
    btn.addEventListener("click", () => {
      statusFilter = val;
      syncStatusButtons();
      applyTableFilter();
    });
    return btn;
  });
  statusBar.append(...statusBtns);

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
    const to = nowUTC();
    const from =
      days === 0 ? todayUTC() : new Date(to.getTime() - days * 86_400_000);
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

    // Fetch uncached in parallel batches of 10
    for (let i = 0; i < uncached.length; i += 10) {
      const batch = uncached.slice(i, i + 10);
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

    statusEl.textContent = "Loading…";
    tableWrap.innerHTML = "";
    drillPanel.hidden = true;
    expandedRowId = null;
    conversations = [];
    enriched.clear();

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
      const res = await api.queryConversationDetails(body);
      conversations = res?.conversations ?? [];

      if (!conversations.length) {
        statusEl.textContent =
          "No interactions found for this period and filters.";
        return;
      }

      statusEl.textContent = `${conversations.length} interaction${conversations.length !== 1 ? "s" : ""} found — enriching checklist data…`;

      renderTable();
      enrichConversations();
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
      if (statusFilter === "all") {
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

    if (info.completion === "complete") {
      statusCell.innerHTML =
        `<span class="checklist-badge checklist-badge--complete">✅ Complete</span>`;
    } else {
      statusCell.innerHTML =
        `<span class="checklist-badge checklist-badge--incomplete">⚠️ Incomplete</span>`;
    }
  }

  // ── Background enrichment ──────────────────────────────
  async function enrichConversations() {
    for (let i = 0; i < conversations.length; i += ENRICHMENT_BATCH) {
      const batch = conversations.slice(i, i + ENRICHMENT_BATCH);
      await Promise.allSettled(batch.map((conv) => enrichOne(conv)));
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
  }

  async function enrichOne(conv) {
    const convId = conv.conversationId;
    try {
      // Step 1: Get full conversation to find agent communicationId(s)
      const fullConv = await api.getConversation(convId);
      const agentParts = (fullConv.participants ?? []).filter(
        (p) => p.purpose === "agent",
      );
      // Communications live under media-specific keys (messages, calls, chats, etc.)
      // NOT under a generic "communications" key.
      const MEDIA_KEYS = ["messages", "calls", "chats", "callbacks", "emails", "socialExpressions", "videos"];
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
            const completion = checklistCompletion(list[0]);
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
        const agentTicked = item.stateFromAgent === "Ticked";
        const modelTicked = item.stateFromModel === "Ticked";
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
          <span class="checklist-drilldown__ai" title="AI evaluation: ${modelTicked ? "Ticked" : "Unticked"}">
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
    const to = nowUTC();
    const from =
      DEFAULT_RANGE_DAYS === 0
        ? todayUTC()
        : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 86_400_000);
    fromInput.value = from.toISOString().slice(0, 10);
    toInput.value = to.toISOString().slice(0, 10);
    setActivePreset(DEFAULT_RANGE_DAYS);
  } catch (err) {
    console.error("Failed to load assistants:", err);
    statusEl.textContent = `Error loading assistants: ${err.message}`;
  }

  return root;
}
