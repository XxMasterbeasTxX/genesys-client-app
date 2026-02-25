/**
 * Maps route paths → page loaders.
 *
 * Each loader receives a context { route, me, api } and returns
 * a Promise<HTMLElement>.
 *
 * To add a new page:
 *   1. Add the node in navConfig.js
 *   2. Create a module that exports: async function render(ctx) → HTMLElement
 *   3. Add an entry below pointing to that module
 */
import { render as renderPlaceholder } from "./pages/placeholder.js";

const registry = {
  // ── Dashboards › Agent Copilot ────────────────────────────
  "/dashboards/agent-copilot/agent-checklists": (ctx) =>
    import("./pages/dashboards/agent-copilot/agentChecklists.js").then((m) =>
      m.render(ctx),
    ),
  "/dashboards/agent-copilot/performance": (ctx) =>
    import("./pages/dashboards/agent-copilot/performance.js").then((m) =>
      m.render(ctx),
    ),

  // ── Dashboards › Agents ───────────────────────────────────
  "/dashboards/agents/placeholder": (ctx) => renderPlaceholder(ctx),

  // ── Dashboards › Callbacks ────────────────────────────────
  "/dashboards/callbacks/placeholder": (ctx) => renderPlaceholder(ctx),

  // ── Dashboards › Callflows ────────────────────────────────
  "/dashboards/callflows/placeholder": (ctx) => renderPlaceholder(ctx),

  // ── Dashboards › Queues ───────────────────────────────────
  "/dashboards/queues/placeholder": (ctx) => renderPlaceholder(ctx),

  // ── Dashboards › Trunks ───────────────────────────────────
  "/dashboards/trunks/activity": (ctx) =>
    import("./pages/dashboards/trunks/activity.js").then((m) =>
      m.render(ctx),
    ),
  "/dashboards/trunks/history": (ctx) =>
    import("./pages/dashboards/trunks/history.js").then((m) =>
      m.render(ctx),
    ),

  // ── Data Tables ───────────────────────────────────────────
  "/data-tables/update": (ctx) =>
    import("./pages/data-tables/update.js").then((m) =>
      m.render(ctx),
    ),
};

/**
 * Look up the loader for a route.
 * Returns the loader function, or null if the route is not registered.
 */
export function getPageLoader(route) {
  return registry[route] || null;
}
