// Integration tests for the five-agent pipeline against an isolated
// in-memory database seeded with the canonical demo scenario.
const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDb } = require('./helpers');
const { AGENT_SEQUENCE } = require('../src/agents/orchestrator');
const { audit, verifyChain } = require('../src/utils/audit');

test('pipeline creates the canonical plan RP-00942 with 3 options', async () => {
  const { db, pipeline } = await freshDb();
  assert.equal(pipeline.planId, 'RP-00942');
  assert.equal(pipeline.runId, 'SS-00942');
  assert.equal(pipeline.correlationId, 'SS-00942-F7A');

  const plan = await db.get('SELECT * FROM recovery_plans WHERE id = ?', ['RP-00942']);
  assert.equal(plan.status, 'PENDING_APPROVAL');
  assert.equal(plan.recommended_option_id, 'OPT-B'); // canonical: B = Bengaluru transfer

  const options = await db.all('SELECT * FROM recovery_options WHERE plan_id = ? ORDER BY id', ['RP-00942']);
  assert.equal(options.length, 3);
  const air = options.find((o) => o.code === 'AIR_REROUTE');
  const transfer = options.find((o) => o.code === 'STOCK_TRANSFER');
  const wait = options.find((o) => o.code === 'WAIT');

  // Canonical figures (match UI + presentation):
  assert.equal(transfer.qty, 240);
  assert.equal(transfer.cost_usd, 1100);
  assert.equal(transfer.eta_hours, 6);
  assert.equal(transfer.recommended, 1);
  assert.equal(transfer.eligible, 1);

  assert.equal(air.cost_usd, 4200);
  assert.equal(air.eta_hours, 8);
  assert.equal(air.compliant, 0);   // R1 fails: carrier not cold-chain certified
  assert.equal(air.eligible, 0);

  assert.equal(wait.compliant, 1);      // no transport rule broken
  assert.equal(wait.meets_deadline, 0); // but 48h > 28.8h cover
  assert.equal(wait.eligible, 0);
});

test('agents execute in the mandated order Sensing -> Impact -> Scenario -> Logistics -> Compliance', async () => {
  const { db } = await freshDb();
  const rows = await db.all('SELECT actor FROM audit_log ORDER BY seq');
  const positions = AGENT_SEQUENCE.map((agent) => rows.findIndex((r) => r.actor === agent));
  for (const pos of positions) assert.notEqual(pos, -1, 'agent missing from audit log');
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i] > positions[i - 1], `agent order violated at ${AGENT_SEQUENCE[i]}`);
  }
});

test('audit records are created and the hash chain verifies', async () => {
  const { db } = await freshDb();
  const count = await db.get('SELECT COUNT(*) AS n FROM audit_log');
  assert.ok(count.n >= 7, `expected at least 7 audit events, got ${count.n}`);
  const integrity = await verifyChain(db);
  assert.equal(integrity.valid, true);
  assert.equal(integrity.events, count.n);
});

test('impact agent computes canonical risk: insulin at St. Martha, cover 28.8h, shortfall 80', async () => {
  const { db } = await freshDb();
  const impactRow = await db.get(
    "SELECT payload FROM audit_log WHERE actor = 'ImpactAgent' ORDER BY seq LIMIT 1",
  );
  const payload = JSON.parse(impactRow.payload);
  const primary = payload.risks.find((r) => r.at_risk);
  assert.equal(primary.facility_code, 'HOS-STM');
  assert.equal(primary.cover_hours, 28.8);
  assert.equal(primary.shortfall, 80);
  assert.equal(primary.transfer_qty, 240);
});

test('scenario agent discards Hyderabad transfer with an explicit reason', async () => {
  const { db } = await freshDb();
  const row = await db.get(
    "SELECT payload FROM audit_log WHERE actor = 'ScenarioAgent' ORDER BY seq LIMIT 1",
  );
  const payload = JSON.parse(row.payload);
  assert.equal(payload.candidates.length, 3);
  assert.equal(payload.discarded.length, 1);
  assert.match(payload.discarded[0].reason, /Insufficient transferable stock/);
  assert.match(payload.discarded[0].title, /Hyderabad/);
});

test('re-running the pipeline is idempotent (plan replaced, not duplicated)', async () => {
  const { db } = await freshDb();
  const { runPipeline } = require('../src/agents/orchestrator');
  const second = await runPipeline(db, 'INC-2026-1104-03', 'test');
  assert.equal(second.planId, 'RP-00943'); // new run number
  const pending = await db.get(
    "SELECT COUNT(*) AS n FROM recovery_plans WHERE status = 'PENDING_APPROVAL'",
  );
  assert.equal(pending.n, 1); // the old pending plan was replaced
  const options = await db.all('SELECT * FROM recovery_options WHERE plan_id = ?', [second.planId]);
  assert.equal(options.length, 3);
});

