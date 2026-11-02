// ============================================================================
// CANONICAL DEMO DATASET  (SIMULATED DATA - no live SAP system behind it)
// ----------------------------------------------------------------------------
// This module is the single source of truth for the SupplyShield demo
// scenario: "Cyclone Varun closes Chennai Port". The same records are seeded
// into SAP HANA Cloud (deployed) or the local SQLite fallback, and every
// number the UI shows is derived from them by backend calculations.
//
// Canonical scenario (matches the project presentation and UI copy):
//   - Cyclone Varun, HIGH severity, closes Chennai Port for ~48 hours.
//   - Human Insulin at St. Martha Hospital: 120 vials available after
//     reservations, demand 100 vials/day  =>  28.8 h stock cover (1.2 days),
//     below the 30-hour safety threshold; stockout ~19 h before the delayed
//     replenishment arrives.
//   - Recommended recovery: transfer 240 vials from Bengaluru Warehouse
//     (2 shipper cases of 120), restores 3.6 days of cover, ETA 6 h,
//     cost USD 1,100, donor retains 1,180 vials (safety stock 1,000).
//   - Air rerouting (USD 4,200, ETA 8 h) is REJECTED: the air carrier has no
//     verified cold-chain certification.
//   - Waiting 48 h fails the stock-cover deadline.
//   - Hyderabad transfer is evaluated by the Scenario Agent and discarded:
//     only 150 vials are transferable above safety stock (< 240 needed).
// ============================================================================

const DEMO_RUN = {
  runId: 'SS-00942',
  correlationId: 'SS-00942-F7A',
  planId: 'RP-00942',
};

const medicines = [
  { sku: 'MED-INSULIN', name: 'Human Insulin', min_temp: 2.0, max_temp: 8.0, unit: 'vials', case_size: 120, unit_cost: 4.50, batch: 'IN-84A29', manufactured: '2026-09-14', expiry: '2028-09-13', gdp_class: 'Temperature sensitive' },
  { sku: 'MED-MRNA', name: 'mRNA Vaccine', min_temp: 2.0, max_temp: 8.0, unit: 'doses', case_size: 100, unit_cost: 9.00, batch: 'VX-112C', manufactured: '2026-08-02', expiry: '2027-08-01', gdp_class: 'Temperature sensitive' },
  { sku: 'MED-PLASMA', name: 'Plasma Derivatives', min_temp: 2.0, max_temp: 8.0, unit: 'units', case_size: 48, unit_cost: 22.00, batch: 'PL-49F7', manufactured: '2026-06-20', expiry: '2027-06-19', gdp_class: 'Temperature sensitive' },
  { sku: 'MED-ONCO', name: 'Oncology Biologic', min_temp: 2.0, max_temp: 8.0, unit: 'units', case_size: 40, unit_cost: 61.00, batch: 'ON-225D', manufactured: '2026-07-11', expiry: '2027-07-10', gdp_class: 'Temperature sensitive' },
  { sku: 'MED-RABIES', name: 'Rabies Vaccine', min_temp: 2.0, max_temp: 8.0, unit: 'doses', case_size: 60, unit_cost: 7.25, batch: 'RV-71B3', manufactured: '2026-05-05', expiry: '2028-05-04', gdp_class: 'Temperature sensitive' },
];

const facilities = [
  // type: HOSPITAL | WAREHOUSE | SUPPLIER ; priority P1..P3
  { code: 'HOS-STM', name: 'St. Martha Hospital', city: 'Bengaluru', type: 'HOSPITAL', priority: 'P1', ward: 'ICU / Diabetes', storage_loc: 'STM-HOSP-04' },
  { code: 'HOS-APO', name: 'Apollo Central', city: 'Bengaluru', type: 'HOSPITAL', priority: 'P1', ward: 'Immunization', storage_loc: 'APO-HOSP-01' },
  { code: 'HOS-MAN', name: 'Manipal Hospital', city: 'Bengaluru', type: 'HOSPITAL', priority: 'P2', ward: 'Emergency', storage_loc: 'MAN-HOSP-02' },
  { code: 'HOS-CITY', name: 'City Care Network', city: 'Chennai', type: 'HOSPITAL', priority: 'P3', ward: 'General', storage_loc: 'CITY-HOSP-07' },
  { code: 'WH-BLR', name: 'Bengaluru Warehouse', city: 'Bengaluru', type: 'WAREHOUSE', priority: 'P2', ward: '', storage_loc: 'BLR-WH-01' },
  { code: 'WH-HYD', name: 'Hyderabad DC', city: 'Hyderabad', type: 'WAREHOUSE', priority: 'P2', ward: '', storage_loc: 'HYD-WH-01' },
  { code: 'WH-MUM', name: 'Mumbai Hub', city: 'Mumbai', type: 'SUPPLIER', priority: 'P2', ward: '', storage_loc: 'MUM-HUB-01' },
  { code: 'PORT-MAA', name: 'Chennai Port', city: 'Chennai', type: 'PORT', priority: 'P1', ward: '', storage_loc: 'INMAA' },
];

