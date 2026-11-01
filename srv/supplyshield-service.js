const crypto = require('node:crypto');
const cds = require('@sap/cds');
const rules = require('../server/src/rules/rules');
const config = require('../server/src/config');
const { explainerStatus } = require('../server/src/llm/explainer');
const s4hana = require('../server/src/integrations/s4hana');
const weather = require('../server/src/integrations/weather');
const approval = require('../server/src/services/approval');
const { runPipeline } = require('../server/src/agents/orchestrator');
const { verifyChain } = require('../server/src/utils/audit');

const { SELECT } = cds.ql;

const AGENT_RIBBON = [
  { name: 'Sensing Agent', icon: 'radar' },
  { name: 'Impact Agent', icon: 'alert' },
  { name: 'Scenario Agent', icon: 'brain' },
  { name: 'Logistics Agent', icon: 'route' },
  { name: 'Compliance Agent', icon: 'shield' },
];

function pipelineDatabase(tx) {
  const adapter = {
    all: (sql, params = []) => tx.run(sql, params),
    get: async (sql, params = []) => {
      const result = await tx.run(sql, params);
      return result[0];
    },
    run: (sql, params = []) => tx.run(sql, params),
    withTransaction: (callback) => callback(adapter),
  };
  return adapter;
}

async function rows(tx, entity) {
  return tx.run(SELECT.from(entity));
}

async function latestPlan(tx) {
  const result = await tx.run(
    SELECT.from('recovery_plans').orderBy('created_at desc', 'id desc').limit(1),
  );
  return result[0] || null;
}

async function optionsForPlan(tx, planId) {
  const result = await tx.run(
    SELECT.from('recovery_options').where({ plan_id: planId }).orderBy('id'),
  );
  return result.map((option) => ({
    ...option,
    checks: JSON.parse(option.checks_json || '[]'),
    scores: JSON.parse(option.scores_json || '{}'),
  }));
}

async function planPayload(tx, plan) {
  const [options, disruption] = await Promise.all([
    optionsForPlan(tx, plan.id),
    tx.run('SELECT * FROM disruptions WHERE id = ?', [plan.disruption_id])
      .then((result) => result[0]),
  ]);
  const rejectedByRules = options.filter((option) => !option.compliant).length;
  const ribbon = AGENT_RIBBON.map((agent, index) => ({
    ...agent,
    status: [
      'Disruption detected',
      `${disruption.affected_shipments} shipments assessed`,
      `${options.length} recovery options generated`,
      'Alternative route identified',
      `${rejectedByRules} option rejected`,
    ][index],
    warning: index === 4 && rejectedByRules > 0,
  }));
  const recommended = options.find((option) => option.recommended) || null;
  return { plan, options, recommended, disruption, ribbon };
}

function stepDisplay(step) {
  const display = {
    'Disruption detected, validated and classified': ['Disruption detected', 'radar', 'complete'],
    'Network impact mapped': ['Network impact mapped', 'alert', 'complete'],
    'Recovery scenarios generated': ['Recovery scenarios generated', 'brain', 'complete'],
    'Routes evaluated, options costed': ['Logistics optimized', 'route', 'complete'],
    'Hard cold-chain and safety rules applied': ['Compliance validated', 'shield', 'complete'],
    'Planner briefing generated': ['Planner briefing generated', 'spark', 'complete'],
    'Recovery plan routed for human approval': ['Human review requested', 'user', 'complete'],
    'Recovery plan APPROVED by human planner': ['Recovery plan approved', 'check', 'approved'],
    'Recovery plan REJECTED by human planner': ['Recovery plan rejected', 'close', 'critical'],
    'Approval BLOCKED by compliance revalidation': ['Approval blocked by compliance', 'shield', 'critical'],
  }[step];
  return display
    ? { title: display[0], icon: display[1], state: display[2] }
    : { title: step, icon: 'document', state: 'complete' };
}

