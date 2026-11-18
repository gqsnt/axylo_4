// Pure tests: admission checks what was drawn, not only what is held (review finding 4), with literal readbacks
// whose expected values are written out by hand (finding 18), and renderer identity (finding 9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkView, checkDrawnIndices, checkDrawnPixels } from '../src/admission.js';
import { expectedView, DAY, START } from '../src/fixtures.js';
import { uplotDrawnPaths, chartjsDrawnPaths, themeMismatch } from '../src/drawn.js';

// Six daily points with one missing value; the maximum (9) is at index 4.
const X = Float64Array.from([0, 1, 2, 3, 4, 5], i => START + i * DAY);
const Y = Float64Array.from([1, 5, NaN, 2, 9, 3]);
const fix = { x: X, ys: [Y], names: ['s0'], step: DAY, extreme: { series: 0, index: 4, x: X[4], y: 9, injected: true } };
// Written out by hand, not computed by expectedView.
const EXPECTED = { series: 1, points: 6, oldestX: X[0], newestX: X[5], visibleX: [X[0], X[5]], window: [0, 5], yMin: 1, yMax: 9, seriesY: [[1, 9]], missing: [1], extreme: fix.extreme, scatter: false };
const columns = { x: X, ys: [Y] };
const readback = (drawn, extra = {}) => ({ x: [X[0], X[5]], y: [0, 10], series: [{ points: 6, oldestX: X[0], newestX: X[5], missing: 1, drawn, ...extra }] });

test('expectedView of the literal fixture is the hand-written expectation', () => {
  assert.deepEqual(expectedView(fix), EXPECTED);
});

test('an honest index readback (break at the missing value) is admitted', () => {
  const r = checkView(EXPECTED, readback({ kind: 'indices', paths: [[0, 1], [3, 5]] }), { columns });
  assert.deepEqual(r, { admitted: true, reasons: [], limits: [] });
});

test('retained neighbours that span a missing source value are rejected (the reviewer\'s decimation case)', () => {
  // Index 1 joined to index 3 by one segment: a line across the gap at index 2.
  const r = checkView(EXPECTED, readback({ kind: 'indices', paths: [[0, 1, 3, 5]] }), { columns });
  assert.equal(r.admitted, false);
  assert.match(r.reasons.join('|'), /1 drawn segments join retained neighbours across missing source values \(1->3 across 1 missing\)/);
});

