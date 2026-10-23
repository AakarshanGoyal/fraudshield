import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, BrainCircuit, CreditCard, Gauge, History, Lock, MapPin, Sparkles, ShieldAlert, ShieldCheck, Store,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, errorMessage } from '../../api/client';
import { claimAlert, closeAlert } from '../../api/endpoints';
import { getAlert } from '../../api/endpoints';
import type { AlertDetail, CloseOutcome } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import {
  AlertStatusBadge, Badge, CardStatusBadge, DecisionBadge, FraudScore, PriorityBadge, ReasonChips, TxnStatusBadge,
} from '../../components/badges';
import { SlaTimer } from '../../components/SlaTimer';
import { useToast } from '../../components/Toast';
import { Button, Card, CardHeader, ErrorBanner, Field, KeyValue, Spinner, cx, inputClass } from '../../components/ui';
import { formatDateTime, formatINR } from '../../lib/format';
import { DecisionPanel } from '../manager/DecisionPanel';

// Rule thresholds live in the config table, which only managers can read, so this page
// never repeats a threshold: it shows what the server decided (status, reason codes).

export default function AlertDetailPage() {
  const { alertId = '' } = useParams();
  const q = useQuery({
    queryKey: ['alert', alertId],
    queryFn: () => getAlert(alertId),
    refetchInterval: 10000,
  });

  if (q.isLoading) return <Spinner label="Loading alert…" />;
  if (q.isError)
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      </div>
    );
  const d = q.data!;
  const closed = d.alert.status === 'CONFIRMED_FRAUD' || d.alert.status === 'FALSE_POSITIVE';

  return (
    <div className="space-y-6">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Alert #{d.alert.alert_id}</h1>
            <PriorityBadge priority={d.alert.priority} />
            <AlertStatusBadge status={d.alert.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Transaction <span className="font-mono">{d.transaction.txn_id}</span> · {formatDateTime(d.transaction.txn_ts)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">SLA due {formatDateTime(d.alert.sla_due_at)}</p>
          <div className="mt-1"><SlaTimer dueAt={d.alert.sla_due_at} breached={d.alert.sla_breached} closed={closed} /></div>
        </div>
      </div>

      <ActionPanel d={d} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <TransactionCard d={d} />
          <FeaturesCard d={d} />
          <RecentCard d={d} />
        </div>
        <div className="space-y-6">
          <AiCard d={d} />
          <CardInfo d={d} />
        </div>
      </div>
    </div>
  );
}

const BackLink = () => (
  <Link to="/analyst" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
    <ArrowLeft className="size-4" /> Back to queue
  </Link>
);

function ActionPanel({ d }: { d: AlertDetail }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const a = d.alert;
  const isAnalyst = user?.role === 'ANALYST';
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['alert', String(a.alert_id)] });
    qc.invalidateQueries({ queryKey: ['alerts'] });
  };

  const claim = useMutation({
    mutationFn: () => claimAlert(a.alert_id),
    onSuccess: () => {
      toast('success', `You claimed alert #${a.alert_id}. It is locked to you.`);
      refresh();
    },
    onError: (e) => {
      toast('error', e instanceof ApiError && e.status === 409 ? `Someone else got it first. ${e.message}` : errorMessage(e));
      refresh();
    },
  });

  if (a.status === 'CONFIRMED_FRAUD' || a.status === 'FALSE_POSITIVE') {
    const fraud = a.status === 'CONFIRMED_FRAUD';
    return (
      <Card className={cx('flex gap-3 p-4', fraud ? 'border-red-200 bg-red-50/50' : 'border-emerald-200 bg-emerald-50/50')}>
        {fraud ? <ShieldAlert className="size-5 shrink-0 text-red-600" /> : <ShieldCheck className="size-5 shrink-0 text-emerald-600" />}
        <div className="text-sm">
          <p className="font-medium text-slate-900">
            Closed as {fraud ? 'confirmed fraud (card blocked)' : 'false positive (genuine payment)'}
            {a.claimed_by && <span className="font-normal text-slate-500"> by {a.claimed_by}</span>}
          </p>
          {a.comment && <p className="mt-1 text-slate-600">“{a.comment}”</p>}
        </div>
      </Card>
    );
  }

  if (a.status === 'PENDING_MANAGER_APPROVAL') {
    return (
      <Card className="border-orange-200">
        <CardHeader
          title="Waiting for manager approval"
          subtitle={`${a.proposed_by ?? 'An analyst'} proposed FALSE_POSITIVE on a payment above the manager approval limit. A different manager must check it.`}
        />
        <div className="space-y-4 p-5">
          {a.comment && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">Analyst comment: “{a.comment}”</p>}
          {user?.role === 'MANAGER' ? (
            <DecisionPanel alertId={a.alert_id} proposedBy={a.proposed_by} />
          ) : (
            <p className="text-sm text-slate-500">Managers decide this from their Approvals page.</p>
          )}
        </div>
      </Card>
    );
  }

  if (a.status === 'OPEN') {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 border-sky-200 bg-sky-50/40 p-4">
        <p className="text-sm text-slate-700">
          {isAnalyst ? 'Claim this alert to lock it to you before reviewing.' : 'Open alert, not claimed yet. Managers can read alerts but only analysts claim them.'}
        </p>
        {isAnalyst && <Button loading={claim.isPending} onClick={() => claim.mutate()}>Claim alert</Button>}
      </Card>
    );
  }

  // IN_REVIEW
  if (a.claimed_by !== user?.username) {
    return (
      <Card className="flex items-center gap-3 border-violet-200 bg-violet-50/40 p-4 text-sm text-slate-700">
        <Lock className="size-4 text-violet-600" /> Locked by <b>{a.claimed_by}</b>. Only they can close this alert.
      </Card>
    );
  }
  return <ClosePanel d={d} onDone={refresh} />;
}

