import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ApiError } from './api/client';
import App from './App';
import { CONFIG_ERROR, USE_MOCKS } from './config';
import { AuthProvider } from './auth/AuthContext';
import { ToastProvider } from './components/Toast';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't retry 4xx (wrong role, not found…); retry network blips once.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 1,
      refetchOnWindowFocus: false,
    },
  },
});

async function start() {
  if (CONFIG_ERROR) {
    document.getElementById('root')!.innerHTML =
      `<div style="max-width:560px;margin:80px auto;padding:20px;font-family:system-ui;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:12px"><b>Configuration error</b><p>${CONFIG_ERROR}</p></div>`;
    console.error(CONFIG_ERROR);
    return;
  }
  if (USE_MOCKS) {
    const { worker } = await import('./mocks/browser');
    await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
    console.info('%c[FraudShield] Mock backend active. Set VITE_USE_MOCKS=false to use the real API.', 'color:#b45309');
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

start();
