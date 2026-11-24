import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import fc from 'fast-check';
import { workloadParams, tagOf } from '../run.mjs';
import { expectedFor } from '../lib/driver.mjs';
import { checkView } from '../src/admission.js';
import {
  barFixture, donutFixture, histogramFixture, callerColumnBytes, fixtureChecksum, workloadData, expectedView, heldColumns, zoomSteps,
} from '../src/fixtures.js';
import { kinds } from '../src/multichart.js';
import { measureAll } from '../tools/size-compare.mjs';

const fixture = (kind, args = {}) => workloadData('first', { kind, ...args })[0];
const check = (fix, seen) => checkView(expectedView(fix), seen, { columns: heldColumns(fix), requireDrawn: true });

test('seeded fixtures retain every category, slice and observation and identify their extremes', () => {
  assert.deepEqual(barFixture().names, ['Direct', 'Organic', 'Referral']);
  assert.equal(barFixture().categories.at(-1), 'Cat 24');
  assert.equal(new Set(donutFixture().labels).size, 8);
  assert.equal(callerColumnBytes([barFixture(), donutFixture(), histogramFixture()]), (3 * 24 + 8 + 10000) * 8);
  fc.assert(fc.property(fc.integer(), fc.integer({ min: 2, max: 120 }), (seed, n) => {
    const b = barFixture({ categories: n, seed });
    assert.equal(b.categories[0], 'Cat 01');
    assert.equal(b.categories.length, n);
    assert.ok(b.ys.every(c => c instanceof Float64Array && c.length === n && c.every(v => v > 0)));
    assert.equal(b.extreme.category, b.categories[b.extreme.index]);
    assert.equal(b.ys[0][b.extreme.index], Math.max(...b.ys.flatMap(c => [...c])));
    const d = donutFixture({ slices: n, seed });
    assert.equal(d.labels.length, n);
    assert.ok(d.values instanceof Float64Array && d.values.every(v => v > 0));
    assert.equal(d.total, [...d.values].reduce((a, b) => a + b));
    assert.deepEqual(d.extreme, { index: d.extreme.index, label: d.labels[d.extreme.index], value: Math.max(...d.values) });
    const h = histogramFixture({ points: n, seed });
    assert.ok(h.values instanceof Float64Array && h.values.length === n);
    assert.equal(h.min, Math.min(...h.values));
    assert.equal(h.max, Math.max(...h.values));
    for (const kind of kinds.slice(1)) {
      const args = { size: '1x' + n, seed };
      const a = fixture(kind, args), copy = fixture(kind, args);
      assert.equal(fixtureChecksum(a), fixtureChecksum(copy));
      assert.equal(fixtureChecksum(a), expectedFor('first', { kind, ...args }).checksum);
    }
  }), { numRuns: 20, seed: 17 });
  const b = barFixture(), d = donutFixture(), h = histogramFixture();
  for (const [original, changed] of [[b, { ...b, categories: b.categories.toReversed() }], [d, { ...d, labels: d.labels.toReversed() }],
    [h, { ...h, bins: 12 }], [h, histogramFixture({ seed: 90 })], [fixture('area'), fixture('area', { size: '1x120' })],
    [fixture('scatter'), fixture('scatter', { clustered: true })]]) assert.notEqual(fixtureChecksum(original), fixtureChecksum(changed));
});

