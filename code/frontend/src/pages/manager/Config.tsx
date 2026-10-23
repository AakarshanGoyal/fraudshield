import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, History, Lock, Pencil, Plus, SlidersHorizontal, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, errorMessage } from '../../api/client';
import { getConfig, putConfig } from '../../api/endpoints';
import type { ConfigEntry, ConfigValue } from '../../api/types';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorBanner, Field, Modal, PageHeader, Spinner, cx, inputClass } from '../../components/ui';
import { READ_ONLY_KEYS, describeValue, validateConfig } from '../../lib/configRules';
import { formatDateTime, reasonLabel } from '../../lib/format';

export default function ConfigPage() {
  const q = useQuery({ queryKey: ['config'], queryFn: getConfig });
  const [editing, setEditing] = useState<ConfigEntry | null>(null);
  const [filter, setFilter] = useState('');
  const all = useMemo(() => Object.fromEntries((q.data ?? []).map((c) => [c.key, c.value])), [q.data]);
  const rows = (q.data ?? []).filter((c) => c.key.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div>
      <PageHeader
        title="Rule configuration"
        subtitle="Thresholds, windows, points and lists used by rules R1–R13 and the AI. Changes apply without a code release and are audited."
        right={<input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter keys…" className={cx(inputClass(), 'w-56')} />}
      />
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !rows.length ? (
        <Card><EmptyState icon={<SlidersHorizontal className="size-10" />} title="No matching keys" /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5">Key</th>
                  <th className="px-5 py-2.5">Value</th>
                  <th className="px-5 py-2.5">Last updated</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((c) => {
                  const ro = READ_ONLY_KEYS.has(c.key);
                  return (
                    <tr key={c.key} className="hover:bg-slate-50/60">
                      <td className="px-5 py-3">
                        <p className="font-mono text-xs font-medium text-slate-900">{c.key}</p>
                        <p className="text-xs text-slate-400">{reasonLabel(c.key)}</p>
                      </td>
                      <td className="max-w-md px-5 py-3"><ValuePreview value={c.value} /></td>
                      <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">{formatDateTime(c.updated_at)}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right">
                        <Link to={`/manager/audit?entity=CONFIG&id=${encodeURIComponent(c.key)}`} className="mr-2 inline-flex rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Change history">
                          <History className="size-4" />
                        </Link>
                        {ro ? (
                          <span className="inline-flex items-center gap-1 text-xs text-slate-400"><Lock className="size-3" /> Read-only</span>
                        ) : (
                          <Button size="sm" variant="secondary" onClick={() => setEditing(c)}><Pencil className="size-3.5" /> Edit</Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {editing && <EditDialog entry={editing} all={all} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ValuePreview({ value }: { value: ConfigValue }) {
  if (Array.isArray(value))
    return <div className="flex flex-wrap gap-1">{value.map((v) => <span key={String(v)} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{String(v)}</span>)}</div>;
  if (value && typeof value === 'object')
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {Object.entries(value).map(([k, v]) => <span key={k}><span className="text-slate-500">{k}</span> <b className="tabular text-slate-900">{String(v)}</b></span>)}
      </div>
    );
  return <span className="tabular font-mono font-semibold text-slate-900">{String(value)}</span>;
}

function EditDialog({ entry, all, onClose }: { entry: ConfigEntry; all: Record<string, ConfigValue>; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<ConfigValue>(structuredClone(entry.value));
  const [text, setText] = useState(typeof entry.value === 'number' ? String(entry.value) : '');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const m = useMutation({
    mutationFn: (v: ConfigValue) => putConfig(entry.key, v),
    onSuccess: (res) => {
      toast('success', `${res.key} updated. The change is in the audit trail.`);
      qc.invalidateQueries({ queryKey: ['config'] });
      qc.invalidateQueries({ queryKey: ['audit', 'CONFIG', entry.key] });
      onClose();
    },
    onError: (e) => {
      setConfirming(false);
      // Show the backend's field message as-is (don't match on its text).
      setError(e instanceof ApiError ? e.fields.value ?? e.fields.key ?? e.message : errorMessage(e));
    },
  });

  const next: ConfigValue = typeof entry.value === 'number' ? (text.trim() === '' ? NaN : Number(text)) : draft;
  const review = () => {
    const problem = validateConfig(entry.key, next, entry.value, all);
    setError(problem);
    if (!problem) setConfirming(true);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={<span className="font-mono text-sm">{entry.key}</span>}
      footer={
        confirming ? (
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>Back</Button>
            <Button loading={m.isPending} onClick={() => m.mutate(next)}>Save change</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={review}>Review change</Button>
          </>
        )
      }
    >
      {confirming ? (
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">This changes live decisions immediately. Please check:</p>
          <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
            <span className="flex-1 break-words font-mono text-xs text-slate-500 line-through">{describeValue(entry.value)}</span>
            <ArrowRight className="size-4 shrink-0 text-slate-400" />
            <span className="flex-1 break-words font-mono text-xs font-semibold text-slate-900">{describeValue(next)}</span>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {typeof entry.value === 'number' && (
            <Field label="New value" error={error ?? undefined} hint={`Current: ${entry.value}`}>
              <input type="number" step="any" min={0} autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && review()} className={cx(inputClass(!!error), 'tabular font-mono')} />
            </Field>
          )}
          {Array.isArray(entry.value) && <ListEditor value={draft as string[]} onChange={setDraft} error={error} />}
          {entry.value && typeof entry.value === 'object' && !Array.isArray(entry.value) && (
            <ObjectEditor value={draft as Record<string, number>} onChange={setDraft} error={error} />
          )}
          {typeof entry.value !== 'number' && typeof entry.value !== 'object' && (
            <Field label="New value" error={error ?? undefined}>
              <input value={String(draft)} onChange={(e) => setDraft(e.target.value)} className={inputClass(!!error)} />
            </Field>
          )}
        </div>
      )}
    </Modal>
  );
}

function ListEditor({ value, onChange, error }: { value: string[]; onChange: (v: string[]) => void; error: string | null }) {
  const [item, setItem] = useState('');
  const add = () => {
    const v = item.trim();
    if (!v) return;
    onChange([...value, v]);
    setItem('');
  };
  return (
    <Field label="Items" error={error ?? undefined} hint="MCCs are 4 digits, e.g. 7995.">
      <div className="flex min-h-10 flex-wrap gap-1.5 rounded-lg border border-slate-300 p-2">
        {value.map((v, i) => (
          <span key={`${v}-${i}`} className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 font-mono text-xs text-brand-700">
            {v}
            <button onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remove ${v}`}><X className="size-3" /></button>
          </span>
        ))}
        {!value.length && <span className="text-xs text-slate-400">Empty list</span>}
      </div>
      <div className="mt-2 flex gap-2">
        <input value={item} onChange={(e) => setItem(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} placeholder="Add item" maxLength={8} className={cx(inputClass(), 'font-mono')} />
        <Button variant="secondary" onClick={add}><Plus className="size-4" /> Add</Button>
      </div>
    </Field>
  );
}

function ObjectEditor({ value, onChange, error }: { value: Record<string, number>; onChange: (v: Record<string, number>) => void; error: string | null }) {
  return (
    <div className="space-y-2">
      {Object.entries(value).map(([k, v]) => (
        <label key={k} className="flex items-center justify-between gap-3">
          <span className="font-mono text-xs text-slate-600">{k}</span>
          <input
            type="number"
            min={0}
            value={Number.isNaN(v) ? '' : v}
            onChange={(e) => onChange({ ...value, [k]: e.target.value === '' ? NaN : Number(e.target.value) })}
            className={cx(inputClass(), 'tabular w-28 text-right font-mono')}
          />
        </label>
      ))}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
