import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Line, type ChartRef } from '@axylo/react';
import type { LineOptions } from 'axylo';
import { stream } from './_phase1-data';

interface Sample { t: number; value: number }
const d = stream();

function Live() {
  // Re-rendering with a new array would make the chart read every row again; appending through
  // the ref adds only the new one.
  const [rows] = useState<Sample[]>(() => d.t.map((t, i) => ({ t, value: d.y[i]! })));
  const ref = useRef<ChartRef<Sample, LineOptions<Sample>>>(null);
  useEffect(() => {
    const timer = setInterval(() => {
      const [t, value] = d.next();
      ref.current?.chart?.append([{ t, value }], { keep: 600 });
    }, 250);
    return () => clearInterval(timer);
  }, []);
  return <Line ref={ref} title={d.title} data={rows} x={{ field: 't', type: 'time', timeZone: 'UTC' }} y="value" />;
}

createRoot(document.getElementById('root')!).render(<Live />);
