export const CONFIG = {
  region: "mypurecloud.de",
  authHost: "login.mypurecloud.de",
  apiBase: "https://api.mypurecloud.de",
  appName: "Genesys Tool",

  // OAuth Client Application (Authorization Code + PKCE)
  oauthClientId: "3b89b95c-d658-463e-9280-30a5bd7f4c2c",

  // Keep simple for hash routing; must match exactly in Genesys app config
  oauthRedirectUri: window.location.origin + window.location.pathname,

  // Add scopes as needed (start minimal)
  oauthScopes: ["openid"],

  router: { mode: "hash" }
};