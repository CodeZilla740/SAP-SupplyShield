// ============================================================================
// CANONICAL DEMO DATASET (SIMULATED DATA - no live SAP system behind it)
// ----------------------------------------------------------------------------
// This module is the single source of truth for the SupplyShield demo
// scenarios. The same records are seeded into SAP HANA Cloud (deployed) or
// the local SQLite fallback, and UI numbers are derived by backend calculations.
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
//   - Hyderabad transfer is evaluated by the Scenario Agent and retained as
//     an infeasible alternative: only 150 vials are transferable above safety stock.
//
// Multi-port extension (SIMULATED DATA):
//   - Mumbai Port: Flood disrupts mRNA Vaccine supply to Apollo Central.
//   - Kolkata Port: Berth congestion disrupts mRNA Vaccine supply to Kolkata
//     Medical Centre; Hyderabad DC has stock for transfer.
//   - Visakhapatnam Port: Cyclone disrupts Oncology Biologic supply to
//     Manipal Hospital; Pune DC has stock via road transfer.
//   - Hyderabad Hub: delayed rabies-vaccine replenishment threatens Hyderabad DC stock.
//   - Delhi NCR: insulin replenishment delay exceeds hospital stock cover.
//   - Pune DC: delayed plasma shipment creates a short stock-cover window.
//   - Bengaluru Hub: extended mRNA delay threatens Apollo Central; Kolkata DC
//     has qualified donor stock and a cold-chain route within the deadline.
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
  // [SIMULATED] Antibiotic Injection — linked to Visakhapatnam supply chain
  { sku: 'MED-ANTIBIO', name: 'Antibiotic Injection', min_temp: 2.0, max_temp: 8.0, unit: 'vials', case_size: 50, unit_cost: 12.50, batch: 'AB-33K7', manufactured: '2026-10-01', expiry: '2028-09-30', gdp_class: 'Temperature sensitive' },
];

const facilities = [
  // type: HOSPITAL | WAREHOUSE | SUPPLIER | PORT ; priority P1..P3
  { code: 'HOS-STM', name: 'St. Martha Hospital', city: 'Bengaluru', type: 'HOSPITAL', priority: 'P1', ward: 'ICU / Diabetes', storage_loc: 'STM-HOSP-04' },
  { code: 'HOS-APO', name: 'Apollo Central', city: 'Bengaluru', type: 'HOSPITAL', priority: 'P1', ward: 'Immunization', storage_loc: 'APO-HOSP-01' },
  { code: 'HOS-MAN', name: 'Manipal Hospital', city: 'Bengaluru', type: 'HOSPITAL', priority: 'P2', ward: 'Emergency', storage_loc: 'MAN-HOSP-02' },
  { code: 'HOS-CITY', name: 'City Care Network', city: 'Chennai', type: 'HOSPITAL', priority: 'P3', ward: 'General', storage_loc: 'CITY-HOSP-07' },
  { code: 'WH-BLR', name: 'Bengaluru Warehouse', city: 'Bengaluru', type: 'WAREHOUSE', priority: 'P2', ward: '', storage_loc: 'BLR-WH-01' },
  { code: 'WH-HYD', name: 'Hyderabad DC', city: 'Hyderabad', type: 'WAREHOUSE', priority: 'P2', ward: '', storage_loc: 'HYD-WH-01' },
  { code: 'WH-MUM', name: 'Mumbai Hub', city: 'Mumbai', type: 'SUPPLIER', priority: 'P2', ward: '', storage_loc: 'MUM-HUB-01' },
  // Port facilities — Chennai (existing), Mumbai, Kolkata, Visakhapatnam (SIMULATED)
  { code: 'PORT-MAA', name: 'Chennai Port', city: 'Chennai', type: 'PORT', priority: 'P1', ward: '', storage_loc: 'INMAA' },
  { code: 'PORT-BOM', name: 'Mumbai Port', city: 'Mumbai', type: 'PORT', priority: 'P1', ward: '', storage_loc: 'INBOM' },
  { code: 'PORT-KOL', name: 'Kolkata Port', city: 'Kolkata', type: 'PORT', priority: 'P1', ward: '', storage_loc: 'INKOL' },
  { code: 'PORT-VIZ', name: 'Visakhapatnam Port', city: 'Visakhapatnam', type: 'PORT', priority: 'P1', ward: '', storage_loc: 'INVIZ' },
  // Regional facilities
  { code: 'WH-DEL', name: 'Delhi NCR Distribution Centre', city: 'Delhi NCR', type: 'WAREHOUSE', priority: 'P2', ward: '', storage_loc: 'DEL-WH-01' },
  { code: 'HOS-DEL', name: 'Delhi NCR Hospital', city: 'Delhi NCR', type: 'HOSPITAL', priority: 'P1', ward: 'Emergency', storage_loc: 'DEL-HOSP-01' },
  { code: 'WH-KOL', name: 'Kolkata Distribution Centre', city: 'Kolkata', type: 'WAREHOUSE', priority: 'P2', ward: '', storage_loc: 'KOL-WH-01' },
  { code: 'HOS-KOL', name: 'Kolkata Medical Centre', city: 'Kolkata', type: 'HOSPITAL', priority: 'P2', ward: 'Critical Care', storage_loc: 'KOL-HOSP-01' },
  { code: 'WH-PUN', name: 'Pune Distribution Centre', city: 'Pune', type: 'WAREHOUSE', priority: 'P2', ward: '', storage_loc: 'PUN-WH-01' },
  { code: 'HOS-PUN', name: 'Pune Hospital', city: 'Pune', type: 'HOSPITAL', priority: 'P2', ward: 'Emergency', storage_loc: 'PUN-HOSP-01' },
  // [SIMULATED] Visakhapatnam regional hub — serves Andhra Pradesh supply chain
  { code: 'WH-VIZ', name: 'Visakhapatnam Regional Hub', city: 'Visakhapatnam', type: 'WAREHOUSE', priority: 'P2', ward: '', storage_loc: 'VIZ-WH-01' },
];