function auditText(row) {
  let payload = {};
  try { payload = JSON.parse(row.payload || '{}'); } catch (error) { /* retain an empty display payload */ }
  switch (row.step) {
    case 'Disruption detected, validated and classified':
      return `${payload.type} matched to port ${payload.port} geofence. Severity classified ${payload.severity}${payload.verified ? ' (verified operational source)' : ' (UNVERIFIED alert)'}.`;
    case 'Network impact mapped':
      return `${payload.feed_shipments} shipments, ${payload.feed_pos} purchase orders and ${payload.hospitals_assessed} hospital inventory positions assessed.`;
    case 'Recovery scenarios generated': {
      const candidates = payload.candidates || [];
      const extra = (payload.discarded || []).length
        ? ` ${(payload.discarded || []).map((item) => `${item.title} discarded (${item.reason})`).join(' ')}`
        : '';
      return `${candidates.length} recovery options generated: ${candidates.join(', ')}.${extra}`;
    }
    case 'Routes evaluated, options costed': {
      const best = (payload || []).filter((option) => option.feasible)
        .sort((left, right) => left.cost_usd - right.cost_usd)[0];
      if (!best) return 'No feasible route found.';
      const quantity = best.option.match(/\d+/);
      return `Transfer quantity ${quantity ? quantity[0] : ''} evaluated; best feasible route ${best.carrier} at USD ${best.cost_usd}, arrival in ${best.eta_hours} hours.`;
    }
    case 'Hard cold-chain and safety rules applied': {
      const passed = (payload || []).filter((option) => option.eligible).length;
      const rejected = (payload || []).filter((option) => !option.compliant).length;
      return `${passed} option(s) passed all controls. ${rejected} option(s) rejected by hard rules.`;
    }
    case 'Planner briefing generated':
      return `Briefing source: ${payload.source}`;
    case 'Recovery plan routed for human approval':
      return `Recovery plan ${payload.plan} routed to an authorized planner.`;
    case 'Recovery plan APPROVED by human planner':
      return `Planner approved "${payload.option}". Execution recorded as SIMULATED.${payload.comment ? ` Comment: ${payload.comment}` : ''}`;
    case 'Recovery plan REJECTED by human planner':
      return `Planner rejected "${payload.option}". Returned for replanning.${payload.comment ? ` Comment: ${payload.comment}` : ''}`;
    case 'Approval BLOCKED by compliance revalidation':
      return `Approval of "${payload.option}" blocked server-side: ${(payload.reasons || []).join('; ')}`;
    default:
      return row.step;
  }
}

function timeOf(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toTimeString().slice(0, 8);
}

async function primaryRiskPosition(tx) {
  const [inventory, facilities, medicines] = await Promise.all([
    rows(tx, 'inventory'),
    rows(tx, 'facilities'),
    rows(tx, 'medicines'),
  ]);
  const facilityByCode = Object.fromEntries(facilities.map((facility) => [facility.code, facility]));
  const medicineBySku = Object.fromEntries(medicines.map((medicine) => [medicine.sku, medicine]));

  let worst = null;
  for (const position of inventory) {
    const facility = facilityByCode[position.facility_code];
    if (!facility || facility.type !== 'HOSPITAL' || position.daily_usage <= 0) continue;

    const medicine = medicineBySku[position.product_sku];
    if (!medicine) continue;
    const available = position.qty_on_hand - position.reserved_qty;
    const coverHours = rules.stockCoverHours(available, position.daily_usage);
    if (!worst || coverHours < worst.cover_hours) {
      worst = {
        ...position,
        facility_name: facility.name,
        priority: facility.priority,
        medicine: medicine.name,
        unit: medicine.unit,
        case_size: medicine.case_size,
        batch: medicine.batch,
        available,
        cover_hours: coverHours,
        cover_days: rules.r1(coverHours / 24),
      };
    }
  }
  return worst;
}

