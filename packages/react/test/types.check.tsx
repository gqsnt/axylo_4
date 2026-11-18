/**
 * Type tests, checked by `tsc -p packages/react` and never run. Each `@ts-expect-error` line must fail to
 * compile exactly as the matching core call does (plan 1.3, 1.2, 1.4).
 */
import { useRef } from 'react';
import { donut, line } from 'axylo';
import type { DonutOptions, LineOptions } from 'axylo';
import { Area, Bar, Donut, Line, Scatter, type ChartRef } from '../src/index';

interface Row { day: string; channel: string; sessions: number; visits: number; count: string }
declare const rows: Row[];

export function Valid() {
  const ref = useRef<ChartRef<Row, LineOptions<Row>>>(null);
  ref.current?.chart?.append([{ day: '2026-01-02', channel: 'Direct', sessions: 1, visits: 2, count: '3' }]);
  ref.current?.chart?.zoom(null);
  const donut = useRef<ChartRef<Row, DonutOptions<Row>>>(null);
  return (
    <>
      <Line ref={ref} data={rows} x="day" y="sessions" series="channel" title="Daily sessions" className="card" style={{ height: 300 }} />
      <Line data={rows} x={{ field: 'day', type: 'date' }} y={['sessions', { field: 'visits', label: 'Visits' }]} onHover={p => p?.row?.sessions} onZoom={d => d?.[0]} />
      <Line data={rows} x="day" y={{ field: 'count', parse: 'number' }} onDiagnostic={d => d.code} />
      <Line data={rows} x="day" y={['sessions', 'visits']} />
      <Area data={rows} x="day" y="sessions" series="channel" stacked />
      <Bar data={rows} x="channel" y="sessions" layout="stacked" horizontal />
      <Scatter data={rows} x="visits" y="sessions" series="channel" />
      <Donut ref={donut} data={rows} label="channel" value="sessions" onSelect={p => p.index} />
    </>
  );
}

/**
 * Each mistake is paired with the same expression made valid, so the directive is known to cover the
 * mistake and not something else on its line.
 */
export function Invalid() {
  const wide = ['sessions', 'visits'] as const;
  return (
    <>
      <Line data={rows} x="day" y="sessions" />
      {/* @ts-expect-error misspelled field */}
      <Line data={rows} x="day" y="sesions" />
      <Line data={rows} x="day" y={{ field: 'count', parse: 'number' }} />
      {/* @ts-expect-error a text field on a value axis without parse: 'number' */}
      <Line data={rows} x="day" y="channel" />
      <Line data={rows} x="day" y={wide} />
      {/* @ts-expect-error series cannot be combined with wide y */}
      <Line data={rows} x="day" y={wide} series="channel" />
      <Line data={rows} x="day" y="sessions" zoom />
      <Donut data={rows} label="channel" value="sessions" />
      {/* @ts-expect-error zoom does not apply to a donut */}
      <Donut data={rows} label="channel" value="sessions" zoom />
      <Line data={rows} x="day" y="sessions" onZoom={() => {}} />
      {/* @ts-expect-error onZoom does not apply to a donut either */}
      <Donut data={rows} label="channel" value="sessions" onZoom={() => {}} />
      <Bar data={rows} x="day" y="sessions" />
      {/* @ts-expect-error the same misspelling on the other chart types */}
      <Bar data={rows} x="day" y="sesions" />
      <Scatter data={rows} x={{ field: 'visits', type: 'number' }} y="sessions" />
      {/* @ts-expect-error a category x on a scatter chart */}
      <Scatter data={rows} x={{ field: 'channel', type: 'category' }} y="sessions" />
      <Line data={rows} x="day" y="sessions" id="card" data-testid="card" />
      {/* @ts-expect-error a DOM event prop is not a chart prop */}
      <Line data={rows} x="day" y="sessions" onClick={() => {}} />
    </>
  );
}

/** The same mistakes in core calls, so the components are seen to fail exactly where the core does. */
export function core(el: HTMLElement) {
  // @ts-expect-error misspelled field
  line(el, { data: rows, x: 'day', y: 'sesions' });
  // @ts-expect-error a text field on a value axis without parse: 'number'
  line(el, { data: rows, x: 'day', y: 'channel' });
  line(el, { data: rows, x: 'day', y: ['sessions', 'visits'] as const });
  // @ts-expect-error series cannot be combined with wide y
  line(el, { data: rows, x: 'day', y: ['sessions', 'visits'] as const, series: 'channel' });
  // @ts-expect-error zoom does not apply to a donut
  donut(el, { data: rows, label: 'channel', value: 'sessions', zoom: true });
}
