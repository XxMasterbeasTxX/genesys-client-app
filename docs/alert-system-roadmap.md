# Alert System — Status & Pending Items

> Step 1 (foundation) and Step 2 (SMS execution) are complete and deployed.

---

## What's Done

### Step 1 — Foundation

- **Backend:** `alertConfig` HTTP function (GET/PUT) storing threshold, cooldown, and channel config in Azure Table Storage (`AlertConfig` / `AlertState` tables)
- **Backend:** `collectTrunkMetrics` detects threshold breaches every 1 minute, respects cooldown, tracks breach state
- **Frontend:** 🔔 Alerts slide-out panel on Activity page — configure threshold, cooldown, channel toggles
- **Frontend:** Dynamic threshold for warning banner + chart reference line (loaded from backend)

### Step 2 — SMS Data Action Execution

- **Backend:** `api/shared/channelConfig.js` — single source of truth for notification channel definitions (action ID, required fields, hidden defaults). Reusable by any Azure Function.
- **Backend:** `alertConfig` GET response now includes `channelDefs` so the frontend renders dynamic per-channel fields without hardcoding
- **Backend:** `alertConfig` PUT persists per-channel field values (recipient, sender, text for SMS)
- **Backend:** `collectTrunkMetrics` → `executeChannelAction()` merges user-saved fields with channel defaults, resolves `{{totalCalls}}` / `{{threshold}}` placeholders, POSTs to `POST /api/v2/integrations/actions/{actionId}/execute`
- **Backend:** Optional/empty fields are stripped from the payload — only required fields are sent to avoid downstream provider rejections
- **Frontend:** Alert panel dynamically renders per-channel input fields (Phone Number, Sender Name, Message) from backend definitions; fields show/hide with the channel toggle
- **SMS Data Action ID:** `custom_-_3af155c2-20c5-4c44-babf-f0a9eb041a47`

---

## What's Missing (Step 3+)

### 1. Email Channel

The Email channel is defined as a placeholder in `channelConfig.js` with `actionId: null`. To wire it up:

1. Create an Email Data Action in Genesys Cloud (e.g. using the Agentless Email API)
2. Add the `actionId` and `fields` array to the email entry in `channelConfig.js`
3. Deploy — the frontend and backend will pick it up automatically

### 2. Frontend Validation for SMS Fields

Currently the alert panel does not validate field values before saving. Consider adding:

- Sender name: max 11 alphanumeric characters, no spaces (provider requirement)
- Phone number: international format validation (`+` prefix, digits only)
- Message: non-empty check

### 3. Alert History / Audit Log (Optional)

Currently breach events are only logged to Azure Function logs. Consider:

- A new `AlertHistory` table storing each alert sent (timestamp, channel, threshold, call count, success/failure)
- A frontend view to see past alerts

### 4. Multiple Threshold Levels (Optional)

Current design: single threshold value. Future option: warning vs. critical levels with different actions per level.

---

## Required Genesys Cloud Permissions

The OAuth Client Credentials grant used by the Function App needs:

| Permission | Purpose | Status |
| ---------- | ------- | ------ |
| `telephony:plugin:all` | Read trunk metrics | ✅ In use |
| `integrations:action:execute` | Execute Data Actions (SMS/Email) | ✅ In use |

---

## Architecture

```text
channelConfig.js (single source of truth)
        │
        ├── alertConfig GET  → serves definitions to frontend
        ├── alertConfig PUT  → validates + stores per-channel field values
        └── collectTrunkMetrics → builds payload + executes Data Action
```

Adding a new channel: add an entry to `channelConfig.js` with `key`, `label`, `actionId`, `defaults`, and `fields`. Everything else adapts automatically.