// available = on hand minus reservations (what the agents may plan with)
const inventory = [
  // --- Chennai Port scenario: Insulin at St. Martha Hospital ---
  { facility_code: 'HOS-STM', product_sku: 'MED-INSULIN', qty_on_hand: 120, reserved_qty: 0, daily_usage: 100, safety_stock: 0 },
  // Apollo Central: mRNA Vaccine — on hand 840 (cover 91.6h > Chennai delay).
  { facility_code: 'HOS-APO', product_sku: 'MED-MRNA', qty_on_hand: 840, reserved_qty: 0, daily_usage: 220, safety_stock: 0 },
  { facility_code: 'HOS-CITY', product_sku: 'MED-PLASMA', qty_on_hand: 96, reserved_qty: 0, daily_usage: 18, safety_stock: 0 },
  { facility_code: 'HOS-CITY', product_sku: 'MED-ONCO', qty_on_hand: 50, reserved_qty: 0, daily_usage: 40, safety_stock: 0 },
  // --- Warehouses ---
  { facility_code: 'WH-BLR', product_sku: 'MED-INSULIN', qty_on_hand: 1420, reserved_qty: 0, daily_usage: 0, safety_stock: 1000 },
  // Bengaluru warehouse rabies vaccine stock is available above its reserve.
  { facility_code: 'WH-BLR', product_sku: 'MED-RABIES', qty_on_hand: 300, reserved_qty: 0, daily_usage: 0, safety_stock: 120 },
  { facility_code: 'WH-HYD', product_sku: 'MED-INSULIN', qty_on_hand: 600, reserved_qty: 0, daily_usage: 0, safety_stock: 450 },
  // Hyderabad DC: 32 hours of rabies vaccine cover against a 48-hour inbound delay.
  { facility_code: 'WH-HYD', product_sku: 'MED-RABIES', qty_on_hand: 24, reserved_qty: 0, daily_usage: 18, safety_stock: 0 },
  // WH-HYD stocks Oncology Biologic for Manipal Hospital transfer (Visakhapatnam scenario) [SIMULATED]
  { facility_code: 'WH-HYD', product_sku: 'MED-ONCO', qty_on_hand: 240, reserved_qty: 0, daily_usage: 0, safety_stock: 120 },
  { facility_code: 'WH-MUM', product_sku: 'MED-INSULIN', qty_on_hand: 5000, reserved_qty: 0, daily_usage: 0, safety_stock: 0 },
  { facility_code: 'WH-DEL', product_sku: 'MED-INSULIN', qty_on_hand: 960, reserved_qty: 0, daily_usage: 0, safety_stock: 240 },
  // WH-DEL stocks Oncology Biologic (exceeds deadline for Manipal Hospital) [SIMULATED]
  { facility_code: 'WH-DEL', product_sku: 'MED-ONCO', qty_on_hand: 320, reserved_qty: 0, daily_usage: 0, safety_stock: 160 },
  { facility_code: 'HOS-DEL', product_sku: 'MED-INSULIN', qty_on_hand: 240, reserved_qty: 0, daily_usage: 120, safety_stock: 0 },
  // Kolkata DC stocks mRNA Vaccine for Kolkata Medical Centre transfer [SIMULATED]
  { facility_code: 'WH-KOL', product_sku: 'MED-MRNA', qty_on_hand: 800, reserved_qty: 0, daily_usage: 0, safety_stock: 200 },
  // Kolkata Medical Centre: mRNA Vaccine (18h cover < 24h delay -> at risk in Kolkata scenario) [SIMULATED]
  { facility_code: 'HOS-KOL', product_sku: 'MED-MRNA', qty_on_hand: 60, reserved_qty: 0, daily_usage: 80, safety_stock: 0 },
  // Pune DC stocks Plasma Derivatives for Pune Hospital transfer [SIMULATED]
  { facility_code: 'WH-PUN', product_sku: 'MED-PLASMA', qty_on_hand: 480, reserved_qty: 0, daily_usage: 0, safety_stock: 96 },
  // Pune recovery: 240 units reserved for its existing Mumbai shipment; remaining stock supports a safe 96-unit transfer.
  { facility_code: 'WH-MUM', product_sku: 'MED-PLASMA', qty_on_hand: 480, reserved_qty: 240, daily_usage: 0, safety_stock: 96 },
  // Pune Hospital: Plasma Derivatives (32h cover < 36h delay -> at risk in Mumbai scenario) [SIMULATED]
  { facility_code: 'HOS-PUN', product_sku: 'MED-PLASMA', qty_on_hand: 48, reserved_qty: 0, daily_usage: 36, safety_stock: 0 },
  // Manipal Hospital: Oncology Biologic (30h cover < 48h delay -> at risk in Visakhapatnam scenario) [SIMULATED]
  { facility_code: 'HOS-MAN', product_sku: 'MED-ONCO', qty_on_hand: 50, reserved_qty: 0, daily_usage: 40, safety_stock: 0 },
];

