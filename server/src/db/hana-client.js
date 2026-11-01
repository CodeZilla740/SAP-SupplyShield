// SAP HANA client (production: SAP HANA Cloud).
//
// Uses the official @sap/hana-client driver. The driver is an optional
// dependency: it is only loaded when HANA_HOST is configured, so local
// development never needs the native driver installed.
//
// Required environment variables (see .env.example):
//   HANA_HOST, HANA_PORT (default 443), HANA_USER, HANA_PASSWORD,
//   HANA_SCHEMA (default SUPPLYSHIELD)
// On SAP BTP / Cloud Foundry the same values can be injected from a bound
// HANA service instance via VCAP_SERVICES.
const config = require('../config');
const { AsyncLocalStorage } = require('node:async_hooks');

function fromVcap() {
  try {
    const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}');
    const services = []
      .concat(vcap.hana || [])
      .concat(vcap['hana-cloud'] || [])
      .concat(vcap['hanatrial'] || []);
    const creds = services[0] && services[0].credentials;
    if (!creds) return null;
    return {
      host: creds.host,
      port: Number(creds.port || 443),
      user: creds.user,
      password: creds.password,
    };
  } catch (e) {
    return null;
  }
}

class HanaClient {
  constructor() {
    this.kind = 'hana';
    this.transactionContext = new AsyncLocalStorage();
    this.lockTail = Promise.resolve();
    let driver;
    try {
      // Lazy require: only attempted when HANA is actually configured.
      driver = require('@sap/hana-client');
    } catch (e) {
      throw new Error(
        'SAP HANA is configured (HANA_HOST set) but the @sap/hana-client ' +
        'driver is not installed. Run `npm install` in server/ - it is an ' +
        'optional dependency. Original error: ' + e.message,
      );
    }
    const vcap = fromVcap();
    const connParams = vcap || {
      serverNode: `${config.hana.host}:${config.hana.port}`,
      uid: config.hana.user,
      pwd: config.hana.password,
      encrypt: config.hana.encrypt ? 'true' : 'false',
      sslValidateCertificate: 'true',
    };
    this.conn = driver.createConnection();
    this.conn.connect(connParams);
    if (!vcap && config.hana.schema) {
      this.conn.exec(`SET SCHEMA ${config.hana.schema}`);
    }
  }

  _exec(sql, params) {
    return new Promise((resolve, reject) => {
      this.conn.exec(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
  }

  async _withLock(fn) {
    const previous = this.lockTail;
    let release;
    this.lockTail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async _exclusive(fn) {
    if (this.transactionContext.getStore() === this) return fn();
    return this._withLock(fn);
  }

  _control(method) {
    return new Promise((resolve, reject) => {
      this.conn[method]((error) => (error ? reject(error) : resolve()));
    });
  }

  async withTransaction(callback) {
    if (this.transactionContext.getStore() === this) return callback(this);
    return this._withLock(async () => {
      this.conn.setAutoCommit(false);
      return this.transactionContext.run(this, async () => {
        try {
          const result = await callback(this);
          await this._control('commit');
          return result;
        } catch (error) {
          await this._control('rollback');
          throw error;
        } finally {
          this.conn.setAutoCommit(true);
        }
      });
    });
  }

  async all(sql, params = []) {
    return this._exclusive(() => this._exec(sql, params));
  }

  async get(sql, params = []) {
    const rows = await this._exclusive(() => this._exec(sql, params));
    return rows && rows[0];
  }

  async run(sql, params = []) {
    const affected = await this._exclusive(() => this._exec(sql, params));
    return { changes: typeof affected === 'number' ? affected : 0 };
  }

  async exec(sql) {
    await this._exclusive(() => this._exec(sql, []));
  }

  async close() {
    if (this.conn) this.conn.disconnect();
  }
}

module.exports = HanaClient;
