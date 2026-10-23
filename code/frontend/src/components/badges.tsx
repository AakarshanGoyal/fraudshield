import type { AlertStatus, CardStatus, Decision, Priority, TxnStatus } from '../api/types';
import { reasonLabel } from '../lib/format';
import { cx } from './ui';

type Tone = 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'slate' | 'orange';
const TONES: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  orange: 'bg-orange-50 text-orange-700 ring-orange-600/20',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  slate: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

export function Badge({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const TXN: Record<TxnStatus, [Tone, string]> = {
  RECEIVED: ['slate', 'Received'],
  STEP_UP_PENDING: ['amber', 'Awaiting confirmation'],
  APPROVED: ['green', 'Approved'],
  BLOCKED: ['red', 'Blocked'],
};
export const TxnStatusBadge = ({ status }: { status: TxnStatus }) => <Badge tone={TXN[status][0]}>{TXN[status][1]}</Badge>;

const DEC: Record<Decision, Tone> = { APPROVE: 'green', STEP_UP: 'amber', BLOCK: 'red' };
export const DecisionBadge = ({ decision }: { decision: Decision }) => <Badge tone={DEC[decision]}>{decision}</Badge>;

const ALERT: Record<AlertStatus, [Tone, string]> = {
  OPEN: ['blue', 'Open'],
  IN_REVIEW: ['violet', 'In review'],
  PENDING_MANAGER_APPROVAL: ['orange', 'Pending manager'],
  CONFIRMED_FRAUD: ['red', 'Confirmed fraud'],
  FALSE_POSITIVE: ['green', 'False positive'],
};
export const AlertStatusBadge = ({ status }: { status: AlertStatus }) => (
  <Badge tone={ALERT[status][0]}>{ALERT[status][1]}</Badge>
);

export const PriorityBadge = ({ priority }: { priority: Priority }) =>
  priority === 'HIGH' ? (
    <Badge tone="red" className="font-semibold">
      <span className="size-1.5 rounded-full bg-red-500" /> HIGH
    </Badge>
  ) : (
    <Badge tone="amber">
      <span className="size-1.5 rounded-full bg-amber-500" /> MEDIUM
    </Badge>
  );

const CARD: Record<CardStatus, Tone> = { ACTIVE: 'green', BLOCKED: 'red', EXPIRED: 'slate' };
export const CardStatusBadge = ({ status }: { status: CardStatus }) => <Badge tone={CARD[status]}>{status}</Badge>;

const HARD = new Set(['CARD_NOT_ACTIVE', 'INTL_NOT_ENABLED', 'DAILY_LIMIT_EXCEEDED']);
const FRAUD = new Set([
  'MERCHANT_BLACKLISTED', 'VELOCITY_BURST', 'IMPOSSIBLE_TRAVEL', 'MULTIPLE_RED_FLAGS',
  'STEP_UP_DENIED', 'STEP_UP_TIMEOUT', 'HIGH_FRAUD_SCORE_MODEL',
]);
/** Staff-only: reason codes are never shown to cardholders. */
export function ReasonChips({ codes }: { codes: string[] }) {
  if (!codes.length) return <span className="text-xs text-slate-400">No reason codes</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {codes.map((c) => (
        <Badge key={c} tone={FRAUD.has(c) ? 'red' : HARD.has(c) ? 'slate' : 'amber'}>
          <span title={c}>{reasonLabel(c)}</span>
        </Badge>
      ))}
    </div>
  );
}

export function FraudScore({ score, compact }: { score: number | null; compact?: boolean }) {
  if (score == null) return <span className="text-xs text-slate-400">{compact ? '—' : 'AI score unavailable'}</span>;
  const pct = score * 100;
  const tone = score >= 0.9 ? 'bg-red-500' : score >= 0.7 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2">
      <div className={cx('h-1.5 overflow-hidden rounded-full bg-slate-200', compact ? 'w-12' : 'w-24')}>
        <div className={cx('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular text-xs font-semibold text-slate-700">{pct.toFixed(compact ? 0 : 2)}%</span>
    </div>
  );
}
