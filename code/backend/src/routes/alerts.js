// Analyst + manager alert APIs (Sections 5 and 6). Every status change is a conditional
// update (WHERE status = expected), so two people acting at once can't both succeed: the second gets 409.
const express = require('express');
const { prisma } = require('../db');
const { ah, invalid, forbidden, notFound, conflict } = require('../errors');
const { requireRole } = require('../middleware/auth');
const { getContext } = require('../services/context');
const { audit } = require('../services/audit');
const { blockCard } = require('../services/cards');
const { num, iso, masked, slaBreached } = require('../services/present');
const { toPaise } = require('../engine/util');

const router = express.Router();
const PRIORITY_ORDER = { HIGH: 0, MEDIUM: 1 };

function listItem(a, ctx) {
  const t = a.transaction;
  return {
    alert_id: a.alert_id, txn_id: a.txn_id, priority: a.priority, status: a.status,
    created_at: iso(a.created_at), sla_due_at: iso(a.sla_due_at), sla_breached: slaBreached(a),
    amount: num(t.amount), card_id: t.card_id, card_last4: t.card.last4,
    merchant_name: ctx.merchants.get(t.merchant_id)?.merchant_name || t.merchant_id,
    reason_codes: t.reason_codes, fraud_score: t.fraud_score, claimed_by: a.claimed_by,
  };
}

const comment10 = (c) => {
  if (typeof c !== 'string' || c.trim().length < 10) throw invalid('Invalid input', { comment: 'at least 10 characters' });
  return c.trim();
};

router.get('/', requireRole('ANALYST', 'MANAGER'), ah(async (req, res) => {
  const where = {};
  if (req.query.status) where.status = { in: String(req.query.status).split(',').map((s) => s.trim()) };
  if (req.query.priority) where.priority = { in: String(req.query.priority).split(',').map((s) => s.trim()) };
  const { ctx } = await getContext();
  const alerts = await prisma.alert.findMany({ where, include: { transaction: { include: { card: true } } } });
  alerts.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.sla_due_at - b.sla_due_at || a.alert_id - b.alert_id);
  res.json(alerts.map((a) => listItem(a, ctx)));
}));

router.get('/:id', requireRole('ANALYST', 'MANAGER'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const a = Number.isInteger(id) && await prisma.alert.findUnique({ where: { alert_id: id }, include: { transaction: { include: { card: true } } } });
  if (!a) throw notFound('Alert not found');
  const t = a.transaction;
  const { ctx } = await getContext();

  // Feature values exactly as used at decision time (stored with the DECISION audit row)
  const decisionRow = await prisma.auditLog.findFirst({
    where: { entity: 'TRANSACTION', entity_id: t.txn_id, action: 'DECISION' }, orderBy: { id: 'desc' },
  });
  const f = decisionRow?.after?.features || {};

  const recent = await prisma.transaction.findMany({
    where: { card_id: t.card_id, txn_ts: { lt: t.txn_ts } }, orderBy: { txn_ts: 'desc' }, take: 10,
  });

  res.json({
    alert: { alert_id: a.alert_id, priority: a.priority, status: a.status, sla_due_at: iso(a.sla_due_at),
      sla_breached: slaBreached(a), claimed_by: a.claimed_by, proposed_by: a.proposed_by, comment: a.comment },
    transaction: { txn_id: t.txn_id, txn_ts: iso(t.txn_ts), amount: num(t.amount), channel: t.channel,
      merchant_id: t.merchant_id, merchant_name: ctx.merchants.get(t.merchant_id)?.merchant_name || t.merchant_id,
      mcc: t.mcc, txn_city: t.txn_city, txn_country: t.txn_country, status: t.status,
      decision: t.decision, final_decision: t.final_decision, reason_codes: t.reason_codes, rule_risk_score: t.rule_risk_score },
    features: {
      velocity_10m: f.velocity_10m ?? t.velocity_10m, approved_today: f.approved_today ?? null,
      avg_amount_30d: t.avg_amount_30d === null ? null : num(t.avg_amount_30d),
      speed_kmph: t.speed_kmph, new_merchant: f.new_merchant ?? null,
    },
    ai: { fraud_score: t.fraud_score, top_factors: t.top_factors || [], model_status: t.model_status, model_version: t.model_version },
    card: { card_id: t.card.card_id, masked_number: masked(t.card.last4), card_type: t.card.card_type,
      card_status: t.card.card_status, home_city: t.card.home_city, daily_limit: num(t.card.daily_limit) },
    recent_transactions: recent.map((r) => ({ txn_id: r.txn_id, txn_ts: iso(r.txn_ts), amount: num(r.amount),
      txn_city: r.txn_city, status: r.status })),
    narrative: null,
  });
}));

