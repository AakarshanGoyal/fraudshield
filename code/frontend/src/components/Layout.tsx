import { LogOut, ShieldCheck, FlaskConical } from 'lucide-react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import type { Role } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { USE_MOCKS } from '../config';
import { cx, Spinner } from './ui';

const NAV: Record<Role, { to: string; label: string; end?: boolean }[]> = {
  CARDHOLDER: [{ to: '/cardholder', label: 'My cards' }],
  ANALYST: [
    { to: '/analyst', label: 'Alert queue', end: true },
    { to: '/simulate', label: 'Simulate' },
  ],
  MANAGER: [
    { to: '/manager', label: 'Dashboard', end: true },
    { to: '/manager/approvals', label: 'Approvals' },
    { to: '/analyst', label: 'Alert queue', end: true },
    { to: '/manager/audit', label: 'Audit trail' },
    { to: '/manager/config', label: 'Rule config' },
    { to: '/simulate', label: 'Simulate' },
  ],
};

const ROLE_TONE: Record<Role, string> = {
  CARDHOLDER: 'bg-sky-100 text-sky-800',
  ANALYST: 'bg-violet-100 text-violet-800',
  MANAGER: 'bg-amber-100 text-amber-800',
};

export function Layout() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Checking your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  const mocks = USE_MOCKS;
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-white">
              <ShieldCheck className="size-4.5" />
            </span>
            <span className="hidden text-sm font-semibold text-slate-900 sm:block">
              FraudShield <span className="font-normal text-slate-400">· Kaveri National Bank</span>
            </span>
          </div>
          <nav className="-mb-px flex flex-1 items-center gap-1 overflow-x-auto">
            {NAV[user.role].map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cx(
                    'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <div className="hidden text-right md:block">
              <p className="text-sm font-medium leading-tight text-slate-900">{user.display_name}</p>
              <p className="text-xs leading-tight text-slate-500">{user.username}</p>
            </div>
            <span className={cx('rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide', ROLE_TONE[user.role])}>
              {user.role}
            </span>
            <button
              onClick={logout}
              className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              aria-label="Log out"
              title="Log out"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </header>
      {mocks && (
        <div className="flex items-center justify-center gap-2 bg-amber-50 px-4 py-1 text-center text-xs text-amber-800">
          <FlaskConical className="size-3.5" /> Mock backend (VITE_USE_MOCKS=true). Data resets on reload.
        </div>
      )}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
