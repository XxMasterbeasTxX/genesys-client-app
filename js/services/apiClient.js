import { CONFIG } from "../config.js";

export function createApiClient(getAccessToken) {
  async function request(path, { method = "GET", headers = {}, body } = {}) {
    const token = getAccessToken();
    if (!token) throw new Error("No access token available");

    const res = await fetch(`${CONFIG.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API ${method} ${path} failed: ${res.status} ${res.statusText} ${text}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return null;
    return res.json();
  }

  return {
    getUsersMe: () => request("/api/v2/users/me"),

    // ── Trunks ────────────────────────────────────────────────
    /** Fetch a single page of trunks. */
    getTrunksPage: ({ page = 1, pageSize = 100, trunkType } = {}) => {
      const qs = new URLSearchParams({ pageNumber: page, pageSize });
      if (trunkType) qs.set("trunkType", trunkType);
      return request(`/api/v2/telephony/providers/edges/trunks?${qs}`);
    },

    /** Fetch ALL trunks (auto-paginates). */
    getAllTrunks: async (opts = {}) => {
      const all = [];
      let page = 1;
      let total = Infinity;
      while (all.length < total) {
        const res = await request(
          `/api/v2/telephony/providers/edges/trunks?${new URLSearchParams({
            pageNumber: page,
            pageSize: 100,
            ...(opts.trunkType ? { trunkType: opts.trunkType } : {}),
          })}`,
        );
        total = res.total ?? res.entities?.length ?? 0;
        if (res.entities) all.push(...res.entities);
        if (!res.entities?.length) break;
        page++;
      }
      return all;
    },

    /** Fetch metrics for a list of trunk IDs (max ~100 per call). */
    getTrunkMetrics: (trunkIds) =>
      request(
        `/api/v2/telephony/providers/edges/trunks/metrics?trunkIds=${trunkIds.join(",")}`,
      ),

    // ── Notifications ─────────────────────────────────────────
    /** Create a new notification channel (returns { id, connectUri }). */
    createNotificationChannel: () =>
      request("/api/v2/notifications/channels", { method: "POST" }),

    /** Replace existing subscriptions with a new list. */
    setSubscriptions: (channelId, topics) =>
      request(`/api/v2/notifications/channels/${channelId}/subscriptions`, {
        method: "PUT",
        body: topics.map((id) => ({ id })),
      }),

    // ── Assistants / Copilot ────────────────────────────────────
    /** Fetch ALL assistants with copilot config embedded (cursor-paginated). */
    getAllAssistants: async () => {
      const all = [];
      let after = undefined;
      for (;;) {
        const qs = new URLSearchParams({ pageSize: 200, expand: "copilot" });
        if (after) qs.set("after", after);
        const res = await request(`/api/v2/assistants?${qs}`);
        if (res.entities) all.push(...res.entities);
        if (!res.nextUri) break;
        const m = new URL(res.nextUri, CONFIG.apiBase).searchParams.get("after");
        if (!m) break;
        after = m;
      }
      return all;
    },

    /** Fetch queue IDs assigned to an assistant (cursor-paginated). */
    getAssistantQueues: async (assistantId) => {
      const all = [];
      let after = undefined;
      for (;;) {
        const qs = new URLSearchParams({ pageSize: 200 });
        if (after) qs.set("after", after);
        const res = await request(
          `/api/v2/assistants/${assistantId}/queues?${qs}`,
        );
        if (res.entities) all.push(...res.entities);
        if (!res.nextUri) break;
        const m = new URL(res.nextUri, CONFIG.apiBase).searchParams.get("after");
        if (!m) break;
        after = m;
      }
      return all; // [{ id, mediaTypes, … }]
    },

    // ── Routing ─────────────────────────────────────────────────
    /** Fetch a single queue by ID (for name resolution). */
    getQueue: (queueId) => request(`/api/v2/routing/queues/${queueId}`),

    /** Fetch ALL members of a queue (auto-paginates). */
    getQueueMembers: async (queueId) => {
      const all = [];
      let page = 1;
      let total = Infinity;
      while (all.length < total) {
        const qs = new URLSearchParams({ pageNumber: page, pageSize: 100 });
        const res = await request(
          `/api/v2/routing/queues/${queueId}/members?${qs}`,
        );
        total = res.total ?? res.entities?.length ?? 0;
        if (res.entities) all.push(...res.entities);
        if (!res.entities?.length) break;
        page++;
      }
      return all;
    },

    // ── Analytics ───────────────────────────────────────────────
    /** POST conversation detail query (returns { conversations, totalHits }). */
    queryConversationDetails: (body) =>
      request("/api/v2/analytics/conversations/details/query", {
        method: "POST",
        body,
      }),

    // ── Conversations + Checklists ──────────────────────────────
    /** Fetch a single conversation (participants, communications). */
    getConversation: (conversationId) =>
      request(`/api/v2/conversations/${conversationId}`),

    /** Fetch checklists for a conversation communication. */
    getConversationChecklists: (conversationId, communicationId) =>
      request(
        `/api/v2/conversations/${conversationId}/communications/${communicationId}/agentchecklists`,
      ),

    /** Fetch conversation summaries (may contain multiple entities). */
    getConversationSummaries: (conversationId) =>
      request(`/api/v2/conversations/${conversationId}/summaries`),

    /**
     * Fetch all recordings for a conversation.
     * Returns an array of recording objects, each with a `mediaUri` presigned S3 URL
     * valid for ~5 minutes. Always fetch on demand — never cache the URL.
     * formatId controls the audio codec; MP3 has the widest browser support.
     * @param {string} conversationId
     * @param {string} [formatId='MP3'] WAV | WEBM | WAV_ULAW | OGG_VORBIS | OGG_OPUS | MP3
     */
    getConversationRecordings: (conversationId, formatId = "MP3") =>
      request(
        `/api/v2/conversations/${conversationId}/recordings?formatId=${formatId}&maxWaitMs=5000`,
      ),

    // ── Data Tables ─────────────────────────────────────────────
    /** Fetch ALL data tables the user can view (auto-paginated, with schema). */
    getDataTables: async () => {
      const all = [];
      let page = 1;
      let total = Infinity;
      while (all.length < total) {
        const qs = new URLSearchParams({
          pageNumber: page,
          pageSize: 25,
          expand: "schema",
        });
        const res = await request(`/api/v2/flows/datatables?${qs}`);
        total = res.total ?? res.entities?.length ?? 0;
        if (res.entities) all.push(...res.entities);
        if (!res.entities?.length) break;
        page++;
      }
      return all;
    },

    /** Fetch a single data table with its JSON Schema. */
    getDataTable: (datatableId) =>
      request(`/api/v2/flows/datatables/${datatableId}?expand=schema`),

    /**
     * Fetch ALL rows of a data table (auto-paginated, 500 rows/page).
     * Always returns the complete row set regardless of table size.
     */
    getDataTableRows: async (datatableId) => {
      const all = [];
      let page = 1;
      let total = Infinity;
      while (all.length < total) {
        const qs = new URLSearchParams({
          pageNumber: page,
          pageSize: 500,
          showbrief: false,
        });
        const res = await request(
          `/api/v2/flows/datatables/${datatableId}/rows?${qs}`,
        );
        total = res.total ?? res.entities?.length ?? 0;
        if (res.entities) all.push(...res.entities);
        if (!res.entities?.length) break;
        page++;
      }
      return all;
    },

    /**
     * Look up a single row by its exact key value.
     * Returns the row object, or null if not found (404).
     */
    lookupDataTableRow: async (datatableId, keyValue) => {
      try {
        return await request(
          `/api/v2/flows/datatables/${datatableId}/rows/${encodeURIComponent(keyValue)}?showbrief=false`,
        );
      } catch (err) {
        if (err.message?.includes("404")) return null;
        throw err;
      }
    },

    /** Update an existing row (PUT). Key must appear in body. */
    updateDataTableRow: (datatableId, rowId, body) =>
      request(
        `/api/v2/flows/datatables/${datatableId}/rows/${encodeURIComponent(rowId)}`,
        { method: "PUT", body },
      ),

    /** Create a new row (POST). */
    createDataTableRow: (datatableId, body) =>
      request(`/api/v2/flows/datatables/${datatableId}/rows`, {
        method: "POST",
        body,
      }),

    /** Delete a row by key. */
    deleteDataTableRow: (datatableId, rowId) =>
      request(
        `/api/v2/flows/datatables/${datatableId}/rows/${encodeURIComponent(rowId)}`,
        { method: "DELETE" },
      ),

    // ── User Permissions ────────────────────────────────────────
    /** Fetch current user with full authorization grants (for permission detection). */
    getUsersMeWithAuth: () =>
      request("/api/v2/users/me?expand=authorization"),

    // ── Lookup helpers (for validation dropdowns) ───────────────
    /** Fetch ALL queues (auto-paginated). Returns [{ id, name, … }]. */
    getAllQueues: async () => {
      const all = [];
      let page = 1;
      let total = Infinity;
      while (all.length < total) {
        const qs = new URLSearchParams({ pageNumber: page, pageSize: 500 });
        const res = await request(`/api/v2/routing/queues?${qs}`);
        total = res.total ?? res.entities?.length ?? 0;
        if (res.entities) all.push(...res.entities);
        if (!res.entities?.length) break;
        page++;
      }
      return all;
    },

    /** Fetch ALL skills (auto-paginated). Returns [{ id, name, … }]. */
    getAllSkills: async () => {
      const all = [];
      let page = 1;
      let total = Infinity;
      while (all.length < total) {
        const qs = new URLSearchParams({ pageNumber: page, pageSize: 500 });
        const res = await request(`/api/v2/routing/skills?${qs}`);
        total = res.total ?? res.entities?.length ?? 0;
        if (res.entities) all.push(...res.entities);
        if (!res.entities?.length) break;
        page++;
      }
      return all;
    },

    /** Fetch ALL languages (auto-paginated). Returns [{ id, name, … }]. */
    getAllLanguages: async () => {
      const all = [];
      let page = 1;
      let total = Infinity;
      while (all.length < total) {
        const qs = new URLSearchParams({ pageNumber: page, pageSize: 500 });
        const res = await request(`/api/v2/routing/languages?${qs}`);
        total = res.total ?? res.entities?.length ?? 0;
        if (res.entities) all.push(...res.entities);
        if (!res.entities?.length) break;
        page++;
      }
      return all;
    },

    /** Fetch ALL wrap-up codes (auto-paginated). Returns [{ id, name, … }]. */
    getAllWrapupCodes: async () => {
      const all = [];
      let page = 1;
      let total = Infinity;
      while (all.length < total) {
        const qs = new URLSearchParams({ pageNumber: page, pageSize: 500 });
        const res = await request(`/api/v2/routing/wrapupcodes?${qs}`);
        total = res.total ?? res.entities?.length ?? 0;
        if (res.entities) all.push(...res.entities);
        if (!res.entities?.length) break;
        page++;
      }
      return all;
    },

    /** Fetch ALL architect schedules (auto-paginated). Returns [{ id, name, … }]. */
    getAllSchedules: async () => {
      const all = [];
      let page = 1;
      let total = Infinity;
      while (all.length < total) {
        const qs = new URLSearchParams({ pageNumber: page, pageSize: 500 });
        const res = await request(`/api/v2/architect/schedules?${qs}`);
        total = res.total ?? res.entities?.length ?? 0;
        if (res.entities) all.push(...res.entities);
        if (!res.entities?.length) break;
        page++;
      }
      return all;
    },

    /** Fetch ALL architect schedule groups (auto-paginated). Returns [{ id, name, … }]. */
    getAllScheduleGroups: async () => {
      const all = [];
      let page = 1;
      let total = Infinity;
      while (all.length < total) {
        const qs = new URLSearchParams({ pageNumber: page, pageSize: 500 });
        const res = await request(`/api/v2/architect/schedulegroups?${qs}`);
        total = res.total ?? res.entities?.length ?? 0;
        if (res.entities) all.push(...res.entities);
        if (!res.entities?.length) break;
        page++;
      }
      return all;
    },
  };
}