test('repeated analysis allocates unique run and plan IDs and preserves a valid audit chain', async () => {
  const { db, pipeline: first } = await freshDb();
  const second = await require('../src/agents/orchestrator')
    .runPipeline(db, 'INC-2026-1104-03', 'test');
  assert.notEqual(first.runId, second.runId);
  assert.notEqual(first.planId, second.planId);

  const plans = await db.all('SELECT id,run_id FROM recovery_plans ORDER BY run_id');
  assert.equal(new Set(plans.map((plan) => plan.run_id)).size, plans.length);
  assert.equal(new Set(plans.map((plan) => plan.id)).size, plans.length);
  for (const plan of plans) {
    const options = await db.all('SELECT * FROM recovery_options WHERE plan_id = ?', [plan.id]);
    assert.equal(options.length, 3);
    assert.ok(options.every((option) => option.plan_id === plan.id));
  }
  assert.equal((await verifyChain(db)).valid, true);
});

test('analysis for different disruptions allocates distinct IDs and keeps options attached to each plan', async () => {
  const { db, pipeline: first } = await freshDb();
  const disruption = await db.get(
    'SELECT * FROM disruptions WHERE id = ?', ['INC-2026-1104-03'],
  );
  await db.run(
    `INSERT INTO disruptions (id,type,title,port,severity,description,status,radius_km,wind_kmh,expected_delay_hours,affected_shipments,affected_pos,verified,source,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['INC-2026-TEST-04', disruption.type, disruption.title, disruption.port,
      disruption.severity, disruption.description, disruption.status, disruption.radius_km,
      disruption.wind_kmh, disruption.expected_delay_hours, disruption.affected_shipments,
      disruption.affected_pos, disruption.verified, disruption.source, disruption.created_at],
  );
  const second = await require('../src/agents/orchestrator')
    .runPipeline(db, 'INC-2026-TEST-04', 'test');
  assert.notEqual(first.runId, second.runId);
  assert.notEqual(first.planId, second.planId);
  for (const planId of [first.planId, second.planId]) {
    const options = await db.all('SELECT * FROM recovery_options WHERE plan_id = ?', [planId]);
    assert.equal(options.length, 3);
    assert.ok(options.every((option) => option.id.startsWith(`OPT-${planId.slice(3)}-`) || planId === 'RP-00942'));
  }
  assert.equal((await verifyChain(db)).valid, true);
});

test('concurrent analyses receive unique IDs and serialize audit-chain writes', async () => {
  const { db } = await freshDb();
  const { runPipeline } = require('../src/agents/orchestrator');
  const results = await Promise.all([
    runPipeline(db, 'INC-2026-1104-03', 'parallel-a'),
    runPipeline(db, 'INC-2026-1104-03', 'parallel-b'),
  ]);
  assert.equal(new Set(results.map((result) => result.runId)).size, 2);
  assert.equal(new Set(results.map((result) => result.planId)).size, 2);
  const activePlan = await db.get(
    "SELECT id FROM recovery_plans WHERE status = 'PENDING_APPROVAL'",
  );
  assert.ok(results.some((result) => result.planId === activePlan.id));
  const activeOptions = await db.all(
    'SELECT * FROM recovery_options WHERE plan_id = ?', [activePlan.id],
  );
  assert.equal(activeOptions.length, 3);
  assert.ok(activeOptions.every((option) => option.plan_id === activePlan.id));
  const auditRows = await db.all(
    'SELECT DISTINCT run_id FROM audit_log WHERE run_id IN (?,?)',
    results.map((result) => result.runId),
  );
  assert.equal(auditRows.length, 2);
  assert.equal((await verifyChain(db)).valid, true);
});

test('concurrent audit writes produce unique ordered sequence numbers and a valid hash chain', async () => {
  const { db } = await freshDb();
  await Promise.all(Array.from({ length: 20 }, (_, index) => (
    audit(db, 'SS-CONCURRENT', `writer-${index}`, 'Concurrent test event', { index })
  )));
  const rows = await db.all(
    "SELECT seq FROM audit_log WHERE run_id = 'SS-CONCURRENT' ORDER BY seq",
  );
  assert.equal(rows.length, 20);
  assert.equal(new Set(rows.map((row) => row.seq)).size, 20);
  assert.equal((await verifyChain(db)).valid, true);
});

test('explainer falls back to a labelled template when AI Core is not configured', async () => {
  const { db } = await freshDb();
  const plan = await db.get('SELECT * FROM recovery_plans LIMIT 1');
  assert.match(plan.explanation_source, /Rule-based template/);
  assert.match(plan.explanation, /Human approval is required before any action/);
  // The template contains only computed facts:
  assert.match(plan.explanation, /USD 1100/);
  assert.match(plan.explanation, /ETA 6h/);
});
