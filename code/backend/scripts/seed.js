// FraudShield seed + reset script
// Usage:  npm run seed      (also used as: npm run reset)
// Wipes all tables, then loads every CSV from /data, the rules config and demo users.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { parse } = require('csv-parse/sync');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../../data');
const CARD_SALT = process.env.CARD_SALT || 'fraudshield-salt';

const file = (name) => path.join(DATA_DIR, name);

function readCsv(name) {
  const p = file(name);
  if (!fs.existsSync(p)) throw new Error(`Missing file: ${p}`);
  return parse(fs.readFileSync(p), { columns: true, bom: true, trim: true, skip_empty_lines: true });
}

const yn = (v) => String(v).trim().toUpperCase() === 'Y';
const emptyToNull = (v) => (v === undefined || v === '' ? null : v);

async function chunkedCreate(model, rows, size = 5000) {
  for (let i = 0; i < rows.length; i += size) {
    await prisma[model].createMany({ data: rows.slice(i, i + size), skipDuplicates: true });
  }
}

async function wipe() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "AuditLog","StepUp","Alert","Transaction","User","Card","Customer",
                   "Merchant","MccCode","City","CountryRisk","RuleConfig"
    RESTART IDENTITY CASCADE;
  `);
}

async function main() {
  console.time('seed');
  console.log(`Reading data from ${DATA_DIR}`);

  await wipe();
  console.log('Tables wiped');

  // ---- Lookups ----
  const cities = readCsv('case_01_cities_V1.0.csv').map((r) => ({
    city: r.city, country: r.country, lat: parseFloat(r.lat), lon: parseFloat(r.lon), city_tier: r.city_tier,
  }));
  await prisma.city.createMany({ data: cities, skipDuplicates: true });

  const countries = readCsv('case_01_country_risk_V1.0.csv').map((r) => ({
    country_code: r.country_code, country_name: r.country_name, risk_level: r.risk_level,
  }));
  await prisma.countryRisk.createMany({ data: countries, skipDuplicates: true });

  const mccs = readCsv('case_01_mcc_codes_V1.0.csv').map((r) => ({
    mcc: String(r.mcc), mcc_description: r.mcc_description, mcc_category: r.mcc_category, high_risk: yn(r.high_risk),
  }));
  await prisma.mccCode.createMany({ data: mccs, skipDuplicates: true });

  const merchants = readCsv('case_01_merchants_V1.0.csv').map((r) => ({
    merchant_id: r.merchant_id, merchant_name: r.merchant_name, mcc: String(r.mcc), mcc_description: r.mcc_description,
    city: r.city, country: r.country, merchant_risk: r.merchant_risk,
  }));
  await chunkedCreate('merchant', merchants);
  console.log(`Lookups: ${cities.length} cities, ${countries.length} countries, ${mccs.length} MCCs, ${merchants.length} merchants`);

  // ---- Customers + cards ----
  const customers = readCsv('case_01_customers_V1.0.csv').map((r) => ({
    customer_id: r.customer_id, full_name: r.full_name, mobile: r.mobile, email: r.email, city: r.city, username: r.username,
  }));
  await chunkedCreate('customer', customers);

  const cards = readCsv('case_01_cards_V1.0.csv').map((r) => {
    const num = String(r.card_number).replace(/\s/g, '');
    return {
      card_id: r.card_id,
      customer_id: r.customer_id,
      card_hash: crypto.createHash('sha256').update(CARD_SALT + num).digest('hex'), // full number never stored
      last4: num.slice(-4),
      card_type: r.card_type,
      card_status: r.card_status,
      issue_date: new Date(r.issue_date),
      expiry_date: new Date(r.expiry_date),
      home_city: r.home_city,
      home_country: r.home_country,
      daily_limit: r.daily_limit,
      international_enabled: yn(r.international_enabled),
    };
  });
  await chunkedCreate('card', cards);
  console.log(`Customers: ${customers.length}, cards: ${cards.length}`);

  // ---- Transaction history ----
  const history = readCsv('case_01_transactions_history_V1.0.csv').map((r) => ({
    txn_id: r.txn_id,
    card_id: r.card_id,
    txn_ts: new Date(r.txn_ts),
    amount: r.amount,
    currency: 'INR',
    merchant_id: r.merchant_id,
    mcc: String(r.mcc),
    channel: r.channel,
    txn_city: r.txn_city,
    txn_country: r.txn_country,
    status: r.status,
    source: 'HISTORY',
    reason_codes: [],
  }));
  await chunkedCreate('transaction', history);
  console.log(`History transactions: ${history.length}`);

  // ---- Rules config (one row per top-level key, value kept as JSON) ----
  const config = JSON.parse(fs.readFileSync(file('case_01_rules_config_V1.0.json'), 'utf8'));
  const configRows = Object.entries(config).map(([key, value]) => ({ key, value }));
  await prisma.ruleConfig.createMany({ data: configRows });
  console.log(`Rule config keys: ${configRows.map((r) => r.key).join(', ')}`);

  // ---- Users (same demo password for everyone; hash once for speed) ----
  const pwHash = await bcrypt.hash('demo123', 10);
  const staff = [
    { user_id: 'U_A1', username: 'analyst1', role: 'ANALYST' },
    { user_id: 'U_A2', username: 'analyst2', role: 'ANALYST' },
    { user_id: 'U_M1', username: 'manager1', role: 'MANAGER' },
    { user_id: 'U_M2', username: 'manager2', role: 'MANAGER' },
  ].map((u) => ({ ...u, password_hash: pwHash, customer_id: null }));
  const cardholders = customers.map((c) => ({
    user_id: `U_${c.customer_id}`, username: c.username, password_hash: pwHash, role: 'CARDHOLDER', customer_id: c.customer_id,
  }));
  await chunkedCreate('user', [...staff, ...cardholders]);
  console.log(`Users: ${staff.length} staff + ${cardholders.length} cardholders (password: demo123)`);

  console.timeEnd('seed');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
