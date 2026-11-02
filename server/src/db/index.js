// Database facade.
//
// Priority: SAP HANA Cloud whenever HANA_HOST (or a bound VCAP_SERVICES
// hana service) is configured; otherwise a local SQLite file is used so the
// full application still runs for development, tests and offline demos.
// The active engine is reported by /api/health and labelled in the UI -
// we never pretend to be on HANA when we are not.
const config = require('../config');
const SqliteClient = require('./sqlite-client');

let db = null;
let fallbackReason = null;

async function connect(options = {}) {
  if (db) return db;
  const wantHana = Boolean(config.hana.host || process.env.VCAP_SERVICES);
  if (config.nodeEnv === 'production' && !wantHana) {
    throw new Error('SAP HANA Cloud must be bound in production; SQLite fallback is disabled.');
  }

  if (wantHana && !options.forceSqlite) {
    try {
      const HanaClient = require('./hana-client');
      db = new HanaClient();
    } catch (e) {
      fallbackReason = e.message;
      if (config.nodeEnv === 'production') {
        throw new Error('SAP HANA connection failed in production; SQLite fallback is disabled.', { cause: e });
      }
      console.warn('[db] SAP HANA connection failed, falling back to SQLite:', e.message);
    }
  }
  if (!db) {
    if (config.nodeEnv === 'production') {
      throw new Error('SAP HANA Cloud is required in production; SQLite fallback is disabled.');
    }
    db = new SqliteClient(options.sqliteFile || config.sqliteFile);
  }
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized - call connect() first');
  return db;
}

function engineInfo() {
  return {
    engine: db ? db.kind : 'none',
    fallbackReason,
    label: db && db.kind === 'hana'
      ? 'SAP HANA Cloud'
      : 'Local demo database (SQLite fallback - SAP HANA not configured)',
  };
}

// Test helper: swap in an isolated in-memory database.
async function useTestDb() {
  if (db) { try { await db.close(); } catch (e) { /* ignore */ } }
  db = new SqliteClient(':memory:');
  return db;
}

async function close() {
  if (db) { await db.close(); db = null; }
}

module.exports = { connect, getDb, engineInfo, useTestDb, close };
