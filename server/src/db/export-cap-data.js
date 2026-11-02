// Rebuilds the CAP CSV baseline from the application's canonical seed and
// its normal initial analysis, using an in-memory SQLite database only.
const fs = require('fs');
const path = require('path');
const config = require('../config');
const SqliteClient = require('./sqlite-client');
const { seed } = require('./seed');
const { runPipeline } = require('../agents/orchestrator');
const { verifyChain } = require('../utils/audit');

const DISRUPTION_ID = 'INC-2026-1104-03';
const OUTPUT_DIR = path.resolve(__dirname, '..', '..', '..', 'db', 'data');
const TABLES = [
  'medicines',
  'facilities',
  'inventory',
  'carriers',
  'lanes',
  'purchase_orders',
  'shipments',
  'temperature_readings',
  'shipment_tracking',
  'disruptions',
  'disruption_timeline',
  'infrastructure_status',
  'alerts',
  'recovery_plans',
  'recovery_options',
  'approvals',
  'audit_log',
  'pipeline_state',
  'network_stats',
];

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers, rows) {
  return [
    headers.map(csvCell).join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
    '',
  ].join('\r\n');
}

async function main() {
  const db = new SqliteClient(':memory:');
  try {
    // Keep regeneration offline and deterministic with respect to the configured LLM.
    config.aicore.serviceKeyJson = '';
    await seed(db);
    await runPipeline(db, DISRUPTION_ID, 'system');
    const auditStatus = await verifyChain(db);
    if (!auditStatus.valid) {
      throw new Error(`Canonical audit chain is invalid at sequence ${auditStatus.brokenAt}`);
    }

    const foreignKeyErrors = await db.all('PRAGMA foreign_key_check');
    if (foreignKeyErrors.length) {
      throw new Error(`Canonical dataset has ${foreignKeyErrors.length} foreign-key violations`);
    }

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    for (const table of TABLES) {
      const rows = await db.all(`SELECT * FROM ${table}`);
      const headers = rows.length
        ? Object.keys(rows[0])
        : (await db.all(`PRAGMA table_info(${table})`)).map((column) => column.name);
      const file = path.join(OUTPUT_DIR, `${table}.csv`);
      fs.writeFileSync(file, toCsv(headers, rows), 'utf8');
      console.log(`${path.basename(file)}: ${rows.length} records`);
    }
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error('CAP CSV generation failed:', error);
  process.exitCode = 1;
});
