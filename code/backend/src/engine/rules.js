// FraudShield decision engine (pure functions, no database).
// The live API and the batch command both call evaluate(); only the way they fetch
// "prior transactions" differs.
//
// Inputs (all plain objects):
//   txn      { txn_id, card_id, txn_ts, amount, merchant_id, mcc, channel, txn_city, txn_country }
//   prior    transactions of the SAME card with txn_ts strictly earlier:
//            [{ txn_id, txn_ts, amount, merchant_id, channel, txn_city, status }]
//            status: APPROVED / BLOCKED / STEP_UP_PENDING (pending counts for velocity and
//            new-merchant, never as APPROVED)
//   card     { card_status, expiry_date, home_city, home_country, daily_limit, international_enabled, issue_date, card_type }
//   ctx      { cities: Map(city -> {lat, lon, country, city_tier}),
//              merchants: Map(id -> {merchant_risk, mcc}),
//              countryRisk: Map(code -> 'LOW'|'HIGH'),
//              mccs: Map(mcc -> {mcc_category}) }
//   cfg      rules config object (keys exactly as in case_01_rules_config_V1.0.json)

const {
  DAY_MS, HOUR_MS, MIN_MS, PHYSICAL, toMs, istDate, istHour, toIstIso, toPaise, dateStr, haversineKm,
} = require('./util');

const FRAUD_CODES = new Set([
  'MERCHANT_BLACKLISTED', 'VELOCITY_BURST', 'IMPOSSIBLE_TRAVEL', 'MULTIPLE_RED_FLAGS',
  'STEP_UP_DENIED', 'STEP_UP_TIMEOUT', 'HIGH_FRAUD_SCORE_MODEL',
]);
const HIGH_PRIORITY_CODES = new Set(['IMPOSSIBLE_TRAVEL', 'MULTIPLE_RED_FLAGS', 'STEP_UP_DENIED']);

function cityOf(ctx, name) {
  const c = ctx.cities.get(name);
  if (!c) throw new Error(`Unknown city: ${name}`);
  return c;
}

// ---------- Features (FR-3) ----------
function computeFeatures(txn, prior, card, ctx, cfg) {
  const t = toMs(txn.txn_ts);
  const today = istDate(t);
  const velWindow = cfg.velocity_window_minutes * MIN_MS;
  const avgWindow = cfg.avg_lookback_days * DAY_MS;
  const travelWindow = cfg.travel_lookback_hours * HOUR_MS;
  const merchantWindow = cfg.new_merchant_lookback_days * DAY_MS;

  let velocity10m = 0;
  let velocity24h = 0;
  let approvedTodayPaise = 0;
  let sum30Paise = 0;
  let n30 = 0;
  let lastPhysical = null;
  let seenMerchant = false;

  for (const p of prior) {
    const pt = toMs(p.txn_ts);
    if (pt >= t) continue; // strictly earlier only

    if (t - pt <= velWindow) velocity10m++;
    if (t - pt <= DAY_MS) velocity24h++;

    if (p.status === 'APPROVED') {
      if (istDate(pt) === today) approvedTodayPaise += toPaise(p.amount);
      if (t - pt <= avgWindow) { sum30Paise += toPaise(p.amount); n30++; }
      if (PHYSICAL.has(p.channel) && t - pt <= travelWindow) {
        if (!lastPhysical || pt > lastPhysical.ms || (pt === lastPhysical.ms && p.txn_id > lastPhysical.txn_id)) {
          lastPhysical = { ms: pt, txn_id: p.txn_id, txn_city: p.txn_city };
        }
      }
    }

    if (p.merchant_id === txn.merchant_id && t - pt <= merchantWindow) seenMerchant = true;
  }

  // Impossible travel speed (only for a physical txn with a recent physical approved one)
  let speedKmph = null;
  if (PHYSICAL.has(txn.channel) && lastPhysical) {
    const dist = haversineKm(cityOf(ctx, lastPhysical.txn_city), cityOf(ctx, txn.txn_city), cfg.earth_radius_km);
    const hours = (t - lastPhysical.ms) / HOUR_MS;
    if (dist === 0) speedKmph = 0;
    else if (hours === 0) speedKmph = 99999.99;
    else speedKmph = dist / hours;
  }

  return {
    ms: t,
    velocity_10m: velocity10m,
    velocity_24h: velocity24h,
    approved_today_paise: approvedTodayPaise,
    sum30_paise: sum30Paise,
    n30,
    avg_amount_30d: n30 ? sum30Paise / n30 / 100 : null, // unrounded rupees
    speed_kmph: speedKmph, // unrounded
    new_merchant: !seenMerchant,
  };
}

