// ============================================================================
// HUMAN APPROVAL SERVICE
// The backend independently RE-VALIDATES compliance against current database
// records before accepting any approval - approval is never just a UI flag.
// A non-compliant option cannot be approved; the attempt is rejected with
// the evidence and recorded in the audit trail.
// ============================================================================
const crypto = require('crypto');
const rules = require('../rules/rules');
const impactAgent = require('../agents/impact');
const { audit } = require('../utils/audit');

// Recompute the compliance position for an option from live DB records.
async function revalidate(db, option, plan) {
  const disruption = await db.get('SELECT * FROM disruptions WHERE id = ?', [plan.disruption_id]);
  const sensing = { delayHours: disruption.expected_delay_hours };
  const impact = await impactAgent.run(db, disruption, sensing);
  if (!impact.primary) return { ok: false, reasons: ['No active risk position found for this plan'] };
  const product = await db.get('SELECT * FROM medicines WHERE sku = ?', [impact.primary.product_sku]);
  const reasons = [];

  if (option.code !== 'WAIT') {
    const carrier = option.carrier_code
      ? await db.get('SELECT * FROM carriers WHERE code = ?', [option.carrier_code]) : null;
    const r1c = rules.ruleColdChain(product, carrier);
    if (!r1c.pass) reasons.push(r1c.note);
    const batchCheck = rules.checkBatchValidity(product);
    if (!batchCheck.pass) reasons.push(batchCheck.note);
    if (!option.source_code) {
      reasons.push('R2 FAIL: transfer source is missing');
    } else {
      if (option.source_code === impact.primary.facility_code) {
        reasons.push('R2 FAIL: source cannot be the affected facility');
      }
      const inv = await db.get(
        'SELECT * FROM inventory WHERE facility_code = ? AND product_sku = ?',
        [option.source_code, impact.primary.product_sku],
      );
      const r2c = rules.ruleSafetyStock(inv, option.qty, option.source_code);
      if (!r2c.pass) reasons.push(r2c.note);
    }
  }
  const r3c = rules.ruleDeadline(option.eta_hours, impact.primary.cover_hours);
  if (!r3c.pass) reasons.push(r3c.note);

  return { ok: reasons.length === 0, reasons, impact };
}

async function decide(db, planId, optionId, decision, actor, comment) {
  if (typeof db.withTransaction === 'function') {
    let deferredError;
    const result = await db.withTransaction(async (tx) => {
      try {
        return await decideInTransaction(tx, planId, optionId, decision, actor, comment);
      } catch (error) {
        if (decision === 'APPROVED' && error.status === 409 && error.reasons) {
          deferredError = error;
          return null;
        }
        throw error;
      }
    });
    if (deferredError) throw deferredError;
    return result;
  }
  return decideInTransaction(db, planId, optionId, decision, actor, comment);
}

async function decideInTransaction(db, planId, optionId, decision, actor, comment) {
  const plan = await db.get('SELECT * FROM recovery_plans WHERE id = ?', [planId]);
  if (!plan) { const e = new Error(`Recovery plan ${planId} not found`); e.status = 404; throw e; }
  if (plan.status !== 'PENDING_APPROVAL') {
    const e = new Error(`Plan ${planId} is already ${plan.status} - decisions cannot be changed`);
    e.status = 409; throw e;
  }
  const option = await db.get(
    'SELECT * FROM recovery_options WHERE id = ? AND plan_id = ?', [optionId, planId],
  );
  if (!option) { const e = new Error(`Option ${optionId} not found in plan ${planId}`); e.status = 404; throw e; }

  const now = new Date().toISOString();

  if (decision === 'APPROVED') {
    // ---- Server-side compliance revalidation (cannot be bypassed) ---------
    const check = await revalidate(db, option, plan);
    if (!check.ok || !option.eligible) {
      const reasons = check.reasons.length ? check.reasons : ['Option is not eligible (see rule evidence)'];
      await audit(db, plan.run_id, actor, 'Approval BLOCKED by compliance revalidation', {
        plan: planId, option: option.title, reasons,
      });
      const e = new Error(`Blocked by compliance rules: ${reasons.join('; ')}`);
      e.status = 409;
      e.reasons = reasons;
      throw e;
    }

    await db.run('UPDATE recovery_options SET status = ? WHERE id = ?', ['APPROVED', optionId]);
    await db.run('UPDATE recovery_options SET status = ? WHERE plan_id = ? AND id != ?', ['NOT_SELECTED', planId, optionId]);
    await db.run(
      'UPDATE recovery_plans SET status = ?, decided_at = ?, decided_by = ?, decision_comment = ? WHERE id = ?',
      ['APPROVED', now, actor, comment || '', planId],
    );
    const executionNote =
      `SIMULATED EXECUTION: stock transport order from ${option.source_code || 'origin'} `
      + `(${option.qty} units via ${option.carrier_code}), reference TR-SIM-${String(Math.floor(10000 + Math.random() * 89999))}. `
      + 'No real SAP S/4HANA inventory or logistics transaction was posted - this prototype records the intended action only.';
    await db.run(
      `INSERT INTO approvals (id,plan_id,option_id,decision,actor,comment,created_at,execution_note)
       VALUES (?,?,?,?,?,?,?,?)`,
      [crypto.randomUUID(), planId, optionId, 'APPROVED', actor, comment || '', now, executionNote],
    );
    await audit(db, plan.run_id, actor, 'Recovery plan APPROVED by human planner', {
      plan: planId, option: option.title, comment: comment || '', execution: 'SIMULATED',
    });
    return { status: 'APPROVED', plan: planId, option: option.title, executionNote };
  }

  // ---- Rejection ----------------------------------------------------------
  await db.run('UPDATE recovery_options SET status = ? WHERE id = ?', ['REJECTED', optionId]);
  await db.run(
    'UPDATE recovery_plans SET status = ?, decided_at = ?, decided_by = ?, decision_comment = ? WHERE id = ?',
    ['REJECTED', now, actor, comment || '', planId],
  );
  await db.run(
    `INSERT INTO approvals (id,plan_id,option_id,decision,actor,comment,created_at,execution_note)
     VALUES (?,?,?,?,?,?,?,?)`,
    [crypto.randomUUID(), planId, optionId, 'REJECTED', actor, comment || '', now, 'No action executed. Plan returned for replanning.'],
  );
  await audit(db, plan.run_id, actor, 'Recovery plan REJECTED by human planner', {
    plan: planId, option: option.title, comment: comment || '',
  });
  return { status: 'REJECTED', plan: planId, option: option.title, executionNote: 'No action executed.' };
}

module.exports = { decide, revalidate };
