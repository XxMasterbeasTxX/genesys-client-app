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
  };
}