// available = on hand minus reservations (what the agents may plan with)
const inventory = [
  { facility_code: 'HOS-STM', product_sku: 'MED-INSULIN', qty_on_hand: 120, reserved_qty: 0, daily_usage: 100, safety_stock: 0 },
  { facility_code: 'HOS-APO', product_sku: 'MED-MRNA', qty_on_hand: 840, reserved_qty: 0, daily_usage: 220, safety_stock: 0 },
  { facility_code: 'HOS-CITY', product_sku: 'MED-PLASMA', qty_on_hand: 96, reserved_qty: 0, daily_usage: 18, safety_stock: 0 },
  { facility_code: 'WH-BLR', product_sku: 'MED-INSULIN', qty_on_hand: 1420, reserved_qty: 0, daily_usage: 0, safety_stock: 1000 },
  { facility_code: 'WH-HYD', product_sku: 'MED-INSULIN', qty_on_hand: 600, reserved_qty: 0, daily_usage: 0, safety_stock: 450 },
  { facility_code: 'WH-MUM', product_sku: 'MED-INSULIN', qty_on_hand: 5000, reserved_qty: 0, daily_usage: 0, safety_stock: 0 },
];

const carriers = [
  // ColdRoad Express: certified reefer fleet, guaranteed 2..8 C band.
  // cost = baseCost + costPerKm * distance ; eta = distance/speed + handling
  { code: 'CAR-ROAD', name: 'ColdRoad Express', mode: 'ROAD', cold_chain_certified: 1, min_temp: 2.0, max_temp: 8.0, base_cost: 320, cost_per_km: 2.60, avg_speed_kmh: 60, handling_hours: 1.0, telemetry_capable: 1, vehicle: 'BLR-CC-118' },
  // SkyFreight Cargo: air freight, NO active cold-chain certification,
  // no guaranteed temperature band, no live telemetry -> fails rule R1.
  { code: 'CAR-AIR', name: 'SkyFreight Cargo', mode: 'AIR', cold_chain_certified: 0, min_temp: null, max_temp: null, base_cost: 2800, cost_per_km: 1.40, avg_speed_kmh: 250, handling_hours: 4.0, telemetry_capable: 0, vehicle: '' },
];

const lanes = [
  { id: 1, origin_code: 'WH-BLR', destination_code: 'HOS-STM', mode: 'ROAD', distance_km: 300, carrier_code: 'CAR-ROAD' }, // 320 + 2.6*300 = 1100 USD ; 300/60 + 1 = 6.0 h
  { id: 2, origin_code: 'WH-HYD', destination_code: 'HOS-STM', mode: 'ROAD', distance_km: 570, carrier_code: 'CAR-ROAD' },
  { id: 3, origin_code: 'WH-MUM', destination_code: 'HOS-STM', mode: 'AIR', distance_km: 1000, carrier_code: 'CAR-AIR' },   // 2800 + 1.4*1000 = 4200 USD ; 1000/250 + 4 = 8.0 h
];

// S/4HANA-shaped purchase orders (EBELN). SIMULATED master data.
const purchaseOrders = [
  { ebeln: 'PO-88314', supplier_name: 'MedPharma Ltd', product_sku: 'MED-INSULIN', destination_code: 'HOS-STM', qty: 2000, port: 'INMAA', status: 'IN_TRANSIT', eta: '2026-11-06' },
  { ebeln: 'PO-88321', supplier_name: 'VaxCare Pvt Ltd', product_sku: 'MED-MRNA', destination_code: 'HOS-APO', qty: 1500, port: 'INMAA', status: 'IN_TRANSIT', eta: '2026-11-05' },
  { ebeln: 'PO-88298', supplier_name: 'PlasmaSource India', product_sku: 'MED-PLASMA', destination_code: 'HOS-CITY', qty: 300, port: 'INHYD', status: 'IN_TRANSIT', eta: '2026-11-04' },
  { ebeln: 'PO-88342', supplier_name: 'OncoMed Distributors', product_sku: 'MED-ONCO', destination_code: 'WH-BLR', qty: 500, port: 'INBOM', status: 'IN_TRANSIT', eta: '2026-11-04' },
  { ebeln: 'PO-88350', supplier_name: 'VaxCare Pvt Ltd', product_sku: 'MED-RABIES', destination_code: 'HOS-MAN', qty: 400, port: 'INBOM', status: 'IN_TRANSIT', eta: '2026-11-04' },
];

