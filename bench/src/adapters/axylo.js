// Axylo, default options, from the script-tag build packages/axylo/dist/axylo.iife.js (loaded by the page as a
// classic script before this module, so it is the file users would load).
//
// Until the library exports line(), available() says so and the runner records "not available".
// Once line() exists, the chart is created from typed columns as the spec's Data type allows, but this adapter
// cannot yet be admitted: the readiness signal and the readback for the admission check depend on the benchmark
// hook the plan names (04-plan-performance.md 3.1, "Axylo exposes a revision counter for this in benchmark builds"),
// which is not defined in the contracts yet. Rather than guess at it (two animation frames, a DOM probe), the
// adapter reports "not admitted" with that reason. Wire ready, drawnNewestX and describe to the hook when it lands.

const NO_HOOK = 'Axylo exports line() but no benchmark readiness/readback hook is defined yet (plan 3.1); adapter needs that hook to be admitted';

export default {
  id: 'axylo',
  library: 'Axylo',
  version: __VERSIONS__.axylo,
  config: 'default',
  available() {
    const A = globalThis.Axylo;
    if (!A) return { ok: false, reason: globalThis.__axyloLoadError ?? 'packages/axylo/dist/axylo.iife.js did not define the Axylo global' };
    if (typeof A.line !== 'function') return { ok: false, reason: 'packages/axylo/dist/axylo.iife.js does not export line() yet' };
    return { ok: true };
  },
  create(el, fix, opts = {}) {
    const columns = { t: fix.x };
    fix.names.forEach((n, i) => { columns[n] = fix.ys[i]; });
    const chart = globalThis.Axylo.line(el, { data: { columns }, x: { field: 't', type: 'time', timeZone: 'UTC' }, y: fix.names, title: 'Benchmark' });
    const unsupported = Object.assign(new Error(NO_HOOK), { benchNotAdmitted: true });
    const ready = Promise.reject(unsupported);
    ready.catch(() => {}); // the page reads the reason; avoid an unhandled-rejection report
    return {
      chart,
      ready,
      append(x, ys) {
        const row = { t: x };
        fix.names.forEach((n, i) => { row[n] = ys[i] === ys[i] ? ys[i] : null; });
        chart.append([row], { keep: opts.window });
      },
      drawnNewestX: () => NaN,
      describe: () => null,
      destroy: () => chart.destroy(),
    };
  },
};
