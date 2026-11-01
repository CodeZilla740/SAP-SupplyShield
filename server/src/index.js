// SupplyShield backend entry point.
// Boot order: connect database (SAP HANA Cloud when configured, otherwise
// the local SQLite fallback) -> ensure schema + canonical demo seed ->
// guarantee one analysed recovery plan exists -> serve the API and the UI.
const config = require('./config');
const { connect, engineInfo } = require('./db');
const { seed } = require('./db/seed');
const { runPipeline } = require('./agents/orchestrator');
const { createApp } = require('./app');

async function ensureSeed(db) {
  const row = await db.get('SELECT COUNT(*) AS n FROM medicines');
  if (!row || row.n === 0) {
    console.log('[boot] empty database - seeding canonical demo data (SIMULATED)');
    await seed(db);
  }
  // Guarantee the canonical analysed plan exists so every screen has data.
  const plan = await db.get('SELECT COUNT(*) AS n FROM recovery_plans');
  if (!plan || plan.n === 0) {
    console.log('[boot] running initial five-agent pipeline for INC-2026-1104-03');
    const result = await runPipeline(db, 'INC-2026-1104-03', 'system');
    console.log('[boot]', result.message);
  }
}

async function main() {
  const db = await connect();
  await ensureSeed(db);
  const app = createApp(db);
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

main().catch((e) => {
  console.error('Fatal boot error:', e);
  process.exit(1);
});
