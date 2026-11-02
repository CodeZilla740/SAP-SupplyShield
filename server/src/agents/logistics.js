// ============================================================================
// AGENT 4 - LOGISTICS AGENT
// Evaluates route and transfer feasibility: attaches the carrier for every
// candidate, computes cost and ETA from carrier rate cards and lane
// distances, and confirms source inventory. Infeasible options are marked
// and explained, never silently dropped.
// ============================================================================
const rules = require('../rules/rules');

async function run(db, scenario, impact, sensing) {
  const primary = impact.primary;
  for (const o of scenario.options) {
    if (o.code === 'WAIT') {
      o.carrier_name = '-';
      o.vehicle = '';
      o.cost_usd = 0;
      o.eta_hours = primary.delay_hours || sensing.delayHours;
      o.logistics_note = `Replenishment resumes after the linked shipment delay (~${o.eta_hours}h).`;
      continue;
    }
    const carrier = await db.get('SELECT * FROM carriers WHERE code = ?', [o.carrier_code]);
    o.carrier = carrier || null;
    o.carrier_name = carrier ? carrier.name : 'NO CARRIER';
    o.vehicle = carrier ? carrier.vehicle : '';
    if (!carrier) {
      o.feasible = false;
      o.cost_usd = 0;
      o.eta_hours = 9999;
      o.logistics_note = 'No carrier is contracted for this lane.';
      continue;
    }
    o.cost_usd = rules.r2(Number(carrier.base_cost) + Number(carrier.cost_per_km) * Number(o.distance_km));
    o.eta_hours = rules.r1(Number(o.distance_km) / Number(carrier.avg_speed_kmh) + Number(carrier.handling_hours));
    o.logistics_note =
      `${carrier.mode === 'AIR' ? 'Air' : 'Road'} lane ${o.distance_km} km via ${carrier.name}: `
      + `cost ${carrier.base_cost} + ${carrier.cost_per_km}/km, ETA ${o.distance_km}/${carrier.avg_speed_kmh} km/h + ${carrier.handling_hours}h handling.`;
  }
  return scenario.options;
}

module.exports = { run };
