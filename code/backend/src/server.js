require('dotenv').config();
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const { spec } = require('./openapi');
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

// API docs: interactive Swagger UI + raw spec
app.get('/api/openapi.json', (req, res) => res.json(spec));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'FraudShield API' }));

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

// First call to the model is slow (SHAP compiles on first use). Make it now, not on a customer's payment.
async function warmUpModel() {
  if (!process.env.ML_URL) return;
  const { score } = require('./services/ml');
  const sample = { card_type: 'DEBIT', channel: 'POS', mcc: '5411', mcc_category: 'GROCERY', merchant_risk: 'LOW',
    amount: 1000, local_hour: 12, is_international: 0, country_risk_high: 0, distance_from_home_km: 0,
    velocity_10m: 0, velocity_24h: 1, amount_to_avg30_ratio: 1, new_merchant_flag: 0, card_age_days: 365 };
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const r = await score(sample, { model_timeout_ms: 10000 });
    if (r.model_status === 'OK') return console.log(`ML warm-up OK (${Date.now() - t0} ms)`);
    await new Promise((res) => setTimeout(res, 2000));
  }
  console.warn('ML warm-up failed: live decisions will use rules only until the ML service responds');
}

async function start() {
  await installAuditGuard();
  // Step-up expiry job: every 30 seconds
  const tick = () => expireDue().then((n) => n && console.log(`[JOB] expired ${n} step-up(s)`)).catch((e) => console.error('[JOB]', e));
  tick();
  setInterval(tick, 30 * 1000);
  app.listen(PORT, () => {
    console.log(`FraudShield backend on http://localhost:${PORT} (ML: ${process.env.ML_URL || 'stub'})`);
    console.log(`API docs: http://localhost:${PORT}/api/docs`);
    warmUpModel();
  });
}

if (require.main === module) {
  start().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
}

module.exports = { app, start };
