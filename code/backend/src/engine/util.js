// Small helpers shared by the engine: IST dates, money in paise, haversine.

const IST_OFFSET_MS = 330 * 60 * 1000; // +05:30
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

const PHYSICAL = new Set(['POS', 'ATM', 'CONTACTLESS']);

const toMs = (ts) => (ts instanceof Date ? ts.getTime() : Date.parse(ts));

// Calendar date in IST, e.g. "2026-03-04"
const istDate = (ms) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);

// Hour of day in IST, 0-23
const istHour = (ms) => new Date(ms + IST_OFFSET_MS).getUTCHours();

// "2026-03-04T14:35:00+05:30"
const toIstIso = (ms) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 19) + '+05:30';

// Money as integer paise so comparisons never suffer float errors
const toPaise = (v) => Math.round(Number(v) * 100);

// Accepts a Date (Prisma @db.Date) or a "YYYY-MM-DD" string
const dateStr = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

function haversineKm(a, b, radiusKm) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.sqrt(h));
}

// Turns RuleConfig rows [{key, value}] into a plain object
const configFromRows = (rows) => Object.fromEntries(rows.map((r) => [r.key, r.value]));

module.exports = {
  IST_OFFSET_MS, DAY_MS, HOUR_MS, MIN_MS, PHYSICAL,
  toMs, istDate, istHour, toIstIso, toPaise, dateStr, haversineKm, configFromRows,
};