// eta_text mirrors the UI; delay_hours drives calculations.
const shipments = [
  { id: 'SS-2048', po_ebeln: 'PO-88314', product_sku: 'MED-INSULIN', batch: 'IN-84A29', origin_code: 'PORT-MAA', origin_label: 'Chennai Port', destination_code: 'HOS-STM', destination_label: 'St. Martha Hospital', route: 'NH48 / Bengaluru', status: 'Disrupted', risk: 'Critical', delay_hours: 48, eta_text: '48h delayed', current_temp: 4.2 },
  { id: 'SS-2051', po_ebeln: 'PO-88321', product_sku: 'MED-MRNA', batch: 'VX-112C', origin_code: 'PORT-MAA', origin_label: 'Chennai Port', destination_code: 'HOS-APO', destination_label: 'Apollo Central', route: 'NH48 / Bengaluru', status: 'Disrupted', risk: 'Critical', delay_hours: 32, eta_text: '32h delayed', current_temp: 3.8 },
  { id: 'SS-2056', po_ebeln: 'PO-88298', product_sku: 'MED-PLASMA', batch: 'PL-49F7', origin_code: 'WH-HYD', origin_label: 'Hyderabad DC', destination_code: 'HOS-CITY', destination_label: 'City Care Network', route: 'NH44 South', status: 'Monitoring', risk: 'Medium', delay_hours: 0, eta_text: '6h 20m', current_temp: 5.1 },
  { id: 'SS-2060', po_ebeln: 'PO-88342', product_sku: 'MED-ONCO', batch: 'ON-225D', origin_code: 'WH-MUM', origin_label: 'Mumbai Hub', destination_code: 'WH-BLR', destination_label: 'Bengaluru MedHub', route: 'NH48 South', status: 'On track', risk: 'Low', delay_hours: 0, eta_text: '11h 45m', current_temp: 4.7 },
  { id: 'SS-2063', po_ebeln: 'PO-88350', product_sku: 'MED-RABIES', batch: 'RV-71B3', origin_code: 'WH-MUM', origin_label: 'Mumbai Hub', destination_code: 'HOS-MAN', destination_label: 'Manipal Hospital', route: 'Air / BLR', status: 'On track', risk: 'Low', delay_hours: 0, eta_text: '4h 15m', current_temp: 3.9 },
];

// Demo telemetry for every shipment: 5 hourly readings, all inside 2..8 C.
const shipmentReadings = {
  'SS-2048': [4.1, 4.3, 4.2, 4.5, 4.2],
  'SS-2051': [3.7, 3.9, 4.1, 3.8, 3.8],
  'SS-2056': [5.0, 5.2, 5.1, 5.0, 5.1],
  'SS-2060': [4.5, 4.6, 4.8, 4.7, 4.7],
  'SS-2063': [3.8, 3.9, 4.0, 3.9, 3.9],
};

// 24-point demo series for insulin batch IN-84A29 (12:00 -> now, hourly x2/h).
// min 3.8 / max 5.2 / avg 4.4 / 0 excursions, ends at the live 4.2 C.
const insulinTelemetry = [
  4.6, 4.4, 4.2, 4.5, 4.8, 4.4, 4.1, 3.8, 4.0, 4.3, 4.7, 5.2,
  5.0, 4.6, 4.2, 3.9, 4.1, 4.5, 4.9, 4.7, 4.4, 4.3, 4.4, 4.2,
];

const disruptions = [
  {
    id: 'INC-2026-1104-03', type: 'CYCLONE', title: 'CYCLONE — CHENNAI PORT CLOSURE',
    port: 'INMAA', severity: 'HIGH',
    description: 'Cyclone Varun has suspended vessel and landside operations across the Chennai port complex. Medical cold-chain containers are held at origin and inbound road access is restricted. (SIMULATED ALERT)',
    status: 'ACTIVE', radius_km: 180, wind_kmh: 132, expected_delay_hours: 48,
    affected_shipments: 12, affected_pos: 42,
    // verified=1: port closure confirmed by an operational source.
    // A weather alert alone would be stored with verified=0.
    verified: 1, source: 'Port authority operational bulletin (SIMULATED FEED)',
    created_at: '2026-11-04T17:11:00+05:30',
  },
  {
    id: 'INC-2026-1104-01', type: 'HEAVY_RAIN', title: 'HEAVY RAIN — MUMBAI PORT',
    port: 'INBOM', severity: 'MEDIUM',
    description: 'Heavy rain at Mumbai port; berth delays expected for inbound containers. (SIMULATED ALERT)',
    status: 'MONITORING', radius_km: 60, wind_kmh: 62, expected_delay_hours: 24,
    affected_shipments: 4, affected_pos: 9,
    verified: 0, source: 'Weather intelligence feed (SIMULATED FEED)',
    created_at: '2026-11-04T09:40:00+05:30',
  },
  {
    id: 'INC-2026-1104-02', type: 'FOG', title: 'DENSE FOG — HYDERABAD AIR CARGO',
    port: 'INHYD', severity: 'LOW',
    description: 'Dense fog at Hyderabad airport; short cargo delays expected. (SIMULATED ALERT)',
    status: 'MONITORING', radius_km: 25, wind_kmh: 8, expected_delay_hours: 12,
    affected_shipments: 2, affected_pos: 3,
    verified: 0, source: 'Weather intelligence feed (SIMULATED FEED)',
    created_at: '2026-11-04T06:15:00+05:30',
  },
];

