// Axylo, default options, from a script-tag build loaded as a classic script (the file users would load).
//
// Adapter parameters (runner: --baseline axylo:renderer=svg,build=dev; or the fixed axylo-canvas / axylo-svg):
//   renderer  'canvas' (default) | 'svg'   always passed to Axylo as its internal `__renderer` option (which exists
//                                           for the M1 renderer comparison only). Both values are passed explicitly:
//                                           the library's own default has changed before (it is SVG now), and an
//                                           adapter that relies on it would measure the default twice.
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
const FILES = { prod: './axylo/axylo.iife.min.js', dev: './axylo/axylo.iife.js' };

const resolve = (fixed, params) => {
  const p = { renderer: 'canvas', build: 'prod', ...params, ...fixed };
  if (!['canvas', 'svg'].includes(p.renderer)) throw new Error(`axylo: renderer must be canvas or svg, got ${p.renderer}`);
  if (!FILES[p.build]) throw new Error(`axylo: build must be prod or dev, got ${p.build}`);
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

/** Which mark renderer the committed chart in `el` uses, from the elements that exist. */
export function rendererIn(el) {
  const canvases = el.querySelectorAll('.axylo-canvas canvas').length;
  const svgs = el.querySelectorAll('svg.axylo-svg').length;
  const kind = canvases && !svgs ? 'canvas' : svgs && !canvases ? 'svg' : canvases || svgs ? 'mixed' : 'none';
  return { kind, canvases, svgs };
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
    const clip = /url\(["']?#([^"')]+)/.exec(p.getAttribute('clip-path') ?? '');
    const rect = clip && svg.querySelector(`[id="${clip[1]}"] rect`);
    if (rect && !plot) plot = { x: +rect.getAttribute('x'), y: +rect.getAttribute('y'), width: +rect.getAttribute('width'), height: +rect.getAttribute('height') };
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
    configFor: params => { const p = resolve(fixed, params); return `default options, ${p.renderer} mark renderer (__renderer: '${p.renderer}'), ${p.build === 'prod' ? 'production build (axylo.iife.min.js)' : 'DEVELOPMENT build (axylo.iife.js)'}`; },
    resolvedParams: params => resolve(fixed, params),
    expectRendererFor: params => resolve(fixed, params).renderer,
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
      const A = globalThis.Axylo;
      let chart;
      if (opts.kind === 'scatter') {
        chart = A.scatter(el, { data: { columns: { x: fix.x, y: fix.ys[0] } }, x: { field: 'x', type: 'number' }, y: 'y', title: 'Benchmark', __renderer: p.renderer });
      } else {
        const columns = { t: fix.x };
        fix.names.forEach((n, i) => { columns[n] = fix.ys[i]; });
        chart = A.line(el, {
          data: { columns }, x: { field: 't', type: 'time', timeZone: 'UTC' }, y: fix.names, title: 'Benchmark',
          ...(opts.compact ? { compact: true } : {}),
          __renderer: p.renderer,
        });
      }
      const hook = chart.__bench;
      let ready;
      if (hook) ready = hook.ready();
      else {
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
        hoveredIndex: () => hovered,
        // The readout shows datum i when the visible tooltip (or the fixed readout under the plot) has a value row
        // reading the datum's y in the spec's readout format (F6, en-US).
        readoutShows(i) {
          const box = [el.querySelector('.axylo-tooltip'), el.querySelector('.axylo-readout')].find(b => b && !b.hidden);
          if (!box) return false;
          const want = fmt.format(fix.ys[0][i]);
          for (const v of box.querySelectorAll('.axylo-tooltip-value')) if (v.textContent.startsWith(want)) return true;
          return false;
        },
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
          const r = rendererIn(el).kind === 'svg' ? svgStrokes(el) : canvasStrokes(el, capture);
          const marks = (r?.strokes ?? []).filter(s => vertexCount(s.polylines) >= 3).map(s => s.color);
          return { expected, marks };
        },
        describe({ capture, probe } = {}) {
          if (!hook) return null;
          const d = hook.describe();
          const renderer = rendererIn(el);
          let drawnPixels = null, drawn;
          if (opts.kind === 'scatter') drawn = { kind: 'not-applicable', reason: 'scatter point marks are not captured; the held readback and the visible ranges are checked' };
          else if (probe === 'geometry') {
            drawnPixels = renderer.kind === 'svg' ? svgStrokes(el) : canvasStrokes(el, capture);
            drawn = drawnPixels ? { kind: 'pixels' } : { kind: 'not-captured', reason: `no ${renderer.kind} strokes found` };
          } else drawn = { kind: 'not-captured', reason: 'Axylo has no drawn-index readback; its strokes are captured only in the untimed probe run' };
          return {
            reads: 'Axylo chart.__bench.describe(): committed view xDomain/yDomain; per series slots held, first and last x, non-value slots; renderer from the mark elements; strokes in probe runs',
            renderer,
            x: d.xDomain, y: d.yDomain,
            series: d.series.map(s => ({ points: s.points, oldestX: s.oldestX, newestX: s.newestX, missing: s.missing, drawn })),
            ...(drawnPixels ? { drawnPixels } : {}),
          };
        },
        destroy: () => chart.destroy(),
      };
    },
  };
}