const carriers = [
  // ColdRoad Express: certified reefer fleet, guaranteed 2..8 C band.
  // cost = baseCost + costPerKm * distance ; eta = distance/speed + handling
  { code: 'CAR-ROAD', name: 'ColdRoad Express', mode: 'ROAD', cold_chain_certified: 1, min_temp: 2.0, max_temp: 8.0, base_cost: 320, cost_per_km: 2.60, avg_speed_kmh: 60, handling_hours: 1.0, telemetry_capable: 1, vehicle: 'BLR-CC-118' },
  // SkyFreight Cargo: air freight, NO active cold-chain certification,
  // no guaranteed temperature band, no live telemetry -> fails rule R1.
  { code: 'CAR-AIR', name: 'SkyFreight Cargo', mode: 'AIR', cold_chain_certified: 0, min_temp: null, max_temp: null, base_cost: 2800, cost_per_km: 1.40, avg_speed_kmh: 250, handling_hours: 4.0, telemetry_capable: 0, vehicle: '' },
  // [SIMULATED] EastCold Logistics: certified reefer fleet for eastern India routes.
  { code: 'CAR-EAST', name: 'EastCold Logistics', mode: 'ROAD', cold_chain_certified: 1, min_temp: 2.0, max_temp: 8.0, base_cost: 290, cost_per_km: 2.45, avg_speed_kmh: 55, handling_hours: 1.5, telemetry_capable: 1, vehicle: 'KOL-CC-042' },
  // [SIMULATED] WestCold Freight: certified reefer for western India routes.
  { code: 'CAR-WEST', name: 'WestCold Freight', mode: 'ROAD', cold_chain_certified: 1, min_temp: 2.0, max_temp: 8.0, base_cost: 350, cost_per_km: 2.70, avg_speed_kmh: 62, handling_hours: 1.0, telemetry_capable: 1, vehicle: 'MUM-CC-077' },
];

const lanes = [
  { id: 1, origin_code: 'WH-BLR', destination_code: 'HOS-STM', mode: 'ROAD', distance_km: 300, carrier_code: 'CAR-ROAD' }, // 320 + 2.6*300 = 1100 USD ; 300/60 + 1 = 6.0 h
  { id: 2, origin_code: 'WH-HYD', destination_code: 'HOS-STM', mode: 'ROAD', distance_km: 570, carrier_code: 'CAR-ROAD' },
  { id: 3, origin_code: 'WH-MUM', destination_code: 'HOS-STM', mode: 'AIR', distance_km: 1000, carrier_code: 'CAR-AIR' },   // 2800 + 1.4*1000 = 4200 USD ; 1000/250 + 4 = 8.0 h
  { id: 4, origin_code: 'WH-DEL', destination_code: 'HOS-DEL', mode: 'ROAD', distance_km: 35, carrier_code: 'CAR-ROAD' },
  { id: 5, origin_code: 'WH-KOL', destination_code: 'HOS-KOL', mode: 'ROAD', distance_km: 28, carrier_code: 'CAR-EAST' },
  { id: 6, origin_code: 'WH-PUN', destination_code: 'HOS-PUN', mode: 'ROAD', distance_km: 22, carrier_code: 'CAR-ROAD' },
  { id: 7, origin_code: 'WH-DEL', destination_code: 'HOS-MAN', mode: 'ROAD', distance_km: 2150, carrier_code: 'CAR-ROAD' },
  { id: 8, origin_code: 'WH-KOL', destination_code: 'HOS-APO', mode: 'ROAD', distance_km: 1450, carrier_code: 'CAR-EAST' },
  { id: 9, origin_code: 'WH-PUN', destination_code: 'HOS-APO', mode: 'ROAD', distance_km: 840, carrier_code: 'CAR-WEST' },
  // [SIMULATED] Mumbai disruption air alternative: Mumbai Hub -> Pune Hospital (air, fails R1)
  { id: 10, origin_code: 'WH-MUM', destination_code: 'HOS-PUN', mode: 'AIR', distance_km: 150, carrier_code: 'CAR-AIR' },
  // [SIMULATED] Kolkata disruption alternative: Hyderabad DC -> Kolkata Medical Centre (road, fails R3 deadline)
  { id: 11, origin_code: 'WH-HYD', destination_code: 'HOS-KOL', mode: 'ROAD', distance_km: 1410, carrier_code: 'CAR-EAST' },
  // [SIMULATED] Visakhapatnam disruption alternative: Hyderabad DC -> Manipal Hospital (road, recommended)
  { id: 12, origin_code: 'WH-HYD', destination_code: 'HOS-MAN', mode: 'ROAD', distance_km: 570, carrier_code: 'CAR-ROAD' },
];

// S/4HANA-shaped purchase orders (EBELN). SIMULATED master data.
const purchaseOrders = [
  // --- Chennai Port (INMAA) ---
  { ebeln: 'PO-88314', supplier_name: 'MedPharma Ltd', product_sku: 'MED-INSULIN', destination_code: 'HOS-STM', qty: 2000, port: 'INMAA', status: 'IN_TRANSIT', eta: '2026-11-06' },
  { ebeln: 'PO-88321', supplier_name: 'VaxCare Pvt Ltd', product_sku: 'MED-MRNA', destination_code: 'HOS-APO', qty: 1500, port: 'INMAA', status: 'IN_TRANSIT', eta: '2026-11-05' },
  { ebeln: 'PO-88298', supplier_name: 'PlasmaSource India', product_sku: 'MED-PLASMA', destination_code: 'HOS-CITY', qty: 300, port: 'INHYD', status: 'IN_TRANSIT', eta: '2026-11-04' },
  { ebeln: 'PO-88342', supplier_name: 'OncoMed Distributors', product_sku: 'MED-ONCO', destination_code: 'WH-BLR', qty: 500, port: 'INBOM', status: 'IN_TRANSIT', eta: '2026-11-04' },
  { ebeln: 'PO-88350', supplier_name: 'VaxCare Pvt Ltd', product_sku: 'MED-RABIES', destination_code: 'HOS-MAN', qty: 400, port: 'INBOM', status: 'IN_TRANSIT', eta: '2026-11-04' },
  { ebeln: 'PO-88401', supplier_name: 'MedPharma Ltd', product_sku: 'MED-INSULIN', destination_code: 'HOS-DEL', qty: 600, port: 'INDEL', status: 'IN_TRANSIT', eta: '2026-11-06' },
  { ebeln: 'PO-88402', supplier_name: 'VaxCare Pvt Ltd', product_sku: 'MED-MRNA', destination_code: 'HOS-KOL', qty: 400, port: 'INKOL', status: 'IN_TRANSIT', eta: '2026-11-06' },
  { ebeln: 'PO-88403', supplier_name: 'PlasmaSource India', product_sku: 'MED-PLASMA', destination_code: 'HOS-PUN', qty: 240, port: 'INPUN', status: 'IN_TRANSIT', eta: '2026-11-06' },
  // [SIMULATED] Mumbai Port (INBOM) — Plasma Derivatives to Pune Hospital, delayed by flood
  { ebeln: 'PO-88410', supplier_name: 'PlasmaSource India', product_sku: 'MED-PLASMA', destination_code: 'HOS-PUN', qty: 240, port: 'INBOM', status: 'IN_TRANSIT', eta: '2026-11-07' },
  // [SIMULATED] Visakhapatnam Port (INVIZ) — Oncology Biologic to Manipal Hospital, delayed by cyclone
  { ebeln: 'PO-88412', supplier_name: 'OncoMed Distributors', product_sku: 'MED-ONCO', destination_code: 'HOS-MAN', qty: 200, port: 'INVIZ', status: 'IN_TRANSIT', eta: '2026-11-07' },
];

