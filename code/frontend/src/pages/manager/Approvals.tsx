import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ClipboardCheck, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { getAlert, getAlerts } from '../../api/endpoints';
import { FraudScore, PriorityBadge, ReasonChips } from '../../components/badges';
import { SlaTimer } from '../../components/SlaTimer';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, cx } from '../../components/ui';
import { formatDateTime, formatINR } from '../../lib/format';
import { DecisionPanel } from './DecisionPanel';

export default function Approvals() {
  const q = useQuery({
    queryKey: ['alerts', 'pending-manager'],
    queryFn: () => getAlerts({ status: ['PENDING_MANAGER_APPROVAL'] }),
    refetchInterval: 5000,
  });
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <div>
      <PageHeader
        title="Pending approvals"
        subtitle="False-positive releases above ₹1,00,000 need a second person. You cannot check a proposal you made."
      />
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <Card><EmptyState icon={<ClipboardCheck className="size-10" />} title="Nothing waiting for approval" hint="Proposals appear here as soon as an analyst sends one." /></Card>
      ) : (
        <div className="space-y-3">
          {q.data.map((a) => (
            <Card key={a.alert_id} className={cx(openId === a.alert_id && 'ring-1 ring-brand-200')}>
              <button
                onClick={() => setOpenId(openId === a.alert_id ? null : a.alert_id)}
                aria-expanded={openId === a.alert_id}
                aria-label={`Review alert ${a.alert_id}, ${formatINR(a.amount)}, proposed by ${a.claimed_by}`}
                className="flex w-full flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 text-left"
              >
                <div className="flex items-center gap-2">
                  <PriorityBadge priority={a.priority} />
                  <span className="font-semibold text-slate-900">#{a.alert_id}</span>
                </div>
                <span className="tabular text-lg font-semibold text-slate-900">{formatINR(a.amount)}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{a.merchant_name} · <span className="font-mono text-xs">••{a.card_last4}</span></span>
                <span className="text-xs text-slate-500">Proposed by <b className="text-slate-700">{a.claimed_by}</b></span>
                <SlaTimer dueAt={a.sla_due_at} breached={a.sla_breached} />
                <ChevronDown className={cx('size-4 text-slate-400 transition-transform', openId === a.alert_id && 'rotate-180')} />
              </button>
              {openId === a.alert_id && <ApprovalBody alertId={a.alert_id} onDone={() => setOpenId(null)} />}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalBody({ alertId, onDone }: { alertId: number; onDone: () => void }) {
  const q = useQuery({ queryKey: ['alert', String(alertId)], queryFn: () => getAlert(alertId) });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <div className="p-5"><ErrorBanner message={errorMessage(q.error)} /></div>;
  const d = q.data!;
  return (
    <div className="grid gap-6 border-t border-slate-100 p-5 lg:grid-cols-2">
      <div className="space-y-4 text-sm">
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Why it was blocked</p>
          <ReasonChips codes={d.transaction.reason_codes} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Transaction time</p><p className="font-medium">{formatDateTime(d.transaction.txn_ts)}</p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Location</p><p className="font-medium">{d.transaction.txn_city}, {d.transaction.txn_country} · {d.transaction.channel}</p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Rule risk score</p><p className="tabular font-medium">{d.transaction.rule_risk_score ?? '—'}</p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">AI fraud score</p><FraudScore score={d.ai.fraud_score} /></div>
        </div>
        {d.alert.comment && (
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Analyst {d.alert.proposed_by} wrote</p>
            <p className="mt-1 text-slate-800">“{d.alert.comment}”</p>
          </div>
        )}
        <Link to={`/analyst/alerts/${alertId}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
          Open full alert <ExternalLink className="size-3" />
        </Link>
      </div>
      <DecisionPanel alertId={alertId} proposedBy={d.alert.proposed_by} onDone={onDone} />
    </div>
  );
}