router.post('/:id/claim', requireRole('ANALYST'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const won = await prisma.alert.updateMany({
    where: { alert_id: id, status: 'OPEN' },
    data: { status: 'IN_REVIEW', claimed_by: req.user.username, version: { increment: 1 } },
  });
  if (won.count === 0) {
    const exists = await prisma.alert.findUnique({ where: { alert_id: id } });
    if (!exists) throw notFound('Alert not found');
    throw conflict(`Alert already ${exists.claimed_by ? `claimed by ${exists.claimed_by}` : exists.status}`);
  }
  await audit(prisma, { entity: 'ALERT', entity_id: id, actor: req.user.username, role: req.user.role,
    action: 'CLAIMED', from_status: 'OPEN', to_status: 'IN_REVIEW' });
  const a = await prisma.alert.findUnique({ where: { alert_id: id } });
  res.json({ alert_id: a.alert_id, status: a.status, claimed_by: a.claimed_by });
}));

router.post('/:id/close', requireRole('ANALYST'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const { outcome } = req.body || {};
  if (!['CONFIRMED_FRAUD', 'FALSE_POSITIVE'].includes(outcome)) throw invalid('Invalid input', { outcome: 'must be CONFIRMED_FRAUD or FALSE_POSITIVE' });
  const comment = comment10(req.body.comment);

  const a = await prisma.alert.findUnique({ where: { alert_id: id }, include: { transaction: true } });
  if (!a) throw notFound('Alert not found');
  if (a.status !== 'IN_REVIEW') throw conflict(`Alert is ${a.status}`);
  if (a.claimed_by !== req.user.username) throw forbidden('Only the analyst who claimed this alert can close it');

  const { cfg } = await getContext();
  const needsChecker = outcome === 'FALSE_POSITIVE' && toPaise(a.transaction.amount) > toPaise(cfg.false_positive_manager_limit);
  const newStatus = needsChecker ? 'PENDING_MANAGER_APPROVAL' : outcome;

  await prisma.$transaction(async (tx) => {
    const won = await tx.alert.updateMany({
      where: { alert_id: id, status: 'IN_REVIEW', claimed_by: req.user.username },
      data: {
        status: newStatus, comment, version: { increment: 1 },
        proposed_by: needsChecker ? req.user.username : undefined,
        closed_by: needsChecker ? undefined : req.user.username,
      },
    });
    if (won.count === 0) throw conflict('Alert was changed by someone else');
    await audit(tx, { entity: 'ALERT', entity_id: id, actor: req.user.username, role: req.user.role,
      action: needsChecker ? 'PROPOSED_FALSE_POSITIVE' : 'CLOSED', from_status: 'IN_REVIEW', to_status: newStatus, comment });
    if (newStatus === 'CONFIRMED_FRAUD') await blockCard(tx, a.transaction.card_id, req.user.username, req.user.role, `Confirmed fraud on ${a.txn_id}`);
  });
  if (newStatus === 'FALSE_POSITIVE') console.log(`[NOTIFY] cardholder of card ${a.transaction.card_id}: payment ${a.txn_id} reviewed as genuine`);
  res.json({ alert_id: id, status: newStatus });
}));

router.post('/:id/decision', requireRole('MANAGER'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const { decision } = req.body || {};
  if (!['APPROVE', 'REJECT'].includes(decision)) throw invalid('Invalid input', { decision: 'must be APPROVE or REJECT' });
  const comment = comment10(req.body.comment);

  const a = await prisma.alert.findUnique({ where: { alert_id: id }, include: { transaction: true } });
  if (!a) throw notFound('Alert not found');
  if (a.proposed_by === req.user.username) throw forbidden('Maker and checker must be different people');
  if (a.status !== 'PENDING_MANAGER_APPROVAL') throw conflict(`Alert is ${a.status}`);

  const newStatus = decision === 'APPROVE' ? 'FALSE_POSITIVE' : 'CONFIRMED_FRAUD';
  await prisma.$transaction(async (tx) => {
    const won = await tx.alert.updateMany({
      where: { alert_id: id, status: 'PENDING_MANAGER_APPROVAL', NOT: { proposed_by: req.user.username } },
      data: { status: newStatus, closed_by: req.user.username, comment, version: { increment: 1 } },
    });
    if (won.count === 0) throw conflict('Alert was decided by someone else');
    await audit(tx, { entity: 'ALERT', entity_id: id, actor: req.user.username, role: req.user.role,
      action: `CHECKER_${decision}`, from_status: 'PENDING_MANAGER_APPROVAL', to_status: newStatus, comment });
    if (newStatus === 'CONFIRMED_FRAUD') await blockCard(tx, a.transaction.card_id, req.user.username, req.user.role, `Confirmed fraud on ${a.txn_id}`);
  });
  if (newStatus === 'FALSE_POSITIVE') console.log(`[NOTIFY] cardholder of card ${a.transaction.card_id}: payment ${a.txn_id} reviewed as genuine`);
  res.json({ alert_id: id, status: newStatus });
}));

module.exports = router;
