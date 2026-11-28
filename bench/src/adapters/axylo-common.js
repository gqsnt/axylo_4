// Axylo, default options, from a script-tag build loaded as a classic script (the file users would load).
//
// Adapter parameters (runner: --baseline axylo:renderer=svg,build=dev; or the fixed axylo-canvas / axylo-svg):
//   renderer  'canvas' | 'svg'             passed to Axylo as its internal `__renderer` option (which exists for the
//                                           renderer comparison only). The fixed adapters axylo-canvas and axylo-svg
//                                           pass it on older artifacts. SVG-only builds don't accept the switch.
//                                           The generic `axylo` adapter measures the public default, which is what
//                                           the budgets P1-P8 are about; the renderer it got is read back and recorded.
//   build     'prod' (default) | 'dev'     prod = axylo/axylo.iife.min.js (__DEV__ = false); dev = axylo.iife.js
//                                           (__DEV__ = true), used only to attribute profiles. Both are compiled by
//                                           bench/build.mjs into the session's sealed artifact.
//
// The chart is created from typed columns as the spec's Data type allows: x as epoch milliseconds declared
// `type: 'time'` in UTC, one wide y column per series. Every other option is Axylo's default (accessibility layer
// on, tooltip on), except `compact: true` in the compact workload (spec 3.7) and `scatter()` in the scatter workload.
//
// Readiness and readback come from Axylo's benchmark hook (plan 04, 3.1). The production build exposes it only when
// `globalThis.__AXYLO_BENCH__` is true when the chart is created; load() sets it before the script runs.
//   chart.__bench.ready()     resolves after the animation frame that drew the latest accepted revision
//   chart.__bench.describe()  the committed view and frame: { xDomain, yDomain, series: [{ points, oldestX,
//                             newestX, missing }] } (points = slots the series holds, missing = slots that are
//                             not a finite value)
// If the hook is absent the adapter reports "not admitted" rather than guessing readiness.
//
// What the adapter adds, read from the committed chart's DOM after the measured window:
//   renderer   which mark elements exist: .axylo-canvas canvases or svg.axylo-svg. The admission check compares it
//              with the renderer that was asked for.
//   drawn      Axylo exposes no readback of which source points it drew, so in the untimed 'geometry' probe run the
//              page records the strokes: for SVG the path data of the marks, for Canvas the moveTo/lineTo calls on
//              the scene canvas; the plot rectangle is the clip rectangle the renderer uses. Timed runs report
//              'not-captured'.
// Streaming uses chart.append(rows, { keep: window }), the spec's API for a moving window.

import { kindAvailability } from '../multichart.js';
import { groupedDonut, histogramCounts } from '../fixtures.js';

const NO_HOOK = 'this Axylo build has no benchmark hook (chart.__bench); use a development build or set __AXYLO_BENCH__';
// prod = the instrumented production build (shipped recipe with __BENCH__ true: the hook exists); release = the
// shipped bytes exactly (no hook: sanity runs only, see `sanity` below); dev = the development build.
const FILES = { prod: './axylo/axylo.bench.iife.min.js', release: './axylo/axylo.iife.min.js', dev: './axylo/axylo.iife.js' };
const BUILD_LABEL = { prod: 'instrumented production build (axylo.bench.iife.min.js)', release: 'RELEASE build, shipped bytes (axylo.iife.min.js), no hook', dev: 'DEVELOPMENT build (axylo.iife.js)' };

function loadScript(src) {
  return new Promise(res => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => res(null);
    s.onerror = () => res(`could not load ${src}`);
    document.head.appendChild(s);
  });
}

/**
 * Which mark renderer the committed chart in `el` uses: from the elements that exist, and from the library's own
 * report (`__bench.describe().renderer`) when given. If the two disagree the kind is 'inconsistent'.
 */
