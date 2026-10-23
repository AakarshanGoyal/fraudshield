import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { errorMessage } from '../../api/client';
import { getDashboard } from '../../api/endpoints';
import { Card, CardHeader, ErrorBanner, PageHeader, Spinner, cx, inputClass } from '../../components/ui';
import { formatPct, nowIstIso, reasonLabel } from '../../lib/format';

// Demo data is from March 2026, so the default range starts there and runs to today.
const DEFAULT_FROM = '2026-03-01';
const today = () => nowIstIso().slice(0, 10);

const DECISION_COLORS = { APPROVE: '#10b981', STEP_UP: '#f59e0b', BLOCK: '#ef4444' };

export default function Dashboard() {
  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState(today);
  const [auto, setAuto] = useState(true);
  const invalid = from > to;

  const q = useQuery({
    queryKey: ['dashboard', from, to],
    queryFn: () => getDashboard(from, to),
    enabled: !invalid,
    refetchInterval: auto ? 10000 : false,
  });
  const d = q.data;
  const total = d ? d.transactions_by_decision.APPROVE + d.transactions_by_decision.STEP_UP + d.transactions_by_decision.BLOCK : 0;
  const openTotal = d ? d.open_alerts_by_priority.HIGH + d.open_alerts_by_priority.MEDIUM : 0;

  return (
    <div>
      <PageHeader
        title="Fraud dashboard"
        subtitle="Decisions, alert load and SLA health for the selected dates (IST)."
        right={
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500">
              From
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={cx(inputClass(invalid), 'mt-1 py-1.5')} />
            </label>
            <label className="text-xs text-slate-500">
              To
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={cx(inputClass(invalid), 'mt-1 py-1.5')} />
            </label>
            <button
              onClick={() => setAuto((a) => !a)}
              className={cx('flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium', auto ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white text-slate-600')}
            >
              <RefreshCw className={cx('size-3.5', auto && q.isFetching && 'animate-spin')} /> Auto-refresh {auto ? 'on' : 'off'}
            </button>
          </div>
        }
      />

      {invalid ? (
        <ErrorBanner message="The start date must be on or before the end date." />
      ) : q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : d ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Transactions" value={total.toLocaleString('en-IN')} />
            <Kpi label="Block rate" value={formatPct(d.block_rate)} tone="text-red-600" />
            <Kpi label="Step-up rate" value={formatPct(d.step_up_rate)} tone="text-amber-600" />
            <Kpi label="False-positive rate" value={formatPct(d.false_positive_rate)} hint="FALSE_POSITIVE ÷ closed alerts" />
            <Kpi label="Open alerts" value={String(openTotal)} hint={`${d.open_alerts_by_priority.HIGH} HIGH · ${d.open_alerts_by_priority.MEDIUM} MEDIUM`} />
            <Kpi label="SLA breaches" value={String(d.sla_breaches)} tone={d.sla_breaches ? 'text-red-600' : 'text-emerald-600'} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Transactions by decision" subtitle="Final decision after AI" />
              <div className="h-64 p-4">
                <ResponsiveContainer>
                  <BarChart data={(['APPROVE', 'STEP_UP', 'BLOCK'] as const).map((k) => ({ name: k, value: d.transactions_by_decision[k] }))} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
                    <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={64}>
                      {(['APPROVE', 'STEP_UP', 'BLOCK'] as const).map((k) => <Cell key={k} fill={DECISION_COLORS[k]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <CardHeader title="Top 5 reason codes" />
              <div className="p-5">
                {d.top_reason_codes.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-500">No reason codes in this period.</p>
                ) : (
                  <ul className="space-y-3">
                    {d.top_reason_codes.map((r) => {
                      const max = d.top_reason_codes[0].count || 1;
                      return (
                        <li key={r.code}>
                          <div className="mb-1 flex justify-between text-sm">
                            <span className="text-slate-700" title={r.code}>{reasonLabel(r.code)}</span>
                            <span className="tabular font-semibold text-slate-900">{r.count}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-brand-500" style={{ width: `${(r.count / max) * 100}%` }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader title="Open alerts by priority" />
            <div className="grid grid-cols-2 divide-x divide-slate-100">
              {(['HIGH', 'MEDIUM'] as const).map((p) => (
                <div key={p} className="p-5">
                  <p className="text-xs text-slate-500">{p} <span className="text-slate-400">· SLA {p === 'HIGH' ? '30 min' : '4 h'}</span></p>
                  <p className={cx('tabular mt-1 text-3xl font-semibold', p === 'HIGH' ? 'text-red-600' : 'text-amber-600')}>{d.open_alerts_by_priority[p]}</p>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className={cx('h-full rounded-full', p === 'HIGH' ? 'bg-red-500' : 'bg-amber-500')} style={{ width: `${openTotal ? (d.open_alerts_by_priority[p] / openTotal) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, tone = 'text-slate-900', hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cx('tabular mt-1 text-2xl font-semibold tracking-tight', tone)}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </Card>
  );
}
