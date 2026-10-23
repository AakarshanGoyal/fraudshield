import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { getConfig } from './endpoints';

/**
 * Live rule configuration (GET /api/config is MANAGER-only). Returns undefined values for other
 * roles or while loading, so callers must have wording that works without a number.
 * Shares the ['config'] cache with the Rule config page, so edits there update everywhere.
 */
export function useConfig() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['config'], queryFn: getConfig, enabled: user?.role === 'MANAGER', staleTime: 30_000 });
  const get = <T,>(key: string): T | undefined => q.data?.find((c) => c.key === key)?.value as T | undefined;
  return { get, loaded: q.isSuccess };
}
