/**
 * collectTrunkMetrics — Timer Trigger (every 1 minute)
 *
 * 1. Authenticates to Genesys Cloud (Client Credentials)
 * 2. Fetches all external trunks
 * 3. Retrieves current concurrent-call metrics per trunk
 * 4. Stores a timestamped snapshot in Azure Table Storage
 * 5. Checks if total calls breach the configured threshold
 */

const { getGenesysToken } = require("../shared/genesysAuth");
const { storeMetric } = require("../shared/tableClient");
const { apiBase } = require("../shared/gcConfig");
const { getAlertConfig, getAlertState, saveAlertState } = require("../shared/alertStore");
const { channels: channelDefs } = require("../shared/channelConfig");

const BATCH_SIZE = 100; // max trunk IDs per metrics request

module.exports = async function (context) {

  try {
    // 1. Authenticate
    const token = await getGenesysToken();

    // 2. Get all external trunks (auto-paginated)
    const trunks = await getAllExternalTrunks(apiBase, token);
    context.log(`Found ${trunks.length} external trunk(s)`);

    if (!trunks.length) {
      context.log("No external trunks — skipping.");
      return;
    }

    // 3. Fetch metrics in batches
    const allMetrics = [];
    for (let i = 0; i < trunks.length; i += BATCH_SIZE) {
      const ids = trunks.slice(i, i + BATCH_SIZE).map((t) => t.id);
      const res = await apiRequest(
        apiBase,
        token,
        `/api/v2/telephony/providers/edges/trunks/metrics?trunkIds=${ids.join(",")}`,
      );
      const entities = res?.entities || res || [];
      allMetrics.push(...entities);
    }

    // 4. Aggregate — keep highest call count per trunk (handles dup instances)
    const perTrunk = {};
    for (const m of allMetrics) {
      const tid = m.trunk?.id;
      if (!tid) continue;
      const calls =
        (m.calls?.inboundCallCount || 0) + (m.calls?.outboundCallCount || 0);
      if (perTrunk[tid] === undefined || calls > perTrunk[tid]) {
        perTrunk[tid] = calls;
      }
    }

    const totalCalls = Object.values(perTrunk).reduce((s, c) => s + c, 0);

    // 5. Store snapshot
    const now = new Date();
    await storeMetric(now, totalCalls, perTrunk);

    context.log(
      `Stored: ${totalCalls} total calls across ${Object.keys(perTrunk).length} trunk(s) at ${now.toISOString()}`,
    );

    // 6. Threshold breach detection
    await checkThresholdBreach(context, totalCalls, now);
  } catch (err) {
    context.log.error("collectTrunkMetrics failed:", err.message || err);
    throw err; // surface to Azure monitoring
  }
};

/* ── Helpers ───────────────────────────────────────────── */

async function getAllExternalTrunks(apiBase, token) {
  const trunks = [];
  let page = 1;
  let total = Infinity;

  while (trunks.length < total) {
    const qs = new URLSearchParams({
      pageNumber: page,
      pageSize: 100,
      trunkType: "EXTERNAL",
    });
    const res = await apiRequest(
      apiBase,
      token,
      `/api/v2/telephony/providers/edges/trunks?${qs}`,
    );
    total = res.total ?? res.entities?.length ?? 0;
    if (res.entities) trunks.push(...res.entities);
    if (!res.entities?.length) break;
    page++;
  }

  return trunks;
}

async function apiRequest(apiBase, token, path) {
  const res = await fetch(`${apiBase}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `GC API ${path} failed: ${res.status} ${res.statusText} ${text}`,
    );
  }

  return res.json();
}

/* ── Threshold breach detection ────────────────────────── */

/**
 * Compares totalCalls against the saved threshold.
 * If threshold is 0 (disabled) → skip.
 * If breached and cooldown has elapsed → execute Data Actions for enabled channels.
 * Tracks breach state in AlertState table.
 */
async function checkThresholdBreach(context, totalCalls, now) {
  let config;
  try {
    config = await getAlertConfig();
  } catch (err) {
    context.log.warn("Could not read alert config — skipping breach check:", err.message);
    return;
  }

  // Threshold disabled
  if (!config.threshold || config.threshold <= 0) return;

  const breached = totalCalls >= config.threshold;

  let state;
  try {
    state = await getAlertState();
  } catch (err) {
    context.log.warn("Could not read alert state — skipping breach check:", err.message);
    return;
  }

  if (breached) {
    const cooldownMs = (config.cooldownMinutes || 0) * 60 * 1000;
    const lastTime = state.lastAlertTime ? new Date(state.lastAlertTime).getTime() : 0;
    const elapsed = now.getTime() - lastTime;

    if (!state.breachActive || elapsed >= cooldownMs) {
      // Determine which channels are enabled and have a wired Data Action
      const enabledChannels = Object.entries(config.channels || {})
        .filter(([, v]) => v.enabled)
        .map(([k]) => k);

      context.log.warn(
        `⚠ THRESHOLD BREACH: ${totalCalls} calls ≥ ${config.threshold}. ` +
          `Enabled channels: [${enabledChannels.join(", ") || "none"}].`,
      );

      // Execute Data Action for each enabled channel that has an actionId
      const token = await getGenesysToken();
      for (const chKey of enabledChannels) {
        await executeChannelAction(context, token, chKey, config, totalCalls);
      }

      await saveAlertState({
        breachActive: true,
        lastAlertTime: now.toISOString(),
      });
    } else {
      context.log(
        `Threshold breached (${totalCalls} ≥ ${config.threshold}) but cooldown active ` +
          `(${Math.round((cooldownMs - elapsed) / 60000)} min remaining).`,
      );
    }
  } else if (state.breachActive) {
    // Breach cleared
    context.log(`Threshold cleared (${totalCalls} < ${config.threshold}). Resetting breach state.`);
    await saveAlertState({ breachActive: false, lastAlertTime: state.lastAlertTime });
  }
}

/* ── Data Action execution ─────────────────────────────── */

/**
 * Build the payload from channelConfig defaults + user-saved field values,
 * resolve template placeholders, and POST to the Data Action execute endpoint.
 */
async function executeChannelAction(context, token, channelKey, alertConfig, totalCalls) {
  const def = channelDefs.find((d) => d.key === channelKey);
  if (!def) {
    context.log.warn(`Channel "${channelKey}" not found in channelConfig — skipping.`);
    return;
  }
  if (!def.actionId) {
    context.log(`Channel "${channelKey}" has no actionId configured — skipping execution.`);
    return;
  }

  const savedFields = alertConfig.channels?.[channelKey] || {};

  // Merge: hidden defaults + user field values
  const payload = { ...def.defaults };
  for (const f of def.fields) {
    let value = savedFields[f.key] ?? "";
    // Resolve template placeholders
    value = value
      .replace(/\{\{totalCalls\}\}/g, String(totalCalls))
      .replace(/\{\{threshold\}\}/g, String(alertConfig.threshold));
    payload[f.key] = value;
  }

  const url = `${apiBase}/api/v2/integrations/actions/${def.actionId}/execute`;

  try {
    context.log(`Executing Data Action for channel "${channelKey}": ${url}`);
    context.log(`Payload: ${JSON.stringify(payload)}`);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      context.log.error(
        `Data Action "${channelKey}" failed: ${res.status} ${res.statusText} ${text}`,
      );
    } else {
      context.log(`Data Action "${channelKey}" executed successfully (${res.status}).`);
    }
  } catch (err) {
    context.log.error(`Data Action "${channelKey}" error: ${err.message}`);
  }
}
