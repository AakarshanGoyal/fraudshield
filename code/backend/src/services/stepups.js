// FR-5: step-up verification. CONFIRM + correct OTP -> APPROVED; NOT_ME -> BLOCKED + card blocked + HIGH alert;
// no answer in time -> BLOCKED (STEP_UP_TIMEOUT) + alert. Each status change is a conditional update, so a
// confirmation racing the expiry job can never both win.

const { prisma } = require('../db');
const { getContext } = require('./context');
const { audit } = require('./audit');
const { blockCard } = require('./cards');
const { hashOtp } = require('./decide');
const { cardholderMessage } = require('./present');
const { buildAlert } = require('../engine/rules');
const { invalid, forbidden, notFound, conflict } = require('../errors');

async function blockAfterStepUp(stepUpId, code, actor, role) {
  const { cfg } = await getContext();
  return prisma.$transaction(async (tx) => {
    const newStatus = code === 'STEP_UP_DENIED' ? 'DENIED' : 'EXPIRED';
    const won = await tx.stepUp.updateMany({
      where: { id: stepUpId, status: 'PENDING' }, data: { status: newStatus, responded_at: new Date() },
    });
    if (won.count === 0) return null; // someone else already resolved it

    const su = await tx.stepUp.findUnique({ where: { id: stepUpId }, include: { transaction: true } });
    const txn = su.transaction;
    const codes = [...txn.reason_codes, code];
    await tx.transaction.update({ where: { txn_id: txn.txn_id }, data: { status: 'BLOCKED', reason_codes: codes } });
    await audit(tx, { entity: 'TRANSACTION', entity_id: txn.txn_id, actor, role, action: code,
      from_status: 'STEP_UP_PENDING', to_status: 'BLOCKED', comment: code });

    if (code === 'STEP_UP_DENIED') await blockCard(tx, txn.card_id, actor, role, 'Cardholder answered NOT_ME');

    const now = Date.now();
    const a = buildAlert('BLOCK', codes, txn.amount.toString(), now, cfg, txn.fraud_score);
    let alert = null;
    if (a) {
      alert = await tx.alert.create({ data: {
        txn_id: txn.txn_id, priority: a.priority, status: 'OPEN', created_at: new Date(now), sla_due_at: new Date(a.sla_due_ms),
      } });
      await audit(tx, { entity: 'ALERT', entity_id: alert.alert_id, actor: 'system', role: 'ENGINE', action: 'CREATED',
        to_status: 'OPEN', comment: `${a.priority} for ${txn.txn_id} (${code})` });
    }
    return { txn_id: txn.txn_id, codes, alert };
  });
}

async function respond(user, txnId, body) {
  const response = body && body.response;
  if (!['CONFIRM', 'NOT_ME'].includes(response)) throw invalid('Invalid input', { response: 'must be CONFIRM or NOT_ME' });

  const su = await prisma.stepUp.findUnique({ where: { txn_id: txnId }, include: { transaction: { include: { card: true } } } });
  if (!su) throw notFound('No verification request for this transaction');
  if (su.transaction.card.customer_id !== user.customer_id) throw forbidden('This is not your transaction');
  if (su.status !== 'PENDING') throw conflict('This request is no longer pending.');

  if (su.expires_at.getTime() <= Date.now()) {
    await blockAfterStepUp(su.id, 'STEP_UP_TIMEOUT', 'system', 'SCHEDULER');
    throw conflict('This request has expired.');
  }

  if (response === 'NOT_ME') {
    const r = await blockAfterStepUp(su.id, 'STEP_UP_DENIED', user.username, user.role);
    if (!r) throw conflict('This request is no longer pending.');
    return { txn_id: txnId, status: 'BLOCKED', message: cardholderMessage('BLOCKED', r.codes) };
  }

  const otp = String(body.otp || '').trim();
  if (!/^[0-9]{6}$/.test(otp) || hashOtp(txnId, otp) !== su.otp_hash) {
    throw invalid('Incorrect OTP', { otp: 'incorrect' });
  }

  await prisma.$transaction(async (tx) => {
    const won = await tx.stepUp.updateMany({
      where: { id: su.id, status: 'PENDING', expires_at: { gt: new Date() } },
      data: { status: 'CONFIRMED', responded_at: new Date() },
    });
    if (won.count === 0) throw conflict('This request has expired.');
    await tx.transaction.update({ where: { txn_id: txnId }, data: { status: 'APPROVED' } });
    await audit(tx, { entity: 'TRANSACTION', entity_id: txnId, actor: user.username, role: user.role,
      action: 'STEP_UP_CONFIRMED', from_status: 'STEP_UP_PENDING', to_status: 'APPROVED' });
  });
  return { txn_id: txnId, status: 'APPROVED', message: cardholderMessage('APPROVED') };
}

// Called by the scheduler: expire every pending step-up past its deadline
async function expireDue() {
  const due = await prisma.stepUp.findMany({ where: { status: 'PENDING', expires_at: { lte: new Date() } }, select: { id: true } });
  let n = 0;
  for (const { id } of due) if (await blockAfterStepUp(id, 'STEP_UP_TIMEOUT', 'system', 'SCHEDULER')) n++;
  return n;
}

module.exports = { respond, expireDue };
