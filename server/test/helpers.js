// Shared test fixture: an isolated in-memory database seeded with the
// canonical demo data, plus the Express app listening on an ephemeral port.
const { useTestDb } = require('../src/db');
const { seed } = require('../src/db/seed');
const { runPipeline } = require('../src/agents/orchestrator');
const { createApp } = require('../src/app');

async function freshDb({ withPlan = true } = {}) {
  const db = await useTestDb();
  await seed(db);
  let pipeline = null;
  if (withPlan) pipeline = await runPipeline(db, 'INC-2026-1104-03', 'test');
  return { db, pipeline };
}

async function freshServer({ withPlan = true } = {}) {
  const { db, pipeline } = await freshDb({ withPlan });
  const app = createApp(db);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, pipeline, server, base };
}

async function post(base, path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, body: await res.json() };
}

async function get(base, path) {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json() };
}

module.exports = { freshDb, freshServer, post, get };
