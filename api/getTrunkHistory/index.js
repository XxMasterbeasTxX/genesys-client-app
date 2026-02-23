/**
 * getTrunkHistory — HTTP Trigger (GET)
 *
 * Query params:
 *   from  — ISO 8601 start date  (required)
 *   to    — ISO 8601 end date    (required)
 *
 * Response:
 *   { from, to, count, data: [{ timestamp, totalCalls, perTrunk }] }
 */

const { queryMetrics } = require("../shared/tableClient");

module.exports = async function (context, req) {
  const { from, to } = req.query;

  if (!from || !to) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error:
          "Missing required query parameters: from, to (ISO 8601 dates)",
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
        error:
          "Invalid date format. Use ISO 8601 (e.g. 2026-01-15T00:00:00Z)",
      }),
    };
    return;
  }

  try {
    const rows = await queryMetrics(fromDate, toDate);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        count: rows.length,
        data: rows,
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
