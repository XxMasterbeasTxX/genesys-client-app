import { CONFIG } from "./config.js";
import { Router } from "./router.js";
import { renderDashboardsPage } from "./pages/dashboards.js";
import { renderNotFoundPage } from "./pages/notfound.js";
import { escapeHtml } from "./utils.js";
import {
  ensureAuthenticatedWithMe,
  getValidAccessToken,
  scheduleTokenRefresh,
} from "./services/authService.js";
import { createApiClient } from "./services/apiClient.js";

function setHeader({ authText }) {
  document.getElementById("brandTitle").textContent = CONFIG.appName;
  document.getElementById("envSubtitle").textContent = `${CONFIG.region}`;
  document.getElementById("authPill").textContent = authText;
}

function setActiveNav(route) {
  document.querySelectorAll(".nav-item").forEach(a => {
    const r = a.getAttribute("data-route");
    a.classList.toggle("active", r === route);
  });
}

function ensureDefaultRoute() {
  if (!window.location.hash || window.location.hash === "#") {
    window.location.hash = "#/dashboards";
  }
}

function renderFatalError(message) {
  const outletEl = document.getElementById("appMain");
  outletEl.innerHTML = `
    <section class="card">
      <h1 class="h1">Startup error</h1>
      <p class="p">${escapeHtml(message)}</p>
    </section>
  `;
}

(async function main() {
  ensureDefaultRoute();
  setHeader({ authText: "Auth: starting…" });

  // --- Authenticate ---
  setHeader({ authText: "Auth: checking token / login…" });
  const res = await ensureAuthenticatedWithMe();

  if (res.status === "redirecting") {
    setHeader({ authText: "Auth: redirecting…" });
    return;
  }

  // Auth OK
  const userName = res.me?.name || "user";
  setHeader({ authText: `Auth: ok · ${userName}` });

  // --- Create a shared API client for all pages ---
  const api = createApiClient(getValidAccessToken);

  // --- Proactive session monitoring ---
  scheduleTokenRefresh({
    onExpiringSoon: (secsLeft) => {
      setHeader({ authText: `Auth: ok · ${userName} · session expires in ${secsLeft}s` });
    },
    onSessionExpired: () => {
      setHeader({ authText: "Auth: session expired — redirecting…" });
    },
  });

  // --- Start router ---
  const outletEl = document.getElementById("appMain");
  const router = new Router({
    outletEl,
    routes: {
      "/dashboards": async () => renderDashboardsPage({ me: res.me, api }),
      "/404": async (ctx) => renderNotFoundPage(ctx),
    },
    onRouteChanged: (route) => setActiveNav(route),
  });

  router.start();
})().catch((err) => {
  setHeader({ authText: "Auth: failed" });
  renderFatalError(err?.message || String(err));
});