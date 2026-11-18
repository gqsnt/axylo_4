// The documented React chart under StrictMode, with a handler and a way to unmount, for the lifecycle test in
// first-chart.browser.test.ts (spec DX8: setup, cleanup, setup again; plan 1.7: create on mount, destroy on unmount).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Line } from '@axylo/react';

const rows = [
  { month: '2026-01', visitors: 4210 },
  { month: '2026-02', visitors: 4685 },
  { month: '2026-03', visitors: 5302 },
  { month: '2026-04', visitors: 5127 },
];
const page = window as unknown as { __hovers: number; __unmount: () => void };
page.__hovers = 0;
const root = createRoot(document.getElementById('root')!);
root.render(<StrictMode><Line title="Monthly visitors" data={rows} x="month" y="visitors" onHover={() => { page.__hovers++; }} /></StrictMode>);
page.__unmount = () => root.unmount();
