// Chart.js plumbing shared by the starter-default and tuned adapters: readiness, the draw record used by the
// streaming workload, the readback for the admission check, zoom and hover.
import { Chart, animator } from 'chart.js/auto';
import 'chartjs-adapter-date-fns'; // a date adapter must be registered before a time scale works
import { chartjsDrawnPaths } from '../drawn.js';

export { Chart };

/** Instrumentation plugin, identical in both configurations. It changes nothing that is drawn. */
export function benchPlugin(state, newestOf) {
  return {
    id: 'axyloBench',
    // Chart.js notifies afterRender once a render has finished, including its animation (onAnimationsComplete).
    afterRender: chart => { if (!animator.running(chart)) state.settled(); },
    afterDraw: chart => {
      state.drawnNewest = newestOf(chart);
      const t = chart.tooltip;
      // With decimation the tooltip's dataIndex is into the decimated copy; the point's own `i` is the source index.
      state.tooltipIndex = t && t.opacity > 0 && t.dataPoints?.length ? (t.dataPoints[0].raw?.i ?? t.dataPoints[0].dataIndex) : NaN;
    },
  };
}

export function handleFor(chart, state, append, heldData) {
  return {
    chart,
    get ready() { return state.readyNow(); },
    append(x, ys) { state.pending = true; append(x, ys); },
    drawnNewestX: () => state.drawnNewest,
    zoom(lo, hi) {
      state.pending = true;
      chart.options.scales.x.min = lo;
      chart.options.scales.x.max = hi;
      chart.update('none');
    },
    hoverTarget: () => chart.canvas,
    hoverGeometry: () => { const r = chart.canvas.getBoundingClientRect(), a = chart.chartArea; return { plot: { left: r.left + a.left, top: r.top + a.top, width: a.right - a.left, height: a.bottom - a.top }, xDomain: [chart.scales.x.min, chart.scales.x.max] }; },
    hoveredIndex: () => { const a = chart.getActiveElements?.(); if (!a?.length) return NaN; const p = chart.data.datasets[a[0].datasetIndex]?.data?.[a[0].index]; return p?.i ?? a[0].index; },
    readoutShows: i => state.tooltipIndex === i,
    // Reads Chart.js's own objects, not the fixture:
    //   x range  chart.scales.x.min / max  (time scale: epoch milliseconds)
    //   y range  chart.scales.y.min / max
    //   per series: the data the chart holds, from heldData(chart, i): the parsed points (meta._parsed) for the
    //   starter config, and for the tuned config dataset._data when the decimation plugin has replaced
    //   dataset.data with its decimated copy, else dataset.data. Points, first and last x, and the number of
    //   points whose y is null or NaN (Chart.js skips both).
    //   drawn: the points the line controller draws (the decimated dataset.data when decimation is active, else
    //   the held points), as index paths (chartjsDrawnPaths).
    describe() {
      return {
        reads: 'Chart.js chart.scales.x/y.{min,max}; held points per dataset; drawn points (decimated dataset.data when active) as index paths',
        x: [chart.scales.x.min, chart.scales.x.max],
        y: [chart.scales.y.min, chart.scales.y.max],
        series: chart.data.datasets.map((ds, i) => {
          const pts = heldData(chart, i);
          let missing = 0;
          for (let k = 0; k < pts.length; k++) { const y = pts[k].y; if (y == null || y !== y) missing++; }
          const drawnPoints = ds._decimated ? ds.data : pts;
          const spanGaps = !!(ds.spanGaps ?? chart.options.spanGaps);
          // Held points are drawn as they are (position = index); decimated copies carry their source index `i`.
          const base = pts[0]?.i ?? 0;
          const indexOf = ds._decimated ? (p => p.i - base) : ((_, j) => j);
          if (ds._decimated && !drawnPoints.every(p => Number.isInteger(p.i))) return { points: pts.length, oldestX: pts[0]?.x, newestX: pts[pts.length - 1]?.x, missing, drawn: { kind: 'not-applicable', reason: 'decimated points without source indices' } };
          return { points: pts.length, oldestX: pts[0]?.x, newestX: pts[pts.length - 1]?.x, missing, drawnPoints: drawnPoints.length, drawn: { kind: 'indices', paths: chartjsDrawnPaths(drawnPoints, indexOf, spanGaps), decimated: !!ds._decimated } };
        }),
      };
    },
    destroy: () => chart.destroy(),
  };
}

/** Readiness that can be awaited again after an update: a render is pending until afterRender with no animation. */
export function newState() {
  const state = { drawnNewest: NaN, tooltipIndex: NaN, pending: true, waiters: [] };
  state.settled = () => { state.pending = false; const w = state.waiters; state.waiters = []; for (const r of w) r(); };
  state.readyNow = () => (state.pending ? new Promise(r => state.waiters.push(r)) : Promise.resolve());
  return state;
}

/**
 * A canvas for the chart. In the resize workload a ResizeObserver, registered before Chart.js creates its own,
 * marks a render as pending whenever the container changes, so readiness waits for Chart.js's re-render.
 */
export function canvasIn(el, state, opts = {}) {
  if (opts.resize) {
    let last = el.clientWidth;
    new ResizeObserver(() => { if (el.clientWidth !== last) { last = el.clientWidth; state.pending = true; } }).observe(el);
  }
  const c = document.createElement('canvas');
  el.appendChild(c);
  return c;
}

export const chartjsAvailable = workload => (workload === 'scatter' || workload === 'compact' ? { ok: false, reason: `no ${workload} configuration for Chart.js in this harness` } : { ok: true });
