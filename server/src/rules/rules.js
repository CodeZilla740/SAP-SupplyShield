// ============================================================================
// RULES ENGINE - 100% deterministic. No language model is used anywhere in
// this file, and an LLM can never override these outcomes.
// Every function returns plain facts: pass/fail plus the evidence text.
// ============================================================================

const num = (x) => (x === null || x === undefined || x === '' ? null : Number(x));
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;

// ---- Inventory math -------------------------------------------------------

// Stock cover in hours = available stock / daily usage * 24.
function stockCoverHours(qtyOnHand, dailyUsage) {
  const qty = num(qtyOnHand); const use = num(dailyUsage);
  if (qty === null || !use || use <= 0) return 9999; // no demand -> no stockout
  return r1((qty / use) * 24);
}

// Units consumed during the disruption delay minus what is on hand.
function shortfallUnits(qtyOnHand, dailyUsage, delayHours) {
  const needed = (num(dailyUsage) * num(delayHours)) / 24;
  return Math.max(0, Math.ceil(needed - num(qtyOnHand)));
}

// Recommended transfer quantity: shortfall + a safety buffer (in days of
// demand), rounded UP to whole shipper cases so partial cases never ship.
// Canonical demo: shortfall 80 + buffer 100 = 180 -> 2 x 120-case = 240 vials.
function transferQuantity(qtyOnHand, dailyUsage, delayHours, caseSize, bufferDays = 1.0) {
  const raw = shortfallUnits(qtyOnHand, dailyUsage, delayHours) + Math.ceil(num(dailyUsage) * bufferDays);
  const cs = Math.max(1, num(caseSize) || 1);
  return Math.ceil(raw / cs) * cs;
}

// ---- Hard rules -----------------------------------------------------------

// R1 Cold-chain: the carrier must hold an active certification AND its
// guaranteed temperature band must sit inside the product's allowed band.
function ruleColdChain(product, carrier) {
  if (!carrier) return { pass: false, note: 'R1 FAIL: no carrier available for this lane' };
  const problems = [];
  if (!carrier.cold_chain_certified) {
    problems.push(`${carrier.name} (${carrier.mode.toLowerCase()}) has no active cold-chain certification`);
  }
  const cMin = num(carrier.min_temp); const cMax = num(carrier.max_temp);
  if (cMin === null || cMax === null) {
    problems.push('carrier temperature range missing - cannot verify');
  } else if (cMin < num(product.min_temp) || cMax > num(product.max_temp)) {
    problems.push(
      `carrier band ${cMin}-${cMax} C is outside product band ${num(product.min_temp)}-${num(product.max_temp)} C`,
    );
  }
  if (problems.length) return { pass: false, note: 'R1 FAIL: ' + problems.join('; ') };
  return {
    pass: true,
    note: `R1 PASS: carrier holds ${cMin}-${cMax} C, inside product band ${num(product.min_temp)}-${num(product.max_temp)} C`,
  };
}

// R2 Safety stock: a transfer must never push the donor facility below its
// configured safety stock.
function ruleSafetyStock(sourceInv, qty, sourceCode) {
  if (!sourceInv) return { pass: false, note: `R2 FAIL: no stock record at ${sourceCode}` };
  const onHand = num(sourceInv.qty_on_hand);
  const reserved = num(sourceInv.reserved_qty);
  const requested = num(qty);
  const safetyStock = num(sourceInv.safety_stock);
  if ([onHand, reserved, requested, safetyStock].some((value) => value === null)) {
    return { pass: false, note: `R2 FAIL: stock, reservation, transfer, or safety-stock data is missing at ${sourceCode}` };
  }
  const left = onHand - reserved - requested;
  if (left < safetyStock) {
    return {
      pass: false,
      note: `R2 FAIL: would leave ${left} available units at ${sourceCode}, below safety stock ${safetyStock}`,
    };
  }
  return {
    pass: true,
    note: `R2 PASS: ${left} available units remain at ${sourceCode} (safety stock ${safetyStock})`,
  };
}

