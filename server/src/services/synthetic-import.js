const fs = require('node:fs/promises');
const path = require('node:path');

const OUTPUT_DIR = path.resolve(__dirname, '..', '..', '..', 'synthetic-data', 'output');

// These are the existing SQLite/HANA runtime tables; generated-only datasets
// without a matching business entity deliberately remain CSV-only.
const TABLES = [
  {
    name: 'medicines',
    keys: ['sku'],
    columns: ['sku', 'name', 'min_temp', 'max_temp', 'unit', 'case_size', 'unit_cost', 'batch', 'manufactured', 'expiry', 'gdp_class'],
    required: ['sku', 'name', 'min_temp', 'max_temp', 'unit', 'case_size'],
    numeric: ['min_temp', 'max_temp', 'case_size', 'unit_cost'],
  },
  {
    name: 'facilities',
    keys: ['code'],
    columns: ['code', 'name', 'city', 'type', 'priority', 'ward', 'storage_loc'],
    required: ['code', 'name', 'type'],
    numeric: [],
  },
  {
    name: 'carriers',
    keys: ['code'],
    columns: ['code', 'name', 'mode', 'cold_chain_certified', 'min_temp', 'max_temp', 'base_cost', 'cost_per_km', 'avg_speed_kmh', 'handling_hours', 'telemetry_capable', 'vehicle'],
    required: ['code', 'name', 'mode', 'cold_chain_certified', 'base_cost', 'cost_per_km', 'avg_speed_kmh', 'handling_hours', 'telemetry_capable'],
    numeric: ['cold_chain_certified', 'min_temp', 'max_temp', 'base_cost', 'cost_per_km', 'avg_speed_kmh', 'handling_hours', 'telemetry_capable'],
  },
  {
    name: 'inventory',
    keys: ['facility_code', 'product_sku'],
    columns: ['facility_code', 'product_sku', 'qty_on_hand', 'reserved_qty', 'daily_usage', 'safety_stock'],
    required: ['facility_code', 'product_sku', 'qty_on_hand', 'reserved_qty', 'daily_usage', 'safety_stock'],
    numeric: ['qty_on_hand', 'reserved_qty', 'daily_usage', 'safety_stock'],
  },
  {
    name: 'lanes',
    keys: ['id'],
    columns: ['id', 'origin_code', 'destination_code', 'mode', 'distance_km', 'carrier_code'],
    required: ['id', 'origin_code', 'destination_code', 'mode', 'distance_km', 'carrier_code'],
    numeric: ['id', 'distance_km'],
  },
  {
    name: 'purchase_orders',
    keys: ['ebeln'],
    columns: ['ebeln', 'supplier_name', 'product_sku', 'destination_code', 'qty', 'port', 'status', 'eta'],
    required: ['ebeln', 'product_sku', 'destination_code', 'qty', 'status'],
    numeric: ['qty'],
  },
  {
    name: 'shipments',
    keys: ['id'],
    columns: ['id', 'po_ebeln', 'product_sku', 'batch', 'origin_code', 'origin_label', 'destination_code', 'destination_label', 'route', 'status', 'risk', 'delay_hours', 'eta_text', 'current_temp'],
    required: ['id', 'product_sku', 'destination_code', 'status', 'risk', 'delay_hours'],
    numeric: ['delay_hours', 'current_temp'],
  },
  {
    name: 'disruptions',
    keys: ['id'],
    columns: ['id', 'type', 'title', 'port', 'severity', 'description', 'status', 'radius_km', 'wind_kmh', 'expected_delay_hours', 'affected_shipments', 'affected_pos', 'verified', 'source', 'created_at'],
    required: ['id', 'type', 'title', 'severity', 'status', 'expected_delay_hours', 'verified'],
    numeric: ['radius_km', 'wind_kmh', 'expected_delay_hours', 'affected_shipments', 'affected_pos', 'verified'],
  },
  {
    name: 'temperature_readings',
    keys: ['id'],
    columns: ['id', 'shipment_id', 'batch', 'ts', 'temp_c'],
    required: ['id', 'shipment_id', 'ts', 'temp_c'],
    numeric: ['id', 'temp_c'],
  },
  {
    name: 'shipment_tracking',
    keys: ['tracking_id'],
    columns: ['tracking_id', 'shipment_id', 'ts', 'latitude', 'longitude', 'location', 'status', 'delay_hours'],
    required: ['tracking_id', 'shipment_id', 'ts', 'status', 'delay_hours'],
    numeric: ['latitude', 'longitude', 'delay_hours'],
  },
];

