// FR-10 batch command.
// Usage:
//   npm run batch -- <transactions.csv> [--out <dir>]              rules only
//   npm run batch -- <transactions.csv> --with-ai [--out <dir>]    rules + AI (needs ML_URL in .env)
//
// Processes rows in txn_ts order (ties by txn_id) against the stored history and writes:
//   decisions_output.csv, alerts_output.csv   (always rules-only, as the case requires)
//   fraud_scores_output.csv                   (--with-ai: txn_id, fraud_score, final_decision, top_factors)
// Runs fully in memory and never writes to the database, so results don't depend on demo activity.
// Assumption (documented): in AI mode, later rows see earlier rows' RULES status, so the rules-only
// files stay identical with or without --with-ai.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { evaluate, computeFeatures, applyModel, buildAlert, modelFeatures, statusFor } = require('../src/engine/rules');
const { loadContext } = require('../src/engine/context');
const { score } = require('../src/services/ml');
const { toMs } = require('../src/engine/util');

const fmt2 = (x) => (x === null || x === undefined ? '' : (Math.round(x * 100) / 100).toFixed(2));
const fmt4 = (x) => (x === null || x === undefined ? '' : x.toFixed(4));
const fmtInt = (x) => (x === null || x === undefined ? '' : String(x));
// Round the 30-day average in paise (exact), so .xx5 rounds half up like the expected file
const avgOut = (r) => (r.features && r.features.n30
  ? (Math.round(r.features.sum30_paise / r.features.n30) / 100).toFixed(2)
  : '');
const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csvLine = (cells) => cells.map(csvCell).join(',');

async function checkMl() {
  const base = process.env.ML_URL;
  if (!base) throw new Error('--with-ai needs ML_URL in .env (e.g. ML_URL=http://localhost:8000)');
  const ok = await fetch(`${base.replace(/\/$/, '')}/health`).then((r) => r.ok).catch(() => false);
  if (!ok) throw new Error(`ML service not reachable at ${base}/health. Start Dev's service first.`);
}

async function runBatch(prisma, { input, outDir, withAi = false, log = console.log }) {
  const started = Date.now();
  if (withAi) await checkMl();

  const rows = parse(fs.readFileSync(path.resolve(input)), { columns: true, bom: true, trim: true, skip_empty_lines: true });
  rows.sort((a, b) => toMs(a.txn_ts) - toMs(b.txn_ts) || (a.txn_id < b.txn_id ? -1 : a.txn_id > b.txn_id ? 1 : 0));

  const { cfg, ctx } = await loadContext(prisma);
  // Batch is not latency-critical: allow the model more time than the live 150 ms budget
  const batchCfg = { ...cfg, model_timeout_ms: Math.max(cfg.model_timeout_ms || 150, 3000) };
  const cardIds = [...new Set(rows.map((r) => r.card_id))];
  const cards = new Map((await prisma.card.findMany({ where: { card_id: { in: cardIds } } })).map((c) => [c.card_id, c]));

  // Prior transactions per card: stored history only (never batch/live demo rows)
  const history = await prisma.transaction.findMany({
    where: { card_id: { in: cardIds }, source: 'HISTORY' },
    select: { txn_id: true, card_id: true, txn_ts: true, amount: true, merchant_id: true, channel: true, txn_city: true, status: true },
  });
  const priorByCard = new Map(cardIds.map((id) => [id, []]));
  for (const h of history) priorByCard.get(h.card_id).push({ ...h, amount: h.amount.toString() });

  const decisions = [csvLine(['txn_id', 'decision', 'reason_codes', 'rule_risk_score', 'velocity_10m', 'avg_amount_30d', 'speed_kmph'])];
  const alerts = [csvLine(['txn_id', 'alert_priority', 'sla_due_at'])];
  const scores = [csvLine(['txn_id', 'fraud_score', 'final_decision', 'top_factors'])];
  const seen = new Set();
  const tally = { APPROVE: 0, STEP_UP: 0, BLOCK: 0 };
  const finalTally = { APPROVE: 0, STEP_UP: 0, BLOCK: 0 };
  let unavailable = 0;
  let raised = 0;

  for (const row of rows) {
    if (seen.has(row.txn_id)) continue; // idempotent on txn_id
    seen.add(row.txn_id);

    const card = cards.get(row.card_id);
    if (!card) throw new Error(`Unknown card ${row.card_id} for ${row.txn_id}`);
    const prior = priorByCard.get(row.card_id);

    const r = evaluate(row, prior, card, ctx, cfg);
    tally[r.decision]++;
    decisions.push(csvLine([
      row.txn_id, r.decision, r.reason_codes.join('|'), fmtInt(r.rule_risk_score),
      fmtInt(r.velocity_10m), avgOut(r), fmt2(r.speed_kmph),
    ]));

    const alert = buildAlert(r.decision, r.reason_codes, row.amount, toMs(row.txn_ts), cfg);
    if (alert) alerts.push(csvLine([row.txn_id, alert.priority, alert.sla_due_at]));

    if (withAi) {
      const features = r.features || computeFeatures(row, prior, card, ctx, cfg);
      const ml = await score(modelFeatures(row, card, features, ctx), batchCfg);
      const ai = applyModel(r, ml.fraud_score, cfg);
      if (ml.model_status !== 'OK') unavailable++;
      if (ai.final_decision !== r.decision) raised++;
      finalTally[ai.final_decision]++;
      const names = (ml.top_features && ml.top_features.length ? ml.top_features : ml.top_factors).slice(0, 3);
      scores.push(csvLine([row.txn_id, fmt4(ml.fraud_score), ai.final_decision, names.join('│')]));
    }

    // This row now counts as prior for later rows of the same card (STEP_UP stays pending)
    prior.push({ txn_id: row.txn_id, txn_ts: row.txn_ts, amount: row.amount, merchant_id: row.merchant_id,
      channel: row.channel, txn_city: row.txn_city, status: statusFor(r.decision) });
  }

  fs.mkdirSync(outDir, { recursive: true });
  const write = (name, lines) => {
    fs.writeFileSync(path.join(outDir, name), lines.join('\n') + '\n');
    log(`Wrote ${path.join(outDir, name)}`);
  };
  log(`Processed ${seen.size} transactions. Rules: ${JSON.stringify(tally)}; alerts: ${alerts.length - 1}`);
  write('decisions_output.csv', decisions);
  write('alerts_output.csv', alerts);
  if (withAi) {
    log(`AI final: ${JSON.stringify(finalTally)}; made stricter by the model: ${raised}`);
    write('fraud_scores_output.csv', scores);
    if (unavailable) log(`WARNING: model unavailable for ${unavailable} row(s); their fraud_score is empty and the rules decision was kept.`);
  }
  log(`batch: ${Date.now() - started} ms`);
  return { processed: seen.size, tally, finalTally, unavailable, raised };
}

module.exports = { runBatch };

if (require.main === module) {
  const args = process.argv.slice(2);
  const input = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.resolve(__dirname, '../../../output');
  if (!input) {
    console.error('Usage: npm run batch -- <transactions.csv> [--with-ai] [--out <dir>]');
    process.exit(1);
  }
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  runBatch(prisma, { input, outDir, withAi: args.includes('--with-ai') })
    .catch((e) => { console.error(e.message || e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
