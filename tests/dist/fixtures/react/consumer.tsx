/**
 * An application's use of @axylo/react, type-checked (strict) against the packed declarations of both
 * packages, resolved through their `exports` from this fixture's node_modules (no path mapping).
 */
import { useRef } from 'react';
import type { LineOptions } from 'axylo';
import { Area, Bar, Donut, Line, Scatter, type ChartRef } from '@axylo/react';

interface Row { day: string; channel: string; sessions: number; visits: number }
declare const rows: Row[];

export function Dashboard() {
  const ref = useRef<ChartRef<Row, LineOptions<Row>>>(null);
  ref.current?.chart?.append([{ day: '2026-01-02', channel: 'Direct', sessions: 1, visits: 1 }]);
  return (
    <>
      <Line ref={ref} data={rows} x="day" y="sessions" series="channel" title="Sessions" id="card" className="c" style={{ height: 300 }} onHover={p => p?.series} />
      <Area data={rows} x="day" y="sessions" series="channel" stacked title="Stacked" />
      <Bar data={rows} x="channel" y="sessions" title="By channel" />
      <Scatter data={rows} x="visits" y="sessions" title="Visits and sessions" />
      <Donut data={rows} label="channel" value="sessions" title="Share" />
      {/* @ts-expect-error misspelled field */}
      <Line data={rows} x="day" y="sesions" />
      {/* @ts-expect-error zoom does not apply to a donut */}
      <Donut data={rows} label="channel" value="sessions" zoom />
    </>
  );
}
