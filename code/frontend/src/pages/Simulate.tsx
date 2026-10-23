import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BrainCircuit, Clock, ExternalLink, Play, Send, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, errorMessage } from '../api/client';
import { simulate } from '../api/endpoints';
import type { AuthorisationResponse, Channel, SimulateRequest } from '../api/types';
import { CHANNELS } from '../api/types';
import { DecisionBadge, FraudScore, ReasonChips, TxnStatusBadge } from '../components/badges';
import { Button, Card, CardHeader, ErrorBanner, Field, PageHeader, cx, inputClass } from '../components/ui';
import { formatDateTime, formatINR, istIsoToLocalInput, localInputToIstIso, nowIstIso } from '../lib/format';

interface Form {
  txn_id: string;
  card_id: string;
  txn_ts: string; // datetime-local value, IST
  amount: string;
  merchant_id: string;
  mcc: string;
  channel: Channel;
  txn_city: string;
  txn_country: string;
}

const CITY_COUNTRY: Record<string, string> = {
  Mumbai: 'IN', Delhi: 'IN', Pune: 'IN', Bengaluru: 'IN', Chennai: 'IN', Kolkata: 'IN', Hyderabad: 'IN', Singapore: 'SG', Dubai: 'AE', London: 'GB',
};

const nowLocal = () => istIsoToLocalInput(nowIstIso());
const todayAt = (hhmm: string) => `${nowIstIso().slice(0, 10)}T${hhmm}`;

// Worked examples from the case document. Times use "now" so step-ups don't expire instantly.
const PRESETS: { id: string; label: string; expect: string; form: Omit<Form, 'txn_id' | 'txn_ts'> & { txn_ts?: () => string } }[] = [
  { id: 'ex1', label: 'Ex 1 · Normal payment', expect: 'APPROVE', form: { card_id: 'C1007', amount: '3500.00', merchant_id: 'M00450', mcc: '5411', channel: 'POS', txn_city: 'Mumbai', txn_country: 'IN' } },
  { id: 'ex3', label: 'Ex 3 · Abroad, intl off', expect: 'BLOCK · INTL_NOT_ENABLED', form: { card_id: 'C1007', amount: '3500.00', merchant_id: 'M00450', mcc: '5411', channel: 'POS', txn_city: 'Singapore', txn_country: 'SG' } },
  { id: 'ex5', label: 'Ex 5 · Impossible travel', expect: 'BLOCK · IMPOSSIBLE_TRAVEL', form: { card_id: 'C1005', amount: '4000.00', merchant_id: 'M00450', mcc: '5411', channel: 'POS', txn_city: 'Delhi', txn_country: 'IN' } },
  { id: 'ex7', label: 'Ex 7 · Amount spike', expect: 'STEP_UP · AMOUNT_SPIKE', form: { card_id: 'C1007', amount: '15000.00', merchant_id: 'M00451', mcc: '5732', channel: 'ECOM', txn_city: 'Mumbai', txn_country: 'IN' } },
  { id: 'ex10', label: 'Ex 10 · Multiple red flags', expect: 'BLOCK · MULTIPLE_RED_FLAGS', form: { card_id: 'C1010', amount: '45000.00', merchant_id: 'M00452', mcc: '6051', channel: 'ECOM', txn_city: 'Mumbai', txn_country: 'IN', txn_ts: () => todayAt('02:30') } },
];

const EMPTY: Form = { txn_id: '', card_id: '', txn_ts: nowLocal(), amount: '', merchant_id: '', mcc: '', channel: 'POS', txn_city: 'Mumbai', txn_country: 'IN' };

function validate(f: Form): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.txn_id && !/^T[0-9]{9}$/.test(f.txn_id)) e.txn_id = 'T followed by 9 digits, or leave empty';
  if (!f.card_id.trim()) e.card_id = 'Required';
  if (!f.txn_ts) e.txn_ts = 'Required';
  const amt = Number(f.amount);
  if (!f.amount || !Number.isFinite(amt) || amt <= 0 || amt > 1_000_000) e.amount = 'Greater than 0 and up to 10,00,000';
  else if (!/^\d+(\.\d{1,2})?$/.test(f.amount)) e.amount = 'At most 2 decimals';
  if (!f.merchant_id.trim()) e.merchant_id = 'Required';
  if (!/^[0-9]{4}$/.test(f.mcc)) e.mcc = '4 digits';
  if (!f.txn_city.trim()) e.txn_city = 'Required';
  if (!/^[A-Z]{2}$/.test(f.txn_country)) e.txn_country = '2-letter code, e.g. IN';
  return e;
}

