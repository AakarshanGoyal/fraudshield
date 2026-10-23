import { ShieldCheck, Zap, MessageSquareLock, ListChecks } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, errorMessage } from '../api/client';
import { homeFor, useAuth } from '../auth/AuthContext';
import { USE_MOCKS } from '../config';
import { Button, ErrorBanner, Field, inputClass } from '../components/ui';

const DEMO = [
  { username: 'analyst1', label: 'Analyst 1' },
  { username: 'analyst2', label: 'Analyst 2' },
  { username: 'manager1', label: 'Manager 1' },
  { username: 'manager2', label: 'Manager 2' },
  ...(USE_MOCKS ? [{ username: 'ravi.sharma', label: 'Cardholder' }] : []),
];

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFields({});
    const local: Record<string, string> = {};
    if (!username.trim()) local.username = 'Enter your username';
    if (!password) local.password = 'Enter your password';
    if (Object.keys(local).length) return setFields(local);
    setBusy(true);
    try {
      const u = await login(username.trim(), password);
      const target = from && from.startsWith(homeFor(u.role)) ? from : homeFor(u.role);
      navigate(target, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setFields(err.fields);
      setError(err instanceof ApiError && err.status === 401 ? 'Wrong username or password.' : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-brand-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-brand-600/30 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-indigo-400/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <ShieldCheck className="size-5" />
          </span>
          <span className="text-lg font-semibold">FraudShield</span>
        </div>
        <div className="relative max-w-md space-y-8">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Stop fraud in real time, without blocking genuine customers.
          </h1>
          <ul className="space-y-4 text-sm text-indigo-100">
            <li className="flex gap-3"><Zap className="size-5 shrink-0 text-indigo-300" /> Every card payment decided in under 300 ms with clear reason codes.</li>
            <li className="flex gap-3"><MessageSquareLock className="size-5 shrink-0 text-indigo-300" /> Doubtful payments are confirmed with the cardholder instead of declined.</li>
            <li className="flex gap-3"><ListChecks className="size-5 shrink-0 text-indigo-300" /> Analysts work a prioritised queue with SLAs and a full audit trail.</li>
          </ul>
        </div>
        <p className="relative text-xs text-indigo-300">Kaveri National Bank · Fraud Operations</p>
      </div>

      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="grid size-9 place-items-center rounded-lg bg-brand-600 text-white"><ShieldCheck className="size-5" /></span>
            <span className="text-lg font-semibold">FraudShield</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Cardholders, analysts and managers all sign in here.</p>

          <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
            {error && <ErrorBanner message={error} />}
            <Field label="Username" htmlFor="username" error={fields.username}>
              <input id="username" autoComplete="username" className={inputClass(!!fields.username)} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            </Field>
            <Field label="Password" htmlFor="password" error={fields.password}>
              <input id="password" type="password" autoComplete="current-password" className={inputClass(!!fields.password)} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Button type="submit" className="w-full" loading={busy}>Sign in</Button>
          </form>

          <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-4">
            <p className="text-xs font-medium text-slate-600">Demo logins (password <code className="font-mono">demo123</code>)</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.username}
                  type="button"
                  onClick={() => { setUsername(d.username); setPassword('demo123'); setFields({}); setError(null); }}
                  className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-700"
                >
                  {d.label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-400">Cardholders use their <code className="font-mono">username</code> from customers.csv.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
