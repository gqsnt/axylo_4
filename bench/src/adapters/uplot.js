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
import uPlot from 'uplot';
import css from 'uplot/dist/uPlot.min.css';

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
  let readyResolve, drawnNewest = NaN;
  const ready = new Promise(r => { readyResolve = r; });
  const options = {
    width: el.clientWidth,
    height: el.clientHeight - LEGEND_ROOM,
    ms: 1,
    series: [{}, ...fix.names.map((n, i) => ({ label: n, stroke: COLORS[i % COLORS.length] }))],
    hooks: {
      // Instrumentation, not configuration: record what the chart had when it last drew.
      draw: [u => { const xs = u.data[0]; drawnNewest = xs[xs.length - 1]; readyResolve(); }],
    },
  };
  tweak.options?.(options);
  const u = new uPlot(options, data, el);
  // Resize workload only: uPlot does not follow its container; its demos use a resize listener and setSize. A
  // ResizeObserver on the container is the same pattern for a container that changes without a window resize.
  let observer = null;
  if (opts.resize) {
    observer = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight - LEGEND_ROOM;
      if (w !== u.width || h !== u.height) u.setSize({ width: w, height: h });
    });
    observer.observe(el);
  }
  return {
    u,
    ready,
    append(x, ys) {
      data[0].push(x);
      for (let s = 0; s < ys.length; s++) data[s + 1].push(ys[s] === ys[s] ? ys[s] : null);
      if (!tweak.noTrim) {
        data[0].shift();
        for (let s = 0; s < ys.length; s++) data[s + 1].shift();
      }
      u.setData(data);
    },
    drawnNewestX: () => drawnNewest,
    // Reads uPlot's own state, not the fixture:
    //   x range  u.scales.x.min / max   (milliseconds, because of ms: 1)
    //   y range  u.scales.y.min / max   (the one value scale every series uses by default)
    //   per series: u.data[0].length, u.data[0][0], u.data[0][last], and the count of null in u.data[s]
    describe() {
      const xs = u.data[0];
      return {
        reads: 'uPlot u.scales.x/y.{min,max}; u.data[0] length and ends; null count in u.data[s]',
        x: [u.scales.x.min, u.scales.x.max],
        y: [u.scales.y.min, u.scales.y.max],
        series: u.data.slice(1).map(col => {
          let missing = 0;
          for (let i = 0; i < col.length; i++) if (col[i] == null) missing++;
          return { points: col.length, oldestX: xs[0], newestX: xs[xs.length - 1], missing };
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
  available: () => ({ ok: true }),
  setup() {
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  },
  create: (el, fix, opts) => createUplot(el, fix, opts),
};
