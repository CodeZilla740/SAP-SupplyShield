// SupplyShield backend entry point.
// Boot order: connect database (SAP HANA Cloud when configured, otherwise
// the local SQLite fallback) -> ensure schema + canonical demo seed ->
// guarantee one analysed recovery plan exists -> serve the API and the UI.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const config = require('./config');
const { connect, engineInfo } = require('./db');
const {
  seed, removeAddedDisruptions, syncDelhiDemandSurge, seedGeographicAdditions,
} = require('./db/seed');
const { runPipeline } = require('./agents/orchestrator');
const { createApp } = require('./app');
const { assertSessionSecret } = require('./auth/session');
const { connectAuthStore } = require('./auth/auth-store');

async function ensureSeed(db) {
  const row = await db.get('SELECT COUNT(*) AS n FROM medicines');
  if (!row || row.n === 0) {
    console.log('[boot] empty database - seeding canonical demo data (SIMULATED)');
    await seed(db);
  }
  await removeAddedDisruptions(db);
  await syncDelhiDemandSurge(db);
  if (db.kind === 'sqlite') {
    const additions = await seedGeographicAdditions(db);
    const addedRows = Object.values(additions).reduce((total, count) => total + count, 0);
    if (addedRows) console.log(`[boot] added ${addedRows} non-destructive local network records`, additions);
  }
  // Guarantee analysed plans exist for all supported ports so every screen has data.
  const initialDisruptions = [
    'INC-2026-1104-03', 'INC-2026-1104-01', 'INC-2026-1104-02',
    'INC-2026-1104-04', 'INC-2026-1104-05', 'INC-2026-1104-06',
    'INC-2026-1104-07', 'INC-2026-1104-08', 'INC-2026-1104-09',
    'INC-2026-1104-10', 'INC-2026-1104-15',
  ];
  for (const disruptionId of initialDisruptions) {
    const existing = await db.get(
      `SELECT id, status FROM recovery_plans WHERE disruption_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [disruptionId],
    );
    const optionCount = existing
      ? await db.get(
        "SELECT COUNT(*) AS n FROM recovery_options WHERE plan_id = ? AND code <> 'WAIT'",
        [existing.id],
      )
      : null;
    const needsRefresh = !existing
      || (existing.status === 'PENDING_APPROVAL' && Number(optionCount.n) < 2);
    if (needsRefresh) {
      console.log(`[boot] running initial five-agent pipeline for ${disruptionId}`);
      const result = await runPipeline(db, disruptionId, 'system');
      console.log('[boot]', result.message);
    }
  }
}

async function main() {
  assertSessionSecret();
  const db = await connect();
  const authDb = await connectAuthStore(db);
  await ensureSeed(db);
  const app = createApp(db, { authDb });
  const info = engineInfo();
  app.listen(config.port, () => {
    console.log('');
    console.log('  SupplyShield control tower API');
    console.log(`  -> http://localhost:${config.port}/api/health`);
    console.log(`  -> database: ${info.label}`);
    if (info.fallbackReason) console.log(`  -> HANA fallback reason: ${info.fallbackReason}`);
    console.log('');
  });
}

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

main().catch((e) => {
  console.error('Fatal boot error:', e);
  process.exit(1);
});
