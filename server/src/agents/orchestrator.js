// ============================================================================
// AGENT ORCHESTRATOR
// Runs the five agents in the fixed, mandated order:
//   Sensing -> Impact -> Scenario -> Logistics -> Compliance
// Every step is written to the hash-chained audit log. The output is handed
// to the human approval stage - agents never execute anything themselves.
// ============================================================================
const crypto = require('crypto');
const sensingAgent = require('./sensing');
const impactAgent = require('./impact');
const scenarioAgent = require('./scenario');
const logisticsAgent = require('./logistics');
const complianceAgent = require('./compliance');
const rules = require('../rules/rules');
const { audit } = require('../utils/audit');
const { explain } = require('../llm/explainer');
const { policy, DEMO_RUN } = require('../db/canonical-data');

const AGENT_SEQUENCE = ['SensingAgent', 'ImpactAgent', 'ScenarioAgent', 'LogisticsAgent', 'ComplianceAgent'];

function factsText(disruption, sensing, impact, options, discarded) {
  const p = impact.primary;
  const lines = [
    `Event: ${disruption.type} at port ${disruption.port}, severity ${sensing.severity}, expected delay ${sensing.delayHours} hours.`,
    `${disruption.affected_pos} purchase orders and ${disruption.affected_shipments} shipments across the network are flagged by the alert feed (simulated).`,
    `Highest risk: ${p.medicine} at ${p.facility_name} - stock cover ${p.cover_hours} hours (${p.cover_days} days), shortfall ${p.shortfall} ${p.unit}, recommended top-up ${p.transfer_qty} ${p.unit}.`,
  ];
  for (const o of options) {
    const verdict = o.recommended ? 'RECOMMENDED' : (o.eligible ? 'eligible' : 'REJECTED');
    lines.push(`Option "${o.title}": ${verdict}; cost USD ${o.cost_usd}; ETA ${o.eta_hours}h; ${o.rule_notes}`);
  }
  for (const d of discarded) lines.push(`Candidate "${d.title}" discarded: ${d.reason}`);
  return lines.join('\n');
}

