/**
 * An application's use of every export, type-checked (strict) against the packed declarations only: the
 * fixture's tsconfig has no path mapping and no ambient types, so `axylo` resolves through the tarball's
 * `exports` "types" condition. The mistakes at the end come from spec DX3 and docs/api/examples.ts; if the
 * declarations had collapsed to `any`, each @ts-expect-error would itself be an error.
 */
import { area, bar, donut, line, scatter, validate } from 'axylo';
import type { Chart, Diagnostic, LineOptions, Point } from 'axylo';

interface Visit { day: string; channel: string; sessions: number; share: string }
const rows: Visit[] = [{ day: '2026-01-01', channel: 'Direct', sessions: 31713, share: '0.41' }];

const options: LineOptions<Visit> = { title: 'Daily sessions', data: rows, x: 'day', y: 'sessions', series: 'channel' };
const chart: Chart<Visit, LineOptions<Visit>> = line('#sessions', options);
chart.update({ title: 'Sessions', legend: undefined });
chart.append([{ day: '2026-01-02', channel: 'Direct', sessions: 30211, share: '0.40' }], { keep: 120 });
chart.zoom(['2026-01-01', '2026-01-02']);
const off: () => void = chart.on('hover', (point: Point<Visit> | null) => { if (point) console.log(point.series, point.y); });
off();
const current: readonly Diagnostic[] = chart.diagnostics;
chart.destroy();

area(document.createElement('div'), { data: rows, x: 'day', y: 'sessions', series: 'channel', stacked: true });
bar('#bar', { data: rows, x: 'channel', y: { field: 'share', parse: 'number', scale: 'ratio' }, horizontal: true });
scatter('#scatter', { data: rows, x: { field: 'day', type: 'date' }, y: 'sessions' });
donut('#donut', { data: rows, label: 'channel', value: 'sessions' });
line('#columns', { data: { columns: { t: new Float64Array(3), v: new Float32Array(3) } }, x: { field: 't', type: 'time', timeZone: 'UTC' }, y: 'v' });
line('#tile', { data: rows, x: 'day', y: 'sessions', compact: true });
const found: Diagnostic[] = validate('line', options);
const levels: ('error' | 'warning' | 'hint')[] = found.map(d => d.level);

// @ts-expect-error misspelled field
line('#x', { data: rows, x: 'day', y: 'sesions' });
// @ts-expect-error a string-valued field on a value axis without parse
bar('#x', { data: rows, x: 'day', y: 'share' });
// @ts-expect-error wide y together with series
line('#x', { data: rows, x: 'day', y: ['sessions'], series: 'channel' });
// @ts-expect-error zoom does not exist on a donut
donut('#x', { data: rows, label: 'channel', value: 'sessions', zoom: true });
// @ts-expect-error compact does not exist on a scatter chart
scatter('#x', { data: rows, x: 'day', y: 'sessions', compact: true });
// @ts-expect-error validate('line', …) does not take an area-only option
validate('line', { data: rows, x: 'day', y: 'sessions', stacked: true });

export { current, levels };
