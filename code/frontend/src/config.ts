// Backend base URL comes only from the environment (.env locally, a build arg in Docker).
// Vite inlines it at build time, so it must be set before `npm run dev` / `npm run build`.
const raw = import.meta.env.VITE_API_URL;

export const API_URL = (raw ?? '').replace(/\/+$/, '');
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true';

/** Set when required configuration is missing; main.tsx shows it instead of the app. */
export const CONFIG_ERROR = raw
  ? null
  : 'VITE_API_URL is not set. Copy .env.example to .env, or pass VITE_API_URL as a Docker build arg, then restart.';
