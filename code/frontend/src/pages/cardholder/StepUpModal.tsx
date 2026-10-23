import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldQuestion, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, errorMessage } from '../../api/client';
import { respondStepUp } from '../../api/endpoints';
import type { PendingStepUp, StepUpResponse } from '../../api/types';
import { useNow } from '../../components/SlaTimer';
import { useToast } from '../../components/Toast';
import { Button, ErrorBanner, Field, Modal, cx, inputClass } from '../../components/ui';
import { formatDateTime, formatDuration, formatINR } from '../../lib/format';

/** "Was this you?" for the oldest pending step-up. */
export function StepUpModal({ stepUp, maskedFor }: { stepUp: PendingStepUp; maskedFor: (cardId: string) => string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const now = useNow();
  const [mode, setMode] = useState<'ask' | 'otp' | 'deny'>('ask');
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState<string | undefined>();
  const [banner, setBanner] = useState<string | null>(null);
  const left = new Date(stepUp.expires_at).getTime() - now;

  // Reset when a different step-up comes up.
  useEffect(() => {
    setMode('ask');
    setOtp('');
    setOtpError(undefined);
    setBanner(null);
  }, [stepUp.txn_id]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['stepups'] });
    qc.invalidateQueries({ queryKey: ['my-transactions'] });
    qc.invalidateQueries({ queryKey: ['my-cards'] });
  };

  const m = useMutation({
    mutationFn: (body: StepUpResponse) => respondStepUp(stepUp.txn_id, body),
    onSuccess: (res) => {
      toast(res.status === 'APPROVED' ? 'success' : 'info', res.message);
      refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 422 && e.fields.otp) {
        setOtpError('Incorrect OTP. Check the code and try again.');
      } else if (e instanceof ApiError && e.status === 409) {
        toast('error', 'This request has expired.');
        refresh();
      } else setBanner(errorMessage(e));
    },
  });

  const confirmOtp = () => {
    setOtpError(undefined);
    if (!/^[0-9]{6}$/.test(otp)) return setOtpError('Enter the 6-digit code.');
    m.mutate({ response: 'CONFIRM', otp });
  };

  return (
    <Modal open onClose={() => {}} dismissable={false} title={<span className="flex items-center gap-2"><ShieldQuestion className="size-5 text-brand-600" /> Was this you?</span>}>
      <div className="space-y-4">
        {banner && <ErrorBanner message={banner} />}
        <div className="rounded-xl bg-slate-50 p-4">
          <p className="tabular text-2xl font-semibold text-slate-900">{formatINR(stepUp.amount)}</p>
          <p className="mt-1 text-sm text-slate-700">{stepUp.merchant_name}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {formatDateTime(stepUp.txn_ts)} · card <span className="font-mono">{maskedFor(stepUp.card_id)}</span>
          </p>
        </div>
        <p className={cx('flex items-center gap-1.5 text-xs font-medium', left < 120_000 ? 'text-red-600' : 'text-slate-500')}>
          <Timer className="size-3.5" />
          {left > 0 ? `Please respond within ${formatDuration(left)}` : 'Time is up. Checking…'}
        </p>

        {mode === 'ask' && (
          <div className="grid grid-cols-2 gap-3">
            <Button variant="success" onClick={() => setMode('otp')}>Yes, it was me</Button>
            <Button variant="danger" onClick={() => setMode('deny')}>No, not me</Button>
          </div>
        )}

        {mode === 'otp' && (
          <div className="space-y-3">
            <Field label="Enter the 6-digit OTP" error={otpError} hint="Demo: the OTP is printed in the backend console log (no SMS is sent).">
              <input
                autoFocus
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && confirmOtp()}
                className={cx(inputClass(!!otpError), 'tabular text-center font-mono text-xl tracking-[0.5em]')}
                placeholder="••••••"
              />
            </Field>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setMode('ask')}>Back</Button>
              <Button loading={m.isPending} onClick={confirmOtp}>Confirm payment</Button>
            </div>
          </div>
        )}

        {mode === 'deny' && (
          <div className="space-y-3">
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              We will decline this payment and <b>block this card</b> to protect you.
            </p>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setMode('ask')}>Back</Button>
              <Button variant="danger" loading={m.isPending} onClick={() => m.mutate({ response: 'NOT_ME' })}>
                Decline and block card
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
