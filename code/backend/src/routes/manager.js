// Manager-only: dashboard (FR-9), audit trail + export (FR-8), rules configuration.
const express = require('express');
const { prisma } = require('../db');
const { ah, invalid, notFound } = require('../errors');
const { audit } = require('../services/audit');
const { invalidate } = require('../services/context');
const { iso } = require('../services/present');
const { DAY_MS } = require('../engine/util');

const dashboard = express.Router();
const auditRouter = express.Router();
const config = express.Router();

const OPEN = ['OPEN', 'IN_REVIEW', 'PENDING_MANAGER_APPROVAL'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- Dashboard ----------
dashboard.get('/', ah(async (req, res) => {
  const { from, to } = req.query;
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) throw invalid('Invalid input', { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' });
  const fromTs = new Date(from ? `${from}T00:00:00+05:30` : '1970-01-01T00:00:00Z');
  const toTs = new Date(to ? Date.parse(`${to}T00:00:00+05:30`) + DAY_MS : Date.parse('2999-01-01T00:00:00Z'));
  const txnWhere = { source: { not: 'HISTORY' }, txn_ts: { gte: fromTs, lt: toTs } };
  const alertWhere = { created_at: { gte: fromTs, lt: toTs } };

  const [byDecision, top, alerts] = await Promise.all([
    prisma.transaction.groupBy({ by: ['final_decision'], where: txnWhere, _count: { _all: true } }),
    prisma.$queryRaw`
      SELECT code, COUNT(*)::int AS count
      FROM "Transaction", unnest(reason_codes) AS code
      WHERE source <> 'HISTORY' AND txn_ts >= ${fromTs} AND txn_ts < ${toTs}
      GROUP BY code ORDER BY count DESC, code ASC LIMIT 5`,
    prisma.alert.findMany({ where: alertWhere, select: { status: true, priority: true, sla_due_at: true } }),
  ]);

  const counts = { APPROVE: 0, STEP_UP: 0, BLOCK: 0 };
  for (const g of byDecision) if (g.final_decision) counts[g.final_decision] = g._count._all;
  const total = counts.APPROVE + counts.STEP_UP + counts.BLOCK;
  const rate = (n, d) => (d ? Math.round((n / d) * 10000) / 10000 : 0);

  const now = Date.now();
  const open = alerts.filter((a) => OPEN.includes(a.status));
  const closed = alerts.filter((a) => a.status === 'CONFIRMED_FRAUD' || a.status === 'FALSE_POSITIVE');

  res.json({
    transactions_by_decision: counts,
    block_rate: rate(counts.BLOCK, total),
    step_up_rate: rate(counts.STEP_UP, total),
    open_alerts_by_priority: {
      HIGH: open.filter((a) => a.priority === 'HIGH').length,
      MEDIUM: open.filter((a) => a.priority === 'MEDIUM').length,
    },
    sla_breaches: open.filter((a) => a.sla_due_at.getTime() < now).length,
    false_positive_rate: rate(closed.filter((a) => a.status === 'FALSE_POSITIVE').length, closed.length),
    top_reason_codes: top,
  });
}));

// ---------- Audit ----------
const ENTITIES = ['TRANSACTION', 'ALERT', 'CARD', 'CONFIG'];

async function auditRows(q) {
  const entity = String(q.entity || '').toUpperCase();
  if (!ENTITIES.includes(entity) || !q.entity_id) {
    throw invalid('Invalid input', { entity: `one of ${ENTITIES.join(', ')}`, entity_id: 'required' });
  }
  const rows = await prisma.auditLog.findMany({
    where: { entity, entity_id: String(q.entity_id) }, orderBy: [{ ts: 'asc' }, { id: 'asc' }],
  });
  return rows.map((r) => ({ ...r, id: Number(r.id), ts: iso(r.ts) }));
}

auditRouter.get('/', ah(async (req, res) => res.json(await auditRows(req.query))));

auditRouter.get('/export', ah(async (req, res) => {
  const rows = await auditRows(req.query);
  const cols = ['id', 'entity', 'entity_id', 'actor', 'role', 'ts', 'action', 'from_status', 'to_status', 'comment', 'before', 'after'];
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="audit_${req.query.entity}_${req.query.entity_id}.csv"`);
  res.send(csv);
}));

// ---------- Rules configuration ----------
config.get('/', ah(async (req, res) => {
  const rows = await prisma.ruleConfig.findMany({ orderBy: { key: 'asc' } });
  res.json(rows.map((r) => ({ key: r.key, value: r.value, updated_at: iso(r.updated_at) })));
}));

const kind = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

config.put('/:key', ah(async (req, res) => {
  const { key } = req.params;
  if (!req.body || !('value' in req.body)) throw invalid('Invalid input', { value: 'required' });
  const { value } = req.body;
  const current = await prisma.ruleConfig.findUnique({ where: { key } });
  if (!current) throw notFound(`Unknown config key ${key}`);
  if (key === 'version') throw invalid('Invalid input', { key: 'version is read-only' });
  if (kind(value) !== kind(current.value)) throw invalid('Invalid input', { value: `must be a ${kind(current.value)}` });
  if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) throw invalid('Invalid input', { value: 'must be a non-negative number' });

  await prisma.$transaction(async (tx) => {
    await tx.ruleConfig.update({ where: { key }, data: { value } });
    await audit(tx, { entity: 'CONFIG', entity_id: key, actor: req.user.username, role: req.user.role,
      action: 'UPDATED', before: { value: current.value }, after: { value } });
  });
  invalidate(); // next decision reads the new value, no restart or code change
  res.json({ key, value });
}));

module.exports = { dashboard, auditRouter, config };