// eta_text mirrors the UI; delay_hours drives calculations.
const shipments = [
  { id: 'SS-2048', po_ebeln: 'PO-88314', product_sku: 'MED-INSULIN', batch: 'IN-84A29', origin_code: 'PORT-MAA', origin_label: 'Chennai Port', destination_code: 'HOS-STM', destination_label: 'St. Martha Hospital', route: 'NH48 / Bengaluru', status: 'Disrupted', risk: 'Critical', delay_hours: 48, eta_text: '48h delayed', current_temp: 4.2 },
  { id: 'SS-2051', po_ebeln: 'PO-88321', product_sku: 'MED-MRNA', batch: 'VX-112C', origin_code: 'PORT-MAA', origin_label: 'Chennai Port', destination_code: 'HOS-APO', destination_label: 'Apollo Central', route: 'NH48 / Bengaluru', status: 'Monitoring', risk: 'Medium', delay_hours: 0, eta_text: '12h 10m', current_temp: 3.8 },
  { id: 'SS-2056', po_ebeln: 'PO-88298', product_sku: 'MED-PLASMA', batch: 'PL-49F7', origin_code: 'WH-HYD', origin_label: 'Hyderabad DC', destination_code: 'HOS-CITY', destination_label: 'City Care Network', route: 'NH44 South', status: 'Monitoring', risk: 'Medium', delay_hours: 0, eta_text: '6h 20m', current_temp: 5.1 },
  { id: 'SS-2060', po_ebeln: 'PO-88342', product_sku: 'MED-ONCO', batch: 'ON-225D', origin_code: 'WH-MUM', origin_label: 'Mumbai Hub', destination_code: 'WH-BLR', destination_label: 'Bengaluru MedHub', route: 'NH48 South', status: 'On track', risk: 'Low', delay_hours: 0, eta_text: '11h 45m', current_temp: 4.7 },
  { id: 'SS-2063', po_ebeln: 'PO-88350', product_sku: 'MED-RABIES', batch: 'RV-71B3', origin_code: 'WH-MUM', origin_label: 'Mumbai Hub', destination_code: 'HOS-MAN', destination_label: 'Manipal Hospital', route: 'Air / BLR', status: 'On track', risk: 'Low', delay_hours: 0, eta_text: '4h 15m', current_temp: 3.9 },
  { id: 'SS-2070', po_ebeln: 'PO-88401', product_sku: 'MED-INSULIN', batch: 'IN-84A29', origin_code: 'WH-DEL', origin_label: 'Delhi NCR Distribution Centre', destination_code: 'HOS-DEL', destination_label: 'Delhi NCR Hospital', route: 'Delhi NCR cold-chain lane', status: 'Monitoring', risk: 'Medium', delay_hours: 0, eta_text: '2026-11-06', current_temp: 4.4 },
  { id: 'SS-2071', po_ebeln: 'PO-88402', product_sku: 'MED-MRNA', batch: 'VX-112C', origin_code: 'PORT-KOL', origin_label: 'Kolkata Port', destination_code: 'HOS-KOL', destination_label: 'Kolkata Medical Centre', route: 'NH12 / Kolkata', status: 'Disrupted', risk: 'Critical', delay_hours: 24, eta_text: '24h delayed', current_temp: 4.1 },
  { id: 'SS-2072', po_ebeln: 'PO-88403', product_sku: 'MED-PLASMA', batch: 'PL-49F7', origin_code: 'WH-PUN', origin_label: 'Pune Distribution Centre', destination_code: 'HOS-PUN', destination_label: 'Pune Hospital', route: 'Pune cold-chain lane', status: 'Monitoring', risk: 'Medium', delay_hours: 0, eta_text: '2026-11-06', current_temp: 4.8 },
  // [SIMULATED] Mumbai Port flood — Plasma Derivatives delayed to Pune Hospital
  { id: 'SS-2080', po_ebeln: 'PO-88410', product_sku: 'MED-PLASMA', batch: 'PL-49F7', origin_code: 'PORT-BOM', origin_label: 'Mumbai Port', destination_code: 'HOS-PUN', destination_label: 'Pune Hospital', route: 'Mumbai-Pune Expressway', status: 'Disrupted', risk: 'Critical', delay_hours: 36, eta_text: '36h delayed', current_temp: 4.0 },
  // [SIMULATED] Visakhapatnam Port cyclone — Oncology Biologic delayed to Manipal Hospital
  { id: 'SS-2082', po_ebeln: 'PO-88412', product_sku: 'MED-ONCO', batch: 'ON-225D', origin_code: 'PORT-VIZ', origin_label: 'Visakhapatnam Port', destination_code: 'HOS-MAN', destination_label: 'Manipal Hospital', route: 'NH16 / Bengaluru', status: 'Disrupted', risk: 'Critical', delay_hours: 48, eta_text: '48h delayed', current_temp: 4.6 },
];

