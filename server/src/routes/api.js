// ============================================================================
// SupplyShield REST API
// Every screen of the existing UI is served from these endpoints. Demo data
// is always flagged via the `demo` marker and the /api/health engine label.
// ============================================================================
const express = require('express');
const rules = require('../rules/rules');
const { engineInfo } = require('../db/index');
const { seed } = require('../db/seed');
const { runPipeline } = require('../agents/orchestrator');
const approval = require('../services/approval');
const { explainerStatus } = require('../llm/explainer');
const weather = require('../integrations/weather');
const s4hana = require('../integrations/s4hana');
const { verifyChain } = require('../utils/audit');
const config = require('../config');

const router = express.Router();

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const db = (req) => req.app.locals.db;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const AGENT_RIBBON = [
  { name: 'Sensing Agent', icon: 'radar' },
  { name: 'Impact Agent', icon: 'alert' },
  { name: 'Scenario Agent', icon: 'brain' },
  { name: 'Logistics Agent', icon: 'route' },
  { name: 'Compliance Agent', icon: 'shield' },
];

const STEP_DISPLAY = {
  'Disruption detected, validated and classified': { title: 'Disruption detected', icon: 'radar', state: 'complete' },
  'Network impact mapped': { title: 'Network impact mapped', icon: 'alert', state: 'complete' },
  'Recovery scenarios generated': { title: 'Recovery scenarios generated', icon: 'brain', state: 'complete' },
  'Routes evaluated, options costed': { title: 'Logistics optimized', icon: 'route', state: 'complete' },
  'Hard cold-chain and safety rules applied': { title: 'Compliance validated', icon: 'shield', state: 'complete' },
  'Planner briefing generated': { title: 'Planner briefing generated', icon: 'spark', state: 'complete' },
  'Recovery plan routed for human approval': { title: 'Human review requested', icon: 'user', state: 'complete' },
  'Recovery plan APPROVED by human planner': { title: 'Recovery plan approved', icon: 'check', state: 'approved' },
  'Recovery plan REJECTED by human planner': { title: 'Recovery plan rejected', icon: 'close', state: 'critical' },
  'Approval BLOCKED by compliance revalidation': { title: 'Approval blocked by compliance', icon: 'shield', state: 'critical' },
};

function auditText(row) {
  let p = {};
  try { p = JSON.parse(row.payload || '{}'); } catch (e) { /* keep empty */ }
  switch (row.step) {
    case 'Disruption detected, validated and classified':
      return `${p.type} matched to port ${p.port} geofence. Severity classified ${p.severity}${p.verified ? ' (verified operational source)' : ' (UNVERIFIED alert)'}.`;
    case 'Network impact mapped':
      return `${p.feed_shipments} shipments, ${p.feed_pos} purchase orders and ${p.hospitals_assessed} hospital inventory positions assessed.`;
    case 'Recovery scenarios generated': {
      const n = (p.candidates || []).length;
      const extra = (p.discarded || []).length
        ? ` ${p.discarded.map((d) => `${d.title} discarded (${d.reason})`).join(' ')}` : '';
      return `${n} recovery options generated: ${(p.candidates || []).join(', ')}.${extra}`;
    }
    case 'Routes evaluated, options costed': {
      const best = (p || []).filter((o) => o.feasible).sort((a, b) => a.cost_usd - b.cost_usd)[0];
      return best
        ? `Transfer quantity ${best.option.match(/\d+/) ? best.option.match(/\d+/)[0] : ''} evaluated; best feasible route ${best.carrier} at USD ${best.cost_usd}, arrival in ${best.eta_hours} hours.`
        : 'No feasible route found.';
    }
    case 'Hard cold-chain and safety rules applied': {
      const passed = (p || []).filter((o) => o.eligible).length;
      const rejected = (p || []).filter((o) => !o.compliant).length;
      return `${passed} option(s) passed all controls. ${rejected} option(s) rejected by hard rules.`;
    }
    case 'Planner briefing generated':
      return `Briefing source: ${p.source}`;
    case 'Recovery plan routed for human approval':
      return `Recovery plan ${p.plan} routed to an authorized planner.`;
    case 'Recovery plan APPROVED by human planner':
      return `Planner approved "${p.option}". Execution recorded as SIMULATED.${p.comment ? ` Comment: ${p.comment}` : ''}`;
    case 'Recovery plan REJECTED by human planner':
      return `Planner rejected "${p.option}". Returned for replanning.${p.comment ? ` Comment: ${p.comment}` : ''}`;
    case 'Approval BLOCKED by compliance revalidation':
      return `Approval of "${p.option}" blocked server-side: ${(p.reasons || []).join('; ')}`;
    default:
      return row.step;
  }
}

