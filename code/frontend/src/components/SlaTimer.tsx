import { Clock, AlarmClockOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDuration } from '../lib/format';
import { cx } from './ui';

/** Re-renders every `intervalMs` so countdowns tick. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * The backend decides `sla_breached`; this only shows the time left (or overdue).
 * Closed alerts show no timer.
 */
export function SlaTimer({ dueAt, breached, closed }: { dueAt: string; breached: boolean; closed?: boolean }) {
  const now = useNow();
  if (closed) return <span className="text-xs text-slate-400">—</span>;
  const left = new Date(dueAt).getTime() - now;
  if (breached || left <= 0) {
    return (
      <span className="inline-flex flex-col">
        <span className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-0.5 text-xs font-bold tracking-wide text-white">
          <AlarmClockOff className="size-3" /> SLA_BREACHED
        </span>
        <span className="tabular mt-0.5 text-[11px] text-red-600">overdue {formatDuration(left)}</span>
      </span>
    );
  }
  const urgent = left < 10 * 60_000;
  return (
    <span className={cx('tabular inline-flex items-center gap-1 text-xs font-medium', urgent ? 'text-orange-600' : 'text-slate-600')}>
      <Clock className="size-3.5" /> {formatDuration(left)} left
    </span>
  );
}
