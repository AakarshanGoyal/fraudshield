// Worked examples 1-10, 13, 14 from the case document (Section 6.4).
// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, applyModel, buildAlert } = require('../src/engine/rules');
const { toMs } = require('../src/engine/util');

const cfg = {
  velocity_window_minutes: 10, velocity_burst_count: 5, velocity_stepup_min: 3, velocity_stepup_max: 4,
  avg_lookback_days: 30, amount_spike_multiplier: 5, amount_spike_min_amount: 10000, amount_spike_no_history_amount: 50000,
  impossible_travel_kmph: 800, travel_lookback_hours: 6, earth_radius_km: 6371.0,
  odd_hour_start: 0, odd_hour_end: 4, odd_hour_min_amount: 20000,
  new_merchant_lookback_days: 90, new_merchant_min_amount: 25000,
  high_risk_mcc: ['4829', '5967', '6051', '7995'], multiple_red_flags_count: 3,
  points: { HIGH_VELOCITY: 25, AMOUNT_SPIKE: 30, HIGH_RISK_GEO: 25, HIGH_RISK_MCC: 15, ODD_HOUR_HIGH_VALUE: 15, NEW_MERCHANT_HIGH_VALUE: 20 },
  step_up_expiry_minutes: 15, false_positive_manager_limit: 100000, alert_high_amount: 50000,
  sla_minutes: { HIGH: 30, MEDIUM: 240 }, ai_step_up_threshold: 0.7, ai_block_threshold: 0.9, model_timeout_ms: 150,
};

const ctx = {
  cities: new Map([
    ['Mumbai', { lat: 19.0760, lon: 72.8777, country: 'IN' }],
    ['Delhi', { lat: 28.6139, lon: 77.2090, country: 'IN' }],
    ['Pune', { lat: 18.5204, lon: 73.8567, country: 'IN' }],
    ['Singapore', { lat: 1.3521, lon: 103.8198, country: 'SG' }],
  ]),
  merchants: new Map([
    ['M00450', { merchant_risk: 'LOW', mcc: '5411' }],
    ['M00451', { merchant_risk: 'LOW', mcc: '5732' }],
    ['M00452', { merchant_risk: 'HIGH', mcc: '6051' }],
    ['M00453', { merchant_risk: 'LOW', mcc: '5411' }],
  ]),
  countryRisk: new Map([['IN', 'LOW'], ['SG', 'LOW']]),
  mccs: new Map(),
};

const card = (over = {}) => ({
  card_status: 'ACTIVE', expiry_date: '2029-12-31', issue_date: '2024-01-01', card_type: 'DEBIT',
  home_city: 'Mumbai', home_country: 'IN', daily_limit: '100000.00', international_enabled: false, ...over,
});

// 20 approved ₹2,400 txns over the last 30 days, none on 2026-03-04
const history = () => Array.from({ length: 20 }, (_, i) => ({
  txn_id: `H${i}`,
  txn_ts: new Date(toMs('2026-02-12T12:00:00+05:30') + i * 86400000).toISOString(),
  amount: '2400.00', merchant_id: i % 2 ? 'M00451' : 'M00450', channel: i % 2 ? 'ECOM' : 'POS',
  txn_city: 'Mumbai', status: 'APPROVED',
}));

const txn = (over = {}) => ({
  txn_id: 'T200000001', card_id: 'C1001', txn_ts: '2026-03-04T14:05:00+05:30', amount: '3500.00',
  merchant_id: 'M00450', mcc: '5411', channel: 'POS', txn_city: 'Mumbai', txn_country: 'IN', ...over,
});
const round2 = (x) => (x === null ? null : Math.round(x * 100) / 100);

