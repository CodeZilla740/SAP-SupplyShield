// Unit tests for the deterministic rules engine.
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../src/rules/rules');

const insulin = { sku: 'MED-INSULIN', min_temp: 2, max_temp: 8, case_size: 120, batch: 'IN-84A29', expiry: '2028-09-13' };
const roadCarrier = { name: 'ColdRoad Express', mode: 'ROAD', cold_chain_certified: 1, min_temp: 2, max_temp: 8 };
const airCarrier = { name: 'SkyFreight Cargo', mode: 'AIR', cold_chain_certified: 0, min_temp: null, max_temp: null };

test('stock cover calculation: 120 vials at 100/day covers 28.8 hours', () => {
  assert.equal(rules.stockCoverHours(120, 100), 28.8);
  assert.equal(rules.stockCoverHours(840, 220), 91.6);
  // no demand -> effectively infinite cover
  assert.equal(rules.stockCoverHours(1420, 0), 9999);
});

test('shortfall calculation: 48h delay at 100/day with 120 on hand -> 80 vials', () => {
  assert.equal(rules.shortfallUnits(120, 100, 48), 80);
  assert.equal(rules.shortfallUnits(500, 100, 48), 0); // no shortfall when covered
});

test('transfer quantity: shortfall 80 + 1-day buffer, rounded to 120-cases -> 240', () => {
  assert.equal(rules.transferQuantity(120, 100, 48, 120, 1.0), 240);
  // restored cover = (120 + 240) / 100 = 3.6 days
  assert.equal(rules.r1((120 + 240) / 100), 3.6);
});

test('carrier certification validation (R1)', () => {
  assert.equal(rules.ruleColdChain(insulin, roadCarrier).pass, true);
  const air = rules.ruleColdChain(insulin, airCarrier);
  assert.equal(air.pass, false);
  assert.match(air.note, /no active cold-chain certification/);
  assert.match(air.note, /temperature range missing/);
  // certified carrier but band outside product band also fails
  const wrongBand = { name: 'WarmTruck', mode: 'ROAD', cold_chain_certified: 1, min_temp: 0, max_temp: 12 };
  assert.equal(rules.ruleColdChain(insulin, wrongBand).pass, false);
});

test('safety-stock validation (R2)', () => {
  // Bengaluru: 1420 - 240 = 1180 >= safety 1000 -> PASS
  assert.equal(rules.ruleSafetyStock({ qty_on_hand: 1420, safety_stock: 1000 }, 240, 'WH-BLR').pass, true);
  // Hyderabad: 600 - 240 = 360 < safety 450 -> FAIL
  const hyd = rules.ruleSafetyStock({ qty_on_hand: 600, safety_stock: 450 }, 240, 'WH-HYD');
  assert.equal(hyd.pass, false);
  assert.match(hyd.note, /below safety stock/);
});

test('deadline validation (R3)', () => {
  assert.equal(rules.ruleDeadline(6, 28.8).pass, true);   // Bengaluru transfer arrives in time
  assert.equal(rules.ruleDeadline(48, 28.8).pass, false); // waiting misses the stockout
});

test('temperature-band validation', () => {
  const good = rules.checkTemperatureBand([4.1, 4.3, 4.2, 4.5, 4.2], 2, 8);
  assert.equal(good.compliant, true);
  assert.equal(good.excursions, 0);
  const bad = rules.checkTemperatureBand([4.1, 9.3, 4.2], 2, 8);
  assert.equal(bad.compliant, false);
  assert.equal(bad.excursions, 1);
  assert.equal(bad.max, 9.3);
});

test('batch validity check', () => {
  assert.equal(rules.checkBatchValidity(insulin, new Date('2026-11-04')).pass, true);
  const expired = { ...insulin, expiry: '2025-01-01' };
  assert.equal(rules.checkBatchValidity(expired, new Date('2026-11-04')).pass, false);
});

test('recovery-option ranking: only the compliant, in-time option is recommended', () => {
  const options = [
    { code: 'AIR_REROUTE', cost_usd: 4200, eta_hours: 8, eligible: false, checks: [{ pass: true }, { pass: false }] },
    { code: 'STOCK_TRANSFER', cost_usd: 1100, eta_hours: 6, eligible: true, checks: [{ pass: true }, { pass: true }, { pass: true }, { pass: true }] },
    { code: 'WAIT', cost_usd: 0, eta_hours: 48, eligible: false, checks: [{ pass: false }] },
  ];
  rules.scoreOptions(options, {
    horizonHours: 48, stockoutHours: 28.8,
    weights: { speed: 0.30, cost: 0.25, protection: 0.25, compliance: 0.20 },
  });
  const rec = options.find((o) => o.recommended);
  assert.equal(rec.code, 'STOCK_TRANSFER');
  assert.equal(rec.rank, 1);
  assert.ok(rec.score > 0 && rec.score <= 100);
  assert.equal(options.find((o) => o.code === 'AIR_REROUTE').recommended, false);
  assert.equal(options.find((o) => o.code === 'WAIT').rank, 0);
});

test('hospital priority rule: P1 before P2, lowest cover first inside a tier', () => {
  const risks = [
    { facility_code: 'HOS-CITY', cover_hours: 100 },
    { facility_code: 'HOS-APO', cover_hours: 90 },
    { facility_code: 'HOS-STM', cover_hours: 28.8 },
  ];
  const facilities = {
    'HOS-CITY': { priority: 'P3' }, 'HOS-APO': { priority: 'P1' }, 'HOS-STM': { priority: 'P1' },
  };
  const sorted = rules.prioritizeHospitals(risks, facilities);
  assert.deepEqual(sorted.map((r) => r.facility_code), ['HOS-STM', 'HOS-APO', 'HOS-CITY']);
});
