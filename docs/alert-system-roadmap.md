# Alert System — Pending Items

> Reference for future implementation. The foundation (Step 1) is complete and deployed.

---

## What's Done (Step 1)

- **Backend:** `alertConfig` HTTP function (GET/PUT) storing threshold, cooldown, and channel toggles in Azure Table Storage
- **Backend:** `collectTrunkMetrics` detects threshold breaches every 1 minute, respects cooldown, tracks breach state in `AlertState` table
- **Frontend:** 🔔 Alerts slide-out panel on Activity page — configure threshold, cooldown, Email/SMS channel toggles
- **Frontend:** Dynamic threshold for warning banner + chart reference line (loaded from backend, no longer hardcoded)

---

## What's Missing (Step 2+)

### 1. Data Action Creation in Genesys Cloud

Before the backend can send alerts, two Genesys Cloud Data Actions must be created:

- **Email Data Action** — calls the Agentless Email API (`POST /api/v2/conversations/emails/agentless`)
- **SMS Data Action** — calls the Agentless SMS API (`POST /api/v2/conversations/messages/agentless`)

Each Data Action needs an input schema defining the required fields (e.g. `toAddress`, `subject`, `body` for email; `toAddress`, `messageBody` for SMS).

### 2. Per-Channel Configuration Fields

Once the Data Action input schemas are known, add per-channel fields to the alert panel:

| Channel | Fields Needed                      |
|---------|------------------------------------|
| Email   | To address, Subject, Body template |
| SMS     | Phone number, Message template     |

These should be stored in the `channels` object in the `AlertConfig` table, e.g.:

```json
{
  "email": { "enabled": true, "to": "...", "subject": "...", "body": "..." },
  "sms":   { "enabled": true, "phone": "...", "message": "..." }
}
```

**Frontend changes:** Add input fields per channel in the alert panel (conditionally shown when channel is enabled).  
**Backend changes:** `alertConfig/index.js` PUT validation needs to accept and validate the new fields.

### 3. Data Action Execution from Backend

In `collectTrunkMetrics/index.js`, the `checkThresholdBreach()` function currently logs the breach but does **not** call any Data Action. The placeholder is:

```text
// (Data Action execution reserved for future implementation.)
```

Implementation options:

- **Option A — Direct API call:** The Azure Function authenticates to Genesys Cloud (already does via Client Credentials) and calls the Data Action execute endpoint: `POST /api/v2/integrations/actions/{actionId}/execute`
- **Option B — Direct Agentless API:** Skip Data Actions entirely and call the Agentless Email/SMS endpoints directly from the Azure Function

Either way, the Function App's OAuth client needs the appropriate Genesys Cloud permissions.

### 4. Data Action IDs in Configuration

If using Option A, the Data Action IDs need to be stored somewhere:

- **App Setting (env var):** e.g. `GC_EMAIL_ACTION_ID`, `GC_SMS_ACTION_ID` — simplest
- **In AlertConfig table:** Add `actionId` per channel — more flexible but requires UI changes

### 5. Alert History / Audit Log (Optional)

Currently breach events are only logged to Azure Function logs. Consider:

- A new `AlertHistory` table storing each alert sent (timestamp, channel, threshold, call count)
- A frontend view to see past alerts

### 6. Multiple Threshold Levels (Optional)

Current design: single threshold value. Future option: warning vs. critical levels with different actions per level.

---

## Required Genesys Cloud Permissions

The OAuth Client Credentials grant used by the Function App will need these additional permissions when Data Actions are implemented:

| Permission | Purpose |
| ---------- | ------- |
| `integrations:action:execute` | Execute Data Actions |
| `conversation:email:create` | Agentless email (if calling API directly) |
| `conversation:message:create` | Agentless SMS (if calling API directly) |

---

## Decision Points Before Starting Step 2

1. **Which Data Action approach?** Option A (execute via Data Action) vs Option B (direct Agentless API)
2. **What are the exact input schemas?** Defines the per-channel fields
3. **Where to store Data Action IDs?** Env vars vs table config
4. **Is alert history needed?** Adds complexity but provides auditability
