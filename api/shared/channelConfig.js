/**
 * Shared notification-channel definitions.
 *
 * Single source of truth used by:
 *   • alertConfig HTTP function  — serves definitions to the frontend
 *   • collectTrunkMetrics        — builds payload & executes Data Actions
 *   • any future function that needs channel metadata
 *
 * Each channel object:
 *   key        – unique identifier (used as key in saved config)
 *   label      – human-readable name shown in UI
 *   actionId   – Genesys Cloud Data Action ID (null = not yet wired)
 *   defaults   – hidden fields sent with every execution (not shown to user)
 *   fields     – user-configurable fields rendered in the alert panel
 *               { key, label, type, placeholder?, hint? }
 *               Supported types: text, tel, textarea
 */

const channels = [
  {
    key: "sms",
    label: "SMS",
    actionId: "custom_-_3af155c2-20c5-4c44-babf-f0a9eb041a47",
    defaults: {
      encoding: "gsm7",
      expiration: null,
      header: null,
      msg_type: null,
      reference: null,
    },
    fields: [
      {
        key: "recipient",
        label: "Phone Number",
        type: "tel",
        placeholder: "+45…",
        hint: "International format including country code.",
      },
      {
        key: "sender",
        label: "Sender Name",
        type: "text",
        placeholder: "e.g. CompanyName",
        hint: "Alphanumeric sender ID (max 11 chars).",
      },
      {
        key: "text",
        label: "Message",
        type: "textarea",
        placeholder: "Threshold breached: {{totalCalls}} calls (limit {{threshold}})",
        hint: "Placeholders: {{totalCalls}}, {{threshold}}",
      },
    ],
  },
  {
    key: "email",
    label: "Email",
    actionId: null, // placeholder — wire up when Data Action is created
    defaults: {},
    fields: [],
  },
];

module.exports = { channels };
