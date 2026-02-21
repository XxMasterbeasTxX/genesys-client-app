import { CONFIG } from "./config.js";
import { Router } from "./router.js";
import { renderDashboardsPage } from "./pages/dashboards.js";
import { renderNotFoundPage } from "./pages/notfound.js";
import { createAuthService } from "./services/authService.js";
import { createApiClient } from "./services/apiClient.js";

function setHeader({ authText }) {
  document.getElementById("brandTitle").textContent = CONFIG.appName;
  document.getElementById("envSubtitle").textContent = `${CONFIG.region}`;

  const pill = document.getElementById("authPill");
  pill.textContent = authText;
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

async function main() {
  ensureDefaultRoute();
  setHeader({ authText: "Auth: starting…" });

  const auth = createAuthService();

  // 1) Ensure token (or redirect)
  const authResult = await auth.ensureAuthenticated();
  if (authResult.status === "redirecting") return;

  setHeader({ authText: `Auth: ${authResult.from} • checking API…` });

  // 2) Optional: get /users/me once (safe to show name/id)
  const api = createApiClient(auth.getAccessToken);
  let me = null;
  try {
    me = await api.getUsersMe();
    setHeader({ authText: `Auth: ok • ${me?.name || "user"}` });
  } catch {
    setHeader({ authText: "Auth: ok • API check failed" });
  }

  // 3) Start router
  const outletEl = document.getElementById("appMain");

  const router = new Router({
    outletEl,
    routes: {
      "/dashboards": async () => renderDashboardsPage({ me }),
      "/404": async (ctx) => renderNotFoundPage(ctx),
    },
    onRouteChanged: (route) => setActiveNav(route),
  });

  router.start();
}

main().catch((err) => {
  const outletEl = document.getElementById("appMain");
  if (outletEl) {
    outletEl.innerHTML = `
      <section class="card">
        <h1 class="h1">Startup error</h1>
        <p class="p">${escapeHtml(err?.message || String(err))}</p>
      </section>
    `;
  }
  const pill = document.getElementById("authPill");
  if (pill) pill.textContent = "Auth: failed";
});

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}