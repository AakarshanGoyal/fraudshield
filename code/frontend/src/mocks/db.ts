// In-memory mock database for MSW. Shapes follow API_CONTRACT.md; values follow the
// FraudShield worked examples. Only used when VITE_USE_MOCKS=true.
import type {
  AlertStatus,
  AuditEntity,
  CardStatus,
  Channel,
  ConfigValue,
  Decision,
  Priority,
  Role,
  TxnStatus,
} from '../api/types';
import { nowIstIso } from '../lib/format';

export interface MockUser {
  user_id: string;
  username: string;
  role: Role;
  customer_id: string | null;
  display_name: string;
}
export interface MockCard {
  card_id: string;
  customer_id: string;
  last4: string;
  card_type: 'DEBIT' | 'CREDIT';
  card_status: CardStatus;
  issue_date: string;
  expiry_date: string;
  home_city: string;
  home_country: string;
  daily_limit: number;
  international_enabled: boolean;
}
export interface MockMerchant {
  merchant_id: string;
  merchant_name: string;
  mcc: string;
  city: string;
  country: string;
  merchant_risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLACKLISTED';
}
export interface MockTxn {
  txn_id: string;
  card_id: string;
  txn_ts: string;
  amount: number;
  merchant_id: string;
  mcc: string;
  channel: Channel;
  txn_city: string;
  txn_country: string;
  status: TxnStatus;
  decision: Decision;
  final_decision: Decision;
  reason_codes: string[];
  rule_risk_score: number | null;
  features: {
    velocity_10m: number | null;
    approved_today: number | null;
    avg_amount_30d: number | null;
    speed_kmph: number | null;
    new_merchant: boolean | null;
  };
  fraud_score: number | null;
  top_factors: string[];
  model_status: 'OK' | 'MODEL_UNAVAILABLE';
  processed_at: string;
  alert_id: number | null;
  otp?: string;
  expires_at?: string;
}
export interface MockAlert {
  alert_id: number;
  txn_id: string;
  priority: Priority;
  status: AlertStatus;
  created_at: string;
  sla_due_at: string;
  claimed_by: string | null;
  proposed_by: string | null;
  comment: string | null;
}
export interface MockAudit {
  id: number;
  entity: AuditEntity;
  entity_id: string;
  actor: string;
  role: string;
  ts: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  comment: string | null;
  before: unknown;
  after: unknown;
}

export const CITIES: Record<string, { country: string; lat: number; lon: number }> = {
  Mumbai: { country: 'IN', lat: 19.076, lon: 72.8777 },
  Delhi: { country: 'IN', lat: 28.6139, lon: 77.209 },
  Pune: { country: 'IN', lat: 18.5204, lon: 73.8567 },
  Bengaluru: { country: 'IN', lat: 12.9716, lon: 77.5946 },
  Singapore: { country: 'SG', lat: 1.3521, lon: 103.8198 },
  'Port Xavia': { country: 'XA', lat: 4.5, lon: 30.2 },
};
export const HIGH_RISK_COUNTRIES = new Set(['XA', 'XB', 'XC']);

export const RULES_CONFIG = {
  version: '1.0',
  velocity_window_minutes: 10,
  velocity_burst_count: 5,
  velocity_stepup_min: 3,
  velocity_stepup_max: 4,
  avg_lookback_days: 30,
  amount_spike_multiplier: 5,
  amount_spike_min_amount: 10000,
  amount_spike_no_history_amount: 50000,
  impossible_travel_kmph: 800,
  travel_lookback_hours: 6,
  earth_radius_km: 6371.0,
  odd_hour_start: 0,
  odd_hour_end: 4,
  odd_hour_min_amount: 20000,
  new_merchant_lookback_days: 90,
  new_merchant_min_amount: 25000,
  high_risk_mcc: ['4829', '5967', '6051', '7995'],
  multiple_red_flags_count: 3,
  points: { HIGH_VELOCITY: 25, AMOUNT_SPIKE: 30, HIGH_RISK_GEO: 25, HIGH_RISK_MCC: 15, ODD_HOUR_HIGH_VALUE: 15, NEW_MERCHANT_HIGH_VALUE: 20 },
  step_up_expiry_minutes: 15,
  false_positive_manager_limit: 100000,
  alert_high_amount: 50000,
  sla_minutes: { HIGH: 30, MEDIUM: 240 },
  ai_step_up_threshold: 0.7,
  ai_block_threshold: 0.9,
  model_timeout_ms: 150,
};

