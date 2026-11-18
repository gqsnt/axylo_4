// Renders the same rows four times, each time as a new array of new objects: plan 1.7 says the development
// adapter then hints to memoize `data`. Used by tests/dist/flavours.browser.test.ts.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Line } from '@axylo/react';

const rows = [{ month: '2026-01', visitors: 4210 }, { month: '2026-02', visitors: 4685 }, { month: '2026-03', visitors: 5302 }];

function Rerendered() {
  const [renders, setRenders] = useState(1);
  useEffect(() => {
    if (renders < 4) setRenders(renders + 1);
    else (window as unknown as { __done: boolean }).__done = true;
  }, [renders]);
  return <Line title="Monthly visitors" data={rows.map(r => ({ ...r }))} x="month" y="visitors" />;
}

createRoot(document.getElementById('root')!).render(<Rerendered />);