// Demo telemetry for every shipment: 5 hourly readings, all inside 2..8 C.
const shipmentReadings = {
  'SS-2048': [4.1, 4.3, 4.2, 4.5, 4.2],
  'SS-2051': [3.7, 3.9, 4.1, 3.8, 3.8],
  'SS-2056': [5.0, 5.2, 5.1, 5.0, 5.1],
  'SS-2060': [4.5, 4.6, 4.8, 4.7, 4.7],
  'SS-2063': [3.8, 3.9, 4.0, 3.9, 3.9],
  'SS-2070': [4.3, 4.4, 4.5, 4.4, 4.4],
  'SS-2071': [4.0, 4.1, 4.2, 4.1, 4.1],
  'SS-2072': [4.7, 4.8, 4.9, 4.8, 4.8],
  // [SIMULATED] Multi-port disruption shipments
  'SS-2080': [3.9, 4.0, 4.1, 4.0, 4.0],
  'SS-2081': [4.2, 4.3, 4.3, 4.4, 4.3],
  'SS-2082': [4.5, 4.6, 4.6, 4.7, 4.6],
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
  {
    id: 'INC-2026-1104-04', type: 'PORT_CONGESTION', title: 'PORT CONGESTION — KOLKATA',
    port: 'INKOL', severity: 'MEDIUM',
    description: 'Simulated berth congestion may delay the linked Kolkata-bound cold-chain purchase order; no live port feed is configured.',
    status: 'MONITORING', radius_km: 30, wind_kmh: null, expected_delay_hours: 24,
    affected_shipments: 1, affected_pos: 1, verified: 0, source: 'Synthetic scenario assumption',
    created_at: '2026-11-04T17:11:00+05:30',
  },
  {
    id: 'INC-2026-1104-05', type: 'DEMAND_SURGE', title: 'DEMAND SURGE — DELHI NCR',
    port: 'INDEL', severity: 'HIGH',
    description: 'Synthetic demand-surge scenario linked to Delhi NCR insulin inventory; the incident timeline records consumption 40% above baseline.',
    status: 'MONITORING', radius_km: null, wind_kmh: null, expected_delay_hours: 24,
    affected_shipments: 1, affected_pos: 1, verified: 0, source: 'Synthetic scenario assumption; 40% demand increase recorded in incident timeline',
    created_at: '2026-11-04T17:11:00+05:30',
  },
  {
    id: 'INC-2026-1104-06', type: 'POWER_OUTAGE', title: 'FACILITY POWER OUTAGE — PUNE',
    port: 'INPUN', severity: 'HIGH',
    description: 'Synthetic facility power-outage scenario linked to Pune plasma inventory and inbound shipment. No outage duration or facility backup-power telemetry is available.',
    status: 'MONITORING', radius_km: null, wind_kmh: null, expected_delay_hours: 24,
    affected_shipments: 1, affected_pos: 1, verified: 0, source: 'Synthetic scenario assumption; facility telemetry unavailable',
    created_at: '2026-11-04T17:11:00+05:30',
  },
  {
    id: 'INC-2026-1104-07', type: 'EXTREME_WEATHER', title: 'EXTREME WEATHER — MUMBAI',
    port: 'INBOM', severity: 'MEDIUM',
    description: 'Synthetic extreme-weather advisory is associated with Mumbai-origin shipments. It is not a verified operating restriction.',
    status: 'MONITORING', radius_km: 60, wind_kmh: null, expected_delay_hours: 12,
    affected_shipments: 2, affected_pos: 2, verified: 0, source: 'Synthetic scenario assumption; not externally verified',
    created_at: '2026-11-04T17:11:00+05:30',
  },
  // [SIMULATED] Mumbai Port flood closure — mRNA Vaccine supply disrupted
  {
    id: 'INC-2026-1104-08', type: 'FLOOD', title: 'FLOOD — MUMBAI PORT CLOSURE',
    port: 'INBOM', severity: 'HIGH',
    description: 'Severe flooding has suspended gate and berth operations at Mumbai Port. Medical cold-chain containers with mRNA Vaccine consignments are held at the port complex. (SIMULATED ALERT)',
    status: 'ACTIVE', radius_km: 90, wind_kmh: null, expected_delay_hours: 36,
    affected_shipments: 3, affected_pos: 5,
    verified: 1, source: 'Port authority operational bulletin (SIMULATED FEED)',
    created_at: '2026-11-04T18:00:00+05:30',
  },
  // [SIMULATED] Kolkata Port berth congestion — mRNA Vaccine supply disrupted
  {
    id: 'INC-2026-1104-09', type: 'PORT_CONGESTION', title: 'BERTH CONGESTION — KOLKATA PORT',
    port: 'INKOL', severity: 'MEDIUM',
    description: 'Severe berth congestion at Kolkata Port has delayed cold-chain container unloading. mRNA Vaccine consignments for Kolkata Medical Centre are held pending berth allocation. (SIMULATED ALERT)',
    status: 'ACTIVE', radius_km: 35, wind_kmh: null, expected_delay_hours: 24,
    affected_shipments: 2, affected_pos: 3,
    verified: 1, source: 'Port authority operational bulletin (SIMULATED FEED)',
    created_at: '2026-11-04T18:30:00+05:30',
  },
  // [SIMULATED] Visakhapatnam Port cyclone — Oncology Biologic supply disrupted
  {
    id: 'INC-2026-1104-10', type: 'CYCLONE', title: 'CYCLONE — VISAKHAPATNAM PORT CLOSURE',
    port: 'INVIZ', severity: 'HIGH',
    description: 'Cyclone Nilam has suspended all marine and gate operations at Visakhapatnam Port. Oncology Biologic consignments destined for Manipal Hospital are held at the port complex. (SIMULATED ALERT)',
    status: 'ACTIVE', radius_km: 150, wind_kmh: 118, expected_delay_hours: 48,
    affected_shipments: 2, affected_pos: 3,
    verified: 1, source: 'Port authority operational bulletin (SIMULATED FEED)',
    created_at: '2026-11-04T19:00:00+05:30',
  },
];

