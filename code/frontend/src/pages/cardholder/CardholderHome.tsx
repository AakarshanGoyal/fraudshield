import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CreditCard, Globe, Receipt, Wifi } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../api/client';
import { blockMyCard, getMyCards, getMyTransactions, getPendingStepUps } from '../../api/endpoints';
import type { Card as CardT } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { CardStatusBadge, TxnStatusBadge } from '../../components/badges';
import { useToast } from '../../components/Toast';
import { Button, Card, CardHeader, EmptyState, ErrorBanner, Modal, PageHeader, Spinner, cx } from '../../components/ui';
import { formatDateTime, formatINR } from '../../lib/format';
import { StepUpModal } from './StepUpModal';

export default function CardholderHome() {
  const { user } = useAuth();
  const cards = useQuery({ queryKey: ['my-cards'], queryFn: getMyCards });
  const [selected, setSelected] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<CardT | null>(null);

  useEffect(() => {
    if (!selected && cards.data?.length) setSelected(cards.data[0].card_id);
  }, [cards.data, selected]);

  const txns = useQuery({
    queryKey: ['my-transactions', selected],
    queryFn: () => getMyTransactions(selected!, 50),
    enabled: !!selected,
    refetchInterval: 5000,
  });
  const stepups = useQuery({
    queryKey: ['stepups'],
    queryFn: getPendingStepUps,
    refetchInterval: 5000, // contract: poll every 5 seconds
  });

  const masked = (id: string) => {
    const c = cards.data?.find((x) => x.card_id === id);
    return c ? `•••• ${c.masked_number.slice(-4)}` : id;
  };
  const pending = stepups.data?.[0];

  return (
    <div>
      <PageHeader title={`Hello, ${user?.display_name.split(' ')[0] ?? ''}`} subtitle="Your cards and recent payments." />

      {cards.isLoading ? (
        <Spinner />
      ) : cards.isError ? (
        <ErrorBanner message={errorMessage(cards.error)} onRetry={() => cards.refetch()} />
      ) : !cards.data?.length ? (
        <Card><EmptyState icon={<CreditCard className="size-10" />} title="No cards on your profile" /></Card>
      ) : (
        <>
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.data.map((c) => (
              <BankCard
                key={c.card_id}
                card={c}
                active={c.card_id === selected}
                onSelect={() => setSelected(c.card_id)}
                onBlock={() => setBlocking(c)}
              />
            ))}
          </div>

          <Card>
            <CardHeader
              title={<span className="flex items-center gap-2"><Receipt className="size-4 text-slate-400" /> Payments on {selected ? masked(selected) : ''}</span>}
              subtitle="Newest first"
            />
            {txns.isLoading ? (
              <Spinner />
            ) : txns.isError ? (
              <div className="p-4"><ErrorBanner message={errorMessage(txns.error)} onRetry={() => txns.refetch()} /></div>
            ) : !txns.data?.length ? (
              <EmptyState title="No payments yet on this card" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {txns.data.map((t) => (
                  <li key={t.txn_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{t.merchant_name}</p>
                      <p className="text-xs text-slate-500">{formatDateTime(t.txn_ts)} · {t.txn_city} · {t.channel}</p>
                    </div>
                    <div className="text-right">
                      <p className="tabular text-sm font-semibold text-slate-900">{formatINR(t.amount)}</p>
                      <div className="mt-0.5"><TxnStatusBadge status={t.status} /></div>
                    </div>
                    {t.status !== 'APPROVED' && (
                      <p className={cx('basis-full text-xs', t.status === 'BLOCKED' ? 'text-red-600' : 'text-amber-700')}>{t.message}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {pending && <StepUpModal stepUp={pending} maskedFor={masked} />}
      {blocking && <BlockDialog card={blocking} onClose={() => setBlocking(null)} />}
    </div>
  );
}

function BankCard({ card, active, onSelect, onBlock }: { card: CardT; active: boolean; onSelect: () => void; onBlock: () => void }) {
  const blocked = card.card_status !== 'ACTIVE';
  return (
    <div className={cx('rounded-2xl p-1 transition', active ? 'ring-2 ring-brand-500 ring-offset-2' : '')}>
      <button
        onClick={onSelect}
        className={cx(
          'relative block aspect-[1.6] w-full overflow-hidden rounded-xl p-5 text-left text-white shadow-md',
          blocked
            ? 'bg-gradient-to-br from-slate-500 to-slate-700 grayscale'
            : card.card_type === 'CREDIT'
              ? 'bg-gradient-to-br from-slate-800 via-slate-900 to-black'
              : 'bg-gradient-to-br from-brand-600 via-indigo-700 to-brand-900',
        )}
      >
        <div className="absolute -right-10 -top-10 size-40 rounded-full bg-white/10" />
        <div className="relative flex items-start justify-between">
          <span className="text-xs font-semibold uppercase tracking-widest opacity-80">Kaveri {card.card_type}</span>
          <Wifi className="size-5 rotate-90 opacity-70" />
        </div>
        <p className="relative mt-6 font-mono text-lg tracking-[0.2em]">•••• •••• •••• {card.masked_number.slice(-4)}</p>
        <div className="relative mt-4 flex items-end justify-between text-xs">
          <div>
            <p className="opacity-60">Expires</p>
            <p className="font-medium">{card.expiry_date.slice(5, 7)}/{card.expiry_date.slice(2, 4)}</p>
          </div>
          {blocked && <span className="rounded bg-red-600 px-2 py-0.5 text-[11px] font-bold">{card.card_status}</span>}
        </div>
      </button>
      <div className="flex items-center justify-between px-1 pt-3 text-xs text-slate-500">
        <div className="space-y-0.5">
          <p>Daily limit <span className="tabular font-medium text-slate-700">{formatINR(card.daily_limit)}</span></p>
          <p className="flex items-center gap-1"><Globe className="size-3" /> International {card.international_enabled ? 'on' : 'off'}</p>
        </div>
        {card.card_status === 'ACTIVE' ? (
          <Button size="sm" variant="secondary" onClick={onBlock} className="text-red-700">
            <Ban className="size-3.5" /> Block card
          </Button>
        ) : (
          <CardStatusBadge status={card.card_status} />
        )}
      </div>
    </div>
  );
}

function BlockDialog({ card, onClose }: { card: CardT; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => blockMyCard(card.card_id),
    onSuccess: () => {
      toast('success', `Card ending ${card.masked_number.slice(-4)} is now blocked.`);
      qc.invalidateQueries({ queryKey: ['my-cards'] });
      onClose();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Block this card?"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={m.isPending} onClick={() => m.mutate()}>Block card</Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        The card ending <b className="font-mono">{card.masked_number.slice(-4)}</b> will stop working immediately. All new payments will be declined.
        You cannot unblock it from the app.
      </p>
    </Modal>
  );
}
