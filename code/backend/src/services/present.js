// Shapes database rows into the JSON formats in API_CONTRACT.md.
const { toIstIso } = require('../engine/util');

const num = (d) => (d === null || d === undefined ? null : Number(d));
const iso = (d) => (d ? toIstIso(new Date(d).getTime()) : null);
const masked = (last4) => `XXXXXXXXXXXX${last4}`;
const FINAL_ALERT = new Set(['CONFIRMED_FRAUD', 'FALSE_POSITIVE']);

// Neutral message for the cardholder. Never exposes rules or scores.
function cardholderMessage(status, codes = []) {
  const has = (c) => codes.includes(c);
  if (status === 'APPROVED') return 'Payment approved.';
  if (status === 'STEP_UP_PENDING') return 'We need to confirm this payment with you.';
  if (status === 'RECEIVED') return 'Processing.';
  if (has('STEP_UP_DENIED')) return "You told us this wasn't you. The card has been blocked.";
  if (has('STEP_UP_TIMEOUT')) return "We didn't hear back in time, so the payment was declined.";
  if (has('CARD_NOT_ACTIVE')) return 'Your card is not active.';
  if (has('INTL_NOT_ENABLED')) return 'International payments are not enabled on this card.';
  if (has('DAILY_LIMIT_EXCEEDED')) return 'This payment is above your daily limit.';
  if (codes.length) return 'This payment was declined for your safety.';
  return 'This payment was declined.';
}

// Authorisation API response (Section 2)
function decisionResponse(txn, alert) {
  return {
    txn_id: txn.txn_id,
    decision: txn.decision,
    final_decision: txn.final_decision,
    reason_codes: txn.reason_codes,
    rule_risk_score: txn.rule_risk_score,
    status: txn.status,
    alert_id: alert ? alert.alert_id : null,
    processed_at: iso(txn.processed_at),
    fraud_score: txn.fraud_score,
    top_factors: txn.top_factors || [],
    model_status: txn.model_status,
  };
}

const slaBreached = (alert, now = Date.now()) => !FINAL_ALERT.has(alert.status) && new Date(alert.sla_due_at).getTime() < now;

module.exports = { num, iso, masked, cardholderMessage, decisionResponse, slaBreached, FINAL_ALERT };
