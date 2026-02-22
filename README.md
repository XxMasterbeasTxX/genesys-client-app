# Genesys Client App

A single-page embedded application for **Genesys Cloud** built with vanilla JavaScript and ES modules. It runs inside the Genesys Cloud client as a [Premium App (iframe)](https://developer.genesys.cloud/platform/integrations/) and is also fully functional when opened in a standalone browser tab.

---

## Features

| Area | Details |
| ------ | --------- |
| **Authentication** | OAuth 2.0 Authorization Code with PKCE — automatic token refresh and cross-tab session handoff |
| **Navigation** | Recursive, config-driven sidebar tree with folder collapse, enabled/disabled flags, and automatic folder-to-leaf redirect |
| **Trunk Activity Dashboard** | Live concurrent-call metrics per trunk with WebSocket push (REST polling fallback), filterable trunk list, total row, and clean trunk-name display |
| **Threshold Warnings** | Configurable call-count threshold with pulsing banner, highlighted total row, and browser-tab title flash |
| **Real-time Chart** | Chart.js 4 line graph with trunk picker ("All" combined or individual trunks), rolling history, and threshold reference line |
| **Fullscreen** | Hybrid mode — native Fullscreen API when available, CSS-maximised overlay fallback for sandboxed iframes |
| **Open in New Tab** | Popout button with localStorage-based session handoff so the new tab skips re-authentication |

## Tech Stack

- **Front-end** — Vanilla JS, ES modules (`type="module"`), no build step
- **Routing** — Hash-based SPA router
- **Charts** — [Chart.js 4](https://www.chartjs.org/) via CDN
- **Auth** — OAuth 2.0 PKCE (OIDC scopes `openid profile email`)
- **Real-time** — Genesys Cloud WebSocket notifications with REST subscription management
- **Hosting** — Azure Static Web Apps (CI/CD via GitHub Actions)
- **Region** — `mypurecloud.de` (configurable in `js/config.js`)

## Project Structure

```text
├── index.html                        # App shell (header, nav, main outlet)
├── css/
│   └── styles.css                    # All application styles
├── js/
│   ├── app.js                        # Entry point — auth → nav → router
│   ├── config.js                     # Global infrastructure config
│   ├── router.js                     # Hash-based SPA router
│   ├── nav.js                        # Sidebar tree renderer
│   ├── navConfig.js                  # Navigation tree definition
│   ├── pageRegistry.js              # Route → lazy page-loader map
│   ├── utils.js                      # Shared helpers (escapeHtml, …)
│   ├── services/
│   │   ├── apiClient.js              # Generic REST client + Genesys endpoints
│   │   ├── authService.js            # OAuth PKCE flow, token refresh, tab handoff
│   │   └── notificationService.js    # WebSocket manager (subscriptions, reconnect)
│   └── pages/
│       ├── welcome.js                # Landing page (no route pre-selected)
│       ├── notfound.js               # 404 fallback
│       ├── placeholder.js            # Stub for future pages
│       └── dashboards/
│           ├── agent-copilot/
│           │   ├── agentChecklists.js
│           │   └── performance.js
│           └── trunks/
│               ├── activity.js       # Live trunk activity dashboard
│               └── trunkConfig.js    # Feature-level tunables for trunks
├── docs/
│   └── trunk-history-peak-tracking.md
└── .github/
    └── workflows/
        └── azure-static-web-apps-proud-pebble-04fa37b03.yml
```

## Getting Started

### Prerequisites

- A **Genesys Cloud** organisation with an OAuth client configured for Authorization Code (PKCE).
- The OAuth client's **Authorized redirect URI** must match the deployment URL exactly.

### Local Development

No build step is required. Serve the repository root with any static file server:

```bash
# Using Python
python -m http.server 8080

# Using Node.js (npx)
npx serve .
```

Then open `http://localhost:8080` in a browser.

> **Note:** OAuth redirects will only work if the redirect URI in `js/config.js` matches the URL you are serving from. For local development you may need to register an additional OAuth client with `http://localhost:8080` as the redirect URI.

### Deployment

Every push to `main` triggers the **Azure Static Web Apps** GitHub Actions workflow, which deploys the app automatically. No build step is needed (`skip_app_build: true`).

## Configuration

Configuration follows a **layered** approach designed to scale as the app grows:

| File | Scope | Contents |
| ------ | ------- | ---------- |
| `js/config.js` | Global | Region, OAuth client, redirect URI, scopes, router mode |
| `js/navConfig.js` | Global | Sidebar navigation tree and enabled flags |
| `js/pages/dashboards/trunks/trunkConfig.js` | Feature | Call threshold, poll interval, chart history length, colour palette |

Feature-level config files live alongside their feature code so new modules can follow the same pattern without bloating the global config.

## Adding a New Page

1. **Add a node** in [js/navConfig.js](js/navConfig.js) under the appropriate parent.
2. **Create a module** that exports `async function render(ctx)` returning an `HTMLElement`.
3. **Register the route** in [js/pageRegistry.js](js/pageRegistry.js) pointing to the new module (use dynamic `import()` for lazy loading).

The router, navigation tree, and enabled-flag filtering will pick it up automatically.

## Environment Variables & Secrets

| Secret                                  | Where                              | Purpose                                    |
| --------------------------------------- | ---------------------------------- | ------------------------------------------ |
| `AZURE_STATIC_WEB_APPS_API_TOKEN_*`     | GitHub repo → Settings → Secrets   | Deployment token for Azure Static Web Apps |

All Genesys Cloud credentials (OAuth client ID, region) are in `js/config.js` and are **public** by design — the PKCE flow does not use a client secret.

## License

This project is proprietary. See the repository settings for access permissions
