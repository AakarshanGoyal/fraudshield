// Compares batch output with the sample's expected answers.
// Usage: npm run compare
//   (defaults: data/case_01_batch_transactions_sample_V1.0.csv, data/case_01_batch_sample_expected_alerts_V1.0.csv,
//    output/decisions_output.csv, output/alerts_output.csv)

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const DATA = process.env.DATA_DIR || path.resolve(__dirname, '../../../data');
const OUT = path.resolve(__dirname, '../../../output');
const read = (p) => parse(fs.readFileSync(p), { columns: true, bom: true, trim: true, skip_empty_lines: true });

const codes = (s) => (s || '').split(/[|│]/).map((x) => x.trim()).filter(Boolean).join('|');
const num = (s) => (s === undefined || s === '' ? '' : Number(s));
const sameNum = (a, b) => (a === '' || b === '' ? a === b : Math.abs(a - b) < 0.006);
const sameTs = (a, b) => Date.parse(a) === Date.parse(b);

const expected = read(path.join(DATA, 'case_01_batch_transactions_sample_V1.0.csv'));
const got = new Map(read(path.join(OUT, 'decisions_output.csv')).map((r) => [r.txn_id, r]));

let bad = 0;
for (const e of expected) {
  const g = got.get(e.txn_id);
  if (!g) { bad++; console.log(`${e.txn_id}: MISSING from output`); continue; }
  const diffs = [];
  if (e.expected_decision !== g.decision) diffs.push(`decision ${g.decision} != ${e.expected_decision}`);
  if (codes(e.expected_reason_codes) !== codes(g.reason_codes)) diffs.push(`codes [${g.reason_codes}] != [${e.expected_reason_codes}]`);
  if (!sameNum(num(e.expected_rule_risk_score), num(g.rule_risk_score))) diffs.push(`score ${g.rule_risk_score} != ${e.expected_rule_risk_score}`);
  if (!sameNum(num(e.expected_velocity_10m), num(g.velocity_10m))) diffs.push(`velocity ${g.velocity_10m} != ${e.expected_velocity_10m}`);
  if (!sameNum(num(e.expected_avg_amount_30d), num(g.avg_amount_30d))) diffs.push(`avg ${g.avg_amount_30d} != ${e.expected_avg_amount_30d}`);
  if (!sameNum(num(e.expected_speed_kmph), num(g.speed_kmph))) diffs.push(`speed ${g.speed_kmph} != ${e.expected_speed_kmph}`);
  if (diffs.length) { bad++; if (bad <= 30) console.log(`${e.txn_id} (${e.card_id}): ${diffs.join('; ')}`); }
}
console.log(`\nDecisions: ${expected.length - bad}/${expected.length} rows match`);

const expAlerts = read(path.join(DATA, 'case_01_batch_sample_expected_alerts_V1.0.csv'));
const gotAlerts = new Map(read(path.join(OUT, 'alerts_output.csv')).map((r) => [r.txn_id, r]));
let alertBad = 0;
for (const e of expAlerts) {
  const g = gotAlerts.get(e.txn_id);
  if (!g) { alertBad++; console.log(`Alert ${e.txn_id}: MISSING`); continue; }
  if (g.alert_priority !== e.alert_priority || !sameTs(g.sla_due_at, e.sla_due_at)) {
    alertBad++; console.log(`Alert ${e.txn_id}: got ${g.alert_priority} ${g.sla_due_at}, expected ${e.alert_priority} ${e.sla_due_at}`);
  }
}
const extra = [...gotAlerts.keys()].filter((id) => !expAlerts.some((e) => e.txn_id === id));
extra.forEach((id) => console.log(`Alert ${id}: EXTRA (not expected)`));
console.log(`Alerts: ${expAlerts.length - alertBad}/${expAlerts.length} match, ${extra.length} extra`);

process.exit(bad || alertBad || extra.length ? 1 : 0);