function timeOf(ts) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toTimeString().slice(0, 8);
}

async function latestPlan(req) {
  return db(req).get('SELECT * FROM recovery_plans ORDER BY created_at DESC, id DESC LIMIT 1');
}

async function planOptions(req, planId) {
  const rows = await db(req).all('SELECT * FROM recovery_options WHERE plan_id = ? ORDER BY id', [planId]);
  return rows.map((o) => ({
    ...o,
    checks: JSON.parse(o.checks_json || '[]'),
    scores: JSON.parse(o.scores_json || '{}'),
  }));
}

async function primaryRiskPosition(req) {
  // The most critical hospital inventory position: lowest stock cover.
  const rows = await db(req).all(
    `SELECT i.*, f.name AS facility_name, f.priority, m.name AS medicine, m.unit, m.case_size, m.batch
     FROM inventory i
     JOIN facilities f ON f.code = i.facility_code
     JOIN medicines m ON m.sku = i.product_sku
     WHERE f.type = 'HOSPITAL' AND i.daily_usage > 0`,
  );
  let worst = null;
  for (const r of rows) {
    const available = r.qty_on_hand - r.reserved_qty;
    const coverHours = rules.stockCoverHours(available, r.daily_usage);
    if (!worst || coverHours < worst.cover_hours) {
      worst = { ...r, available, cover_hours: coverHours, cover_days: rules.r1(coverHours / 24) };
    }
  }
  return worst;
}

// ---------------------------------------------------------------------------
// health & integrations
// ---------------------------------------------------------------------------
router.get('/health', asyncH(async (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    db: engineInfo(),
    llm: explainerStatus(),
    integrations: {
      s4hana: s4hana.status(),
      weather: { provider: config.weather.provider === 'off' ? 'disabled' : 'Open-Meteo (live)' },
    },
    demo: true,
    note: 'All records are SIMULATED demo data unless an integration reports itself live.',
  });
}));

router.get('/integrations/status', asyncH(async (req, res) => {
  res.json({
    db: engineInfo(),
    llm: explainerStatus(),
    s4hana: s4hana.status(),
    weather: { provider: config.weather.provider === 'off' ? 'disabled' : 'Open-Meteo (live, key-free)' },
  });
}));

router.post('/integrations/weather/refresh', asyncH(async (req, res) => {
  res.json(await weather.refresh());
}));

router.post('/admin/reseed', asyncH(async (req, res) => {
  await seed(db(req));
  const result = await runPipeline(db(req), 'INC-2026-1104-03', 'system');
  res.json({ reseeded: true, ...result });
}));

