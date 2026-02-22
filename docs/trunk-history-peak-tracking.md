# Trunk History — Peak Concurrent Call Tracking

> **Status:** Investigation complete — implementation deferred  
> **Date:** 2026-02-22  
> **Goal:** Allow users to view historical peak concurrent call levels across trunks (e.g. "last month's peak was 47 simultaneous calls at 10:30 AM on Jan 15th")

---

## Requirement

- Show **peak concurrent calls** over time — the maximum number of simultaneous active calls at any point.
- This is **not** total/cumulative call counts; it is **concurrency high-water marks**.
- Should cover all external trunks combined (big-picture view, not per-trunk).
- Users want to see peaks over configurable periods (day, week, month).

---

## Investigation Summary

### Why the Genesys Analytics API can't do this

| API Endpoint | What it provides | Why it doesn't fit |
| --- | --- | --- |
| `POST /api/v2/analytics/conversations/aggregates/query` | Interval totals (nConnected, nOffered) grouped by dimensions | Returns **total calls per bucket**, not concurrent call count. Also lacks `trunkId` dimension — only `edgeId`, which merges multiple trunks per edge. |
| `POST /api/v2/analytics/conversations/activity/query` | Real-time observations (oInteracting, oWaiting) | **Point-in-time only** — shows current state, no historical query capability. |
| `POST /api/v2/analytics/conversations/details/query` | Individual conversation records with timestamps | Could theoretically reconstruct concurrency by overlapping start/end times, but requires fetching every conversation record (100K+/month = heavy pagination). Brittle and API-heavy. |

### Key limitation: no `trunkId` dimension

The conversation aggregates API supports `edgeId` as a groupBy dimension but **not** `trunkId`. Multiple external trunks per edge is common (primary + failover carriers, regional trunks, inbound vs outbound separation), so `edgeId` grouping would merge trunk data together.

This limitation applies to aggregates only. The **trunk metrics endpoint** (`GET /api/v2/telephony/providers/edges/trunks/metrics`) does report per-trunk call counts — but only for the current moment.

---

## Recommended Solution: Azure Function Collector (Option B)

A lightweight serverless backend that periodically snapshots current trunk concurrency and stores it for historical queries.

### Architecture

```text
┌──────────────────────┐       every 5 min        ┌─────────────────────┐
│  Azure Function      │ ◄──── Timer Trigger ────► │  Genesys Cloud API  │
│  (collectTrunkMetrics)│                           │  /trunks/metrics    │
└──────────┬───────────┘                           └─────────────────────┘
           │ write
           ▼
┌──────────────────────┐
│  Azure Table Storage │  ← time-series rows: { timestamp, totalCalls, perTrunk }
└──────────┬───────────┘
           │ read
           ▼
┌──────────────────────┐       GET /api/trunk-history
│  Azure Function      │ ◄──── HTTP Trigger ──────── SPA (History page)
│  (getTrunkHistory)   │
└──────────────────────┘
```

### How it works

1. **Timer Function** runs every 1–5 minutes, 24/7, independently of whether the SPA is open.
2. It authenticates to Genesys Cloud using **Client Credentials** OAuth (no user session required).
3. It calls the trunk metrics endpoint, sums `inboundCallCount + outboundCallCount` across all external trunks, and writes a row to Table Storage.
4. **HTTP Function** serves the stored time-series to the SPA on demand.
5. The SPA renders a chart showing concurrency over time; peak = `MAX(totalCalls)` for any period.

### Data model (Azure Table Storage)

| Field | Value | Example |
| --- | --- | --- |
| `PartitionKey` | Year-month (efficient range queries) | `2026-01` |
| `RowKey` | ISO 8601 timestamp (natural sort) | `20260115T103000Z` |
| `totalCalls` | Sum of concurrent calls across all external trunks | `47` |
| `perTrunk` | Optional JSON with per-trunk breakdown | `{"TrunkA":25,"TrunkB":22}` |

### Storage estimates

| Interval | Rows/month | Size/month | Size/year |
| --- | --- | --- | --- |
| 1 minute | ~43,200 | ~2 MB | ~25 MB |
| 5 minutes | ~8,640 | ~0.5 MB | ~5 MB |

---

## Azure Resources Required

| Resource | Purpose | Cost |
| --- | --- | --- |
| **Azure Function App** (Consumption plan) | Hosts both timer + HTTP functions | Free tier: 1M executions/month included. ~8.6K–43K executions/month = well within free tier |
| **Azure Table Storage** | Stores time-series data | ~$0.045/GB/month. Negligible at this scale |
| **Azure Static Web Apps** | Already in place — hosts SPA and can link the Function App as its `/api` backend | Already deployed |

**Estimated monthly cost: $0** (within free tiers)

---

## Genesys Cloud Setup Required

- Create a new **OAuth Client** in Admin → Integrations → OAuth
  - Grant type: **Client Credentials**
  - Assign a role with `telephony:plugin:all` or equivalent (to read trunk metrics)
- Store `clientId` and `clientSecret` as Azure Function App **Application Settings** (environment variables)

> Note: This is separate from the existing PKCE OAuth client used by the SPA.

---

## SPA Changes Required

| Item | Change |
| --- | --- |
| **New nav item** | Trunks → History (in `navConfig.js`) |
| **New page** | `js/pages/dashboards/trunks/history.js` — date range picker, chart, peak summary |
| **Chart library** | Add Chart.js or similar (CDN or bundled) |
| **API call** | Fetch from `/api/trunk-history?from=...&to=...` |
| **`pageRegistry.js`** | Register the new route |

---

## Project Structure (new files)

```text
api/
  collectTrunkMetrics/
    index.js              ← Timer trigger: polls Genesys, writes to Table Storage
    function.json         ← Timer schedule config
  getTrunkHistory/
    index.js              ← HTTP trigger: reads Table Storage, returns JSON
    function.json         ← HTTP route config
  host.json               ← Function App runtime config
  local.settings.json     ← Local dev secrets (gitignored)
  package.json            ← Dependencies (e.g. @azure/data-tables)
```

---

## Important Notes

- **No retroactive data.** Collection starts from the moment the Function is deployed. A full month of history requires one month of collection.
- **The Function runs independently** of the SPA. It executes on Azure's servers on its own schedule — no user needs to have the app open.
- **5-minute granularity** is recommended to balance resolution vs. simplicity. 1-minute is possible but rarely needed for peak analysis.

---

## Next Steps (when ready to implement)

1. Create the Client Credentials OAuth client in Genesys Cloud Admin
2. Build the two Azure Functions (timer collector + HTTP reader)
3. Build the History page in the SPA with chart rendering
4. Configure Azure Function App settings with Genesys credentials
5. Deploy — push to GitHub, Azure Static Web Apps auto-deploys both SPA and Functions
