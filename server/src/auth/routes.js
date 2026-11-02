const express = require('express');
const config = require('../config');
const { hashPassword, verifyPassword } = require('./password');
const { loadAuthenticatedUser } = require('./middleware');
const {
  expiredSessionCookie,
  readSessionCookie,
  sessionCookie,
  signSessionToken,
  verifySessionToken,
} = require('./session');

const ROLES = new Set(['viewer', 'planner', 'admin']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 10;
const loginAttempts = new Map();
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const db = (req) => req.app.locals.authDb || req.app.locals.db;

function loginAttemptKey(req) {
  return `${req.socket.remoteAddress || 'unknown'}:${normalizedEmail(req.body?.email)}`;
}

function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    const parsed = new URL(origin);
    const allowedHosts = new Set([req.get('host')]);
    if (config.publicUrl) allowedHosts.add(new URL(config.publicUrl).host);
    const requestHost = new URL(`http://${req.get('host')}`).hostname.toLowerCase();
    const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
    const localDevelopmentOrigin = config.nodeEnv !== 'production'
      && ['http:', 'https:'].includes(parsed.protocol)
      && localHosts.has(parsed.hostname.toLowerCase())
      && localHosts.has(requestHost);
    if (
      ['http:', 'https:'].includes(parsed.protocol)
      && (allowedHosts.has(parsed.host) || localDevelopmentOrigin)
    ) {
      return next();
    }
  } catch {
    // Invalid Origin values are rejected below.
  }
  return res.status(403).json({ error: 'Cross-origin authentication request rejected' });
}

function normalizedEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validText(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;
}

function rateLimitLogin(req, res, next) {
  const key = loginAttemptKey(req);
  const now = Date.now();
  const attempts = (loginAttempts.get(key) || []).filter((time) => now - time < LOGIN_WINDOW_MS);
  if (attempts.length >= LOGIN_LIMIT) {
    loginAttempts.set(key, attempts);
    return res.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
  }
  attempts.push(now);
  loginAttempts.set(key, attempts);
  if (loginAttempts.size > 5000) {
    for (const [entry, times] of loginAttempts) {
      if (!times.length || now - times[times.length - 1] >= LOGIN_WINDOW_MS) {
        loginAttempts.delete(entry);
      }
    }
  }
  return next();
}

function rateLimitSignup(req, res, next) {
  const key = `${req.socket.remoteAddress || 'unknown'}:signup`;
  const now = Date.now();
  const attempts = (loginAttempts.get(key) || []).filter((time) => now - time < LOGIN_WINDOW_MS);
  if (attempts.length >= LOGIN_LIMIT) {
    loginAttempts.set(key, attempts);
    return res.status(429).json({ error: 'Too many account creation attempts. Try again later.' });
  }
  attempts.push(now);
  loginAttempts.set(key, attempts);
  return next();
}

function publicUser(user) {
  return {
    email: user.email,
    fullName: user.full_name,
    organisation: user.organisation,
    designation: user.designation,
    role: user.role,
  };
}

async function issueSession(req, res, user, remember = false) {
  const session = signSessionToken(user, remember);
  await db(req).run(
    `INSERT INTO auth_sessions (id, user_email, created_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, NULL)`,
    [session.claims.sid, user.email, new Date().toISOString(), session.expiresAt],
  );
  res.setHeader('Set-Cookie', sessionCookie(session.token, session.maxAge));
  return publicUser(user);
}