// ---------- Rules R1-R13 (FR-4) ----------
function evaluate(txn, prior, card, ctx, cfg) {
  const t = toMs(txn.txn_ts);
  const amountPaise = toPaise(txn.amount);

  // R1 / R2: hard stops. Derived fields stay empty.
  const hard = [];
  if (card.card_status !== 'ACTIVE' || dateStr(card.expiry_date) < istDate(t)) hard.push('CARD_NOT_ACTIVE');
  if (txn.txn_country !== 'IN' && !card.international_enabled) hard.push('INTL_NOT_ENABLED');
  if (hard.length) {
    return {
      decision: 'BLOCK', reason_codes: hard, rule_risk_score: null,
      velocity_10m: null, avg_amount_30d: null, speed_kmph: null, features: null, hard_stop: true,
    };
  }

  const f = computeFeatures(txn, prior, card, ctx, cfg);
  const merchant = ctx.merchants.get(txn.merchant_id);
  const base = {
    velocity_10m: f.velocity_10m, avg_amount_30d: f.avg_amount_30d, speed_kmph: f.speed_kmph,
    features: f, hard_stop: false,
  };

  // R3-R6: blocks. If any fires, R7-R13 are skipped and score = 100.
  const blocks = [];
  if (merchant && merchant.merchant_risk === 'BLACKLISTED') blocks.push('MERCHANT_BLACKLISTED');
  if (f.approved_today_paise + amountPaise > toPaise(card.daily_limit)) blocks.push('DAILY_LIMIT_EXCEEDED');
  if (f.velocity_10m >= cfg.velocity_burst_count) blocks.push('VELOCITY_BURST');
  if (f.speed_kmph !== null && f.speed_kmph > cfg.impossible_travel_kmph) blocks.push('IMPOSSIBLE_TRAVEL');
  if (blocks.length) return { ...base, decision: 'BLOCK', reason_codes: blocks, rule_risk_score: 100 };

  // R7-R12: soft rules with points
  const soft = [];
  if (f.velocity_10m >= cfg.velocity_stepup_min && f.velocity_10m <= cfg.velocity_stepup_max) soft.push('HIGH_VELOCITY');

  // amount > multiplier x avg, compared exactly in paise: amount * n > multiplier * sum
  const spike = f.n30
    ? amountPaise * f.n30 > cfg.amount_spike_multiplier * f.sum30_paise && amountPaise >= toPaise(cfg.amount_spike_min_amount)
    : amountPaise >= toPaise(cfg.amount_spike_no_history_amount);
  if (spike) soft.push('AMOUNT_SPIKE');

  if (txn.txn_country !== card.home_country && ctx.countryRisk.get(txn.txn_country) === 'HIGH') soft.push('HIGH_RISK_GEO');

  if (cfg.high_risk_mcc.map(String).includes(String(txn.mcc))) soft.push('HIGH_RISK_MCC');

  const hour = istHour(t);
  if (hour >= cfg.odd_hour_start && hour <= cfg.odd_hour_end && amountPaise >= toPaise(cfg.odd_hour_min_amount)) {
    soft.push('ODD_HOUR_HIGH_VALUE');
  }

  if (txn.channel === 'ECOM' && f.new_merchant && amountPaise >= toPaise(cfg.new_merchant_min_amount)) {
    soft.push('NEW_MERCHANT_HIGH_VALUE');
  }

  const score = Math.min(100, soft.reduce((s, code) => s + (cfg.points[code] || 0), 0));

  if (soft.length >= cfg.multiple_red_flags_count) {
    return { ...base, decision: 'BLOCK', reason_codes: [...soft, 'MULTIPLE_RED_FLAGS'], rule_risk_score: score };
  }
  if (soft.length) return { ...base, decision: 'STEP_UP', reason_codes: soft, rule_risk_score: score };
  return { ...base, decision: 'APPROVE', reason_codes: [], rule_risk_score: 0 };
}

