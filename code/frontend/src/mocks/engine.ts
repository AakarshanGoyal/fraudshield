// A small copy of the FraudShield rules R1–R13 so /api/simulate behaves realistically in mock mode.
// The real decision engine is the backend's job; this only exists for frontend development.
import type { AuthorisationResponse, Decision, Priority, SimulateRequest } from '../api/types';
import { nowIstIso } from '../lib/format';
import { CITIES, HIGH_RISK_COUNTRIES, addAudit, db, type MockTxn } from './db';

const cfg = <T>(key: string): T => db.config.find((c) => c.key === key)!.value as T;
const ms = (iso: string) => new Date(iso).getTime();
const istDate = (iso: string) => new Date(ms(iso) + 330 * 60_000).toISOString().slice(0, 10);
const istHour = (iso: string) => new Date(ms(iso) + 330 * 60_000).getUTCHours();

function haversineKm(a: string, b: string) {
  const p = CITIES[a];
  const q = CITIES[b];
  if (!p || !q) return 0;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(q.lat - p.lat);
  const dLon = rad(q.lon - p.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(p.lat)) * Math.cos(rad(q.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const FRAUD_CODES = new Set([
  'MERCHANT_BLACKLISTED', 'VELOCITY_BURST', 'IMPOSSIBLE_TRAVEL', 'MULTIPLE_RED_FLAGS',
  'STEP_UP_DENIED', 'STEP_UP_TIMEOUT', 'HIGH_FRAUD_SCORE_MODEL',
]);
const HIGH_CODES = new Set(['IMPOSSIBLE_TRAVEL', 'MULTIPLE_RED_FLAGS', 'STEP_UP_DENIED']);
const PHYSICAL = new Set(['POS', 'ATM', 'CONTACTLESS']);

export function createAlertIfNeeded(t: MockTxn, actor = 'system') {
  if (t.alert_id != null || !t.reason_codes.some((c) => FRAUD_CODES.has(c))) return null;
  const priority: Priority =
    t.amount >= cfg<number>('high_priority_min_amount') ||
    t.reason_codes.some((c) => HIGH_CODES.has(c)) ||
    (t.fraud_score ?? 0) >= cfg<number>('ai_block_threshold')
      ? 'HIGH'
      : 'MEDIUM';
  const created_at = nowIstIso();
  const sla = cfg<Record<Priority, number>>('sla_minutes')[priority];
  const alert = {
    alert_id: db.nextAlertId++,
    txn_id: t.txn_id,
    priority,
    status: 'OPEN' as const,
    created_at,
    sla_due_at: nowIstIso(new Date(Date.now() + sla * 60_000)),
    claimed_by: null,
    proposed_by: null,
    comment: null,
  };
  db.alerts.push(alert);
  t.alert_id = alert.alert_id;
  addAudit({ entity: 'ALERT', entity_id: String(alert.alert_id), actor, role: 'ENGINE', action: 'CREATED', from_status: null, to_status: 'OPEN', comment: t.reason_codes.join('|'), before: null, after: { priority, sla_due_at: alert.sla_due_at } });
  return alert;
}

export function toResponse(t: MockTxn): AuthorisationResponse {
  return {
    txn_id: t.txn_id,
    decision: t.decision,
    final_decision: t.final_decision,
    reason_codes: t.reason_codes,
    rule_risk_score: t.rule_risk_score,
    status: t.status,
    alert_id: t.alert_id,
    processed_at: t.processed_at,
    fraud_score: t.fraud_score,
    top_factors: t.top_factors,
    model_status: t.model_status,
  };
}

export function decide(req: Required<SimulateRequest>): MockTxn {
  const card = db.cards.find((c) => c.card_id === req.card_id)!;
  const merchant = db.merchants.find((m) => m.merchant_id === req.merchant_id);
  const prior = db.txns.filter((t) => t.card_id === req.card_id && ms(t.txn_ts) < ms(req.txn_ts));
  const approved = prior.filter((t) => t.status === 'APPROVED');
  const codes: string[] = [];
  let score: number | null = 0;
  let decision: Decision = 'APPROVE';

  const velocity = prior.filter((t) => ms(req.txn_ts) - ms(t.txn_ts) <= cfg<number>('velocity_window_minutes') * 60_000).length;
  const approvedToday = approved.filter((t) => istDate(t.txn_ts) === istDate(req.txn_ts)).reduce((s, t) => s + t.amount, 0);
  const last30 = approved.filter((t) => ms(req.txn_ts) - ms(t.txn_ts) <= 30 * 86_400_000);
  const avg30 = last30.length ? last30.reduce((s, t) => s + t.amount, 0) / last30.length : null;
  let speed: number | null = null;
  if (PHYSICAL.has(req.channel)) {
    const lastPhys = approved
      .filter((t) => PHYSICAL.has(t.channel) && ms(req.txn_ts) - ms(t.txn_ts) <= cfg<number>('impossible_travel_lookback_hours') * 3_600_000)
      .sort((a, b) => ms(b.txn_ts) - ms(a.txn_ts))[0];
    if (lastPhys) {
      const km = haversineKm(lastPhys.txn_city, req.txn_city);
      const hours = (ms(req.txn_ts) - ms(lastPhys.txn_ts)) / 3_600_000;
      speed = km === 0 ? 0 : hours === 0 ? 99999.99 : km / hours;
    }
  }
  const newMerchant = !prior.some(
    (t) => t.merchant_id === req.merchant_id && ms(req.txn_ts) - ms(t.txn_ts) <= cfg<number>('new_merchant_lookback_days') * 86_400_000,
  );
  let features: MockTxn['features'] = { velocity_10m: velocity, approved_today: approvedToday, avg_amount_30d: avg30, speed_kmph: speed, new_merchant: newMerchant };

  // R1 / R2: hard stops
  if (card.card_status !== 'ACTIVE' || card.expiry_date < istDate(req.txn_ts)) codes.push('CARD_NOT_ACTIVE');
  if (req.txn_country !== 'IN' && !card.international_enabled) codes.push('INTL_NOT_ENABLED');
  if (codes.length) {
    decision = 'BLOCK';
    score = null;
    features = { velocity_10m: null, approved_today: null, avg_amount_30d: null, speed_kmph: null, new_merchant: null };
  } else {
    // R3–R6
    if (merchant?.merchant_risk === 'BLACKLISTED') codes.push('MERCHANT_BLACKLISTED');
    if (approvedToday + req.amount > card.daily_limit) codes.push('DAILY_LIMIT_EXCEEDED');
    if (velocity >= cfg<number>('velocity_burst_count')) codes.push('VELOCITY_BURST');
    if (speed != null && speed > cfg<number>('impossible_travel_kmph')) codes.push('IMPOSSIBLE_TRAVEL');
    if (codes.length) {
      decision = 'BLOCK';
      score = 100;
    } else {
      // R7–R12, then R13
      const pts = cfg<Record<string, number>>('points');
      const soft: string[] = [];
      if (velocity >= cfg<number>('velocity_stepup_min') && velocity <= cfg<number>('velocity_stepup_max')) soft.push('HIGH_VELOCITY');
      if (
        (avg30 != null && req.amount > cfg<number>('amount_spike_multiplier') * avg30 && req.amount >= cfg<number>('amount_spike_min_amount')) ||
        (avg30 == null && req.amount >= cfg<number>('amount_no_history_min_amount'))
      )
        soft.push('AMOUNT_SPIKE');
      if (req.txn_country !== card.home_country && HIGH_RISK_COUNTRIES.has(req.txn_country)) soft.push('HIGH_RISK_GEO');
      if (cfg<string[]>('high_risk_mcc').includes(req.mcc)) soft.push('HIGH_RISK_MCC');
      const h = istHour(req.txn_ts);
      if (h >= cfg<number>('odd_hour_start') && h <= cfg<number>('odd_hour_end') && req.amount >= cfg<number>('odd_hour_min_amount')) soft.push('ODD_HOUR_HIGH_VALUE');
      if (req.channel === 'ECOM' && newMerchant && req.amount >= cfg<number>('new_merchant_min_amount')) soft.push('NEW_MERCHANT_HIGH_VALUE');
      codes.push(...soft);
      score = Math.min(100, soft.reduce((s, c) => s + (pts[c] ?? 0), 0));
      if (soft.length >= cfg<number>('multiple_red_flags_count')) {
        codes.push('MULTIPLE_RED_FLAGS');
        decision = 'BLOCK';
      } else if (soft.length) decision = 'STEP_UP';
    }
  }

  // Same stub the backend uses until Dev's model is ready.
  const fraud_score = 0.1;
  const t: MockTxn = {
    ...req,
    status: decision === 'APPROVE' ? 'APPROVED' : decision === 'BLOCK' ? 'BLOCKED' : 'STEP_UP_PENDING',
    decision,
    final_decision: decision,
    reason_codes: codes,
    rule_risk_score: score,
    features,
    fraud_score,
    top_factors: [],
    model_status: 'OK',
    processed_at: nowIstIso(),
    alert_id: null,
  };
  if (decision === 'STEP_UP') {
    t.otp = String(Math.floor(100000 + Math.random() * 900000));
    t.expires_at = nowIstIso(new Date(Date.now() + cfg<number>('stepup_expiry_minutes') * 60_000));
    // The real backend prints the OTP in its console; the mock prints it in the browser console.
    console.info(`%c[mock backend] OTP for ${t.txn_id}: ${t.otp}`, 'color:#4338ca;font-weight:bold');
  }
  db.txns.push(t);
  addAudit({ entity: 'TRANSACTION', entity_id: t.txn_id, actor: 'system', role: 'ENGINE', action: 'DECISION', from_status: 'RECEIVED', to_status: t.status, comment: codes.join('|') || null, before: null, after: { decision, final_decision: decision, rule_risk_score: score, fraud_score } });
  createAlertIfNeeded(t);
  return t;
}

/** Expire step-ups older than their expires_at (the backend does this with a scheduled job). */
export function expireStepUps() {
  for (const t of db.txns) {
    if (t.status === 'STEP_UP_PENDING' && t.expires_at && ms(t.expires_at) < Date.now()) {
      t.status = 'BLOCKED';
      t.reason_codes = [...t.reason_codes, 'STEP_UP_TIMEOUT'];
      addAudit({ entity: 'TRANSACTION', entity_id: t.txn_id, actor: 'system', role: 'ENGINE', action: 'STEP_UP_TIMEOUT', from_status: 'STEP_UP_PENDING', to_status: 'BLOCKED', comment: 'STEP_UP_TIMEOUT', before: null, after: null });
      createAlertIfNeeded(t);
    }
  }
}
