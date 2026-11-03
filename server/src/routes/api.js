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
const sensingAgent = require('../agents/sensing');
const impactAgent = require('../agents/impact');
const approval = require('../services/approval');
const { explainerStatus } = require('../llm/explainer');
const weather = require('../integrations/weather');
const s4hana = require('../integrations/s4hana');
const { verifyChain } = require('../utils/audit');
const config = require('../config');
const { importSyntheticData } = require('../services/synthetic-import');
const { policy, portCatalogue } = require('../db/canonical-data');

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
      return `${p.type} matched to network location ${p.port}. Severity classified ${p.severity}${p.verified ? ' (verified operational source)' : ' (simulated / unverified)'}.`;
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

async function latestPlan(req, portCode) {
  if (portCode) {
    return db(req).get(
      `SELECT rp.* FROM recovery_plans rp
       JOIN disruptions d ON d.id = rp.disruption_id
       WHERE d.port = ?
       ORDER BY rp.created_at DESC, rp.id DESC LIMIT 1`,
      [portCode],
    );
  }
  return db(req).get('SELECT * FROM recovery_plans ORDER BY created_at DESC, id DESC LIMIT 1');
}

async function planOptions(req, planId) {
  const rows = await db(req).all('SELECT * FROM recovery_options WHERE plan_id = ? ORDER BY id', [planId]);
  return rows.map((o) => {
    const checks = JSON.parse(o.checks_json || '[]');
    const storedFlag = (value) => value === true || Number(value) === 1;
    const compliant = o.code === 'WAIT' || (checks.length > 0 && checks.every((check) => Boolean(check.pass)));
    const eligible = storedFlag(o.feasible) && compliant && storedFlag(o.meets_deadline);
    return {
      ...o,
      compliant: compliant ? 1 : 0,
      eligible: eligible ? 1 : 0,
      recommended: storedFlag(o.recommended) && eligible ? 1 : 0,
      checks,
      scores: JSON.parse(o.scores_json || '{}'),
    };
  });
}

