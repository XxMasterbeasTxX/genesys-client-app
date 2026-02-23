/**
 * HTTP function – GET / PUT alert configuration.
 *
 *   GET  /api/alertConfig         → returns current config + channel definitions
 *   PUT  /api/alertConfig  body:  { threshold, cooldownMinutes, channels }
 *                                 → validates + saves, returns saved config
 *
 * Channel definitions (fields, defaults, labels) come from the shared
 * channelConfig.js so the frontend can render dynamic per-channel fields
 * without hardcoding anything.
 */

const { getAlertConfig, saveAlertConfig } = require("../shared/alertStore");
const { channels: channelDefs } = require("../shared/channelConfig");

module.exports = async function (context, req) {
  try {
    if (req.method === "GET") {
      const config = await getAlertConfig();
      // Attach channel definitions so the frontend can build the UI
      context.res = {
        status: 200,
        body: { ...config, channelDefs },
      };
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

    // Validate channels — now accepts { enabled, ...fieldValues }
    const channels = {};
    if (body.channels && typeof body.channels === "object") {
      for (const [key, val] of Object.entries(body.channels)) {
        const def = channelDefs.find((d) => d.key === key);
        const entry = { enabled: Boolean(val?.enabled) };
        // Persist user-editable field values for this channel
        if (def) {
          for (const f of def.fields) {
            entry[f.key] = typeof val?.[f.key] === "string" ? val[f.key] : "";
          }
        }
        channels[key] = entry;
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
