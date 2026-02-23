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
| **Trunk History** | Historical peak concurrent-call chart powered by an Azure Functions backend that collects metrics every 5 minutes. Preset and custom date-range picker, peak/avg stats cards, auto-downsampled Chart.js graph |

## Tech Stack

- **Front-end** — Vanilla JS, ES modules (`type="module"`), no build step
- **Routing** — Hash-based SPA router
- **Charts** — [Chart.js 4](https://www.chartjs.org/) via CDN
- **Auth** — OAuth 2.0 PKCE (OIDC scopes `openid profile email`)
- **Real-time** — Genesys Cloud WebSocket notifications with REST subscription management
- **Backend** — Azure Functions (Node.js 20, Consumption plan) for scheduled metric collection and history API
- **Storage** — Azure Table Storage for time-series trunk metrics
- **Hosting** — Azure Static Web Apps + Azure Functions (CI/CD via GitHub Actions)
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
│               ├── history.js        # Historical peak-call chart page
│               ├── historyConfig.js  # Feature-level tunables for history
│               └── trunkConfig.js    # Feature-level tunables for activity
├── api/                                # Azure Functions backend
│   ├── host.json                       # Function App runtime config
│   ├── package.json                    # Node.js dependencies
│   ├── shared/
│   │   ├── genesysAuth.js              # Client Credentials OAuth helper
│   │   └── tableClient.js             # Azure Table Storage read/write
│   ├── collectTrunkMetrics/            # Timer trigger — every 5 min
│   │   ├── function.json
│   │   └── index.js
│   └── getTrunkHistory/                # HTTP trigger — GET /api/getTrunkHistory
│       ├── function.json
│       └── index.js
├── docs/
│   └── trunk-history-peak-tracking.md
└── .github/
    └── workflows/
        ├── azure-static-web-apps-proud-pebble-04fa37b03.yml
        └── deploy-functions.yml        # CI/CD for Azure Functions
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

- **SPA:** Every push to `main` triggers the **Azure Static Web Apps** GitHub Actions workflow, which deploys the front-end automatically (`skip_app_build: true`).
- **Functions:** Pushes that change files under `api/` trigger the **deploy-functions** workflow, which installs dependencies and deploys to the `genesys-app-functions` Function App.

## Configuration

Configuration follows a **layered** approach designed to scale as the app grows:

| File | Scope | Contents |
| ------ | ------- | ---------- |
| `js/config.js` | Global | Region, OAuth client, redirect URI, scopes, router mode |
| `js/navConfig.js` | Global | Sidebar navigation tree and enabled flags |
| `js/pages/dashboards/trunks/trunkConfig.js` | Feature | Call threshold, poll interval, chart history length, colour palette |
| `js/pages/dashboards/trunks/historyConfig.js` | Feature | Default date range, chart max points, colours |

Feature-level config files live alongside their feature code so new modules can follow the same pattern without bloating the global config.

The Azure Functions backend reads its configuration from **App Settings** (environment variables) on the Function App:

| Setting | Purpose |
| --------- | ---------- |
| `GC_CLIENT_ID` | Genesys Cloud Client Credentials OAuth client ID |
| `GC_CLIENT_SECRET` | Genesys Cloud Client Credentials OAuth client secret |
| `GC_REGION` | Genesys Cloud region (e.g. `mypurecloud.de`) |
| `TABLE_STORAGE_CONNECTION` | Azure Storage connection string (if not using `AzureWebJobsStorage`) |

## Adding a New Page

1. **Add a node** in [js/navConfig.js](js/navConfig.js) under the appropriate parent.
2. **Create a module** that exports `async function render(ctx)` returning an `HTMLElement`.
3. **Register the route** in [js/pageRegistry.js](js/pageRegistry.js) pointing to the new module (use dynamic `import()` for lazy loading).

The router, navigation tree, and enabled-flag filtering will pick it up automatically.

## Environment Variables & Secrets

| Secret | Where | Purpose |
| --------- | --------- | ---------- |
| `AZURE_STATIC_WEB_APPS_API_TOKEN_*` | GitHub repo → Settings → Secrets | Deployment token for Azure Static Web Apps |
| `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` | GitHub repo → Settings → Secrets | Publish profile for Azure Functions deployment |

The SPA's OAuth client ID is in `js/config.js` and is **public** by design — the PKCE flow does not use a client secret. The Function App's Client Credentials secret is stored in Azure App Settings, never in code.

## License

This project is proprietary. See the repository settings for access permissions