test('workload parameters, tags, dimensions and legacy fixture selection', () => {
  const legacy = {
    first: [{ size: '3x120', gaps: false }, '3x120'], page: [{ size: '3x120', gaps: false, charts: 24 }, '3x120-x24'],
    compact: [{ fixture: 'trend', charts: 40 }, 'trend-x40'], scatter: [{ size: '1x10000', clustered: false }, '1x10000'],
    hover: [{ size: '1x100000', gaps: false, moves: 200 }, '1x100000'], zoom: [{ size: '1x100000', gaps: false }, '1x100000'],
    stream: [{ window: 600, samples: 300 }, 'w600'], resize: [{ size: '1x100000', charts: 1 }, '1x100000'],
    lifecycle: [{ fixture: 'trend', cycles: 2500 }, 'trend-c2500'],
  };
  for (const [workload, [params, tag]] of Object.entries(legacy)) for (const a of [{}, { kind: 'line' }]) {
    assert.deepEqual(workloadParams(workload, a), params);
    assert.equal(tagOf(workload, params), tag);
  }
  const defaults = {
    first: ['trend', '3x24', '1x8', '1x10000', '1x10000'], page: ['trend', '3x12', '1x8', '1x2000', '1x500'],
    hover: ['1x100000', '3x24', '1x8', '1x10000', '1x10000'], resize: ['1x100000', '3x24', '1x8', '1x10000', '1x10000'],
    lifecycle: ['trend', '3x24', '1x8', '1x2000', '1x2000'],
  };
  for (const [workload, sizes] of Object.entries(defaults)) kinds.slice(1).forEach((kind, i) => {
    const p = workloadParams(workload, { kind });
    assert.equal(p.fixture ?? p.size, sizes[i]);
    assert.ok(tagOf(workload, p).includes(kind));
    assert.equal(workloadData(workload, p).length, workload === 'page' ? 24 : 1);
  });
  for (const kind of ['area', 'bar', 'histogram']) {
    const charts = workloadData('compact', workloadParams('compact', { kind }));
    assert.equal(charts.length, 40);
    assert.equal(charts[0].ys?.length ?? 1, 1);
  }
  assert.throws(() => workloadParams('first', { kind: 'pie' }));
  assert.throws(() => workloadParams('zoom', { kind: 'bar' }));
  assert.throws(() => workloadParams('first', { kind: 'histogram', bins: '101' }));
  assert.throws(() => workloadParams('first', { kind: 'donut', size: '3x16' }));
  const h = workloadParams('first', { kind: 'histogram', bins: '7', size: '1x100000' });
  assert.equal(h.bins, 7);
  assert.notEqual(tagOf('first', h), tagOf('first', { ...h, bins: 8 }));
  assert.equal(fixture('donut', { size: '1x16' }).labels.length, 16);
  for (const kind of ['area', 'scatter']) {
    const p = workloadParams('zoom', { kind });
    assert.deepEqual(expectedFor('zoom', p).views[0].visibleX, zoomSteps(workloadData('zoom', p)[0]).at(-1));
  }
});

test('rectangle admission checks each drawn value, category position and histogram bin', () => {
  const fix = barFixture({ series: 1, categories: 3 });
  const plot = { x: 0, y: 0, width: 30, height: 150 };
  const seen = { kind: 'bar', plot, y: [0, 1500], rectangles: [Array.from(fix.ys[0], (v, i) =>
    ({ x: 10 * i + 1, y: 150 - v / 10, width: 8, height: v / 10 }))] };
  assert.ok(check(fix, seen).admitted);
  assert.ok(!check(fix, { ...seen, rectangles: [[]] }).admitted);
  assert.ok(!check(fix, { ...seen, y: [0, 1499] }).admitted);
  seen.rectangles[0][fix.extreme.index].height--;
  assert.ok(!check(fix, seen).admitted);

  const hist = { kind: 'histogram', points: 6, bins: 2, min: 0, max: 4, values: Float64Array.of(0, 1, 2, 2, 3, 4) };
  assert.deepEqual(expectedView(hist).counts, [2, 4]);
  const read = { kind: 'histogram', plot: { ...plot, width: 40, height: 40 }, x: [0, 4], y: [0, 4],
    rectangles: [[{ x: 0, y: 20, width: 20, height: 20 }, { x: 20, y: 0, width: 20, height: 40 }]] };
  assert.ok(check(hist, read).admitted);
  assert.ok(!check(hist, { ...read, rectangles: [] }).admitted);
  assert.ok(!check(hist, { ...read, x: [0, 3] }).admitted);
  read.rectangles[0][1].height -= 10;
  assert.ok(!check(hist, read).admitted);
});

