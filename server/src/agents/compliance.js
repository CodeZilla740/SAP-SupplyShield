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

function productTemperatureCheck(product, carrier) {
  const productMin = rules.num(product && product.min_temp);
  const productMax = rules.num(product && product.max_temp);
  const carrierMin = rules.num(carrier && carrier.min_temp);
  const carrierMax = rules.num(carrier && carrier.max_temp);
  if ([productMin, productMax].some((value) => value === null)) {
    return { pass: false, note: 'Product temperature range is unavailable' };
  }
  if ([carrierMin, carrierMax].some((value) => value === null)) {
    return { pass: false, note: `Carrier temperature range is unavailable; product requires ${productMin}-${productMax} C` };
  }
  if (carrierMin < productMin || carrierMax > productMax) {
    return {
      pass: false,
      note: `Carrier range ${carrierMin}-${carrierMax} C is outside product range ${productMin}-${productMax} C`,
    };
  }
  return {
    pass: true,
    note: `Carrier range ${carrierMin}-${carrierMax} C is within product range ${productMin}-${productMax} C`,
  };
}

function buildChecks(option, product, r2c, r3c, batchCheck) {
  if (option.code === 'WAIT') {
    return [{
      label: 'Stock-cover deadline', pass: r3c.pass, note: r3c.note,
    }];
  }
  const temperatureCheck = productTemperatureCheck(product, option.carrier);
  const warehouseCheck = option.source_qualification_failure
    ? { pass: false, note: option.source_qualification_failure }
    : r2c;
  const vehicleAvailable = Boolean(
    option.carrier
      && option.carrier.mode === 'ROAD'
      && option.carrier.cold_chain_certified
      && option.carrier.telemetry_capable
      && option.carrier.vehicle,
  );
  const vehicleNote = !option.carrier
    ? 'No carrier is assigned to this option'
    : !option.carrier.cold_chain_certified
      ? 'Carrier lacks active cold-chain certification'
      : !option.carrier.telemetry_capable
        ? 'Carrier lacks live temperature telemetry'
        : !option.carrier.vehicle
          ? 'No qualified reefer vehicle is assigned'
          : `Qualified reefer ${option.vehicle || option.carrier.vehicle} assigned`;
  return [
    { label: 'Product temperature range', ...temperatureCheck },
    { label: 'Warehouse qualification', pass: warehouseCheck.pass, note: warehouseCheck.note },
    { label: 'Reefer vehicle available', pass: vehicleAvailable, note: vehicleNote },
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
    const r2c = o.code === 'WAIT'
      ? { pass: true, note: 'R2 N/A: no transfer' }
      : rules.ruleSafetyStock(
        await db.get('SELECT * FROM inventory WHERE facility_code = ? AND product_sku = ?', [o.source_code, primary.product_sku]),
        o.qty, o.source_code,
      );
    const r3c = rules.ruleDeadline(o.eta_hours, primary.cover_hours);

    o.checks = buildChecks(o, product, r2c, r3c, batchCheck);
    o.compliant = o.code === 'WAIT' || o.checks.every((check) => check.pass);
    o.meets_deadline = r3c.pass;
    o.eligible = Boolean(o.feasible && o.compliant && o.meets_deadline);

    const notes = [];
    if (o.code !== 'WAIT') {
      notes.push(r1c.note);
      notes.push(o.source_qualification_failure || r2c.note);
    }
    notes.push(r3c.note);
    o.rule_notes = notes.join(' | ');

    // Human-readable verdict used across the UI and the briefing.
    if (o.eligible) {
      o.reason = 'Available transferable inventory with verified cold-chain capability and sufficient donor stock.';
    } else if (o.code === 'WAIT') {
      o.reason = `Hospital stock will be exhausted approximately ${Math.round(primary.stockout_gap_hours)} hours before replenishment arrives.`;
    } else if (!o.feasible) {
      o.reason = o.feasibility_note || o.logistics_note || 'Option is not logistically feasible.';
    } else if (!o.compliant) {
      o.reason = o.checks.filter((c) => !c.pass).map((c) => c.note).join('; ') || o.rule_notes;
    } else {
      o.reason = r3c.note;
    }
  }
  return options;
}

module.exports = { run };
