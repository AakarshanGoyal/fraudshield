// Frontend checks for rule configuration. The backend already checks the type, negatives,
// unknown keys and the read-only `version`; these cover what it does not check yet
// (list contents, object keys, sensible ranges, min/max pairs).
import type { ConfigValue } from '../api/types';

export const READ_ONLY_KEYS = new Set(['version']);

// Key patterns match data/case_01_rules_config_V1.0.json.
const isCountLike = (key: string) => /(count|minutes|hours|days|_hour_|_min$|_max$|_ms$)/.test(key);
const mustBePositive = (key: string) => /(count|minutes|hours|days|_ms|_kmph|_multiplier|earth_radius_km)$/.test(key);
const isThreshold = (key: string) => /threshold/.test(key);

export function validateConfig(key: string, next: ConfigValue, current: ConfigValue, all: Record<string, ConfigValue>): string | null {
  if (READ_ONLY_KEYS.has(key)) return 'This value is read-only.';

  if (typeof current === 'number') {
    if (typeof next !== 'number' || !Number.isFinite(next)) return 'Enter a number.';
    if (next < 0) return 'Must be zero or more.';
    if (mustBePositive(key) && next === 0) return 'Must be greater than zero.';
    if (isThreshold(key) && next > 1) return 'Thresholds are between 0 and 1 (e.g. 0.70).';
    if (isCountLike(key) && !Number.isInteger(next)) return 'Must be a whole number.';
    if (/odd_hour_(start|end)/.test(key) && next > 23) return 'Hours are 0 to 23.';

    const n = (k: string) => (k === key ? next : (all[k] as number | undefined));
    const step = n('ai_step_up_threshold');
    const block = n('ai_block_threshold');
    if ((key === 'ai_step_up_threshold' || key === 'ai_block_threshold') && step != null && block != null && step >= block)
      return `Step-up threshold (${step}) must be below the block threshold (${block}).`;
    const vMin = n('velocity_stepup_min');
    const vMax = n('velocity_stepup_max');
    const burst = n('velocity_burst_count');
    if (['velocity_stepup_min', 'velocity_stepup_max', 'velocity_burst_count'].includes(key)) {
      if (vMin != null && vMax != null && vMin > vMax) return `Step-up min (${vMin}) must not be above step-up max (${vMax}).`;
      if (vMax != null && burst != null && vMax >= burst) return `Step-up max (${vMax}) must be below the burst count (${burst}).`;
    }
    const oStart = n('odd_hour_start');
    const oEnd = n('odd_hour_end');
    if ((key === 'odd_hour_start' || key === 'odd_hour_end') && oStart != null && oEnd != null && oStart > oEnd)
      return `Odd-hours start (${oStart}) must not be after the end (${oEnd}).`;
    return null;
  }

  if (Array.isArray(current)) {
    if (!Array.isArray(next)) return 'Must be a list.';
    if (next.length === 0) return 'Add at least one item.';
    if (key.includes('mcc')) {
      const bad = next.find((x) => typeof x !== 'string' || !/^[0-9]{4}$/.test(x));
      if (bad !== undefined) return `"${String(bad)}" is not a 4-digit MCC.`;
    }
    if (new Set(next.map(String)).size !== next.length) return 'The list has duplicates.';
    return null;
  }

  if (current && typeof current === 'object') {
    if (!next || typeof next !== 'object' || Array.isArray(next)) return 'Must be an object.';
    const want = Object.keys(current).sort().join(',');
    const got = Object.keys(next).sort().join(',');
    if (want !== got) return `Keys must stay exactly: ${Object.keys(current).join(', ')}.`;
    for (const [k, v] of Object.entries(next)) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return `${k} must be a number of zero or more.`;
      if (!Number.isInteger(v)) return `${k} must be a whole number.`;
    }
    return null;
  }

  if (typeof next !== typeof current) return `Must be a ${typeof current}.`;
  return null;
}

export const describeValue = (v: ConfigValue): string =>
  Array.isArray(v) ? v.join(', ') : v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k}: ${x}`).join(' · ') : String(v);