async function overview(req) {
  const tx = cds.tx(req);
  const [statsRows, disruptions, worst, plan, alerts] = await Promise.all([
    rows(tx, 'network_stats'),
    rows(tx, 'disruptions'),
    primaryRiskPosition(tx),
    latestPlan(tx),
    rows(tx, 'alerts'),
  ]);
  const stats = Object.fromEntries(statsRows.map((row) => [row.metric, row]));
  const activeDisruptions = disruptions.filter(
    (disruption) => ['ACTIVE', 'MONITORING', 'ANALYSED'].includes(disruption.status),
  ).length;
  const options = plan ? await optionsForPlan(tx, plan.id) : [];
  const disruption = disruptions.find((item) => item.id === 'INC-2026-1104-03');
  const rejectedByRules = options.filter((option) => !option.compliant).length;
  const agentStatuses = [
    'Disruption detected',
    `${disruption.affected_shipments} shipments assessed`,
    `${options.length} recovery options generated`,
    'Alternative route identified',
    `${rejectedByRules} option rejected`,
  ];
  const agents = AGENT_RIBBON.map((agent, index) => ({
    ...agent,
    status: !plan ? 'Awaiting analysis' : agentStatuses[index],
    warning: index === 4 && rejectedByRules > 0,
  }));

  return {
    demo: true,
    kpis: [
      {
        label: 'Active Disruptions',
        value: String(activeDisruptions).padStart(2, '0'),
        trend: `+${stats.active_disruptions_delta.value}`,
        detail: stats.active_disruptions_delta.detail,
        icon: 'alert',
        tone: 'critical',
      },
      {
        label: 'At-Risk Shipments',
        value: String(stats.shipments_at_risk.value),
        trend: '9.7%',
        detail: 'of in-transit',
        icon: 'truck',
        tone: 'warning',
      },
      {
        label: 'Hospitals at Risk',
        value: String(stats.hospitals_at_risk.value).padStart(2, '0'),
        trend: '+1',
        detail: 'since 17:00',
        icon: 'hospital',
        tone: 'purple',
      },
      worst && {
        label: 'Critical Medicine Stock',
        value: String(worst.cover_days),
        trend: 'DAYS',
        detail: `${worst.medicine.replace('Human ', '')} / ${worst.facility_name.replace(' Hospital', '')}`,
        icon: 'medicine',
        tone: 'teal',
      },
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
    alerts: alerts
      .sort((left, right) => left.id - right.id)
      .map((alert) => [alert.severity, alert.location, alert.medicine, alert.message, alert.ago]),
    agents,
    runId: plan ? plan.run_id : null,
    mapEvent: {
      title: 'Cyclone Varun · Chennai Port',
      meta: `Radius ${disruption.radius_km} km · severity ${disruption.severity.toLowerCase()}`,
    },
    insight: plan && options.length
      ? 'Bengaluru inventory transfer can prevent the earliest insulin stockout with verified cold-chain capability.'
      : 'Run the AI impact assessment to generate recovery intelligence.',
  };
}

function databaseInfo() {
  const engine = cds.db ? cds.db.kind : 'none';
  return {
    engine,
    fallbackReason: null,
    label: engine === 'hana'
      ? 'SAP HANA Cloud'
      : 'Local demo database (SQLite fallback - SAP HANA not configured)',
  };
}

async function health() {
  return {
    status: 'ok',
    time: new Date().toISOString(),
    db: databaseInfo(),
    llm: explainerStatus(),
    integrations: {
      s4hana: s4hana.status(),
      weather: {
        provider: config.weather.provider === 'off' ? 'disabled' : 'Open-Meteo (live)',
      },
    },
    demo: true,
    note: 'All records are SIMULATED demo data unless an integration reports itself live.',
  };
}

async function currentRecoveryPlan(req) {
  const tx = cds.tx(req);
  const plan = await latestPlan(tx);
  if (!plan) {
    return req.reject(404, 'No recovery plan yet - run the AI impact assessment first.');
  }

  const [options, disruptions] = await Promise.all([
    optionsForPlan(tx, plan.id),
    rows(tx, 'disruptions'),
  ]);
  const disruption = disruptions.find((item) => item.id === plan.disruption_id);
  const rejectedByRules = options.filter((option) => !option.compliant).length;
  const statuses = [
    'Disruption detected',
    `${disruption.affected_shipments} shipments assessed`,
    `${options.length} recovery options generated`,
    'Alternative route identified',
    `${rejectedByRules} option rejected`,
  ];
  const ribbon = AGENT_RIBBON.map((agent, index) => ({
    ...agent,
    status: statuses[index],
    warning: index === 4 && rejectedByRules > 0,
  }));
  const recommended = options.find((option) => option.recommended) || null;
  return { demo: true, plan, options, recommended, disruption, ribbon };
}

async function integrationsStatus() {
  return {
    db: databaseInfo(),
    llm: explainerStatus(),
    s4hana: s4hana.status(),
    weather: {
      provider: config.weather.provider === 'off'
        ? 'disabled'
        : 'Open-Meteo (live, key-free)',
    },
  };
}

async function listDisruptions(req) {
  const tx = cds.tx(req);
  return {
    demo: true,
    disruptions: await tx.run(SELECT.from('disruptions').orderBy('created_at desc')),
  };
}

async function disruptionDetails(req) {
  const tx = cds.tx(req);
  const disruption = (await tx.run(
    'SELECT * FROM disruptions WHERE id = ?', [req.data.id],
  ))[0];
  if (!disruption) return req.reject(404, 'Disruption not found');
  const [timeline, infrastructure] = await Promise.all([
    tx.run('SELECT ts,title,text,state FROM disruption_timeline WHERE disruption_id = ?', [disruption.id]),
    tx.run('SELECT label,status,tone,icon FROM infrastructure_status WHERE disruption_id = ?', [disruption.id]),
  ]);
  return { demo: true, disruption, timeline, infrastructure };
}

async function createDisruption(req) {
  const { type, location, severity, duration, description } = req.data;
  const errors = [];
  if (typeof type !== 'string' || !type.trim()) errors.push('type is required');
  if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(severity || '').toUpperCase())) {
    errors.push('severity must be one of LOW, MEDIUM, HIGH, CRITICAL');
  }
  if (typeof type === 'string' && type.length > 30) errors.push('type must be 30 characters or fewer');
  if (location != null && (typeof location !== 'string' || location.length > 60)) {
    errors.push('location must be 60 characters or fewer');
  }
  if (description != null && (typeof description !== 'string' || description.length > 473)) {
    errors.push('description must be 473 characters or fewer');
  }
  if (errors.length) return req.reject(400, errors.join('; '));

  const tx = cds.tx(req);
  const normalizedType = type.toUpperCase().replace(/\s+/g, '_');
  const severityValue = String(severity).toUpperCase();
  const id = `INC-MAN-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  const delay = Number.parseInt(duration, 10);
  await tx.run(
    `INSERT INTO disruptions (id,type,title,port,severity,description,status,radius_km,wind_kmh,expected_delay_hours,affected_shipments,affected_pos,verified,source,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, normalizedType, `${type.toUpperCase()} — ${(location || 'unspecified location').toUpperCase()}`,
      '', severityValue, `${description || ''} (MANUAL ENTRY - SIMULATED)`, 'NEW', null, null,
      Number.isFinite(delay) ? delay : null, 0, 0, 0, 'Manual planner entry', new Date().toISOString()],
  );
  req.http.res.statusCode = 201;
  return {
    demo: true,
    id,
    message: 'Disruption event created (manual, unverified). Run the AI impact assessment to evaluate it.',
  };
}

