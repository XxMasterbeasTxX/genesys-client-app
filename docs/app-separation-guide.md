# App Separation Guide — Per-Customer Feature Licensing

This document covers how to deliver subsets of the Genesys Client App to customers who only pay for specific features (e.g. Agent Copilot only, Trunks only).

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Why Client-Side Feature Hiding Doesn't Work](#2-why-client-side-feature-hiding-doesnt-work)
3. [Recommended Approach: Separate Apps](#3-recommended-approach-separate-apps)
4. [Architecture Overview](#4-architecture-overview)
5. [Step-by-Step: Creating a Feature-Specific App](#5-step-by-step-creating-a-feature-specific-app)
6. [What to Copy (Shared Core)](#6-what-to-copy-shared-core)
7. [What to Include Per Feature](#7-what-to-include-per-feature)
8. [Customer Deployment Differences](#8-customer-deployment-differences)
9. [Alternative: Monorepo with Build Script](#9-alternative-monorepo-with-build-script)
10. [Decision Matrix](#10-decision-matrix)

---

## 1. Problem Statement

The developer app contains multiple features:

- **Agent Copilot** — Checklist history, completion tracking, Excel export, inline recording playback, Agent Checked filter, collapsible drill-down UI
- **Trunk Dashboards** — Live activity, history, alerts/SMS
- **Data Tables** — Config-driven editor for Genesys Cloud Data Tables (supervisor and administrator modes)
- **Future features** — additional dashboard pages

Customers may purchase only a subset. They should **not** have access to code for features they haven't paid for — both to protect IP and to avoid confusion.

---

## 2. Why Client-Side Feature Hiding Doesn't Work

Since this is a **static SPA** (no build step, all JS/CSS shipped to the browser), there is no secure way to hide code:

| Approach | Hides from casual users? | Secure? | Notes |
| --- | --- | --- | --- |
| Remove routes from sidebar (`navConfig.js`) | ✅ | ❌ | JS files still load; DevTools reveals everything |
| Feature flags in `config.js` | ✅ | ❌ | Config is readable in the browser |
| Conditional `import()` based on flag | ✅ | ❌ | Module URLs visible in Network tab |
| Server-side entitlement check (Azure Function) | ✅ | ✅ | Requires backend per API call; significant overhead |

**Conclusion:** For a static SPA without a build step, **separate apps** is the only clean, secure solution.

---

## 3. Recommended Approach: Separate Apps

Create a **separate repository** (or branch) per customer offering, each containing only:

- The **shared core** (auth, routing, API client, components, styles)
- The **feature-specific pages** the customer has licensed

Each app gets its own:

- GitHub repository (or long-lived branch)
- Azure Static Web App
- Genesys Cloud OAuth client
- Genesys Cloud Premium App integration

---

## 4. Architecture Overview

```text
┌────────────────────────────┐
│   Developer App (full)     │  ← Your private repo with ALL features
│   github.com/you/genesys-  │
│   client-app               │
└────────────────────────────┘
         │
    ┌────┴─────────────────────────┐
    │                              │
    ▼                              ▼
┌──────────────────┐   ┌──────────────────────┐
│  Copilot App     │   │  Trunks App          │
│  (Customer A)    │   │  (Customer B)        │
│                  │   │                      │
│  Shared core +   │   │  Shared core +       │
│  agent-copilot/  │   │  trunks/ + api/      │
└──────────────────┘   └──────────────────────┘
```

---

## 5. Step-by-Step: Creating a Feature-Specific App

### Example: "Agent Copilot Only" app

1. **Create a new repo** (e.g. `genesys-copilot-app`)

2. **Copy the shared core** (see Section 6)

3. **Copy only the feature pages:**

   ```text
   js/pages/dashboards/agent-copilot/   ← entire folder
   ```

4. **Update `navConfig.js`** — remove Trunks entries, keep only Agent Copilot:

   ```javascript
   export const NAV_TREE = [
     {
       id: "dashboards", label: "Dashboards", children: [
         {
           id: "agent-copilot", label: "Agent Copilot", children: [
             { id: "agent-checklists", label: "Agent Checklists", route: "agent-checklists" },
           ]
         }
       ]
     }
   ];
   ```

5. **Update `pageRegistry.js`** — remove trunk route registrations, keep only copilot routes

6. **Update `config.js`** — new OAuth client ID, new SWA URL, remove `functionsBase` if no backend needed

7. **Update `index.html`** — remove `<script src="js/lib/xlsx.full.min.js">` if Excel export is not included (or keep it if it is)

8. **Remove `api/` folder** entirely if no Azure Functions features are needed

9. **Remove unused workflow files** (e.g. `deploy-functions.yml`)

10. **Deploy** — new Azure Static Web App, new Genesys Premium App integration

---

## 6. What to Copy (Shared Core)

These files are needed by **every** app variant:

```text
index.html                          # App shell
download.html                       # Excel download helper (if export is included)
css/styles.css                      # All styles (could be trimmed per feature)
js/
  app.js                            # Entry point
  config.js                         # Global config (customise per customer)
  router.js                         # Hash-based router
  nav.js                            # Sidebar renderer
  navConfig.js                      # Nav tree (customise per feature set)
  pageRegistry.js                   # Route map (customise per feature set)
  utils.js                          # Shared helpers
  components/
    multiSelect.js                  # Reusable dropdown component
  services/
    apiClient.js                    # REST client + Genesys Cloud endpoints
    authService.js                  # OAuth PKCE flow
  pages/
    welcome.js                      # Landing page
    notfound.js                     # 404 fallback
    placeholder.js                  # Stub for future pages
```

---

## 7. What to Include Per Feature

### Agent Copilot Only

| Include | Notes |
| --- | --- |
| `js/pages/dashboards/agent-copilot/agentChecklists.js` | Main checklist + summaries view |
| `js/pages/dashboards/agent-copilot/checklistConfig.js` | All feature-level tunables and labels |
| `js/pages/dashboards/agent-copilot/performance.js` | Disabled page (stub) — include only if planning to enable it |
| `js/lib/xlsx.full.min.js` | For Excel export |
| `download.html` | Excel download helper page |

**Does NOT need:** `api/` folder, Azure Functions, Azure Storage, backend OAuth client, `notificationService.js`

**Genesys permissions required:** Analytics, Conversation, Assistants, Routing, Recording

> The **Recording** permission (`recording:recording:view`) is required for the inline recording playback button in the Interaction Detail drill-down. Add `recording:screenRecording:view` if screen recordings should also be playable. These permissions can be omitted if recording playback is not needed — the button will show an error but will not break any other functionality.

### Trunks Only

| Include | Notes |
| --- | --- |
| `js/pages/dashboards/trunks/activity.js` | Live trunk activity dashboard |
| `js/pages/dashboards/trunks/history.js` | Historical peak-call chart |
| `js/pages/dashboards/trunks/alertConfig.js` | In-app alert configuration panel |
| `js/pages/dashboards/trunks/trunkConfig.js` | Feature-level tunables |
| `js/pages/dashboards/trunks/historyConfig.js` | History feature tunables |
| `js/services/notificationService.js` | WebSocket for live updates |
| `api/` | Full Azure Functions backend |

**Does NOT need:** `js/lib/xlsx.full.min.js`, `download.html`, `agent-copilot/` folder, `data-tables/` folder

**Genesys permissions required:** Telephony, Integrations (for alerts)

---

### Data Tables Only

| Include | Notes |
| --- | --- |
| `js/pages/data-tables/update.js` | Main data table editor |
| `js/pages/data-tables/dataTablesConfig.js` | Per-table validation rules |
| `js/pages/data-tables/dataTablesConfig.example.js` | Optional — documented example config |

**Does NOT need:** `api/` folder, Azure Functions, Azure Storage, backend OAuth client, `notificationService.js`, `js/lib/xlsx.full.min.js`, `download.html`

**Genesys permissions required:** Architect (`architect:datatable:view`, `architect:datatable:edit`), Routing (`routing:queue:view`, `routing:skill:view`, `routing:language:view`, `routing:wrapupCode:view`), Architect (`architect:schedule:view`, `architect:scheduleGroup:view`)

### Full App

Include everything from all feature sets. See [deployment-guide.md](deployment-guide.md) for the complete permission list.

---

## 8. Customer Deployment Differences

| Item | Full App | Copilot Only | Trunks Only | Data Tables Only |
| --- | --- | --- | --- | --- |
| Azure Static Web App | ✅ | ✅ | ✅ | ✅ |
| Azure Function App | ✅ | ❌ | ✅ | ❌ |
| Azure Storage Account | ✅ | ❌ | ✅ | ❌ |
| Backend OAuth client | ✅ | ❌ | ✅ | ❌ |
| PKCE OAuth client | ✅ | ✅ | ✅ | ✅ |
| `functionsBase` in config | Set | Remove/empty | Set | Remove/empty |
| GitHub Actions (SPA) | ✅ | ✅ | ✅ | ✅ |
| GitHub Actions (Functions) | ✅ | ❌ | ✅ | ❌ |
| `recording:recording:view` permission | ✅ | ✅ | ❌ | ❌ |
| Analytics permission | ✅ | ✅ | ❌ | ❌ |
| Telephony permission | ✅ | ❌ | ✅ | ❌ |
| Architect permission | ✅ | ❌ | ❌ | ✅ |

---

## 9. Alternative: Monorepo with Build Script

Instead of separate repos, you could keep a **single repo** and use a build tool to produce separate bundles:

```bash
# Example with a simple script
node build.js --features=copilot      # Outputs dist-copilot/
node build.js --features=trunks       # Outputs dist-trunks/
node build.js --features=all          # Outputs dist-full/
```

**Pros:**

- Single source of truth — shared core stays in sync
- No copy-paste drift between repos
- Can automate with CI/CD matrix builds

**Cons:**

- Adds a build step (currently zero-build)
- Requires tooling (Vite, Rollup, or custom script)
- More CI/CD complexity
- Overkill for 2-3 variants

**When to consider:** If you expect 4+ product variants or frequent shared-core changes.

---

## 10. Decision Matrix

| # of Variants | Churn in Shared Core | Recommendation |
| --- | --- | --- |
| 2-3 | Low | Separate repos (simplest) |
| 2-3 | High | Separate branches in one repo |
| 4+ | Any | Monorepo with build script |
| 1 (dev only) | N/A | Keep as-is |

---

## Summary

For your current use case (developer app, 2-3 customer variants), **separate repos** is the recommended approach. The shared core is small (~10 files), feature code is already isolated by folder, and there's no build step to complicate things. Each customer gets a clean, minimal app with only the features they've licensed.