function ClosePanel({ d, onDone }: { d: AlertDetail; onDone: () => void }) {
  const toast = useToast();
  const [outcome, setOutcome] = useState<CloseOutcome | null>(null);
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: () => closeAlert(d.alert.alert_id, outcome!, comment.trim()),
    onSuccess: (res) => {
      toast(
        'success',
        res.status === 'PENDING_MANAGER_APPROVAL'
          ? 'The amount is above the manager approval limit, so this was sent to a manager for approval.'
          : res.status === 'CONFIRMED_FRAUD'
            ? 'Closed as confirmed fraud. The card is now blocked.'
            : 'Closed as false positive.',
      );
      onDone();
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fields);
      setBanner(errorMessage(e));
      if (e instanceof ApiError && (e.status === 409 || e.status === 403)) onDone();
    },
  });

  const submit = () => {
    setBanner(null);
    const errs: Record<string, string> = {};
    if (!outcome) errs.outcome = 'Choose an outcome.';
    if (comment.trim().length < 10) errs.comment = 'Comment must be at least 10 characters.';
    setErrors(errs);
    if (!Object.keys(errs).length) m.mutate();
  };

  const option = (value: CloseOutcome, title: string, text: string, tone: string) => (
    <button
      type="button"
      onClick={() => setOutcome(value)}
      className={cx(
        'flex-1 rounded-xl border-2 p-4 text-left transition-colors',
        outcome === value ? tone : 'border-slate-200 hover:border-slate-300',
      )}
    >
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{text}</p>
    </button>
  );

  return (
    <Card className="border-violet-200">
      <CardHeader title="Close this alert" subtitle="You claimed this alert. Record your decision and the reason." />
      <div className="space-y-4 p-5">
        {banner && <ErrorBanner message={banner} />}
        <div className="flex flex-col gap-3 sm:flex-row">
          {option('CONFIRMED_FRAUD', 'Confirmed fraud', 'The cardholder did not make this payment. The card will be blocked.', 'border-red-500 bg-red-50')}
          {option('FALSE_POSITIVE', 'False positive', 'Genuine payment by the cardholder. Release the alert.', 'border-emerald-500 bg-emerald-50')}
        </div>
        {errors.outcome && <p className="text-xs text-red-600">{errors.outcome}</p>}
        {outcome === 'FALSE_POSITIVE' && (
          <p className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
            If {formatINR(d.transaction.amount)} is above the manager approval limit, this release goes to a manager first (maker-checker).
          </p>
        )}
        <Field label="Comment" error={errors.comment} hint={`${comment.trim().length}/10 characters minimum`}>
          <textarea
            rows={3}
            className={inputClass(!!errors.comment)}
            placeholder="e.g. Customer confirmed by phone, genuine travel."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </Field>
        <div className="flex justify-end">
          <Button loading={m.isPending} onClick={submit} variant={outcome === 'CONFIRMED_FRAUD' ? 'danger' : 'primary'}>
            Close alert
          </Button>
        </div>
      </div>
    </Card>
  );
}

