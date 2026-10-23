import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Download, FileSearch, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { downloadAuditCsv, getAudit } from '../../api/endpoints';
import type { AuditEntity, AuditRow } from '../../api/types';
import { Badge } from '../../components/badges';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorBanner, JsonView, PageHeader, Spinner, cx, inputClass } from '../../components/ui';
import { formatDateTime } from '../../lib/format';

const ENTITIES: { id: AuditEntity; label: string; placeholder: string }[] = [
  { id: 'TRANSACTION', label: 'Transaction', placeholder: 'T200000007' },
  { id: 'ALERT', label: 'Alert', placeholder: '15' },
  { id: 'CARD', label: 'Card', placeholder: 'C1007' },
  { id: 'CONFIG', label: 'Config key', placeholder: 'velocity_burst_count' },
];

export default function Audit() {
  const [params, setParams] = useSearchParams();
  const entity = (params.get('entity') as AuditEntity) || 'TRANSACTION';
  const id = params.get('id') ?? '';
  const [draftEntity, setDraftEntity] = useState<AuditEntity>(entity);
  const [draftId, setDraftId] = useState(id);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();

  const q = useQuery({
    queryKey: ['audit', entity, id],
    queryFn: () => getAudit(entity, id),
    enabled: !!id,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draftId.trim()) return;
    setParams({ entity: draftEntity, id: draftId.trim() });
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadAuditCsv(entity, id);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHeader title="Audit trail" subtitle="Append-only history of every decision and status change, oldest first." />
      <Card className="mb-6 p-4">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <div className="flex rounded-lg border border-slate-300 bg-slate-50 p-0.5">
            {ENTITIES.map((en) => (
              <button
                type="button"
                key={en.id}
                onClick={() => setDraftEntity(en.id)}
                className={cx('rounded-md px-3 py-1.5 text-xs font-medium', draftEntity === en.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
              >
                {en.label}
              </button>
            ))}
          </div>
          <input
            value={draftId}
            onChange={(e) => setDraftId(e.target.value)}
            placeholder={`ID, e.g. ${ENTITIES.find((x) => x.id === draftEntity)!.placeholder}`}
            className={cx(inputClass(), 'w-64 font-mono')}
            aria-label="Entity ID"
          />
          <Button type="submit"><Search className="size-4" /> Show history</Button>
          {id && q.data && q.data.length > 0 && (
            <Button type="button" variant="secondary" loading={exporting} onClick={exportCsv} className="ml-auto">
              <Download className="size-4" /> Export CSV
            </Button>
          )}
        </form>
      </Card>

      {!id ? (
        <Card><EmptyState icon={<FileSearch className="size-10" />} title="Pick a record to see its history" hint="Choose a type and enter its ID. Alert and transaction pages link straight here." /></Card>
      ) : q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <Card><EmptyState title={`No audit rows for ${entity} ${id}`} hint="Check the ID, or nothing has happened to this record yet." /></Card>
      ) : (
        <Card className="p-5">
          <p className="mb-4 text-sm text-slate-500">
            <b className="text-slate-900">{q.data.length}</b> events for {entity.toLowerCase()} <span className="font-mono text-slate-800">{id}</span>
          </p>
          <ol className="relative space-y-4 border-l-2 border-slate-200 pl-6">
            {q.data.map((r) => <AuditItem key={r.id} r={r} />)}
          </ol>
        </Card>
      )}
    </div>
  );
}

function AuditItem({ r }: { r: AuditRow }) {
  const [open, setOpen] = useState(false);
  const hasPayload = r.before != null || r.after != null;
  return (
    <li className="relative">
      <span className="absolute -left-[31px] top-1 size-3.5 rounded-full border-2 border-white bg-brand-500 ring-2 ring-brand-100" />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="blue">{r.action}</Badge>
        {(r.from_status || r.to_status) && (
          <span className="flex items-center gap-1 font-mono text-xs text-slate-600">
            {r.from_status ?? '∅'} <ArrowRight className="size-3" /> {r.to_status ?? '∅'}
          </span>
        )}
        <span className="ml-auto text-xs text-slate-500">{formatDateTime(r.ts)}</span>
      </div>
      <p className="mt-1 text-sm text-slate-700">
        <b>{r.actor}</b> <span className="text-xs text-slate-400">({r.role})</span>
        {r.comment && <span className="text-slate-600"> · {r.comment}</span>}
      </p>
      {hasPayload && (
        <>
          <button onClick={() => setOpen((o) => !o)} className="mt-1 text-xs font-medium text-brand-700 hover:underline">
            {open ? 'Hide' : 'Show'} before / after
          </button>
          {open && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div><p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Before</p><JsonView value={r.before} /></div>
              <div><p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">After</p><JsonView value={r.after} /></div>
            </div>
          )}
        </>
      )}
    </li>
  );
}
