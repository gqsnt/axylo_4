// Deterministic workload data. Pure: runs in Node (the runner derives the expected readback from it) and in the
// page (the adapters receive it). Only integer and basic float arithmetic is used, so both produce identical bits;
// the runner compares a checksum of every column the page built with its own.

import { multiParams } from './multichart.js';

export const DAY = 86_400_000;
export const MINUTE = 60_000;
export const START = Date.UTC(2026, 0, 1);

export function rng(seed) {
  // mulberry32: small, fast, and identical in every engine
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "3x120" -> { series: 3, points: 120 } */
export function parseSize(size) {
  const m = /^(\d+)x(\d+)$/.exec(String(size));
  if (!m) throw new Error(`size must look like 3x120, got ${size}`);
  return { series: Number(m[1]), points: Number(m[2]) };
}

// Small charts get daily points like a dashboard trend; large ones a point per minute like a metrics feed.
const stepFor = points => (points <= 1000 ? DAY : MINUTE);

function walk(r, n, base) {
  const y = new Float64Array(n);
  let v = base;
  for (let i = 0; i < n; i++) {
    v += (r() - 0.5) * 2;
    y[i] = Math.round(v * 100) / 100;
  }
  return y;
}

function extent(col, from = 0, to = col.length) {
  let lo = Infinity, hi = -Infinity, missing = 0;
  for (let i = from; i < to; i++) {
    const v = col[i];
    if (v !== v) { missing++; continue; }
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { lo, hi, missing };
}

/**
 * The named `trend` fixture of the specification (P1, P5): 3 series × 120 daily points at UTC midnights, with real
 * series names and a 7-day outage in "Referral". Copied value for value from research/harness/src/data.js (the
 * Phase 1 harness), which the bench must not import across packages; the test suite pins its checksum and a few
 * values so a drift from the original is caught. Missing values are NaN in the typed columns.
 * It has no injected extreme: its own largest value (the maximum of "Direct") is the extreme the check reads back.
 */
export function trendFixture() {
  const r = rng(7), n = 120;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = START + i * DAY;
  const mk = (base, growth, noise, season) => {
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = Math.round(base + growth * i + season * Math.sin((i / 7) * 2 * Math.PI) + (r() - 0.5) * noise);
    return y;
  };
  const ys = [mk(31000, 120, 4000, 3000), mk(18000, 60, 3000, 2500), mk(4200, -8, 1200, 400)];
  for (let i = 60; i < 67; i++) ys[2][i] = NaN;
  let extremeIndex = 0;
  for (let i = 1; i < n; i++) if (ys[0][i] > ys[0][extremeIndex]) extremeIndex = i;
  return {
    // The fixture's own title (research/harness/src/data.js), passed as the chart title: budgets apply to default
    // options with the reader's title, not a harness label.
    name: 'trend', title: 'Daily sessions by channel', x, ys, names: ['Direct', 'Organic search', 'Referral'], step: DAY,
    extreme: { series: 0, index: extremeIndex, x: x[extremeIndex], y: ys[0][extremeIndex], injected: false },
  };
}

/** One series of `trend`, for the compact page (spec 3.7, AX131: one series per compact chart). */
export function trendSeries(i) {
  const t = trendFixture();
  const s = i % 3;
  const y = t.ys[s];
  let extremeIndex = 0;
  for (let k = 1; k < y.length; k++) if (y[k] > y[extremeIndex]) extremeIndex = k;
  return { name: `trend:${t.names[s]}`, title: t.names[s], x: t.x, ys: [y], names: [t.names[s]], step: DAY, extreme: { series: 0, index: extremeIndex, x: t.x[extremeIndex], y: y[extremeIndex], injected: false } };
}

/**
 * One line chart worth of typed columns.
 * x: Float64Array of epoch milliseconds, strictly increasing, regular step.
 * ys: one Float64Array per series; NaN marks a missing value.
 * One extreme value is injected into series 0 so a chart that clips or pins its y range is caught.
 * With gaps, 5% of each series is removed in runs (contiguous stretches), never at the first or last index or at the extreme.
 */
export function lineFixture({ series, points, gaps = false, seed = 1 }) {
  const r = rng(seed);
  const step = stepFor(points);
  const x = new Float64Array(points);
  for (let i = 0; i < points; i++) x[i] = START + i * step;
  const ys = [];
  for (let s = 0; s < series; s++) ys.push(walk(r, points, 100 + 40 * s));
  const extremeIndex = Math.floor(points * 0.37);
  {
    const { lo, hi } = extent(ys[0]);
    ys[0][extremeIndex] = Math.round((hi + (hi - lo) + 1) * 100) / 100;
  }
  if (gaps) {
    const target = Math.round(points * 0.05);
    const maxRun = Math.min(50, Math.max(2, Math.round(Math.sqrt(points) / 4)));
    for (let s = 0; s < series; s++) {
      const col = ys[s];
      let removed = 0, guard = 0;
      while (removed < target && guard++ < points * 10) {
        const len = Math.min(target - removed, 1 + Math.floor(r() * maxRun));
        const at = 1 + Math.floor(r() * (points - len - 2));
        let ok = true;
        for (let i = at - 1; i <= at + len; i++) if (col[i] !== col[i] || (s === 0 && i === extremeIndex)) { ok = false; break; }
        if (!ok) continue; // keep runs separate so the count of runs is what was drawn
        for (let i = at; i < at + len; i++) col[i] = NaN;
        removed += len;
      }
    }
  }
  return { x, ys, names: ys.map((_, s) => `s${s}`), step, extreme: { series: 0, index: extremeIndex, x: x[extremeIndex], y: ys[0][extremeIndex], injected: true } };
}

/**
 * Scatter (W-types, renderer decision): one series of `points` (x, y) pairs, x strictly increasing so the input
 * order is the x order. Uniform: x with random spacing, y uniform. Clustered: points drawn around five centres in
 * both x and y (a two-dimensional cluster, the hard case for a grid index), then ordered by x; ties in x are moved
 * up by one unit so x stays strictly increasing. One extreme is injected as in lineFixture.
 */
export function scatterFixture({ points, clustered = false, seed = 3 }) {
  const r = rng(seed);
  let x = new Float64Array(points), y = new Float64Array(points);
  const centres = [[0.15, 0.2], [0.35, 0.8], [0.5, 0.45], [0.7, 0.7], [0.9, 0.3]];
  if (clustered) {
    const span = points * 5; // the same x range as the uniform variant
    const bell = () => r() + r() + r() - 1.5;
    for (let i = 0; i < points; i++) {
      const c = centres[Math.floor(r() * centres.length)];
      x[i] = Math.round(c[0] * span + bell() * span * 0.03);
      y[i] = Math.round((c[1] * 1000 + bell() * 60) * 100) / 100;
    }
    const order = Array.from({ length: points }, (_, i) => i).sort((a, b) => x[a] - x[b] || a - b);
    const sx = new Float64Array(points), sy = new Float64Array(points);
    order.forEach((from, to) => { sx[to] = x[from]; sy[to] = y[from]; });
    for (let i = 1; i < points; i++) if (sx[i] <= sx[i - 1]) sx[i] = sx[i - 1] + 1;
    x = sx; y = sy;
  } else {
    let t = 0;
    for (let i = 0; i < points; i++) {
      t += 1 + Math.floor(r() * 9);
      x[i] = t;
      y[i] = Math.round(r() * 100000) / 100;
    }
  }
  const extremeIndex = Math.floor(points * 0.37);
  const { lo, hi } = extent(y);
  y[extremeIndex] = Math.round((hi + (hi - lo) + 1) * 100) / 100;
  return { scatter: true, clustered, x, ys: [y], names: ['points'], step: null, extreme: { series: 0, index: extremeIndex, x: x[extremeIndex], y: y[extremeIndex], injected: true } };
}

const numbered = (prefix, i) => prefix + ' ' + String(i + 1).padStart(2, '0');

export function barFixture({ series = 3, categories = 24, seed = 11 } = {}) {
  const random = rng(seed);
  const labels = Array.from({ length: categories }, (_, i) => numbered('Cat', i));
  const ys = Array.from({ length: series }, () => Float64Array.from(labels, () => 100 + Math.floor(random() * 900)));
  const index = Math.floor(categories * 0.37);
  ys[0][index] = 1500;
  return { kind: 'bar', title: 'Revenue by category', categories: labels, ys,
    names: ys.map((_, s) => ['Direct', 'Organic', 'Referral'][s] ?? `s${s}`),
    extreme: { series: 0, index, category: labels[index], y: ys[0][index] } };
}

export function donutFixture({ slices = 8, seed = 13 } = {}) {
  const random = rng(seed);
  const labels = slices === 8 ? ['Direct', 'Organic', 'Referral', 'Email', 'Paid search', 'Social', 'Partners', 'Events']
    : Array.from({ length: slices }, (_, i) => numbered('Slice', i));
  const values = Float64Array.from(labels, () => 50 + Math.floor(random() * 200));
  const index = values.reduce((best, value, i) => value > values[best] ? i : best, 0);
  return { kind: 'donut', title: 'Share by channel', labels, values, total: values.reduce((a, b) => a + b, 0),
    extreme: { index, label: labels[index], value: values[index] } };
}

// Spec F8: retain the seven largest in input order, resolving ties by their original position.
export function groupedDonut({ labels, values }) {
  if (values.length <= 8) return { labels, values };
  const indices = Array.from(values.keys());
  const selected = new Set(indices.toSorted((a, b) => values[b] - values[a] || a - b).slice(0, 7));
  const kept = indices.filter(i => selected.has(i));
  const other = values.reduce((sum, value, i) => selected.has(i) ? sum : sum + value, 0);
  return { labels: [...kept.map(i => labels[i]), `Other (${values.length - 7})`],
    values: [...kept.map(i => values[i]), other] };
}

export function histogramFixture({ points = 10000, bins = 24, seed = 17 } = {}) {
  const random = rng(seed);
  const values = Float64Array.from({ length: points }, () =>
    Math.round(10 + (random() < 0.7 ? 0 : 55) + 25 * (random() + random() + random())));
  const { lo: min, hi: max } = extent(values);
  return { kind: 'histogram', title: 'Response latency distribution', values, points, bins, min, max };
}

// Counts use half-open intervals, with the maximum included in the final bin.
export function histogramCounts(fix) {
  if (fix.min === fix.max) return [fix.points];
  const counts = Array(fix.bins).fill(0);
  const edges = Array.from({ length: fix.bins + 1 }, (_, i) => fix.min + (fix.max - fix.min) * (i / fix.bins));
  for (const v of fix.values) {
    const at = lowerBound(edges, v);
    counts[Math.min(counts.length - 1, edges[at] === v ? at : at - 1)]++;
  }
  return counts;
}

function multiData(workload, params) {
  const p = multiParams(workload, params);
  const size = p.size && parseSize(p.size);
  return Array.from({ length: p.charts ?? 1 }, (_, i) => {
    const seed = (params.seed ?? { area: 1, bar: 11, donut: 13, histogram: 17, scatter: 3 }[p.kind]) + i;
    switch (p.kind) {
      case 'area': return { ...(p.fixture ? (workload === 'compact' ? trendSeries(i) : trendFixture())
        : lineFixture({ ...size, seed, gaps: p.gaps })), kind: 'area' };
      case 'bar': return barFixture({ series: size.series, categories: size.points, seed });
      case 'donut': return donutFixture({ slices: size.points, seed });
      case 'histogram': return histogramFixture({ points: size.points, bins: p.bins, seed });
      case 'scatter': return { ...scatterFixture({ points: size.points, clustered: p.clustered, seed }), kind: 'scatter' };
    }
  });
}

/**
 * Streaming: an initial window, then `samples` appended points, one series.
 * The extreme is injected into a streamed sample that stays inside the final window.
 */
export function streamFixture({ window = 600, samples = 300, seed = 2 }) {
  const total = window + samples;
  const r = rng(seed);
  const x = new Float64Array(total);
  for (let i = 0; i < total; i++) x[i] = START + i * MINUTE;
  const y = walk(r, total, 100);
  const extremeIndex = window + Math.floor(samples * 2 / 3);
  {
    const { lo, hi } = extent(y);
    y[extremeIndex] = Math.round((hi + (hi - lo) + 1) * 100) / 100;
  }
  return {
    window, samples, step: MINUTE, names: ['s0'],
    initial: { x: x.subarray(0, window), ys: [y.subarray(0, window)] },
    stream: { x: x.subarray(window), y: y.subarray(window) },
    all: { x, ys: [y] },
    extreme: { series: 0, index: extremeIndex, x: x[extremeIndex], y: y[extremeIndex], injected: true },
  };
}

/**
 * W-zoom: the windows passed to chart.zoom(), in order. 20 steps in (each 0.85 of the last, centred on the injected
 * extreme), 20 steps out, then 20 pan steps at a tenth of the range that end centred on the extreme, so the final
 * view is known and contains the extreme. Pure, so the runner knows the final window.
 */
export function zoomSteps(fix, { zoomIn = 20, zoomOut = 20, pan = 20 } = {}) {
  const x0 = fix.x[0], x1 = fix.x[fix.x.length - 1], span = x1 - x0, c = fix.extreme.x;
  const clampWin = (lo, hi) => { const w = hi - lo; if (lo < x0) return [x0, x0 + w]; if (hi > x1) return [x1 - w, x1]; return [lo, hi]; };
  const out = [];
  let w = span;
  for (let i = 0; i < zoomIn; i++) { w *= 0.85; out.push(clampWin(Math.round(c - w / 2), Math.round(c + w / 2))); }
  for (let i = 0; i < zoomOut; i++) { w = Math.min(span, w / 0.85); out.push(clampWin(Math.round(c - w / 2), Math.round(c + w / 2))); }
  const pw = Math.round(span / 10), start = x0 + Math.round(span * 0.05);
  for (let i = 1; i <= pan; i++) {
    const centre = start + (c - start) * (i / pan);
    out.push(clampWin(Math.round(centre - pw / 2), Math.round(centre - pw / 2) + pw));
  }
  return out;
}

/** The data a workload feeds to the chart(s), as a list of fixtures (one per chart). */
export function workloadData(workload, params) {
  if (params.kind && params.kind !== 'line') return multiData(workload, params);
  const line = p => (p.fixture === 'trend' ? trendFixture() : lineFixture({ ...parseSize(p.size), gaps: !!p.gaps, seed: p.seed ?? 1 }));
  if (workload === 'first' || workload === 'hover' || workload === 'zoom' || workload === 'mem') return [line({ size: '3x120', ...params })];
  if (workload === 'page') {
    const count = params.charts ?? 24;
    if (params.fixture === 'trend') return Array.from({ length: count }, () => trendFixture());
    const { series, points } = parseSize(params.size ?? '3x120');
    return Array.from({ length: count }, (_, i) => lineFixture({ series, points, gaps: !!params.gaps, seed: (params.seed ?? 1) * 1000 + i }));
  }
  if (workload === 'compact') return Array.from({ length: params.charts ?? 40 }, (_, i) => trendSeries(i));
  if (workload === 'lifecycle') return [trendFixture()];
  if (workload === 'scatter') return [scatterFixture({ points: parseSize(params.size ?? '1x10000').points, clustered: !!params.clustered, seed: params.seed ?? 3 })];
  if (workload === 'stream') return [streamFixture({ window: params.window ?? 600, samples: params.samples ?? 300, seed: params.seed ?? 2 })];
  if (workload === 'theme') return [params.fixture === 'trend' ? trendFixture() : lineFixture({ ...parseSize(params.size ?? '3x120'), seed: params.seed ?? 1 })];
  if (workload === 'resize') {
    const { series, points } = parseSize(params.size ?? '1x100000');
    const count = params.charts ?? 1;
    return Array.from({ length: count }, (_, i) => lineFixture({ series, points, seed: count === 1 ? (params.seed ?? 1) : (params.seed ?? 1) * 1000 + i }));
  }
  throw new Error(`unknown workload ${workload}`);
}

/** The columns a correct chart holds at the end of the workload: the final window for a stream, else the input. */
export function heldColumns(fix) {
  if (fix.categories) return { categories: fix.categories, ys: fix.ys };
  if (fix.values) return { values: fix.values, labels: fix.labels };
  if (fix.initial) {
    const from = fix.all.x.length - fix.window;
    return { x: fix.all.x.subarray(from), ys: fix.all.ys.map(c => c.subarray(from)) };
  }
  return { x: fix.x, ys: fix.ys };
}

/** First index i with x[i] >= v (x sorted ascending). */
export function lowerBound(x, v) {
  let lo = 0, hi = x.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (x[mid] < v) lo = mid + 1; else hi = mid; }
  return lo;
}

/**
 * What a correct chart must show, derived from the fixture alone. `visible` (optional) is the x window the
 * workload ends on (W-zoom); otherwise the whole held data is visible.
 *   visibleX     the x range the chart must show
 *   window       [first, last] index of the held columns inside visibleX
 *   yMin, yMax   the data's y extent inside that window, every series
 *   seriesY      the same per series ([min, max]), for the drawn-extreme check
 */
export function expectedView(fix, visible = null) {
  if (fix.kind === 'bar') return { kind: 'bar', series: fix.ys.length, points: fix.categories.length, extreme: fix.extreme };
  if (fix.kind === 'donut') return { kind: 'donut', points: fix.values.length, total: fix.total, extreme: fix.extreme };
  if (fix.kind === 'histogram') return { kind: 'histogram', points: fix.points, counts: histogramCounts(fix), min: fix.min, max: fix.max };
  const { x, ys } = heldColumns(fix);
  const visibleX = visible ? [visible[0], visible[1]] : [x[0], x[x.length - 1]];
  const i0 = visible ? lowerBound(x, visible[0]) : 0;
  const i1 = visible ? lowerBound(x, visible[1] + 1) - 1 : x.length - 1;
  let lo = Infinity, hi = -Infinity;
  const missing = [], seriesY = [];
  for (const col of ys) {
    const all = extent(col);
    missing.push(all.missing);
    const e = extent(col, i0, i1 + 1);
    seriesY.push([e.lo, e.hi]);
    lo = Math.min(lo, e.lo); hi = Math.max(hi, e.hi);
  }
  return {
    ...(fix.kind ? { kind: fix.kind } : {}),
    series: ys.length, points: x.length, oldestX: x[0], newestX: x[x.length - 1],
    visibleX, window: [i0, i1], yMin: lo, yMax: hi, seriesY, missing, extreme: fix.extreme, scatter: !!fix.scatter,
    // A scatter's x is a number axis, which a library may round out to nice tick values (0 to 60,000 for data
    // from 5 to 50,000): up to a quarter of the range per side; a time axis gets the default 10%.
    ...(fix.scatter ? { xSlack: 0.25 } : {}),
    // A zoomed view must be exactly the window passed to zoom() (to the millisecond), not a padded one.
    ...(visible ? { xSlack: 0 } : {}),
  };
}

function numericColumns(fix) {
  if (fix.values) return [fix.values];
  if (fix.categories) return fix.ys;
  const { x, ys } = fix.all ?? fix;
  return [x, ...ys];
}

// Typed input storage only. Category labels are JS strings, with no portable heap byte count.
export function callerColumnBytes(fixtures) {
  return fixtures.reduce((total, fix) => numericColumns(fix).reduce((sum, col) => sum + col.byteLength, total), 0);
}

/** FNV-1a over the bytes of every column, so the runner can confirm the page built the same data it expects. */
export function checksum(fixtures) {
  let h = 0x811c9dc5;
  const feed = arr => {
    const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  };
  for (const f of fixtures) {
    if (f.kind) {
      const text = JSON.stringify([f.kind, f.categories ?? f.labels ?? null, f.names ?? null, f.bins ?? null]);
      feed(new TextEncoder().encode(text));
    }
    for (const c of numericColumns(f)) feed(c);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const fixtureChecksum = fix => checksum(Array.isArray(fix) ? fix : [fix]);
