// FR-10 batch command (rules only).
// Usage: npm run batch -- <transactions.csv> [--out <dir>]
// Reads the file, processes rows in txn_ts order (ties by txn_id) against the stored history,
// and writes <out>/decisions_output.csv and <out>/alerts_output.csv.
// Runs fully in memory and never writes to the database, so results don't depend on demo activity.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { PrismaClient } = require('@prisma/client');
const { evaluate, buildAlert, statusFor } = require('../src/engine/rules');
const { loadContext } = require('../src/engine/context');
const { toMs } = require('../src/engine/util');

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
const OUT_DIR = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.resolve(__dirname, '../../../output');

if (!input) {
  console.error('Usage: npm run batch -- <transactions.csv> [--out <dir>]');
  process.exit(1);
}

const fmt2 = (x) => (x === null || x === undefined ? '' : (Math.round(x * 100) / 100).toFixed(2));
const fmtInt = (x) => (x === null || x === undefined ? '' : String(x));
// Round the 30-day average in paise (exact), so .xx5 rounds half up like the expected file
const avgOut = (r) => (r.features && r.features.n30
  ? (Math.round(r.features.sum30_paise / r.features.n30) / 100).toFixed(2)
  : '');
const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csvLine = (cells) => cells.map(csvCell).join(',');

async function main() {
  console.time('batch');
  const prisma = new PrismaClient();
  try {
    const rows = parse(fs.readFileSync(path.resolve(input)), { columns: true, bom: true, trim: true, skip_empty_lines: true });
    rows.sort((a, b) => toMs(a.txn_ts) - toMs(b.txn_ts) || (a.txn_id < b.txn_id ? -1 : a.txn_id > b.txn_id ? 1 : 0));

    const { cfg, ctx } = await loadContext(prisma);
    const cardIds = [...new Set(rows.map((r) => r.card_id))];

    const cards = new Map((await prisma.card.findMany({ where: { card_id: { in: cardIds } } })).map((c) => [c.card_id, c]));

    // Prior transactions per card: stored history (never batch/live demo rows)
    const history = await prisma.transaction.findMany({
      where: { card_id: { in: cardIds }, source: 'HISTORY' },
      select: { txn_id: true, card_id: true, txn_ts: true, amount: true, merchant_id: true, channel: true, txn_city: true, status: true },
    });
    const priorByCard = new Map(cardIds.map((id) => [id, []]));
    for (const h of history) priorByCard.get(h.card_id).push({ ...h, amount: h.amount.toString() });

    const decisions = [csvLine(['txn_id', 'decision', 'reason_codes', 'rule_risk_score', 'velocity_10m', 'avg_amount_30d', 'speed_kmph'])];
    const alerts = [csvLine(['txn_id', 'alert_priority', 'sla_due_at'])];
    const seen = new Set();
    const tally = { APPROVE: 0, STEP_UP: 0, BLOCK: 0 };

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

      // This row now counts as prior for later rows of the same card (STEP_UP stays pending)
      prior.push({ txn_id: row.txn_id, txn_ts: row.txn_ts, amount: row.amount, merchant_id: row.merchant_id,
        channel: row.channel, txn_city: row.txn_city, status: statusFor(r.decision) });
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'decisions_output.csv'), decisions.join('\n') + '\n');
    fs.writeFileSync(path.join(OUT_DIR, 'alerts_output.csv'), alerts.join('\n') + '\n');

    console.log(`Processed ${seen.size} transactions: ${JSON.stringify(tally)}; alerts: ${alerts.length - 1}`);
    console.log(`Wrote ${path.join(OUT_DIR, 'decisions_output.csv')}`);
    console.log(`Wrote ${path.join(OUT_DIR, 'alerts_output.csv')}`);
  } finally {
    await prisma.$disconnect();
    console.timeEnd('batch');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