test('donut admission checks the sectors, hole, labels, count, sum and largest slice', () => {
  const fix = donutFixture();
  const slices = Array.from(fix.values, (value, i) => ({ cx: 50, cy: 50, startAngle: fix.values.slice(0, i).reduce((a, b) => a + b, 0) / fix.total * 2 * Math.PI, label: fix.labels[i], value, innerRadius: 30, outerRadius: 50,
    sweep: value / fix.total * 2 * Math.PI }));
  const admitted = xs => check(fix, { kind: 'donut', slices: xs, plot: { x: 0, y: 0, width: 100, height: 100 } }).admitted;
  assert.ok(admitted(slices));
  for (const bad of [[], slices.slice(1), slices.toReversed()]) assert.ok(!admitted(bad));
  for (const change of [{ cx: -50 }, { innerRadius: 0 }, { sweep: 0 }, { sweep: 4 }, { value: fix.extreme.value - 1 }]) {
    assert.ok(!admitted(slices.with(fix.extreme.index, { ...slices[fix.extreme.index], ...change })));
  }
});

test('sixteen donut inputs require either all sixteen sectors or the exact native Axylo grouping', () => {
  const fix = { ...donutFixture({ slices: 16 }), values: Float64Array.from({ length: 16 }, (_, i) => i + 1), total: 136,
    extreme: { index: 15, label: 'Slice 16', value: 16 } };
  const values = [10, 11, 12, 13, 14, 15, 16, 45];
  let before = 0;
  const slices = values.map((value, i) => {
    const startAngle = before / 136 * 2 * Math.PI;
    before += value;
    return { value, label: i === 7 ? 'Other (9)' : 'Slice ' + (10 + i), cx: 50, cy: 50,
      innerRadius: 30, outerRadius: 50, startAngle, sweep: value / 136 * 2 * Math.PI };
  });
  const seen = { kind: 'donut', slices, plot: { x: 0, y: 0, width: 100, height: 100 } };
  const verify = library => checkView(expectedView(fix), seen, { library, columns: heldColumns(fix), requireDrawn: true });
  assert.ok(verify('Axylo').admitted);
  assert.match(verify('Axylo').limits.join(), /seven individual sectors/);
  assert.ok(!verify('ECharts').admitted);
  slices.at(-1).value--;
  assert.ok(!verify('Axylo').admitted);
});

test('area admission requires a painted fill for each series and a zero baseline', () => {
  const fix = fixture('area', { size: '1x20' });
  const e = expectedView(fix);
  const seen = { kind: 'area', areaFills: 1, x: e.visibleX, y: [0, e.yMax],
    series: [{ points: 20, oldestX: e.oldestX, newestX: e.newestX, missing: 0, drawn: { kind: 'indices', paths: [[0, 19]] } }] };
  assert.ok(check(fix, seen).admitted);
  for (const bad of [{ areaFills: 0 }, { areaFills: undefined }, { series: [] }, { y: [e.yMin, e.yMax] }]) {
    assert.ok(!check(fix, { ...seen, ...bad }).admitted);
  }
});