test('1: normal payment is approved', () => {
  const r = evaluate(txn(), history(), card(), ctx, cfg);
  assert.equal(r.decision, 'APPROVE');
  assert.deepEqual(r.reason_codes, []);
  assert.equal(r.rule_risk_score, 0);
  assert.equal(r.velocity_10m, 0);
  assert.equal(round2(r.avg_amount_30d), 2400);
  assert.equal(r.speed_kmph, null);
});

test('2: blocked card is a hard stop', () => {
  const r = evaluate(txn(), history(), card({ card_status: 'BLOCKED' }), ctx, cfg);
  assert.equal(r.decision, 'BLOCK');
  assert.deepEqual(r.reason_codes, ['CARD_NOT_ACTIVE']);
  assert.equal(r.rule_risk_score, null);
  assert.equal(r.avg_amount_30d, null);
  assert.equal(buildAlert(r.decision, r.reason_codes, '3500', toMs(txn().txn_ts), cfg), null);
});

test('3: international not enabled', () => {
  const r = evaluate(txn({ txn_city: 'Singapore', txn_country: 'SG' }), history(), card(), ctx, cfg);
  assert.deepEqual(r.reason_codes, ['INTL_NOT_ENABLED']);
  assert.equal(r.velocity_10m, null);
});

test('4: daily limit exceeded, no alert', () => {
  const prior = [...history(), { txn_id: 'X1', txn_ts: '2026-03-04T09:00:00+05:30', amount: '92000.00',
    merchant_id: 'M00450', channel: 'POS', txn_city: 'Mumbai', status: 'APPROVED' }];
  const r = evaluate(txn({ amount: '9500.00' }), prior, card(), ctx, cfg);
  assert.equal(r.decision, 'BLOCK');
  assert.deepEqual(r.reason_codes, ['DAILY_LIMIT_EXCEEDED']);
  assert.equal(r.rule_risk_score, 100);
  assert.equal(round2(r.avg_amount_30d), 6666.67);
  assert.equal(round2(r.speed_kmph), 0);
  assert.equal(buildAlert(r.decision, r.reason_codes, '9500', toMs(txn().txn_ts), cfg), null);
});

test('5: impossible travel Mumbai -> Delhi in 1 hour', () => {
  const prior = [...history(), { txn_id: 'X1', txn_ts: '2026-03-04T13:05:00+05:30', amount: '2400.00',
    merchant_id: 'M00450', channel: 'POS', txn_city: 'Mumbai', status: 'APPROVED' }];
  const r = evaluate(txn({ amount: '4000.00', txn_city: 'Delhi' }), prior, card(), ctx, cfg);
  assert.deepEqual(r.reason_codes, ['IMPOSSIBLE_TRAVEL']);
  assert.equal(r.rule_risk_score, 100);
  assert.equal(round2(r.speed_kmph), 1148.09);
  assert.equal(round2(r.avg_amount_30d), 2400);
  const a = buildAlert(r.decision, r.reason_codes, '4000', toMs(txn().txn_ts), cfg);
  assert.equal(a.priority, 'HIGH');
  assert.equal(a.sla_due_at, '2026-03-04T14:35:00+05:30');
});

test('6: Mumbai -> Pune in 1 hour is fine', () => {
  const prior = [...history(), { txn_id: 'X1', txn_ts: '2026-03-04T13:05:00+05:30', amount: '2400.00',
    merchant_id: 'M00450', channel: 'POS', txn_city: 'Mumbai', status: 'APPROVED' }];
  const r = evaluate(txn({ amount: '3000.00', txn_city: 'Pune' }), prior, card(), ctx, cfg);
  assert.equal(r.decision, 'APPROVE');
  assert.equal(round2(r.speed_kmph), 120.15);
});

test('7: amount spike -> step up', () => {
  const r = evaluate(txn({ amount: '15000.00', channel: 'ECOM', merchant_id: 'M00451', mcc: '5732' }), history(), card(), ctx, cfg);
  assert.equal(r.decision, 'STEP_UP');
  assert.deepEqual(r.reason_codes, ['AMOUNT_SPIKE']);
  assert.equal(r.rule_risk_score, 30);
  assert.equal(r.speed_kmph, null);
});

