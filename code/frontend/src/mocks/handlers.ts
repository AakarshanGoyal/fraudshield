// MSW handlers for every endpoint the frontend calls (API_CONTRACT.md sections 3–7).
import { http, HttpResponse, type DefaultBodyType } from 'msw';
import type { AlertListItem, AlertStatus, ConfigValue, Role, SimulateRequest } from '../api/types';
import { CHANNELS } from '../api/types';
import { API_URL } from '../config';
import { nowIstIso } from '../lib/format';
import { CITIES, addAudit, db, type MockAlert, type MockTxn, type MockUser } from './db';
import { createAlertIfNeeded, decide, expireStepUps, toResponse } from './engine';

const url = (path: string) => `${API_URL}${path}`;

const err = (status: number, code: string, message: string, fields?: Record<string, string>) =>
  HttpResponse.json({ error: { code, message, ...(fields ? { fields } : {}) } }, { status });
const validation = (fields: Record<string, string>, message = 'Invalid input') =>
  err(422, 'VALIDATION_ERROR', message, fields);

function auth(request: Request, roles: Role[]): MockUser | Response {
  const header = request.headers.get('Authorization') ?? '';
  const username = header.startsWith('Bearer mock.') ? header.slice('Bearer mock.'.length) : null;
  const user = db.users.find((u) => u.username === username);
  if (!user) return err(401, 'UNAUTHORIZED', 'Please log in again.');
  if (!roles.includes(user.role)) return err(403, 'FORBIDDEN', 'You do not have access to this.');
  return user;
}
const isResponse = (x: unknown): x is Response => x instanceof Response;

async function body<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

const merchantName = (id: string) => db.merchants.find((m) => m.merchant_id === id)?.merchant_name ?? id;
const ms = (iso: string) => new Date(iso).getTime();
const CLOSED: AlertStatus[] = ['CONFIRMED_FRAUD', 'FALSE_POSITIVE'];
const slaBreached = (a: MockAlert) => !CLOSED.includes(a.status) && Date.now() > ms(a.sla_due_at);

// Section 1: reason code → neutral cardholder message.
function cardholderMessage(t: MockTxn): string {
  const c = t.reason_codes;
  if (t.status === 'APPROVED') return 'Payment approved.';
  if (t.status === 'STEP_UP_PENDING') return 'We need to confirm this payment with you.';
  if (c.includes('STEP_UP_DENIED')) return "You told us this wasn't you. The card has been blocked.";
  if (c.includes('STEP_UP_TIMEOUT')) return "We didn't hear back in time, so the payment was declined.";
  if (c.includes('CARD_NOT_ACTIVE')) return 'Your card is not active.';
  if (c.includes('INTL_NOT_ENABLED')) return 'International payments are not enabled on this card.';
  if (c.length === 1 && c[0] === 'DAILY_LIMIT_EXCEEDED') return 'This payment is above your daily limit.';
  return 'This payment was declined for your safety.';
}

function alertListItem(a: MockAlert): AlertListItem {
  const t = db.txns.find((x) => x.txn_id === a.txn_id)!;
  const card = db.cards.find((c) => c.card_id === t.card_id)!;
  return {
    alert_id: a.alert_id,
    txn_id: a.txn_id,
    priority: a.priority,
    status: a.status,
    created_at: a.created_at,
    sla_due_at: a.sla_due_at,
    sla_breached: slaBreached(a),
    amount: t.amount,
    card_id: t.card_id,
    card_last4: card.last4,
    merchant_name: merchantName(t.merchant_id),
    reason_codes: t.reason_codes,
    fraud_score: t.fraud_score,
    claimed_by: a.claimed_by,
  };
}

function blockCard(card_id: string, actor: string, role: string, comment: string) {
  const card = db.cards.find((c) => c.card_id === card_id)!;
  if (card.card_status === 'BLOCKED') return;
  addAudit({ entity: 'CARD', entity_id: card_id, actor, role, action: 'BLOCK', from_status: card.card_status, to_status: 'BLOCKED', comment, before: null, after: null });
  card.card_status = 'BLOCKED';
}

// Same type checks as the real backend (Aakarshan's notes), so the UI handles real 422s.
function configTypeError(current: ConfigValue, next: unknown): string | null {
  const kind = (v: unknown) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
  if (kind(next) !== kind(current)) return `must be a ${kind(current)}`;
  if (typeof next === 'number' && next < 0) return 'must be a non-negative number';
  return null;
}

