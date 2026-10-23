// Simulated card gateway for the live demo (FR-10 SHOULD).
// Posts each row of a transactions CSV to POST /api/v1/authorisations at a steady rate, in txn_ts order,
// and prints every decision as it comes back. Ends with latency figures (p50 / p95 / max).
//
// Usage (server running):
//   npm run replay -- <file.csv> [--rate 2] [--limit 30] [--from T200000100]
//     --rate   transactions per second (default 2)
//     --limit  stop after N transactions
//     --from   start at this txn_id (skip earlier rows)
// Same txn_id twice returns the stored answer, so replaying is safe. Run `npm run reset` for a clean start.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const FIELDS = ['txn_id', 'card_id', 'txn_ts', 'amount', 'currency', 'merchant_id', 'mcc', 'channel', 'txn_city', 'txn_country'];
const COLOR = { APPROVE: '\x1b[32m', STEP_UP: '\x1b[33m', BLOCK: '\x1b[31m', dim: '\x1b[2m', reset: '\x1b[0m' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

async function runReplay({ base, key, file, rate = 2, limit = Infinity, from = null, log = console.log, color = true }) {
  const c = (k) => (color ? COLOR[k] : '');
  let rows = parse(fs.readFileSync(path.resolve(file)), { columns: true, bom: true, trim: true, skip_empty_lines: true });
  rows.sort((a, b) => Date.parse(a.txn_ts) - Date.parse(b.txn_ts) || (a.txn_id < b.txn_id ? -1 : 1));
  if (from) rows = rows.slice(Math.max(0, rows.findIndex((r) => r.txn_id === from)));
  rows = rows.slice(0, limit);

  const healthy = await fetch(`${base}/health`).then((r) => r.ok).catch(() => false);
  if (!healthy) throw new Error(`Backend not reachable at ${base}. Start it with: npm run dev`);

  log(`Replaying ${rows.length} transactions from ${path.basename(file)} at ${rate}/s to ${base}\n`);
  const gap = 1000 / rate;
  const latencies = [];
  const tally = { APPROVE: 0, STEP_UP: 0, BLOCK: 0, ERROR: 0 };
  let alerts = 0;
  let aiChanged = 0;

  for (const row of rows) {
    const t0 = Date.now();
    const body = Object.fromEntries(FIELDS.filter((f) => row[f] !== undefined && row[f] !== '').map((f) => [f, row[f]]));
    body.amount = Number(body.amount);
    let res;
    try {
      const r = await fetch(`${base}/api/v1/authorisations`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key }, body: JSON.stringify(body),
      });
      res = { status: r.status, body: await r.json() };
    } catch (e) {
      res = { status: 0, body: { error: { message: e.message } } };
    }
    const ms = Date.now() - t0;

    if (res.status !== 200) {
      tally.ERROR++;
      log(`${row.txn_id}  ${c('BLOCK')}ERROR ${res.status}${c('reset')} ${JSON.stringify(res.body.error || res.body)}`);
    } else {
      latencies.push(ms);
      const d = res.body;
      tally[d.final_decision]++;
      if (d.alert_id) alerts++;
      if (d.final_decision !== d.decision) aiChanged++;
      const amount = `₹${Number(row.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`.padStart(14);
      const decision = `${c(d.final_decision)}${d.final_decision.padEnd(7)}${c('reset')}`;
      const extras = [
        d.reason_codes.length ? d.reason_codes.join('|') : '',
        d.final_decision !== d.decision ? `(rules: ${d.decision}, AI score ${d.fraud_score})` : '',
        d.alert_id ? `ALERT #${d.alert_id}` : '',
        d.status === 'STEP_UP_PENDING' ? 'OTP in server log' : '',
        d.model_status === 'MODEL_UNAVAILABLE' ? 'AI unavailable' : '',
      ].filter(Boolean).join('  ');
      log(`${row.txn_id}  ${row.card_id.padEnd(6)} ${row.channel.padEnd(11)} ${amount}  ${decision} ${extras}  ${c('dim')}${ms} ms${c('reset')}`);
    }
    const wait = gap - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  log(`\nDone: ${JSON.stringify(tally)}; alerts created: ${alerts}; made stricter by AI: ${aiChanged}`);
  if (sorted.length) log(`Latency (incl. network): p50 ${pct(sorted, 50)} ms, p95 ${pct(sorted, 95)} ms, max ${sorted.at(-1)} ms`);
  return { tally, alerts, aiChanged, p95: sorted.length ? pct(sorted, 95) : null };
}

module.exports = { runReplay };

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
  const file = args.find((a, i) => !a.startsWith('--') && !String(args[i - 1]).startsWith('--'));
  if (!file) {
    console.error('Usage: npm run replay -- <file.csv> [--rate 2] [--limit 30] [--from T200000100]');
    process.exit(1);
  }
  runReplay({
    base: process.env.REPLAY_URL || `http://localhost:${process.env.PORT || 4000}`,
    key: process.env.GATEWAY_API_KEY,
    file,
    rate: Number(opt('rate', 2)),
    limit: Number(opt('limit', Infinity)),
    from: opt('from', null),
  }).catch((e) => { console.error(e.message || e); process.exitCode = 1; });
}
