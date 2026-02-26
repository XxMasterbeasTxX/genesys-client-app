const REGION = "mypurecloud.de";

export const CONFIG = {
  region: REGION,
  authHost: `login.${REGION}`,
  apiBase: `https://api.${REGION}`,
  appName: "Genesys Tool",

  // OAuth Client Application (Authorization Code + PKCE)
  oauthClientId: "3b89b95c-d658-463e-9280-30a5bd7f4c2c",

  // Keep simple for hash routing; must match exactly in Genesys app config
  oauthRedirectUri: "https://proud-pebble-04fa37b03.2.azurestaticapps.net",

  // OIDC scopes — enriches the id_token. API permissions are controlled
  // by the OAuth client roles and the user's own roles in Genesys Cloud admin.
  // "architect" scope is required for Data Tables read/write access.
  // "routing" scope is required for queue/skill/language/wrapup-code lookups.
  oauthScopes: ["openid", "profile", "email", "architect", "routing"],

  // Azure Functions backend (trunk history, etc.)
  functionsBase: "https://genesys-app-functions-ebfcc6ffbshwazbh.swedencentral-01.azurewebsites.net",

  router: { mode: "hash" }
};