/**
 * getTrunkHistory — HTTP Trigger (GET)
 *
 * Query params:
 *   from    — ISO 8601 start date  (required)
 *   to      — ISO 8601 end date    (required)
 *   bucket  — aggregation: "raw" | "hour" | "day"  (optional, default: "raw")
 *
 * When bucket is "hour" or "day", rows are grouped into time buckets.
 * Each bucket returns { timestamp, peakCalls, avgCalls, samples }.
 *
 * When bucket is "raw":
 *   { from, to, bucket, count, data: [{ timestamp, totalCalls, perTrunk }] }
 *
 * When bucket is "hour" or "day":
 *   { from, to, bucket, count, data: [{ timestamp, peakCalls, avgCalls, samples }] }
 */

const { queryMetrics } = require("../shared/tableClient");

module.exports = async function (context, req) {
  const { from, to, bucket = "raw" } = req.query;

  if (!from || !to) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Missing required query parameters: from, to (ISO 8601 dates)",
      }),
    };
    return;
  }

  if (!["raw", "hour", "day"].includes(bucket)) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: 'Invalid bucket parameter. Use "raw", "hour", or "day".',
      }),
    };
    return;
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Invalid date format. Use ISO 8601 (e.g. 2026-01-15T00:00:00Z)",
      }),
    };
    return;
  }

  try {
    const rows = await queryMetrics(fromDate, toDate);

    const data = bucket === "raw" ? rows : aggregate(rows, bucket);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        bucket,
        count: data.length,
        data,
      }),
    };
  } catch (err) {
    context.log.error("getTrunkHistory failed:", err.message || err);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};

/* ── Aggregation helper ────────────────────────────────── */

/**
 * Group raw rows into time buckets, returning peak, average and sample count.
 * @param {Array} rows  Sorted array of { timestamp, totalCalls }
 * @param {"hour"|"day"} size
 */
function aggregate(rows, size) {
  if (!rows.length) return [];

  const bucketMap = new Map(); // bucketKey → { sum, peak, count, ts }

  for (const row of rows) {
    const d = new Date(row.timestamp);
    const key = bucketKey(d, size);

    if (!bucketMap.has(key)) {
      bucketMap.set(key, {
        ts: bucketStart(d, size).toISOString(),
        peak: row.totalCalls,
        sum: row.totalCalls,
        count: 1,
      });
    } else {
      const b = bucketMap.get(key);
      if (row.totalCalls > b.peak) b.peak = row.totalCalls;
      b.sum += row.totalCalls;
      b.count += 1;
    }
  }

  return [...bucketMap.values()]
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .map((b) => ({
      timestamp: b.ts,
      peakCalls: b.peak,
      avgCalls: Math.round((b.sum / b.count) * 10) / 10,
      samples: b.count,
    }));
}

/** Return a string key that groups dates into the same bucket. */
function bucketKey(d, size) {
  if (size === "hour") {
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}`;
  }
  // day
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Return the start-of-bucket Date (used as the bucket's timestamp). */
function bucketStart(d, size) {
  if (size === "hour") {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()));
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function pad(n) {
  return String(n).padStart(2, "0");
}
