/**
 * Genesys Cloud Client Credentials OAuth helper.
 *
 * Authenticates using the GC_CLIENT_ID / GC_CLIENT_SECRET environment
 * variables and caches the token until shortly before expiry.
 */

let cachedToken = null;
let tokenExpiresAt = 0;

async function getGenesysToken() {
  // Return cached token if still valid (60 s safety buffer)
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const clientId = process.env.GC_CLIENT_ID;
  const clientSecret = process.env.GC_CLIENT_SECRET;
  const region = process.env.GC_REGION || "mypurecloud.de";

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing GC_CLIENT_ID or GC_CLIENT_SECRET environment variables",
    );
  }

  const authHost = `login.${region}`;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );

  const res = await fetch(`https://${authHost}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Genesys Cloud auth failed: ${res.status} ${res.statusText} ${text}`,
    );
  }

  const json = await res.json();
  cachedToken = json.access_token;
  tokenExpiresAt = Date.now() + (json.expires_in || 3600) * 1000;

  return cachedToken;
}

module.exports = { getGenesysToken };
