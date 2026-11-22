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

const NO_HOOK = 'this Axylo build has no benchmark hook (chart.__bench); use a development build or set __AXYLO_BENCH__';
// prod = the instrumented production build (shipped recipe with __BENCH__ true: the hook exists); release = the
// shipped bytes exactly (no hook: sanity runs only, see `sanity` below); dev = the development build.
const FILES = { prod: './axylo/axylo.bench.iife.min.js', release: './axylo/axylo.iife.min.js', dev: './axylo/axylo.iife.js' };
const BUILD_LABEL = { prod: 'instrumented production build (axylo.bench.iife.min.js)', release: 'RELEASE build, shipped bytes (axylo.iife.min.js), no hook', dev: 'DEVELOPMENT build (axylo.iife.js)' };

// Adapter unit tests also import this module without esbuild's defines to exercise the legacy path.
const hasCanvasMarks = typeof __AXYLO_CANVAS_MARKS__ === 'undefined' || __AXYLO_CANVAS_MARKS__;

const resolve = (fixed, params) => {
  const p = { build: 'prod', ...params, ...fixed };
  if (p.renderer !== undefined && !['canvas', 'svg'].includes(p.renderer)) throw new Error(`axylo: renderer must be canvas or svg, got ${p.renderer}`);
  if (!hasCanvasMarks && p.renderer === 'canvas') throw new Error('axylo: this artifact draws marks with SVG only');
  if (!FILES[p.build]) throw new Error(`axylo: build must be prod, release or dev, got ${p.build}`);
  return p;
};

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