// ---------- AI overlay (AI-2): only ever makes a decision stricter ----------
function applyModel(rulesResult, fraudScore, cfg) {
  if (fraudScore === null || fraudScore === undefined) {
    return { final_decision: rulesResult.decision, reason_codes: rulesResult.reason_codes };
  }
  if (rulesResult.decision === 'APPROVE' && fraudScore >= cfg.ai_step_up_threshold) {
    return { final_decision: 'STEP_UP', reason_codes: [...rulesResult.reason_codes, 'HIGH_FRAUD_SCORE_MODEL'] };
  }
  if (rulesResult.decision === 'STEP_UP' && fraudScore >= cfg.ai_block_threshold) {
    return { final_decision: 'BLOCK', reason_codes: [...rulesResult.reason_codes, 'HIGH_FRAUD_SCORE_MODEL'] };
  }
  return { final_decision: rulesResult.decision, reason_codes: rulesResult.reason_codes };
}

// ---------- Alerts (6.1.2) ----------
// createdMs: txn_ts in batch mode, now() in live mode
function buildAlert(decision, reasonCodes, amount, createdMs, cfg, fraudScore = null) {
  if (decision !== 'BLOCK') return null;
  if (!reasonCodes.some((c) => FRAUD_CODES.has(c))) return null; // policy decline, no alert
  const high = toPaise(amount) >= toPaise(cfg.alert_high_amount)
    || reasonCodes.some((c) => HIGH_PRIORITY_CODES.has(c))
    || (fraudScore !== null && fraudScore >= cfg.ai_block_threshold);
  const priority = high ? 'HIGH' : 'MEDIUM';
  const slaMs = createdMs + cfg.sla_minutes[priority] * MIN_MS;
  return { priority, created_at: toIstIso(createdMs), sla_due_at: toIstIso(slaMs), sla_due_ms: slaMs };
}

// ---------- Model features (sent to Dev's /score) ----------
function modelFeatures(txn, card, features, ctx) {
  const merchant = ctx.merchants.get(txn.merchant_id) || {};
  const mcc = ctx.mccs.get(String(txn.mcc)) || {};
  const t = toMs(txn.txn_ts);
  const home = ctx.cities.get(card.home_city);
  const here = ctx.cities.get(txn.txn_city);
  return {
    card_type: card.card_type,
    channel: txn.channel,
    mcc: String(txn.mcc),
    mcc_category: mcc.mcc_category || null,
    merchant_risk: merchant.merchant_risk || null,
    amount: Number(txn.amount),
    local_hour: istHour(t),
    is_international: txn.txn_country !== card.home_country ? 1 : 0,
    country_risk_high: ctx.countryRisk.get(txn.txn_country) === 'HIGH' ? 1 : 0,
    distance_from_home_km: home && here ? haversineKm(home, here, 6371) : null,
    velocity_10m: features.velocity_10m,
    velocity_24h: features.velocity_24h,
    amount_to_avg30_ratio: features.avg_amount_30d ? Number(txn.amount) / features.avg_amount_30d : null,
    new_merchant_flag: features.new_merchant ? 1 : 0,
    card_age_days: Math.floor((Date.parse(istDate(t)) - Date.parse(dateStr(card.issue_date))) / DAY_MS),
  };
}

// Status a transaction gets from its decision
const statusFor = (decision) => ({ APPROVE: 'APPROVED', STEP_UP: 'STEP_UP_PENDING', BLOCK: 'BLOCKED' }[decision]);

module.exports = { computeFeatures, evaluate, applyModel, buildAlert, modelFeatures, statusFor, FRAUD_CODES };
