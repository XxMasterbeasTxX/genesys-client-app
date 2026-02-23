/**
 * Azure Table Storage helpers for alert configuration and state.
 *
 * Two tables:
 *
 *   AlertConfig  — single row holding user-configurable alert settings
 *     PartitionKey = "config"
 *     RowKey       = "trunk"
 *     threshold       (number)
 *     cooldownMinutes (number)
 *     channels        (JSON string: { email: { enabled }, sms: { enabled } })
 *
 *   AlertState   — single row tracking the current breach state
 *     PartitionKey = "state"
 *     RowKey       = "trunk"
 *     breachActive    (boolean)
 *     lastAlertTime   (ISO 8601 string, or empty)
 */

const { TableClient } = require("@azure/data-tables");

const CONFIG_TABLE = "AlertConfig";
const STATE_TABLE = "AlertState";

const CONFIG_PK = "config";
const CONFIG_RK = "trunk";
const STATE_PK = "state";
const STATE_RK = "trunk";

/* ── Connection ────────────────────────────────────────── */

function getConnectionString() {
  const cs =
    process.env.TABLE_STORAGE_CONNECTION || process.env.AzureWebJobsStorage;
  if (!cs) {
    throw new Error(
      "No storage connection string found. " +
        "Set TABLE_STORAGE_CONNECTION (or AzureWebJobsStorage) in App Settings.",
    );
  }
  return cs;
}

const _tableReady = {};

async function getTableClient(tableName) {
  const client = TableClient.fromConnectionString(
    getConnectionString(),
    tableName,
  );

  if (!_tableReady[tableName]) {
    await client.createTable().catch((err) => {
      if (err.statusCode !== 409) throw err;
    });
    _tableReady[tableName] = true;
  }

  return client;
}

/* ── Alert Config ──────────────────────────────────────── */

const DEFAULT_CONFIG = {
  threshold: 0,
  cooldownMinutes: 15,
  channels: {},
};

/**
 * Read the current alert configuration.
 * Returns the config object, or defaults if none is saved.
 */
async function getAlertConfig() {
  const client = await getTableClient(CONFIG_TABLE);

  try {
    const entity = await client.getEntity(CONFIG_PK, CONFIG_RK);
    return {
      threshold: entity.threshold ?? DEFAULT_CONFIG.threshold,
      cooldownMinutes: entity.cooldownMinutes ?? DEFAULT_CONFIG.cooldownMinutes,
      channels: entity.channels ? JSON.parse(entity.channels) : DEFAULT_CONFIG.channels,
    };
  } catch (err) {
    if (err.statusCode === 404) return { ...DEFAULT_CONFIG };
    throw err;
  }
}

/**
 * Save alert configuration.
 */
async function saveAlertConfig(config) {
  const client = await getTableClient(CONFIG_TABLE);

  await client.upsertEntity({
    partitionKey: CONFIG_PK,
    rowKey: CONFIG_RK,
    threshold: config.threshold ?? DEFAULT_CONFIG.threshold,
    cooldownMinutes: config.cooldownMinutes ?? DEFAULT_CONFIG.cooldownMinutes,
    channels: JSON.stringify(config.channels ?? {}),
  });
}

/* ── Alert State ───────────────────────────────────────── */

const DEFAULT_STATE = {
  breachActive: false,
  lastAlertTime: "",
};

/**
 * Read the current alert state.
 */
async function getAlertState() {
  const client = await getTableClient(STATE_TABLE);

  try {
    const entity = await client.getEntity(STATE_PK, STATE_RK);
    return {
      breachActive: entity.breachActive ?? false,
      lastAlertTime: entity.lastAlertTime ?? "",
    };
  } catch (err) {
    if (err.statusCode === 404) return { ...DEFAULT_STATE };
    throw err;
  }
}

/**
 * Save alert state.
 */
async function saveAlertState(state) {
  const client = await getTableClient(STATE_TABLE);

  await client.upsertEntity({
    partitionKey: STATE_PK,
    rowKey: STATE_RK,
    breachActive: state.breachActive ?? false,
    lastAlertTime: state.lastAlertTime ?? "",
  });
}

module.exports = {
  getAlertConfig,
  saveAlertConfig,
  getAlertState,
  saveAlertState,
};
