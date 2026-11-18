// Every example in docs/03-plan-typescript-release.md, type-checked against axylo.d.ts.
import { line, bar, area, donut, scatter, validate, type Chart, type LineOptions } from './axylo';

// --- the first chart: long rows
interface Session { day: string; channel: string; sessions: number | null }
declare const rows: Session[];
const chart = line('#sessions', { title: 'Daily sessions by channel', data: rows, x: 'day', y: 'sessions', series: 'channel' });
chart.update({ title: 'Sessions' });
chart.append([{ day: '2026-05-01', channel: 'Direct', sessions: 41210 }], { keep: 120 });
chart.zoom(['2026-03-01', '2026-03-31']);
const off = chart.on('hover', p => p?.y);
off();
chart.destroy();

// --- field objects
interface Sample { ts: number; sessions: number }
declare const samples: Sample[];
line('#a', { data: samples, x: { field: 'ts', type: 'time', timeZone: 'UTC' }, y: { field: 'sessions', label: 'Sessions', tickFormat: { notation: 'compact' } } });

// --- wide rows: one column per series
interface Wide { day: string; direct: number; organic: number; referral: number }
declare const wide: Wide[];
line('#b', { data: wide, x: 'day', y: ['direct', 'organic', { field: 'referral', label: 'Referral' }] });

// --- typed columns for large data; the row type is inferred from the columns
const big = line('#c', { data: { columns: { t: new Float64Array(1e6), v: new Float32Array(1e6) } }, x: { field: 't', type: 'time' }, y: 'v' });
big.append([{ t: Date.now(), v: 3 }]);

// --- numeric strings from a database driver need an explicit parse
interface PgRow { day: string; count: string }
declare const pg: PgRow[];
bar('#d', { data: pg, x: 'day', y: { field: 'count', parse: 'number', missing: 'zero' } });

// --- the other chart types
area('#e', { data: rows, x: 'day', y: 'sessions', series: 'channel', stacked: true });
bar('#f', { data: wide, x: 'day', y: ['direct', 'organic'], layout: 'stacked', horizontal: true, reference: [{ y: 30000, label: 'Target' }] });
interface Share { browser: string; share: number }
declare const shares: Share[];
donut('#g', { data: shares, label: 'browser', value: { field: 'share', scale: 'percent' }, title: { text: 'Sessions by browser', level: 3 } });
interface Pt { latency: number; size: number; region: string }
declare const pts: Pt[];
scatter('#h', { data: pts, x: 'size', y: 'latency', series: 'region', labelledBy: 'card-heading' });

// --- compact variant for a KPI tile
line('#kpi', { data: samples, x: { field: 'ts', type: 'time' }, y: 'sessions', compact: true, labelledBy: 'kpi-heading' });

// --- validation without a DOM
const problems = validate('line', { data: rows, x: 'day', y: 'sessions', series: 'channel' });
problems.map(d => `${d.code} ${d.chart}: ${d.message}`);

// --- a handle type an application can store
declare const stored: Chart<Session, LineOptions<Session>>;
stored.diagnostics.length;

// ===== mistakes that must not compile =====
// @ts-expect-error misspelled field
line('#x', { data: rows, x: 'day', y: 'sesions' });
// @ts-expect-error a string-valued field on a value axis without parse
bar('#x', { data: pg, x: 'day', y: 'count' });
// @ts-expect-error wide y together with series
line('#x', { data: wide, x: 'day', y: ['direct', 'organic'], series: 'day' });
// @ts-expect-error zoom does not exist on a donut
donut('#x', { data: shares, label: 'browser', value: 'share', zoom: true });
// @ts-expect-error a column that does not exist
line('#x', { data: { columns: { t: new Float64Array(4), v: new Float32Array(4) } }, x: 't', y: 'value' });
// @ts-expect-error appended rows must match the row type
chart.append([{ day: '2026-05-01', channel: 'Direct', sessions: '41210' }]);
// @ts-expect-error compact does not exist on a scatter chart
scatter('#x', { data: pts, x: 'size', y: 'latency', compact: true });
// @ts-expect-error a category field cannot be the donut value
donut('#x', { data: shares, label: 'browser', value: 'browser' });
