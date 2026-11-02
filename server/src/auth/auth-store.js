const os = require('node:os');
const path = require('node:path');
const SqliteClient = require('../db/sqlite-client');
const config = require('../config');

let localAuthDb = null;

function localAuthFile() {
  return config.authSqliteFile || path.join(os.homedir(), '.supplyshield', 'auth.sqlite');
}

async function getLocalAuthStore() {
  if (!localAuthDb) localAuthDb = new SqliteClient(localAuthFile());
  return localAuthDb;
}

async function connectAuthStore(database) {
  if (database.kind === 'hana') return database;
  if (database.file && database.file !== ':memory:') return database;
  return getLocalAuthStore();
}

module.exports = { connectAuthStore, getLocalAuthStore };