const ago = (minutes: number) => nowIstIso(new Date(Date.now() - minutes * 60_000));
const ahead = (minutes: number) => nowIstIso(new Date(Date.now() + minutes * 60_000));

function seed() {
  const users: MockUser[] = [
    { user_id: 'U_A1', username: 'analyst1', role: 'ANALYST', customer_id: null, display_name: 'Analyst One' },
    { user_id: 'U_A2', username: 'analyst2', role: 'ANALYST', customer_id: null, display_name: 'Analyst Two' },
    { user_id: 'U_M1', username: 'manager1', role: 'MANAGER', customer_id: null, display_name: 'Manager One' },
    { user_id: 'U_M2', username: 'manager2', role: 'MANAGER', customer_id: null, display_name: 'Manager Two' },
    { user_id: 'U_C1', username: 'ravi.sharma', role: 'CARDHOLDER', customer_id: 'CU0001', display_name: 'Ravi Sharma' },
    { user_id: 'U_C2', username: 'priya.nair', role: 'CARDHOLDER', customer_id: 'CU0002', display_name: 'Priya Nair' },
  ];

  const card = (
    card_id: string,
    customer_id: string,
    last4: string,
    extra: Partial<MockCard> = {},
  ): MockCard => ({
    card_id,
    customer_id,
    last4,
    card_type: 'DEBIT',
    card_status: 'ACTIVE',
    issue_date: '2023-12-10',
    expiry_date: '2029-12-31',
    home_city: 'Mumbai',
    home_country: 'IN',
    daily_limit: 100000,
    international_enabled: false,
    ...extra,
  });
  const cards: MockCard[] = [
    card('C1007', 'CU0001', '4821'),
    card('C1005', 'CU0001', '1234', { card_type: 'CREDIT', international_enabled: true, daily_limit: 200000 }),
    card('C1009', 'CU0002', '7710'),
    card('C1010', 'CU0002', '3302'),
    card('C1002', 'CU0002', '9055', { card_status: 'BLOCKED' }),
  ];

  const merchants: MockMerchant[] = [
    { merchant_id: 'M00450', merchant_name: 'Sagar Mart Andheri', mcc: '5411', city: 'Mumbai', country: 'IN', merchant_risk: 'LOW' },
    { merchant_id: 'M00451', merchant_name: 'Bluebird Electronics Online', mcc: '5732', city: 'Mumbai', country: 'IN', merchant_risk: 'LOW' },
    { merchant_id: 'M00452', merchant_name: 'Coral Coin Exchange', mcc: '6051', city: 'Mumbai', country: 'IN', merchant_risk: 'MEDIUM' },
    { merchant_id: 'M00453', merchant_name: 'Orchid Stores Orchard Road', mcc: '5311', city: 'Singapore', country: 'SG', merchant_risk: 'LOW' },
    { merchant_id: 'M00454', merchant_name: 'Connaught Place Grocers', mcc: '5411', city: 'Delhi', country: 'IN', merchant_risk: 'LOW' },
    { merchant_id: 'M00455', merchant_name: 'FC Road Cafe', mcc: '5812', city: 'Pune', country: 'IN', merchant_risk: 'LOW' },
    { merchant_id: 'M00460', merchant_name: 'QuickCash Wallet Topup', mcc: '4829', city: 'Mumbai', country: 'IN', merchant_risk: 'BLACKLISTED' },
  ];

  const base = (t: Partial<MockTxn> & Pick<MockTxn, 'txn_id' | 'card_id' | 'txn_ts' | 'amount' | 'merchant_id'>): MockTxn => {
    const m = merchants.find((x) => x.merchant_id === t.merchant_id)!;
    return {
      mcc: m.mcc,
      channel: 'POS',
      txn_city: m.city,
      txn_country: m.country,
      status: 'APPROVED',
      decision: 'APPROVE',
      final_decision: 'APPROVE',
      reason_codes: [],
      rule_risk_score: 0,
      features: { velocity_10m: 0, approved_today: 0, avg_amount_30d: 2400, speed_kmph: null, new_merchant: false },
      fraud_score: 0.04,
      top_factors: [],
      model_status: 'OK',
      processed_at: t.txn_ts,
      alert_id: null,
      ...t,
    };
  };

  // 30-day history: ₹2,400 purchases on every card, as in the worked examples.
  const txns: MockTxn[] = [];
  let n = 100000001;
  for (const c of cards) {
    for (let d = 28; d >= 2; d -= 2) {
      txns.push(
        base({
          txn_id: `T${n++}`,
          card_id: c.card_id,
          txn_ts: ago(d * 1440 + 600),
          amount: 2400,
          merchant_id: d % 4 === 0 ? 'M00450' : 'M00451',
          channel: d % 4 === 0 ? 'POS' : 'ECOM',
        }),
      );
    }
  }

  // Worked-example transactions behind the seeded alerts.
  txns.push(
    base({ txn_id: 'T200000004', card_id: 'C1005', txn_ts: ago(62), amount: 2400, merchant_id: 'M00450' }),
    base({
      txn_id: 'T200000005', card_id: 'C1005', txn_ts: ago(2), amount: 4000, merchant_id: 'M00454',
      status: 'BLOCKED', decision: 'BLOCK', final_decision: 'BLOCK', reason_codes: ['IMPOSSIBLE_TRAVEL'], rule_risk_score: 100,
      features: { velocity_10m: 0, approved_today: 2400, avg_amount_30d: 2400, speed_kmph: 1148.09, new_merchant: true },
      fraud_score: 0.8812,
      top_factors: ['card used in Mumbai 1 hour earlier (1,148 km away)', 'first payment at this merchant', 'in-person card payment'],
      alert_id: 15,
    }),
    base({
      txn_id: 'T200000010', card_id: 'C1010', txn_ts: '2026-03-04T02:30:00+05:30', amount: 45000, merchant_id: 'M00452', channel: 'ECOM',
      status: 'BLOCKED', decision: 'BLOCK', final_decision: 'BLOCK',
      reason_codes: ['AMOUNT_SPIKE', 'HIGH_RISK_MCC', 'ODD_HOUR_HIGH_VALUE', 'NEW_MERCHANT_HIGH_VALUE', 'MULTIPLE_RED_FLAGS'],
      rule_risk_score: 80,
      features: { velocity_10m: 0, approved_today: 0, avg_amount_30d: 2400, speed_kmph: null, new_merchant: true },
      fraud_score: 0.9641,
      top_factors: ["amount 18.8x the card's 30-day average", 'crypto / forex merchant', 'payment at 02:30 at night'],
      alert_id: 16,
    }),
    base({
      txn_id: 'T200000031', card_id: 'C1009', txn_ts: ago(95), amount: 1200, merchant_id: 'M00451', channel: 'ECOM',
      status: 'BLOCKED', decision: 'BLOCK', final_decision: 'BLOCK', reason_codes: ['VELOCITY_BURST'], rule_risk_score: 100,
      features: { velocity_10m: 5, approved_today: 4800, avg_amount_30d: 2243.48, speed_kmph: null, new_merchant: false },
      fraud_score: 0.6233,
      top_factors: ['5 payments in the last 10 minutes', 'online payment', '9 payments in the last 24 hours'],
      alert_id: 17,
    }),
    base({
      txn_id: 'T200000042', card_id: 'C1005', txn_ts: ago(25), amount: 120000, merchant_id: 'M00451', channel: 'ECOM',
      status: 'BLOCKED', decision: 'BLOCK', final_decision: 'BLOCK', reason_codes: ['MULTIPLE_RED_FLAGS'], rule_risk_score: 75,
      features: { velocity_10m: 0, approved_today: 0, avg_amount_30d: 2400, speed_kmph: null, new_merchant: false },
      fraud_score: null, top_factors: [], model_status: 'MODEL_UNAVAILABLE',
      alert_id: 18,
    }),
    base({
      txn_id: 'T200000043', card_id: 'C1010', txn_ts: ago(180), amount: 135000, merchant_id: 'M00451', channel: 'ECOM',
      status: 'BLOCKED', decision: 'BLOCK', final_decision: 'BLOCK', reason_codes: ['IMPOSSIBLE_TRAVEL'], rule_risk_score: 100,
      features: { velocity_10m: 0, approved_today: 0, avg_amount_30d: 2400, speed_kmph: 912.4, new_merchant: false },
      fraud_score: 0.3120, top_factors: ['amount 56x the card\'s 30-day average', 'online payment', 'electronics merchant'],
      alert_id: 19,
    }),
    base({
      txn_id: 'T200000044', card_id: 'C1009', txn_ts: '2026-03-04T11:12:00+05:30', amount: 8000, merchant_id: 'M00460',
      status: 'BLOCKED', decision: 'BLOCK', final_decision: 'BLOCK', reason_codes: ['MERCHANT_BLACKLISTED'], rule_risk_score: 100,
      fraud_score: 0.7012, top_factors: ['blacklisted merchant', 'money-transfer merchant', 'first payment at this merchant'],
      alert_id: 20,
    }),
    base({
      txn_id: 'T200000045', card_id: 'C1007', txn_ts: '2026-03-04T16:40:00+05:30', amount: 3000, merchant_id: 'M00455',
      status: 'BLOCKED', decision: 'STEP_UP', final_decision: 'STEP_UP', reason_codes: ['HIGH_VELOCITY', 'STEP_UP_TIMEOUT'], rule_risk_score: 25,
      fraud_score: 0.2210, top_factors: ['3 payments in the last 10 minutes', 'in-person card payment', 'restaurant'],
      alert_id: 21,
    }),
    // A step-up already waiting for Ravi (card C1007), like worked example 7.
    base({
      txn_id: 'T200000007', card_id: 'C1007', txn_ts: ago(1), amount: 15000, merchant_id: 'M00451', channel: 'ECOM',
      status: 'STEP_UP_PENDING', decision: 'STEP_UP', final_decision: 'STEP_UP', reason_codes: ['AMOUNT_SPIKE'], rule_risk_score: 30,
      fraud_score: 0.412, top_factors: ["amount 6.3x the card's 30-day average", 'online payment', 'electronics merchant'],
      otp: '123456', expires_at: ahead(14),
    }),
  );

  const alerts: MockAlert[] = [
    { alert_id: 15, txn_id: 'T200000005', priority: 'HIGH', status: 'OPEN', created_at: ago(2), sla_due_at: ahead(28), claimed_by: null, proposed_by: null, comment: null },
    { alert_id: 16, txn_id: 'T200000010', priority: 'HIGH', status: 'OPEN', created_at: '2026-03-04T02:30:00+05:30', sla_due_at: '2026-03-04T03:00:00+05:30', claimed_by: null, proposed_by: null, comment: null },
    { alert_id: 17, txn_id: 'T200000031', priority: 'MEDIUM', status: 'IN_REVIEW', created_at: ago(95), sla_due_at: ahead(145), claimed_by: 'analyst2', proposed_by: null, comment: null },
    { alert_id: 18, txn_id: 'T200000042', priority: 'HIGH', status: 'OPEN', created_at: ago(25), sla_due_at: ahead(5), claimed_by: null, proposed_by: null, comment: null },
    { alert_id: 19, txn_id: 'T200000043', priority: 'HIGH', status: 'PENDING_MANAGER_APPROVAL', created_at: ago(180), sla_due_at: ago(150), claimed_by: 'analyst1', proposed_by: 'analyst1', comment: 'Customer confirmed by phone, genuine laptop purchase while travelling.' },
    { alert_id: 20, txn_id: 'T200000044', priority: 'MEDIUM', status: 'CONFIRMED_FRAUD', created_at: '2026-03-04T11:12:00+05:30', sla_due_at: '2026-03-04T15:12:00+05:30', claimed_by: 'analyst1', proposed_by: null, comment: 'Blacklisted wallet top-up, customer denied the payment.' },
    { alert_id: 21, txn_id: 'T200000045', priority: 'MEDIUM', status: 'FALSE_POSITIVE', created_at: '2026-03-04T16:55:00+05:30', sla_due_at: '2026-03-04T20:55:00+05:30', claimed_by: 'analyst2', proposed_by: null, comment: 'Customer was at a restaurant with friends, genuine.' },
  ];

  // Same keys, values and order as data/case_01_rules_config_V1.0.json (copied, because the
  // Docker build context is code/frontend and can't read ../../data).
  const config: { key: string; value: ConfigValue; updated_at: string }[] = Object.entries(RULES_CONFIG).map(
    ([key, value]) => ({ key, value: structuredClone(value) as ConfigValue, updated_at: '2026-03-04T09:00:00+05:30' }),
  );

  const audit: MockAudit[] = [];
  return { users, cards, merchants, txns, alerts, config, audit, nextAlertId: 22, nextAuditId: 100 };
}

