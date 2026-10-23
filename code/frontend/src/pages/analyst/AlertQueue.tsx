import { useQuery } from '@tanstack/react-query';
import { Inbox, RefreshCw, Siren, TimerOff, UserCheck, Flame } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { getAlerts } from '../../api/endpoints';
import type { AlertListItem, AlertStatus, Priority } from '../../api/types';
import { OPEN_ALERT_STATUSES } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { AlertStatusBadge, FraudScore, PriorityBadge, ReasonChips } from '../../components/badges';
import { SlaTimer, useNow } from '../../components/SlaTimer';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, cx } from '../../components/ui';
import { formatDateTime, formatINR } from '../../lib/format';

type View = 'ACTIVE' | 'MINE' | AlertStatus | 'ALL';
const VIEWS: { id: View; label: string }[] = [
  { id: 'ACTIVE', label: 'Active' },
  { id: 'MINE', label: 'Claimed by me' },
  { id: 'OPEN', label: 'Open' },
  { id: 'IN_REVIEW', label: 'In review' },
  { id: 'PENDING_MANAGER_APPROVAL', label: 'Pending manager' },
  { id: 'CONFIRMED_FRAUD', label: 'Confirmed fraud' },
  { id: 'FALSE_POSITIVE', label: 'False positive' },
  { id: 'ALL', label: 'All' },
];

const statusFilter = (v: View): AlertStatus[] | undefined =>
  v === 'ACTIVE' || v === 'MINE' ? OPEN_ALERT_STATUSES : v === 'ALL' ? undefined : [v];

export default function AlertQueue() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<View>('ACTIVE');
  const [priority, setPriority] = useState<Priority | ''>('');
  const now = useNow(1000);

  const q = useQuery({
    queryKey: ['alerts', view, priority],
    queryFn: () => getAlerts({ status: statusFilter(view), priority: priority || undefined }),
    refetchInterval: 5000, // contract: poll every 5 seconds
  });

  // Separate unfiltered-ish query for the summary tiles so they don't change with the filters.
  const summary = useQuery({
    queryKey: ['alerts', 'summary'],
    queryFn: () => getAlerts({ status: OPEN_ALERT_STATUSES }),
    refetchInterval: 5000,
  });

  const rows = useMemo(
    () => (view === 'MINE' ? (q.data ?? []).filter((a) => a.claimed_by === user?.username) : q.data ?? []),
    [q.data, view, user?.username],
  );
  const s = summary.data ?? [];
  const tiles = [
    { label: 'Active HIGH', value: s.filter((a) => a.priority === 'HIGH').length, icon: Flame, tone: 'text-red-600 bg-red-50' },
    { label: 'Active MEDIUM', value: s.filter((a) => a.priority === 'MEDIUM').length, icon: Siren, tone: 'text-amber-600 bg-amber-50' },
    { label: 'SLA breached', value: s.filter((a) => a.sla_breached).length, icon: TimerOff, tone: 'text-red-700 bg-red-100' },
    { label: 'Claimed by me', value: s.filter((a) => a.claimed_by === user?.username && a.status === 'IN_REVIEW').length, icon: UserCheck, tone: 'text-violet-600 bg-violet-50' },
  ];
  const updatedAgo = q.dataUpdatedAt ? Math.max(0, Math.round((now - q.dataUpdatedAt) / 1000)) : null;

  return (
    <div>
      <PageHeader
        title="Alert queue"
        subtitle="Ordered by priority, then the nearest SLA deadline."
        right={
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            Live · {updatedAgo == null ? 'loading' : `updated ${updatedAgo}s ago`}
            <button onClick={() => q.refetch()} className="ml-1 rounded p-1 hover:bg-slate-100" aria-label="Refresh">
              <RefreshCw className={cx('size-3.5', q.isFetching && 'animate-spin')} />
            </button>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="flex items-center gap-3 p-4">
            <span className={cx('grid size-10 place-items-center rounded-lg', t.tone)}>
              <t.icon className="size-5" />
            </span>
            <div>
              <p className="tabular text-2xl font-semibold leading-none text-slate-900">{t.value}</p>
              <p className="mt-1 text-xs text-slate-500">{t.label}</p>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {VIEWS.filter((v) => v.id !== 'MINE' || user?.role === 'ANALYST').map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={cx(
                  'rounded-md px-2.5 py-1 text-xs font-medium',
                  view === v.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority | '')}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
            aria-label="Priority filter"
          >
            <option value="">All priorities</option>
            <option value="HIGH">HIGH only</option>
            <option value="MEDIUM">MEDIUM only</option>
          </select>
        </div>

        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <div className="p-4"><ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Inbox className="size-10" />} title="No alerts here" hint="New alerts appear automatically within 5 seconds." />
        ) : (
          <AlertTable rows={rows} now={now} me={user?.username} onOpen={(id) => navigate(`/analyst/alerts/${id}`)} />
        )}
      </Card>
    </div>
  );
}

export function AlertTable({
  rows,
  now,
  me,
  onOpen,
}: {
  rows: AlertListItem[];
  now: number;
  me?: string;
  onOpen: (id: number) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2.5">Priority</th>
            <th className="px-4 py-2.5">Alert</th>
            <th className="px-4 py-2.5 text-right">Amount</th>
            <th className="px-4 py-2.5">Card / merchant</th>
            <th className="px-4 py-2.5">Reasons</th>
            <th className="px-4 py-2.5">AI score</th>
            <th className="px-4 py-2.5">SLA</th>
            <th className="px-4 py-2.5">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((a) => {
            const isNew = now - new Date(a.created_at).getTime() < 60_000;
            const closed = a.status === 'CONFIRMED_FRAUD' || a.status === 'FALSE_POSITIVE';
            return (
              <tr
                key={a.alert_id}
                onClick={() => onOpen(a.alert_id)}
                className={cx(
                  'cursor-pointer transition-colors hover:bg-slate-50',
                  a.sla_breached && 'bg-red-50/60 hover:bg-red-50',
                )}
              >
                <td className={cx('border-l-4 px-4 py-3', a.sla_breached ? 'border-red-500' : a.priority === 'HIGH' ? 'border-red-200' : 'border-transparent')}>
                  <PriorityBadge priority={a.priority} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">#{a.alert_id}</span>
                    {isNew && <span className="rounded bg-brand-600 px-1.5 py-px text-[10px] font-bold text-white">NEW</span>}
                  </div>
                  <div className="font-mono text-xs text-slate-500">{a.txn_id}</div>
                  <div className="text-xs text-slate-400">{formatDateTime(a.created_at)}</div>
                </td>
                <td className="tabular px-4 py-3 text-right font-semibold text-slate-900">{formatINR(a.amount)}</td>
                <td className="px-4 py-3">
                  <div className="font-mono text-xs text-slate-600">{a.card_id} · ••{a.card_last4}</div>
                  <div className="max-w-[200px] truncate text-slate-700" title={a.merchant_name}>{a.merchant_name}</div>
                </td>
                <td className="max-w-[260px] px-4 py-3"><ReasonChips codes={a.reason_codes} /></td>
                <td className="px-4 py-3"><FraudScore score={a.fraud_score} compact /></td>
                <td className="px-4 py-3"><SlaTimer dueAt={a.sla_due_at} breached={a.sla_breached} closed={closed} /></td>
                <td className="px-4 py-3">
                  <AlertStatusBadge status={a.status} />
                  {a.claimed_by && (
                    <div className={cx('mt-1 text-xs', a.claimed_by === me ? 'font-medium text-violet-700' : 'text-slate-500')}>
                      {a.claimed_by === me ? 'You' : a.claimed_by}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