test('8: boundary 12,000 = exactly 5x average -> approve', () => {
  const r = evaluate(txn({ amount: '12000.00', channel: 'ECOM', merchant_id: 'M00451', mcc: '5732' }), history(), card(), ctx, cfg);
  assert.equal(r.decision, 'APPROVE');
  assert.equal(r.rule_risk_score, 0);
});

test('9: three txns in 10 minutes -> high velocity', () => {
  const extra = ['13:56', '13:59', '14:02'].map((hm, i) => ({ txn_id: `V${i}`, txn_ts: `2026-03-04T${hm}:00+05:30`,
    amount: '1200.00', merchant_id: 'M00451', channel: 'ECOM', txn_city: 'Mumbai', status: 'APPROVED' }));
  const r = evaluate(txn({ amount: '1200.00', channel: 'ECOM', merchant_id: 'M00451', mcc: '5732' }), [...history(), ...extra], card(), ctx, cfg);
  assert.equal(r.decision, 'STEP_UP');
  assert.deepEqual(r.reason_codes, ['HIGH_VELOCITY']);
  assert.equal(r.rule_risk_score, 25);
  assert.equal(r.velocity_10m, 3);
  assert.equal(round2(r.avg_amount_30d), 2243.48);

  // 14 (AI): score 0.93 turns STEP_UP into BLOCK, alert HIGH
  const ai = applyModel(r, 0.93, cfg);
  assert.equal(ai.final_decision, 'BLOCK');
  assert.deepEqual(ai.reason_codes, ['HIGH_VELOCITY', 'HIGH_FRAUD_SCORE_MODEL']);
  const a = buildAlert(ai.final_decision, ai.reason_codes, '1200', toMs(txn().txn_ts), cfg, 0.93);
  assert.equal(a.priority, 'HIGH');
});

test('10: crypto at 2:30 AM at a new merchant -> multiple red flags', () => {
  const r = evaluate(txn({ txn_ts: '2026-03-04T02:30:00+05:30', amount: '45000.00', channel: 'ECOM',
    merchant_id: 'M00452', mcc: '6051' }), history(), card(), ctx, cfg);
  assert.equal(r.decision, 'BLOCK');
  assert.deepEqual(r.reason_codes,
    ['AMOUNT_SPIKE', 'HIGH_RISK_MCC', 'ODD_HOUR_HIGH_VALUE', 'NEW_MERCHANT_HIGH_VALUE', 'MULTIPLE_RED_FLAGS']);
  assert.equal(r.rule_risk_score, 80);
  const a = buildAlert(r.decision, r.reason_codes, '45000', toMs('2026-03-04T02:30:00+05:30'), cfg);
  assert.equal(a.priority, 'HIGH');
  assert.equal(a.sla_due_at, '2026-03-04T03:00:00+05:30');
});

test('13 (AI): approve + score 0.82 -> step up, rules decision unchanged', () => {
  const r = evaluate(txn(), history(), card(), ctx, cfg);
  const ai = applyModel(r, 0.82, cfg);
  assert.equal(r.decision, 'APPROVE');
  assert.equal(ai.final_decision, 'STEP_UP');
  assert.deepEqual(ai.reason_codes, ['HIGH_FRAUD_SCORE_MODEL']);
});

test('AI never softens a block, and 0.65 changes nothing', () => {
  const blocked = { decision: 'BLOCK', reason_codes: ['VELOCITY_BURST'] };
  assert.equal(applyModel(blocked, 0.01, cfg).final_decision, 'BLOCK');
  const approved = { decision: 'APPROVE', reason_codes: [] };
  assert.equal(applyModel(approved, 0.65, cfg).final_decision, 'APPROVE');
  assert.equal(applyModel(approved, null, cfg).final_decision, 'APPROVE');
});
