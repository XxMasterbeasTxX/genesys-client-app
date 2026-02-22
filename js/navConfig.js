/**
 * Navigation tree definition.
 *
 * Nodes with `children` are folders (expand/collapse in the sidebar).
 * Nodes without `children` are leaves (navigate to a page).
 *
 * Children are kept in alphabetical order.
 */
export const NAV_TREE = [
  {
    label: "Dashboards",
    path: "dashboards",
    children: [
      {
        label: "Agent Copilot",
        path: "agent-copilot",
        children: [
          { label: "Agent Checklists", path: "agent-checklists" },
          { label: "Performance", path: "performance" },
        ],
      },
      {
        label: "Agents",
        path: "agents",
        children: [
          { label: "Placeholder", path: "placeholder" },
        ],
      },
      {
        label: "Callbacks",
        path: "callbacks",
        children: [
          { label: "Placeholder", path: "placeholder" },
        ],
      },
      {
        label: "Callflows",
        path: "callflows",
        children: [
          { label: "Placeholder", path: "placeholder" },
        ],
      },
      {
        label: "Queues",
        path: "queues",
        children: [
          { label: "Placeholder", path: "placeholder" },
        ],
      },
      {
        label: "Trunks",
        path: "trunks",
        children: [
          { label: "Activity", path: "activity" },
        ],
      },
    ],
  },
];

/** Collect all leaf routes from the tree. */
export function getLeafRoutes(nodes = NAV_TREE, parentPath = "") {
  const routes = [];
  for (const node of nodes) {
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
