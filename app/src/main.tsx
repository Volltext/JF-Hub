import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/core/ui/tokens.css';
import '@/core/ui/base.css';
import { App } from '@/app/App';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { registerServiceWorker } from '@/core/push/webPush';

registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