const disruptionTimeline = [
  // Chennai Port — INC-2026-1104-03
  { disruption_id: 'INC-2026-1104-03', ts: '15:10', title: 'Weather alert elevated', text: 'Cyclone path updated toward northern Tamil Nadu coast.', state: 'done' },
  { disruption_id: 'INC-2026-1104-03', ts: '16:22', title: 'Port authority restriction', text: 'Inbound container movement limited; berth operations paused.', state: 'done' },
  { disruption_id: 'INC-2026-1104-03', ts: '17:06', title: 'Full port closure confirmed', text: 'All marine and gate operations suspended for 48 hours.', state: 'critical' },
  { disruption_id: 'INC-2026-1104-03', ts: '17:11', title: 'SupplyShield event created', text: 'Network impact correlation started automatically.', state: 'active' },
  // Mumbai Heavy Rain — INC-2026-1104-01 (SIMULATED)
  { disruption_id: 'INC-2026-1104-01', ts: '09:00', title: 'Heavy rain advisory issued', text: 'IMD issues heavy-rain warning for Mumbai and surrounding coastal districts.', state: 'done' },
  { disruption_id: 'INC-2026-1104-01', ts: '09:40', title: 'Port berth delays reported', text: 'Berth allocation delayed; inbound container trucks queuing outside gate.', state: 'done' },
  { disruption_id: 'INC-2026-1104-01', ts: '10:15', title: 'SupplyShield event created', text: 'Monitoring mode activated for Mumbai Port berth delays. (SIMULATED)', state: 'active' },
  // Hyderabad Fog — INC-2026-1104-02 (SIMULATED)
  { disruption_id: 'INC-2026-1104-02', ts: '05:30', title: 'Dense fog advisory issued', text: 'METAR reports visibility below 300 m at Hyderabad Rajiv Gandhi International Airport.', state: 'done' },
  { disruption_id: 'INC-2026-1104-02', ts: '06:15', title: 'Air cargo ramp suspended', text: 'Cargo ramp operations temporarily suspended; flights on ground-stop until 08:00.', state: 'done' },
  { disruption_id: 'INC-2026-1104-02', ts: '06:40', title: 'SupplyShield event created', text: 'Low-severity air-cargo delay monitoring started for Hyderabad. (SIMULATED)', state: 'active' },
  // Kolkata Port Congestion — INC-2026-1104-04 (SIMULATED)
  { disruption_id: 'INC-2026-1104-04', ts: '14:00', title: 'Berth backlog identified', text: 'Vessel queue at Kolkata Port exceeds 12 ships; berth allocation delayed.', state: 'done' },
  { disruption_id: 'INC-2026-1104-04', ts: '15:30', title: 'Cold-chain container dwell', text: 'Reefer containers exceed 24-hour dwell time threshold at the container terminal.', state: 'done' },
  { disruption_id: 'INC-2026-1104-04', ts: '17:11', title: 'SupplyShield event created', text: 'Monitoring mode activated; mRNA Vaccine shipment delay flagged. (SIMULATED)', state: 'active' },
  // Delhi NCR Demand Surge — INC-2026-1104-05 (SIMULATED)
  { disruption_id: 'INC-2026-1104-05', ts: '08:00', title: 'Demand surge detected', text: 'Delhi NCR insulin consumption 40% above weekly baseline; stockout risk flagged.', state: 'done' },
  { disruption_id: 'INC-2026-1104-05', ts: '10:30', title: 'Warehouse depletion warning', text: 'WH-DEL safety-stock threshold breached; replenishment lead time insufficient.', state: 'done' },
  { disruption_id: 'INC-2026-1104-05', ts: '17:11', title: 'SupplyShield event created', text: 'Impact analysis triggered for Delhi NCR insulin shortage. (SIMULATED)', state: 'active' },
  // Pune Power Outage — INC-2026-1104-06 (SIMULATED)
  { disruption_id: 'INC-2026-1104-06', ts: '11:00', title: 'Power outage reported', text: 'Facility management reports grid failure at Pune DC; backup generator online.', state: 'done' },
  { disruption_id: 'INC-2026-1104-06', ts: '12:15', title: 'Cold-room temperature rise', text: 'Cold-room temperature rising; plasma storage at risk if outage exceeds 4 hours.', state: 'done' },
  { disruption_id: 'INC-2026-1104-06', ts: '17:11', title: 'SupplyShield event created', text: 'High-severity cold-chain integrity alert raised for Pune facility. (SIMULATED)', state: 'critical' },
  // Mumbai Extreme Weather — INC-2026-1104-07 (SIMULATED)
  { disruption_id: 'INC-2026-1104-07', ts: '13:00', title: 'Extreme weather advisory', text: 'Gale-force winds and thunderstorms forecast for Mumbai; logistics on alert.', state: 'done' },
  { disruption_id: 'INC-2026-1104-07', ts: '14:00', title: 'Road route congestion', text: 'NH48 accident-related congestion; estimated 6-hour road freight delay.', state: 'done' },
  { disruption_id: 'INC-2026-1104-07', ts: '17:11', title: 'SupplyShield event created', text: 'Monitoring mode activated for Mumbai-origin cold-chain shipments. (SIMULATED)', state: 'active' },
  // [SIMULATED] Mumbai Port flood timeline
  { disruption_id: 'INC-2026-1104-08', ts: '16:30', title: 'Flood warning issued', text: 'Heavy rainfall forecast for Mumbai coastal zone; port operations on alert.', state: 'done' },
  { disruption_id: 'INC-2026-1104-08', ts: '17:45', title: 'Gate operations suspended', text: 'Inbound truck access blocked; berth loading paused due to flooding.', state: 'done' },
  { disruption_id: 'INC-2026-1104-08', ts: '18:00', title: 'Full port closure confirmed', text: 'All marine and gate operations suspended for 36 hours. (SIMULATED)', state: 'critical' },
  { disruption_id: 'INC-2026-1104-08', ts: '18:05', title: 'SupplyShield event created', text: 'mRNA Vaccine supply impact correlation started.', state: 'active' },
  // [SIMULATED] Kolkata Port congestion timeline
  { disruption_id: 'INC-2026-1104-09', ts: '17:00', title: 'Berth congestion reported', text: 'Multiple vessels awaiting berth allocation; delays anticipated.', state: 'done' },
  { disruption_id: 'INC-2026-1104-09', ts: '18:00', title: 'Container unloading halted', text: 'Cold-chain container queue exceeds yard capacity; unloading paused.', state: 'done' },
  { disruption_id: 'INC-2026-1104-09', ts: '18:30', title: 'Port congestion confirmed', text: 'Official delay notification issued for 24 hours. (SIMULATED)', state: 'critical' },
  { disruption_id: 'INC-2026-1104-09', ts: '18:35', title: 'SupplyShield event created', text: 'mRNA Vaccine impact correlation started for Kolkata Medical Centre.', state: 'active' },
  // [SIMULATED] Visakhapatnam Port cyclone timeline
  { disruption_id: 'INC-2026-1104-10', ts: '16:00', title: 'Cyclone warning issued', text: 'Cyclone Nilam approaching Andhra Pradesh coast; port on alert.', state: 'done' },
  { disruption_id: 'INC-2026-1104-10', ts: '17:30', title: 'Port authority restriction', text: 'Vessel movements restricted; container handling suspended.', state: 'done' },
  { disruption_id: 'INC-2026-1104-10', ts: '19:00', title: 'Full port closure confirmed', text: 'All marine and gate operations suspended for 48 hours. (SIMULATED)', state: 'critical' },
  { disruption_id: 'INC-2026-1104-10', ts: '19:05', title: 'SupplyShield event created', text: 'Oncology Biologic supply impact correlation started.', state: 'active' },
];