export function rendererIn(el, reported = null) {
  const canvases = el.querySelectorAll('.axylo-canvas canvas').length;
  const svgs = el.querySelectorAll('svg.axylo-svg').length;
  const dom = canvases && !svgs ? 'canvas' : svgs && !canvases ? 'svg' : canvases || svgs ? 'mixed' : 'none';
  const kind = reported == null ? dom : reported === dom ? dom : 'inconsistent';
  return { kind, canvases, svgs, ...(reported != null ? { reported, dom } : {}) };
}

/** Kept indexes and run starts (offsets into kept) -> index paths of contiguous ranges (admission kind 'indices'). */
export function keptPaths(kept, breaks) {
  const starts = [0, ...breaks, kept.length];
  const paths = [];
  for (let r = 0; r + 1 < starts.length; r++) {
    const path = [];
    let s = -1, e = -1;
    for (let k = starts[r]; k < starts[r + 1]; k++) {
      const i = kept[k];
      if (s >= 0 && i === e + 1) e = i;
      else if (s >= 0 && i === e) continue;
      else { if (s >= 0) path.push(s, e); s = e = i; }
    }
    if (s >= 0) path.push(s, e);
    if (path.length) paths.push(path);
  }
  return paths;
}

/** "M1 2L3 4L5 6M7 8L9 10" -> [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10]]; null when the data has other commands (arcs, curves, close). */
export function parsePolylines(d) {
  if (!d || /[^ML0-9.,\s+\-e]/.test(d)) return null;
  const out = [];
  let cur = null;
  const re = /([ML])\s*(-?[\d.]+(?:e[-+]?\d+)?)[\s,]+(-?[\d.]+(?:e[-+]?\d+)?)/g;
  let m;
  while ((m = re.exec(d))) {
    if (m[1] === 'M' || !cur) { cur = []; out.push(cur); }
    cur.push(Number(m[2]), Number(m[3]));
  }
  return out;
}

const vertexCount = polylines => polylines.reduce((s, p) => s + p.length / 2, 0);