test('all four loaded adapters expose the native chart-kind and compact matrix', async t => {
  globalThis.__VERSIONS__ = { axylo: 'spy' };
  globalThis.Axylo = Object.fromEntries(kinds.map(kind => [kind, () => ({})]));
  t.after(() => { delete globalThis.Axylo; delete globalThis.__VERSIONS__; });
  // Use the same CSS text loader as the browser adapter build. Nothing is written to disk.
  const { outputFiles } = await build({ entryPoints: [new URL('../src/adapters/uplot.js', import.meta.url).pathname],
    bundle: true, format: 'esm', write: false, loader: { '.css': 'text' } });
  const uplot = (await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'))).default;
  const adapters = [uplot];
  for (const id of ['axylo', 'echarts', 'chartjs-tuned']) adapters.push((await import(`../src/adapters/${id}.js`)).default);
  for (const adapter of adapters) for (const kind of kinds) {
    const supported = kind === 'line' || kind === 'area' || (adapter.id !== 'uplot' && (kind !== 'histogram' || adapter.id === 'axylo'));
    for (const w of ['first', 'hover', 'page', 'resize', 'lifecycle', 'compact']) {
      const expected = supported && (w !== 'compact' || (['echarts', 'axylo'].includes(adapter.id) && !['scatter', 'donut'].includes(kind)));
      const result = adapter.available(w, { kind });
      assert.equal(result.ok, expected, adapter.id + '/' + w + '/' + kind);
      if (!expected) assert.ok(result.reason);
    }
  }
  for (const kind of ['bar', 'donut', 'scatter']) assert.equal(uplot.available('first', { kind }).reason, `uPlot has no native ${kind} chart`);
});

test('per-chart consumer bundles build and report gzip-9 sizes for exactly the supported contenders', async () => {
  const rows = await measureAll({ perChart: true });
  assert.equal(new Set(rows.map(r => r.id)).size, 22);
  for (const [kind, count] of Object.entries({ area: 4, bar: 3, scatter: 3, donut: 3, histogram: 1 })) {
    const selected = rows.filter(row => row.id.endsWith('-' + kind));
    assert.equal(selected.length, count);
    for (const row of selected) {
      assert.ok(row.jsGzipBytes > 0 && row.minBytes >= row.jsGzipBytes);
      assert.equal(row.totalGzipBytes, row.jsGzipBytes + row.cssGzipBytes);
    }
  }
  assert.match(rows.find(row => row.id === 'axylo-histogram').notes, /no native histogram binning/);
});

// Native controllers and render notifications run in Node against a recording Canvas surface.
// This exercises the adapter-to-admission boundary without a browser or listening socket.
function surface(tag, recordings) {
  const children = [], attrs = new Map();
  const el = {
    nodeName: tag.toUpperCase(), style: {}, children, clientWidth: 800, clientHeight: 400, width: 800, height: 400,
    get firstChild() { return children[0]; },
    appendChild(child) { return this.insertBefore(child, null); },
    insertBefore(child, before) {
      children.splice(before ? children.indexOf(before) : children.length, 0, child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) { children.splice(children.indexOf(child), 1); },
    remove() { this.parentNode.removeChild(this); },
    getAttribute: k => attrs.get(k) ?? null, setAttribute: (k, v) => attrs.set(k, v),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }),
  };
  if (tag === 'canvas') {
    const fills = [];
    recordings.set(el, fills);
    let rect, arc, vertices;
    const ctx = {
      canvas: el, measureText: s => ({ width: String(s).length * 6 }),
      beginPath() { rect = arc = null; vertices = 0; },
      arc(x, y, r) { arc = { x, y, r }; },
      rect(x, y, width, height) { rect = { x, y, width, height }; },
      lineTo() { vertices++; },
      fill(path) { fills.push({ rect, arc, polygon: vertices >= 2, path }); },
      getLineDash: () => [],
    };
    for (const name of ['save', 'restore', 'setTransform', 'resetTransform', 'translate', 'scale', 'rotate',
      'moveTo', 'closePath', 'stroke', 'clip', 'setLineDash', 'clearRect', 'fillRect', 'strokeRect', 'bezierCurveTo',
      'quadraticCurveTo', 'fillText', 'strokeText']) ctx[name] = () => {};
    el.getContext = () => ctx;
  }
  return el;
}

test('ECharts and tuned Chart.js native marks pass admission before and after zoom', async t => {
  const recordings = new WeakMap();
  const capture = { fills: canvas => recordings.get(canvas) };
  globalThis.__VERSIONS__ = {};
  globalThis.document = { createElement: tag => surface(tag, recordings) };
  t.after(() => { delete globalThis.document; delete globalThis.__VERSIONS__; });
  for (const id of ['echarts', 'chartjs-tuned']) {
    const { default: adapter } = await import(`../src/adapters/${id}.js`);
    for (const kind of ['area', 'bar', 'donut', 'scatter']) {
      const fix = fixture(kind, kind === 'area' ? { size: '1x100000' } : {});
      const host = surface('div', recordings);
      const handle = adapter.create(host, fix, { capture, hover: true });
      try {
        await handle.ready;
        const geo = handle.hoverGeometry();
        assert.ok(geo.plot.width > 0 && geo.plot.height > 0);
        const verify = window => {
          const read = handle.describe({ capture, probe: 'geometry' });
          const result = checkView(expectedView(fix, window), read, { columns: heldColumns(fix), requireDrawn: true });
          assert.ok(result.admitted, id + '/' + kind + ': ' + result.reasons.join(', '));
        };
        verify();
        if (id === 'chartjs-tuned') {
          const chart = handle.chart;
          const active = [{ datasetIndex: 0, index: 2 }];
          chart.setActiveElements(active);
          chart.tooltip.setActiveElements(active, { x: 100, y: 100 });
          chart.draw();
          assert.equal(handle.hoveredIndex(), 2);
          assert.ok(handle.readoutShows(2));
          assert.ok(!handle.readoutShows(1));
          chart.tooltip.body[0].lines = ['stale value'];
          assert.ok(!handle.readoutShows(2));
        }
        if (['area', 'scatter'].includes(kind)) {
          const window = zoomSteps(fix).at(-1);
          handle.zoom(...window);
          await handle.ready;
          verify(window);
        }
      } finally {
        handle.destroy();
        assert.equal(host.children.length, 0);
      }
    }
  }
});

