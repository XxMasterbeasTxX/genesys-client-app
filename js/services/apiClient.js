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
  };
}