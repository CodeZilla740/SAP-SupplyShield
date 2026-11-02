const { connect, close } = require('../db');
const { connectAuthStore } = require('./auth-store');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function revoke(db, email) {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized) || normalized.length > 254) {
    throw new Error('Provide a valid email address.');
  }
  const result = await db.run(
    `UPDATE auth_sessions SET revoked_at = ?
     WHERE user_email = ? AND revoked_at IS NULL`,
    [new Date().toISOString(), normalized],
  );
  return result.changes;
}

async function main(args) {
  const [command, email] = args;
  const businessDb = await connect();
  const db = await connectAuthStore(businessDb);
  try {
    if (command === 'revoke' && email) {
      const count = await revoke(db, email);
      console.log(`Revoked ${count} active session(s) for ${email.trim().toLowerCase()}.`);
      return;
    }
    throw new Error('Usage: npm run auth -- revoke <email>');
  } finally {
    if (db !== businessDb) await db.close();
    await close();
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`[auth] ${error.message}`);
  process.exitCode = 1;
});
