import { createRoot } from 'react-dom/client';
import { Line } from '@axylo/react';
import { trend as d } from './_phase1-data';

// Built once, outside the component, so every render passes the same array.
const rows = d.series.flatMap(s => s.values.map((sessions, i) => ({ day: d.t[i]!, channel: s.name, sessions })));

function Trend() {
  return (
    <Line
      title={d.title}
      data={rows}
      x={{ field: 'day', type: 'date' }}
      y={{ field: 'sessions', label: d.yTitle }}
      series="channel"
    />
  );
}

createRoot(document.getElementById('root')!).render(<Trend />);
