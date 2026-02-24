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
  };
}