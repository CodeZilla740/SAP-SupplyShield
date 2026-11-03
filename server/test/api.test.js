// API integration tests: full HTTP round-trips against an ephemeral server
// with an isolated in-memory database.
const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDb, freshServer, post, get } = require('./helpers');
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
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM shipment_tracking')).n, 17);

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
  assert.equal(canonicalAnalysis.body.optionsGenerated, 4);
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
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM inventory')).n, 18);
  assert.equal((await db.get('SELECT distance_km FROM lanes WHERE id = ?', [10004])).distance_km, 999);
});

test('GET /api/overview returns canonical KPIs', async (t) => {
  const { server, base } = await freshServer();
  t.after(() => server.close());
  const { status, body } = await get(base, '/api/overview');
  assert.equal(status, 200);
  const kpis = Object.fromEntries(body.kpis.map((k) => [k.label, k.value]));
  assert.equal(kpis['Active Disruptions'], '11');
  assert.equal(kpis['At-Risk Shipments'], '8');
  assert.equal(kpis['Hospitals at Risk'], '06');
  assert.equal(kpis['Critical Medicine Stock'], '0.8');
  assert.equal(body.agents.length, 5);
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
  assert.equal(body.shipmentTracking.length, 14);
  const knownDisruptions = new Map([
    ['INC-2026-1104-01', 'HEAVY RAIN — MUMBAI PORT'],
    ['INC-2026-1104-02', 'DENSE FOG — HYDERABAD AIR CARGO'],
    ['INC-2026-1104-03', 'CYCLONE — CHENNAI PORT CLOSURE'],
    ['INC-2026-1104-04', 'PORT CONGESTION — KOLKATA'],
    ['INC-2026-1104-05', 'DEMAND SURGE — DELHI NCR'],
    ['INC-2026-1104-06', 'FACILITY POWER OUTAGE — PUNE'],
    ['INC-2026-1104-07', 'EXTREME WEATHER — MUMBAI'],
    ['INC-2026-1104-08', 'FLOOD — MUMBAI PORT CLOSURE'],
    ['INC-2026-1104-09', 'BERTH CONGESTION — KOLKATA PORT'],
    ['INC-2026-1104-10', 'CYCLONE — VISAKHAPATNAM PORT CLOSURE'],
    ['INC-2026-1104-15', 'TRANSPORT DELAY — BENGALURU LOGISTICS HUB'],
  ]);
  assert.equal(body.disruptions.length, knownDisruptions.size);
  for (const event of body.disruptions) {
    assert.equal(knownDisruptions.get(event.id), event.title);
  }
});