async function primaryRiskPosition(req, portCode) {
  // If portCode is supplied, find the primary risk position linked to that port's shipments/POs
  let rows = [];
  if (portCode) {
    rows = await db(req).all(
      `SELECT i.*, f.name AS facility_name, f.priority, m.name AS medicine, m.unit, m.case_size, m.batch
       FROM inventory i
       JOIN facilities f ON f.code = i.facility_code
       JOIN medicines m ON m.sku = i.product_sku
       WHERE i.daily_usage > 0
         AND (i.facility_code IN (
           SELECT destination_code FROM purchase_orders WHERE port = ?
         ) OR i.facility_code IN (
           SELECT destination_code FROM shipments WHERE origin_code = ? OR origin_code = ?
         ))`,
      [portCode, `PORT-${portCode.replace(/^IN/, '')}`, portCode],
    );
  }
  if (!rows || rows.length === 0) {
    rows = await db(req).all(
      `SELECT i.*, f.name AS facility_name, f.priority, m.name AS medicine, m.unit, m.case_size, m.batch
       FROM inventory i
       JOIN facilities f ON f.code = i.facility_code
       JOIN medicines m ON m.sku = i.product_sku
       WHERE f.type = 'HOSPITAL' AND i.daily_usage > 0`,
    );
  }
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

// ---------------------------------------------------------------------------
// Disruption locations — all distinct disruption cities/locations with active
// incidents, including non-port ones (Delhi, Pune, Hyderabad, etc.)
// ---------------------------------------------------------------------------
router.get('/disruption-locations', asyncH(async (req, res) => {
  const portCityMap = Object.fromEntries((portCatalogue || []).map((p) => [p.code, p.city]));
  // Non-port code to city mapping for synthetic city disruptions
  const cityCodeMap = {
    INHYD: 'Hyderabad', INDEL: 'Delhi NCR', INPUN: 'Pune', INBLR: 'Bengaluru',
    INBOM: 'Mumbai', INKOL: 'Kolkata', INMAA: 'Chennai', INVIZ: 'Visakhapatnam',
    INBLR: 'Bengaluru',
  };
  const rows = await db(req).all(
    "SELECT id, port, title, type, severity, status FROM disruptions WHERE status IN ('ACTIVE','MONITORING','ANALYSED') ORDER BY CASE status WHEN 'ACTIVE' THEN 1 WHEN 'ANALYSED' THEN 2 ELSE 3 END, created_at DESC",
  );
  const seen = new Map();
  for (const row of rows) {
    if (!seen.has(row.port)) {
      const city = portCityMap[row.port] || cityCodeMap[row.port] || row.port;
      seen.set(row.port, { code: row.port, name: city, primaryDisruptionId: row.id, type: row.type, severity: row.severity, status: row.status });
    }
  }
  res.json({ demo: true, locations: [...seen.values()] });
}));

router.get('/ports', asyncH(async (req, res) => {
  const portsWithStatus = await Promise.all((portCatalogue || []).map(async (port) => {
    const activeDisruption = await db(req).get(
      "SELECT * FROM disruptions WHERE port = ? AND status IN ('ACTIVE', 'ANALYSED', 'MONITORING') ORDER BY CASE status WHEN 'ACTIVE' THEN 1 WHEN 'ANALYSED' THEN 2 ELSE 3 END, created_at DESC LIMIT 1",
      [port.code],
    );
    const shipmentsCount = await db(req).get(
      `SELECT COUNT(DISTINCT s.id) AS n FROM shipments s
       JOIN purchase_orders p ON p.ebeln = s.po_ebeln
       WHERE p.port = ? AND s.status = 'Disrupted'`,
      [port.code],
    );
    const posCount = await db(req).get(
      `SELECT COUNT(DISTINCT ebeln) AS n FROM purchase_orders WHERE port = ?`,
      [port.code],
    );
    const latestPlanRow = activeDisruption ? await db(req).get(
      'SELECT id, status, score, recommended_option_id, run_id FROM recovery_plans WHERE disruption_id = ? ORDER BY created_at DESC LIMIT 1',
      [activeDisruption.id],
    ) : null;
    return {
      ...port,
      activeDisruption: activeDisruption || null,
      disruptedShipments: Number(shipmentsCount ? shipmentsCount.n : 0),
      linkedPOs: Number(posCount ? posCount.n : 0),
      plan: latestPlanRow || null,
    };
  }));
  res.json({ demo: true, ports: portsWithStatus });
}));

router.post('/admin/reseed', asyncH(async (req, res) => {
  await seed(db(req));
  const result = await runPipeline(db(req), 'INC-2026-1104-03', 'system');
  for (const did of ['INC-2026-1104-08', 'INC-2026-1104-09', 'INC-2026-1104-10']) {
    await runPipeline(db(req), did, 'system');
  }
  res.json({ reseeded: true, ...result });
}));

router.post('/admin/import-synthetic', asyncH(async (req, res) => {
  if (config.nodeEnv === 'production') {
    return res.status(403).json({ error: 'Synthetic data import is available only outside production.' });
  }
  const result = await importSyntheticData(db(req));
  res.json({
    imported: true,
    counts: result.imported,
    skipped: result.skipped,
    retainedCsvOnly: result.retainedCsvOnly,
  });
}));

// ---------------------------------------------------------------------------
// 1. Overview
// ---------------------------------------------------------------------------
router.get('/overview', asyncH(async (req, res) => {
  const selectedPort = req.query.port;
  // Active disruptions — port-filtered when a specific port/location is selected
  const activeDisruptions = selectedPort
    ? await db(req).get(
        "SELECT COUNT(*) AS n FROM disruptions WHERE status IN ('ACTIVE','MONITORING','ANALYSED') AND port = ?",
        [selectedPort],
      )
    : await db(req).get(
        "SELECT COUNT(*) AS n FROM disruptions WHERE status IN ('ACTIVE','MONITORING','ANALYSED')",
      );
  // For at-risk shipments and hospitals at risk, filter by port when selected
  const shipments = selectedPort
    ? await db(req).all(
        `SELECT s.* FROM shipments s JOIN purchase_orders p ON p.ebeln = s.po_ebeln WHERE p.port = ?`,
        [selectedPort],
      )
    : await db(req).all('SELECT * FROM shipments');
  const hospitalsAtRisk = selectedPort
    ? await db(req).get(
        `SELECT COUNT(DISTINCT s.destination_code) AS n
         FROM shipments s JOIN facilities f ON f.code = s.destination_code
         JOIN purchase_orders p ON p.ebeln = s.po_ebeln
         WHERE f.type = 'HOSPITAL' AND s.risk IN ('Critical','High') AND p.port = ?`,
        [selectedPort],
      )
    : await db(req).get(
        `SELECT COUNT(DISTINCT s.destination_code) AS n
         FROM shipments s JOIN facilities f ON f.code = s.destination_code
         WHERE f.type = 'HOSPITAL' AND s.risk IN ('Critical','High')`,
      );
  const telemetry = await db(req).get(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN t.temp_c >= m.min_temp AND t.temp_c <= m.max_temp THEN 1 ELSE 0 END) AS compliant
     FROM temperature_readings t JOIN shipments s ON s.id = t.shipment_id
     JOIN medicines m ON m.sku = s.product_sku`,
  );
  const routeReadiness = await db(req).get(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN c.cold_chain_certified = 1 THEN 1 ELSE 0 END) AS certified
     FROM lanes l LEFT JOIN carriers c ON c.code = l.carrier_code`,
  );
  const worst = await primaryRiskPosition(req, selectedPort);
  const plan = await latestPlan(req, selectedPort);
  const options = plan ? await planOptions(req, plan.id) : [];
  const alerts = await db(req).all('SELECT * FROM alerts ORDER BY id');

  let disruptionQuery = "SELECT * FROM disruptions WHERE status IN ('ACTIVE','MONITORING','ANALYSED')";
  const dParams = [];
  if (selectedPort) {
    disruptionQuery += " AND port = ? ORDER BY CASE status WHEN 'ACTIVE' THEN 1 WHEN 'ANALYSED' THEN 2 ELSE 3 END, created_at DESC, id LIMIT 1";
    dParams.push(selectedPort);
  } else {
    disruptionQuery += " ORDER BY CASE status WHEN 'ACTIVE' THEN 1 WHEN 'ANALYSED' THEN 2 ELSE 3 END, created_at DESC, id LIMIT 1";
  }
  let disruption = await db(req).get(disruptionQuery, dParams);
  if (!disruption && selectedPort) {
    disruption = await db(req).get("SELECT * FROM disruptions WHERE status IN ('ACTIVE','MONITORING','ANALYSED') ORDER BY created_at DESC, id LIMIT 1");
  }

  const portInfo = (portCatalogue || []).find((p) => p.code === (disruption ? disruption.port : (selectedPort || 'INMAA')));
  const eventDestination = disruption && await db(req).get(
    `SELECT f.city FROM purchase_orders p JOIN shipments s ON s.po_ebeln=p.ebeln
     JOIN facilities f ON f.code=s.origin_code
     WHERE p.port=? ORDER BY p.ebeln LIMIT 1`, [disruption.port],
  );
  const cityCodeMap = {
    INHYD: 'Hyderabad', INDEL: 'Delhi NCR', INPUN: 'Pune',
    INBOM: 'Mumbai', INKOL: 'Kolkata', INMAA: 'Chennai', INVIZ: 'Visakhapatnam',
    INBLR: 'Bengaluru',
  };
  const eventCity = (portInfo && portInfo.city) || (disruption && cityCodeMap[disruption.port]) || cityCodeMap[selectedPort] || (eventDestination ? eventDestination.city : 'Chennai');

  const facilities = await db(req).all('SELECT code,name,city,type,priority FROM facilities');
  const lanes = await db(req).all(
    `SELECT l.id,l.mode,l.distance_km,l.origin_code,l.destination_code,
       o.city AS origin_city,d.city AS destination_city,c.name AS carrier
     FROM lanes l JOIN facilities o ON o.code=l.origin_code
     JOIN facilities d ON d.code=l.destination_code
     LEFT JOIN carriers c ON c.code=l.carrier_code`,
  );

  const alternativeOriginCodes = new Set(options.filter((o) => o.source_code).map((o) => o.source_code));
  const destinationCode = worst ? worst.facility_code : null;

  const markedLanes = lanes.map((l) => {
    const isDis = Boolean(
      disruption && (
        l.origin_code === `PORT-${disruption.port.replace(/^IN/, '')}` ||
        l.origin_code === disruption.port ||
        (disruption.port === 'INPUN' && l.origin_code === 'WH-MUM' && l.destination_code === 'HOS-PUN') ||
        (disruption.port === 'INHYD' && l.origin_code === 'WH-MUM' && l.destination_code === 'WH-HYD') ||
        (disruption.port === 'INDEL' && l.origin_code === 'WH-MUM' && l.destination_code === 'HOS-DEL') ||
        (disruption.port === 'INBLR' && l.origin_code === 'WH-BLR' && l.destination_code === 'HOS-APO')
      ),
    );
    return {
      ...l,
      isAlternative: Boolean(destinationCode && l.destination_code === destinationCode && alternativeOriginCodes.has(l.origin_code)),
      isDisrupted: isDis,
    };
  });

  const inRangePct = telemetry.total ? Math.round((Number(telemetry.compliant || 0) / telemetry.total) * 1000) / 10 : 0;
  const certifiedPct = routeReadiness.total
    ? Math.round((Number(routeReadiness.certified || 0) / routeReadiness.total) * 100) : 0;
  const activeCount = Number(activeDisruptions.n);
  const disruptedCount = shipments.filter((s) => s.status === 'Disrupted').length;
  const atRiskCount = shipments.filter((s) => ['Critical', 'High'].includes(s.risk)).length;
  const totalTransit = shipments.filter((s) => s.status !== 'Delivered').length;

  const rejectedByRules = options.filter((o) => !o.compliant).length;
  const agents = AGENT_RIBBON.map((a, i) => ({
    ...a,
    status: !plan ? 'Awaiting analysis' : [
      'Disruption detected',
      `${shipments.length} database shipments available`,
      `${options.length} recovery options generated`,
      'Alternative route identified',
      `${rejectedByRules} option rejected`,
    ][i],
    warning: i === 4 && rejectedByRules > 0,
  }));

  res.json({
    demo: true,
    selectedPort: selectedPort || (disruption ? disruption.port : 'INMAA'),
    kpis: [
      { label: 'Active Disruptions', value: String(activeCount).padStart(2, '0'), trend: 'DATABASE', detail: 'active event records', icon: 'alert', tone: 'critical' },
      { label: 'At-Risk Shipments', value: String(atRiskCount), trend: 'DATABASE', detail: `${totalTransit} non-delivered records`, icon: 'truck', tone: 'warning' },
      { label: 'Hospitals at Risk', value: String(hospitalsAtRisk.n).padStart(2, '0'), trend: 'DATABASE', detail: 'distinct hospital destinations', icon: 'hospital', tone: 'purple' },
      worst && { label: 'Critical Medicine Stock', value: String(worst.cover_days), trend: 'DAYS', detail: `${worst.medicine.replace('Human ', '')} / ${worst.facility_name.replace(' Hospital', '')}`, icon: 'medicine', tone: 'teal' },
    ].filter(Boolean),
    health: {
      score: inRangePct,
      status: 'Telemetry within storage bands',
      delta: `${telemetry.compliant || 0} of ${telemetry.total} readings in range`,
      signals: [
        { label: 'Supply continuity', value: `${totalTransit ? Math.round(((totalTransit - disruptedCount) / totalTransit) * 100) : 0}%`, tone: 'cyan' },
        { label: 'Cold-chain integrity', value: `${inRangePct}%`, tone: 'teal' },
        { label: 'Certified lane coverage', value: `${certifiedPct}%`, tone: 'amber' },
      ],
    },
    alerts: alerts.map((a) => [a.severity, a.location, a.medicine, a.message, a.ago]),
    agents,
    runId: plan ? plan.run_id : null,
    planId: plan ? plan.id : null,
    disruptionId: disruption ? disruption.id : null,
    mapEvent: {
      title: disruption ? disruption.title : 'No active disruption',
      port: disruption ? disruption.port : (selectedPort || 'INMAA'),
      city: eventCity,
      lat: portInfo ? portInfo.lat : 13.0827,
      lng: portInfo ? portInfo.lng : 80.2707,
      radiusKm: disruption && disruption.radius_km,
      meta: disruption ? `${eventCity} · ${disruption.severity.toLowerCase()}${disruption.verified ? ' · verified source' : ' · simulated / unverified'}` : 'No active event records',
    },
    network: { facilities, lanes: markedLanes },
    insight: plan && options.length
      ? `${(options.find((o) => o.recommended) || options[0]).title} is based on the latest persisted recovery plan.`
      : 'Run the AI impact assessment to generate recovery intelligence.',
  });
}));

