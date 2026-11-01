// CLI: npm run seed  -> seeds the active database engine.
const { connect, engineInfo, close } = require('./index');
const { seed } = require('./seed');

(async () => {
  const db = await connect();
  await seed(db);
  const info = engineInfo();
  console.log(`Seeded canonical demo data into ${info.label}`);
  await close();
})().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