// Small delay so loading states are visible during development.
const delay = () => new Promise((r) => setTimeout(r, 250));

export const handlers = [
  // ---------- 3. Auth ----------
  http.post(url('/api/auth/login'), async ({ request }) => {
    await delay();
    const { username, password } = await body<{ username?: string; password?: string }>(request);
    const fields: Record<string, string> = {};
    if (!username) fields.username = 'required';
    if (!password) fields.password = 'required';
    if (Object.keys(fields).length) return validation(fields);
    const user = db.users.find((u) => u.username === username);
    if (!user || password !== 'demo123') return err(401, 'UNAUTHORIZED', 'Wrong username or password.');
    return HttpResponse.json({ token: `mock.${user.username}`, user });
  }),

  http.get(url('/api/auth/me'), ({ request }) => {
    const u = auth(request, ['CARDHOLDER', 'ANALYST', 'MANAGER']);
    return isResponse(u) ? u : HttpResponse.json(u);
  }),

  // ---------- 4. Cardholder ----------
  http.get(url('/api/me/cards'), async ({ request }) => {
    await delay();
    const u = auth(request, ['CARDHOLDER']);
    if (isResponse(u)) return u;
    return HttpResponse.json(
      db.cards
        .filter((c) => c.customer_id === u.customer_id)
        .map((c) => ({
          card_id: c.card_id,
          masked_number: `XXXXXXXXXXXX${c.last4}`,
          card_type: c.card_type,
          card_status: c.card_status,
          expiry_date: c.expiry_date,
          daily_limit: c.daily_limit,
          international_enabled: c.international_enabled,
        })),
    );
  }),

  http.get(url('/api/me/transactions'), async ({ request }) => {
    await delay();
    const u = auth(request, ['CARDHOLDER']);
    if (isResponse(u)) return u;
    expireStepUps();
    const params = new URL(request.url).searchParams;
    const cardId = params.get('card_id');
    const limit = Number(params.get('limit') ?? 50);
    const mine = new Set(db.cards.filter((c) => c.customer_id === u.customer_id).map((c) => c.card_id));
    if (cardId && !mine.has(cardId)) return err(403, 'FORBIDDEN', 'This card does not belong to you.');
    return HttpResponse.json(
      db.txns
        .filter((t) => (cardId ? t.card_id === cardId : mine.has(t.card_id)))
        .sort((a, b) => ms(b.txn_ts) - ms(a.txn_ts))
        .slice(0, limit)
        .map((t) => ({
          txn_id: t.txn_id,
          card_id: t.card_id,
          txn_ts: t.txn_ts,
          amount: t.amount,
          merchant_name: merchantName(t.merchant_id),
          channel: t.channel,
          txn_city: t.txn_city,
          status: t.status,
          message: cardholderMessage(t),
        })),
    );
  }),

  http.get(url('/api/me/stepups/pending'), ({ request }) => {
    const u = auth(request, ['CARDHOLDER']);
    if (isResponse(u)) return u;
    expireStepUps();
    const mine = new Set(db.cards.filter((c) => c.customer_id === u.customer_id).map((c) => c.card_id));
    return HttpResponse.json(
      db.txns
        .filter((t) => t.status === 'STEP_UP_PENDING' && mine.has(t.card_id))
        .map((t) => ({
          txn_id: t.txn_id,
          card_id: t.card_id,
          amount: t.amount,
          merchant_name: merchantName(t.merchant_id),
          txn_ts: t.txn_ts,
          expires_at: t.expires_at!,
        })),
    );
  }),

  http.post(url('/api/me/stepups/:txn_id/respond'), async ({ request, params }) => {
    await delay();
    const u = auth(request, ['CARDHOLDER']);
    if (isResponse(u)) return u;
    expireStepUps();
    const t = db.txns.find((x) => x.txn_id === params.txn_id);
    if (!t) return err(404, 'NOT_FOUND', 'Transaction not found.');
    const card = db.cards.find((c) => c.card_id === t.card_id)!;
    if (card.customer_id !== u.customer_id) return err(403, 'FORBIDDEN', 'This payment does not belong to you.');
    if (t.status !== 'STEP_UP_PENDING') return err(409, 'CONFLICT', 'This request has expired.');
    const b = await body<{ response?: string; otp?: string }>(request);
    if (b.response !== 'CONFIRM' && b.response !== 'NOT_ME')
      return validation({ response: 'must be CONFIRM or NOT_ME' });
    if (b.response === 'CONFIRM') {
      if (b.otp !== t.otp) return validation({ otp: 'incorrect' }, 'Incorrect OTP');
      t.status = 'APPROVED';
      addAudit({ entity: 'TRANSACTION', entity_id: t.txn_id, actor: u.username, role: 'CARDHOLDER', action: 'STEP_UP_CONFIRM', from_status: 'STEP_UP_PENDING', to_status: 'APPROVED', comment: null, before: null, after: null });
    } else {
      t.status = 'BLOCKED';
      t.reason_codes = [...t.reason_codes, 'STEP_UP_DENIED'];
      addAudit({ entity: 'TRANSACTION', entity_id: t.txn_id, actor: u.username, role: 'CARDHOLDER', action: 'STEP_UP_DENIED', from_status: 'STEP_UP_PENDING', to_status: 'BLOCKED', comment: 'STEP_UP_DENIED', before: null, after: null });
      blockCard(t.card_id, u.username, 'CARDHOLDER', 'STEP_UP_DENIED');
      createAlertIfNeeded(t);
    }
    return HttpResponse.json({ txn_id: t.txn_id, status: t.status, message: cardholderMessage(t) });
  }),

  http.post(url('/api/me/cards/:card_id/block'), async ({ request, params }) => {
    await delay();
    const u = auth(request, ['CARDHOLDER']);
    if (isResponse(u)) return u;
    const card = db.cards.find((c) => c.card_id === params.card_id);
    if (!card) return err(404, 'NOT_FOUND', 'Card not found.');
    if (card.customer_id !== u.customer_id) return err(403, 'FORBIDDEN', 'This card does not belong to you.');
    blockCard(card.card_id, u.username, 'CARDHOLDER', 'Blocked by cardholder');
    return HttpResponse.json({ card_id: card.card_id, card_status: 'BLOCKED' });
  }),

  // ---------- 5. Analyst ----------
  http.get(url('/api/alerts'), ({ request }) => {
    const u = auth(request, ['ANALYST', 'MANAGER']);
    if (isResponse(u)) return u;
    expireStepUps();
    const params = new URL(request.url).searchParams;
    const statuses = params.get('status')?.split(',').filter(Boolean);
    const priority = params.get('priority');
    const rank = { HIGH: 0, MEDIUM: 1 };
    return HttpResponse.json(
      db.alerts
        .filter((a) => (!statuses || statuses.includes(a.status)) && (!priority || a.priority === priority))
        .sort((a, b) => rank[a.priority] - rank[b.priority] || ms(a.sla_due_at) - ms(b.sla_due_at))
        .map(alertListItem),
    );
  }),

  http.get(url('/api/alerts/:alert_id'), async ({ request, params }) => {
    await delay();
    const u = auth(request, ['ANALYST', 'MANAGER']);
    if (isResponse(u)) return u;
    const a = db.alerts.find((x) => x.alert_id === Number(params.alert_id));
    if (!a) return err(404, 'NOT_FOUND', 'Alert not found.');
    const t = db.txns.find((x) => x.txn_id === a.txn_id)!;
    const card = db.cards.find((c) => c.card_id === t.card_id)!;
    return HttpResponse.json({
      alert: {
        alert_id: a.alert_id, priority: a.priority, status: a.status, sla_due_at: a.sla_due_at,
        sla_breached: slaBreached(a), claimed_by: a.claimed_by, proposed_by: a.proposed_by, comment: a.comment,
      },
      transaction: {
        txn_id: t.txn_id, txn_ts: t.txn_ts, amount: t.amount, channel: t.channel, merchant_id: t.merchant_id,
        merchant_name: merchantName(t.merchant_id), mcc: t.mcc, txn_city: t.txn_city, txn_country: t.txn_country,
        status: t.status, decision: t.decision, final_decision: t.final_decision, reason_codes: t.reason_codes,
        rule_risk_score: t.rule_risk_score,
      },
      features: t.features,
      ai: {
        fraud_score: t.model_status === 'OK' ? t.fraud_score : null,
        top_factors: t.top_factors,
        model_status: t.model_status,
        model_version: t.model_status === 'OK' ? 'xgb-v1' : null,
      },
      card: {
        card_id: card.card_id, masked_number: `XXXXXXXXXXXX${card.last4}`, card_type: card.card_type,
        card_status: card.card_status, home_city: card.home_city, daily_limit: card.daily_limit,
      },
      recent_transactions: db.txns
        .filter((x) => x.card_id === t.card_id && x.txn_id !== t.txn_id && ms(x.txn_ts) <= ms(t.txn_ts))
        .sort((x, y) => ms(y.txn_ts) - ms(x.txn_ts))
        .slice(0, 8)
        .map((x) => ({ txn_id: x.txn_id, txn_ts: x.txn_ts, amount: x.amount, txn_city: x.txn_city, status: x.status })),
      narrative:
        a.alert_id === 15
          ? 'Card C1005 was used for a ₹4,000.00 in-person payment in Delhi one hour after an approved payment in Mumbai, 1,148.09 km away (1,148.09 km/h). Rule IMPOSSIBLE_TRAVEL triggered with risk score 100. Model fraud score 88.12%.'
          : null,
    });
  }),

  http.post(url('/api/alerts/:alert_id/claim'), async ({ request, params }) => {
    await delay();
    const u = auth(request, ['ANALYST']);
    if (isResponse(u)) return u;
    const a = db.alerts.find((x) => x.alert_id === Number(params.alert_id));
    if (!a) return err(404, 'NOT_FOUND', 'Alert not found.');
    if (a.status !== 'OPEN')
      return err(409, 'CONFLICT', a.claimed_by ? `Already claimed by ${a.claimed_by}.` : 'This alert was already changed by someone else.');
    a.status = 'IN_REVIEW';
    a.claimed_by = u.username;
    addAudit({ entity: 'ALERT', entity_id: String(a.alert_id), actor: u.username, role: 'ANALYST', action: 'CLAIM', from_status: 'OPEN', to_status: 'IN_REVIEW', comment: null, before: null, after: null });
    return HttpResponse.json({
      alert_id: a.alert_id, priority: a.priority, status: a.status, sla_due_at: a.sla_due_at,
      sla_breached: slaBreached(a), claimed_by: a.claimed_by, proposed_by: a.proposed_by, comment: a.comment,
    });
  }),

  http.post(url('/api/alerts/:alert_id/close'), async ({ request, params }) => {
    await delay();
    const u = auth(request, ['ANALYST']);
    if (isResponse(u)) return u;
    const a = db.alerts.find((x) => x.alert_id === Number(params.alert_id));
    if (!a) return err(404, 'NOT_FOUND', 'Alert not found.');
    const b = await body<{ outcome?: string; comment?: string }>(request);
    const fields: Record<string, string> = {};
    if (b.outcome !== 'CONFIRMED_FRAUD' && b.outcome !== 'FALSE_POSITIVE') fields.outcome = 'must be CONFIRMED_FRAUD or FALSE_POSITIVE';
    if (!b.comment || b.comment.trim().length < 10) fields.comment = 'must be at least 10 characters';
    if (Object.keys(fields).length) return validation(fields);
    if (a.status !== 'IN_REVIEW') return err(409, 'CONFLICT', 'This alert was already changed by someone else.');
    if (a.claimed_by !== u.username) return err(403, 'FORBIDDEN', 'Only the analyst who claimed this alert can close it.');
    const t = db.txns.find((x) => x.txn_id === a.txn_id)!;
    const limit = db.config.find((c) => c.key === 'false_positive_manager_limit')!.value as number;
    const from = a.status;
    a.comment = b.comment!.trim();
    if (b.outcome === 'CONFIRMED_FRAUD') {
      a.status = 'CONFIRMED_FRAUD';
      blockCard(t.card_id, u.username, 'ANALYST', `Confirmed fraud on alert ${a.alert_id}`);
    } else if (t.amount > limit) {
      a.status = 'PENDING_MANAGER_APPROVAL';
      a.proposed_by = u.username;
    } else {
      a.status = 'FALSE_POSITIVE';
    }
    addAudit({ entity: 'ALERT', entity_id: String(a.alert_id), actor: u.username, role: 'ANALYST', action: 'CLOSE', from_status: from, to_status: a.status, comment: a.comment, before: null, after: { outcome: b.outcome } });
    return HttpResponse.json({ alert_id: a.alert_id, status: a.status });
  }),

  // ---------- 6. Manager ----------
  http.post(url('/api/alerts/:alert_id/decision'), async ({ request, params }) => {
    await delay();
    const u = auth(request, ['MANAGER']);
    if (isResponse(u)) return u;
    const a = db.alerts.find((x) => x.alert_id === Number(params.alert_id));
    if (!a) return err(404, 'NOT_FOUND', 'Alert not found.');
    const b = await body<{ decision?: string; comment?: string }>(request);
    const fields: Record<string, string> = {};
    if (b.decision !== 'APPROVE' && b.decision !== 'REJECT') fields.decision = 'must be APPROVE or REJECT';
    if (!b.comment || b.comment.trim().length < 10) fields.comment = 'must be at least 10 characters';
    if (Object.keys(fields).length) return validation(fields);
    if (a.status !== 'PENDING_MANAGER_APPROVAL') return err(409, 'CONFLICT', 'Already decided by someone else.');
    if (a.proposed_by === u.username) return err(403, 'FORBIDDEN', 'You cannot approve a proposal you made (maker and checker must differ).');
    a.status = b.decision === 'APPROVE' ? 'FALSE_POSITIVE' : 'CONFIRMED_FRAUD';
    const t = db.txns.find((x) => x.txn_id === a.txn_id)!;
    if (a.status === 'CONFIRMED_FRAUD') blockCard(t.card_id, u.username, 'MANAGER', `Manager rejected false positive on alert ${a.alert_id}`);
    addAudit({ entity: 'ALERT', entity_id: String(a.alert_id), actor: u.username, role: 'MANAGER', action: `MANAGER_${b.decision}`, from_status: 'PENDING_MANAGER_APPROVAL', to_status: a.status, comment: b.comment!.trim(), before: null, after: null });
    return HttpResponse.json({ alert_id: a.alert_id, status: a.status });
  }),

  http.get(url('/api/dashboard'), async ({ request }) => {
    await delay();
    const u = auth(request, ['MANAGER']);
    if (isResponse(u)) return u;
    const p = new URL(request.url).searchParams;
    const from = p.get('from') ?? '0000-01-01';
    const to = p.get('to') ?? '9999-12-31';
    const day = (iso: string) => new Date(ms(iso) + 330 * 60_000).toISOString().slice(0, 10);
    const txns = db.txns.filter((t) => day(t.txn_ts) >= from && day(t.txn_ts) <= to);
    const by = { APPROVE: 0, STEP_UP: 0, BLOCK: 0 };
    const codeCount: Record<string, number> = {};
    for (const t of txns) {
      by[t.final_decision]++;
      for (const c of t.reason_codes) codeCount[c] = (codeCount[c] ?? 0) + 1;
    }
    const alerts = db.alerts.filter((a) => day(a.created_at) >= from && day(a.created_at) <= to);
    const open = alerts.filter((a) => !CLOSED.includes(a.status));
    const closed = alerts.filter((a) => CLOSED.includes(a.status));
    const total = txns.length || 1;
    return HttpResponse.json({
      transactions_by_decision: by,
      block_rate: +(by.BLOCK / total).toFixed(4),
      step_up_rate: +(by.STEP_UP / total).toFixed(4),
      open_alerts_by_priority: {
        HIGH: open.filter((a) => a.priority === 'HIGH').length,
        MEDIUM: open.filter((a) => a.priority === 'MEDIUM').length,
      },
      sla_breaches: alerts.filter(slaBreached).length,
      false_positive_rate: closed.length ? +(closed.filter((a) => a.status === 'FALSE_POSITIVE').length / closed.length).toFixed(4) : 0,
      top_reason_codes: Object.entries(codeCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([code, count]) => ({ code, count })),
    });
  }),

  http.get(url('/api/audit'), async ({ request }) => {
    await delay();
    const u = auth(request, ['MANAGER']);
    if (isResponse(u)) return u;
    const p = new URL(request.url).searchParams;
    const entity = p.get('entity');
    const id = p.get('entity_id');
    if (!entity || !['TRANSACTION', 'ALERT', 'CARD', 'CONFIG'].includes(entity))
      return validation({ entity: 'must be TRANSACTION, ALERT, CARD or CONFIG' });
    return HttpResponse.json(
      db.audit
        .filter((r) => r.entity === entity && (!id || r.entity_id === id))
        .sort((a, b) => ms(a.ts) - ms(b.ts) || a.id - b.id),
    );
  }),

  http.get(url('/api/audit/export'), ({ request }) => {
    const u = auth(request, ['MANAGER']);
    if (isResponse(u)) return u;
    const p = new URL(request.url).searchParams;
    const rows = db.audit.filter((r) => r.entity === p.get('entity') && (!p.get('entity_id') || r.entity_id === p.get('entity_id')));
    const cols = ['id', 'entity', 'entity_id', 'actor', 'role', 'ts', 'action', 'from_status', 'to_status', 'comment', 'before', 'after'] as const;
    const cell = (v: unknown) => {
      const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
    return new HttpResponse(csv, { headers: { 'Content-Type': 'text/csv' } });
  }),

  http.get(url('/api/config'), async ({ request }) => {
    await delay();
    const u = auth(request, ['MANAGER']);
    if (isResponse(u)) return u;
    return HttpResponse.json(db.config);
  }),

  http.put(url('/api/config/:key'), async ({ request, params }) => {
    await delay();
    const u = auth(request, ['MANAGER']);
    if (isResponse(u)) return u;
    const key = decodeURIComponent(String(params.key));
    const entry = db.config.find((c) => c.key === key);
    if (!entry) return err(404, 'NOT_FOUND', `Unknown config key ${key}.`);
    if (key === 'version') return validation({ key: 'version is read-only' });
    const b = await body<{ value?: DefaultBodyType }>(request);
    if (!('value' in b) || b.value === undefined) return validation({ value: 'required' });
    const problem = configTypeError(entry.value, b.value);
    if (problem) return validation({ value: problem });
    const before = entry.value;
    entry.value = b.value as ConfigValue;
    entry.updated_at = nowIstIso();
    addAudit({ entity: 'CONFIG', entity_id: key, actor: u.username, role: 'MANAGER', action: 'UPDATE', from_status: null, to_status: null, comment: null, before: { value: before }, after: { value: entry.value } });
    return HttpResponse.json({ key, value: entry.value });
  }),

  // ---------- 7. Simulate ----------
  http.post(url('/api/simulate'), async ({ request }) => {
    await delay();
    const u = auth(request, ['ANALYST', 'MANAGER']);
    if (isResponse(u)) return u;
    const b = await body<Partial<SimulateRequest>>(request);
    const fields: Record<string, string> = {};
    if (b.txn_id && !/^T[0-9]{9}$/.test(b.txn_id)) fields.txn_id = 'must match ^T[0-9]{9}$';
    if (!b.card_id) fields.card_id = 'required';
    else if (!db.cards.some((c) => c.card_id === b.card_id)) fields.card_id = 'unknown card';
    if (!b.txn_ts || Number.isNaN(new Date(b.txn_ts).getTime())) fields.txn_ts = 'must be ISO-8601 with +05:30';
    if (typeof b.amount !== 'number' || !(b.amount > 0) || b.amount > 1_000_000) fields.amount = 'must be > 0 and ≤ 1000000';
    if (b.currency !== 'INR') fields.currency = 'INR only';
    if (!b.merchant_id) fields.merchant_id = 'required';
    if (!b.mcc || !/^[0-9]{4}$/.test(b.mcc)) fields.mcc = 'must be 4 digits';
    if (!b.channel || !CHANNELS.includes(b.channel)) fields.channel = 'must be POS, ECOM, ATM or CONTACTLESS';
    if (!b.txn_city || !CITIES[b.txn_city]) fields.txn_city = 'city must exist in cities';
    else if (b.txn_country !== CITIES[b.txn_city].country) fields.txn_country = `must be ${CITIES[b.txn_city].country} for ${b.txn_city}`;
    if (Object.keys(fields).length) return validation(fields);

    const txn_id = b.txn_id || `T${Math.floor(300000000 + Math.random() * 699999999)}`;
    const existing = db.txns.find((t) => t.txn_id === txn_id);
    if (existing) return HttpResponse.json(toResponse(existing)); // idempotent
    return HttpResponse.json(toResponse(decide({ ...(b as Required<SimulateRequest>), txn_id })));
  }),
];
