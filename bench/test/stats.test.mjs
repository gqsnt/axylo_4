// Pure tests: statistics and the admission comparison, with expected values worked out by hand from the definitions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balancedOrder, pairedBootstrap, classify, quantile, analyze, MIN_PAIRS } from '../src/stats.js';
import { lineFixture, streamFixture, expectedView, heldColumns, checksum } from '../src/fixtures.js';
import { checkView } from '../src/admission.js';

test('blocks are balanced: as many AB as BA, for any seed', () => {
  for (const seed of [1, 2, 3, 99, 123456]) {
    const o = balancedOrder(8, seed);
    assert.equal(o.filter(x => x === 'AB').length, 4);
    assert.equal(o.filter(x => x === 'BA').length, 4);
  }
  assert.throws(() => balancedOrder(5, 1));
  assert.throws(() => balancedOrder(0, 1));
});

test('quantile interpolates linearly between order statistics', () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([10], 0.95), 10);
  assert.equal(quantile([0, 10], 0.25), 2.5);
});

test('paired bootstrap: a constant shift gives a zero-width interval at that shift', () => {
  const a = [3, 9, 4, 7, 5, 6], b = a.map(v => v + 5);
  const ci = pairedBootstrap(a, b);
  assert.equal(ci.estimate, 5);
  assert.equal(ci.lo, 5);
  assert.equal(ci.hi, 5);
});

test('paired bootstrap: the interval contains the estimate and widens with noise', () => {
  const a = [10, 11, 9, 10, 12, 10, 11, 9], b = [12, 10, 13, 11, 12, 14, 9, 12];
  const ci = pairedBootstrap(a, b);
  assert.ok(ci.lo <= ci.estimate && ci.estimate <= ci.hi);
  assert.ok(ci.hi - ci.lo > 0);
  // The quieter control (review finding 18): the same medians with a quarter of the spread around them give a
  // narrower interval. Spread: every value pulled to its configuration's median by 3/4.
  const pull = (v, m) => m + (v - m) / 4;
  const ma = 10, mb = 12;
  const quiet = pairedBootstrap(a.map(v => pull(v, ma)), b.map(v => pull(v, mb)));
  assert.ok(quiet.hi - quiet.lo < ci.hi - ci.lo, `quiet width ${quiet.hi - quiet.lo} should be below noisy width ${ci.hi - ci.lo}`);
});

test('three outcomes, lower is better; a noise band must be cleared as well as zero', () => {
  assert.equal(classify({ lo: -3, hi: -1 }), 'better');
  assert.equal(classify({ lo: 1, hi: 3 }), 'worse');
  assert.equal(classify({ lo: -1, hi: 1 }), 'inconclusive');
  assert.equal(classify({ lo: -3, hi: -1 }, { lo: -2, hi: 2 }), 'inconclusive');
  assert.equal(classify({ lo: -5, hi: -3 }, { lo: -2, hi: 2 }), 'better');
  assert.equal(classify({ lo: NaN, hi: NaN }), 'inconclusive');
});

test('fewer complete pairs than the minimum never yields a verdict', () => {
  const runs = [];
  for (let b = 0; b < MIN_PAIRS - 1; b++) for (const [config, t] of [['A', 1], ['B', 100]])
    runs.push({ phase: 'timed', block: b, config, outcome: 'ok', summary: { taskMs: t + b * 0.01 } });
  const res = analyze('first', runs);
  assert.equal(res.metrics.taskMs.outcome, 'inconclusive');
  assert.match(res.metrics.taskMs.outcomeNote, /fewer than/);
});

// The block count is MIN_PAIRS + 1 so that, with one block lost, the verdict rule still allows a verdict (the rule
// went from 6 to the plan's 20 pairs; the assertions are unchanged).
test('non-ok runs are not paired', () => {
  const runs = [];
  const n = MIN_PAIRS + 1;
  for (let b = 0; b < n; b++) {
    runs.push({ phase: 'timed', block: b, position: b % 2, config: 'A', outcome: 'ok', summary: { taskMs: 1 } });
    runs.push({ phase: 'timed', block: b, position: 1 - (b % 2), config: 'B', outcome: b === 3 ? 'timeout' : 'ok', summary: b === 3 ? undefined : { taskMs: 2 } });
  }
  const res = analyze('first', runs);
  assert.equal(res.completePairs, n - 1);
  assert.equal(res.outcomes['B:timeout'], 1);
  assert.equal(res.metrics.taskMs.outcome, 'worse');
});

