// Express application factory. Exported separately from index.js so tests
// can spin up the full API against an isolated in-memory database.
const path = require('path');
const fs = require('fs');
const express = require('express');
const api = require('./routes/api');
const { createAuthRouter } = require('./auth/routes');
const { requireAuthentication } = require('./auth/middleware');

function createApp(db, options = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.locals.db = db;
  app.locals.authDb = options.authDb || db;

  // Basic security headers (no external helmet dependency).
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.use('/api/auth', createAuthRouter());
  app.use('/api', requireAuthentication());
  app.use('/api', api);

  // In production serve the built UI; in development the Vite dev server
  // proxies /api to this backend (see ui/vite.config.ts).
  const dist = path.join(__dirname, '..', '..', 'ui', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // JSON 404 for unknown API routes.
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Central error handler - errors from agents/approval carry .status.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    const body = { error: err.message || 'Internal server error' };
    if (err.reasons) body.reasons = err.reasons;
    if (status >= 500) console.error('[api]', err);
    res.status(status).json(body);
  });

  return app;
}

module.exports = { createApp };