test('Bengaluru inbound delay generates scoped recovery, compliance and approval data', async (t) => {
  const { server, base, db } = await freshServer({ withPlan: false });
  t.after(() => server.close());

  const disruption = await get(base, '/api/disruptions/INC-2026-1104-15');
  assert.equal(disruption.status, 200);
  assert.equal(disruption.body.disruption.port, 'INBLR');
  assert.equal(disruption.body.impact.facility_code, 'HOS-APO');
  assert.equal(disruption.body.impact.medicine, 'mRNA Vaccine');
  assert.equal(disruption.body.impact.delay_hours, 120);
  assert.equal(disruption.body.affectedShipments.some((shipment) => shipment.id === 'SS-2084'), true);
  const locations = await get(base, '/api/disruption-locations');
  assert.ok(locations.body.locations.some(
    (location) => location.code === 'INBLR' && location.primaryDisruptionId === 'INC-2026-1104-15',
  ));

  const analysis = await post(base, '/api/disruptions/INC-2026-1104-15/run-analysis', {});
  assert.equal(analysis.status, 200);
  const agentActors = await db.all(
    "SELECT actor FROM audit_log WHERE run_id = ? AND actor IN ('SensingAgent','ImpactAgent','ScenarioAgent','LogisticsAgent','ComplianceAgent') ORDER BY seq",
    [analysis.body.runId],
  );
  assert.deepEqual(
    agentActors.map((row) => row.actor),
    ['SensingAgent', 'ImpactAgent', 'ScenarioAgent', 'LogisticsAgent', 'ComplianceAgent'],
  );
  const plan = await get(
    base,
    '/api/recovery-plans/current?port=INBLR&disruptionId=INC-2026-1104-15',
  );
  assert.equal(plan.status, 200);
  assert.equal(plan.body.disruption.id, 'INC-2026-1104-15');
  assert.equal(plan.body.impact.available, 840);
  assert.equal(plan.body.impact.daily_usage, 220);
  assert.equal(plan.body.impact.transfer_qty, 500);
  assert.ok(plan.body.options.some((option) => option.code === 'WAIT'));

  const actionable = plan.body.options.filter((option) => option.code !== 'WAIT');
  assert.ok(actionable.length >= 2);
  assert.deepEqual(
    new Set(actionable.map((option) => option.source_code)),
    new Set(['WH-BLR', 'WH-KOL', 'WH-PUN']),
  );
  assert.equal(actionable.filter((option) => option.eligible).length, 1);
  assert.ok(actionable.filter((option) => !option.eligible).every((option) => /No inventory record/.test(option.reason)));
  const recommended = plan.body.recommended;
  assert.ok(recommended);
  assert.equal(recommended.source_code, 'WH-KOL');
  assert.equal(recommended.qty, 500);
  assert.equal(recommended.eligible, 1);
  assert.equal(actionable.filter((option) => option.recommended).length, 1);
  assert.equal(recommended.scores.compliance, 100);

  const compliance = await get(
    base,
    '/api/compliance?port=INBLR&disruptionId=INC-2026-1104-15',
  );
  assert.equal(compliance.status, 200);
  assert.equal(compliance.body.plan.id, plan.body.plan.id);
  assert.equal(compliance.body.plan.recommendedOptionId, recommended.id);
  assert.equal(compliance.body.validations.length, actionable.length);
  const recommendedValidation = compliance.body.validations.find((item) => item.id === recommended.id);
  assert.equal(recommendedValidation.status, 'PASSED');
  assert.equal(recommendedValidation.recommendationStatus, 'RECOMMENDED');
  assert.equal(recommendedValidation.donorWarehouse, 'Kolkata Distribution Centre');
  assert.equal(recommendedValidation.qty, 500);
  assert.equal(recommendedValidation.etaHours, recommended.eta_hours);
  assert.equal(recommendedValidation.costUsd, recommended.cost_usd);
  assert.ok(recommendedValidation.checks.every((check) => check.pass));

  const approval = await post(
    base,
    `/api/recovery-plans/${plan.body.plan.id}/approve`,
    { optionId: recommended.id },
  );
  assert.equal(approval.status, 200);
  const approvalRow = await db.get(
    'SELECT plan_id,option_id FROM approvals WHERE plan_id = ?',
    [plan.body.plan.id],
  );
  assert.equal(approvalRow.plan_id, plan.body.plan.id);
  assert.equal(approvalRow.option_id, recommended.id);
});

test('Bengaluru seed migration restores the missing event without resetting its analyzed state', async () => {
  const { db } = await freshDb({ withPlan: false });
  const { seedGeographicAdditions } = require('../src/db/seed');

  await db.run("DELETE FROM infrastructure_status WHERE disruption_id = 'INC-2026-1104-15'");
  await db.run("DELETE FROM disruption_timeline WHERE disruption_id = 'INC-2026-1104-15'");
  await db.run("DELETE FROM disruptions WHERE id = 'INC-2026-1104-15'");
  await seedGeographicAdditions(db);

  const event = await db.get(
    'SELECT id,status FROM disruptions WHERE id = ?',
    ['INC-2026-1104-15'],
  );
  assert.deepEqual(event, { id: 'INC-2026-1104-15', status: 'MONITORING' });
  assert.equal((await db.get(
    'SELECT COUNT(*) AS n FROM disruption_timeline WHERE disruption_id = ?',
    ['INC-2026-1104-15'],
  )).n, 3);

  const { runPipeline } = require('../src/agents/orchestrator');
  await runPipeline(db, 'INC-2026-1104-15', 'test');
  await seedGeographicAdditions(db);
  assert.equal(
    (await db.get('SELECT status FROM disruptions WHERE id = ?', ['INC-2026-1104-15'])).status,
    'ANALYSED',
  );
  assert.equal((await db.get(
    'SELECT COUNT(*) AS n FROM disruptions WHERE id = ?',
    ['INC-2026-1104-15'],
  )).n, 1);
});

