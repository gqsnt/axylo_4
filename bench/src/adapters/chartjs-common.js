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

export function handleFor(chart, state, append, heldData, kind = 'line', fixture) {
  const bar = kind === 'bar', donut = kind === 'donut', scatter = kind === 'scatter';
  const scale = axis => [chart.scales[axis].min, chart.scales[axis].max];
  const plotRect = () => {
    const a = chart.chartArea;
    return { x: a.left, y: a.top, width: a.right - a.left, height: a.bottom - a.top };
  };
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
    hoverGeometry() {
      const r = chart.canvas.getBoundingClientRect(), a = plotRect();
      const plot = { left: r.left + a.x, top: r.top + a.y, width: a.width, height: a.height };
      if (bar || donut) return { plot, marks: chart.getDatasetMeta(0).data.map(element => {
        const { x, y } = element.getCenterPoint();
        return [r.left + x, r.top + y];
      }) };
      return { plot, xDomain: scale('x'), ...(scatter ? { yDomain: scale('y') } : {}) };
    },
    hoveredIndex: () => { const a = chart.getActiveElements?.(); if (!a?.length) return NaN; const p = chart.data.datasets[a[0].datasetIndex]?.data?.[a[0].index]; return p?.i ?? a[0].index; },
    readoutShows(i) {
      if (state.tooltipIndex !== i) return false;
      if (kind === 'line') return true;
      const text = donut ? fixture.labels[i] + ': ' + fixture.values[i] : fixture.names[0] + ': ' + fixture.ys[0][i];
      return chart.tooltip?.opacity > 0 && chart.tooltip.body.some(row => row.lines.includes(text));
    },
    // Reads Chart.js's own objects, not the fixture:
    //   x range  chart.scales.x.min / max  (time scale: epoch milliseconds)
    //   y range  chart.scales.y.min / max
    //   per series: the data the chart holds, from heldData(chart, i): the parsed points (meta._parsed) for the
    //   starter config, and for the tuned config dataset._data when the decimation plugin has replaced
    //   dataset.data with its decimated copy, else dataset.data. Points, first and last x, and the number of
    //   points whose y is null or NaN (Chart.js skips both).
    //   drawn: the points the line controller draws (the decimated dataset.data when decimation is active, else
    //   the held points), as index paths (chartjsDrawnPaths).
    describe({ probe } = {}) {
      const geometry = probe === 'geometry';
      if (bar) {
        const rectangles = chart.data.datasets.map((ds, i) => {
          if (!chart.isDatasetVisible(i)) return [];
          if (geometry) return (state.painted?.[i] ?? []).map(f => f.rect).filter(Boolean).sort((a, b) => a.x - b.x);
          return chart.getDatasetMeta(i).data.map(b => ({ x: b.x - b.width / 2, y: b.y, width: b.width, height: b.base - b.y }));
        });
        return { kind, plot: plotRect(), y: scale('y'), rectangles };
      }
      if (donut) {
        const meta = chart.getDatasetMeta(0);
        const slices = meta.data.flatMap((arc, i) => chart.getDataVisibility(i) && (!geometry || state.painted?.[0]?.[i]?.arc)
          ? [{ label: chart.data.labels[i], value: meta._parsed[i], cx: arc.x, cy: arc.y, startAngle: arc.startAngle, innerRadius: arc.innerRadius,
            outerRadius: arc.outerRadius, sweep: arc.endAngle - arc.startAngle }] : []);
        return { kind, plot: plotRect(), slices };
      }
      const seen = {
        reads: 'Chart.js chart.scales.x/y.{min,max}; held points per dataset; drawn points (decimated dataset.data when active) as index paths',
        x: [chart.scales.x.min, chart.scales.x.max],
        y: [chart.scales.y.min, chart.scales.y.max],
        series: chart.data.datasets.map((ds, i) => {
          const pts = heldData(chart, i);
          let missing = 0;
          for (let k = 0; k < pts.length; k++) { const y = pts[k].y; if (y == null || y !== y) missing++; }
          if (scatter) return { points: pts.length, missing, oldestX: pts[0]?.x, newestX: pts.at(-1)?.x, drawn: { kind: 'points' } };
          const drawnPoints = ds._decimated ? ds.data : pts;
          const spanGaps = !!(ds.spanGaps ?? chart.options.spanGaps);
          // Held points are drawn as they are (position = index); decimated copies carry their source index `i`.
          const base = pts[0]?.i ?? 0;
          const indexOf = ds._decimated ? (p => p.i - base) : ((_, j) => j);
          if (ds._decimated && !drawnPoints.every(p => Number.isInteger(p.i))) return { points: pts.length, oldestX: pts[0]?.x, newestX: pts[pts.length - 1]?.x, missing, drawn: { kind: 'not-applicable', reason: 'decimated points without source indices' } };
          return { points: pts.length, oldestX: pts[0]?.x, newestX: pts[pts.length - 1]?.x, missing, drawnPoints: drawnPoints.length, drawn: { kind: 'indices', paths: chartjsDrawnPaths(drawnPoints, indexOf, spanGaps), decimated: !!ds._decimated } };
        }),
      };
      if (kind !== 'line') seen.kind = kind;
      if (kind === 'area' && geometry) seen.areaFills = state.painted?.filter(group => group.some(f => f.polygon && f.path === 'nonzero')).length ?? 0;
      if (scatter && geometry) {
        const plot = plotRect();
        const centers = [];
        for (const { arc } of state.painted?.[0] ?? []) {
          if (arc && arc.r > 0 && arc.x >= plot.x - 1e-6 && arc.x <= plot.x + plot.width + 1e-6) centers.push(arc.x, arc.y);
        }
        seen.drawnPoints = { plot, centers };
      }
      return seen;
    },
    destroy() {
      const canvas = chart.canvas;
      state.observer?.disconnect();
      chart.destroy();
      if (kind !== 'line') canvas.remove();
    },
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
    state.observer = new ResizeObserver(() => { if (el.clientWidth !== last) { last = el.clientWidth; state.pending = true; } });
    state.observer.observe(el);
  }
  const c = document.createElement('canvas');
  el.appendChild(c);
  return c;
}

export const chartjsAvailable = (workload, params) => params?.kind && params.kind !== 'line'
  ? { ok: false, reason: params.kind === 'histogram' ? 'Chart.js has no native histogram binning chart API' : `no ${params.kind} configuration for the Chart.js starter adapter` }
  : (workload === 'scatter' || workload === 'compact' ? { ok: false, reason: `no ${workload} configuration for Chart.js in this harness` } : { ok: true });

// In geometry probes only, attribute Canvas fills to the dataset whose controller just painted.
// The Filler plugin paints immediately before its line dataset.
export function chartjsPaintProbe(capture, state) {
  let offset = 0;
  return {
    id: 'benchPaintProbe',
    beforeDatasetsDraw(chart) { state.painted = []; offset = capture.fills(chart.canvas).length; },
    afterDatasetDraw(chart, { index }) {
      const fills = capture.fills(chart.canvas);
      state.painted[index] = fills.slice(offset);
      offset = fills.length;
    },
  };
}
