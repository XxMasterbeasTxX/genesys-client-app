/**
 * collectTrunkMetrics — Timer Trigger (every 1 minute)
 *
 * 1. Authenticates to Genesys Cloud (Client Credentials)
 * 2. Fetches all external trunks
 * 3. Retrieves current concurrent-call metrics per trunk
 * 4. Stores a timestamped snapshot in Azure Table Storage
 */

const { getGenesysToken } = require("../shared/genesysAuth");
const { storeMetric } = require("../shared/tableClient");
const { apiBase } = require("../shared/gcConfig");

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
