export async function renderDashboardsPage({ me }) {
  const root = document.createElement("div");

  const card = document.createElement("section");
  card.className = "card";

  const h1 = document.createElement("h1");
  h1.className = "h1";
  h1.textContent = "Dashboards";

  const p = document.createElement("p");
  p.className = "p";
  p.textContent =
    "Starting point for dashboards. Later you can add charts, tables, wallboard mode, and filters.";

  card.append(h1, p);

  if (me) {
    const kv = document.createElement("div");
    kv.className = "kv";
    kv.innerHTML = `
      <div class="k">Signed in as</div><div class="v">${escapeHtml(me.name || "")}</div>
      <div class="k">User ID</div><div class="v">${escapeHtml(me.id || "")}</div>
    `;
    card.append(kv);
  }

  root.append(card);
  return root;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}