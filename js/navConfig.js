/**
 * Navigation tree definition.
 *
 * Nodes with `children` are folders (expand/collapse in the sidebar).
 * Nodes without `children` are leaves (navigate to a page).
 *
 * Set `enabled: false` on any node to hide it (and all its descendants)
 * from the sidebar and routing. Default is `true` if omitted.
 *
 * Children are kept in alphabetical order.
 */
export const NAV_TREE = [
  {
    label: "Dashboards",
    path: "dashboards",
    enabled: true,
    children: [
      {
        label: "Agent Copilot",
        path: "agent-copilot",
        enabled: true,
        children: [
          { label: "Agent Checklists", path: "agent-checklists", enabled: true },
          { label: "Performance", path: "performance", enabled: false },
        ],
      },
      {
        label: "Agents",
        path: "agents",
        enabled: true,
        children: [
          { label: "Placeholder", path: "placeholder", enabled: false },
        ],
      },
      {
        label: "Callbacks",
        path: "callbacks",
        enabled: true,
        children: [
          { label: "Placeholder", path: "placeholder", enabled: false },
        ],
      },
      {
        label: "Callflows",
        path: "callflows",
        enabled: true,
        children: [
          { label: "Placeholder", path: "placeholder", enabled: false },
        ],
      },
      {
        label: "Queues",
        path: "queues",
        enabled: true,
        children: [
          { label: "Placeholder", path: "placeholder", enabled: false },
        ],
      },
      {
        label: "Trunks",
        path: "trunks",
        enabled: true,
        children: [
          { label: "Activity", path: "activity", enabled: true },
          { label: "History", path: "history", enabled: true },
        ],
      },
    ],
  },
  {
    label: "Wallboards",
    path: "wallboards",
    enabled: true,
    children: [
      { label: "Placeholder", path: "placeholder", enabled: false },
    ],
  },
];

/** Collect all leaf routes from enabled nodes only. */
export function getLeafRoutes(nodes = NAV_TREE, parentPath = "") {
  const routes = [];
  for (const node of nodes) {
    if (node.enabled === false) continue;
    const fullPath = `${parentPath}/${node.path}`;
    if (node.children?.length) {
      routes.push(...getLeafRoutes(node.children, fullPath));
    } else {
      routes.push(fullPath);
    }
  }
  return routes;
}

/** Return the first leaf route (used as the default landing page). */
export function getDefaultRoute() {
  const leaves = getLeafRoutes();
  return leaves[0] || "/";
}

/** If `prefix` matches a folder, return its first descendent leaf route. */
export function getFirstLeafUnder(prefix) {
  return getLeafRoutes().find((r) => r.startsWith(prefix + "/")) || null;
}