test('Delhi demand-surge seed sync refreshes the existing disruption record idempotently', async () => {
  const { db } = await freshDb({ withPlan: false });
  const { syncDelhiDemandSurge } = require('../src/db/seed');
  await db.run(
    "UPDATE disruptions SET description = 'old description', source = 'old source' WHERE id = ?",
    ['INC-2026-1104-05'],
  );
  await syncDelhiDemandSurge(db);
  const first = await db.get(
    'SELECT description,source FROM disruptions WHERE id = ?',
    ['INC-2026-1104-05'],
  );
  assert.match(first.description, /40% above baseline/);
  assert.match(first.source, /40% demand increase/);
  await syncDelhiDemandSurge(db);
  const second = await db.get(
    'SELECT description,source FROM disruptions WHERE id = ?',
    ['INC-2026-1104-05'],
  );
  assert.deepEqual(second, first);
});

test('original port disruptions resolve linked impact, shipment, and recovery data', async (t) => {
  const { server, base, db } = await freshServer();
  t.after(() => server.close());
  const scenarios = [
    { id: 'INC-2026-1104-03', port: 'INMAA', facility: 'HOS-STM', medicine: 'Human Insulin', donor: 'WH-BLR', qty: 240 },
    { id: 'INC-2026-1104-10', port: 'INVIZ', facility: 'HOS-MAN', medicine: 'Oncology Biologic', donor: 'WH-HYD', qty: 80 },
  ];

  for (const scenario of scenarios) {
    const detail = await get(base, `/api/disruptions/${scenario.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.impact.facility_code, scenario.facility);
    assert.equal(detail.body.impact.medicine, scenario.medicine);
    assert.ok(detail.body.affectedShipments.length > 0);

    const analysis = await post(base, `/api/disruptions/${scenario.id}/run-analysis`, {});
    assert.equal(analysis.status, 200, scenario.id);
    assert.ok(analysis.body.planId, `${scenario.id} should persist a recovery plan`);

    const current = await get(
      base,
      `/api/recovery-plans/current?port=${scenario.port}&disruptionId=${scenario.id}`,
    );
    assert.equal(current.status, 200);
    assert.equal(current.body.disruption.id, scenario.id);
    assert.equal(current.body.impact.facility_code, scenario.facility);
    assert.equal(current.body.recommended.source_code, scenario.donor);
    assert.equal(current.body.recommended.qty, scenario.qty);
    assert.equal(Boolean(current.body.recommended.eligible), true);
    assert.ok(current.body.options.length >= 2);
    for (const option of current.body.options) {
      for (const score of Object.values(option.scores)) {
        assert.ok(Number.isFinite(score) && score >= 0 && score <= 100);
      }
    }
    assert.ok(current.body.recommended.checks.every((check) => check.pass));
    const agents = await db.all('SELECT actor FROM audit_log WHERE run_id=?', [analysis.body.runId]);
    for (const actor of ['SensingAgent', 'ImpactAgent', 'ScenarioAgent', 'LogisticsAgent', 'ComplianceAgent']) {
      assert.ok(agents.some((row) => row.actor === actor), `${actor} should complete for ${scenario.id}`);
    }

    const inventory = await get(base, `/api/inventory?port=${scenario.port}`);
    assert.equal(inventory.status, 200);
    assert.equal(inventory.body.critical.facility, current.body.impact.facility_name);

    const donor = await db.get(
      'SELECT qty_on_hand,reserved_qty,safety_stock FROM inventory WHERE facility_code=? AND product_sku=?',
      [scenario.donor, current.body.impact.product_sku],
    );
    assert.ok(donor.qty_on_hand - donor.reserved_qty - scenario.qty >= donor.safety_stock);
  }

  const locations = await get(base, '/api/disruption-locations');
  for (const port of ['INHYD', 'INDEL', 'INPUN']) {
    assert.ok(locations.body.locations.some((location) => location.code === port));
  }

  const shipments = await get(base, '/api/shipments?port=INBLR');
  assert.equal(shipments.status, 200);
  assert.deepEqual(shipments.body.shipments.map((shipment) => shipment.id), ['SS-2084']);
  test('regional seed additions preserve support data and omit removed disruption rows', async (t) => {
    const { server, db } = await freshServer();
    t.after(() => server.close());
    const before = await db.get(
      'SELECT (SELECT COUNT(*) FROM facilities) AS facilities,(SELECT COUNT(*) FROM inventory) AS inventory,(SELECT COUNT(*) FROM lanes) AS lanes,(SELECT COUNT(*) FROM shipments) AS shipments,(SELECT COUNT(*) FROM purchase_orders) AS pos,(SELECT COUNT(*) FROM disruptions) AS disruptions,(SELECT COUNT(*) FROM temperature_readings) AS readings,(SELECT COUNT(*) FROM shipment_tracking) AS tracking',
    );

    await db.run("DELETE FROM shipment_tracking WHERE shipment_id IN ('SS-2083','SS-2084','SS-2085','SS-2086')");
    await db.run("DELETE FROM temperature_readings WHERE shipment_id IN ('SS-2083','SS-2084','SS-2085','SS-2086')");
    await db.run("DELETE FROM shipments WHERE id IN ('SS-2083','SS-2084','SS-2085','SS-2086')");
    await db.run("DELETE FROM purchase_orders WHERE ebeln IN ('PO-88413','PO-88414','PO-88415','PO-88416')");
    await db.run("DELETE FROM disruption_timeline WHERE disruption_id IN ('INC-2026-1104-11','INC-2026-1104-12','INC-2026-1104-13','INC-2026-1104-14')");
    await db.run("DELETE FROM infrastructure_status WHERE disruption_id IN ('INC-2026-1104-11','INC-2026-1104-12','INC-2026-1104-13','INC-2026-1104-14')");
    await db.run("DELETE FROM disruptions WHERE id IN ('INC-2026-1104-11','INC-2026-1104-12','INC-2026-1104-13','INC-2026-1104-14')");
    await db.run('DELETE FROM lanes WHERE id BETWEEN 13 AND 17');
    await db.run("DELETE FROM inventory WHERE (facility_code='WH-BLR' OR facility_code='WH-HYD') AND product_sku='MED-RABIES'");
    await db.run("DELETE FROM inventory WHERE facility_code='WH-MUM' AND product_sku='MED-PLASMA'");

    await seedGeographicAdditions(db);
    await seedGeographicAdditions(db);

    const after = await db.get(
      'SELECT (SELECT COUNT(*) FROM facilities) AS facilities,(SELECT COUNT(*) FROM inventory) AS inventory,(SELECT COUNT(*) FROM lanes) AS lanes,(SELECT COUNT(*) FROM shipments) AS shipments,(SELECT COUNT(*) FROM purchase_orders) AS pos,(SELECT COUNT(*) FROM disruptions) AS disruptions,(SELECT COUNT(*) FROM temperature_readings) AS readings,(SELECT COUNT(*) FROM shipment_tracking) AS tracking',
    );
    assert.deepEqual(after, before);
    const hyd = await db.get('SELECT type,title,status,expected_delay_hours FROM disruptions WHERE id=?', ['INC-2026-1104-02']);
    assert.deepEqual(hyd, {
      type: 'FOG',
      title: 'DENSE FOG — HYDERABAD AIR CARGO',
      status: 'MONITORING',
      expected_delay_hours: 12,
    });
    for (const id of ['INC-2026-1104-11','INC-2026-1104-12','INC-2026-1104-13','INC-2026-1104-14']) {
      assert.equal(await db.get('SELECT id FROM disruptions WHERE id=?', [id]), undefined);
    }
    assert.ok(await db.get('SELECT id FROM shipments WHERE id=?', ['SS-2086']));
    assert.deepEqual(
      await db.get('SELECT qty_on_hand,reserved_qty,safety_stock FROM inventory WHERE facility_code=? AND product_sku=?', ['WH-MUM', 'MED-PLASMA']),
      { qty_on_hand: 480, reserved_qty: 240, safety_stock: 96 },
    );
  });
});

test('startup cleanup removes only the four added disruptions and their dependent plans', async (t) => {
  const { server, db } = await freshServer();
  t.after(() => server.close());
  const removedIds = ['INC-2026-1104-11','INC-2026-1104-12','INC-2026-1104-13','INC-2026-1104-14'];
  for (const [index, id] of removedIds.entries()) {
    await db.run(
      `INSERT INTO disruptions (id,type,title,port,severity,description,status,expected_delay_hours,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, 'TEST', `Added disruption ${index}`, 'INBLR', 'LOW', 'Migration fixture', 'ACTIVE', 12, '2026-11-04'],
    );
    await db.run(
      `INSERT INTO disruption_timeline (disruption_id,ts,title,text,state) VALUES (?,?,?,?,?)`,
      [id, '00:00', 'Fixture', 'Fixture', 'done'],
    );
    await db.run(
      `INSERT INTO infrastructure_status (disruption_id,label,status,tone,icon) VALUES (?,?,?,?,?)`,
      [id, 'Fixture', 'REMOVED', 'warning', 'box'],
    );
  }
  await db.run(
    `INSERT INTO recovery_plans (id,disruption_id,run_id,correlation_id,status,created_at)
     VALUES ('RP-REMOVED','INC-2026-1104-11','RUN-REMOVED','COR-REMOVED','PENDING_APPROVAL','2026-11-04')`,
  );
  await db.run(
    `INSERT INTO recovery_options (id,plan_id,code,title) VALUES ('OPT-REMOVED','RP-REMOVED','STOCK_TRANSFER','Removed fixture')`,
  );
  await db.run(
    `INSERT INTO approvals (id,plan_id,option_id,decision,actor) VALUES ('APR-REMOVED','RP-REMOVED','OPT-REMOVED','REJECTED','Test')`,
  );

  await removeAddedDisruptions(db);

  for (const id of removedIds) {
    assert.equal(await db.get('SELECT id FROM disruptions WHERE id=?', [id]), undefined);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM disruption_timeline WHERE disruption_id=?', [id])).n, 0);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM infrastructure_status WHERE disruption_id=?', [id])).n, 0);
  }
  for (const table of ['recovery_plans', 'recovery_options', 'approvals']) {
    assert.equal((await db.get(`SELECT COUNT(*) AS n FROM ${table} WHERE id LIKE '%REMOVED'`)).n, 0);
  }
  assert.ok(await db.get("SELECT id FROM disruptions WHERE id='INC-2026-1104-10'"));
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
  assert.equal(res.body.optionsGenerated, 4);
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
  assert.equal(options.length, 4);
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

