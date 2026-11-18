// Axylo, default options, from the script-tag build packages/axylo/dist/axylo.iife.js (loaded by the page as a
// classic script before this module, so it is the file users would load).
//
// The chart is created from typed columns as the spec's Data type allows: x as epoch milliseconds declared
// `type: 'time'` in UTC, one wide y column per series. Every other option is Axylo's default.
//
// Readiness and readback come from Axylo's benchmark hook (plan 04, 3.1), present in development builds and,
// in production builds, when `globalThis.__AXYLO_BENCH__` is true (set in setup(), before the clock starts):
//   chart.__bench.ready()     resolves after the animation frame that drew the latest accepted revision
//   chart.__bench.describe()  the committed view and frame: { xDomain, yDomain, series: [{ points, oldestX,
//                             newestX, missing }] } (points = slots the series holds, missing = slots that are
//                             not a finite value)
// If the hook is absent the adapter reports "not admitted" rather than guessing readiness.
//
// Mark renderer: Axylo builds both a Canvas 2D and an SVG mark renderer for the M1 comparison. The page URL
// parameter `axyloRenderer=svg` selects SVG through Axylo's undocumented `__renderer` option; the default is canvas.

const NO_HOOK = 'this Axylo build has no benchmark hook (chart.__bench); use a development build or set __AXYLO_BENCH__';

const renderer = (() => {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('axyloRenderer') === 'svg' ? 'svg' : 'canvas';
  } catch {
    return 'canvas';
  }
})();

export default {
  id: 'axylo',
  library: 'Axylo',
  version: __VERSIONS__.axylo,
  config: renderer === 'svg' ? 'default, svg mark renderer' : 'default',
  available() {
    const A = globalThis.Axylo;
    if (!A) return { ok: false, reason: globalThis.__axyloLoadError ?? 'packages/axylo/dist/axylo.iife.js did not define the Axylo global' };
    if (typeof A.line !== 'function') return { ok: false, reason: 'packages/axylo/dist/axylo.iife.js does not export line() yet' };
    return { ok: true };
  },
  setup() {
    globalThis.__AXYLO_BENCH__ = true;
  },
  create(el, fix, opts = {}) {
    const columns = { t: fix.x };
    fix.names.forEach((n, i) => { columns[n] = fix.ys[i]; });
    const chart = globalThis.Axylo.line(el, {
      data: { columns }, x: { field: 't', type: 'time', timeZone: 'UTC' }, y: fix.names, title: 'Benchmark',
      ...(renderer === 'svg' ? { __renderer: 'svg' } : {}),
    });
    const hook = chart.__bench;
    let ready;
    if (hook) ready = hook.ready();
    else {
      ready = Promise.reject(Object.assign(new Error(NO_HOOK), { benchNotAdmitted: true }));
      ready.catch(() => {}); // the page reads the reason; avoid an unhandled-rejection report
    }
    let drawnNewest = NaN;
    // The newest x the chart had when it last drew: read in the frame after each append, from the hook.
    const record = () => {
      const s = hook?.describe().series[0];
      if (s) drawnNewest = s.newestX;
    };
    void Promise.resolve(ready).then(record, () => {});
    return {
      chart,
      ready,
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
