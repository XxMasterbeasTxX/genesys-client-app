export const CONFIG = {
  region: "mypurecloud.de",
  authHost: "login.mypurecloud.de",
  apiBase: "https://api.mypurecloud.de",
  appName: "My Private App",

  // OAuth Client Application (Authorization Code + PKCE)
  oauthClientId: "PUT_YOUR_CLIENT_ID_HERE",

  // Keep simple for hash routing; must match exactly in Genesys app config
  oauthRedirectUri: window.location.origin + window.location.pathname,

  // Add scopes as needed (start minimal)
  oauthScopes: ["openid"],

  router: { mode: "hash" }
};