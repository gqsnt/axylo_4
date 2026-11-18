import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Line, type ChartRef } from '@axylo/react';
import type { LineOptions } from 'axylo';

interface Sample { at: number; rps: number }

let at = Date.UTC(2026, 2, 10, 9, 0, 0);
let step = 0;
const next = (): Sample => {
  at += 1000;
  step += 1;
  return { at, rps: Math.round(240 + 40 * Math.sin(step / 6)) };
};

function Live() {
  // The first rows are state, created once. A new `data` prop would replace what was appended.
  const [initial] = useState(() => Array.from({ length: 60 }, next));
  const ref = useRef<ChartRef<Sample, LineOptions<Sample>>>(null);

  useEffect(() => {
    // The ref reaches the chart's handle, for the methods props cannot express: append, zoom.
    const timer = setInterval(() => ref.current?.chart?.append([next()], { keep: 60 }), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Line
      ref={ref}
      title="Requests per second"
      data={initial}
      x={{ field: 'at', type: 'time', timeZone: 'UTC' }}
      y={{ field: 'rps', label: 'Requests', unit: 'req/s' }}
    />
  );
}

createRoot(document.getElementById('root')!).render(<Live />);