const disruptionTimeline = [
  { disruption_id: 'INC-2026-1104-03', ts: '15:10', title: 'Weather alert elevated', text: 'Cyclone path updated toward northern Tamil Nadu coast.', state: 'done' },
  { disruption_id: 'INC-2026-1104-03', ts: '16:22', title: 'Port authority restriction', text: 'Inbound container movement limited; berth operations paused.', state: 'done' },
  { disruption_id: 'INC-2026-1104-03', ts: '17:06', title: 'Full port closure confirmed', text: 'All marine and gate operations suspended for 48 hours.', state: 'critical' },
  { disruption_id: 'INC-2026-1104-03', ts: '17:11', title: 'SupplyShield event created', text: 'Network impact correlation started automatically.', state: 'active' },
];

const infrastructureStatus = [
  { disruption_id: 'INC-2026-1104-03', label: 'Port operations', status: 'CLOSED', tone: 'critical', icon: 'box' },
  { disruption_id: 'INC-2026-1104-03', label: 'NH16 coastal corridor', status: 'RESTRICTED', tone: 'warning', icon: 'route' },
  { disruption_id: 'INC-2026-1104-03', label: 'Chennai air cargo', status: 'OPERATIONAL', tone: 'success', icon: 'truck' },
  { disruption_id: 'INC-2026-1104-03', label: 'Rail freight terminal', status: 'MONITORING', tone: 'warning', icon: 'inventory' },
];

const alerts = [
  { severity: 'CRITICAL', location: 'Chennai Port', medicine: 'Human Insulin', message: 'Port operations suspended due to Cyclone Varun', ago: '18 min ago' },
  { severity: 'HIGH', location: 'St. Martha Hospital', medicine: 'Human Insulin', message: 'Stock cover below 30-hour safety threshold', ago: '12 min ago' },
  { severity: 'MEDIUM', location: 'Hyderabad DC', medicine: 'Plasma Derivatives', message: 'Temperature telemetry latency detected', ago: '34 min ago' },
];

// Network-level demo aggregates for the control-tower KPIs. In production
// these would roll up from live S/4HANA / track-and-trace feeds; here they
// are seeded demo values and are labelled as such by the API.
const networkStats = [
  { metric: 'resilience_score', value: 82, unit: '/100', detail: '4 points below 30-day baseline' },
  { metric: 'supply_continuity', value: 91, unit: '%', detail: '' },
  { metric: 'cold_chain_integrity', value: 98.7, unit: '%', detail: '' },
  { metric: 'response_readiness', value: 76, unit: '%', detail: '' },
  { metric: 'shipments_in_transit', value: 124, unit: '', detail: 'network-wide demo count' },
  { metric: 'shipments_at_risk', value: 12, unit: '', detail: '9.7% of in-transit' },
  { metric: 'route_exceptions', value: 3, unit: '', detail: '' },
  { metric: 'temp_compliant_pct', value: 98.7, unit: '%', detail: '' },
  { metric: 'hospitals_at_risk', value: 4, unit: '', detail: '+1 since 17:00' },
  { metric: 'active_disruptions_delta', value: 2, unit: '', detail: 'vs yesterday' },
];

// Policy thresholds (deterministic configuration, not AI output)
const policy = {
  STOCK_COVER_THRESHOLD_HOURS: 30, // "stock cover below 30-hour safety threshold"
  SAFETY_BUFFER_DAYS: 1.0,         // buffer added on top of computed shortfall
  DELAY_HOURS_BY_SEVERITY: { LOW: 12, MEDIUM: 24, HIGH: 48, CRITICAL: 72 },
  // Recommendation score weights (documented, transparent):
  SCORE_WEIGHTS: { speed: 0.30, cost: 0.25, protection: 0.25, compliance: 0.20 },
};

module.exports = {
  DEMO_RUN, medicines, facilities, inventory, carriers, lanes,
  purchaseOrders, shipments, shipmentReadings, insulinTelemetry,
  disruptions, disruptionTimeline, infrastructureStatus, alerts,
  networkStats, policy,
};