async function shipmentDetails(req) {
  const tx = cds.tx(req);
  const shipment = (await tx.run(
    `SELECT s.*, m.name AS medicine, m.min_temp, m.max_temp FROM shipments s
     JOIN medicines m ON m.sku = s.product_sku WHERE s.id = ?`,
    [req.data.id],
  ))[0];
  if (!shipment) return req.reject(404, 'Shipment not found');
  const readings = await tx.run(
    'SELECT ts,temp_c FROM temperature_readings WHERE shipment_id = ? ORDER BY id',
    [shipment.id],
  );
  const band = rules.checkTemperatureBand(
    readings.map((reading) => reading.temp_c),
    shipment.min_temp,
    shipment.max_temp,
  );
  return {
    demo: true,
    shipment: {
      id: shipment.id,
      medicine: shipment.medicine,
      batch: shipment.batch,
      origin: shipment.origin_label,
      destination: shipment.destination_label,
      route: shipment.route,
      eta: shipment.eta_text,
      temp: `${shipment.current_temp}°C`,
      status: shipment.status,
      risk: shipment.risk,
      po: shipment.po_ebeln,
      band: `+${shipment.min_temp}°C to +${shipment.max_temp}°C`,
    },
    readings: readings.map((reading) => reading.temp_c),
    tempCompliance: band,
    recoveryNote: 'This shipment is included in recovery scenario B. Transfer stock is available in Bengaluru while the original consignment remains protected at Chennai.',
  };
}

