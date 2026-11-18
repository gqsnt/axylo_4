// uPlot, default configuration.
//
// Options set, and why (none of them is a performance option):
//   width, height   uPlot has no automatic sizing; the container's size, minus room for its legend row below the plot.
//                   In the resize workload a ResizeObserver calls setSize (see below).
//   ms: 1           the fixture's x is epoch milliseconds; uPlot's default unit is seconds. The documented
//                   alternative to dividing every timestamp by 1,000.
//   series[].stroke uPlot has no default palette; without a stroke a series is not drawn.
//   series[].label  names in the legend, as every adapter shows them.
// Everything else (axes, legend, cursor, scales, gaps) is uPlot's default.
//
// Input: typed columns go to uPlot as they are (it accepts typed arrays). uPlot marks a gap with null, which a
// Float64Array cannot hold, so a column containing NaN is copied into a plain array with null in its place; that
// copy is part of the timed work because it is what feeding uPlot this data costs.
//
// Not configured here: scatter (uPlot's default configuration draws lines) and a compact variant; those workloads
// report "not available" for uPlot.
import uPlot from 'uplot';
import css from 'uplot/dist/uPlot.min.css';
import { uplotDrawnPaths } from '../drawn.js';

export { uplotDrawnPaths };

const COLORS = ['#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e'];
const LEGEND_ROOM = 30;

function column(col, mutable) {
  let gap = false;
  for (let i = 0; i < col.length; i++) if (col[i] !== col[i]) { gap = true; break; }
  if (!gap && !mutable) return col;
  const out = new Array(col.length);
  for (let i = 0; i < col.length; i++) out[i] = col[i] === col[i] ? col[i] : null;
  return out;
}

/** Shared by the default adapter and the deliberately broken test variants; `tweak` may change options or behaviour. */
export function createUplot(el, fix, opts = {}, tweak = {}) {
  const stream = !!opts.window;
  // Streaming appends with push/shift on plain arrays, uPlot's own streaming pattern; typed arrays cannot grow.
  const data = [stream ? Array.from(fix.x) : fix.x, ...fix.ys.map(c => column(c, stream))];
  let drawnNewest = NaN, pending = true, waiters = [];
  const options = {
    width: el.clientWidth,
    height: el.clientHeight - LEGEND_ROOM,
    ms: 1,
    series: [{}, ...fix.names.map((n, i) => ({ label: n, stroke: COLORS[i % COLORS.length] }))],
    hooks: {
      // Instrumentation, not configuration: record what the chart had when it last drew, and resolve readiness.
      draw: [u => { const xs = u.data[0]; drawnNewest = xs[xs.length - 1]; pending = false; const w = waiters; waiters = []; for (const r of w) r(); }],
    },
  };
  tweak.options?.(options);
  // Resize workload only: uPlot does not follow its container; its demos use a resize listener and setSize. A
  // ResizeObserver on the container is the same pattern for a container that changes without a window resize.
  // It is registered before uPlot exists so it always runs first and marks the chart as having a draw pending.
  let observer = null, u = null;
  if (opts.resize) {
    observer = new ResizeObserver(() => {
      if (!u) return;
      const w = el.clientWidth, h = el.clientHeight - LEGEND_ROOM;
      if (w !== u.width || h !== u.height) { pending = true; u.setSize({ width: w, height: h }); }
    });
    observer.observe(el);
  }
  u = new uPlot(options, data, el);
  // Readiness is re-evaluated: after a resize or zoom, a draw is pending until uPlot's draw hook runs again.
  const readyNow = () => (pending ? new Promise(r => waiters.push(r)) : Promise.resolve());
  return {
    u,
    get ready() { return readyNow(); },
    append(x, ys) {
      data[0].push(x);
      for (let s = 0; s < ys.length; s++) data[s + 1].push(ys[s] === ys[s] ? ys[s] : null);
      if (!tweak.noTrim) {
        data[0].shift();
        for (let s = 0; s < ys.length; s++) data[s + 1].shift();
      }
      pending = true;
      u.setData(data);
    },
    drawnNewestX: () => drawnNewest,
    zoom(lo, hi) { pending = true; u.setScale('x', { min: lo, max: hi }); },
    hoverTarget: () => u.over,
    hoveredIndex: () => (u.cursor.idx == null ? NaN : u.cursor.idx),
    // The legend's live value for series 1 reads datum i in uPlot's own value format.
    readoutShows(i) {
      const v = u.root.querySelectorAll('.u-legend .u-series')[1]?.querySelector('.u-value');
      if (!v) return false;
      return v.textContent === String(u.series[1].value(u, u.data[1][i], 1, i));
    },
    // Reads uPlot's own state, not the fixture:
    //   x range  u.scales.x.min / max   (milliseconds, because of ms: 1)
    //   y range  u.scales.y.min / max   (the one value scale every series uses by default)
    //   per series: u.data[0].length, u.data[0][0], u.data[0][last], the count of null in u.data[s], and the
    //   drawn index paths (uplotDrawnPaths over series.idxs and series.spanGaps)
    describe() {
      const xs = u.data[0];
      return {
        reads: 'uPlot u.scales.x/y.{min,max}; u.data[0] length and ends; null count in u.data[s]; drawn paths from u.series[s].idxs and null breaks',
        x: [u.scales.x.min, u.scales.x.max],
        y: [u.scales.y.min, u.scales.y.max],
        series: u.data.slice(1).map((col, i) => {
          let missing = 0;
          for (let k = 0; k < col.length; k++) if (col[k] == null) missing++;
          const s = u.series[i + 1];
          return { points: col.length, oldestX: xs[0], newestX: xs[xs.length - 1], missing, drawn: { kind: 'indices', paths: uplotDrawnPaths(col, s.idxs, !!s.spanGaps) } };
        }),
      };
    },
    destroy: () => { observer?.disconnect(); u.destroy(); },
  };
}

export default {
  id: 'uplot',
  library: 'uPlot',
  version: __VERSIONS__.uplot,
  config: 'default',
  available: workload => (workload === 'scatter' || workload === 'compact' ? { ok: false, reason: `no ${workload} configuration for uPlot in this harness` } : { ok: true }),
  setup() {
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  },
  create: (el, fix, opts) => createUplot(el, fix, opts),
};