// A readback built from the fixture: what an honest chart that draws every point with breaks at missing values
// reports. (Built from expectedView, so it cannot catch a wrong expectedView; drawn.test.mjs has literal cases.)
const runsOf = col => { const p = []; let s = -1; for (let i = 0; i <= col.length; i++) { const ok = i < col.length && col[i] === col[i]; if (ok && s < 0) s = i; if (!ok && s >= 0) { p.push([s, i - 1]); s = -1; } } return p; };
const exact = fix => {
  const e = expectedView(fix);
  const { ys } = heldColumns(fix);
  return { x: [e.oldestX, e.newestX], y: [e.yMin, e.yMax], series: e.missing.map((m, i) => ({ points: e.points, oldestX: e.oldestX, newestX: e.newestX, missing: m, drawn: { kind: 'indices', paths: runsOf(ys[i]) } })) };
};
const cols = fix => ({ columns: heldColumns(fix) });

test('admission accepts a readback that matches the fixture', () => {
  for (const fix of [lineFixture({ series: 3, points: 120 }), lineFixture({ series: 1, points: 10000, gaps: true }), streamFixture({})]) {
    const r = checkView(expectedView(fix), exact(fix), cols(fix));
    assert.deepEqual(r, { admitted: true, reasons: [], limits: [] });
  }
});

test('gappy fixtures remove 5% of each series, never the extreme, first or last point', () => {
  const fix = lineFixture({ series: 3, points: 10000, gaps: true });
  for (const col of fix.ys) {
    let n = 0;
    for (const v of col) if (v !== v) n++;
    assert.equal(n, 500);
    assert.ok(col[0] === col[0] && col[col.length - 1] === col[col.length - 1]);
  }
  assert.ok(fix.ys[0][fix.extreme.index] === fix.extreme.y);
});

test('fixtures are deterministic', () => {
  assert.equal(checksum([lineFixture({ series: 1, points: 1000, seed: 4 })]), checksum([lineFixture({ series: 1, points: 1000, seed: 4 })]));
  assert.notEqual(checksum([lineFixture({ series: 1, points: 1000, seed: 4 })]), checksum([lineFixture({ series: 1, points: 1000, seed: 5 })]));
});

test('admission rejects a pinned y range, a clipped extreme, a wrong count and a stale window', () => {
  const fix = lineFixture({ series: 3, points: 120 });
  const e = expectedView(fix);
  const pinned = { ...exact(fix), y: [1e6, 2e6] };
  assert.equal(checkView(e, pinned, cols(fix)).admitted, false);
  const clipped = { ...exact(fix), y: [e.yMin, fix.extreme.y - 1] };
  const rc = checkView(e, clipped, cols(fix));
  assert.equal(rc.admitted, false);
  assert.ok(rc.reasons.some(r => r.includes('injected extreme')));
  const fewer = exact(fix); fewer.series[1].points = 119;
  assert.equal(checkView(e, fewer, cols(fix)).admitted, false);
  const g = lineFixture({ series: 1, points: 1000, gaps: true });
  const filledGaps = exact(g); filledGaps.series[0].missing = 0;
  assert.equal(checkView(expectedView(g), filledGaps, cols(g)).admitted, false);
  const s = streamFixture({});
  const stale = exact(s); stale.series[0].newestX -= s.step;
  assert.equal(checkView(expectedView(s), stale, cols(s)).admitted, false);
  assert.equal(checkView(e, null).admitted, false);
});

import { parseAdapterRef } from '../lib/refs.mjs';
test('adapter references carry parameters', () => {
  assert.deepEqual(parseAdapterRef('uplot'), { id: 'uplot', params: {} });
  assert.deepEqual(parseAdapterRef('axylo:renderer=svg,build=dev'), { id: 'axylo', params: { renderer: 'svg', build: 'dev' } });
  assert.deepEqual(parseAdapterRef('x:n=3,on=true'), { id: 'x', params: { n: 3, on: true } });
  assert.throws(() => parseAdapterRef('axylo:renderer'));
  assert.throws(() => parseAdapterRef('Bad Id'));
});