function TransactionCard({ d }: { d: AlertDetail }) {
  const t = d.transaction;
  return (
    <Card>
      <CardHeader title="Transaction" right={<TxnStatusBadge status={t.status} />} />
      <div className="grid gap-6 p-5 sm:grid-cols-2">
        <div>
          <p className="tabular text-3xl font-semibold tracking-tight text-slate-900">{formatINR(t.amount)}</p>
          <div className="mt-3 space-y-1.5 text-sm text-slate-600">
            <p className="flex items-center gap-2"><Store className="size-4 text-slate-400" /> {t.merchant_name} <span className="font-mono text-xs text-slate-400">{t.merchant_id} · MCC {t.mcc}</span></p>
            <p className="flex items-center gap-2"><MapPin className="size-4 text-slate-400" /> {t.txn_city}, {t.txn_country} · {t.channel}</p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-500">Rules decision</span> <DecisionBadge decision={t.decision} />
          </div>
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-500">Final decision (after AI)</span> <DecisionBadge decision={t.final_decision} />
          </div>
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-500">Rule risk score</span>
            <span className="tabular font-semibold text-slate-900">{t.rule_risk_score ?? '—'}{t.rule_risk_score != null && <span className="text-slate-400"> / 100</span>}</span>
          </div>
        </div>
      </div>
      <div className="border-t border-slate-100 px-5 py-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Triggered rules</p>
        <ReasonChips codes={t.reason_codes} />
      </div>
    </Card>
  );
}

