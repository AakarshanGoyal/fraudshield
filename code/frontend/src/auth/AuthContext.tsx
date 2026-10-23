import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { setUnauthorizedHandler, tokenStore } from '../api/client';
import { getMe, login as loginApi } from '../api/endpoints';
import type { Role, User } from '../api/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => void;
}
const Ctx = createContext<AuthState | null>(null);

export const homeFor = (role: Role) =>
  role === 'CARDHOLDER' ? '/cardholder' : role === 'ANALYST' ? '/analyst' : '/manager';

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(() => tokenStore.get() != null);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    qc.clear();
  }, [qc]);

  // Any 401 from the backend ends the session (there is no refresh token).
  useEffect(() => setUnauthorizedHandler(logout), [logout]);

  // On reload, check the stored token is still valid.
  useEffect(() => {
    if (!tokenStore.get()) return;
    getMe()
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await loginApi(username, password);
    tokenStore.set(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