const infrastructureStatus = [
  // Chennai Port — INC-2026-1104-03
  { disruption_id: 'INC-2026-1104-03', label: 'Port operations', status: 'CLOSED', tone: 'critical', icon: 'box' },
  { disruption_id: 'INC-2026-1104-03', label: 'NH16 coastal corridor', status: 'RESTRICTED', tone: 'warning', icon: 'route' },
  { disruption_id: 'INC-2026-1104-03', label: 'Chennai air cargo', status: 'OPERATIONAL', tone: 'success', icon: 'truck' },
  { disruption_id: 'INC-2026-1104-03', label: 'Rail freight terminal', status: 'MONITORING', tone: 'warning', icon: 'inventory' },
  // Mumbai Heavy Rain — INC-2026-1104-01 (SIMULATED)
  { disruption_id: 'INC-2026-1104-01', label: 'Mumbai Port berths', status: 'DELAYED', tone: 'warning', icon: 'box' },
  { disruption_id: 'INC-2026-1104-01', label: 'NH48 coastal corridor', status: 'CONGESTED', tone: 'warning', icon: 'route' },
  { disruption_id: 'INC-2026-1104-01', label: 'Mumbai air cargo', status: 'OPERATIONAL', tone: 'success', icon: 'truck' },
  { disruption_id: 'INC-2026-1104-01', label: 'Rail freight terminal', status: 'OPERATIONAL', tone: 'success', icon: 'inventory' },
  // Hyderabad Fog — INC-2026-1104-02 (SIMULATED)
  { disruption_id: 'INC-2026-1104-02', label: 'Hyderabad air cargo ramp', status: 'SUSPENDED', tone: 'critical', icon: 'truck' },
  { disruption_id: 'INC-2026-1104-02', label: 'Outer Ring Road access', status: 'OPERATIONAL', tone: 'success', icon: 'route' },
  { disruption_id: 'INC-2026-1104-02', label: 'Road freight routes', status: 'OPERATIONAL', tone: 'success', icon: 'box' },
  { disruption_id: 'INC-2026-1104-02', label: 'Hyderabad DC cold storage', status: 'MONITORING', tone: 'warning', icon: 'inventory' },
  // Kolkata Port Congestion — INC-2026-1104-04 (SIMULATED)
  { disruption_id: 'INC-2026-1104-04', label: 'Berth operations', status: 'CONGESTED', tone: 'warning', icon: 'box' },
  { disruption_id: 'INC-2026-1104-04', label: 'Port gate access', status: 'RESTRICTED', tone: 'warning', icon: 'route' },
  { disruption_id: 'INC-2026-1104-04', label: 'Kolkata air cargo', status: 'OPERATIONAL', tone: 'success', icon: 'truck' },
  { disruption_id: 'INC-2026-1104-04', label: 'Kolkata rail hub', status: 'OPERATIONAL', tone: 'success', icon: 'inventory' },
  // Delhi NCR Demand Surge — INC-2026-1104-05 (SIMULATED)
  { disruption_id: 'INC-2026-1104-05', label: 'WH-DEL cold storage', status: 'LOW STOCK', tone: 'critical', icon: 'inventory' },
  { disruption_id: 'INC-2026-1104-05', label: 'NH48 road corridor', status: 'OPERATIONAL', tone: 'success', icon: 'route' },
  { disruption_id: 'INC-2026-1104-05', label: 'Delhi air cargo', status: 'OPERATIONAL', tone: 'success', icon: 'truck' },
  { disruption_id: 'INC-2026-1104-05', label: 'Replenishment pipeline', status: 'INSUFFICIENT', tone: 'warning', icon: 'box' },
  // Pune Power Outage — INC-2026-1104-06 (SIMULATED)
  { disruption_id: 'INC-2026-1104-06', label: 'Pune DC cold storage', status: 'AT RISK', tone: 'critical', icon: 'inventory' },
  { disruption_id: 'INC-2026-1104-06', label: 'Facility power supply', status: 'OUTAGE', tone: 'critical', icon: 'box' },
  { disruption_id: 'INC-2026-1104-06', label: 'NH48 Pune road access', status: 'OPERATIONAL', tone: 'success', icon: 'route' },
  { disruption_id: 'INC-2026-1104-06', label: 'Pune air cargo', status: 'OPERATIONAL', tone: 'success', icon: 'truck' },
  // Mumbai Extreme Weather — INC-2026-1104-07 (SIMULATED)
  { disruption_id: 'INC-2026-1104-07', label: 'NH48 road corridor', status: 'CONGESTED', tone: 'warning', icon: 'route' },
  { disruption_id: 'INC-2026-1104-07', label: 'Mumbai air cargo', status: 'MONITORING', tone: 'warning', icon: 'truck' },
  { disruption_id: 'INC-2026-1104-07', label: 'Mumbai Port berths', status: 'MONITORING', tone: 'warning', icon: 'box' },
  { disruption_id: 'INC-2026-1104-07', label: 'Rail freight hub', status: 'OPERATIONAL', tone: 'success', icon: 'inventory' },
  // [SIMULATED] Mumbai Port flood infrastructure status
  { disruption_id: 'INC-2026-1104-08', label: 'Port operations', status: 'CLOSED', tone: 'critical', icon: 'box' },
  { disruption_id: 'INC-2026-1104-08', label: 'NH48 coastal access', status: 'RESTRICTED', tone: 'warning', icon: 'route' },
  { disruption_id: 'INC-2026-1104-08', label: 'Mumbai air cargo', status: 'OPERATIONAL', tone: 'success', icon: 'truck' },
  { disruption_id: 'INC-2026-1104-08', label: 'Mumbai rail freight', status: 'MONITORING', tone: 'warning', icon: 'inventory' },
  // [SIMULATED] Kolkata Port congestion infrastructure status
  { disruption_id: 'INC-2026-1104-09', label: 'Berth operations', status: 'CONGESTED', tone: 'warning', icon: 'box' },
  { disruption_id: 'INC-2026-1104-09', label: 'Port gate access', status: 'RESTRICTED', tone: 'warning', icon: 'route' },
  { disruption_id: 'INC-2026-1104-09', label: 'Kolkata air cargo', status: 'OPERATIONAL', tone: 'success', icon: 'truck' },
  { disruption_id: 'INC-2026-1104-09', label: 'Kolkata rail hub', status: 'OPERATIONAL', tone: 'success', icon: 'inventory' },
  // [SIMULATED] Visakhapatnam Port cyclone infrastructure status
  { disruption_id: 'INC-2026-1104-10', label: 'Port operations', status: 'CLOSED', tone: 'critical', icon: 'box' },
  { disruption_id: 'INC-2026-1104-10', label: 'NH16 Vizag corridor', status: 'CLOSED', tone: 'critical', icon: 'route' },
  { disruption_id: 'INC-2026-1104-10', label: 'Vizag air cargo', status: 'SUSPENDED', tone: 'critical', icon: 'truck' },
  { disruption_id: 'INC-2026-1104-10', label: 'Rail freight terminal', status: 'MONITORING', tone: 'warning', icon: 'inventory' },
];

