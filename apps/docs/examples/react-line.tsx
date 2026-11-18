import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Line } from '@axylo/react';
import type { Point } from 'axylo';

interface Row { day: string; channel: string; sessions: number }

function makeRows(): Row[] {
  return Array.from({ length: 14 }, (_, i) => ['Direct', 'Referral'].map((channel, c) => ({
    day: `2026-03-${String(i + 1).padStart(2, '0')}`,
    channel,
    sessions: Math.round((c ? 450 : 3100) + (c ? 40 : 300) * Math.sin(i / 2 + c)),
  }))).flat();
}

// Events give dates as epoch milliseconds; a calendar date is its UTC midnight.
const day = (value: string | number | Date) => new Date(value).toISOString().slice(0, 10);

function SessionsCard() {
  // Memoised: `data` is compared by identity, so a new array on every render would be read again.
  const rows = useMemo(makeRows, []);
  const [hovered, setHovered] = useState<Point<Row> | null>(null);
  return (
    <section>
      <Line
        title="Daily sessions by channel"
        data={rows}
        x="day"
        y={{ field: 'sessions', label: 'Sessions' }}
        series="channel"
        onHover={setHovered}
      />
      <p>{hovered ? `${hovered.series} on ${day(hovered.x)}: ${hovered.y ?? 'no data'}` : 'Point at the chart.'}</p>
    </section>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><SessionsCard /></StrictMode>);