export const db = seed();

export function addAudit(row: Omit<MockAudit, 'id' | 'ts'> & { ts?: string }) {
  db.audit.push({ id: db.nextAuditId++, ts: row.ts ?? nowIstIso(), ...row });
}

// Audit history for the seeded records so the audit screen has something to show.
for (const t of db.txns.filter((x) => x.txn_id.startsWith('T2'))) {
  addAudit({
    entity: 'TRANSACTION', entity_id: t.txn_id, actor: 'system', role: 'ENGINE', ts: t.txn_ts,
    action: 'DECISION', from_status: 'RECEIVED', to_status: t.status === 'BLOCKED' && t.decision === 'STEP_UP' ? 'STEP_UP_PENDING' : t.status,
    comment: t.reason_codes.join('|') || null, before: null,
    after: { decision: t.decision, final_decision: t.final_decision, rule_risk_score: t.rule_risk_score, fraud_score: t.fraud_score },
  });
}
for (const a of db.alerts) {
  addAudit({ entity: 'ALERT', entity_id: String(a.alert_id), actor: 'system', role: 'ENGINE', ts: a.created_at, action: 'CREATED', from_status: null, to_status: 'OPEN', comment: null, before: null, after: { priority: a.priority, sla_due_at: a.sla_due_at } });
  if (a.claimed_by) addAudit({ entity: 'ALERT', entity_id: String(a.alert_id), actor: a.claimed_by, role: 'ANALYST', ts: a.created_at, action: 'CLAIM', from_status: 'OPEN', to_status: 'IN_REVIEW', comment: null, before: null, after: null });
  if (a.status !== 'OPEN' && a.status !== 'IN_REVIEW')
    addAudit({ entity: 'ALERT', entity_id: String(a.alert_id), actor: a.claimed_by ?? 'analyst1', role: 'ANALYST', ts: a.sla_due_at, action: 'CLOSE', from_status: 'IN_REVIEW', to_status: a.status, comment: a.comment, before: null, after: null });
}