// ---------------------------------------------------------------------------
// 1. Overview
// ---------------------------------------------------------------------------
router.get('/overview', asyncH(async (req, res) => {
  const stats = {};
  for (const row of await db(req).all('SELECT * FROM network_stats')) stats[row.metric] = row;

  const activeDisruptions = await db(req).get(
    "SELECT COUNT(*) AS n FROM disruptions WHERE status IN ('ACTIVE','MONITORING','ANALYSED')",
  );
  const worst = await primaryRiskPosition(req);
  const plan = await latestPlan(req);
  const options = plan ? await planOptions(req, plan.id) : [];
  const alerts = await db(req).all('SELECT * FROM alerts ORDER BY id');
  const disruption = await db(req).get("SELECT * FROM disruptions WHERE id = 'INC-2026-1104-03'");

  const rejectedByRules = options.filter((o) => !o.compliant).length;
  const agents = AGENT_RIBBON.map((a, i) => ({
    ...a,
    status: !plan ? 'Awaiting analysis' : [
      'Disruption detected',
      `${disruption.affected_shipments} shipments assessed`,
      `${options.length} recovery options generated`,
      'Alternative route identified',
      `${rejectedByRules} option rejected`,
    ][i],
    warning: i === 4 && rejectedByRules > 0,
  }));

  res.json({
    demo: true,
    kpis: [
      { label: 'Active Disruptions', value: String(activeDisruptions.n).padStart(2, '0'), trend: `+${stats.active_disruptions_delta.value}`, detail: stats.active_disruptions_delta.detail, icon: 'alert', tone: 'critical' },
      { label: 'At-Risk Shipments', value: String(stats.shipments_at_risk.value), trend: '9.7%', detail: 'of in-transit', icon: 'truck', tone: 'warning' },
      { label: 'Hospitals at Risk', value: String(stats.hospitals_at_risk.value).padStart(2, '0'), trend: '+1', detail: 'since 17:00', icon: 'hospital', tone: 'purple' },
      worst && { label: 'Critical Medicine Stock', value: String(worst.cover_days), trend: 'DAYS', detail: `${worst.medicine.replace('Human ', '')} / ${worst.facility_name.replace(' Hospital', '')}`, icon: 'medicine', tone: 'teal' },
    ].filter(Boolean),
    health: {
      score: stats.resilience_score.value,
      status: 'Operational with elevated risk',
      delta: stats.resilience_score.detail,
      signals: [
        { label: 'Supply continuity', value: `${stats.supply_continuity.value}%`, tone: 'cyan' },
        { label: 'Cold-chain integrity', value: `${stats.cold_chain_integrity.value}%`, tone: 'teal' },
        { label: 'Response readiness', value: `${stats.response_readiness.value}%`, tone: 'amber' },
      ],
    },
    alerts: alerts.map((a) => [a.severity, a.location, a.medicine, a.message, a.ago]),
    agents,
    runId: plan ? plan.run_id : null,
    mapEvent: {
      title: 'Cyclone Varun · Chennai Port',
      meta: `Radius ${disruption.radius_km} km · severity ${disruption.severity.toLowerCase()}`,
    },
    insight: plan && options.length
      ? 'Bengaluru inventory transfer can prevent the earliest insulin stockout with verified cold-chain capability.'
      : 'Run the AI impact assessment to generate recovery intelligence.',
  });
}));

// ---------------------------------------------------------------------------
// 2. Disruptions
// ---------------------------------------------------------------------------
router.get('/disruptions', asyncH(async (req, res) => {
  res.json({ demo: true, disruptions: await db(req).all('SELECT * FROM disruptions ORDER BY created_at DESC') });
}));

router.get('/disruptions/:id', asyncH(async (req, res) => {
  const d = await db(req).get('SELECT * FROM disruptions WHERE id = ?', [req.params.id]);
  if (!d) return res.status(404).json({ error: 'Disruption not found' });
  const timeline = await db(req).all('SELECT ts,title,text,state FROM disruption_timeline WHERE disruption_id = ?', [d.id]);
  const infrastructure = await db(req).all('SELECT label,status,tone,icon FROM infrastructure_status WHERE disruption_id = ?', [d.id]);
  res.json({ demo: true, disruption: d, timeline, infrastructure });
}));