function FeaturesCard({ d }: { d: AlertDetail }) {
  const f = d.features;
  // A value is highlighted when the rule that uses it actually triggered on the server.
  const hit = (...codes: string[]) => codes.some((c) => d.transaction.reason_codes.includes(c));
  const items: { label: string; value: string; flag?: boolean; note: string }[] = [
    { label: 'Velocity (10 min)', value: f.velocity_10m == null ? '—' : String(f.velocity_10m), flag: hit('VELOCITY_BURST', 'HIGH_VELOCITY'), note: 'Prior transactions in the velocity window' },
    { label: 'Approved today', value: formatINR(f.approved_today), flag: hit('DAILY_LIMIT_EXCEEDED'), note: `Daily limit ${formatINR(d.card.daily_limit)}` },
    { label: '30-day average', value: formatINR(f.avg_amount_30d), flag: hit('AMOUNT_SPIKE'), note: f.avg_amount_30d ? `This payment is ${(d.transaction.amount / f.avg_amount_30d).toFixed(1)}× the average` : 'No 30-day history' },
    { label: 'Travel speed', value: f.speed_kmph == null ? '—' : `${f.speed_kmph.toFixed(2)} km/h`, flag: hit('IMPOSSIBLE_TRAVEL'), note: 'Since the last in-person payment' },
    { label: 'New merchant', value: f.new_merchant == null ? '—' : f.new_merchant ? 'Yes' : 'No', flag: hit('NEW_MERCHANT_HIGH_VALUE'), note: 'No earlier payment at this merchant in the look-back period' },
  ];
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Gauge className="size-4 text-slate-400" /> Features used in the decision</span>} />
      <div className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((i) => (
          <div key={i.label} className="bg-white p-4">
            <p className="text-xs text-slate-500">{i.label}</p>
            <p className={cx('tabular mt-1 text-lg font-semibold', i.flag ? 'text-red-600' : 'text-slate-900')}>{i.value}</p>
            <p className="mt-0.5 text-xs text-slate-400">{i.note}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RecentCard({ d }: { d: AlertDetail }) {
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><History className="size-4 text-slate-400" /> Recent transactions on this card</span>} />
      {d.recent_transactions.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">No earlier transactions.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {d.recent_transactions.map((r) => (
                <tr key={r.txn_id}>
                  <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{r.txn_id}</td>
                  <td className="px-5 py-2.5 text-slate-600">{formatDateTime(r.txn_ts)}</td>
                  <td className="px-5 py-2.5 text-slate-600">{r.txn_city}</td>
                  <td className="tabular px-5 py-2.5 text-right font-medium text-slate-900">{formatINR(r.amount)}</td>
                  <td className="px-5 py-2.5 text-right"><TxnStatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function AiCard({ d }: { d: AlertDetail }) {
  const ai = d.ai;
  const unavailable = ai.model_status === 'MODEL_UNAVAILABLE' || ai.fraud_score == null;
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><BrainCircuit className="size-4 text-brand-600" /> AI fraud score</span>}
        right={ai.model_version && !unavailable ? <span className="font-mono text-xs text-slate-400">{ai.model_version}</span> : undefined}
      />
      <div className="space-y-4 p-5">
        {unavailable ? (
          <div className="rounded-lg bg-slate-50 px-4 py-6 text-center">
            <p className="text-sm font-medium text-slate-700">AI score unavailable</p>
            <p className="mt-1 text-xs text-slate-500">The rules-only decision was used.</p>
          </div>
        ) : (
          <>
            <div className="flex items-end justify-between">
              <p className={cx('tabular text-4xl font-semibold tracking-tight', ai.fraud_score! >= 0.9 ? 'text-red-600' : ai.fraud_score! >= 0.7 ? 'text-amber-600' : 'text-emerald-600')}>
                {(ai.fraud_score! * 100).toFixed(2)}%
              </p>
              {d.transaction.reason_codes.includes('HIGH_FRAUD_SCORE_MODEL') && (
                <span className="pb-1 text-xs font-medium text-red-600">Raised the decision</span>
              )}
            </div>
            <FraudScore score={ai.fraud_score} />
            {ai.top_factors.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Top contributing factors</p>
                <ol className="space-y-1.5">
                  {ai.top_factors.map((f, i) => (
                    <li key={i} className="flex gap-2 text-sm text-slate-700">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">{i + 1}</span>
                      {f}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
        {d.narrative && (
          <div className="rounded-lg border border-brand-100 bg-brand-50/60 p-3">
            <Badge tone="violet"><Sparkles className="size-3" /> AI-generated</Badge>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">{d.narrative}</p>
          </div>
        )}
      </div>
    </Card>
  );
}

function CardInfo({ d }: { d: AlertDetail }) {
  const c = d.card;
  const { user } = useAuth();
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><CreditCard className="size-4 text-slate-400" /> Card</span>} right={<CardStatusBadge status={c.card_status} />} />
      <div className="space-y-4 p-5">
        <p className="font-mono text-sm tracking-widest text-slate-700">{c.masked_number}</p>
        <KeyValue
          items={[
            ['Card ID', <span className="font-mono">{c.card_id}</span>],
            ['Type', c.card_type],
            ['Home city', c.home_city],
            ['Daily limit', formatINR(c.daily_limit)],
          ]}
        />
        {user?.role === 'MANAGER' && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4 text-xs">
            <Link className="text-brand-700 hover:underline" to={`/manager/audit?entity=ALERT&id=${d.alert.alert_id}`}>Alert audit</Link>
            <span className="text-slate-300">·</span>
            <Link className="text-brand-700 hover:underline" to={`/manager/audit?entity=TRANSACTION&id=${d.transaction.txn_id}`}>Transaction audit</Link>
            <span className="text-slate-300">·</span>
            <Link className="text-brand-700 hover:underline" to={`/manager/audit?entity=CARD&id=${c.card_id}`}>Card audit</Link>
          </div>
        )}
      </div>
    </Card>
  );
}
