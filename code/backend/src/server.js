require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { prisma } = require('./db');
const { ah, errorHandler, notFound } = require('./errors');
const { requireApiKey, requireAuth, requireRole } = require('./middleware/auth');
const { decide } = require('./services/decide');
const { installAuditGuard } = require('./services/audit');
const { expireDue } = require('./services/stepups');
const authRoutes = require('./routes/auth');
const meRoutes = require('./routes/me');
const alertRoutes = require('./routes/alerts');
const { dashboard, auditRouter, config } = require('./routes/manager');
const { toIstIso } = require('./engine/util');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Gateway (API key only)
app.post('/api/v1/authorisations', requireApiKey, ah(async (req, res) => {
  res.json(await decide(req.body, req.user));
}));

// Users (JWT)
app.use('/api/auth', authRoutes);
app.use('/api/me', requireAuth, requireRole('CARDHOLDER'), meRoutes);
app.use('/api/alerts', requireAuth, alertRoutes);
app.use('/api/dashboard', requireAuth, requireRole('MANAGER'), dashboard);
app.use('/api/audit', requireAuth, requireRole('MANAGER'), auditRouter);
app.use('/api/config', requireAuth, requireRole('MANAGER'), config);

// Demo form: same engine as the gateway, authenticated by the user's JWT
app.post('/api/simulate', requireAuth, requireRole('ANALYST', 'MANAGER'), ah(async (req, res) => {
  const body = { ...req.body };
  if (!body.txn_id) body.txn_id = `T9${String(Date.now()).slice(-8)}`;
  if (!body.txn_ts) body.txn_ts = toIstIso(Date.now());
  res.json(await decide(body, req.user));
}));

app.use((req, res, next) => next(notFound(`No route ${req.method} ${req.path}`)));
app.use(errorHandler);

const PORT = Number(process.env.PORT) || 4000;

async function start() {
  await installAuditGuard();
  // Step-up expiry job: every 30 seconds
  const tick = () => expireDue().then((n) => n && console.log(`[JOB] expired ${n} step-up(s)`)).catch((e) => console.error('[JOB]', e));
  tick();
  setInterval(tick, 30 * 1000);
  app.listen(PORT, () => console.log(`FraudShield backend on http://localhost:${PORT} (ML: ${process.env.ML_URL || 'stub'})`));
}

if (require.main === module) {
  start().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
}

module.exports = { app };
