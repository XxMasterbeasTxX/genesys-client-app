import { escapeHtml } from "../utils.js";

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

    const kName = document.createElement("div");
    kName.className = "k";
    kName.textContent = "Signed in as";

    const vName = document.createElement("div");
    vName.className = "v";
    vName.textContent = me.name || "";

    const kId = document.createElement("div");
    kId.className = "k";
    kId.textContent = "User ID";

    const vId = document.createElement("div");
    vId.className = "v";
    vId.textContent = me.id || "";

    kv.append(kName, vName, kId, vId);
    card.append(kv);
  }

  root.append(card);
  return root;
}