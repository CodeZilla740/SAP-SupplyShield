// ============================================================================
// AGENT 3 - SCENARIO AGENT
// Generates the candidate recovery scenarios for the highest-priority risk:
//   - WAIT         wait for normal transportation to resume
//   - AIR_REROUTE  air rerouting from the supplier hub
//   - TRANSFER     stock transfer from each capable warehouse (Bengaluru,
//                  Hyderabad, ...)
// Candidates with missing or insufficient source stock remain visible as
// infeasible alternatives, with the reason preserved for the planner.
// ============================================================================

const { portCatalogue } = require('../db/canonical-data');

async function run(db, impact, disruption) {
  const primary = impact.primary;
  if (!primary) return { options: [], discarded: [] };

  const disruptedFacility = disruption.type === 'POWER_OUTAGE'
    ? portCatalogue.find((entry) => entry.code === disruption.port)?.facilityCode
    : null;
  const options = [{
    code: 'WAIT',
    title: 'Wait for original shipment',
    source_code: null,
    carrier_code: null,
    qty: 0,
    feasible: true,
    scenario_note: 'Baseline: no action, wait for the disrupted consignment.',
  }];

  const discarded = [];
  const lanes = await db.all(
    'SELECT * FROM lanes WHERE destination_code = ?', [primary.facility_code],
  );
  for (const lane of lanes) {
    const source = await db.get('SELECT * FROM facilities WHERE code = ?', [lane.origin_code]);
    if (!source || source.code === primary.facility_code) {
      discarded.push({
        title: `Recovery lane from ${lane.origin_code}`,
        reason: !source ? 'Source facility record is unavailable.' : 'Source cannot be the affected facility.',
      });
      continue;
    }
    if (!['WAREHOUSE', 'SUPPLIER'].includes(source.type)) {
      discarded.push({
        title: `Transfer from ${source.name}`,
        reason: `${source.name} is not an eligible donor warehouse or supplier.`,
      });
      continue;
    }
    const label = lane.mode === 'AIR'
      ? `Air reroute ${primary.transfer_qty} ${primary.unit} from ${source.name}`
      : `Transfer ${primary.transfer_qty} ${primary.unit} from ${source.name}`;

    const inv = await db.get(
      'SELECT * FROM inventory WHERE facility_code = ? AND product_sku = ?',
      [lane.origin_code, primary.product_sku],
    );
    const onHand = inv ? Number(inv.qty_on_hand) : NaN;
    const reserved = inv ? Number(inv.reserved_qty) : NaN;
    const safetyStock = inv ? Number(inv.safety_stock) : NaN;
    const transferable = onHand - reserved - safetyStock;
    const sourceQualificationFailure = source.code === disruptedFacility
      ? `${source.name} is affected by the reported power outage; storage-temperature telemetry is unavailable to qualify it as a donor.`
      : null;
    const inventoryFailure = !inv
      ? 'No inventory record is available for this medicine.'
      : ![onHand, reserved, safetyStock].every(Number.isFinite)
        ? 'Inventory, reservation, or safety-stock data is unavailable.'
        : transferable < primary.transfer_qty
          ? `Insufficient transferable stock: ${Math.max(0, transferable)} ${primary.unit} `
            + `available above reservations and safety stock, ${primary.transfer_qty} required.`
          : null;

    options.push({
      code: lane.mode === 'AIR' ? 'AIR_REROUTE' : 'STOCK_TRANSFER',
      title: label,
      source_code: lane.origin_code,
      source_type: source.type,
      source_name: source.name,
      carrier_code: lane.carrier_code,
      distance_km: lane.distance_km,
      qty: primary.transfer_qty,
      feasible: !sourceQualificationFailure && !inventoryFailure,
      source_qualification_failure: sourceQualificationFailure,
      scenario_note: lane.mode === 'AIR'
        ? 'Reroute via air freight from the supplier hub.'
        : 'Emergency road transfer from donor warehouse.',
      feasibility_note: sourceQualificationFailure || inventoryFailure || '',
    });
  }

  return { options, discarded };
}

module.exports = { run };
