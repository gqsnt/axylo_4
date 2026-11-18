/**
 * A consumer of the built package: resolved through the package name to dist/index.d.ts, the way an
 * application sees it. Checked by test/dist.test.ts after building; not part of `tsc -p packages/react`.
 */
import { useRef } from 'react';
import type { LineOptions } from 'axylo';
import { Donut, Line, type ChartRef } from '@axylo/react';

interface Row { day: string; channel: string; sessions: number }
declare const rows: Row[];

export function App() {
  const ref = useRef<ChartRef<Row, LineOptions<Row>>>(null);
  ref.current?.chart?.append([{ day: '2026-01-02', channel: 'Direct', sessions: 1 }]);
  return (
    <>
      <Line ref={ref} data={rows} x="day" y="sessions" series="channel" title="Sessions" id="card" data-testid="card" className="c" style={{ height: 300 }} />
      {/* @ts-expect-error misspelled field */}
      <Line data={rows} x="day" y="sesions" />
      <Donut data={rows} label="channel" value="sessions" />
      {/* @ts-expect-error zoom does not apply to a donut */}
      <Donut data={rows} label="channel" value="sessions" zoom />
    </>
  );
}
