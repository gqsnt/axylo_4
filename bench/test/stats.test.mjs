// Pure tests: statistics and the admission comparison, with expected values worked out by hand from the definitions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balancedOrder, pairedBootstrap, classify, quantile, analyze, MIN_PAIRS } from '../src/stats.js';
import { lineFixture, streamFixture, expectedView, checksum } from '../src/fixtures.js';
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

test('non-ok runs are not paired', () => {
  const runs = [];
  for (let b = 0; b < 8; b++) {
    runs.push({ phase: 'timed', block: b, config: 'A', outcome: 'ok', summary: { taskMs: 1 } });
    runs.push({ phase: 'timed', block: b, config: 'B', outcome: b === 3 ? 'timeout' : 'ok', summary: b === 3 ? undefined : { taskMs: 2 } });
  }
  const res = analyze('first', runs);
  assert.equal(res.completePairs, 7);
  assert.equal(res.outcomes['B:timeout'], 1);
  assert.equal(res.metrics.taskMs.outcome, 'worse');
});

const exact = fix => {
  const e = expectedView(fix);
  return { x: [e.oldestX, e.newestX], y: [e.yMin, e.yMax], series: e.missing.map(m => ({ points: e.points, oldestX: e.oldestX, newestX: e.newestX, missing: m })) };
};

test('admission accepts a readback that matches the fixture', () => {
  for (const fix of [lineFixture({ series: 3, points: 120 }), lineFixture({ series: 1, points: 10000, gaps: true }), streamFixture({})]) {
    const r = checkView(expectedView(fix), exact(fix));
    assert.deepEqual(r, { admitted: true, reasons: [] });
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
  assert.equal(checkView(e, pinned).admitted, false);
  const clipped = { ...exact(fix), y: [e.yMin, fix.extreme.y - 1] };
  const rc = checkView(e, clipped);
  assert.equal(rc.admitted, false);
  assert.ok(rc.reasons.some(r => r.includes('injected extreme')));
  const fewer = exact(fix); fewer.series[1].points = 119;
  assert.equal(checkView(e, fewer).admitted, false);
  const filledGaps = exact(lineFixture({ series: 1, points: 1000, gaps: true })); filledGaps.series[0].missing = 0;
  assert.equal(checkView(expectedView(lineFixture({ series: 1, points: 1000, gaps: true })), filledGaps).admitted, false);
  const s = streamFixture({});
  const stale = exact(s); stale.series[0].newestX -= s.step;
  assert.equal(checkView(expectedView(s), stale).admitted, false);
  assert.equal(checkView(e, null).admitted, false);
});
