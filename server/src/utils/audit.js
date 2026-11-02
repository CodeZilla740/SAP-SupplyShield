// Tamper-evident audit trail.
// Every event is appended to audit_log with a SHA-256 hash that chains to
// the previous row: hash = sha256(prevHash | seq | runId | actor | step |
// payload | ts). Modifying any historical row breaks every later hash.
const crypto = require('crypto');

function computeHash({ prevHash, seq, runId, actor, step, payload, ts }) {
  return crypto.createHash('sha256')
    .update([prevHash, seq, runId, actor, step, payload, ts].join('|'))
    .digest('hex');
}

async function audit(db, runId, actor, step, payloadObj) {
  if (typeof db.withTransaction !== 'function') {
    throw new Error('Audit writes require a transaction-capable database adapter');
  }
  return db.withTransaction(async (tx) => {
    await tx.run(
      "UPDATE pipeline_state SET value = value + 1 WHERE name = 'AUDIT_LOCK'",
    );
    const lock = await tx.get(
      "SELECT value FROM pipeline_state WHERE name = 'AUDIT_LOCK'",
    );
    if (!lock) throw new Error('Audit coordination row is missing; deploy the pipeline_state seed data');

    const last = await tx.get('SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1');
    const seq = (last ? last.seq : 0) + 1;
    const prevHash = last ? last.hash : 'GENESIS';
    const payload = JSON.stringify(payloadObj);
    const ts = new Date().toISOString();
    const hash = computeHash({ prevHash, seq, runId, actor, step, payload, ts });
    await tx.run(
      'INSERT INTO audit_log (seq,run_id,ts,actor,step,payload,prev_hash,hash) VALUES (?,?,?,?,?,?,?,?)',
      [seq, runId, ts, actor, step, payload, prevHash, hash],
    );
    return { seq, hash };
  });
}

// Recomputes the whole chain; returns { valid, brokenAt } for integrity checks.
async function verifyChain(db) {
  const rows = await db.all('SELECT * FROM audit_log ORDER BY seq ASC');
  let prevHash = 'GENESIS';
  for (const row of rows) {
    const expected = computeHash({
      prevHash, seq: row.seq, runId: row.run_id, actor: row.actor,
      step: row.step, payload: row.payload, ts: row.ts,
    });
    if (row.prev_hash !== prevHash || row.hash !== expected) {
      return { valid: false, brokenAt: row.seq, events: rows.length };
    }
    prevHash = row.hash;
  }
  return { valid: true, events: rows.length };
}

module.exports = { audit, verifyChain, computeHash };
