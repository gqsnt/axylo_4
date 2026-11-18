// Axylo, default options, from a script-tag build loaded as a classic script (the file users would load).
//
// Adapter parameters (runner: --baseline axylo:renderer=svg,build=dev; or the fixed axylo-canvas / axylo-svg):
//   renderer  'canvas' (default) | 'svg'   selects the mark renderer through Axylo's internal `__renderer` option,
//                                           which exists for the M1 renderer comparison only
//   build     'prod' (default) | 'dev'     prod = packages/axylo/dist/axylo.iife.min.js (__DEV__ = false);
//                                           dev = axylo.iife.js (__DEV__ = true), used only to attribute profiles
//
// The chart is created from typed columns as the spec's Data type allows: x as epoch milliseconds declared
// `type: 'time'` in UTC, one wide y column per series. Every other option is Axylo's default.
//
// Readiness and readback come from Axylo's benchmark hook (plan 04, 3.1). The production build exposes it only when
// `globalThis.__AXYLO_BENCH__` is true when the chart is created; load() sets it before the script runs.
//   chart.__bench.ready()     resolves after the animation frame that drew the latest accepted revision
//   chart.__bench.describe()  the committed view and frame: { xDomain, yDomain, series: [{ points, oldestX,
//                             newestX, missing }] } (points = slots the series holds, missing = slots that are
//                             not a finite value)
// If the hook is absent the adapter reports "not admitted" rather than guessing readiness.
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

export function axyloAdapter(id, fixed = {}) {
  let loadError = null;
  return {
    id,
    library: 'Axylo',
    version: __VERSIONS__.axylo,
    config: 'default',
    configFor: params => { const p = resolve(fixed, params); return `default options, ${p.renderer} mark renderer, ${p.build === 'prod' ? 'production build (axylo.iife.min.js)' : 'DEVELOPMENT build (axylo.iife.js)'}`; },
    resolvedParams: params => resolve(fixed, params),
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
      const columns = { t: fix.x };
      fix.names.forEach((n, i) => { columns[n] = fix.ys[i]; });
      const chart = globalThis.Axylo.line(el, {
        data: { columns }, x: { field: 't', type: 'time', timeZone: 'UTC' }, y: fix.names, title: 'Benchmark',
        ...(p.renderer === 'svg' ? { __renderer: 'svg' } : {}),
      });
      const hook = chart.__bench;
      let ready;
      if (hook) ready = hook.ready();
      else {
        ready = Promise.reject(Object.assign(new Error(NO_HOOK), { benchNotAdmitted: true }));
        ready.catch(() => {}); // the page reads the reason; avoid an unhandled-rejection report
      }
      let drawnNewest = NaN;
      // The newest x the chart had when it last drew. ready() resolves in the frame that drew, before the page's
      // visibility reader (registered after the append) runs in that frame.
      const record = () => {
        const s = hook?.describe().series[0];
        if (s) drawnNewest = s.newestX;
      };
      void Promise.resolve(ready).then(record, () => {});
      return {
        chart,
        ready: { then: (a, b) => (hook ? hook.ready() : ready).then(a, b) }, // re-evaluated: the page may await it again after a resize
        append(x, ys) {
          const row = { t: x };
          fix.names.forEach((n, i) => { row[n] = ys[i] === ys[i] ? ys[i] : null; });
          chart.append([row], { keep: opts.window });
          hook?.ready().then(record);
        },
        drawnNewestX: () => drawnNewest,
        describe() {
          if (!hook) return null;
          const d = hook.describe();
          return {
            reads: 'Axylo chart.__bench.describe(): committed view xDomain/yDomain; per series slots held, first and last x, non-value slots',
            x: d.xDomain, y: d.yDomain,
            series: d.series.map(s => ({ points: s.points, oldestX: s.oldestX, newestX: s.newestX, missing: s.missing })),
          };
        },
        destroy: () => chart.destroy(),
      };
    },
  };
}
