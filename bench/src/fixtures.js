// Deterministic workload data. Pure: runs in Node (the runner derives the expected readback from it) and in the
// page (the adapters receive it). Only integer and basic float arithmetic is used, so both produce identical bits.

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

function extent(col) {
  let lo = Infinity, hi = -Infinity, missing = 0;
  for (let i = 0; i < col.length; i++) {
    const v = col[i];
    if (v !== v) { missing++; continue; }
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { lo, hi, missing };
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
  return { x, ys, names: ys.map((_, s) => `s${s}`), step, extreme: { series: 0, index: extremeIndex, x: x[extremeIndex], y: ys[0][extremeIndex] } };
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
    extreme: { series: 0, index: extremeIndex, x: x[extremeIndex], y: y[extremeIndex] },
  };
}

/** The data a workload feeds to the chart(s), as a list of line fixtures (one per chart). */
export function workloadData(workload, params) {
  if (workload === 'first') return [lineFixture({ ...parseSize(params.size), gaps: !!params.gaps, seed: params.seed ?? 1 })];
  if (workload === 'page') {
    const { series, points } = parseSize(params.size ?? '3x120');
    const count = params.charts ?? 24;
    return Array.from({ length: count }, (_, i) => lineFixture({ series, points, gaps: !!params.gaps, seed: (params.seed ?? 1) * 1000 + i }));
  }
  if (workload === 'stream') return [streamFixture({ window: params.window ?? 600, samples: params.samples ?? 300, seed: params.seed ?? 2 })];
  if (workload === 'theme') return [lineFixture({ ...parseSize(params.size ?? '3x120'), seed: params.seed ?? 1 })];
  if (workload === 'resize') {
    const { series, points } = parseSize(params.size ?? '1x100000');
    const count = params.charts ?? 1;
    return Array.from({ length: count }, (_, i) => lineFixture({ series, points, seed: count === 1 ? (params.seed ?? 1) : (params.seed ?? 1) * 1000 + i }));
  }
  throw new Error(`unknown workload ${workload}`);
}

/** What a correct chart must show, derived from the fixture alone. */
export function expectedView(fix) {
  if (fix.initial) {
    // stream: the final window after every sample has been appended
    const { x, ys } = fix.all;
    const from = x.length - fix.window;
    const finalY = ys[0].subarray(from);
    const { lo, hi, missing } = extent(finalY);
    return { series: 1, points: fix.window, oldestX: x[from], newestX: x[x.length - 1], yMin: lo, yMax: hi, missing: [missing], extreme: fix.extreme };
  }
  let lo = Infinity, hi = -Infinity;
  const missing = [];
  for (const col of fix.ys) { const e = extent(col); lo = Math.min(lo, e.lo); hi = Math.max(hi, e.hi); missing.push(e.missing); }
  return { series: fix.ys.length, points: fix.x.length, oldestX: fix.x[0], newestX: fix.x[fix.x.length - 1], yMin: lo, yMax: hi, missing, extreme: fix.extreme };
}

/** FNV-1a over the bytes of every column, so the runner can confirm the page built the same data it expects. */
export function checksum(fixtures) {
  let h = 0x811c9dc5;
  const feed = arr => {
    const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  };
  for (const f of fixtures) {
    const cols = f.all ? [f.all.x, ...f.all.ys] : [f.x, ...f.ys];
    for (const c of cols) feed(c);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