test('audit histories are scoped to the selected disruption and its recovery plan', async (t) => {
  const { server, base } = await freshServer({ withPlan: false });
  t.after(() => server.close());

  const chennaiAnalysis = await post(base, '/api/disruptions/INC-2026-1104-03/run-analysis', {});
  const chennaiPlan = await get(
    base,
    '/api/recovery-plans/current?port=INMAA&disruptionId=INC-2026-1104-03',
  );
  await post(base, `/api/recovery-plans/${chennaiPlan.body.plan.id}/approve`, {
    optionId: chennaiPlan.body.recommended.id,
    comment: 'Reviewed for Chennai.',
  });

  const bengaluruAnalysis = await post(base, '/api/disruptions/INC-2026-1104-15/run-analysis', {});
  const bengaluruPlan = await get(
    base,
    '/api/recovery-plans/current?port=INBLR&disruptionId=INC-2026-1104-15',
  );
  await post(base, `/api/recovery-plans/${bengaluruPlan.body.plan.id}/approve`, {
    optionId: bengaluruPlan.body.recommended.id,
    comment: 'Reviewed for Bengaluru.',
  });

  const audit = await get(
    base,
    '/api/audit?port=INBLR&disruptionId=INC-2026-1104-15',
  );
  assert.equal(audit.status, 200);
  assert.equal(audit.body.disruptionId, 'INC-2026-1104-15');
  assert.equal(audit.body.plan.id, bengaluruPlan.body.plan.id);
  assert.deepEqual(
    audit.body.agentHistory.map((event) => event.name),
    ['Sensing Agent', 'Impact Agent', 'Scenario Agent', 'Logistics Agent', 'Compliance Agent'],
  );
  assert.ok(audit.body.agentHistory.every((event) => event.status === 'COMPLETED'));
  assert.equal(audit.body.humanReview.length, 1);
  assert.equal(audit.body.humanReview[0].planId, bengaluruPlan.body.plan.id);
  assert.equal(audit.body.humanReview[0].reviewer, 'Test Planner');
  assert.equal(audit.body.humanReview[0].decision, 'APPROVED');
  assert.equal(audit.body.humanReview[0].comment, 'Reviewed for Bengaluru.');
  assert.ok(audit.body.events.every((event) => event.actor !== 'Human decision'));

  const noSelection = await get(base, '/api/audit?port=INBLR&disruptionId=');
  assert.equal(noSelection.body.plan, null);
  assert.deepEqual(noSelection.body.agentHistory, []);
  assert.deepEqual(noSelection.body.humanReview, []);
  assert.equal(chennaiAnalysis.status, 200);
  assert.equal(bengaluruAnalysis.status, 200);
});

test('unknown disruption returns 404', async () => {
  const { server, base } = await freshServer();
  const res = await post(base, '/api/disruptions/NOPE/run-analysis', {});
  assert.equal(res.status, 404);
  server.close();
});
