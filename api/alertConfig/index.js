/**
 * HTTP function – GET / PUT alert configuration.
 *
 *   GET  /api/alertConfig         → returns current config (or defaults)
 *   PUT  /api/alertConfig  body:  { threshold, cooldownMinutes, channels }
 *                                 → validates + saves, returns saved config
 */

const { getAlertConfig, saveAlertConfig } = require("../shared/alertStore");

module.exports = async function (context, req) {
  try {
    if (req.method === "GET") {
      const config = await getAlertConfig();
      context.res = { status: 200, body: config };
      return;
    }

    /* ── PUT ──────────────────────────────────────────── */

    const body = req.body || {};

    // Validate threshold
    const threshold = Number(body.threshold);
    if (!Number.isFinite(threshold) || threshold < 0) {
      context.res = {
        status: 400,
        body: { error: "threshold must be a non-negative number." },
      };
      return;
    }

    // Validate cooldown
    const cooldownMinutes = Number(body.cooldownMinutes);
    if (!Number.isFinite(cooldownMinutes) || cooldownMinutes < 0) {
      context.res = {
        status: 400,
        body: { error: "cooldownMinutes must be a non-negative number." },
      };
      return;
    }

    // Validate channels (object with boolean-enabled flags)
    const channels = {};
    if (body.channels && typeof body.channels === "object") {
      for (const [key, val] of Object.entries(body.channels)) {
        channels[key] = { enabled: Boolean(val?.enabled) };
      }
    }

    const config = { threshold, cooldownMinutes, channels };

    await saveAlertConfig(config);
    context.log(`Alert config saved: ${JSON.stringify(config)}`);

    context.res = { status: 200, body: config };
  } catch (err) {
    context.log.error("alertConfig error:", err);
    context.res = { status: 500, body: { error: "Internal server error." } };
  }
};
