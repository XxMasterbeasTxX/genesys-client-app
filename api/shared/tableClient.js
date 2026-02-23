/**
 * Azure Table Storage helpers for trunk metrics time-series.
 *
 * Table: TrunkMetrics
 *   PartitionKey = YYYY-MM   (efficient monthly range queries)
 *   RowKey       = YYYYMMDDTHHmmssZ  (lexicographic sort = chronological)
 *   totalCalls   = number
 *   perTrunk     = JSON string  { trunkId: callCount, … }
 *   isoTimestamp = ISO 8601 string (human-readable backup of RowKey)
 */

const { TableClient } = require("@azure/data-tables");

const TABLE_NAME = "TrunkMetrics";

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

let _tableReady = false;

async function getTableClient() {
  const client = TableClient.fromConnectionString(
    getConnectionString(),
    TABLE_NAME,
  );

  if (!_tableReady) {
    // Create the table if it doesn't exist (409 = already exists → safe)
    await client.createTable().catch((err) => {
      if (err.statusCode !== 409) throw err;
    });
    _tableReady = true;
  }

  return client;
}

/* ── Helpers ───────────────────────────────────────────── */

/** Convert a Date to the RowKey format: "20260115T103000Z" */
function dateToRowKey(d) {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

/** Return all YYYY-MM partition keys that overlap [from, to]. */
function getPartitionKeys(from, to) {
  const keys = [];
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (cur <= to) {
    keys.push(cur.toISOString().slice(0, 7));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return keys;
}

/* ── Public API ────────────────────────────────────────── */

/**
 * Store a single metrics snapshot.
 */
async function storeMetric(timestamp, totalCalls, perTrunk) {
  const client = await getTableClient();

  const pk = timestamp.toISOString().slice(0, 7); // "2026-01"
  const rk = dateToRowKey(timestamp); // "20260115T103000Z"

  await client.upsertEntity({
    partitionKey: pk,
    rowKey: rk,
    totalCalls,
    perTrunk: JSON.stringify(perTrunk),
    isoTimestamp: timestamp.toISOString(),
  });
}

/**
 * Query all metrics rows in [from, to].
 * Returns sorted array of { timestamp, totalCalls, perTrunk }.
 */
async function queryMetrics(from, to) {
  const client = await getTableClient();

  const partitions = getPartitionKeys(from, to);
  const fromRk = dateToRowKey(from);
  const toRk = dateToRowKey(to);

  const rows = [];

  for (const pk of partitions) {
    const filter = [
      `PartitionKey eq '${pk}'`,
      `RowKey ge '${fromRk}'`,
      `RowKey le '${toRk}'`,
    ].join(" and ");

    const entities = client.listEntities({ queryOptions: { filter } });

    for await (const entity of entities) {
      rows.push({
        timestamp: entity.isoTimestamp || entity.rowKey,
        totalCalls: entity.totalCalls ?? 0,
        perTrunk: entity.perTrunk ? JSON.parse(entity.perTrunk) : {},
      });
    }
  }

  rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return rows;
}

module.exports = { storeMetric, queryMetrics };