async function shipmentOverview(req) {
  const tx = cds.tx(req);
  const statsRows = await tx.run('SELECT * FROM network_stats');
  const stats = Object.fromEntries(statsRows.map((row) => [row.metric, row]));
  const shipments = await tx.run(
    `SELECT s.*, m.name AS medicine FROM shipments s
     JOIN medicines m ON m.sku = s.product_sku ORDER BY s.id`,
  );
  return {
    demo: true,
    kpis: [
      { value: String(stats.shipments_in_transit.value), label: 'In transit', icon: 'truck' },
      { value: String(stats.shipments_at_risk.value), label: 'At risk', icon: 'alert' },
      { value: String(stats.route_exceptions.value).padStart(2, '0'), label: 'Route exceptions', icon: 'route' },
      { value: `${stats.temp_compliant_pct.value}%`, label: 'Temperature compliant', icon: 'temperature' },
    ],
    totalInTransit: stats.shipments_in_transit.value,
    criticalCount: shipments.filter((shipment) => shipment.risk === 'Critical').length,
    shipments: shipments.map((shipment) => ({
      id: shipment.id,
      medicine: shipment.medicine,
      batch: shipment.batch,
      origin: shipment.origin_label,
      destination: shipment.destination_label,
      route: shipment.route,
      eta: shipment.eta_text,
      temp: `${shipment.current_temp}°C`,
      status: shipment.status,
      risk: shipment.risk,
      po: shipment.po_ebeln,
    })),
  };
}

async function inventoryOverview(req) {
  const tx = cds.tx(req);
  const worst = await primaryRiskPosition(tx);
  const disruption = (await tx.run(
    "SELECT * FROM disruptions WHERE id = 'INC-2026-1104-03'",
  ))[0];
  const delayHours = disruption.expected_delay_hours;
  const transferQty = rules.transferQuantity(
    worst.available, worst.daily_usage, delayHours, worst.case_size,
  );
  const restoredDays = rules.r1((worst.available + transferQty) / worst.daily_usage);
  const hospitals = await tx.run(
    "SELECT * FROM facilities WHERE type = 'HOSPITAL' ORDER BY priority",
  );
  const priorities = hospitals.map((hospital) => ({
    name: hospital.name.replace(' Hospital', '').replace(' Network', ''),
    ward: hospital.ward,
    priority: hospital.priority,
    tone: hospital.priority === 'P1' ? 'critical' : hospital.priority === 'P2' ? 'warning' : 'success',
  }));
  const inventory = await tx.run(
    `SELECT i.*, f.name AS facility_name, f.type AS facility_type, m.name AS medicine, m.unit
     FROM inventory i JOIN facilities f ON f.code = i.facility_code
     JOIN medicines m ON m.sku = i.product_sku`,
  );
  const demandByProduct = {};
  for (const row of inventory) {
    if (row.daily_usage > 0) {
      demandByProduct[row.product_sku] = Math.max(demandByProduct[row.product_sku] || 0, row.daily_usage);
    }
  }
  const shipments = await tx.run('SELECT * FROM shipments');
  const rows = inventory.map((row) => {
    const available = row.qty_on_hand - row.reserved_qty;
    const use = row.daily_usage > 0 ? row.daily_usage : (demandByProduct[row.product_sku] || 1);
    const coverDays = rules.r1(available / use);
    const shipment = shipments.find((item) => item.destination_code === row.facility_code);
    const replenishment = row.facility_type === 'WAREHOUSE'
      ? 'Ready'
      : shipment && shipment.delay_hours > 0
        ? `${shipment.delay_hours}h`
        : shipment ? shipment.eta_text.replace(/ .*/, '') : '—';
    let risk;
    if (row.facility_type === 'WAREHOUSE') risk = 'Available';
    else {
      const delay = shipment && shipment.delay_hours > 0 ? shipment.delay_hours : delayHours;
      const coverHours = (available / use) * 24;
      risk = coverHours < delay ? 'Critical' : coverHours < delay + 72 ? 'High' : 'Stable';
    }
    return {
      facility: row.facility_name,
      medicine: row.medicine,
      available: `${available.toLocaleString('en-US')} ${row.unit}`,
      demand: row.daily_usage > 0 ? `${row.daily_usage}/day` : '—',
      cover: `${coverDays} days`,
      replenishment,
      risk,
    };
  });
  const riskOrder = { Critical: 0, High: 1, Stable: 2, Available: 3 };
  rows.sort((left, right) => riskOrder[left.risk] - riskOrder[right.risk]);
  return {
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
  };
}