/** Scatter marker centres and the plot rectangle (probe runs): SVG circle paths, or Canvas arc() calls. */
export function circleCenters(d) {
  const out = [];
  const re = /M\s*(-?[\d.]+(?:e[-+]?\d+)?)[\s,]+(-?[\d.]+(?:e[-+]?\d+)?)\s*A\s*(-?[\d.]+)/g;
  let m;
  while ((m = re.exec(d))) out.push(Number(m[1]) - Number(m[3]), Number(m[2]));
  return out;
}
function scatterPoints(el, capture) {
  const svg = el.querySelector('svg.axylo-svg');
  if (svg) {
    const centers = [];
    let plot = null;
    for (const p of svg.querySelectorAll('.axylo-scene path')) {
      const d = p.getAttribute('d') ?? '';
      if (!d.includes('A')) continue;
      centers.push(...circleCenters(d));
      plot ??= clipRectOf(svg, p);
    }
    return { plot, centers };
  }
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

export function axyloAdapter(id, fixed = {}) {
  let loadError = null;
  return {
    id,
    library: 'Axylo',
    version: __VERSIONS__.axylo,
    config: 'default',
    configFor: params => {
      const p = resolve(fixed, params);
      const renderer = !hasCanvasMarks ? 'SVG marks' : p.renderer
        ? `${p.renderer} mark renderer (__renderer: '${p.renderer}')` : 'the public default mark renderer (no __renderer)';
      return `default options, ${renderer}, ${BUILD_LABEL[p.build]}`;
    },
    bundleFor: params => FILES[resolve(fixed, params).build].slice(2),
    resolvedParams: params => resolve(fixed, params),
    expectRendererFor: params => resolve(fixed, params).renderer ?? (hasCanvasMarks ? null : 'svg'),
    async load(params) {
      const p = resolve(fixed, params);
      globalThis.__AXYLO_BENCH__ = true;
      loadError = await loadScript(FILES[p.build]);
    },
    available() {
      const A = globalThis.Axylo;
      if (!A) return { ok: false, reason: loadError ?? 'the Axylo script did not define the Axylo global' };
      if (typeof A.line !== 'function') return { ok: false, reason: 'the Axylo build does not export line()' };
      return { ok: true };
    },
    create(el, fix, opts = {}) {
      const p = resolve(fixed, opts.params);
      const renderer = hasCanvasMarks && p.renderer ? { __renderer: p.renderer } : {};
      const A = globalThis.Axylo;
      let chart;
      if (opts.kind === 'scatter') {
        chart = A.scatter(el, { data: { columns: { x: fix.x, y: fix.ys[0] } }, x: { field: 'x', type: 'number' }, y: 'y', title: fix.title ?? 'Benchmark', ...renderer });
      } else {
        const columns = { t: fix.x };
        fix.names.forEach((n, i) => { columns[n] = fix.ys[i]; });
        chart = A.line(el, {
          data: { columns }, x: { field: 't', type: 'time', timeZone: 'UTC' }, y: fix.names, title: fix.title ?? 'Benchmark',
          ...(opts.compact ? { compact: true } : {}),
          ...renderer,
        });
      }
      const hook = chart.__bench;
      let ready;
      const sanity = p.build === 'release';
      if (hook) ready = hook.ready();
      else if (sanity) {
        // The shipped bytes have no hook: readiness is two animation frames, a guess, so a release run is a sanity
        // run (does the shipped bundle draw a chart without errors), never a timing for an endpoint.
        ready = new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      } else {
        ready = Promise.reject(Object.assign(new Error(NO_HOOK), { benchNotAdmitted: true }));
        ready.catch(() => {}); // the page reads the reason; avoid an unhandled-rejection report
      }
      // The newest x the chart has drawn, for the streaming reader. Constant time: ready() called right after an
      // append resolves after the frame that drew that append's revision, so that sample's x is then drawn. No
      // describe() scan, inside or outside the measured window.
      let drawnNewest = NaN;
      const drew = x => () => { if (!(drawnNewest >= x)) drawnNewest = x; };
      if (opts.window) void Promise.resolve(ready).then(drew(fix.x[fix.x.length - 1]), () => {});
      let hovered = NaN;
      if (opts.hover) chart.on('hover', pt => { hovered = pt ? pt.index : NaN; });
      const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });
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
          if (!rect || !d.xDomain) return null;
          return { plot: { left: origin.left + rect.x, top: origin.top + rect.y, width: rect.width, height: rect.height }, xDomain: d.xDomain };
        },
        hoveredIndex: () => hovered,
        // The readout shows datum i when the visible tooltip (or the readout strip) has a value row reading exactly
        // the datum's y in the spec's readout format (F6, en-US). Exact text: "10.24" does not show 1.
        readoutShows(i) {
          const want = fmt.format(fix.ys[0][i]);
          for (const box of [el.querySelector('.axylo-tooltip'), el.querySelector('.axylo-readout')]) {
            if (!box || box.hidden) continue;
            for (const v of box.querySelectorAll('.axylo-tooltip-value')) if (v.textContent.trim() === want) return true;
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
            const marks = r.kind === 'svg' ? (svgStrokes(el)?.strokes.length ?? 0) : (el.querySelector('.axylo-canvas canvas')?.width ?? 0);
            return { sanity: true, reads: 'release build: no hook; renderer elements and whether marks exist', renderer: r, hasMarks: marks > 0 };
          }
          if (!hook) return null;
          const d = hook.describe();
          const renderer = rendererIn(el, d.renderer ?? null);
          const dom = renderer.dom ?? renderer.kind;
          let drawnPixels = null, drawnPoints = null;
          if (probe === 'geometry') {
            if (opts.kind === 'scatter') drawnPoints = scatterPoints(el, capture);
            else drawnPixels = dom === 'svg' ? svgStrokes(el) : canvasStrokes(el, capture);
          }
          // Per series: the library's kept indexes (with run starts when it reports them); a stream's kept indexes
          // are rows of the individual append calls, which this readback does not map, so they are not used there.
          const drawnOf = s => {
            if (opts.kind === 'scatter') return { kind: 'points' };
            if (Array.isArray(s.kept) && (!opts.window || s.keptBasis === 'window')) return Array.isArray(s.breaks) ? { kind: 'indices', paths: keptPaths(s.kept, s.breaks), source: 'kept + breaks' } : { kind: 'kept', kept: s.kept };
            if (drawnPixels) return { kind: 'pixels' };
            return { kind: 'not-captured', reason: opts.window ? 'stream: kept indexes refer to append calls; strokes captured only in the probe run' : 'this Axylo build reports no kept indexes; strokes are captured only in the probe run' };
          };
          return {
            reads: 'Axylo chart.__bench.describe(): committed view xDomain/yDomain; per series slots held, first and last x, non-value slots, kept indexes (and run starts when reported); renderer reported by the library and read from the mark elements; strokes or markers in probe runs',
            renderer,
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
