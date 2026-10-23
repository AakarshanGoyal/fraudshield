const IST = 'Asia/Kolkata';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹1,00,000.00 (Indian digit grouping). */
export const formatINR = (n: number | null | undefined) => (n == null ? '—' : inr.format(n));

/** 0.0667 → "6.67%" */
export const formatPct = (rate: number | null | undefined, digits = 2) =>
  rate == null ? '—' : `${(rate * 100).toFixed(digits)}%`;

export const formatDateTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    timeZone: IST,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: false });

/** Current moment as ISO-8601 with the +05:30 offset the contract requires. */
export function nowIstIso(date = new Date()): string {
  const shifted = new Date(date.getTime() + 330 * 60_000);
  return shifted.toISOString().replace(/\.\d{3}Z$/, '+05:30');
}

/** "2026-03-04T14:05" (for <input type="datetime-local">) ↔ ISO with +05:30. */
export const istIsoToLocalInput = (iso: string) => iso.slice(0, 16);
export const localInputToIstIso = (v: string) => `${v.length === 16 ? `${v}:00` : v}+05:30`;

/** Duration like "12m 05s", "3h 10m", "2d 4h". */
export function formatDuration(ms: number): string {
  const s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}

/** Reason codes as readable labels for staff screens. */
export const reasonLabel = (code: string) =>
  code
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