async function recoveryPlanDetails(req) {
  const tx = cds.tx(req);
  const plan = (await tx.run(
    'SELECT * FROM recovery_plans WHERE id = ?', [req.data.id],
  ))[0];
  if (!plan) return req.reject(404, 'Plan not found');
  return { demo: true, ...(await planPayload(tx, plan)) };
}

async function decide(req, decision, planId, optionId) {
  if (typeof req.data.actor !== 'undefined' && req.data.actor !== null
    && typeof req.data.actor !== 'string') {
    return req.reject(400, 'actor must be a string');
  }
  if (typeof req.data.comment !== 'undefined' && req.data.comment !== null
    && typeof req.data.comment !== 'string') {
    return req.reject(400, 'comment must be a string');
  }
  const actor = typeof req.data.actor === 'string' && req.data.actor.trim()
    ? req.data.actor.trim()
    : config.defaultPlanner;
  const comment = typeof req.data.comment === 'string' ? req.data.comment : '';
  if (actor.length > 80) return req.reject(400, 'actor must be 80 characters or fewer');
  if (comment.length > 300) return req.reject(400, 'comment must be 300 characters or fewer');

  const tx = cds.tx(req);
  const plan = (await tx.run('SELECT * FROM recovery_plans WHERE id = ?', [planId]))[0];
  if (!plan) return req.reject(404, `Recovery plan ${planId} not found`);
  const selectedOption = optionId || plan.recommended_option_id;
  if (!selectedOption) return req.reject(404, `Option not found in plan ${planId}`);
  try {
    return await approval.decide(
      pipelineDatabase(tx), planId, selectedOption, decision, actor, comment,
    );
  } catch (error) {
    if (decision === 'APPROVED' && error.status === 409 && error.reasons) {
      req.http.res.statusCode = 409;
      return { error: error.message, reasons: error.reasons };
    }
    throw error;
  }
}

async function approveRecoveryPlan(req) {
  return decide(req, 'APPROVED', req.data.planId, req.data.optionId);
}

async function rejectRecoveryPlan(req) {
  return decide(req, 'REJECTED', req.data.planId, req.data.optionId);
}

async function approveRecoveryOption(req) {
  const tx = cds.tx(req);
  const option = (await tx.run(
    'SELECT * FROM recovery_options WHERE id = ?', [req.data.optionId],
  ))[0];
  if (!option) return req.reject(404, 'Option not found');
  return decide(req, 'APPROVED', option.plan_id, option.id);
}