test('a drawing that lost the extreme is rejected even though the held data and visible range are right', () => {
  // Index 4 (the 9) not drawn: drawn extremes are [1, 5].
  const r = checkView(EXPECTED, readback({ kind: 'indices', paths: [[0, 1], [3, 3], [5, 5]] }), { columns });
  assert.equal(r.admitted, false);
  assert.match(r.reasons.join('|'), /drawn extremes \[1, 5\] are not the data's extremes \[1, 9\]/);
});

test('a range drawn through a missing value, and a drawing that does not cover the window, are rejected', () => {
  const r = checkView(EXPECTED, readback({ kind: 'indices', paths: [[0, 4]] }), { columns });
  assert.match(r.reasons.join('|'), /1 drawn points sit at missing source values/);
  assert.match(r.reasons.join('|'), /do not cover the visible data \[0, 5\]/);
});

test('missing-value and drawn readbacks are required', () => {
  // The reviewer's synthetic readback: right extents, counts and timestamps, no `missing`, nothing drawn.
  const bare = { x: [X[0], X[5]], y: [0, 10], series: [{ points: 6, oldestX: X[0], newestX: X[5] }] };
  const r = checkView(EXPECTED, bare, { columns });
  assert.equal(r.admitted, false);
  assert.match(r.reasons.join('|'), /no missing-value readback/);
  assert.match(r.reasons.join('|'), /no drawn readback/);
  // A pixel adapter in a timed run reports "not-captured": allowed there, recorded as a limit; not in a probe run.
  const nc = readback({ kind: 'not-captured', reason: 'test' });
  assert.equal(checkView(EXPECTED, nc, { columns, requireDrawn: false }).admitted, true);
  assert.equal(checkView(EXPECTED, nc, { columns, requireDrawn: false }).limits.length, 1);
  assert.equal(checkView(EXPECTED, nc, { columns, requireDrawn: true }).admitted, false);
});

test('renderer identity: the committed chart must use the renderer the adapter asked for', () => {
  const ok = readback({ kind: 'indices', paths: [[0, 1], [3, 5]] });
  const svg = { ...ok, renderer: { kind: 'svg', canvases: 0, svgs: 1 } };
  assert.equal(checkView(EXPECTED, svg, { columns, expectRenderer: 'svg' }).admitted, true);
  const r = checkView(EXPECTED, svg, { columns, expectRenderer: 'canvas' });
  assert.equal(r.admitted, false);
  assert.match(r.reasons[0], /renderer: the committed chart has svg marks \(0 canvas, 1 svg\), the adapter was asked for canvas/);
  assert.match(checkView(EXPECTED, ok, { columns, expectRenderer: 'canvas' }).reasons[0], /no renderer readback/);
});

// Pixel readback: plot 100 x 100 px at (0, 0); x domain [0, 10], y domain [0, 10] -> px = 10 x, py = 100 - 10 y.
// Data: y = 0, 1, 2, -, -, -, 6, 10, 8, 9, 5 at x = 0..10. The gap 3..5 has finite neighbours 2 and 6: 20..60 px.
const PX = Float64Array.from({ length: 11 }, (_, i) => i);
const PY = Float64Array.from([0, 1, 2, NaN, NaN, NaN, 6, 10, 8, 9, 5]);
const P_CTX = { window: [0, 10], seriesY: [0, 10] };
const verts = idx => idx.flatMap(i => [10 * i, 100 - 10 * PY[i]]);
const plot = { x: 0, y: 0, width: 100, height: 100 };

test('pixel readback: an honest polyline with a pen-up across the gap passes', () => {
  const pixels = { plot, strokes: [{ color: '#000', polylines: [verts([0, 1, 2]), verts([6, 7, 8, 9, 10])] }] };
  assert.deepEqual(checkDrawnPixels(PX, PY, pixels, [0, 10], [0, 10], P_CTX, 's'), []);
});

test('pixel readback: one segment across a resolvable gap is rejected', () => {
  const pixels = { plot, strokes: [{ color: '#000', polylines: [verts([0, 1, 2, 6, 7, 8, 9, 10])] }] };
  assert.match(checkDrawnPixels(PX, PY, pixels, [0, 10], [0, 10], P_CTX, 's').join('|'), /1 of 1 resolvable gaps are crossed by one drawn segment \(indices 2\.\.6, 40\.0 px\)/);
});

test('pixel readback: a clipped extreme is rejected; a stroke that misses the data is not taken for the series', () => {
  const lost = { plot, strokes: [{ color: '#000', polylines: [verts([0, 1, 2]), verts([6, 8, 9, 10])] }] };
  assert.match(checkDrawnPixels(PX, PY, lost, [0, 10], [0, 10], P_CTX, 's').join('|'), /highest drawn vertex at y=10\.0 px, the data's maximum 10 maps to 0\.0 px/);
  const elsewhere = { plot, strokes: [{ color: '#000', polylines: [[0, 50, 100, 50]] }] };
  assert.match(checkDrawnPixels(PX, PY, elsewhere, [0, 10], [0, 10], P_CTX, 's')[0], /no drawn stroke passes through the first visible point/);
  assert.match(checkDrawnPixels(PX, PY, { plot: null, strokes: [] }, [0, 10], [0, 10], P_CTX, 's')[0], /drew no line strokes/);
});

test('index paths of uPlot data: runs of non-null inside the drawn window; spanGaps joins them', () => {
  const col = [1, null, 2, 3, null, null, 4];
  assert.deepEqual(uplotDrawnPaths(col, [0, 6], false), [[0, 0], [2, 3], [6, 6]]);
  assert.deepEqual(uplotDrawnPaths(col, [0, 6], true), [[0, 0, 2, 3, 6, 6]]);
  assert.deepEqual(uplotDrawnPaths(col, [2, 4], false), [[2, 3]]);
});

test('index paths of Chart.js drawn points: decimated points map back by x, NaN breaks, repeats are one point', () => {
  const held = [0, 1, 2, 3, 4, 5, 6, 7].map(x => ({ x, y: x === 4 ? NaN : x }));
  const heldX = held.map(p => p.x);
  // A min-max decimation keeping 0, 0 (first = min), 2, 3, NaN at 4, 6, 7: two paths.
  const drawn = [held[0], held[0], held[2], held[3], held[4], held[6], held[7]];
  assert.deepEqual(chartjsDrawnPaths(drawn, heldX, false), [[0, 0, 2, 3], [6, 7]]);
  // Without the NaN point the decimated copy joins 3 to 6 across the missing 4: one path.
  const bridged = [held[0], held[2], held[3], held[6], held[7]];
  const paths = chartjsDrawnPaths(bridged, heldX, false);
  assert.deepEqual(paths, [[0, 0, 2, 3, 6, 7]]);
  const col = Float64Array.from(held, p => p.y);
  const reasons = checkDrawnIndices(col, { paths }, { window: [0, 7], seriesY: [0, 7] }, 's');
  assert.match(reasons.join('|'), /join retained neighbours across missing source values \(3->6 across 1 missing\)/);
});

test('theme check: one stale mark fails it', () => {
  assert.equal(themeMismatch({ expected: ['#111111', '#222222'], marks: ['#111111', '#222222'] }), null);
  assert.equal(themeMismatch({ expected: ['#111111', '#222222'], marks: ['#111111', '#999999'] }), 'series 1 #999999, expected #222222');
  assert.match(themeMismatch({ expected: ['#111111', '#222222'], marks: ['#111111'] }), /1 series marks for 2 series/);
});