const alerts = [
  { severity: 'CRITICAL', location: 'Chennai Port', medicine: 'Human Insulin', message: 'Port operations suspended due to Cyclone Varun', ago: '18 min ago' },
  { severity: 'HIGH', location: 'St. Martha Hospital', medicine: 'Human Insulin', message: 'Stock cover below 30-hour safety threshold', ago: '12 min ago' },
  { severity: 'CRITICAL', location: 'Mumbai Port', medicine: 'mRNA Vaccine', message: 'Port operations suspended due to flooding (SIMULATED)', ago: '5 min ago' },
  { severity: 'HIGH', location: 'Visakhapatnam Port', medicine: 'Oncology Biologic', message: 'Port closure due to Cyclone Nilam (SIMULATED)', ago: '1 min ago' },
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

// Port catalogue — used by the UI port selector and the /api/ports endpoint.
// Each entry maps a port code to its geographical position and the primary
// disruption that demos the port scenario. (SIMULATED DATA)
const portCatalogue = [
  {
    code: 'INMAA', name: 'Chennai Port', city: 'Chennai',
    lat: 13.0827, lng: 80.2707,
    facilityCode: 'PORT-MAA',
    primaryDisruptionId: 'INC-2026-1104-03',
    defaultDisruptionType: 'CYCLONE',
    description: 'Cyclone Varun — 48h closure (canonical demo scenario)',
  },
  {
    code: 'INBOM', name: 'Mumbai Port', city: 'Mumbai',
    lat: 18.9220, lng: 72.8347,
    facilityCode: 'PORT-BOM',
    primaryDisruptionId: 'INC-2026-1104-08',
    defaultDisruptionType: 'FLOOD',
    description: 'Flood — 36h closure (SIMULATED)',
  },
  {
    code: 'INKOL', name: 'Kolkata Port', city: 'Kolkata',
    lat: 22.5726, lng: 88.3122,
    facilityCode: 'PORT-KOL',
    primaryDisruptionId: 'INC-2026-1104-09',
    defaultDisruptionType: 'PORT_CONGESTION',
    description: 'Berth congestion — 24h delay (SIMULATED)',
  },
  {
    code: 'INVIZ', name: 'Visakhapatnam Port', city: 'Visakhapatnam',
    lat: 17.6868, lng: 83.2185,
    facilityCode: 'PORT-VIZ',
    primaryDisruptionId: 'INC-2026-1104-10',
    defaultDisruptionType: 'CYCLONE',
    description: 'Cyclone Nilam — 48h closure (SIMULATED)',
  },
];

module.exports = {
  DEMO_RUN, medicines, facilities, inventory, carriers, lanes,
  purchaseOrders, shipments, shipmentReadings, insulinTelemetry,
  disruptions, disruptionTimeline, infrastructureStatus, alerts,
  networkStats, policy, portCatalogue,
};