router.get('/network', asyncH(async (req, res) => {
  const facilities = await db(req).all(
    `SELECT f.*,
       (SELECT COUNT(*) FROM inventory i WHERE i.facility_code=f.code) AS inventory_positions,
       (SELECT COALESCE(SUM(i.qty_on_hand-i.reserved_qty),0) FROM inventory i WHERE i.facility_code=f.code) AS available_units
     FROM facilities f ORDER BY f.city,f.name`,
  );
  const medicines = await db(req).all('SELECT * FROM medicines ORDER BY name');
  const suppliers = await db(req).all(
    `SELECT supplier_name AS name, COUNT(*) AS purchase_orders
     FROM purchase_orders WHERE supplier_name IS NOT NULL AND supplier_name <> ''
     GROUP BY supplier_name ORDER BY supplier_name`,
  );
  const inventory = await db(req).all(
    `SELECT i.*,i.qty_on_hand-i.reserved_qty AS available,
       f.name AS facility_name,f.city,m.name AS medicine,m.unit
     FROM inventory i JOIN facilities f ON f.code=i.facility_code
     JOIN medicines m ON m.sku=i.product_sku ORDER BY f.city,f.name,m.name`,
  );
  const purchaseOrders = await db(req).all(
    `SELECT p.*,m.name AS medicine,f.name AS destination_name,f.city
     FROM purchase_orders p JOIN medicines m ON m.sku=p.product_sku
     JOIN facilities f ON f.code=p.destination_code ORDER BY p.eta,p.ebeln`,
  );
  const shipments = await db(req).all(
    `SELECT s.*,m.name AS medicine FROM shipments s
     JOIN medicines m ON m.sku=s.product_sku ORDER BY s.id`,
  );
  const temperatureReadings = await db(req).all(
    `SELECT t.*,m.name AS medicine,m.min_temp,m.max_temp
     FROM temperature_readings t JOIN shipments s ON s.id=t.shipment_id
     JOIN medicines m ON m.sku=s.product_sku ORDER BY t.ts,t.id`,
  );
  const shipmentTracking = await db(req).all('SELECT * FROM shipment_tracking ORDER BY ts,tracking_id');
  const disruptions = await db(req).all('SELECT * FROM disruptions ORDER BY created_at DESC,id');
  res.json({
    demo: true,
    dataSource: 'Database records; synthetic and simulated records are not live operational data.',
    facilities, medicines, suppliers, inventory, purchaseOrders, shipments,
    temperatureReadings, shipmentTracking, disruptions,
  });
}));

