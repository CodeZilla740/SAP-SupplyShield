// Shared test fixture: an isolated in-memory database seeded with the
// canonical demo data, plus the Express app listening on an ephemeral port.
const crypto = require('node:crypto');
if (!process.env.SUPPLYSHIELD_AUTH_SECRET) {
  process.env.SUPPLYSHIELD_AUTH_SECRET = crypto.randomBytes(32).toString('base64url');
}
const { useTestDb } = require('../src/db');
const { seed } = require('../src/db/seed');
const { runPipeline } = require('../src/agents/orchestrator');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth/password');
const { sessionCookie, signSessionToken } = require('../src/auth/session');

const sessionCookies = new Map();
const TEST_PASSWORD = 'TestPlannerPassword!123';

async function freshDb({ withPlan = true } = {}) {
  const db = await useTestDb();
  await seed(db);
  let pipeline = null;
  if (withPlan) pipeline = await runPipeline(db, 'INC-2026-1104-03', 'test');
  return { db, pipeline };
}

async function freshServer({ withPlan = true } = {}) {
  const { db, pipeline } = await freshDb({ withPlan });
  const user = {
    email: 'planner@example.test',
    full_name: 'Test Planner',
    organisation: 'Test Hospital',
    designation: 'Supply planner',
    role: 'planner',
  };
  await db.run(
    `INSERT INTO auth_users
     (email, full_name, organisation, designation, role, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      user.email,
      user.full_name,
      user.organisation,
      user.designation,
      user.role,
      await hashPassword(TEST_PASSWORD),
      new Date().toISOString(),
    ],
  );
  const session = signSessionToken(user);
  await db.run(
    `INSERT INTO auth_sessions (id, user_email, created_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, NULL)`,
    [session.claims.sid, user.email, new Date().toISOString(), session.expiresAt],
  );
  const app = createApp(db);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  sessionCookies.set(base, sessionCookie(session.token, session.maxAge).split(';')[0]);
  return { db, pipeline, server, base };
}

async function postRequest(base, path, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

async function getRequest(base, path, cookie) {
  const headers = cookie ? { Cookie: cookie } : undefined;
  const res = await fetch(base + path, { headers });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const post = (base, path, body) => postRequest(base, path, body, sessionCookies.get(base));
const get = (base, path) => getRequest(base, path, sessionCookies.get(base));
const postAnonymous = (base, path, body) => postRequest(base, path, body);
const getAnonymous = (base, path) => getRequest(base, path);

module.exports = {
  freshDb,
  freshServer,
  get,
  getAnonymous,
  getRequest,
  post,
  postAnonymous,
  postRequest,
  TEST_PASSWORD,
};
