// Quick live check against a RUNNING server and the real seeded data.
// Usage: (server running in another window)  npm run smoke
// Sends worked examples 1, 5, 7 and 10 through the real authorisation API, then checks login + alerts.
// Afterwards run `npm run reset` to get a clean database again.

require('dotenv').config();
const BASE = process.env.SMOKE_URL || `http://localhost:${process.env.PORT || 4000}`;
const KEY = process.env.GATEWAY_API_KEY;

const examples = [
  { name: 'Example 1 (approve)', expect: 'APPROVE',
    body: { txn_id: 'T200000001', card_id: 'C1001', txn_ts: '2026-03-04T14:05:00+05:30', amount: 3500, currency: 'INR', merchant_id: 'M00450', mcc: '5411', channel: 'POS', txn_city: 'Mumbai', txn_country: 'IN' } },
  { name: 'Example 7 (amount spike -> step up)', expect: 'STEP_UP',
    body: { txn_id: 'T200000007', card_id: 'C1007', txn_ts: '2026-03-04T14:05:00+05:30', amount: 15000, currency: 'INR', merchant_id: 'M00451', mcc: '5732', channel: 'ECOM', txn_city: 'Mumbai', txn_country: 'IN' } },
];

async function post(url, body, headers = {}) {
  const r = await fetch(BASE + url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

async function main() {
  let ok = true;
  const line = (pass, msg) => { if (!pass) ok = false; console.log(`${pass ? 'PASS' : 'FAIL'}  ${msg}`); };

  const health = await fetch(`${BASE}/health`).then((r) => r.ok).catch(() => false);
  if (!health) { console.log(`Server not reachable at ${BASE}. Start it with: npm run dev`); process.exit(1); }

  line((await post('/api/v1/authorisations', examples[0].body)).status === 401, 'No API key -> 401');

  for (const ex of examples) {
    const r = await post('/api/v1/authorisations', ex.body, { 'x-api-key': KEY });
    line(r.status === 200 && r.body.decision === ex.expect,
      `${ex.name}: ${r.status} ${r.body.decision || JSON.stringify(r.body)} codes=[${(r.body.reason_codes || []).join('|')}] status=${r.body.status}`);
  }
  const again = await post('/api/v1/authorisations', examples[0].body, { 'x-api-key': KEY });
  line(again.body.txn_id === 'T200000001', 'Same txn_id again returns the stored answer');

  const login = await post('/api/auth/login', { username: 'analyst1', password: 'demo123' });
  line(login.status === 200 && login.body.user.role === 'ANALYST', 'Login analyst1');
  const alerts = await fetch(`${BASE}/api/alerts`, { headers: { authorization: `Bearer ${login.body.token}` } }).then((r) => r.json());
  line(Array.isArray(alerts), `Alert list returned ${Array.isArray(alerts) ? alerts.length : 'error'} alert(s)`);

  console.log(ok ? '\nAll smoke checks passed. Look at the server window for the [OTP] line of example 7.' : '\nSome checks failed.');
  console.log('Run `npm run reset` afterwards to clear these test transactions.');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