test('Axylo options produce the expected native chart and admitted rectangle geometry on the recording host', async t => {
  const repo = new URL('../../', import.meta.url).pathname;
  const { outputFiles } = await build({ stdin: { contents: "export {record} from './packages/axylo/test/core/host.ts'; export {pathData} from './packages/axylo/src/render/svg.ts'", resolveDir: repo },
    bundle: true, format: 'esm', write: false, define: { __DEV__: 'true', __BENCH__: 'true' } });
  const { record, pathData } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'));
  globalThis.__VERSIONS__ = {};
  let rec;
  globalThis.Axylo = Object.fromEntries(kinds.map(kind => [kind, (_, options) => {
    rec = record(kind, options, { container: options.compact ? { width: 160, height: 48 } : { width: 800, height: 400 } });
    rec.frames();
    return rec.controller.handle;
  }]));
  t.after(() => { delete globalThis.Axylo; delete globalThis.__VERSIONS__; });
  const { axyloAdapter, parsePolylines } = await import('../src/adapters/axylo-common.js');
  const adapter = axyloAdapter('axylo');
  for (const [kind, size, compact, bins] of [['bar', '3x24'], ['bar', '1x500'], ['bar', '1x12', true],
    ['histogram', '1x1000', true], ['histogram', '1x100000'], ['histogram', '1x100000', false, 3], ['donut', '1x8'], ['area', '1x100000'], ['scatter', '1x10000']]) {
    const fix = fixture(kind, { size, bins });
    const handle = adapter.create({}, fix, { compact });
    try {
      await handle.ready;
      assert.equal(rec.committed.view.kind, kind);
      const marks = rec.draws.at(-1).marks;
      if (kind === 'area') {
        const verify = window => {
          const d = handle.chart.__bench.describe();
          const marks = rec.draws.at(-1).marks;
          const seen = { kind, areaFills: marks.filter(m => m.type === 'area' && m.upper.length).length,
            x: d.xDomain, y: d.yDomain, series: d.series.map(s => ({ ...s, drawn: { kind: 'pixels' } })),
            drawnPixels: { plot: d.plot, strokes: marks.filter(m => m.type === 'path').map(m =>
              ({ polylines: parsePolylines(pathData(m.xy)) })) } };
          const result = checkView(expectedView(fix, window), seen, { columns: heldColumns(fix), requireDrawn: true });
          assert.ok(result.admitted, result.reasons.join(', '));
        };
        verify();
        const window = zoomSteps(fix).at(-1);
        handle.zoom(...window);
        rec.frames();
        verify(window);
      }
      if (kind === 'donut') assert.equal(rec.committed.view.total, fix.total);
      if (kind === 'scatter') assert.equal(marks.find(m => m.type === 'points').xy.length, fix.x.length * 2);
      if (kind === 'histogram' || kind === 'bar') {
        const d = handle.chart.__bench.describe();
        const round = x => Math.round(x * 100) / 100;
        const rectangles = marks.filter(m => m.type === 'rects').map(m =>
          Array.from({ length: m.xywh.length / 4 }, (_, i) => {
            const [x, y, width, height] = Array.from(m.xywh.subarray(4 * i, 4 * i + 4), round);
            return { x, y, width, height };
          }));
        const seen = { kind, plot: d.plot, rectangles, x: d.xDomain, y: d.yDomain };
        if (bins === 3) {
          const table = rec.committed.reader.table;
          seen.binCounts = Array.from({ length: table.rowCount }, (_, i) => Number(table.row(i)[1].replaceAll(',', '')));
        }
        const result = check(fix, seen);
        assert.ok(result.admitted, kind + '/' + size + ': ' + result.reasons.join(', '));
      }
    } finally { handle.destroy(); }
  }
});
