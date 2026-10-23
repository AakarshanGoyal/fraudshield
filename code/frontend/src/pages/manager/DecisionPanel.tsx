import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, errorMessage } from '../../api/client';
import { decideAlert } from '../../api/endpoints';
import type { ManagerDecision } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';
import { Button, ErrorBanner, Field, inputClass } from '../../components/ui';

/** Checker step for a FALSE_POSITIVE proposal above the maker-checker limit. */
export function DecisionPanel({
  alertId,
  proposedBy,
  onDone,
}: {
  alertId: number;
  proposedBy: string | null;
  onDone?: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<string | undefined>();
  const ownProposal = proposedBy != null && proposedBy === user?.username;

  const m = useMutation({
    mutationFn: (d: ManagerDecision) => decideAlert(alertId, d, comment.trim()),
    onSuccess: (res) => {
      toast('success', `Alert #${res.alert_id} is now ${res.status.replace('_', ' ').toLowerCase()}.`);
      setComment('');
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['alert', String(alertId)] });
      onDone?.();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 403) setError('You cannot approve a proposal you made yourself. Another manager must check it.');
      else if (e instanceof ApiError && e.status === 409) {
        setError('Another manager already decided this alert.');
        qc.invalidateQueries({ queryKey: ['alerts'] });
        qc.invalidateQueries({ queryKey: ['alert', String(alertId)] });
      } else {
        setFieldErr(e instanceof ApiError ? e.fields.comment : undefined);
        setError(errorMessage(e));
      }
    },
  });

  const submit = (d: ManagerDecision) => {
    setError(null);
    setFieldErr(undefined);
    if (comment.trim().length < 10) return setFieldErr('Comment must be at least 10 characters.');
    m.mutate(d);
  };

  return (
    <div className="space-y-3">
      {ownProposal && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          You proposed this release yourself. Maker and checker must be different people, so another manager has to check it.
        </div>
      )}
      {error && <ErrorBanner message={error} />}
      <Field label="Manager comment" error={fieldErr} hint={`${comment.trim().length}/10 characters minimum`}>
        <textarea
          rows={3}
          className={inputClass(!!fieldErr)}
          placeholder="Reviewed the evidence and…"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="success" loading={m.isPending && m.variables === 'APPROVE'} disabled={m.isPending} onClick={() => submit('APPROVE')}>
          Approve: genuine payment
        </Button>
        <Button variant="danger" loading={m.isPending && m.variables === 'REJECT'} disabled={m.isPending} onClick={() => submit('REJECT')}>
          Reject: confirm fraud
        </Button>
      </div>
      <p className="text-xs text-slate-500">Approve releases it as FALSE_POSITIVE. Reject marks it CONFIRMED_FRAUD and blocks the card.</p>
    </div>
  );
}
