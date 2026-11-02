// ============================================================================
// AGENT 2 - IMPACT AGENT
// Identifies affected shipments and purchase orders, retrieves medicine and
// inventory records, computes available stock (after reservations), stock
// cover hours and shortage quantities, and ranks hospitals by priority.
// All arithmetic is delegated to the deterministic rules engine.
// ============================================================================
const rules = require('../rules/rules');
const { policy } = require('../db/canonical-data');

async function run(db, disruption, sensing) {
  // Scope disrupted consignments to this port; a shipment flagged Disrupted
  // for another event must not leak into this scenario's impact assessment.
  const affectedShipments = await db.all(
    `SELECT s.*, m.name AS medicine, m.case_size, m.min_temp, m.max_temp
     FROM shipments s JOIN medicines m ON m.sku = s.product_sku
     WHERE s.po_ebeln IN (
       SELECT ebeln FROM purchase_orders WHERE port = ? AND status = 'IN_TRANSIT')
       OR (s.status = 'Disrupted' AND s.origin_code = 'PORT-' || ?)`,
    [disruption.port, disruption.port.replace(/^IN/, '')],
  );

  const affectedPOs = await db.all(
    `SELECT * FROM purchase_orders WHERE port = ? AND status = 'IN_TRANSIT'`,
    [disruption.port],
  );

  const facilities = await db.all('SELECT * FROM facilities');
  const facilitiesByCode = Object.fromEntries(facilities.map((f) => [f.code, f]));

  // Keep the most delayed linked shipment for each destination and product.
  // Multiple replenishments can serve the same stock position.
  const shipmentsByRisk = new Map();
  for (const ship of affectedShipments) {
    if (!ship.destination_code) continue;
    const key = `${ship.destination_code}|${ship.product_sku}`;
    const delayHours = ship.delay_hours > 0 ? ship.delay_hours : sensing.delayHours;
    const existing = shipmentsByRisk.get(key);
    if (!existing || delayHours > existing.delayHours) {
      shipmentsByRisk.set(key, { ship, delayHours });
    }
  }

  let demandSurgePct = 0;
  if (disruption.type === 'DEMAND_SURGE') {
    const timeline = await db.all(
      'SELECT text FROM disruption_timeline WHERE disruption_id = ? ORDER BY ts',
      [disruption.id],
    );
    for (const item of timeline) {
      const match = /(\d+(?:\.\d+)?)%\s+above\b/i.exec(item.text || '');
      if (match) {
        demandSurgePct = Number(match[1]);
        break;
      }
    }
  }

  // Assess one inventory position for each facility and product.
  const risks = [];
  for (const { ship, delayHours } of shipmentsByRisk.values()) {
    const inv = await db.get(
      'SELECT * FROM inventory WHERE facility_code = ? AND product_sku = ?',
      [ship.destination_code, ship.product_sku],
    );
    const facility = facilitiesByCode[ship.destination_code] || {};
    if (!inv) {
      risks.push({
        facility_code: ship.destination_code, facility_name: facility.name,
        product_sku: ship.product_sku, medicine: ship.medicine, missing_data: true, at_risk: false,
      });
      continue;
    }
    const available = inv.qty_on_hand - inv.reserved_qty;
    const dailyUsage = Number(inv.daily_usage) * (1 + demandSurgePct / 100);
    const coverHours = rules.stockCoverHours(available, dailyUsage);
    const shortfall = rules.shortfallUnits(available, dailyUsage, delayHours);
    const med = await db.get('SELECT * FROM medicines WHERE sku = ?', [ship.product_sku]);
    const transferQty = shortfall > 0
      ? rules.transferQuantity(available, dailyUsage, delayHours, med.case_size, policy.SAFETY_BUFFER_DAYS)
      : 0;
    risks.push({
      facility_code: ship.destination_code,
      facility_name: facility.name,
      priority: facility.priority,
      product_sku: ship.product_sku,
      medicine: ship.medicine,
      unit: med.unit,
      batch: ship.batch,
      available,
      daily_usage: dailyUsage,
      demand_surge_pct: demandSurgePct,
      cover_hours: coverHours,
      cover_days: rules.r1(coverHours / 24),
      delay_hours: delayHours,
      shortfall,
      transfer_qty: transferQty,
      at_risk: coverHours < delayHours,
      stockout_gap_hours: rules.r1(Math.max(0, delayHours - coverHours)),
    });
  }

  const prioritized = rules.prioritizeHospitals(risks.filter((r) => !r.missing_data), facilitiesByCode);
  const atRisk = prioritized.filter((r) => r.at_risk);

  return {
    // Scope counts to the linked database records; stale feed aggregates are
    // never presented as shipment or purchase-order counts.
    tracked_shipments: affectedShipments.length,
    tracked_pos: affectedPOs.length,
    feed_shipments: affectedShipments.length,
    feed_pos: affectedPOs.length,
    hospitals_assessed: facilities.filter((f) => f.type === 'HOSPITAL').length,
    risks: prioritized,
    primary: atRisk[0] || null,
    other_at_risk: atRisk.slice(1),
  };
}

module.exports = { run };