async function complianceOverview(req) {
  const tx = cds.tx(req);
  const statsRows = await tx.run('SELECT * FROM network_stats');
  const stats = Object.fromEntries(statsRows.map((row) => [row.metric, row]));
  const medicine = (await tx.run(
    "SELECT * FROM medicines WHERE sku = 'MED-INSULIN'",
  ))[0];
  const readings = await tx.run(
    'SELECT ts,temp_c FROM temperature_readings WHERE batch = ? ORDER BY id',
    [medicine.batch],
  );
  const temperatures = readings.map((reading) => reading.temp_c);
  const band = rules.checkTemperatureBand(temperatures, medicine.min_temp, medicine.max_temp);
  const batchCheck = rules.checkBatchValidity(medicine);
  const plan = await latestPlan(tx);
  const options = plan ? await optionsForPlan(tx, plan.id) : [];
  const validations = options
    .filter((option) => option.code !== 'WAIT')
    .map((option) => ({
      title: option.code === 'AIR_REROUTE' ? 'Air rerouting' : 'Bengaluru stock transfer',
      status: option.compliant ? 'PASSED' : 'FAILED',
      tone: option.compliant ? 'passed' : 'failed',
      checks: option.checks.map((check) => ({ label: check.label, pass: Boolean(check.pass) })),
      reason: option.compliant
        ? 'All configured requirements verified.'
        : (option.checks.find((check) => !check.pass) || {}).note || 'Validation failed.',
    }));
  return {
    demo: true,
    networkCompliance: stats.cold_chain_integrity.value,
    range: {
      min: medicine.min_temp,
      max: medicine.max_temp,
      label: `+${medicine.min_temp}°C to +${medicine.max_temp}°C`,
    },
    appliesTo: `${medicine.name} batch ${medicine.batch}`,
    checks: ['Temperature telemetry active', 'Batch within expiry', 'Approved donor warehouse'],
    telemetry: {
      batch: medicine.batch,
      readings,
      min: band.min,
      max: band.max,
      avg: band.avg,
      excursions: band.excursions,
      current: temperatures[temperatures.length - 1],
      withinRange: band.compliant,
    },
    batchRecord: {
      name: medicine.name,
      batch: medicine.batch,
      manufactured: medicine.manufactured,
      expiry: medicine.expiry,
      gdp: medicine.gdp_class,
      range: `+${medicine.min_temp}°C to +${medicine.max_temp}°C`,
      valid: batchCheck.pass,
      note: batchCheck.note,
    },
    validations,
  };
}