function parseCsv(text, fileName) {
  const source = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const character = source[i];
    if (quoted) {
      if (character === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error(`${fileName}: unterminated quoted CSV field`);
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ''));
    if (row.some((value) => value !== '')) rows.push(row);
  }
  if (!rows.length) throw new Error(`${fileName}: CSV is empty`);
  const headers = rows[0];
  if (new Set(headers).size !== headers.length) throw new Error(`${fileName}: duplicate CSV column`);
  return rows.slice(1).map((values, index) => {
    if (values.length !== headers.length) {
      throw new Error(`${fileName}: row ${index + 2} has ${values.length} fields; expected ${headers.length}`);
    }
    return Object.fromEntries(headers.map((header, column) => [header, values[column]]));
  });
}

function coerce(row, table) {
  const values = {};
  for (const column of table.columns) {
    const value = row[column];
    if (value === undefined) throw new Error(`${table.name}.csv is missing required schema column "${column}"`);
    if (value === '\\N') {
      values[column] = null;
    } else if (value === '') {
      values[column] = table.numeric.includes(column) ? null : '';
    } else if (table.numeric.includes(column)) {
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error(`${table.name}.csv contains invalid ${column}: ${value}`);
      values[column] = number;
    } else {
      values[column] = value;
    }
  }
  for (const column of table.required) {
    if (values[column] === null || values[column] === '') {
      throw new Error(`${table.name}.csv contains an empty required field: ${column}`);
    }
  }
  if (row.is_synthetic !== 'True' && row.is_synthetic !== 'true') {
    throw new Error(`${table.name}.csv contains a record not labelled synthetic`);
  }
  return values;
}

function matchesExisting(existing, values, columns) {
  return columns.every((column) => {
    const expected = values[column];
    const actual = existing[column];
    if (expected === null) return actual === null || actual === undefined;
    if (typeof expected === 'number') {
      return actual !== null && actual !== undefined
        && Number.isFinite(Number(actual)) && Number(actual) === expected;
    }
    return String(actual) === expected;
  });
}

async function importSyntheticData(db) {
  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest.synthetic !== true || !manifest.record_counts) {
    throw new Error('Synthetic manifest is missing its synthetic marker or record counts');
  }
  const datasets = [];
  for (const table of TABLES) {
    const file = `${table.name}.csv`;
    const text = await fs.readFile(path.join(OUTPUT_DIR, file), 'utf8');
    const rows = parseCsv(text, file).map((row) => coerce(row, table));
    if (rows.length !== manifest.record_counts[table.name]) {
      throw new Error(`${file}: manifest count ${manifest.record_counts[table.name]} does not match ${rows.length}`);
    }
    // Fail explicitly if a HANA or SQLite deployment has drifted from the
    // inspected runtime schema rather than silently dropping a column.
    await db.all(`SELECT ${table.columns.join(',')} FROM ${table.name} WHERE 1 = 0`);
    datasets.push({ ...table, rows });
  }

  const inserted = {};
  const skipped = {};
  await db.withTransaction(async (transaction) => {
    for (const table of datasets) {
      const columns = table.columns.join(',');
      const placeholders = table.columns.map(() => '?').join(',');
      const insert = `INSERT INTO ${table.name} (${columns}) VALUES (${placeholders})`;
      const keyPredicate = table.keys.map((column) => `${column} = ?`).join(' AND ');
      const lookup = `SELECT ${columns} FROM ${table.name} WHERE ${keyPredicate}`;
      inserted[table.name] = 0;
      skipped[table.name] = 0;
      for (const row of table.rows) {
        const existing = await transaction.get(lookup, table.keys.map((column) => row[column]));
        if (existing) {
          if (!matchesExisting(existing, row, table.columns)) {
            const key = table.keys.map((column) => `${column}=${row[column]}`).join(', ');
            const differentColumns = table.columns.filter((column) => (
              !matchesExisting(existing, { [column]: row[column] }, [column])
            ));
            throw new Error(
              `${table.name}: conflicting existing record (${key}); `
              + `different columns: ${differentColumns.join(', ')}; no rows were changed`,
            );
          }
          skipped[table.name]++;
          continue;
        }
        await transaction.run(insert, table.columns.map((column) => row[column]));
        inserted[table.name]++;
      }
    }
  });
  return {
    imported: inserted,
    skipped,
    retainedCsvOnly: ['suppliers'],
  };
}

module.exports = { importSyntheticData };
