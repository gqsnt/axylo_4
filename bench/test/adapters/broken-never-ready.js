// Deliberately wrong: never reports ready. The run must be recorded as "timeout". Test use only.
export default {
  id: 'broken-never-ready', library: 'none', version: 'n/a', config: 'BROKEN: never ready',
  available: () => ({ ok: true }),
  create: () => ({ ready: new Promise(() => {}), append() {}, drawnNewestX: () => NaN, describe: () => null, destroy() {} }),
};
