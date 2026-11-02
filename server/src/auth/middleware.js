const {
  readSessionCookie,
  verifySessionToken,
} = require('./session');

const authDb = (req) => req.app.locals.authDb || req.app.locals.db;

async function loadAuthenticatedUser(db, claims) {
  if (!claims) return null;
  const now = new Date().toISOString();
  const session = await db.get(
    `SELECT id FROM auth_sessions
     WHERE id = ? AND user_email = ? AND revoked_at IS NULL AND expires_at > ?`,
    [claims.sid, claims.sub, now],
  );
  if (!session) return null;

  const user = await db.get(
    `SELECT email, full_name, organisation, designation, role
     FROM auth_users WHERE email = ?`,
    [claims.sub],
  );
  if (!user || user.role !== claims.role) return null;
  return user;
}

function requireAuthentication() {
  return (req, res, next) => {
    if (req.path === '/health' || req.method === 'OPTIONS') return next();

    const token = readSessionCookie(req.headers.cookie);
    const claims = verifySessionToken(token);
    if (!claims) return res.status(401).json({ error: 'Authentication required' });

    loadAuthenticatedUser(authDb(req), claims).then((user) => {
      if (!user) return res.status(401).json({ error: 'Session expired or revoked' });
      req.user = user;

      const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
      if (mutating && !['planner', 'admin'].includes(user.role)) {
        return res.status(403).json({ error: 'Planner access is required for this action' });
      }
      if (req.path === '/admin/reseed' && user.role !== 'admin') {
        return res.status(403).json({ error: 'Administrator access is required' });
      }
      return next();
    }).catch(next);
  };
}

module.exports = { loadAuthenticatedUser, requireAuthentication };
