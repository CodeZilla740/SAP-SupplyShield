const crypto = require('node:crypto');
const { promisify } = require('node:util');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  freshServer,
  getAnonymous,
  getRequest,
  postAnonymous,
  postRequest,
  TEST_PASSWORD,
} = require('./helpers');
const config = require('../src/config');
const { assertSessionSecret } = require('../src/auth/session');
const { hashPassword, verifyPassword } = require('../src/auth/password');

test('session signing secret requires at least 32 bytes and explains configuration', () => {
  const originalSecret = config.authSessionSecret;
  try {
    config.authSessionSecret = 'x'.repeat(31);
    assert.throws(
      assertSessionSecret,
      /SUPPLYSHIELD_AUTH_SECRET.*server\/\.env.*at least 32 bytes/,
    );

    config.authSessionSecret = 'x'.repeat(32);
    assert.doesNotThrow(assertSessionSecret);
  } finally {
    config.authSessionSecret = originalSecret;
  }
});

test('protected API rejects anonymous access while health remains public', async () => {
  const { server, base } = await freshServer();
  const health = await getAnonymous(base, '/api/health');
  const overview = await getAnonymous(base, '/api/overview');
  assert.equal(health.status, 200);
  assert.equal(overview.status, 401);
  server.close();
});

test('login validates the password and issues a revocable HttpOnly session', async () => {
  const { server, base } = await freshServer();
  const wrongPassword = await postAnonymous(base, '/api/auth/login', {
    email: 'planner@example.test',
    password: 'wrong-password',
  });
  assert.equal(wrongPassword.status, 401);

  const signedIn = await postAnonymous(base, '/api/auth/login', {
    email: 'planner@example.test',
    password: TEST_PASSWORD,
    rememberMe: true,
  });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.user.role, 'planner');
  assert.match(signedIn.headers.get('set-cookie'), /HttpOnly/);
  assert.match(signedIn.headers.get('set-cookie'), /SameSite=Lax/);
  const cookie = signedIn.headers.get('set-cookie').split(';')[0];

  assert.equal((await getRequest(base, '/api/overview', cookie)).status, 200);
  const signedOut = await postRequest(base, '/api/auth/logout', {}, cookie);
  assert.equal(signedOut.status, 200);
  assert.equal((await getRequest(base, '/api/overview', cookie)).status, 401);
  server.close();
});

test('signup creates multiple accounts, starts a session, and allows login with the same credentials', async () => {
  const { server, base, db } = await freshServer();
  const invalid = await postAnonymous(base, '/api/auth/signup', {
    fullName: 'Invalid Demo User',
    email: 'invalid@example.test',
    password: 'short',
  });
  assert.equal(invalid.status, 400);

  const oversizedPassword = await postAnonymous(base, '/api/auth/signup', {
    fullName: 'Invalid Demo User',
    email: 'large@example.test',
    password: 'é'.repeat(37),
  });
  assert.equal(oversizedPassword.status, 400);

  const created = await postAnonymous(base, '/api/auth/signup', {
    fullName: 'New Demo User',
    email: 'New.User@example.test',
    password: 'SecurePassword!123',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.email, 'new.user@example.test');
  assert.equal(created.body.user.fullName, 'New Demo User');
  assert.equal(created.body.user.role, 'planner');
  assert.match(created.headers.get('set-cookie'), /HttpOnly/);
  assert.match(created.headers.get('set-cookie'), /SameSite=Lax/);

  const record = await db.get('SELECT full_name, password_hash FROM auth_users WHERE email = ?', [
    'new.user@example.test',
  ]);
  assert.equal(record.full_name, 'New Demo User');
  assert.match(record.password_hash, /^\$2[aby]\$12\$/);
  assert.notEqual(record.password_hash, 'SecurePassword!123');

  const cookie = created.headers.get('set-cookie').split(';')[0];
  assert.equal((await getRequest(base, '/api/overview', cookie)).status, 200);

  const reused = await postAnonymous(base, '/api/auth/signup', {
    fullName: 'New Demo User',
    email: 'NEW.USER@example.test',
    password: 'SecurePassword!123',
  });
  assert.equal(reused.status, 409);

  const signedIn = await postAnonymous(base, '/api/auth/login', {
    email: 'NEW.USER@example.test',
    password: 'SecurePassword!123',
  });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.user.fullName, 'New Demo User');
  assert.equal((await postAnonymous(base, '/api/auth/login', {
    email: 'new.user@example.test',
    password: 'incorrect-password',
  })).status, 401);

  const secondAccount = await postAnonymous(base, '/api/auth/signup', {
    fullName: 'Another Demo User',
    email: 'another@example.test',
    password: 'AnotherSecurePass!123',
  });
  assert.equal(secondAccount.status, 201);
  server.close();
});

test('local frontend origins on another port can reach auth while remote origins are rejected', async () => {
  const { server, base } = await freshServer();
  const localResponse = await fetch(`${base}/api/auth/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5179',
    },
    body: JSON.stringify({
      fullName: 'Local Demo User',
      email: 'local@example.test',
      password: 'LocalSecurePass!123',
    }),
  });
  assert.equal(localResponse.status, 201);

  const remoteResponse = await fetch(`${base}/api/auth/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://untrusted.example',
    },
    body: JSON.stringify({
      fullName: 'Remote Demo User',
      email: 'remote@example.test',
      password: 'RemoteSecurePass!123',
    }),
  });
  assert.equal(remoteResponse.status, 403);
  server.close();
});

test('new passwords use bcrypt hashes and existing scrypt hashes remain verifiable', async () => {
  const hash = await hashPassword('SecurePassword!123');
  assert.match(hash, /^\$2[aby]\$12\$/);
  assert.notEqual(hash, 'SecurePassword!123');
  assert.equal(await verifyPassword('SecurePassword!123', hash), true);
  assert.equal(await verifyPassword('incorrect-password', hash), false);
  assert.equal(await verifyPassword('SecurePassword!123', undefined), false);

  const salt = Buffer.alloc(16, 7);
  const legacyHash = await promisify(crypto.scrypt)(
    'LegacyPassword!123',
    salt,
    64,
    { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
  );
  const legacyEncoded = `scrypt$${salt.toString('base64url')}$${legacyHash.toString('base64url')}`;
  assert.equal(await verifyPassword('LegacyPassword!123', legacyEncoded), true);
});
