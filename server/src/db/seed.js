// Seeds the canonical demo dataset (SIMULATED DATA) into the active
// database engine (SAP HANA Cloud or the local SQLite fallback).
// Re-seeding first clears the transactional and master tables, so the
// operation is idempotent and safe to re-run before a demo.
const data = require('./canonical-data');

const CLEAR_ORDER = [
  'temperature_readings', 'shipments', 'recovery_options', 'approvals',
  'recovery_plans', 'audit_log', 'purchase_orders', 'lanes', 'carriers',
  'inventory', 'disruption_timeline', 'infrastructure_status', 'disruptions',
  'alerts', 'network_stats', 'facilities', 'medicines',
];

async function clearAll(db) {
  for (const table of CLEAR_ORDER) {
    await db.run(`DELETE FROM ${table}`);
  }
}

async function seed(db, { includeMasterData = true } = {}) {
  if (includeMasterData) await clearAll(db);

  let temperatureReadingId = 1;
  for (const m of data.medicines) {
    await db.run(
      `INSERT INTO medicines (sku,name,min_temp,max_temp,unit,case_size,unit_cost,batch,manufactured,expiry,gdp_class)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [m.sku, m.name, m.min_temp, m.max_temp, m.unit, m.case_size, m.unit_cost, m.batch, m.manufactured, m.expiry, m.gdp_class],
    );
  }
  for (const f of data.facilities) {
    await db.run(
      `INSERT INTO facilities (code,name,city,type,priority,ward,storage_loc) VALUES (?,?,?,?,?,?,?)`,
      [f.code, f.name, f.city, f.type, f.priority, f.ward, f.storage_loc],
    );
  }
  for (const i of data.inventory) {
    await db.run(
      `INSERT INTO inventory (facility_code,product_sku,qty_on_hand,reserved_qty,daily_usage,safety_stock)
       VALUES (?,?,?,?,?,?)`,
      [i.facility_code, i.product_sku, i.qty_on_hand, i.reserved_qty, i.daily_usage, i.safety_stock],
    );
  }
  for (const c of data.carriers) {
    await db.run(
      `INSERT INTO carriers (code,name,mode,cold_chain_certified,min_temp,max_temp,base_cost,cost_per_km,avg_speed_kmh,handling_hours,telemetry_capable,vehicle)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [c.code, c.name, c.mode, c.cold_chain_certified, c.min_temp, c.max_temp, c.base_cost, c.cost_per_km, c.avg_speed_kmh, c.handling_hours, c.telemetry_capable, c.vehicle],
    );
  }
  for (const l of data.lanes) {
    await db.run(
      `INSERT INTO lanes (id,origin_code,destination_code,mode,distance_km,carrier_code) VALUES (?,?,?,?,?,?)`,
      [l.id, l.origin_code, l.destination_code, l.mode, l.distance_km, l.carrier_code],
    );
  }
  for (const p of data.purchaseOrders) {
    await db.run(
      `INSERT INTO purchase_orders (ebeln,supplier_name,product_sku,destination_code,qty,port,status,eta)
       VALUES (?,?,?,?,?,?,?,?)`,
      [p.ebeln, p.supplier_name, p.product_sku, p.destination_code, p.qty, p.port, p.status, p.eta],
    );
  }
  for (const s of data.shipments) {
    await db.run(
      `INSERT INTO shipments (id,po_ebeln,product_sku,batch,origin_code,origin_label,destination_code,destination_label,route,status,risk,delay_hours,eta_text,current_temp)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [s.id, s.po_ebeln, s.product_sku, s.batch, s.origin_code, s.origin_label, s.destination_code, s.destination_label, s.route, s.status, s.risk, s.delay_hours, s.eta_text, s.current_temp],
    );
    const temps = data.shipmentReadings[s.id] || [];
    for (let i = 0; i < temps.length; i++) {
      await db.run(
        `INSERT INTO temperature_readings (id,shipment_id,batch,ts,temp_c) VALUES (?,?,?,?,?)`,
        [temperatureReadingId++, s.id, s.batch, `T-${temps.length - i}h`, temps[i]],
      );
    }
  }
  // Insulin batch telemetry (compliance screen): 24 half-hourly readings,
  // timestamps anchored to the canonical demo window 12:00 -> 18:00 IST.
  const med = data.medicines.find((m) => m.sku === 'MED-INSULIN');
  for (let i = 0; i < data.insulinTelemetry.length; i++) {
    const minutes = 12 * 60 + i * 15; // 12:00 + 15 min steps
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    await db.run(
      `INSERT INTO temperature_readings (id,shipment_id,batch,ts,temp_c) VALUES (?,?,?,?,?)`,
      [temperatureReadingId++, 'SS-2048', med.batch, `2026-11-04 ${hh}:${mm}`, data.insulinTelemetry[i]],
    );
  }
  for (const d of data.disruptions) {
    await db.run(
      `INSERT INTO disruptions (id,type,title,port,severity,description,status,radius_km,wind_kmh,expected_delay_hours,affected_shipments,affected_pos,verified,source,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [d.id, d.type, d.title, d.port, d.severity, d.description, d.status, d.radius_km, d.wind_kmh, d.expected_delay_hours, d.affected_shipments, d.affected_pos, d.verified, d.source, d.created_at],
    );
  }
  for (let i = 0; i < data.disruptionTimeline.length; i++) {
    const t = data.disruptionTimeline[i];
    await db.run(
      `INSERT INTO disruption_timeline (id,disruption_id,ts,title,text,state) VALUES (?,?,?,?,?,?)`,
      [i + 1, t.disruption_id, t.ts, t.title, t.text, t.state],
    );
  }
  for (let i = 0; i < data.infrastructureStatus.length; i++) {
    const item = data.infrastructureStatus[i];
    await db.run(
      `INSERT INTO infrastructure_status (id,disruption_id,label,status,tone,icon) VALUES (?,?,?,?,?,?)`,
      [i + 1, item.disruption_id, item.label, item.status, item.tone, item.icon],
    );
  }
  for (let i = 0; i < data.alerts.length; i++) {
    const a = data.alerts[i];
    await db.run(
      `INSERT INTO alerts (id,severity,location,medicine,message,ago) VALUES (?,?,?,?,?,?)`,
      [i + 1, a.severity, a.location, a.medicine, a.message, a.ago],
    );
  }
  for (const n of data.networkStats) {
    await db.run(
      `INSERT INTO network_stats (metric,value,unit,detail) VALUES (?,?,?,?)`,
      [n.metric, n.value, n.unit, n.detail],
    );
  }
}

module.exports = { seed, clearAll };