async function nextRunNumber(db) {
  if (typeof db.withTransaction !== 'function') {
    throw new Error('Analysis requires a transaction-capable database adapter');
  }
  return db.withTransaction(async (tx) => {
    await tx.run(
      "UPDATE pipeline_state SET value = value + 1 WHERE name = 'RUN_COUNTER'",
    );
    const state = await tx.get(
      "SELECT value FROM pipeline_state WHERE name = 'RUN_COUNTER'",
    );
    if (!state) throw new Error('Run-ID coordination row is missing; deploy the pipeline_state seed data');

    const plans = await tx.all('SELECT run_id FROM recovery_plans');
    const highestExisting = plans.reduce((highest, plan) => {
      const match = /^SS-(\d+)$/.exec(plan.run_id || '');
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    const runNo = Math.max(Number(state.value), highestExisting + 1);
    if (runNo !== Number(state.value)) {
      await tx.run(
        "UPDATE pipeline_state SET value = ? WHERE name = 'RUN_COUNTER'",
        [runNo],
      );
    }
    return runNo;
  });
}

async function runPipeline(db, disruptionId, actor = 'system') {
  if (typeof db.withTransaction === 'function') {
    return db.withTransaction((tx) => runPipelineInTransaction(tx, disruptionId, actor));
  }
  return runPipelineInTransaction(db, disruptionId, actor);
}

async function runPipelineInTransaction(db, disruptionId, actor) {
  const disruption = await db.get('SELECT * FROM disruptions WHERE id = ?', [disruptionId]);
  if (!disruption) {
    const err = new Error(`Disruption ${disruptionId} not found`);
    err.status = 404;
    throw err;
  }

  const runNo = await nextRunNumber(db);
  const runId = `SS-${String(runNo).padStart(5, '0')}`;
  const correlationId = `${runId}-F7A`;
  const planId = `RP-${String(runNo).padStart(5, '0')}`;

  // ---- Agent 1: Sensing ---------------------------------------------------
  const sensing = await sensingAgent.run(db, disruption);
  await audit(db, runId, 'SensingAgent', 'Disruption detected, validated and classified', {
    type: sensing.type, port: sensing.port, severity: sensing.severity,
    delay_hours: sensing.delayHours, verified: sensing.verified, source: sensing.source,
  });
  if (sensing.errors.length) {
    await db.run('UPDATE disruptions SET status = ? WHERE id = ?', ['DATA_ISSUE', disruptionId]);
    return { error: sensing.errors.join('; '), runId };
  }

  // ---- Agent 2: Impact ----------------------------------------------------
  const impact = await impactAgent.run(db, disruption, sensing);
  await audit(db, runId, 'ImpactAgent', 'Network impact mapped', {
    tracked_shipments: impact.tracked_shipments, tracked_pos: impact.tracked_pos,
    feed_shipments: impact.feed_shipments, feed_pos: impact.feed_pos,
    hospitals_assessed: impact.hospitals_assessed, risks: impact.risks,
  });
  if (!impact.primary) {
    await audit(db, runId, 'Orchestrator', 'No stockout risk identified - no action required', {});
    return { runId, message: 'No stockout risk within the expected delay window. No action needed.' };
  }

  // ---- Agent 3: Scenario --------------------------------------------------
  const scenario = await scenarioAgent.run(db, impact);
  await audit(db, runId, 'ScenarioAgent', 'Recovery scenarios generated', {
    candidates: scenario.options.map((o) => o.title),
    discarded: scenario.discarded,
  });

  // ---- Agent 4: Logistics -------------------------------------------------
  await logisticsAgent.run(db, scenario, impact, sensing);
  await audit(db, runId, 'LogisticsAgent', 'Routes evaluated, options costed', scenario.options.map((o) => ({
    option: o.title, carrier: o.carrier_name, cost_usd: o.cost_usd, eta_hours: o.eta_hours,
    feasible: o.feasible, vehicle: o.vehicle || null,
  })));

  // ---- Agent 5: Compliance ------------------------------------------------
  await complianceAgent.run(db, scenario.options, impact);
  await audit(db, runId, 'ComplianceAgent', 'Hard cold-chain and safety rules applied', scenario.options.map((o) => ({
    option: o.title, compliant: o.compliant, meets_deadline: o.meets_deadline,
    eligible: o.eligible, checks: o.checks,
  })));

  // ---- Transparent scoring & ranking -------------------------------------
  rules.scoreOptions(scenario.options, {
    horizonHours: sensing.delayHours,
    stockoutHours: impact.primary.cover_hours,
    weights: policy.SCORE_WEIGHTS,
  });
  const recommended = scenario.options.find((o) => o.recommended) || null;

  // ---- Explanation layer (LLM with deterministic fallback) ----------------
  const facts = factsText(disruption, sensing, impact, scenario.options, scenario.discarded);
  const explanation = await explain(facts);
  await audit(db, runId, 'ExplainerLLM', 'Planner briefing generated', { source: explanation.source, text: explanation.text });

  // ---- Persist plan + options (idempotent re-runs replace the open plan) --
  await db.run(
    `DELETE FROM recovery_options WHERE plan_id IN
       (SELECT id FROM recovery_plans WHERE disruption_id = ? AND status = 'PENDING_APPROVAL')`,
    [disruptionId],
  );
  await db.run(
    `DELETE FROM recovery_plans WHERE disruption_id = ? AND status = 'PENDING_APPROVAL'`,
    [disruptionId],
  );

  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO recovery_plans (id,disruption_id,run_id,correlation_id,status,recommended_option_id,score,explanation,explanation_source,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [planId, disruptionId, runId, correlationId, 'PENDING_APPROVAL', null, recommended ? recommended.score : 0, explanation.text, explanation.source, now],
  );

  const letters = ['A', 'B', 'C', 'D', 'E'];
  // Canonical display order (matches the UI scenario cards):
  // A = air rerouting, B = Bengaluru stock transfer (recommended), C = wait.
  const ORDER = { AIR_REROUTE: 0, STOCK_TRANSFER: 1, WAIT: 2 };
  const displayOrder = [...scenario.options].sort(
    (a, b) => (ORDER[a.code] !== undefined ? ORDER[a.code] : 9)
      - (ORDER[b.code] !== undefined ? ORDER[b.code] : 9),
  );
  const optionIds = {};
  for (let i = 0; i < displayOrder.length; i++) {
    const o = displayOrder[i];
    const runSuffix = String(runNo).padStart(5, '0');
    const id = runNo === 942 ? `OPT-${letters[i]}` : `OPT-${runSuffix}-${letters[i]}`;
    optionIds[o.code] = id;
    await db.run(
      `INSERT INTO recovery_options (id,plan_id,code,title,source_code,carrier_code,qty,cost_usd,eta_hours,feasible,compliant,meets_deadline,eligible,rank,recommended,status,reason,checks_json,scores_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, planId, o.code, o.title, o.source_code, o.carrier_code, o.qty, o.cost_usd, o.eta_hours,
        o.feasible ? 1 : 0, o.compliant ? 1 : 0, o.meets_deadline ? 1 : 0, o.eligible ? 1 : 0,
        o.rank, o.recommended ? 1 : 0, 'PROPOSED', o.reason,
        JSON.stringify(o.checks), JSON.stringify(o.scores)],
    );
  }
  if (recommended) {
    await db.run('UPDATE recovery_plans SET recommended_option_id = ? WHERE id = ?', [optionIds[recommended.code], planId]);
  }
  await db.run('UPDATE disruptions SET status = ? WHERE id = ?', ['ANALYSED', disruptionId]);

  await audit(db, runId, 'Orchestrator', 'Recovery plan routed for human approval', {
    plan: planId, correlation_id: correlationId,
    recommended: recommended ? recommended.title : null, requested_by: actor,
  });

  return {
    runId, correlationId, planId, recommended,
    message: recommended
      ? `Analysis complete. Recommended: ${recommended.title}. Awaiting human approval.`
      : 'Analysis complete. No option passed all rules - escalate to a human planner.',
  };
}

module.exports = { runPipeline, AGENT_SEQUENCE, DEMO_RUN };
