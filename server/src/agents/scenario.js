// ============================================================================
// AGENT 3 - SCENARIO AGENT
// Generates the candidate recovery scenarios for the highest-priority risk:
//   - WAIT         wait for normal transportation to resume
//   - AIR_REROUTE  air rerouting from the supplier hub
//   - TRANSFER     stock transfer from each capable warehouse (Bengaluru,
//                  Hyderabad, ...)
// A candidate whose source cannot ship the required quantity without
// breaching its own safety stock is discarded here and recorded (with the
// reason) so the comparison stays honest.
// ============================================================================

async function run(db, impact) {
  const primary = impact.primary;
  if (!primary) return { options: [], discarded: [] };

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
    const label = lane.mode === 'AIR'
      ? `Air reroute ${primary.transfer_qty} ${primary.unit} from ${source.name}`
      : `Transfer ${primary.transfer_qty} ${primary.unit} from ${source.name}`;

    // Source capability screen (warehouse stock above its safety floor).
    if (source.type === 'WAREHOUSE') {
      const inv = await db.get(
        'SELECT * FROM inventory WHERE facility_code = ? AND product_sku = ?',
        [lane.origin_code, primary.product_sku],
      );
      const transferable = inv ? inv.qty_on_hand - inv.safety_stock : 0;
      if (!inv || transferable < primary.transfer_qty) {
        discarded.push({
          title: `Transfer from ${source.name}`,
          reason: `Insufficient transferable stock: ${Math.max(0, transferable)} ${primary.unit} `
            + `available above safety stock, ${primary.transfer_qty} required.`,
        });
        continue;
      }
    }

    options.push({
      code: lane.mode === 'AIR' ? 'AIR_REROUTE' : 'STOCK_TRANSFER',
      title: label,
      source_code: lane.origin_code,
      source_type: source.type,
      source_name: source.name,
      carrier_code: lane.carrier_code,
      distance_km: lane.distance_km,
      qty: primary.transfer_qty,
      feasible: true,
      scenario_note: lane.mode === 'AIR'
        ? 'Reroute via air freight from the supplier hub.'
        : 'Emergency road transfer from donor warehouse.',
    });
  }

  return { options, discarded };
}

module.exports = { run };
