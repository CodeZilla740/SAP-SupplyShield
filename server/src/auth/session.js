const crypto = require('node:crypto');
const config = require('../config');

const COOKIE_NAME = 'supplyshield_session';
const SESSION_HOURS = 12;
const REMEMBER_DAYS = 30;
const ALLOWED_ROLES = new Set(['viewer', 'planner', 'admin']);

function sessionSecret() {
  if (Buffer.byteLength(config.authSessionSecret, 'utf8') < 32) return null;
  return config.authSessionSecret;
}

function assertSessionSecret() {
  if (!sessionSecret()) {
    throw new Error(
      'Set SUPPLYSHIELD_AUTH_SECRET in server/.env or in the backend environment to a unique value of at least 32 bytes. See the README Quick start for a safe generation command.',
    );
  }
}

function signSessionToken(user, remember = false, now = Date.now()) {
  const secret = sessionSecret();
  if (!secret) throw new Error('SUPPLYSHIELD_AUTH_SECRET is not configured.');

  const lifetime = remember
    ? REMEMBER_DAYS * 24 * 60 * 60
    : SESSION_HOURS * 60 * 60;
  const claims = {
    sid: crypto.randomUUID(),
    sub: user.email,
    role: user.role,
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + lifetime,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const content = `v1.${payload}`;
  const signature = crypto.createHmac('sha256', secret).update(content).digest('base64url');
  return {
    token: `${content}.${signature}`,
    claims,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    maxAge: lifetime,
  };
}

function verifySessionToken(token, now = Date.now()) {
  const secret = sessionSecret();
  if (!secret || typeof token !== 'string' || token.length > 4096) return null;

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const content = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', secret).update(content).digest();
  let actual;
  try {
    actual = Buffer.from(parts[2], 'base64url');
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (
      typeof claims.sid !== 'string'
      || typeof claims.sub !== 'string'
      || !ALLOWED_ROLES.has(claims.role)
      || !Number.isInteger(claims.exp)
      || claims.exp <= Math.floor(now / 1000)
    ) return null;
    return claims;
  } catch {
    return null;
  }
}

function readSessionCookie(header) {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== COOKIE_NAME) continue;
    return part.slice(separator + 1).trim() || null;
  }
  return null;
}

function sessionCookie(token, maxAge) {
  const attributes = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (config.nodeEnv === 'production') attributes.push('Secure');
  return attributes.join('; ');
}

function expiredSessionCookie() {
  const attributes = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (config.nodeEnv === 'production') attributes.push('Secure');
  return attributes.join('; ');
}

module.exports = {
  COOKIE_NAME,
  assertSessionSecret,
  expiredSessionCookie,
  readSessionCookie,
  sessionCookie,
  signSessionToken,
  verifySessionToken,
};
