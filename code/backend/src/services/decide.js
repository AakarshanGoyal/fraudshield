// The live decision path (FR-2, FR-4, FR-5 start, FR-6 start, AI-2).
// Validates -> idempotency -> lock the card row -> features + rules -> ML -> save -> response.

const crypto = require('crypto');
const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const { prisma } = require('../db');
const { getContext } = require('./context');
const { score } = require('./ml');
const { audit } = require('./audit');
const { decisionResponse } = require('./present');
const { invalid } = require('../errors');
const { evaluate, computeFeatures, applyModel, buildAlert, modelFeatures, statusFor } = require('../engine/rules');
const { toMs, DAY_MS, MIN_MS } = require('../engine/util');

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const schema = z.object({
  txn_id: z.string().regex(/^T[0-9]{9}$/, 'must match ^T[0-9]{9}$'),
  card_id: z.string().min(1, 'required'),
  txn_ts: z.string().refine((s) => ISO_WITH_OFFSET.test(s) && !Number.isNaN(Date.parse(s)), 'must be ISO-8601 with offset, e.g. 2026-03-04T14:05:00+05:30'),
  amount: z.coerce.number()
    .gt(0, 'must be > 0')
    .lte(1000000, 'must be <= 1000000')
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'at most 2 decimals'),
  currency: z.literal('INR', { message: 'only INR is accepted' }).default('INR'),
  merchant_id: z.string().min(1, 'required'),
  mcc: z.coerce.string().regex(/^[0-9]{4}$/, 'must be 4 digits'),
  channel: z.enum(['POS', 'ECOM', 'ATM', 'CONTACTLESS'], { message: 'must be POS, ECOM, ATM or CONTACTLESS' }),
  txn_city: z.string().min(1, 'required'),
  txn_country: z.string().min(2, 'required'),
});

const hashOtp = (txnId, otp) => crypto.createHash('sha256').update(`${txnId}:${otp}`).digest('hex');

async function validate(body) {
  const input = schema.parse(body);
  const { ctx } = await getContext();
  const fields = {};
  const city = ctx.cities.get(input.txn_city);
  if (!city) fields.txn_city = 'unknown city';
  else if (city.country !== input.txn_country) fields.txn_country = `must be ${city.country} for ${input.txn_city}`;
  if (!ctx.merchants.has(input.merchant_id)) fields.merchant_id = 'unknown merchant';
  const card = await prisma.card.findUnique({ where: { card_id: input.card_id }, select: { card_id: true } });
  if (!card) fields.card_id = 'unknown card';
  if (Object.keys(fields).length) throw invalid('Invalid input', fields);
  return { ...input, amount: input.amount.toFixed(2) };
}

async function existingResponse(db, txnId) {
  const txn = await db.transaction.findUnique({ where: { txn_id: txnId }, include: { alert: true } });
  return txn ? decisionResponse(txn, txn.alert) : null;
}

