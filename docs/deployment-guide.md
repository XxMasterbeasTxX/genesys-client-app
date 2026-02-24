# Genesys Client App — Customer Deployment Guide

Complete step-by-step guide for deploying the Genesys Client App at a new customer environment. Follow every section in order.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [GitHub Repository Setup](#2-github-repository-setup)
3. [Genesys Cloud Configuration](#3-genesys-cloud-configuration)
4. [Azure Static Web App (SPA Hosting)](#4-azure-static-web-app-spa-hosting)
5. [Azure Storage Account](#5-azure-storage-account)
6. [Azure Function App (Backend)](#6-azure-function-app-backend)
7. [Application Configuration](#7-application-configuration)
8. [GitHub Secrets & CI/CD](#8-github-secrets--cicd)
9. [First Deployment](#9-first-deployment)
10. [Verification Checklist](#10-verification-checklist)
11. [Genesys Cloud Premium App Integration](#11-genesys-cloud-premium-app-integration)
12. [Ongoing Maintenance](#12-ongoing-maintenance)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Prerequisites

Before starting, ensure you have:

| Requirement | Details |
| --- | --- |
| **Genesys Cloud org** | Admin access to create OAuth clients and roles |
| **Azure subscription** | With permissions to create Resource Groups, Static Web Apps, Function Apps, and Storage Accounts |
| **GitHub account** | Repository access and admin permissions to configure secrets |
| **Node.js 20+** | For local development/testing only |

---

## 2. GitHub Repository Setup

### 2.1 Create or Fork the Repository

1. Create a new **private** repository on GitHub (e.g. `genesys-client-app`)
2. Push all source code to the `main` branch
3. Ensure the repository has this structure:

```text
├── index.html
├── css/
├── js/
├── api/
├── docs/
└── .github/workflows/
```

### 2.2 Branch Protection (Recommended)

- Go to **Settings → Branches → Add rule**
- Branch name pattern: `main`
- Enable: *Require a pull request before merging* (optional for small teams)

---

## 3. Genesys Cloud Configuration

You need **two** OAuth clients — one for the front-end (browser) and one for the backend (Azure Functions).

### 3.1 OAuth Client — Front-End (PKCE)

This client authenticates users via the browser using Authorization Code + PKCE.

1. Go to **Admin → Integrations → OAuth**
2. Click **Add Client**
3. Configure:

| Field | Value |
| --- | --- |
| App Name | `Genesys Client App` (or customer preference) |
| Grant Type | **Authorization Code** |
| Authorized redirect URI | The SWA URL (set after Step 4), e.g. `https://<swa-hostname>.azurestaticapps.net` |

1. Under **Scope**, ensure these are available:
   - `openid`
   - `profile`
   - `email`

2. Under **Roles**, assign the roles needed for the features being used:
   - **Telephony** → needed for trunk activity/history dashboards
   - **Analytics** → `analytics:conversationDetail:view` — needed for Agent Copilot Checklists (conversation detail queries)
   - **Conversation** → `conversation:communication:view` — needed to fetch conversation participants and checklist data
   - **Assistants** → `assistants:assistant:view`, `assistants:queue:view` — needed to list copilot assistants and their queue assignments
   - **Routing** → `routing:queue:view`, `routing:queue:member:view` — needed to resolve queue names and list queue members for the agent filter
   - Additional roles depending on which dashboard pages are enabled

3. Click **Save**
4. **Copy the Client ID** — you'll need it for `js/config.js`

> **Note:** PKCE clients do NOT have a client secret. The Client ID is public and safe to store in front-end code.

### 3.2 OAuth Client — Backend (Client Credentials)

This client is used by Azure Functions for server-to-server API calls (no user context).

1. Go to **Admin → Integrations → OAuth**
2. Click **Add Client**
3. Configure:

| Field | Value |
| --- | --- |
| App Name | `Genesys Client App - Backend` |
| Grant Type | **Client Credentials** |

1. Under **Roles**, assign:
   - **Telephony Admin** (or a custom role with `telephony:plugin:all` permission) — needed to read trunk metrics   - **Integration** permissions — `integrations:action:execute` — needed for SMS/Email Data Action execution
2. Click **Save**
3. **Copy both the Client ID and Client Secret** — you'll need them for Azure Function App environment variables

> ⚠️ **Never commit the Client Secret to source code.** It is stored as an Azure Function App environment variable only.

### 3.3 Identify the Region

Determine the customer's Genesys Cloud region. Common values:

| Region | Domain |
| --- | --- |
| EMEA (Frankfurt) | `mypurecloud.de` |
| US East | `mypurecloud.com` |
| US West | `usw2.pure.cloud` |
| AP (Sydney) | `mypurecloud.com.au` |
| AP (Tokyo) | `mypurecloud.jp` |
| EU (Ireland) | `mypurecloud.ie` |
| EU (London) | `euw2.pure.cloud` |
| Canada | `cac1.pure.cloud` |
| AP (Mumbai) | `aps1.pure.cloud` |
| AP (Seoul) | `apne2.pure.cloud` |
| SA (São Paulo) | `sae1.pure.cloud` |

You'll use this value in both `js/config.js` (front-end) and `GC_REGION` (backend).

---

## 4. Azure Static Web App (SPA Hosting)

### 4.1 Create the Static Web App

1. Go to **Azure Portal → Create a resource → Static Web App**
2. Configure:

| Field | Value |
| --- | --- |
| Subscription | Customer subscription |
| Resource group | Create new or use existing (e.g. `genesys-app-rg`) |
| Name | e.g. `genesys-client-app` |
| Plan type | **Free** (sufficient for this app) |
| Region | Closest to the customer |
| Source | **GitHub** |
| Organisation | Your GitHub org/account |
| Repository | The repo from Step 2 |
| Branch | `main` |

1. In **Build Details**:

| Field | Value |
| --- | --- |
| Build Preset | **Custom** |
| App location | `/` |
| API location | *(leave empty)* |
| Output location | *(leave empty)* |

1. Click **Review + Create → Create**

Azure will automatically create a GitHub Actions workflow file (e.g. `azure-static-web-apps-*.yml`) and commit it to the repo.

### 4.2 Note the SWA URL

After creation, go to **Overview** and copy the **URL**, e.g.:

```text
https://happy-rock-0a1b2c3d4.2.azurestaticapps.net
```

You'll need this for:

- Genesys OAuth redirect URI (Step 3.1)
- `oauthRedirectUri` in `js/config.js` (Step 7)
- CORS on the Function App (Step 6)

### 4.3 Configure the SWA Workflow

The auto-generated workflow should have `skip_app_build: true` since there is no build step. Verify it includes:

```yaml
skip_app_build: true
```

If not, edit the workflow file to add it under the `with:` block.

---

## 5. Azure Storage Account

The Storage Account stores trunk metrics time-series data in Table Storage and is also used by Azure Functions for internal bookkeeping (timer trigger schedule tracking).

### 5.1 Create the Storage Account

1. Go to **Azure Portal → Create a resource → Storage account**
2. Configure:

| Field | Value |
| --- | --- |
| Subscription | Same as above |
| Resource group | Same as Step 4 (e.g. `genesys-app-rg`) |
| Storage account name | Globally unique, lowercase, no hyphens (e.g. `genesysappstorage123`) |
| Region | Same region as the Function App (next step) |
| Performance | **Standard** |
| Redundancy | **LRS** (Locally-redundant) — sufficient for metrics data |

1. Under **Advanced**:
   - Default settings are fine

2. Click **Review + Create → Create**

### 5.2 Copy the Connection String

1. Go to the new Storage Account → **Access keys** (under Security + networking)
2. Click **Show** next to key1
3. Copy the **Connection string** — you'll need it for two Function App environment variables

> ⚠️ Treat this connection string as a secret. Never commit it to code.

---

## 6. Azure Function App (Backend)

### 6.1 Create the Function App

1. Go to **Azure Portal → Create a resource → Function App**
2. Configure:

| Field | Value |
| --- | --- |
| Subscription | Same as above |
| Resource group | Same (e.g. `genesys-app-rg`) |
| Function App name | e.g. `genesys-app-functions` (will become part of the URL) |
| Runtime stack | **Node.js** |
| Version | **20 LTS** |
| Region | Same as the Storage Account |
| Operating System | **Windows** |
| Plan type | **Consumption (Serverless)** |

1. Under **Storage**:
   - Select the Storage Account created in Step 5
   - Or link it later via environment variables

2. Click **Review + Create → Create**

### 6.2 Note the Function App URL

After creation, go to **Overview** and note the **Default domain**, e.g.:

```text
genesys-app-functions-abc123def.swedencentral-01.azurewebsites.net
```

> **Important:** The actual domain may include a random hash. Use the exact URL shown in the portal.

### 6.3 Configure Environment Variables

Go to **Settings → Environment variables** (or Configuration → Application settings) and add:

| Name | Value | Purpose |
| --- | --- | --- |
| `GC_CLIENT_ID` | Client ID from Step 3.2 | Backend OAuth authentication |
| `GC_CLIENT_SECRET` | Client Secret from Step 3.2 | Backend OAuth authentication |
| `GC_REGION` | e.g. `mypurecloud.de` | Genesys Cloud API region |
| `TABLE_STORAGE_CONNECTION` | Connection string from Step 5.2 | Table Storage access |
| `AzureWebJobsStorage` | Connection string from Step 5.2 (same value) | Required by timer triggers for schedule tracking |
| `WEBSITE_RUN_FROM_PACKAGE` | `1` | Ensures the Function App loads the latest deployed code without requiring a manual restart after each deployment |

> `TABLE_STORAGE_CONNECTION` and `AzureWebJobsStorage` use the **same** connection string value. Both are required.
>
> `WEBSITE_RUN_FROM_PACKAGE=1` is the recommended setting for Azure Functions on the Consumption plan. Without it, the host may serve stale code after deployment until manually restarted.

Click **Save** after adding all variables. The Function App will restart.

### 6.4 Configure CORS

1. Go to the Function App → **API → CORS**
2. Add the SWA URL as an allowed origin:

   ```text
   https://happy-rock-0a1b2c3d4.2.azurestaticapps.net
   ```

3. Click **Save**

> Do NOT check "Enable Access-Control-Allow-Credentials" unless specifically needed.

### 6.5 Enable SCM Basic Auth (Required for GitHub Actions Deploy)

1. Go to the Function App → **Settings → Configuration → General settings**
2. Under **Platform settings**, ensure **SCM Basic Auth Publishing Credentials** is **On**
3. Click **Save**

### 6.6 Download the Publish Profile

1. Go to the Function App → **Overview**
2. Click **Get publish profile** (top toolbar) — a `.PublishSettings` file downloads
3. Open the file in a text editor and **copy the entire contents** — you'll need it for the GitHub secret in Step 8

---

## 7. Application Configuration

### 7.1 Front-End Config — `js/config.js`

Update these values for the customer:

```javascript
const REGION = "mypurecloud.de";          // ← Customer's Genesys region

export const CONFIG = {
  region: REGION,
  authHost: `login.${REGION}`,            // Auto-derived from REGION
  apiBase: `https://api.${REGION}`,       // Auto-derived from REGION
  appName: "Genesys Tool",                // ← Customise if needed

  oauthClientId: "xxxxxxxx-xxxx-...",     // ← PKCE Client ID from Step 3.1

  oauthRedirectUri: "https://...",        // ← Exact SWA URL from Step 4.2

  oauthScopes: ["openid", "profile", "email"],

  functionsBase: "https://...",           // ← Full Function App URL from Step 6.2

  router: { mode: "hash" }
};
```

**Values to change per customer:**

| Property | Source |
| --- | --- |
| `REGION` | Customer's Genesys region (Step 3.3) |
| `oauthClientId` | PKCE OAuth Client ID (Step 3.1) |
| `oauthRedirectUri` | SWA URL (Step 4.2) — must match exactly |
| `functionsBase` | Function App URL with `https://` prefix (Step 6.2) |

### 7.2 Feature Configs

These files contain customer-tunable settings. Adjust as needed:

**`js/pages/dashboards/trunks/trunkConfig.js`** — Live trunk activity:

| Setting | Default | Description |
| --- | --- | --- |
| `POLL_INTERVAL_MS` | `15000` | REST polling fallback interval (ms) when WebSocket is unavailable |
| `METRICS_BATCH_SIZE` | `100` | Max trunk IDs per API call |
| `CHART_HISTORY_MAX` | `120` | Rolling chart data points |
| `CHART_COLOURS` | Blue, green, … | 10-colour palette for chart lines |

**`js/pages/dashboards/trunks/alertConfig.js`** — Alert defaults:

| Setting | Default | Description |
| --- | --- | --- |
| `DEFAULT_THRESHOLD` | `0` | Default threshold value when no config is saved (0 = disabled) |
| `DEFAULT_COOLDOWN_MINUTES` | `15` | Default cooldown between backend alerts |

> **Note:** The alert threshold, cooldown, and per-channel fields (phone number, sender, message) are all configurable from the in-app **🔔 Alerts** panel on the Activity page, and stored in Azure Table Storage (`AlertConfig` table).
>
> Channel definitions (which channels exist, their Data Action IDs, and which fields to show) are driven by `api/shared/channelConfig.js` on the backend. The frontend loads them dynamically — no frontend changes needed to add a new channel.

**`js/pages/dashboards/trunks/historyConfig.js`** — Trunk history:

| Setting | Default | Description |
| --- | --- | --- |
| `DEFAULT_RANGE_DAYS` | `7` | Date range shown on page load |
| `CHART_AVG_COLOUR` | `#3b82f6` | Colour for the dashed average line |
| `CHART_LINE_COLOUR` | `#3b82f6` | Main line colour |
| `CHART_PEAK_COLOUR` | `#ef4444` | Peak marker colour |

**`js/pages/dashboards/agent-copilot/checklistConfig.js`** — Agent Copilot Checklists:

| Setting | Default | Description |
| --- | --- | --- |
| `DEFAULT_RANGE_DAYS` | `7` | Default date range shown on page load |
| `RANGE_PRESETS` | Today, 7d, 30d | Preset period buttons shown in the toolbar |
| `MAX_INTERVAL_DAYS` | `31` | Maximum query interval (Genesys API limit) |
| `QUERY_PAGE_SIZE` | `100` | Max conversations per analytics query page |
| `ENRICHMENT_BATCH` | `10` | Number of conversations enriched in parallel |
| `QUEUE_RESOLVE_BATCH` | `10` | Number of queue-name lookups run in parallel |
| `MEDIA_KEYS` | 7 media types | Communication keys to extract from conversation participants |
| `TICK_STATE` | `Ticked/Unticked` | API tick state values (frozen enum) |
| `STATUS_FILTER` | `all/complete/incomplete` | Client-side filter values (frozen enum) |
| `CHART_CONFIG.title` | `Checklist Completion` | Bar chart heading text |
| `CHART_CONFIG.titleColor` | `#e0e0e0` | Chart title colour (dark-mode fallback; overridden by `--chart-title` CSS variable) |
| `CHART_CONFIG.titleFontSize` | `13` | Chart title font size (px) |
| `CHART_CONFIG.axisColor` | `#aaa` | Axis tick/label colour (dark-mode fallback; overridden by `--chart-text` CSS variable) |
| `CHART_CONFIG.axisFontSize` | `11` | Axis tick font size (px) |
| `CHART_CONFIG.gridColor` | `rgba(255,255,255,0.06)` | Horizontal grid line colour (dark-mode fallback; overridden by `--chart-grid` CSS variable) |
| `CHART_CONFIG.completeColor` | `rgba(74,222,128,0.7)` | "Complete" bar fill colour |
| `CHART_CONFIG.incompleteColor` | `rgba(251,191,36,0.7)` | "Incomplete" bar fill colour |
| `CHART_CONFIG.borderRadius` | `4` | Bar corner radius (px) |
| `CHART_CONFIG.barPercentage` | `0.6` | Fraction of width each bar occupies |
| `EXPORT_FILENAME_PREFIX` | `Agent_Checklists` | Excel filename prefix (date is appended) |
| `EXPORT_INTERACTION_COLS` | 8 columns | Column widths for Sheet 1 (Interactions) |
| `EXPORT_ITEM_COLS` | 7 columns | Column widths for Sheet 2 (Checklist Items) |
| `LABELS` | Various | All UI button text, badge labels, and chart axis labels |

### 7.3 Collection Interval — `api/collectTrunkMetrics/function.json`

The timer schedule controls how often trunk metrics are collected:

```json
"schedule": "0 * * * * *"
```

This is a **6-field CRON expression** (second minute hour day month day-of-week):

| Interval | CRON Value |
| --- | --- |
| Every 1 minute | `0 * * * * *` |
| Every 5 minutes | `0 */5 * * * *` |
| Every 15 minutes | `0 */15 * * * *` |
| Every hour | `0 0 * * * *` |

**Trade-offs:**

- 1-minute: Best peak detection, ~43,200 rows/month, still within free tier
- 5-minute: Good for most use cases, ~8,640 rows/month
- 15-minute: Lightweight, may miss short peaks

### 7.4 Navigation — `js/navConfig.js`

Enable or disable dashboard sections by setting `enabled: true/false` on any node. Disabled nodes (and all descendants) are hidden from the sidebar and routing.

### 7.5 Light / Dark Theme

The app automatically follows the browser / OS colour scheme. No configuration is needed — it works out of the box via `@media (prefers-color-scheme: light)` in `css/styles.css`.

- **CSS variables** (`--bg`, `--panel`, `--text`, `--border`, etc.) are overridden inside the light-mode media query.
- **Chart.js** axis labels, grid lines, and title colours are read from three additional CSS custom properties at render time: `--chart-text`, `--chart-grid`, `--chart-title`.
- A `matchMedia` change listener in each chart page (Activity, History, Agent Checklists) destroys and re-creates the chart automatically when the OS theme switches, so colours update without a page reload.

To **customise** light-mode colours, edit the `@media (prefers-color-scheme: light)` block at the bottom of `css/styles.css`.

### 7.6 Backend Region — `api/shared/gcConfig.js`

The backend reads `GC_REGION` from environment variables (set in Step 6.3). The fallback default is `mypurecloud.de`. No code change needed if the environment variable is set correctly.

### 7.7 Notification Channels — `api/shared/channelConfig.js`

This file is the **single source of truth** for all notification channels (SMS, Email, etc.). The frontend loads channel definitions from the backend — no frontend changes are needed when adding or modifying channels.

**SMS channel** is pre-configured with:

| Property | Value |
| --- | --- |
| `actionId` | The Genesys Cloud Data Action ID for the SMS integration |
| `defaults.encoding` | `gsm7` (hidden, not shown to users) |
| `fields` | Phone Number (tel), Sender Name (text), Message (textarea) |

**To configure for a new customer:**

1. Create (or identify) the SMS Data Action in Genesys Cloud (**Admin → Integrations → Actions**)
2. Ensure the Data Action is **published** (not just a draft)
3. Update the `actionId` in `channelConfig.js` to match the customer's Data Action ID
4. Ensure the backend OAuth client (Step 3.2) has `integrations:action:execute` permission

**SMS sender field constraints** (enforced by the downstream SMS provider):

- Alphanumeric: max **11 characters**, letters and digits only (`[A-Za-z0-9]`), **no spaces**
- Numeric: max **15 digits**

**Message template placeholders:**

| Placeholder | Replaced with |
| --- | --- |
| `{{totalCalls}}` | Current total concurrent calls at breach time |
| `{{threshold}}` | Configured threshold value |

**Email channel** is a placeholder entry (`actionId: null`). To enable it, add the Data Action ID and define the `fields` array in the same format as SMS.

---

## 8. GitHub Secrets & CI/CD

### 8.1 Add GitHub Secrets

Go to the GitHub repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret Name | Value | Purpose |
| --- | --- | --- |
| `AZURE_STATIC_WEB_APPS_API_TOKEN_*` | Auto-created by Azure SWA setup (Step 4) | SPA deployment. Check the workflow file for the exact secret name. |
| `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` | Full contents of the `.PublishSettings` file (Step 6.6) | Azure Functions deployment |

> If the SWA secret was not created automatically, find it in Azure Portal → Static Web App → **Manage deployment token** → copy and add manually.

### 8.2 CI/CD Workflows

Two workflows are included and trigger automatically:

| Workflow | File | Trigger | Deploys |
| --- | --- | --- | --- |
| SPA | `.github/workflows/azure-static-web-apps-*.yml` | Push to `main` | Front-end to Azure SWA |
| Functions | `.github/workflows/deploy-functions.yml` | Push to `main` (paths: `api/**`) | Backend to Azure Function App |

**`deploy-functions.yml`** — update the `app-name` if the Function App has a different name:

```yaml
- name: Deploy to Azure Functions
  uses: Azure/functions-action@v1
  with:
    app-name: genesys-app-functions    # ← Must match the Function App name
    package: api
    publish-profile: ${{ secrets.AZURE_FUNCTIONAPP_PUBLISH_PROFILE }}
```

---

## 9. First Deployment

### 9.1 Commit and Push

After updating all configuration files:

```bash
git add -A
git commit -m "feat: configure for customer deployment"
git push origin main
```

### 9.2 Monitor Deployments

1. Go to **GitHub → Actions** tab
2. Verify both workflows complete successfully (green checkmark):
   - `Azure Static Web Apps CI/CD` — deploys the SPA
   - `Deploy Azure Functions` — deploys the backend

### 9.3 Update Genesys OAuth Redirect URI

If you didn't set the redirect URI in Step 3.1 (because the SWA URL wasn't known yet):

1. Go to **Genesys Admin → Integrations → OAuth → your PKCE client**
2. Set the **Authorized redirect URI** to the exact SWA URL
3. Save

---

## 10. Verification Checklist

Run through these checks after deployment:

### Front-End

- [ ] Open the SWA URL in a browser
- [ ] Confirm the OAuth login redirects to Genesys Cloud
- [ ] After login, verify the sidebar navigation appears
- [ ] Switch the browser / OS to light mode → confirm the app switches to a light colour scheme automatically (and back to dark when reverted)
- [ ] Navigate to **Dashboards → Trunks → Activity** — confirm live data appears
- [ ] Navigate to **Dashboards → Trunks → History** — confirm the chart loads (may say "No data" initially)
- [ ] Navigate to **Dashboards → Agent Copilot → Agent Checklists**:
  - [ ] Verify copilot assistants load in the first dropdown
  - [ ] Select a copilot → verify queues cascade into the second dropdown
  - [ ] Select a queue → verify agents cascade into the third dropdown
  - [ ] Click a period preset or set custom dates (max 31 days) and click Search
  - [ ] Confirm interactions appear and enrich with checklist data
  - [ ] Click a row with a checklist → verify drill-down shows checklist items with tick status
  - [ ] Test status filter buttons (All / Completed / Incomplete)
  - [ ] Verify the completion bar chart appears above the table showing Complete vs Incomplete counts
  - [ ] After enrichment completes, verify the **⬇ Export Excel** button appears in the top-right header
  - [ ] Click Export Excel → a new tab opens with a Save button → click Save → verify a two-sheet XLSX downloads
  - [ ] If pop-ups are blocked, allow pop-ups for the site and retry

### Backend

- [ ] In Azure Portal, go to Function App → **Functions** — verify `alertConfig`, `collectTrunkMetrics`, and `getTrunkHistory` are listed
- [ ] Check **Function App → Monitor → Logs** — look for `"Found X external trunk(s)"` messages from the timer
- [ ] Wait a few minutes, then reload the History page — data points should appear
- [ ] Open the Activity page → click 🔔 **Alerts** → set threshold to 1, enable SMS, fill in phone/sender/message → Save → verify an SMS is received when a call is active
- [ ] Test the HTTP endpoint directly:

  ```text
  https://<function-app-url>/api/getTrunkHistory?from=2026-01-01T00:00:00Z&to=2026-12-31T23:59:59Z
  ```

  Should return JSON with `count` and `data` array

### Connectivity

- [ ] No CORS errors in browser console when loading History page
- [ ] Function App logs show successful Genesys Cloud API calls (not 401/403)

---

## 11. Genesys Cloud Premium App Integration

To embed the app inside the Genesys Cloud client interface:

1. Go to **Admin → Integrations → Integrations**
2. Click **+ Add Integration**
3. Search for **Premium App** and install it
4. Configure:

| Field | Value |
| --- | --- |
| Application URL | The SWA URL (e.g. `https://happy-rock-0a1b2c3d4.2.azurestaticapps.net`) |
| Application Type | `iframe` |
| Sandbox | `allow-scripts allow-same-origin allow-forms allow-popups` |

1. Under **Configuration → Properties**, set:
   - **Display Type**: `standalone` or `widget` depending on where it should appear

2. Activate the integration

> The app detects whether it's running inside a Genesys Cloud iframe or a standalone browser tab and adapts its fullscreen behaviour accordingly.

---

## 12. Ongoing Maintenance

### Updating the App

1. Make code changes locally
2. Commit and push to `main`
3. CI/CD deploys automatically

### Monitoring

- **Function App health**: Azure Portal → Function App → **Monitor**
- **Timer execution**: Check `collectTrunkMetrics` invocation logs
- **Storage costs**: Azure Portal → Storage Account → **Insights** (Table Storage rows grow over time)

### Rotating Secrets

| Secret | How to Rotate |
| --- | --- |
| Genesys Client Secret (backend) | Create new secret in Genesys Admin → update `GC_CLIENT_SECRET` in Function App env vars → delete old secret |
| Storage Connection String | Regenerate key in Storage Account → update `TABLE_STORAGE_CONNECTION` and `AzureWebJobsStorage` in Function App env vars |
| Function App Publish Profile | Download new profile from Function App → update `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` in GitHub Secrets |
| SWA Deploy Token | Get new token from SWA → update the `AZURE_STATIC_WEB_APPS_API_TOKEN_*` GitHub Secret |

### Cost Estimates (Free Tier)

| Resource | Free Tier Limit | Estimated Usage (1-min collection) |
| --- | --- | --- |
| Azure Static Web App | Free plan | Well within limits |
| Azure Functions | 1M executions/month | ~43,200 timer + HTTP calls |
| Azure Table Storage | 1 GB free (first 12 months) | ~5 MB/month at 1-min intervals |

---

## 13. Troubleshooting

### Function App serves stale code after deployment

- **Cause**: `WEBSITE_RUN_FROM_PACKAGE` is not set
- **Fix**: Add `WEBSITE_RUN_FROM_PACKAGE` = `1` in Function App → Settings → Environment variables. This ensures the runtime loads the deployed zip package directly.

### "Function Host is not running"

- **Cause**: Azure Functions host crashed or cold-start failure
- **Fix**: Restart the Function App (Overview → Restart). If persistent, Stop → wait 30s → Start.

### 401/403 from Genesys API (backend)

- **Cause**: Invalid or expired Client Credentials
- **Fix**: Verify `GC_CLIENT_ID`, `GC_CLIENT_SECRET`, and `GC_REGION` in Function App env vars. Confirm the OAuth client has the correct roles assigned.

### CORS errors in browser console

- **Cause**: Function App CORS not configured or URL mismatch
- **Fix**: Function App → API → CORS → ensure the exact SWA URL is listed (including `https://`, no trailing slash).

### "No data for this period" on History page

- **Cause**: Timer hasn't run yet or no trunks exist
- **Fix**: Wait for at least one timer execution (check Function App logs). Verify trunks exist in Genesys Admin → Telephony → Trunks → External Trunks.

### GitHub Actions deploy fails with 401

- **Cause**: Publish profile expired or SCM Basic Auth disabled
- **Fix**: Enable SCM Basic Auth (Function App → Settings → Configuration → General settings). Re-download the publish profile and update the GitHub secret.

### "Scale out issues detected" warning

- **Cause**: Usually secondary to a host crash — the scale controller has nothing to monitor
- **Fix**: Resolve the underlying host error first (usually a restart). This warning clears on its own.

### OAuth redirect fails (SPA)

- **Cause**: Redirect URI mismatch between `config.js` and Genesys OAuth client
- **Fix**: The `oauthRedirectUri` in `config.js` must match **exactly** what is configured in Genesys Admin → OAuth client → Authorized redirect URIs (including protocol, no trailing slash).

### Agent Checklists — "No copilot-enabled assistants found"

- **Cause**: No assistants with copilot enabled exist, or the OAuth client lacks `assistants:assistant:view` permission
- **Fix**: Verify copilot assistants are configured in Genesys Admin → Performance → Agent Copilot. Ensure the PKCE OAuth client has the **Assistants** role.

### Agent Checklists — all interactions show "No checklist"

- **Cause**: Missing `conversation:communication:view` permission, or the OAuth client cannot access the agent checklists API
- **Fix**: Ensure the PKCE OAuth client has the **Conversation** role with `conversation:communication:view`. Verify in browser DevTools console — look for `[Checklists]` log entries with 403/404 errors.

### Agent Checklists — "The selected period spans X days"

- **Cause**: The Genesys analytics API rejects intervals exceeding 31 days
- **Fix**: Select a shorter date range. The maximum is enforced client-side and configured via `MAX_INTERVAL_DAYS` in `checklistConfig.js`.

### Agent Checklists — Excel export opens blank tab or nothing happens

- **Cause**: Pop-ups are blocked by the browser, or the `download.html` helper page is missing
- **Fix**: The app runs inside a cross-origin Genesys Cloud iframe where direct downloads are blocked. The export works by opening `download.html` in a new tab, which uses `showSaveFilePicker()` on a real user click. Ensure:
  1. Pop-ups are allowed for the site
  2. `download.html` exists in the repository root
  3. `js/lib/xlsx.full.min.js` is present (SheetJS library)

### Agent Checklists — bar chart not visible

- **Cause**: No enriched checklist data yet, or Chart.js not loaded
- **Fix**: The chart only appears after at least one interaction has been enriched with checklist data. Verify Chart.js loads from the CDN (`cdn.jsdelivr.net/npm/chart.js@4`). Chart styling can be adjusted in `CHART_CONFIG` within `checklistConfig.js`; chart container sizing is in `css/styles.css` (`.checklist-chart-wrap`).

---

## Quick Reference — All Customer-Specific Values

| Value | Where It Goes | Example |
| --- | --- | --- |
| Genesys region | `js/config.js` → `REGION` and Function App → `GC_REGION` | `mypurecloud.de` |
| PKCE OAuth Client ID | `js/config.js` → `oauthClientId` | `3b89b95c-...` |
| Backend OAuth Client ID | Function App → `GC_CLIENT_ID` | `a1b2c3d4-...` |
| Backend OAuth Client Secret | Function App → `GC_CLIENT_SECRET` | `xxxxxxxxx` |
| SWA URL | `js/config.js` → `oauthRedirectUri`, Function App CORS, Genesys OAuth redirect URI | `https://happy-rock-0a1b2c3d4.2.azurestaticapps.net` |
| Function App URL | `js/config.js` → `functionsBase` | `https://genesys-app-functions-abc.region.azurewebsites.net` |
| Storage Connection String | Function App → `TABLE_STORAGE_CONNECTION` and `AzureWebJobsStorage` | `DefaultEndpointsProtocol=https;...` |
| Function App name | `.github/workflows/deploy-functions.yml` → `app-name` | `genesys-app-functions` |
| Publish Profile | GitHub Secret → `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` | *(XML content)* |
| SWA Deploy Token | GitHub Secret → `AZURE_STATIC_WEB_APPS_API_TOKEN_*` | *(token string)* |