export default function Simulate() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [preset, setPreset] = useState<string | null>(null);
  const [results, setResults] = useState<{ req: SimulateRequest; res: AuthorisationResponse; expect?: string }[]>([]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const m = useMutation({
    mutationFn: simulate,
    onSuccess: (res, req) => {
      setResults((r) => [{ req, res, expect: PRESETS.find((p) => p.id === preset)?.expect }, ...r].slice(0, 10));
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fields);
      setBanner(errorMessage(e));
    },
  });

  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)!;
    const { txn_ts, ...rest } = p.form;
    setForm({ ...rest, txn_id: '', txn_ts: txn_ts ? txn_ts() : nowLocal() });
    setPreset(id);
    setErrors({});
    setBanner(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBanner(null);
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    m.mutate({
      ...(form.txn_id ? { txn_id: form.txn_id } : {}),
      card_id: form.card_id.trim(),
      txn_ts: localInputToIstIso(form.txn_ts),
      amount: Math.round(Number(form.amount) * 100) / 100,
      currency: 'INR',
      merchant_id: form.merchant_id.trim(),
      mcc: form.mcc,
      channel: form.channel,
      txn_city: form.txn_city.trim(),
      txn_country: form.txn_country,
    });
  };

  const input = (k: keyof Form, { className, ...props }: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      {...props}
      id={k}
      value={form[k]}
      onChange={(e) => { set(k, e.target.value as never); setPreset(null); }}
      className={cx(inputClass(!!errors[k]), className)}
    />
  );

  return (
    <div>
      <PageHeader title="Simulate a transaction" subtitle="Sends a card payment through the real decision engine, as the gateway would. For demos and testing." />

      <div className="mb-6 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => applyPreset(p.id)}
            className={cx(
              'rounded-lg border px-3 py-2 text-left text-xs transition-colors',
              preset === p.id ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white hover:border-slate-300',
            )}
          >
            <span className="flex items-center gap-1 font-semibold text-slate-800"><Sparkles className="size-3 text-brand-500" /> {p.label}</span>
            <span className="mt-0.5 block text-slate-500">Expect {p.expect}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="Transaction" subtitle="Currency is always INR." />
          <form onSubmit={submit} className="space-y-4 p-5" noValidate>
            {banner && <ErrorBanner message={banner} />}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Card ID" htmlFor="card_id" error={errors.card_id}>{input('card_id', { placeholder: 'C1007', className: 'font-mono' })}</Field>
              <Field label="Transaction ID (optional)" htmlFor="txn_id" error={errors.txn_id}>{input('txn_id', { placeholder: 'auto', className: 'font-mono' })}</Field>
            </div>
            <Field label="Time (IST)" htmlFor="txn_ts" error={errors.txn_ts}>
              <div className="flex gap-2">
                {input('txn_ts', { type: 'datetime-local', step: 60 })}
                <Button type="button" variant="secondary" onClick={() => set('txn_ts', nowLocal())}><Clock className="size-4" /> Now</Button>
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount (₹)" htmlFor="amount" error={errors.amount}>{input('amount', { inputMode: 'decimal', placeholder: '15000.00', className: 'tabular' })}</Field>
              <Field label="Channel" htmlFor="channel">
                <select id="channel" value={form.channel} onChange={(e) => set('channel', e.target.value as Channel)} className={inputClass()}>
                  {CHANNELS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Merchant ID" htmlFor="merchant_id" error={errors.merchant_id}>{input('merchant_id', { placeholder: 'M00451', className: 'font-mono' })}</Field>
              <Field label="MCC" htmlFor="mcc" error={errors.mcc}>{input('mcc', { placeholder: '5732', maxLength: 4, inputMode: 'numeric', className: 'font-mono' })}</Field>
            </div>
            <div className="grid grid-cols-[1fr_6rem] gap-3">
              <Field label="City" htmlFor="txn_city" error={errors.txn_city}>
                <input
                  id="txn_city"
                  list="cities"
                  value={form.txn_city}
                  onChange={(e) => {
                    const city = e.target.value;
                    setForm((f) => ({ ...f, txn_city: city, txn_country: CITY_COUNTRY[city] ?? f.txn_country }));
                    setPreset(null);
                  }}
                  className={inputClass(!!errors.txn_city)}
                />
                <datalist id="cities">{Object.keys(CITY_COUNTRY).map((c) => <option key={c} value={c} />)}</datalist>
              </Field>
              <Field label="Country" htmlFor="txn_country" error={errors.txn_country}>
                {input('txn_country', { maxLength: 2, className: 'font-mono uppercase' })}
              </Field>
            </div>
            <Button type="submit" className="w-full" loading={m.isPending}><Send className="size-4" /> Send transaction</Button>
          </form>
        </Card>

        <div className="space-y-4 lg:col-span-3">
          {results.length === 0 ? (
            <Card className="flex flex-col items-center justify-center gap-2 p-12 text-center">
              <Play className="size-10 text-slate-300" />
              <p className="text-sm font-medium text-slate-700">Pick a preset or fill the form, then send.</p>
              <p className="max-w-sm text-xs text-slate-500">The decision, reason codes and any alert appear here. Alerts show up in the analyst queue within 5 seconds.</p>
            </Card>
          ) : (
            results.map((r, i) => <ResultCard key={`${r.res.txn_id}-${i}`} {...r} latest={i === 0} />)
          )}
        </div>
      </div>
    </div>
  );
}

