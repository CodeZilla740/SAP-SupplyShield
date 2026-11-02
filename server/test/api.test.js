// API integration tests: full HTTP round-trips against an ephemeral server
// with an isolated in-memory database.
const test = require('node:test');
const assert = require('node:assert/strict');
const { freshServer, post, get } = require('./helpers');
const { verifyChain } = require('../src/utils/audit');

test('GET /api/health reports engine and honest integration labels', async () => {
  const { server, base } = await freshServer();
  const { status, body } = await get(base, '/api/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.db.engine, 'sqlite'); // HANA not configured in tests
  assert.equal(body.llm.configured, false);
  assert.equal(body.integrations.s4hana.configured, false);
  server.close();
});

test('GET /api/overview returns canonical KPIs', async () => {
  const { server, base } = await freshServer();
  const { status, body } = await get(base, '/api/overview');
  assert.equal(status, 200);
  const kpis = Object.fromEntries(body.kpis.map((k) => [k.label, k.value]));
  assert.equal(kpis['Active Disruptions'], '03');
  assert.equal(kpis['At-Risk Shipments'], '12');
  assert.equal(kpis['Hospitals at Risk'], '04');
  assert.equal(kpis['Critical Medicine Stock'], '1.2');
  assert.equal(body.agents.length, 5);
  server.close();
});

test('approving the recommended option succeeds and persists the decision', async () => {
  const { server, base, db } = await freshServer();
  const res = await post(base, '/api/recovery-plans/RP-00942/approve', {
    actor: 'Test Planner', comment: 'Looks good',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'APPROVED');
  assert.match(res.body.executionNote, /SIMULATED/);

  const plan = await db.get('SELECT * FROM recovery_plans WHERE id = ?', ['RP-00942']);
  assert.equal(plan.status, 'APPROVED');
  assert.equal(plan.decided_by, 'Test Planner');
  assert.equal(plan.decision_comment, 'Looks good');

  const approval = await db.get('SELECT * FROM approvals WHERE plan_id = ?', ['RP-00942']);
  assert.equal(approval.decision, 'APPROVED');
  assert.equal(approval.actor, 'Test Planner');

  // The human decision is in the hash-chained audit log.
  const auditRow = await db.get(
    "SELECT * FROM audit_log WHERE step = 'Recovery plan APPROVED by human planner'",
  );
  assert.ok(auditRow);
  server.close();
});

test('approving the non-compliant air option is BLOCKED server-side (409)', async () => {
  const { server, base, db } = await freshServer();
  const res = await post(base, '/api/recovery-options/OPT-A/approve', { actor: 'Test Planner' });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Blocked by compliance rules/);
  assert.match(res.body.error, /cold-chain certification/);

  // Nothing was approved; the plan is still pending.
  const plan = await db.get('SELECT * FROM recovery_plans WHERE id = ?', ['RP-00942']);
  assert.equal(plan.status, 'PENDING_APPROVAL');
  const approvals = await db.get('SELECT COUNT(*) AS n FROM approvals');
  assert.equal(approvals.n, 0);

  // ...but the blocked attempt is recorded in the audit trail.
  const blocked = await db.get(
    "SELECT * FROM audit_log WHERE step = 'Approval BLOCKED by compliance revalidation'",
  );
  assert.ok(blocked);
  server.close();
});

test('a second decision on a decided plan is rejected (409)', async () => {
  const { server, base } = await freshServer();
  const first = await post(base, '/api/recovery-plans/RP-00942/approve', {});
  assert.equal(first.status, 200);
  const second = await post(base, '/api/recovery-plans/RP-00942/approve', {});
  assert.equal(second.status, 409);
  server.close();
});

test('rejecting the plan persists the rejection and audit entry', async () => {
  const { server, base, db } = await freshServer();
  const res = await post(base, '/api/recovery-plans/RP-00942/reject', {
    actor: 'Test Planner', comment: 'Too expensive',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'REJECTED');
  const plan = await db.get('SELECT * FROM recovery_plans WHERE id = ?', ['RP-00942']);
  assert.equal(plan.status, 'REJECTED');
  server.close();
});

test('POST /api/disruptions validates input and creates unverified events', async () => {
  const { server, base, db } = await freshServer();
  const bad = await post(base, '/api/disruptions', { type: 'Cyclone' });
  assert.equal(bad.status, 400);
  const good = await post(base, '/api/disruptions', {
    type: 'Flood', location: 'Kochi', severity: 'Medium', duration: '24', description: 'Test event',
  });
  assert.equal(good.status, 201);
  const row = await db.get('SELECT * FROM disruptions WHERE id = ?', [good.body.id]);
  assert.equal(row.verified, 0); // manual entries are never auto-verified
  assert.equal(row.severity, 'MEDIUM');
  server.close();
});

test('run-analysis endpoint re-executes the five-agent pipeline', async () => {
  const { server, base } = await freshServer();
  const res = await post(base, '/api/disruptions/INC-2026-1104-03/run-analysis', {});
  assert.equal(res.status, 200);
  assert.equal(res.body.optionsGenerated, 3);
  assert.match(res.body.message, /Recommended: Transfer 240 vials from Bengaluru Warehouse/);
  server.close();
});

test('concurrent run-analysis requests allocate unique IDs and preserve the audit chain', async () => {
  const { server, base, db } = await freshServer();
  const results = await Promise.all([
    post(base, '/api/disruptions/INC-2026-1104-03/run-analysis', { actor: 'parallel-a' }),
    post(base, '/api/disruptions/INC-2026-1104-03/run-analysis', { actor: 'parallel-b' }),
  ]);
  assert.ok(results.every((result) => result.status === 200));
  assert.equal(new Set(results.map((result) => result.body.runId)).size, 2);
  assert.equal(new Set(results.map((result) => result.body.planId)).size, 2);

  const pending = await db.get(
    "SELECT id FROM recovery_plans WHERE status = 'PENDING_APPROVAL'",
  );
  const options = await db.all('SELECT * FROM recovery_options WHERE plan_id = ?', [pending.id]);
  assert.equal(options.length, 3);
  assert.ok(options.every((option) => option.plan_id === pending.id));
  assert.equal((await verifyChain(db)).valid, true);
  server.close();
});

test('audit endpoint exposes hash-chained events and integrity status', async () => {
  const { server, base } = await freshServer();
  await post(base, '/api/recovery-plans/RP-00942/approve', { actor: 'Test Planner' });
  const { status, body } = await get(base, '/api/audit');
  assert.equal(status, 200);
  assert.equal(body.integrity.valid, true);
  assert.ok(body.events.length >= 8);
  const approvedEvent = body.events.find((e) => e.title === 'Recovery plan approved');
  assert.ok(approvedEvent);
  assert.ok(approvedEvent.hash);
  assert.match(body.execution.transferReference, /TR-SIM-/);
  server.close();
});

test('unknown disruption returns 404', async () => {
  const { server, base } = await freshServer();
  const res = await post(base, '/api/disruptions/NOPE/run-analysis', {});
  assert.equal(res.status, 404);
  server.close();
});
