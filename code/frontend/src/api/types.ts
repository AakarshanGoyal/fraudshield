// Types mirror API_CONTRACT.md exactly. If the contract changes, change this file first.

export type Role = 'CARDHOLDER' | 'ANALYST' | 'MANAGER';
export type TxnStatus = 'RECEIVED' | 'STEP_UP_PENDING' | 'APPROVED' | 'BLOCKED';
export type Decision = 'APPROVE' | 'STEP_UP' | 'BLOCK';
export type AlertStatus =
  | 'OPEN'
  | 'IN_REVIEW'
  | 'PENDING_MANAGER_APPROVAL'
  | 'CONFIRMED_FRAUD'
  | 'FALSE_POSITIVE';
export type Priority = 'HIGH' | 'MEDIUM';
export type CardStatus = 'ACTIVE' | 'BLOCKED' | 'EXPIRED';
export type ModelStatus = 'OK' | 'MODEL_UNAVAILABLE';
export type Channel = 'POS' | 'ECOM' | 'ATM' | 'CONTACTLESS';
export type AuditEntity = 'TRANSACTION' | 'ALERT' | 'CARD' | 'CONFIG';

export const CHANNELS: Channel[] = ['POS', 'ECOM', 'ATM', 'CONTACTLESS'];
export const ALERT_STATUSES: AlertStatus[] = [
  'OPEN',
  'IN_REVIEW',
  'PENDING_MANAGER_APPROVAL',
  'CONFIRMED_FRAUD',
  'FALSE_POSITIVE',
];
export const OPEN_ALERT_STATUSES: AlertStatus[] = ['OPEN', 'IN_REVIEW', 'PENDING_MANAGER_APPROVAL'];

// Error format (section 0)
export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

// Section 3
export interface User {
  user_id: string;
  username: string;
  role: Role;
  customer_id: string | null;
  display_name: string;
}
export interface LoginResponse {
  token: string;
  user: User;
}

// Section 4
export interface Card {
  card_id: string;
  masked_number: string;
  card_type: 'DEBIT' | 'CREDIT';
  card_status: CardStatus;
  expiry_date: string;
  daily_limit: number;
  international_enabled: boolean;
}
export interface MyTransaction {
  txn_id: string;
  card_id: string;
  txn_ts: string;
  amount: number;
  merchant_name: string;
  channel: Channel;
  txn_city: string;
  status: TxnStatus;
  message: string;
}
export interface PendingStepUp {
  txn_id: string;
  card_id: string;
  amount: number;
  merchant_name: string;
  txn_ts: string;
  expires_at: string;
}
export type StepUpResponse =
  | { response: 'CONFIRM'; otp: string }
  | { response: 'NOT_ME' };
export interface StepUpResult {
  txn_id: string;
  status: TxnStatus;
  message: string;
}

// Section 5
export interface AlertListItem {
  alert_id: number;
  txn_id: string;
  priority: Priority;
  status: AlertStatus;
  created_at: string;
  sla_due_at: string;
  sla_breached: boolean;
  amount: number;
  card_id: string;
  card_last4: string;
  merchant_name: string;
  reason_codes: string[];
  fraud_score: number | null;
  claimed_by: string | null;
}
export interface AlertDetail {
  alert: {
    alert_id: number;
    priority: Priority;
    status: AlertStatus;
    sla_due_at: string;
    sla_breached: boolean;
    claimed_by: string | null;
    proposed_by: string | null;
    comment: string | null;
  };
  transaction: {
    txn_id: string;
    txn_ts: string;
    amount: number;
    channel: Channel;
    merchant_id: string;
    merchant_name: string;
    mcc: string;
    txn_city: string;
    txn_country: string;
    status: TxnStatus;
    decision: Decision;
    final_decision: Decision;
    reason_codes: string[];
    rule_risk_score: number | null;
  };
  features: {
    velocity_10m: number | null;
    approved_today: number | null;
    avg_amount_30d: number | null;
    speed_kmph: number | null;
    new_merchant: boolean | null;
  };
  ai: {
    fraud_score: number | null;
    top_factors: string[];
    model_status: ModelStatus;
    model_version: string | null;
  };
  card: {
    card_id: string;
    masked_number: string;
    card_type: 'DEBIT' | 'CREDIT';
    card_status: CardStatus;
    home_city: string;
    daily_limit: number;
  };
  recent_transactions: {
    txn_id: string;
    txn_ts: string;
    amount: number;
    txn_city: string;
    status: TxnStatus;
  }[];
  narrative: string | null;
}
export type CloseOutcome = 'CONFIRMED_FRAUD' | 'FALSE_POSITIVE';
export interface AlertStatusResult {
  alert_id: number;
  status: AlertStatus;
}

// Section 6
export type ManagerDecision = 'APPROVE' | 'REJECT';
export interface Dashboard {
  transactions_by_decision: Record<Decision, number>;
  block_rate: number;
  step_up_rate: number;
  open_alerts_by_priority: Record<Priority, number>;
  sla_breaches: number;
  false_positive_rate: number;
  top_reason_codes: { code: string; count: number }[];
}
export interface AuditRow {
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
export type ConfigValue = number | string | boolean | unknown[] | Record<string, unknown>;
export interface ConfigEntry {
  key: string;
  value: ConfigValue;
  updated_at: string;
}

// Section 2 / 7
export interface SimulateRequest {
  txn_id?: string;
  card_id: string;
  txn_ts: string;
  amount: number;
  currency: 'INR';
  merchant_id: string;
  mcc: string;
  channel: Channel;
  txn_city: string;
  txn_country: string;
}
export interface AuthorisationResponse {
  txn_id: string;
  decision: Decision;
  final_decision: Decision;
  reason_codes: string[];
  rule_risk_score: number | null;
  status: TxnStatus;
  alert_id: number | null;
  processed_at: string;
  fraud_score: number | null;
  top_factors: string[];
  model_status: ModelStatus;
}
