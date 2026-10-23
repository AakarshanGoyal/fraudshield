import axios, { AxiosError } from 'axios';
import { API_URL } from '../config';
import type { ApiErrorBody } from './types';

const TOKEN_KEY = 'fraudshield.token';

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage blocked: session lasts until reload */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Called on any 401 so the app can drop the session and go to /login.
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

/** Normalised error every screen can show: HTTP status + the contract's error body. */
export class ApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;
  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

api.interceptors.response.use(
  (res) => res,
  (err: AxiosError<ApiErrorBody>) => {
    const status = err.response?.status ?? 0;
    const body = err.response?.data?.error;
    if (status === 401 && !err.config?.url?.endsWith('/api/auth/login')) onUnauthorized();
    if (!err.response) {
      return Promise.reject(
        new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Is the backend running?'),
      );
    }
    return Promise.reject(
      new ApiError(status, body?.code ?? 'ERROR', body?.message ?? err.message, body?.fields ?? {}),
    );
  },
);

/** Friendly text for a failed call, used by toasts and banners. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403 && e.message === 'Forbidden') return 'You are not allowed to do this.';
    return e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}