const clipRectOf = (svg, node) => {
  const clip = /url\(["']?#([^"')]+)/.exec(node.getAttribute('clip-path') ?? '');
  const rect = clip && svg.querySelector(`[id="${clip[1]}"] rect`);
  return rect ? { x: +rect.getAttribute('x'), y: +rect.getAttribute('y'), width: +rect.getAttribute('width'), height: +rect.getAttribute('height') } : null;
};

/**
 * Scatter marker centres and the plot rectangle (probe runs): SVG circle paths, or Canvas arc() calls.
 * Sparse circles start with an absolute arc (`A`); dense circles use relative arcs (`a`). Both start at (x + r, y).
 */
export function circleCenters(d) {
  const out = [];
  const re = /M\s*(-?[\d.]+(?:e[-+]?\d+)?)[\s,]+(-?[\d.]+(?:e[-+]?\d+)?)\s*[Aa]\s*(-?[\d.]+)/g;
  let m;
  while ((m = re.exec(d))) out.push(Number(m[1]) - Number(m[3]), Number(m[2]));
  return out;
}
// The scene may cull a dense circle whose radius-three disk other drawn disks already paint over (scene/lines.ts).
// A reduced count is only admissible with proved geometry: every circle path is one real spelling with radius 3.
const NUM = '(-?\\d+(?:\\.\\d+)?)';
const SPARSE = new RegExp(`^M${NUM} ${NUM}A${NUM} ${NUM} 0 1 1 ${NUM} ${NUM}A${NUM} ${NUM} 0 1 1 ${NUM} ${NUM}Z?$`);
const DENSE = new RegExp(`^M${NUM} ${NUM}a${NUM} ${NUM} 0 11${NUM} 0a${NUM} ${NUM} 0 11${NUM} 0$`);
/** The circles' spelling (100: absolute hundredths, 10: relative tenths) when every circle has radius 3, else null. */
export function circleSpelling(d) {
  const circles = d.split(/(?=M)/).filter(Boolean);
  let spelling = null;
  for (const c of circles) {
    const dense = DENSE.exec(c.trim()), sparse = dense ? null : SPARSE.exec(c.trim());
    const m = dense ?? sparse;
    if (!m) return null;
    const v = m.slice(1).map(Number);
    if (!v.every(Number.isFinite)) return null;
    const ok = dense ? v[2] === 3 && v[3] === 3 && v[4] === -6 && v[5] === 3 && v[6] === 3 && v[7] === 6
      : v[2] === 3 && v[3] === 3 && v[6] === 3 && v[7] === 3 && Math.abs(v[4] - (v[0] - 6)) < 1e-9 && v[5] === v[1] && v[8] === v[0] && v[9] === v[1];
    const s = dense ? 10 : 100;
    if (!ok || (spelling !== null && spelling !== s)) return null;
    spelling = s;
  }
  return spelling;
}
function scatterPoints(el, capture) {
  const svg = el.querySelector('svg.axylo-svg');
  if (svg) {
    const centers = [];
    let plot = null, precision, proved = true;
    for (const p of svg.querySelectorAll('.axylo-scene path')) {
      const d = p.getAttribute('d') ?? '';
      if (!/[Aa]/.test(d)) continue;
      const spelling = circleSpelling(d);
      if (spelling === null || (precision !== undefined && precision !== spelling)) proved = false;
      precision ??= spelling;
      for (const coordinate of circleCenters(d)) centers.push(coordinate);
      plot ??= clipRectOf(svg, p);
    }
    return proved && precision ? { plot, centers, cover: { radius: 3, precision } } : { plot, centers };
  }
  // The Canvas capture cannot prove the arc radius it saw, so it keeps the exact count check.
  const scene = el.querySelector('.axylo-canvas canvas');
  if (!scene || !capture) return null;
  const c = capture.of(scene);
  return { plot: c.clip, centers: c.arcs };
}

/** The series strokes and plot rectangle, from the SVG marks (no capture needed: they are in the DOM). */
function svgStrokes(el) {
  const svg = el.querySelector('svg.axylo-svg');
  if (!svg) return null;
  const strokes = [];
  let plot = null;
  for (const p of svg.querySelectorAll('.axylo-scene path')) {
    const polylines = parsePolylines(p.getAttribute('d'));
    if (!polylines) continue;
    const cs = getComputedStyle(p);
    if (cs.stroke === 'none' || (cs.fill !== 'none' && cs.fill !== 'transparent')) continue;
    strokes.push({ color: cs.stroke, polylines });
    plot ??= clipRectOf(svg, p);
  }
  return { plot, strokes };
}

/** The same from the canvas capture (probe runs): strokes drawn on the scene canvas since its last full clear. */
function canvasStrokes(el, capture) {
  const scene = el.querySelector('.axylo-canvas canvas');
  if (!scene || !capture) return null;
  const { strokes, clip } = capture.of(scene);
  return { plot: clip, strokes: strokes.filter(s => !s.path2d && s.polylines.length) };
}

function svgRectangles(el) {
  const groups = el.querySelectorAll('svg.axylo-svg .axylo-scene > g');
  return Array.from(groups, group => Array.from(group.querySelectorAll('rect'))
    .filter(rect => !rect.style.fill && getComputedStyle(rect).fill !== 'none')
    .map(rect => ({ x: rect.x.baseVal.value, y: rect.y.baseVal.value,
      width: rect.width.baseVal.value, height: rect.height.baseVal.value }))).filter(group => group.length);
}

// A two-decimal SVG height can represent several integers on a tall count scale.
// The public table exposes exact counts (the options allow at most 100 bins, one page).
function tableCounts(el) {
  const toggle = el.querySelector('.axylo-control[aria-expanded="false"]');
  if (!toggle) return [];
  toggle.click();
  try {
    return Array.from(el.querySelectorAll('.axylo-table tbody tr'), row => {
      const text = row.querySelector('td')?.textContent?.trim() ?? '';
      return /^[\d,]+$/.test(text) ? Number(text.replaceAll(',', '')) : null;
    });
  } finally { toggle.click(); }
}

function donutSlices(el, plot) {
  const entries = el.querySelectorAll('.axylo-legend-list > li');
  return Array.from(el.querySelectorAll('svg.axylo-svg .axylo-scene > g > path'), (path, i) => {
    const d = path.getAttribute('d') ?? '';
    const start = /^M([-.\d]+) ([-.\d]+)/.exec(d);
    const arcs = [...d.matchAll(/A([.\d]+) [\d.]+ 0 ([01]) ([01]) ([-.\d]+) ([-.\d]+)/g)];
    const outer = arcs[0], inner = arcs.find(a => a[3] === '0');
    if (!start || !outer || !inner || getComputedStyle(path).fill === 'none') return null;
    const radius = Number(outer[1]);
    const cx = plot.x + plot.width / 2, cy = plot.y + plot.height / 2;
    if (Math.abs(Math.hypot(start[1] - cx, start[2] - cy) - radius) > 0.02
      || Math.abs(Math.hypot(outer[4] - cx, outer[5] - cy) - radius) > 0.02) return null;
    const startAngle = Math.atan2(start[2] - cy, start[1] - cx);
    const chord = Math.hypot(start[1] - outer[4], start[2] - outer[5]);
    const minor = 2 * Math.asin(Math.min(1, chord / (2 * radius)));
    const sweep = arcs.length === 4 ? 2 * Math.PI : outer[2] === '1' ? 2 * Math.PI - minor : minor;
    const entry = entries[i];
    const text = entry?.querySelector('.axylo-legend-value')?.textContent ?? '';
    return { label: entry?.querySelector('.axylo-legend-name')?.textContent, value: Number(text.split(' ')[0].replaceAll(',', '')),
      cx, cy, startAngle, sweep, outerRadius: radius, innerRadius: Number(inner[1]) };
  });
}

export function axyloAdapter(id, fixed = {}) {
  let hasCanvasMarks = true;
  const resolve = params => {
    const p = { build: 'prod', ...params, ...fixed };
    if (p.renderer !== undefined && !['canvas', 'svg'].includes(p.renderer)) throw new Error(`axylo: renderer must be canvas or svg, got ${p.renderer}`);
    if (!hasCanvasMarks && p.renderer === 'canvas') throw new Error('axylo: this artifact draws marks with SVG only');
    if (!FILES[p.build]) throw new Error(`axylo: build must be prod, release or dev, got ${p.build}`);
    return p;
  };
  let loadError = null;
  return {
    id,
    library: 'Axylo',
    version: __VERSIONS__.axylo,
    config: 'default',
    configFor: params => {
      const p = resolve(params);
      const renderer = !hasCanvasMarks ? 'SVG marks' : p.renderer
        ? `${p.renderer} mark renderer (__renderer: '${p.renderer}')` : 'the public default mark renderer (no __renderer)';
      return `default options, ${renderer}, ${BUILD_LABEL[p.build]}`;
    },
    bundleFor: params => FILES[resolve(params).build].slice(2),
    resolvedParams: resolve,
    expectRendererFor: params => resolve(params).renderer ?? (hasCanvasMarks ? null : 'svg'),
    async load(params) {
      // The selected adapter bytes stay identical across builds. Load capabilities before the timed window.
      const response = await fetch(new URL('../axylo/capabilities.json', import.meta.url));
      if (!response.ok) throw new Error('axylo: could not read the artifact capabilities');
      const { canvasMarks } = await response.json();
      if (typeof canvasMarks !== 'boolean') throw new Error('axylo: invalid artifact capabilities');
      hasCanvasMarks = canvasMarks;
      const p = resolve(params);
      globalThis.__AXYLO_BENCH__ = true;
      loadError = await loadScript(FILES[p.build]);
    },
    available(workload, params = {}) {
      const supported = kindAvailability('Axylo', workload, params);
      if (supported && !supported.ok) return supported;
      const kind = params.kind ?? (workload === 'scatter' ? 'scatter' : 'line');
      const A = globalThis.Axylo;
      if (!A) return { ok: false, reason: loadError ?? 'the Axylo script did not define the Axylo global' };
      if (typeof A[kind] !== 'function') return { ok: false, reason: `the Axylo build does not export ${kind}()` };
      return { ok: true };
    },
    create(el, fix, opts = {}) {
      const p = resolve(opts.params);
      const renderer = hasCanvasMarks && p.renderer ? { __renderer: p.renderer } : {};
      const A = globalThis.Axylo;
      let chart;
      const kind = fix.kind ?? opts.kind ?? 'line';
      const common = { title: fix.title ?? 'Benchmark', ...(opts.compact ? { compact: true } : {}), ...renderer };
      if (kind === 'donut') {
        chart = A.donut(el, { ...common, ...(opts.dashboard ? { legend: 'right' } : {}), data: { columns: { label: fix.labels, value: fix.values } }, label: 'label', value: 'value' });
      } else if (kind === 'histogram') {
        chart = A.histogram(el, { ...common, data: { columns: { latency: fix.values } }, x: 'latency', bins: fix.bins });
      } else if (kind === 'scatter') {
        chart = A.scatter(el, { data: { columns: { x: fix.x, y: fix.ys[0] } }, x: { field: 'x', type: 'number' }, y: 'y', title: fix.title ?? 'Benchmark', ...renderer });
      } else {
        const columns = kind === 'bar' ? { category: fix.categories } : { t: fix.x };
        fix.names.forEach((n, i) => { columns[n] = fix.ys[i]; });
        chart = A[kind](el, {
          ...common, data: { columns }, x: kind === 'bar' ? { field: 'category', type: 'category' } : { field: 't', type: 'time', timeZone: 'UTC' }, y: fix.names,
        });
      }
      const hook = chart.__bench;
      let ready;
      const sanity = p.build === 'release';
      if (!hook && sanity) {
        // The shipped bytes have no hook: readiness is two animation frames, a guess, so a release run is a sanity
        // run (does the shipped bundle draw a chart without errors), never a timing for an endpoint.
        ready = new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      } else if (!hook) {
        ready = Promise.reject(Object.assign(new Error(NO_HOOK), { benchNotAdmitted: true }));
        ready.catch(() => {}); // the page reads the reason; avoid an unhandled-rejection report
      }
      // The newest x the chart has drawn, for the streaming reader. Constant time: ready() called right after an
      // append resolves after the frame that drew that append's revision, so that sample's x is then drawn. No
      // describe() scan, inside or outside the measured window.
      let drawnNewest = NaN;
      const drew = x => () => { if (!(drawnNewest >= x)) drawnNewest = x; };
      if (opts.window) void Promise.resolve(hook ? hook.ready() : ready).then(drew(fix.x[fix.x.length - 1]), () => {});
      let hovered = NaN;
      let counts, ring;
      if (opts.hover) chart.on('hover', pt => {
        if (!pt) hovered = NaN;
        else if (kind === 'histogram') hovered = fix.max === fix.min ? 0 : Math.floor((pt.x - fix.min) / (fix.max - fix.min) * fix.bins);
        else if (kind === 'donut' && ring) hovered = ring.labels.indexOf(pt.x);
        else hovered = pt.index;
      });
      let fmt;
      return {
        chart,
        get ready() { return hook ? hook.ready() : ready; }, // re-evaluated: the page awaits it again after a resize or zoom
        append(x, ys) {
          const row = { t: x };
          fix.names.forEach((n, i) => { row[n] = ys[i] === ys[i] ? ys[i] : null; });
          chart.append([row], { keep: opts.window });
          hook?.ready().then(drew(x));
        },
        drawnNewestX: () => drawnNewest,
        zoom: (lo, hi) => chart.zoom([lo, hi]),
        hoverTarget: () => el.querySelector('.axylo-plot') ?? el,
        // Where data maps on screen, read before the timed window: the plot rectangle from the library's hook when it
        // reports one (`plot`, CSS px in the plot container), else the SVG renderer's clip rectangle; the canvas
        // renderer without the hook has none, and W-hover then reports "not available".
        hoverGeometry() {
          if (!hook) return null;
          const d = hook.describe();
          const container = el.querySelector('.axylo-plot');
          let rect = null, origin = null;
          if (d.plot && container) { rect = d.plot; origin = container.getBoundingClientRect(); }
          else {
            const svg = el.querySelector('svg.axylo-svg');
            const path = svg?.querySelector('.axylo-scene path[clip-path]');
            if (path) { rect = clipRectOf(svg, path); origin = svg.getBoundingClientRect(); }
          }
          if (!rect) return null;
          const plot = { left: origin.left + rect.x, top: origin.top + rect.y, width: rect.width, height: rect.height };
          if (kind === 'donut') {
            ring = groupedDonut(fix);
            let sum = 0;
            const radius = Math.min(plot.width, plot.height) * 0.4;
            const marks = Array.from(ring.values, value => {
              const angle = (sum + value / 2) / fix.total * 2 * Math.PI;
              sum += value;
              return [plot.left + plot.width / 2 + radius * Math.sin(angle), plot.top + plot.height / 2 - radius * Math.cos(angle)];
            });
            return { plot, marks };
          }
          if (kind === 'bar' || kind === 'histogram') {
            if (kind === 'histogram') counts = histogramCounts(fix);
            const marks = (svgRectangles(el)[0] ?? []).map(r =>
              [origin.left + r.x + r.width / 2, origin.top + r.y + (r.height || -2) / 2]);
            return { plot, marks };
          }
          if (!d.xDomain) return null;
          if (kind === 'scatter') return { plot, xDomain: d.xDomain, yDomain: d.yDomain };
          return { plot, xDomain: d.xDomain };
        },
        hoveredIndex: () => hovered,
        // The readout shows datum i when the visible tooltip (or the readout strip) has a value row reading exactly
        // the datum's y in the spec's readout format (F6, en-US). Exact text: "10.24" does not show 1.
        readoutShows(i) {
          fmt ??= new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });
          const value = kind === 'donut' ? (ring ?? fix).values[i] : kind === 'histogram' ? counts?.[i] : fix.ys[0][i];
          const want = fmt.format(value);
          for (const box of [el.querySelector('.axylo-tooltip'), el.querySelector('.axylo-readout')]) {
            if (!box || box.hidden) continue;
            for (const v of box.querySelectorAll('.axylo-tooltip-value')) {
              const text = v.textContent.trim();
              if (text === want || (kind === 'donut' && text.split(' (')[0] === want)) return true;
            }
          }
          return false;
        },
        // P7: bytes in buffers the library holds beyond the caller's columns, counted by the library. Needs
        // `__bench.memory()` (see README, "What the harness needs from the library"); absent, not available.
        memory: () => (typeof hook?.memory === 'function' ? (m => ({ bytes: m.bytes, buffers: m.buffers }))(hook.memory()) : { na: 'this Axylo build has no __bench.memory() owned-buffer count' }),
        themeColors(_el, { capture } = {}) {
          // Expected: the color the library assigns each series in the current scheme, through the custom property
          // it sets on the chart root (--axylo-series-color-N), resolved by the browser on a probe element.
          const root = el.querySelector('[data-axylo-scheme]') ?? el.firstElementChild ?? el;
          const expected = fix.names.map((_, i) => {
            const s = document.createElement('span');
            s.style.color = `var(--axylo-series-color-${i + 1})`;
            root.appendChild(s);
            const c = getComputedStyle(s).color;
            s.remove();
            return c;
          });
          const r = rendererIn(el).dom === 'svg' || rendererIn(el).kind === 'svg' ? svgStrokes(el) : canvasStrokes(el, capture);
          const marks = (r?.strokes ?? []).filter(s => vertexCount(s.polylines) >= 3).map(s => s.color);
          return { expected, marks };
        },
        describe({ capture, probe } = {}) {
          if (!hook && sanity) {
            const r = rendererIn(el);
            const marks = kind === 'donut' ? el.querySelectorAll('.axylo-scene > g > path[d*="A"]').length
              : kind === 'histogram' || kind === 'bar' ? svgRectangles(el).flat().filter(r => r.height > 0 && r.width > 0).length
              : kind === 'scatter' && fix.kind ? scatterPoints(el, capture)?.centers.length
              : r.kind === 'svg' ? (svgStrokes(el)?.strokes.length ?? 0) : (el.querySelector('.axylo-canvas canvas')?.width ?? 0);
            return { sanity: true, reads: 'release build: no hook; renderer elements and whether marks exist', renderer: r, hasMarks: marks > 0 };
          }
          if (!hook) return null;
          const d = hook.describe();
          const renderer = rendererIn(el, d.renderer ?? null);
          if (kind === 'donut') return { kind, renderer, plot: d.plot, slices: d.plot ? donutSlices(el, d.plot) : [] };
          if (kind === 'bar' || kind === 'histogram') {
            const seen = { kind, renderer, x: d.xDomain, y: d.yDomain, plot: d.plot, rectangles: svgRectangles(el) };
            if (kind === 'histogram' && d.plot && d.yDomain && (d.yDomain[1] - d.yDomain[0]) * 0.011 >= d.plot.height) {
              seen.binCounts = tableCounts(el);
            }
            return seen;
          }
          const dom = renderer.dom ?? renderer.kind;
          let drawnPixels = null, drawnPoints = null;
          if (probe === 'geometry') {
            if (kind === 'scatter') drawnPoints = scatterPoints(el, capture);
            else drawnPixels = dom === 'svg' ? svgStrokes(el) : canvasStrokes(el, capture);
          }
          // Per series: the library's kept indexes (with run starts when it reports them); a stream's kept indexes
          // are rows of the individual append calls, which this readback does not map, so they are not used there.
          const drawnOf = s => {
            if (kind === 'scatter') return { kind: 'points' };
            if (Array.isArray(s.kept) && (!opts.window || s.keptBasis === 'window')) return Array.isArray(s.breaks) ? { kind: 'indices', paths: keptPaths(s.kept, s.breaks), source: 'kept + breaks' } : { kind: 'kept', kept: s.kept };
            if (drawnPixels) return { kind: 'pixels' };
            return { kind: 'not-captured', reason: opts.window ? 'stream: kept indexes refer to append calls; strokes captured only in the probe run' : 'this Axylo build reports no kept indexes; strokes are captured only in the probe run' };
          };
          return {
            reads: 'Axylo chart.__bench.describe(): committed view xDomain/yDomain; per series slots held, first and last x, non-value slots, kept indexes (and run starts when reported); renderer reported by the library and read from the mark elements; strokes or markers in probe runs',
            renderer, ...(fix.kind ? { kind } : {}),
            ...(kind === 'area' ? { areaFills: [...el.querySelectorAll('.axylo-scene > path')].filter(p =>
              p.style.fillOpacity === '0.25' && p.getAttribute('d')?.includes('Z') && getComputedStyle(p).fill !== 'none').length } : {}),
            x: d.xDomain, y: d.yDomain,
            series: d.series.map(s => ({ points: s.points, oldestX: s.oldestX, newestX: s.newestX, missing: s.missing, drawn: drawnOf(s) })),
            ...(drawnPixels ? { drawnPixels } : {}),
            ...(drawnPoints ? { drawnPoints } : {}),
          };
        },
        destroy: () => chart.destroy(),
      };
    },
  };
}
