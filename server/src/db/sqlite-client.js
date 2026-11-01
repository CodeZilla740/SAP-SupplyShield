// SQLite client (local development, tests, demo fallback).
// Wraps better-sqlite3 in the same async contract as the SAP HANA client,
// so the rest of the application never cares which engine is active.
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('node:async_hooks');
const Database = require('better-sqlite3');

class SqliteClient {
  constructor(file) {
    this.kind = 'sqlite';
    this.file = file;
    this.transactionContext = new AsyncLocalStorage();
    this.lockTail = Promise.resolve();
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 30000');
    this.db.pragma('foreign_keys = ON');
    const ddl = fs.readFileSync(path.join(__dirname, 'schema-sqlite.sql'), 'utf8');
    this.db.exec(ddl);
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

  async withTransaction(callback) {
    if (this.transactionContext.getStore() === this) return callback(this);
    return this._withLock(async () => {
      this.db.exec('BEGIN IMMEDIATE');
      return this.transactionContext.run(this, async () => {
        try {
          const result = await callback(this);
          this.db.exec('COMMIT');
          return result;
        } catch (error) {
          this.db.exec('ROLLBACK');
          throw error;
        }
      });
    });
  }

  async all(sql, params = []) {
    return this._exclusive(() => this.db.prepare(sql).all(...params));
  }

  async get(sql, params = []) {
    return this._exclusive(() => this.db.prepare(sql).get(...params));
  }

  async run(sql, params = []) {
    const info = await this._exclusive(() => this.db.prepare(sql).run(...params));
    return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
  }

  async exec(sql) {
    this.db.exec(sql);
  }

  // better-sqlite3 placeholders are positional "?", same as used by HANA's
  // prepared statements, so no SQL rewriting is needed between dialects.
  async close() {
    this.db.close();
  }
}

module.exports = SqliteClient;
