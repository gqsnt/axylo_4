// Hydrates the markup ssr.tsx rendered on the server for the same component (plan M7: SSR hydration).
import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { MonthlyVisitors } from './example/react';

hydrateRoot(document.getElementById('root')!, <StrictMode><MonthlyVisitors /></StrictMode>, {
  onRecoverableError: error => console.error('recoverable hydration error', error),
});