async function auditHistory(req) {
  const tx = cds.tx(req);
  const adapter = pipelineDatabase(tx);
  const plan = await latestPlan(tx);
  const integrity = await verifyChain(adapter);
  if (!plan) return { demo: true, plan: null, events: [], integrity };

  const options = await optionsForPlan(tx, plan.id);
  const recommended = options.find((option) => option.recommended) || options[0];
  const runRows = await tx.run(
    'SELECT * FROM audit_log WHERE run_id = ? ORDER BY seq', [plan.run_id],
  );
  const decisionRows = await tx.run(
    "SELECT * FROM audit_log WHERE step LIKE 'Recovery plan %' OR step LIKE 'Approval BLOCKED%' ORDER BY seq",
  );
  const seen = new Set();
  const allRows = [...runRows, ...decisionRows]
    .filter((row) => {
      if (seen.has(row.seq)) return false;
      seen.add(row.seq);
      return true;
    })
    .sort((left, right) => left.seq - right.seq);
  const events = allRows.map((row) => {
    const display = stepDisplay(row.step);
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
  if (plan.status === 'PENDING_APPROVAL') {
    events.push({
      time: 'PENDING',
      title: 'Awaiting authorization',
      actor: 'Human decision',
      text: 'No execution can proceed until an authorized planner decides.',
      icon: 'clock',
      state: 'active',
      hash: null,
    });
  }

  const source = recommended && recommended.source_code
    ? (await tx.run('SELECT * FROM facilities WHERE code = ?', [recommended.source_code]))[0]
    : null;
  const carrier = recommended && recommended.carrier_code
    ? (await tx.run('SELECT * FROM carriers WHERE code = ?', [recommended.carrier_code]))[0]
    : null;
  const destination = (await tx.run(
    "SELECT * FROM facilities WHERE code = 'HOS-STM'",
  ))[0];
  const decidedAt = plan.decided_at ? new Date(plan.decided_at) : null;
  const arrival = decidedAt && recommended
    ? new Date(decidedAt.getTime() + recommended.eta_hours * 3600 * 1000)
    : null;
  const approvalRow = (await tx.run(
    'SELECT * FROM approvals WHERE plan_id = ? ORDER BY created_at DESC LIMIT 1', [plan.id],
  ))[0];
  return {
    demo: true,
    plan: {
      id: plan.id,
      status: plan.status,
      correlationId: plan.correlation_id,
      recommendedTitle: recommended ? recommended.title : null,
      qty: recommended ? recommended.qty : 0,
      destination: 'St. Martha Hospital',
      planner: plan.decided_by || null,
      decidedAt: plan.decided_at || null,
    },
    events,
    execution: {
      transferReference: approvalRow && plan.status === 'APPROVED'
        ? (approvalRow.execution_note.match(/TR-SIM-\d+/) || ['Pending'])[0]
        : 'Pending',
      sourceStorage: source ? source.storage_loc : 'BLR-WH-01',
      destination: destination ? destination.storage_loc : 'STM-HOSP-04',
      reefer: carrier && carrier.vehicle ? carrier.vehicle : 'BLR-CC-118',
      expectedArrival: arrival
        ? arrival.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
        : recommended ? `T+${recommended.eta_hours} hours` : 'Pending',
      simulated: true,
    },
    integrity,
  };
}

module.exports = class SupplyShieldService extends cds.ApplicationService {
  async init() {
    this.on('integrationsStatus', integrationsStatus);
    this.on('refreshWeather', () => weather.refresh());
    this.on('listDisruptions', listDisruptions);
    this.on('disruptionDetails', disruptionDetails);
    this.on('createDisruption', createDisruption);
    this.on('shipmentOverview', shipmentOverview);
    this.on('shipmentDetails', shipmentDetails);
    this.on('inventoryOverview', inventoryOverview);
    this.on('recoveryPlanDetails', recoveryPlanDetails);
    this.on('approveRecoveryPlan', approveRecoveryPlan);
    this.on('rejectRecoveryPlan', rejectRecoveryPlan);
    this.on('approveRecoveryOption', approveRecoveryOption);
    this.on('complianceOverview', complianceOverview);
    this.on('auditHistory', auditHistory);
    this.on('runAnalysis', async (req) => {
      const disruptionId = typeof req.data.disruptionId === 'string'
        ? req.data.disruptionId.trim()
        : '';
      if (req.data.actor !== undefined && req.data.actor !== null
        && typeof req.data.actor !== 'string') {
        return req.reject(400, 'actor must be a string');
      }
      const actor = typeof req.data.actor === 'string' && req.data.actor.trim()
        ? req.data.actor.trim()
        : config.defaultPlanner;

      if (!disruptionId) return req.reject(400, 'disruptionId is required');
      if (disruptionId.length > 20) {
        return req.reject(400, 'disruptionId must be 20 characters or fewer');
      }
      if (actor.length > 40) return req.reject(400, 'actor must be 40 characters or fewer');

      const tx = cds.tx(req);
      const result = await runPipeline(pipelineDatabase(tx), disruptionId, actor);
      if (result.error) return result;

      const options = result.planId
        ? await tx.run('SELECT id FROM recovery_options WHERE plan_id = ?', [result.planId])
        : [];
      return {
        ...result,
        optionsGenerated: options.length,
        recommendedTitle: result.recommended ? result.recommended.title : null,
      };
    });
    this.on('overview', overview);
    this.on('health', health);
    this.on('currentRecoveryPlan', currentRecoveryPlan);
    return super.init();
  }
};