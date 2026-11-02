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

test('synthetic import reuses canonical rows, appends the compact dataset, and is repeatable', async (t) => {
  const { server, base, db } = await freshServer();
  t.after(() => server.close());
  const before = await db.get('SELECT COUNT(*) AS n FROM facilities');
  const result = await post(base, '/api/admin/import-synthetic', {});
  assert.equal(result.status, 200);
  assert.equal(result.body.imported, true);
  assert.equal(result.body.counts.facilities, 0);
  assert.equal(result.body.skipped.facilities, 14);
  assert.equal(result.body.skipped.medicines, 5);
  assert.equal(result.body.counts.carriers, 2);
  assert.equal(result.body.counts.lanes, 8);
  assert.equal(result.body.counts.inventory, 4);
  assert.equal(result.body.counts.purchase_orders, 3);
  assert.equal(result.body.counts.shipments, 3);
  assert.equal(result.body.counts.temperature_readings, 11);
  assert.equal(result.body.counts.shipment_tracking, 3);
  assert.equal(result.body.skipped.shipment_tracking, 8);
  assert.equal(result.body.skipped.disruptions, 7);
  assert.ok(result.body.retainedCsvOnly.includes('suppliers'));
  assert.ok(!result.body.retainedCsvOnly.includes('shipment_tracking'));
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM shipment_tracking')).n, 13);

  const after = await db.get('SELECT COUNT(*) AS n FROM facilities');
  assert.equal(after.n, before.n);
  assert.ok(await db.get('SELECT * FROM facilities WHERE code = ?', ['HOS-STM']));
  assert.ok(await db.get('SELECT * FROM shipments WHERE id = ?', ['SYN8002']));
  assert.equal(
    (await db.get('SELECT status FROM disruptions WHERE id = ?', ['INC-2026-1104-03'])).status,
    'ANALYSED',
  );
  const inventoryBeforeAnalysis = await db.all(
    'SELECT * FROM inventory ORDER BY facility_code, product_sku',
  );

  const duplicateImport = await post(base, '/api/admin/import-synthetic', {});
  assert.equal(duplicateImport.status, 200);
  assert.ok(Object.values(duplicateImport.body.counts).every((count) => count === 0));
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM facilities')).n, after.n);

  const canonicalAnalysis = await post(base, '/api/disruptions/INC-2026-1104-03/run-analysis', {});
  assert.equal(canonicalAnalysis.status, 200);
  assert.equal(canonicalAnalysis.body.optionsGenerated, 3);
  assert.match(canonicalAnalysis.body.recommendedTitle, /Bengaluru Warehouse/);

  const analysis = await post(base, '/api/disruptions/INC-2026-1104-01/run-analysis', {});
  assert.equal(analysis.status, 200);
  assert.ok(analysis.body.optionsGenerated > 0);
  const impactAudit = await db.get(
    "SELECT payload FROM audit_log WHERE run_id = ? AND actor = 'ImpactAgent'",
    [analysis.body.runId],
  );
  assert.equal(JSON.parse(impactAudit.payload).tracked_shipments, 4);
  assert.equal(JSON.parse(impactAudit.payload).tracked_pos, 4);

  const noAction = await post(base, '/api/disruptions/INC-2026-1104-02/run-analysis', {});
  assert.equal(noAction.status, 200);
  assert.equal(noAction.body.optionsGenerated, 0);
  assert.deepEqual(
    await db.all('SELECT * FROM inventory ORDER BY facility_code, product_sku'),
    inventoryBeforeAnalysis,
  );
  assert.equal((await db.all('PRAGMA foreign_key_check')).length, 0);
  assert.equal((await verifyChain(db)).valid, true);
});

test('synthetic import rolls back when a same-key record differs', async (t) => {
  const { server, base, db } = await freshServer();
  t.after(() => server.close());
  await db.run(
    `INSERT INTO lanes (id,origin_code,destination_code,mode,distance_km,carrier_code)
     VALUES (10004,'WH-BLR','HOS-APO','ROAD',999,'CAR-ROAD')`,
  );

  const result = await post(base, '/api/admin/import-synthetic', {});
  assert.equal(result.status, 500);
  assert.match(result.body.error, /conflicting existing record/);
  assert.equal(await db.get('SELECT code FROM carriers WHERE code = ?', ['SYN-ROAD']), undefined);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM inventory')).n, 15);
  assert.equal((await db.get('SELECT distance_km FROM lanes WHERE id = ?', [10004])).distance_km, 999);
});

test('GET /api/overview returns canonical KPIs', async () => {
  const { server, base } = await freshServer();
  const { status, body } = await get(base, '/api/overview');
  assert.equal(status, 200);
  const kpis = Object.fromEntries(body.kpis.map((k) => [k.label, k.value]));
  assert.equal(kpis['Active Disruptions'], '10');
  assert.equal(kpis['At-Risk Shipments'], '4');
  assert.equal(kpis['Hospitals at Risk'], '04');
  assert.equal(kpis['Critical Medicine Stock'], '0.8');
  assert.equal(body.agents.length, 5);
  server.close();
});

test('network API exposes all seven cities and persisted operational record sets', async (t) => {
  const { server, base } = await freshServer();
  t.after(() => server.close());
  const { status, body } = await get(base, '/api/network');
  assert.equal(status, 200);
  const cities = new Set(body.facilities.map((facility) => facility.city));
  for (const city of ['Mumbai', 'Chennai', 'Hyderabad', 'Bengaluru', 'Delhi NCR', 'Kolkata', 'Pune']) {
    assert.ok(cities.has(city), `${city} should be represented by a facility record`);
  }
  assert.ok(body.medicines.length > 0);
  assert.ok(body.suppliers.length > 0);
  assert.ok(body.inventory.length > 0);
  assert.ok(body.purchaseOrders.length > 0);
  assert.ok(body.shipments.length > 0);
  assert.ok(body.temperatureReadings.length > 0);
  assert.equal(body.shipmentTracking.length, 10);
  assert.ok(body.disruptions.some((event) => event.type === 'POWER_OUTAGE'));
});

test('new synthetic disruption scenarios link records and complete all five agents', async (t) => {
  const { server, base, db } = await freshServer();
  t.after(() => server.close());
  for (const id of [
    'INC-2026-1104-04',
    'INC-2026-1104-05',
    'INC-2026-1104-06',
    'INC-2026-1104-07',
  ]) {
    const result = await post(base, `/api/disruptions/${id}/run-analysis`, {});
    assert.equal(result.status, 200);
    const impact = await db.get(
      "SELECT run_id,payload FROM audit_log WHERE run_id=? AND actor='ImpactAgent'",
      [result.body.runId],
    );
    assert.ok(impact);
    assert.ok(JSON.parse(impact.payload).tracked_shipments > 0);
    const agents = await db.all('SELECT actor FROM audit_log WHERE run_id=?', [result.body.runId]);
    for (const actor of ['SensingAgent', 'ImpactAgent', 'ScenarioAgent', 'LogisticsAgent', 'ComplianceAgent']) {
      assert.ok(agents.some((row) => row.actor === actor), `${actor} should complete for ${id}`);
    }
  }
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
