// ============================================================================
// AGENT 5 - COMPLIANCE AGENT
// Enforces the hard pharmaceutical and logistics rules in deterministic code:
//   R1 carrier cold-chain certification + guaranteed temperature band
//   R2 donor warehouse safety stock
//   R3 stock-cover deadline (arrive before the projected stockout)
//   plus batch validity and telemetry capability evidence.
// An LLM never sees a vote here; these checks cannot be overridden by AI.
// ============================================================================
const rules = require('../rules/rules');

function buildChecks(option, product, r1c, r2c, r3c, batchCheck) {
  if (option.code === 'WAIT') {
    return [{
      label: 'Stock-cover deadline', pass: r3c.pass, note: r3c.note,
    }];
  }
  if (option.carrier && option.carrier.mode === 'AIR') {
    return [
      { label: 'Product temperature range', pass: product && rules.num(product.min_temp) !== null, note: `Required band +${product.min_temp}°C to +${product.max_temp}°C` },
      { label: 'Carrier certification', pass: Boolean(option.carrier.cold_chain_certified), note: r1c.note },
      { label: 'Live telemetry capability', pass: Boolean(option.carrier.telemetry_capable), note: option.carrier.telemetry_capable ? 'Live reefer telemetry available' : 'Carrier offers no live temperature telemetry' },
      { label: 'Batch validity', pass: batchCheck.pass, note: batchCheck.note },
    ];
  }
  return [
    { label: 'Product temperature range', pass: r1c.pass, note: r1c.note },
    { label: 'Warehouse qualification', pass: r2c.pass, note: r2c.note },
    { label: 'Reefer vehicle available', pass: Boolean(option.carrier && option.carrier.cold_chain_certified && option.carrier.telemetry_capable && option.carrier.vehicle), note: option.vehicle ? `Reefer ${option.vehicle} assigned` : 'No qualified reefer vehicle' },
    { label: 'Batch validity', pass: batchCheck.pass, note: batchCheck.note },
  ];
}

async function run(db, options, impact) {
  const primary = impact.primary;
  if (!primary) return options;
  const product = await db.get('SELECT * FROM medicines WHERE sku = ?', [primary.product_sku]);
  const batchCheck = rules.checkBatchValidity(product);

  for (const o of options) {
    const r1c = o.code === 'WAIT'
      ? { pass: true, note: 'R1 N/A: no transport action' }
      : rules.ruleColdChain(product, o.carrier);
    const r2c = (o.code === 'WAIT' || o.source_type === 'SUPPLIER')
      ? { pass: true, note: o.code === 'WAIT' ? 'R2 N/A: no transfer' : 'R2 N/A: supplier hub (capacity confirmed on the SAP PO)' }
      : rules.ruleSafetyStock(
        await db.get('SELECT * FROM inventory WHERE facility_code = ? AND product_sku = ?', [o.source_code, primary.product_sku]),
        o.qty, o.source_code,
      );
    const r3c = rules.ruleDeadline(o.eta_hours, primary.cover_hours);

    o.checks = buildChecks(o, product, r1c, r2c, r3c, batchCheck);
    o.compliant = r1c.pass && r2c.pass;
    o.meets_deadline = r3c.pass;
    o.eligible = Boolean(o.feasible && o.compliant && o.meets_deadline);

    const notes = [];
    if (o.code !== 'WAIT') { notes.push(r1c.note); notes.push(r2c.note); }
    notes.push(r3c.note);
    o.rule_notes = notes.join(' | ');

    // Human-readable verdict used across the UI and the briefing.
    if (o.eligible) {
      o.reason = 'Available transferable inventory with verified cold-chain capability and sufficient donor stock.';
    } else if (o.code === 'WAIT') {
      o.reason = `Hospital stock will be exhausted approximately ${Math.round(primary.stockout_gap_hours)} hours before replenishment arrives.`;
    } else if (!o.feasible) {
      o.reason = o.logistics_note || 'Option is not logistically feasible.';
    } else if (!o.compliant) {
      o.reason = o.checks.filter((c) => !c.pass).map((c) => c.note).join('; ') || o.rule_notes;
    } else {
      o.reason = r3c.note;
    }
  }
  return options;
}

module.exports = { run };