router.post('/disruptions', asyncH(async (req, res) => {
  const { type, location, severity, duration, description } = req.body || {};
  const errors = [];
  if (!type || typeof type !== 'string') errors.push('type is required');
  if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(severity || '').toUpperCase())) {
    errors.push('severity must be one of LOW, MEDIUM, HIGH, CRITICAL');
  }
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const sev = String(severity).toUpperCase();
  const id = `INC-MANUAL-${Date.now()}`;
  const delay = Number.parseInt(duration, 10);
  await db(req).run(
    `INSERT INTO disruptions (id,type,title,port,severity,description,status,radius_km,wind_kmh,expected_delay_hours,affected_shipments,affected_pos,verified,source,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, type.toUpperCase().replace(/\s+/g, '_'), `${type.toUpperCase()} — ${(location || 'unspecified location').toUpperCase()}`,
      '', sev, `${description || ''} (MANUAL ENTRY - SIMULATED)`, 'NEW', null, null,
      Number.isFinite(delay) ? delay : null, 0, 0, 0, 'Manual planner entry', new Date().toISOString()],
  );
  res.status(201).json({ demo: true, id, message: 'Disruption event created (manual, unverified). Run the AI impact assessment to evaluate it.' });
}));

router.post('/disruptions/:id/run-analysis', asyncH(async (req, res) => {
  const result = await runPipeline(db(req), req.params.id, req.user.full_name);
  if (result.error) return res.status(422).json(result);
  const options = result.planId ? await planOptions(req, result.planId) : [];
  res.json({
    ...result,
    optionsGenerated: options.length,
    recommendedTitle: result.recommended ? result.recommended.title : null,
  });
}));

// ---------------------------------------------------------------------------
// 3. Shipments
// ---------------------------------------------------------------------------
router.get('/shipments', asyncH(async (req, res) => {
  const stats = {};
  for (const row of await db(req).all('SELECT * FROM network_stats')) stats[row.metric] = row;
  const shipments = await db(req).all(
    `SELECT s.*, m.name AS medicine FROM shipments s JOIN medicines m ON m.sku = s.product_sku ORDER BY s.id`,
  );
  res.json({
    demo: true,
    kpis: [
      { value: String(stats.shipments_in_transit.value), label: 'In transit', icon: 'truck' },
      { value: String(stats.shipments_at_risk.value), label: 'At risk', icon: 'alert' },
      { value: String(stats.route_exceptions.value).padStart(2, '0'), label: 'Route exceptions', icon: 'route' },
      { value: `${stats.temp_compliant_pct.value}%`, label: 'Temperature compliant', icon: 'temperature' },
    ],
    totalInTransit: stats.shipments_in_transit.value,
    criticalCount: shipments.filter((s) => s.risk === 'Critical').length,
    shipments: shipments.map((s) => ({
      id: s.id, medicine: s.medicine, batch: s.batch, origin: s.origin_label,
      destination: s.destination_label, route: s.route, eta: s.eta_text,
      temp: `${s.current_temp}°C`, status: s.status, risk: s.risk, po: s.po_ebeln,
    })),
  });
}));

router.get('/shipments/:id', asyncH(async (req, res) => {
  const s = await db(req).get(
    `SELECT s.*, m.name AS medicine, m.min_temp, m.max_temp FROM shipments s
     JOIN medicines m ON m.sku = s.product_sku WHERE s.id = ?`, [req.params.id],
  );
  if (!s) return res.status(404).json({ error: 'Shipment not found' });
  const readings = await db(req).all(
    'SELECT ts,temp_c FROM temperature_readings WHERE shipment_id = ? ORDER BY id', [s.id],
  );
  const band = rules.checkTemperatureBand(readings.map((r) => r.temp_c), s.min_temp, s.max_temp);
  res.json({
    demo: true,
    shipment: {
      id: s.id, medicine: s.medicine, batch: s.batch, origin: s.origin_label,
      destination: s.destination_label, route: s.route, eta: s.eta_text,
      temp: `${s.current_temp}°C`, status: s.status, risk: s.risk, po: s.po_ebeln,
      band: `+${s.min_temp}°C to +${s.max_temp}°C`,
    },
    readings: readings.map((r) => r.temp_c),
    tempCompliance: band,
    recoveryNote: 'This shipment is included in recovery scenario B. Transfer stock is available in Bengaluru while the original consignment remains protected at Chennai.',
  });
}));

// ---------------------------------------------------------------------------
// 4. Inventory & stock risk
// ---------------------------------------------------------------------------
router.get('/inventory', asyncH(async (req, res) => {
  const worst = await primaryRiskPosition(req);
  const disruption = await db(req).get("SELECT * FROM disruptions WHERE id = 'INC-2026-1104-03'");
  const delayHours = disruption.expected_delay_hours;
  const transferQty = rules.transferQuantity(
    worst.available, worst.daily_usage, delayHours, worst.case_size,
  );
  const restoredDays = rules.r1((worst.available + transferQty) / worst.daily_usage);

  const hospitals = await db(req).all("SELECT * FROM facilities WHERE type = 'HOSPITAL' ORDER BY priority");
  const priorities = hospitals.map((h) => ({
    name: h.name.replace(' Hospital', '').replace(' Network', ''), ward: h.ward, priority: h.priority,
    tone: h.priority === 'P1' ? 'critical' : h.priority === 'P2' ? 'warning' : 'success',
  }));

  const rows = [];
  const invRows = await db(req).all(
    `SELECT i.*, f.name AS facility_name, f.type AS facility_type, m.name AS medicine, m.unit
     FROM inventory i JOIN facilities f ON f.code = i.facility_code
     JOIN medicines m ON m.sku = i.product_sku`,
  );
  const demandByProduct = {};
  for (const r of invRows) {
    if (r.daily_usage > 0) demandByProduct[r.product_sku] = Math.max(demandByProduct[r.product_sku] || 0, r.daily_usage);
  }
  const shipments = await db(req).all('SELECT * FROM shipments');
  for (const r of invRows) {
    const available = r.qty_on_hand - r.reserved_qty;
    const use = r.daily_usage > 0 ? r.daily_usage : (demandByProduct[r.product_sku] || 1);
    const coverDays = rules.r1((available / use) * 24 / 24);
    const ship = shipments.find((s) => s.destination_code === r.facility_code);
    const replenishment = r.facility_type === 'WAREHOUSE' ? 'Ready' : (ship && ship.delay_hours > 0 ? `${ship.delay_hours}h` : (ship ? ship.eta_text.replace(/ .*/, '') : '—'));
    let risk;
    if (r.facility_type === 'WAREHOUSE') risk = 'Available';
    else {
      const delay = ship && ship.delay_hours > 0 ? ship.delay_hours : delayHours;
      const coverH = (available / use) * 24;
      risk = coverH < delay ? 'Critical' : coverH < delay + 72 ? 'High' : 'Stable';
    }
    rows.push({
      facility: r.facility_name,
      medicine: r.medicine,
      available: `${available.toLocaleString('en-US')} ${r.unit}`,
      demand: r.daily_usage > 0 ? `${r.daily_usage}/day` : '—',
      cover: `${coverDays} days`,
      replenishment,
      risk,
    });
  }
  const order = { Critical: 0, High: 1, Stable: 2, Available: 3 };
  rows.sort((a, b) => order[a.risk] - order[b.risk]);

  res.json({
    demo: true,
    critical: {
      medicine: worst.medicine,
      facility: worst.facility_name,
      batch: worst.batch,
      available: worst.available,
      unit: worst.unit,
      demandPerDay: worst.daily_usage,
      coverDays: worst.cover_days,
      coverHours: worst.cover_hours,
      delayHours,
      stockoutHours: Math.round(worst.cover_hours),
      gapHours: Math.round(delayHours - worst.cover_hours),
      transferQty,
      donorFacility: 'Bengaluru Warehouse',
      restoredCoverDays: restoredDays,
      thresholdHours: 30,
    },
    priorities,
    rows,
  });
}));

// ---------------------------------------------------------------------------
// 5. Recovery planning + 7. Approval
// ---------------------------------------------------------------------------
async function planPayload(req, plan) {
  const options = await planOptions(req, plan.id);
  const disruption = await db(req).get('SELECT * FROM disruptions WHERE id = ?', [plan.disruption_id]);
  const rejectedByRules = options.filter((o) => !o.compliant).length;
  const ribbon = AGENT_RIBBON.map((a, i) => ({
    ...a,
    status: [
      'Disruption detected',
      `${disruption.affected_shipments} shipments assessed`,
      `${options.length} recovery options generated`,
      'Alternative route identified',
      `${rejectedByRules} option rejected`,
    ][i],
    warning: i === 4 && rejectedByRules > 0,
  }));
  const recommended = options.find((o) => o.recommended) || null;
  return { plan, options, recommended, disruption, ribbon };
}

router.get('/recovery-plans/current', asyncH(async (req, res) => {
  const plan = await latestPlan(req);
  if (!plan) return res.status(404).json({ error: 'No recovery plan yet - run the AI impact assessment first.' });
  res.json({ demo: true, ...(await planPayload(req, plan)) });
}));

router.get('/recovery-plans/:id', asyncH(async (req, res) => {
  const plan = await db(req).get('SELECT * FROM recovery_plans WHERE id = ?', [req.params.id]);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  res.json({ demo: true, ...(await planPayload(req, plan)) });
}));

router.post('/recovery-plans/:id/approve', asyncH(async (req, res) => {
  const plan = await db(req).get('SELECT * FROM recovery_plans WHERE id = ?', [req.params.id]);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  const optionId = (req.body && req.body.optionId) || plan.recommended_option_id;
  const comment = (req.body && req.body.comment) || '';
  const result = await approval.decide(db(req), plan.id, optionId, 'APPROVED', req.user.full_name, comment);
  res.json(result);
}));

router.post('/recovery-plans/:id/reject', asyncH(async (req, res) => {
  const plan = await db(req).get('SELECT * FROM recovery_plans WHERE id = ?', [req.params.id]);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  const optionId = (req.body && req.body.optionId) || plan.recommended_option_id;
  const comment = (req.body && req.body.comment) || '';
  const result = await approval.decide(db(req), plan.id, optionId, 'REJECTED', req.user.full_name, comment);
  res.json(result);
}));

// Approve an arbitrary option (demo of server-side enforcement: approving the
// non-compliant air option returns HTTP 409 with the rule evidence).
router.post('/recovery-options/:id/approve', asyncH(async (req, res) => {
  const option = await db(req).get('SELECT * FROM recovery_options WHERE id = ?', [req.params.id]);
  if (!option) return res.status(404).json({ error: 'Option not found' });
  const comment = (req.body && req.body.comment) || '';
  const result = await approval.decide(db(req), option.plan_id, option.id, 'APPROVED', req.user.full_name, comment);
  res.json(result);
}));

// ---------------------------------------------------------------------------
// 6. Cold-chain compliance
// ---------------------------------------------------------------------------
router.get('/compliance', asyncH(async (req, res) => {
  const stats = {};
  for (const row of await db(req).all('SELECT * FROM network_stats')) stats[row.metric] = row;
  const med = await db(req).get("SELECT * FROM medicines WHERE sku = 'MED-INSULIN'");
  const readings = await db(req).all(
    "SELECT ts,temp_c FROM temperature_readings WHERE batch = ? ORDER BY id", [med.batch],
  );
  const temps = readings.map((r) => r.temp_c);
  const band = rules.checkTemperatureBand(temps, med.min_temp, med.max_temp);
  const batchCheck = rules.checkBatchValidity(med);

  const plan = await latestPlan(req);
  const options = plan ? await planOptions(req, plan.id) : [];
  const validations = options
    .filter((o) => o.code !== 'WAIT')
    .map((o) => ({
      title: o.code === 'AIR_REROUTE' ? 'Air rerouting' : 'Bengaluru stock transfer',
      status: o.compliant ? 'PASSED' : 'FAILED',
      tone: o.compliant ? 'passed' : 'failed',
      checks: o.checks.map((c) => ({ label: c.label, pass: Boolean(c.pass) })),
      reason: o.compliant ? 'All configured requirements verified.' : (o.checks.find((c) => !c.pass) || {}).note || 'Validation failed.',
    }));

  res.json({
    demo: true,
    networkCompliance: stats.cold_chain_integrity.value,
    range: { min: med.min_temp, max: med.max_temp, label: `+${med.min_temp}°C to +${med.max_temp}°C` },
    appliesTo: `${med.name} batch ${med.batch}`,
    checks: ['Temperature telemetry active', 'Batch within expiry', 'Approved donor warehouse'],
    telemetry: {
      batch: med.batch,
      readings,
      min: band.min, max: band.max, avg: band.avg,
      excursions: band.excursions,
      current: temps[temps.length - 1],
      withinRange: band.compliant,
    },
    batchRecord: {
      name: med.name, batch: med.batch, manufactured: med.manufactured,
      expiry: med.expiry, gdp: med.gdp_class,
      range: `+${med.min_temp}°C to +${med.max_temp}°C`,
      valid: batchCheck.pass, note: batchCheck.note,
    },
    validations,
  });
}));

// ---------------------------------------------------------------------------
// 8. Execution & audit trail
// ---------------------------------------------------------------------------
router.get('/audit', asyncH(async (req, res) => {
  const plan = await latestPlan(req);
  const integrity = await verifyChain(db(req));
  if (!plan) return res.json({ demo: true, plan: null, events: [], integrity });
  const options = await planOptions(req, plan.id);
  const recommended = options.find((o) => o.recommended) || options[0];
  const rows = await db(req).all('SELECT * FROM audit_log WHERE run_id = ? ORDER BY seq', [plan.run_id]);
  // Also surface decision events from other runs of the same plan chain.
  const decisionRows = await db(req).all(
    "SELECT * FROM audit_log WHERE step LIKE 'Recovery plan %' OR step LIKE 'Approval BLOCKED%' ORDER BY seq",
  );
  const seen = new Set();
  const allRows = [...rows, ...decisionRows].filter((r) => {
    if (seen.has(r.seq)) return false;
    seen.add(r.seq);
    return true;
  }).sort((a, b) => a.seq - b.seq);

  const events = allRows.map((r) => {
    const display = STEP_DISPLAY[r.step] || { title: r.step, icon: 'document', state: 'complete' };
    return {
      time: timeOf(r.ts), title: display.title, actor: r.actor,
      text: auditText(r), icon: display.icon, state: display.state,
      hash: r.hash.slice(0, 12),
    };
  });
  if (plan.status === 'PENDING_APPROVAL') {
    events.push({
      time: 'PENDING', title: 'Awaiting authorization', actor: 'Human decision',
      text: 'No execution can proceed until an authorized planner decides.',
      icon: 'clock', state: 'active', hash: null,
    });
  }

  const source = recommended && recommended.source_code
    ? await db(req).get('SELECT * FROM facilities WHERE code = ?', [recommended.source_code]) : null;
  const carrier = recommended && recommended.carrier_code
    ? await db(req).get('SELECT * FROM carriers WHERE code = ?', [recommended.carrier_code]) : null;
  const dest = await db(req).get("SELECT * FROM facilities WHERE code = 'HOS-STM'");
  const decidedAt = plan.decided_at ? new Date(plan.decided_at) : null;
  const arrival = decidedAt && recommended
    ? new Date(decidedAt.getTime() + recommended.eta_hours * 3600 * 1000) : null;
  const approvalRow = await db(req).get(
    'SELECT * FROM approvals WHERE plan_id = ? ORDER BY created_at DESC LIMIT 1', [plan.id],
  );

  res.json({
    demo: true,
    plan: {
      id: plan.id, status: plan.status, correlationId: plan.correlation_id,
      recommendedTitle: recommended ? recommended.title : null,
      qty: recommended ? recommended.qty : 0,
      destination: 'St. Martha Hospital',
      planner: plan.decided_by || null,
      decidedAt: plan.decided_at || null,
    },
    events,
    execution: {
      transferReference: approvalRow && plan.status === 'APPROVED'
        ? (approvalRow.execution_note.match(/TR-SIM-\d+/) || ['Pending'])[0] : 'Pending',
      sourceStorage: source ? source.storage_loc : 'BLR-WH-01',
      destination: dest ? dest.storage_loc : 'STM-HOSP-04',
      reefer: carrier && carrier.vehicle ? carrier.vehicle : 'BLR-CC-118',
      expectedArrival: arrival
        ? arrival.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
        : (recommended ? `T+${recommended.eta_hours} hours` : 'Pending'),
      simulated: true,
    },
    integrity,
  });
}));

module.exports = router;
