// Mounts the documented React snippet the way an application's entry would, under StrictMode (spec DX8:
// setup, cleanup and setup again).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MonthlyVisitors } from './example/react';

createRoot(document.getElementById('root')!).render(<StrictMode><MonthlyVisitors /></StrictMode>);