// actor: { username, role } of whoever submitted (gateway or a simulating user)
async function decide(body, actor) {
  const input = await validate(body);

  // Idempotency: same txn_id -> original answer, nothing new
  const replay = await existingResponse(prisma, input.txn_id);
  if (replay) return replay;

  const { cfg, ctx } = await getContext();
  try {
    return await prisma.$transaction(async (tx) => {
      // Serialise transactions of the same card so velocity counts stay correct under concurrency
      await tx.$queryRaw`SELECT card_id FROM "Card" WHERE card_id = ${input.card_id} FOR UPDATE`;
      const again = await existingResponse(tx, input.txn_id);
      if (again) return again;

      const card = await tx.card.findUnique({ where: { card_id: input.card_id } });
      const t = toMs(input.txn_ts);
      const lookback = Math.max(cfg.new_merchant_lookback_days, cfg.avg_lookback_days) * DAY_MS;
      const prior = (await tx.transaction.findMany({
        where: { card_id: input.card_id, txn_ts: { lt: new Date(t), gte: new Date(t - lookback) } },
        select: { txn_id: true, txn_ts: true, amount: true, merchant_id: true, channel: true, txn_city: true, status: true },
      })).map((p) => ({ ...p, amount: p.amount.toString() }));

      const rules = evaluate(input, prior, card, ctx, cfg);
      const features = rules.features || computeFeatures(input, prior, card, ctx, cfg);
      const mlInput = modelFeatures(input, card, features, ctx);
      const ml = await score(mlInput, cfg);
      const ai = applyModel(rules, ml.fraud_score, cfg);
      const status = statusFor(ai.final_decision);
      const now = Date.now();

      const txn = await tx.transaction.create({
        data: {
          txn_id: input.txn_id, card_id: input.card_id, txn_ts: new Date(t), amount: input.amount, currency: 'INR',
          merchant_id: input.merchant_id, mcc: input.mcc, channel: input.channel,
          txn_city: input.txn_city, txn_country: input.txn_country, status, source: 'LIVE',
          decision: rules.decision, final_decision: ai.final_decision, reason_codes: ai.reason_codes,
          rule_risk_score: rules.rule_risk_score, velocity_10m: rules.velocity_10m,
          avg_amount_30d: rules.avg_amount_30d === null ? null : (Math.round(features.sum30_paise / features.n30) / 100).toFixed(2),
          speed_kmph: rules.speed_kmph === null ? null : Math.round(rules.speed_kmph * 100) / 100,
          fraud_score: ml.fraud_score, top_factors: ml.top_factors, model_status: ml.model_status,
          model_version: ml.model_version, processed_at: new Date(now),
        },
      });

      await audit(tx, { entity: 'TRANSACTION', entity_id: txn.txn_id, actor: actor.username, role: actor.role,
        action: 'RECEIVED', to_status: 'RECEIVED' });
      await audit(tx, {
        entity: 'TRANSACTION', entity_id: txn.txn_id, actor: 'system', role: 'ENGINE', action: 'DECISION',
        from_status: 'RECEIVED', to_status: status, comment: ai.reason_codes.join('|') || null,
        after: {
          decision: rules.decision, final_decision: ai.final_decision, reason_codes: ai.reason_codes,
          rule_risk_score: rules.rule_risk_score,
          features: {
            velocity_10m: features.velocity_10m, velocity_24h: features.velocity_24h,
            approved_today: features.approved_today_paise / 100, avg_amount_30d: features.avg_amount_30d,
            speed_kmph: features.speed_kmph, new_merchant: features.new_merchant,
          },
          model_input: mlInput, fraud_score: ml.fraud_score, top_factors: ml.top_factors, top_features: ml.top_features,
          model_status: ml.model_status, model_version: ml.model_version, config_version: cfg.version,
        },
      });

      if (status === 'STEP_UP_PENDING') {
        const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        await tx.stepUp.create({ data: {
          txn_id: txn.txn_id, otp_hash: hashOtp(txn.txn_id, otp),
          expires_at: new Date(now + cfg.step_up_expiry_minutes * MIN_MS), status: 'PENDING',
        } });
        console.log(`[OTP] txn ${txn.txn_id} card ${txn.card_id}: ${otp} (valid ${cfg.step_up_expiry_minutes} min)`);
        await audit(tx, { entity: 'TRANSACTION', entity_id: txn.txn_id, actor: 'system', role: 'ENGINE',
          action: 'STEP_UP_SENT', comment: 'Simulated OTP written to the application log' });
      }

      let alert = null;
      const a = buildAlert(ai.final_decision, ai.reason_codes, input.amount, now, cfg, ml.fraud_score);
      if (a) {
        alert = await tx.alert.create({ data: {
          txn_id: txn.txn_id, priority: a.priority, status: 'OPEN', created_at: new Date(now), sla_due_at: new Date(a.sla_due_ms),
        } });
        await audit(tx, { entity: 'ALERT', entity_id: alert.alert_id, actor: 'system', role: 'ENGINE', action: 'CREATED',
          to_status: 'OPEN', comment: `${a.priority} for ${txn.txn_id}` });
      }

      return decisionResponse(txn, alert);
    }, { timeout: 10000 });
  } catch (e) {
    // Two requests with the same txn_id on different cards raced: return the stored one
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const stored = await existingResponse(prisma, input.txn_id);
      if (stored) return stored;
    }
    throw e;
  }
}

module.exports = { decide, hashOtp };