function createAuthRouter() {
  const router = express.Router();

  router.post('/login', sameOrigin, rateLimitLogin, asyncH(async (req, res) => {
    const email = normalizedEmail(req.body?.email);
    const password = req.body?.password;
    if (
      !EMAIL_PATTERN.test(email)
      || email.length > 254
      || typeof password !== 'string'
      || Buffer.byteLength(password, 'utf8') > 128
    ) {
      return res.status(401).json({ error: 'Email or password is incorrect' });
    }

    const user = await db(req).get('SELECT * FROM auth_users WHERE email = ?', [email]);
    const passwordMatches = await verifyPassword(password, user?.password_hash);
    if (!user || !passwordMatches) {
      return res.status(401).json({ error: 'Email or password is incorrect' });
    }
    if (!ROLES.has(user.role)) {
      return res.status(403).json({ error: 'This account does not have an authorized role' });
    }

    loginAttempts.delete(loginAttemptKey(req));
    const sessionUser = await issueSession(req, res, user, req.body?.rememberMe === true);
    return res.json({ user: sessionUser });
  }));

  router.post('/signup', sameOrigin, rateLimitSignup, asyncH(async (req, res) => {
    const email = normalizedEmail(req.body?.email);
    const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : '';
    const password = req.body?.password;

    if (
      !EMAIL_PATTERN.test(email)
      || email.length > 254
      || !validText(fullName, 100)
      || typeof password !== 'string'
      || password.length < 12
      || Buffer.byteLength(password, 'utf8') > 72
    ) {
      return res.status(400).json({
        error: 'Provide a name, a valid email address, and a password of at least 12 characters and no more than 72 UTF-8 bytes.',
      });
    }

    if (await db(req).get('SELECT email FROM auth_users WHERE email = ?', [email])) {
      return res.status(409).json({ error: 'An account already exists for this email address.' });
    }

    const passwordHash = await hashPassword(password);
    let createdUser;
    let createdSession;
    try {
      await db(req).withTransaction(async (tx) => {
        const now = new Date().toISOString();
        const existing = await tx.get('SELECT email FROM auth_users WHERE email = ?', [email]);
        if (existing) {
          const error = new Error('An account already exists for this email address');
          error.status = 409;
          throw error;
        }

        createdUser = {
          email,
          full_name: fullName,
          organisation: 'SupplyShield Demo',
          designation: 'Member',
          role: 'planner',
          password_hash: passwordHash,
          created_at: now,
        };
        await tx.run(
          `INSERT INTO auth_users
           (email, full_name, organisation, designation, role, password_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            createdUser.email,
            createdUser.full_name,
            createdUser.organisation,
            createdUser.designation,
            createdUser.role,
            createdUser.password_hash,
            createdUser.created_at,
          ],
        );

        createdSession = signSessionToken(createdUser);
        await tx.run(
          `INSERT INTO auth_sessions (id, user_email, created_at, expires_at, revoked_at)
           VALUES (?, ?, ?, ?, NULL)`,
          [
            createdSession.claims.sid,
            email,
            now,
            createdSession.expiresAt,
          ],
        );
      });
    } catch (error) {
      if (error.status === 409) return res.status(409).json({ error: error.message });
      if (await db(req).get('SELECT email FROM auth_users WHERE email = ?', [email])) {
        return res.status(409).json({ error: 'An account already exists for this email address.' });
      }
      throw error;
    }

    res.setHeader('Set-Cookie', sessionCookie(createdSession.token, createdSession.maxAge));
    return res.status(201).json({ user: publicUser(createdUser) });
  }));

  router.get('/session', asyncH(async (req, res) => {
    const claims = verifySessionToken(readSessionCookie(req.headers.cookie));
    const user = await loadAuthenticatedUser(db(req), claims);
    if (!user) return res.status(401).json({ error: 'No active session' });
    return res.json({ user: publicUser(user) });
  }));

  router.post('/logout', sameOrigin, asyncH(async (req, res) => {
    const claims = verifySessionToken(readSessionCookie(req.headers.cookie));
    if (claims) {
      await db(req).run(
        `UPDATE auth_sessions SET revoked_at = ?
         WHERE id = ? AND user_email = ? AND revoked_at IS NULL`,
        [new Date().toISOString(), claims.sid, claims.sub],
      );
    }
    res.setHeader('Set-Cookie', expiredSessionCookie());
    return res.json({ loggedOut: true });
  }));

  return router;
}

module.exports = { createAuthRouter };
