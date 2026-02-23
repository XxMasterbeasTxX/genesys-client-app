/**
 * Shared Genesys Cloud configuration for all Azure Functions.
 *
 * Single source of truth for region-derived values.
 * The region is read from the GC_REGION environment variable
 * (defaults to "mypurecloud.de" if not set).
 */

const region = process.env.GC_REGION || "mypurecloud.de";

module.exports = {
  region,
  authHost: `login.${region}`,
  apiBase: `https://api.${region}`,
};