// R3 Deadline: the option must arrive before the destination's projected
// stockout (its stock cover in hours).
function ruleDeadline(etaHours, coverHours) {
  if (num(etaHours) <= num(coverHours)) {
    return { pass: true, note: `R3 PASS: ETA ${etaHours}h is within stock cover ${coverHours}h` };
  }
  return {
    pass: false,
    note: `R3 FAIL: ETA ${etaHours}h is after projected stockout (cover ${coverHours}h)`,
  };
}

// Temperature-band validation for telemetry. Returns excursion details.
function checkTemperatureBand(readings, minTemp, maxTemp) {
  const temps = readings.map(num).filter((t) => t !== null);
  const excursions = temps.filter((t) => t < num(minTemp) || t > num(maxTemp));
  return {
    compliant: excursions.length === 0,
    min: temps.length ? Math.min(...temps) : null,
    max: temps.length ? Math.max(...temps) : null,
    avg: temps.length ? r1(temps.reduce((a, b) => a + b, 0) / temps.length) : null,
    excursions: excursions.length,
  };
}

// Batch validity: the batch must not expire before `now` (ISO date string).
function checkBatchValidity(medicine, now = new Date()) {
  if (!medicine || !medicine.expiry) return { pass: false, note: 'Batch validity FAIL: no expiry on record' };
  const valid = new Date(medicine.expiry) > now;
  return {
    pass: valid,
    note: valid
      ? `Batch validity PASS: batch ${medicine.batch} valid through ${medicine.expiry}`
      : `Batch validity FAIL: batch ${medicine.batch} expired ${medicine.expiry}`,
  };
}

// Hospital priority rule: P1 hospitals must be served first. Given the set of
// at-risk positions, return them sorted by (priority, lowest cover first).
function prioritizeHospitals(risks, facilitiesByCode) {
  const rank = { P1: 0, P2: 1, P3: 2 };
  return [...risks].sort((a, b) => {
    const fa = facilitiesByCode[a.facility_code] || {};
    const fb = facilitiesByCode[b.facility_code] || {};
    const pa = rank[fa.priority] !== undefined ? rank[fa.priority] : 9;
    const pb = rank[fb.priority] !== undefined ? rank[fb.priority] : 9;
    if (pa !== pb) return pa - pb;
    return a.cover_hours - b.cover_hours;
  });
}

// ---- Transparent scoring (documented weights, see canonical-data policy) --

// Sub-scores 0..100 for one option, relative to the candidate set.
// speed:      ETA against the disruption horizon (the expected delay).
// cost:       cost against the most expensive candidate.
// protection: arrival margin before the projected stockout.
// compliance: share of hard checks passed.
function scoreOptions(options, { horizonHours, stockoutHours, weights }) {
  const maxCost = Math.max(1, ...options.map((o) => o.cost_usd));
  const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));
  for (const o of options) {
    const speed = clamp(100 * (1 - o.eta_hours / horizonHours));
    const cost = clamp(100 * (1 - o.cost_usd / maxCost));
    const protection = clamp(100 * (stockoutHours - o.eta_hours) / Math.max(1, stockoutHours));
    const checks = o.checks || [];
    const compliance = checks.length ? Math.round((100 * checks.filter((c) => c.pass).length) / checks.length) : 100;
    o.scores = { speed, cost, protection, compliance };
    o.score = o.eligible
      ? Math.round(
        weights.speed * speed + weights.cost * cost
        + weights.protection * protection + weights.compliance * compliance,
      )
      : 0;
  }
  // Rank eligible options by score (ties: cheaper first).
  const eligible = options.filter((o) => o.eligible).sort((a, b) => b.score - a.score || a.cost_usd - b.cost_usd);
  eligible.forEach((o, i) => { o.rank = i + 1; o.recommended = i === 0; });
  options.filter((o) => !o.eligible).forEach((o) => { o.rank = 0; o.recommended = false; });
  return options;
}

module.exports = {
  num, r1, r2,
  stockCoverHours, shortfallUnits, transferQuantity,
  ruleColdChain, ruleSafetyStock, ruleDeadline,
  checkTemperatureBand, checkBatchValidity, prioritizeHospitals,
  scoreOptions,
};
