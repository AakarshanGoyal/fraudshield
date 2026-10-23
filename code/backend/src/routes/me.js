// Cardholder APIs (Section 4). Every query is scoped to the logged-in customer,
// so changing an id in the URL never exposes someone else's data (403).
const express = require('express');
const { prisma } = require('../db');
const { ah, forbidden } = require('../errors');
const { getContext } = require('../services/context');
const { respond } = require('../services/stepups');
const { blockCard } = require('../services/cards');
const { num, iso, masked, cardholderMessage } = require('../services/present');
const { dateStr } = require('../engine/util');

const router = express.Router();

async function ownCard(user, cardId) {
  const card = await prisma.card.findUnique({ where: { card_id: cardId } });
  if (!card || card.customer_id !== user.customer_id) throw forbidden('This is not your card');
  return card;
}

router.get('/cards', ah(async (req, res) => {
  const cards = await prisma.card.findMany({ where: { customer_id: req.user.customer_id }, orderBy: { card_id: 'asc' } });
  res.json(cards.map((c) => ({
    card_id: c.card_id, masked_number: masked(c.last4), card_type: c.card_type, card_status: c.card_status,
    expiry_date: dateStr(c.expiry_date), daily_limit: num(c.daily_limit), international_enabled: c.international_enabled,
  })));
}));

router.get('/transactions', ah(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  let cardIds;
  if (req.query.card_id) cardIds = [(await ownCard(req.user, String(req.query.card_id))).card_id];
  else cardIds = (await prisma.card.findMany({ where: { customer_id: req.user.customer_id }, select: { card_id: true } })).map((c) => c.card_id);

  const { ctx } = await getContext();
  const txns = await prisma.transaction.findMany({
    where: { card_id: { in: cardIds } }, orderBy: [{ txn_ts: 'desc' }, { txn_id: 'desc' }], take: limit,
  });
  res.json(txns.map((t) => ({
    txn_id: t.txn_id, card_id: t.card_id, txn_ts: iso(t.txn_ts), amount: num(t.amount),
    merchant_name: ctx.merchants.get(t.merchant_id)?.merchant_name || t.merchant_id,
    channel: t.channel, txn_city: t.txn_city, status: t.status, message: cardholderMessage(t.status, t.reason_codes),
  })));
}));

router.get('/stepups/pending', ah(async (req, res) => {
  const { ctx } = await getContext();
  const pending = await prisma.stepUp.findMany({
    where: { status: 'PENDING', expires_at: { gt: new Date() }, transaction: { card: { customer_id: req.user.customer_id } } },
    include: { transaction: true }, orderBy: { expires_at: 'asc' },
  });
  res.json(pending.map((s) => ({
    txn_id: s.txn_id, card_id: s.transaction.card_id, amount: num(s.transaction.amount),
    merchant_name: ctx.merchants.get(s.transaction.merchant_id)?.merchant_name || s.transaction.merchant_id,
    txn_ts: iso(s.transaction.txn_ts), expires_at: iso(s.expires_at),
  })));
}));

router.post('/stepups/:txn_id/respond', ah(async (req, res) => {
  res.json(await respond(req.user, req.params.txn_id, req.body));
}));

router.post('/cards/:card_id/block', ah(async (req, res) => {
  const card = await ownCard(req.user, req.params.card_id);
  await blockCard(prisma, card.card_id, req.user.username, req.user.role, 'Blocked by cardholder');
  res.json({ card_id: card.card_id, card_status: 'BLOCKED' });
}));

module.exports = router;