// ---------------------------------------------------------------------------
// 2. Disruptions
// ---------------------------------------------------------------------------
router.get('/disruptions', asyncH(async (req, res) => {
  const disruptions = await db(req).all(
    `SELECT d.*,
       (SELECT COUNT(DISTINCT p.ebeln) FROM purchase_orders p WHERE p.port=d.port AND p.status='IN_TRANSIT') AS affected_pos,
       (SELECT COUNT(DISTINCT s.id) FROM shipments s JOIN purchase_orders p ON p.ebeln=s.po_ebeln
        WHERE p.port=d.port AND p.status='IN_TRANSIT') AS affected_shipments
     FROM disruptions d ORDER BY d.created_at DESC,d.id`,
  );
  res.json({ demo: true, disruptions });
}));

router.get('/disruptions/:id', asyncH(async (req, res) => {
  const d = await db(req).get(
    `SELECT d.*,
       (SELECT COUNT(DISTINCT p.ebeln) FROM purchase_orders p WHERE p.port=d.port AND p.status='IN_TRANSIT') AS affected_pos,
       (SELECT COUNT(DISTINCT s.id) FROM shipments s JOIN purchase_orders p ON p.ebeln=s.po_ebeln
        WHERE p.port=d.port AND p.status='IN_TRANSIT') AS affected_shipments
     FROM disruptions d WHERE d.id=?`, [req.params.id],
  );
  if (!d) return res.status(404).json({ error: 'Disruption not found' });
  const timeline = await db(req).all('SELECT ts,title,text,state FROM disruption_timeline WHERE disruption_id = ?', [d.id]);
  const infrastructure = await db(req).all('SELECT label,status,tone,icon FROM infrastructure_status WHERE disruption_id = ?', [d.id]);
  const sensing = await sensingAgent.run(db(req), d);
  const impact = sensing.errors.length ? null : await impactAgent.run(db(req), d, sensing);
  const affectedShipments = await db(req).all(
    `SELECT s.id,s.origin_label,s.destination_label,s.status,s.risk,s.eta_text,m.name AS medicine
     FROM shipments s JOIN medicines m ON m.sku=s.product_sku
     JOIN purchase_orders p ON p.ebeln=s.po_ebeln
     WHERE p.port=? AND p.status='IN_TRANSIT' ORDER BY s.id`,
    [d.port],
  );
  res.json({
    demo: true, disruption: d, timeline, infrastructure,
    impact: impact ? impact.primary : null,
    affectedShipments,
  });
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
  const port = req.query.port;
  const shipments = await db(req).all(
    `SELECT s.*, m.name AS medicine FROM shipments s
     JOIN medicines m ON m.sku = s.product_sku
     ${port ? 'JOIN purchase_orders p ON p.ebeln=s.po_ebeln WHERE p.port=?' : ''}
     ORDER BY s.id`,
    port ? [port] : [],
  );
  const telemetry = await db(req).get(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN t.temp_c BETWEEN m.min_temp AND m.max_temp THEN 1 ELSE 0 END) AS compliant
     FROM temperature_readings t JOIN shipments s ON s.id=t.shipment_id
     JOIN medicines m ON m.sku=s.product_sku
     ${port ? 'JOIN purchase_orders p ON p.ebeln=s.po_ebeln WHERE p.port=?' : ''}`,
    port ? [port] : [],
  );
  const inRangePct = telemetry.total
    ? Math.round((Number(telemetry.compliant || 0) / telemetry.total) * 1000) / 10 : 0;
  const inTransit = shipments.filter((s) => s.status !== 'Delivered').length;
  const atRisk = shipments.filter((s) => ['Critical', 'High'].includes(s.risk)).length;
  const routeExceptions = shipments.filter((s) => s.status === 'Disrupted').length;
  res.json({
    demo: true,
    kpis: [
      { value: String(inTransit), label: 'In transit', icon: 'truck' },
      { value: String(atRisk), label: 'At risk', icon: 'alert' },
      { value: String(routeExceptions).padStart(2, '0'), label: 'Route exceptions', icon: 'route' },
      { value: `${inRangePct}%`, label: 'Temperature compliant', icon: 'temperature' },
    ],
    totalInTransit: inTransit,
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
  const linkedDisruption = s.po_ebeln && await db(req).get(
    `SELECT d.id,d.title,d.status FROM disruptions d JOIN purchase_orders p ON p.port=d.port
     WHERE p.ebeln=? ORDER BY d.created_at DESC,d.id LIMIT 1`, [s.po_ebeln],
  );
  const relatedPlan = linkedDisruption && await db(req).get(
    'SELECT id,status FROM recovery_plans WHERE disruption_id=? ORDER BY created_at DESC LIMIT 1',
    [linkedDisruption.id],
  );
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
    recoveryNote: linkedDisruption
      ? `${linkedDisruption.title} (${linkedDisruption.status}); recovery plan ${relatedPlan ? `${relatedPlan.id} is ${relatedPlan.status}` : 'has not been generated'}.`
      : 'No disruption record is currently linked to this shipment purchase order.',
  });
}));

// ---------------------------------------------------------------------------
// 4. Inventory & stock risk
// ---------------------------------------------------------------------------
router.get('/inventory', asyncH(async (req, res) => {
  const port = req.query.port;
  const worst = await primaryRiskPosition(req, port);
  const plan = await latestPlan(req, port);
  const disruption = plan && await db(req).get('SELECT * FROM disruptions WHERE id=?', [plan.disruption_id]);
  const delayHours = disruption ? Number(disruption.expected_delay_hours || 0) : 0;
  const computedTransferQty = rules.transferQuantity(
    worst.available, worst.daily_usage, delayHours, worst.case_size,
  );
  const options = plan ? await planOptions(req, plan.id) : [];
  const recommended = options.find((option) => option.recommended);
  const transferQty = recommended && recommended.code === 'STOCK_TRANSFER'
    ? Number(recommended.qty) : computedTransferQty;
  const donor = recommended && recommended.source_code
    ? await db(req).get('SELECT name FROM facilities WHERE code=?', [recommended.source_code]) : null;
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
      priority: worst.priority,
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
      donorFacility: donor ? donor.name : 'No donor recommended',
      restoredCoverDays: restoredDays,
      thresholdHours: policy.STOCK_COVER_THRESHOLD_HOURS,
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
  const sensing = disruption ? await sensingAgent.run(db(req), disruption) : null;
  const impact = disruption && sensing ? await impactAgent.run(db(req), disruption, sensing) : null;
  const linkedShipments = await db(req).get(
    `SELECT COUNT(DISTINCT s.id) AS n FROM shipments s
     JOIN purchase_orders p ON p.ebeln=s.po_ebeln
     WHERE p.port=? AND p.status='IN_TRANSIT'`, [disruption ? disruption.port : 'INMAA'],
  );
  const rejectedByRules = options.filter((o) => !o.compliant).length;
  const ribbon = AGENT_RIBBON.map((a, i) => ({
    ...a,
    status: [
      'Disruption detected',
      `${linkedShipments ? linkedShipments.n : 0} linked shipments assessed`,
      `${options.length} recovery options generated`,
      'Alternative route identified',
      `${rejectedByRules} option rejected`,
    ][i],
    warning: i === 4 && rejectedByRules > 0,
  }));
  const recommended = options.find((o) => o.recommended) || null;
  return { plan, options, recommended, disruption, impact: impact ? impact.primary : null, ribbon };
}

router.get('/recovery-plans/current', asyncH(async (req, res) => {
  const port = req.query.port;
  const disruptionId = req.query.disruptionId;
  let plan;
  if (disruptionId) {
    const portFilter = port ? 'AND d.port = ?' : '';
    plan = await db(req).get(
      `SELECT rp.* FROM recovery_plans rp
       JOIN disruptions d ON d.id = rp.disruption_id
       WHERE rp.disruption_id = ? ${portFilter}
       ORDER BY rp.created_at DESC, rp.id DESC LIMIT 1`,
      port ? [disruptionId, port] : [disruptionId],
    );
  } else if (port) {
    plan = await db(req).get(
      `SELECT rp.* FROM recovery_plans rp
       JOIN disruptions d ON d.id = rp.disruption_id
       WHERE d.port = ?
       ORDER BY rp.created_at DESC, rp.id DESC LIMIT 1`,
      [port],
    );
  } else {
    plan = await latestPlan(req);
  }
  if (!plan) plan = await latestPlan(req);
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
  const port = req.query.port;
  const disruptionId = req.query.disruptionId;
  const plan = typeof disruptionId === 'string'
    ? await db(req).get(
      `SELECT rp.* FROM recovery_plans rp
       JOIN disruptions d ON d.id = rp.disruption_id
       WHERE rp.disruption_id = ? ${port ? 'AND d.port = ?' : ''}
       ORDER BY rp.created_at DESC, rp.id DESC LIMIT 1`,
      port ? [disruptionId, port] : [disruptionId],
    )
    : await latestPlan(req, port);
  const planDisruption = plan
    ? await db(req).get('SELECT * FROM disruptions WHERE id = ?', [plan.disruption_id])
    : null;
  const planSensing = planDisruption ? await sensingAgent.run(db(req), planDisruption) : null;
  const planImpact = planDisruption && planSensing
    ? await impactAgent.run(db(req), planDisruption, planSensing)
    : null;
  const worst = (planImpact && planImpact.primary) || await primaryRiskPosition(req, port);
  const sku = (worst && worst.product_sku) || 'MED-INSULIN';
  const med = (await db(req).get("SELECT * FROM medicines WHERE sku = ?", [sku])) ||
              (await db(req).get("SELECT * FROM medicines WHERE sku = 'MED-INSULIN'"));
  const readings = await db(req).all(
    "SELECT ts,temp_c FROM temperature_readings WHERE batch = ? ORDER BY id", [med.batch],
  );
  const temps = readings.length > 0 ? readings.map((r) => r.temp_c) : [4.2, 4.4, 4.3, 4.5, 4.2];
  const band = rules.checkTemperatureBand(temps, med.min_temp, med.max_temp);
  const telemetry = await db(req).get(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN t.temp_c BETWEEN m.min_temp AND m.max_temp THEN 1 ELSE 0 END) AS compliant
     FROM temperature_readings t JOIN shipments s ON s.id=t.shipment_id
     JOIN medicines m ON m.sku=s.product_sku`,
  );
  const networkCompliance = telemetry.total
    ? Math.round((Number(telemetry.compliant || 0) / telemetry.total) * 1000) / 10 : 0;
  const batchCheck = rules.checkBatchValidity(med);

  const options = plan ? await planOptions(req, plan.id) : [];
  const validations = await Promise.all(options
    .filter((o) => o.code !== 'WAIT')
    .map(async (o) => {
      const compliant = o.checks.length > 0 && o.checks.every((check) => Boolean(check.pass));
      const failedCheck = o.checks.find((check) => !check.pass);
      const donor = o.source_code
        ? await db(req).get('SELECT name FROM facilities WHERE code = ?', [o.source_code])
        : null;
      return {
        id: o.id,
        code: o.code,
        title: o.title || (o.code === 'AIR_REROUTE' ? 'Air rerouting' : 'Stock transfer'),
        medicine: med.name,
        donorWarehouse: donor ? donor.name : o.source_code || 'Unavailable',
        qty: Number(o.qty),
        unit: med.unit,
        etaHours: Number(o.eta_hours),
        costUsd: Number(o.cost_usd),
        status: compliant ? 'PASSED' : 'FAILED',
        tone: compliant ? 'passed' : 'failed',
        recommendationStatus: o.recommended ? 'RECOMMENDED' : !o.eligible ? 'REJECTED' : 'HIGH RISK',
        recommendationTone: o.recommended ? 'recommended' : !o.eligible ? 'rejected' : 'high-risk',
        checks: o.checks.map((check) => ({
          label: check.label,
          pass: Boolean(check.pass),
          note: check.note || '',
        })),
        reason: compliant ? 'All configured requirements verified.' : failedCheck?.note || 'Validation failed.',
      };
    }));

  res.json({
    demo: true,
    plan: plan ? {
      id: plan.id,
      disruptionId: plan.disruption_id,
      recommendedOptionId: plan.recommended_option_id,
    } : null,
    networkCompliance,
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
  const port = req.query.port;
  const disruptionId = req.query.disruptionId;
  const hasDisruptionSelection = Object.prototype.hasOwnProperty.call(req.query, 'disruptionId');
  const plan = hasDisruptionSelection
    ? typeof disruptionId === 'string' && disruptionId
      ? await db(req).get(
      `SELECT rp.* FROM recovery_plans rp
       JOIN disruptions d ON d.id = rp.disruption_id
       WHERE rp.disruption_id = ? ${port ? 'AND d.port = ?' : ''}
       ORDER BY rp.created_at DESC, rp.id DESC LIMIT 1`,
      port ? [disruptionId, port] : [disruptionId],
    )
      : null
    : await latestPlan(req, port);
  const integrity = await verifyChain(db(req));
  if (!plan) return res.json({
    demo: true, disruptionId: disruptionId || null, plan: null,
    agentHistory: [], humanReview: [], events: [], integrity,
  });
  const options = await planOptions(req, plan.id);
  const recommended = options.find((o) => o.recommended) || options[0];
  const agentActors = [
    'SensingAgent', 'ImpactAgent', 'ScenarioAgent', 'LogisticsAgent', 'ComplianceAgent',
  ];
  const runRows = await db(req).all(
    'SELECT * FROM audit_log WHERE run_id = ? ORDER BY seq',
    [plan.run_id],
  );
  const rows = runRows.filter((row) => agentActors.includes(row.actor));
  const agentLabels = {
    SensingAgent: { name: 'Sensing Agent', action: 'Disruption severity and expected delay assessed.' },
    ImpactAgent: { name: 'Impact Agent', action: 'Linked demand, inventory and shipment impact assessed.' },
    ScenarioAgent: { name: 'Scenario Agent', action: 'Recovery alternatives generated from available routes and stock.' },
    LogisticsAgent: { name: 'Logistics Agent', action: 'Transportation options, delivery times and costs evaluated.' },
    ComplianceAgent: { name: 'Compliance Agent', action: 'Mandatory pharmaceutical and logistics controls evaluated.' },
  };
  const agentHistory = rows.map((row) => {
    let payload = {};
    try { payload = JSON.parse(row.payload || '{}'); } catch { payload = {}; }
    let result = 'Analysis completed; outcome recorded for this recovery plan.';
    if (row.actor === 'SensingAgent') {
      result = `${payload.severity || 'Unknown'} severity · ${payload.delay_hours ?? 'Unavailable'}h expected delay`;
    } else if (row.actor === 'ImpactAgent') {
      result = `${payload.feed_shipments ?? 0} linked shipments and ${payload.feed_pos ?? 0} purchase orders assessed`;
    } else if (row.actor === 'ScenarioAgent') {
      const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
      result = `${candidates.length} recovery alternatives generated`;
    } else if (row.actor === 'LogisticsAgent') {
      const evaluated = Array.isArray(payload) ? payload : [];
      result = `${evaluated.filter((option) => option.feasible).length} of ${evaluated.length} routes feasible`;
    } else if (row.actor === 'ComplianceAgent') {
      const checked = Array.isArray(payload) ? payload : [];
      result = `${checked.filter((option) => option.eligible).length} of ${checked.length} options passed all controls`;
    }
    return {
      id: `${plan.id}:${row.actor}:${row.seq}`,
      name: agentLabels[row.actor].name,
      timestamp: row.ts,
      action: agentLabels[row.actor].action,
      result,
      status: 'COMPLETED',
    };
  });
  const approvals = await db(req).all(
    'SELECT id,decision,actor,comment,created_at FROM approvals WHERE plan_id = ? ORDER BY created_at,id',
    [plan.id],
  );
  const humanReview = approvals.length
    ? approvals.map((review) => ({
      id: review.id,
      planId: plan.id,
      reviewer: review.actor,
      timestamp: review.created_at,
      decision: review.decision,
      comment: review.comment || '',
    }))
    : plan.status === 'PENDING_APPROVAL'
      ? [{
        id: `${plan.id}:pending-review`,
        planId: plan.id,
        reviewer: null,
        timestamp: null,
        decision: 'PENDING',
        comment: '',
      }]
      : [];
  const events = runRows.map((row) => {
    const display = STEP_DISPLAY[row.step] || { title: row.step, icon: 'document', state: 'complete' };
    return {
      time: timeOf(row.ts),
      title: display.title,
      actor: row.actor,
      text: auditText(row),
      icon: display.icon,
      state: display.state,
      hash: row.hash.slice(0, 12),
    };
  });

  const worst = await primaryRiskPosition(req, port);
  const destCode = (worst && worst.facility_code) || 'HOS-STM';
  const dest = await db(req).get("SELECT * FROM facilities WHERE code = ?", [destCode]);
  const source = recommended && recommended.source_code
    ? await db(req).get('SELECT * FROM facilities WHERE code = ?', [recommended.source_code]) : null;
  const carrier = recommended && recommended.carrier_code
    ? await db(req).get('SELECT * FROM carriers WHERE code = ?', [recommended.carrier_code]) : null;
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
      destination: dest ? dest.name : 'St. Martha Hospital',
      planner: plan.decided_by || null,
      decidedAt: plan.decided_at || null,
    },
    disruptionId: plan.disruption_id,
    agentHistory,
    humanReview,
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
