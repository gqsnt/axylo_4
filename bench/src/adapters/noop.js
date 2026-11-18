// Measurement floor: takes the same inputs and calls as a real adapter and draws nothing.
// Whatever a run of this adapter costs is the harness, the page and the browser, not a chart.

export default {
  id: 'noop',
  library: 'none',
  version: 'n/a',
  config: 'floor',
  floor: true,
  available: () => ({ ok: true }),
  create(el, fix) {
    let newest = fix.x[fix.x.length - 1];
    return {
      ready: Promise.resolve(),
      append(x) { newest = x; },
      drawnNewestX: () => newest,
      // There is no drawing to read back; the runner records admission as "not applicable (floor)".
      describe: () => null,
      destroy() {},
    };
  },
};