function ResultCard({ req, res, expect, latest }: { req: SimulateRequest; res: AuthorisationResponse; expect?: string; latest: boolean }) {
  const tone = res.final_decision === 'APPROVE' ? 'border-l-emerald-500' : res.final_decision === 'STEP_UP' ? 'border-l-amber-500' : 'border-l-red-500';
  return (
    <Card className={cx('border-l-4', tone, !latest && 'opacity-75')}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div>
          <p className="font-mono text-xs text-slate-500">{res.txn_id} · {formatDateTime(res.processed_at)}</p>
          <p className="mt-1 text-sm text-slate-700">
            <b className="tabular">{formatINR(req.amount)}</b> · {req.channel} · {req.txn_city} · card <span className="font-mono">{req.card_id}</span>
          </p>
        </div>
        <TxnStatusBadge status={res.status} />
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-3">
        <div>
          <p className="text-xs text-slate-500">Rules decision</p>
          <div className="mt-1"><DecisionBadge decision={res.decision} /></div>
        </div>
        <div>
          <p className="text-xs text-slate-500">Final decision</p>
          <div className="mt-1"><DecisionBadge decision={res.final_decision} /></div>
        </div>
        <div>
          <p className="text-xs text-slate-500">Rule risk score</p>
          <p className="tabular mt-1 text-sm font-semibold text-slate-900">{res.rule_risk_score ?? '—'}</p>
        </div>
        <div className="sm:col-span-3">
          <p className="mb-1.5 text-xs text-slate-500">Reason codes</p>
          <ReasonChips codes={res.reason_codes} />
        </div>
        <div className="sm:col-span-2">
          <p className="mb-1.5 flex items-center gap-1 text-xs text-slate-500"><BrainCircuit className="size-3.5" /> AI ({res.model_status})</p>
          <FraudScore score={res.model_status === 'OK' ? res.fraud_score : null} />
          {res.top_factors.length > 0 && <p className="mt-1 text-xs text-slate-500">{res.top_factors.join(' · ')}</p>}
        </div>
        <div className="sm:text-right">
          {res.alert_id != null ? (
            <Link to={`/analyst/alerts/${res.alert_id}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
              Alert #{res.alert_id} <ExternalLink className="size-3.5" />
            </Link>
          ) : (
            <span className="text-xs text-slate-400">No alert</span>
          )}
        </div>
      </div>
      {(expect || res.status === 'STEP_UP_PENDING') && (
        <div className="space-y-1 border-t border-slate-100 bg-slate-50 px-5 py-2.5 text-xs text-slate-600">
          {expect && <p>Worked example expects: <b>{expect}</b></p>}
          {res.status === 'STEP_UP_PENDING' && (
            <p>Waiting for the cardholder. Log in as the card's owner to answer "Was this you?". The OTP is in the backend console log.</p>
          )}
        </div>
      )}
    </Card>
  );
}
