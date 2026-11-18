// Chart.js plumbing shared by the starter-default and tuned adapters: readiness, the draw record used by the
// streaming workload, and the readback for the admission check.
import { Chart, animator } from 'chart.js/auto';
import 'chartjs-adapter-date-fns'; // a date adapter must be registered before a time scale works

export { Chart };

/** Instrumentation plugin, identical in both configurations. It changes nothing that is drawn. */
export function benchPlugin(state, newestOf) {
  return {
    id: 'axyloBench',
    // Chart.js notifies afterRender once a render has finished, including its animation (onAnimationsComplete).
    afterRender: chart => { if (!animator.running(chart)) state.readyResolve(); },
    afterDraw: chart => { state.drawnNewest = newestOf(chart); },
  };
}

export function handleFor(chart, state, append, heldData) {
  return {
    chart,
    ready: state.ready,
    append,
    drawnNewestX: () => state.drawnNewest,
    // Reads Chart.js's own objects, not the fixture:
    //   x range  chart.scales.x.min / max  (time scale: epoch milliseconds)
    //   y range  chart.scales.y.min / max
    //   per series: the data the chart holds, from heldData(chart, i): the parsed points (meta._parsed) for the
    //   starter config, and for the tuned config dataset._data when the decimation plugin has replaced
    //   dataset.data with its decimated copy, else dataset.data. Points, first and last x, and the number of
    //   points whose y is null or NaN (Chart.js skips both).
    //   drawnPoints (not checked) is meta.data.length, the point elements Chart.js laid out.
    describe() {
      return {
        reads: 'Chart.js chart.scales.x/y.{min,max}; held points per dataset; meta.data.length',
        x: [chart.scales.x.min, chart.scales.x.max],
        y: [chart.scales.y.min, chart.scales.y.max],
        series: chart.data.datasets.map((_, i) => {
          const pts = heldData(chart, i);
          let missing = 0;
          for (let k = 0; k < pts.length; k++) { const y = pts[k].y; if (y == null || y !== y) missing++; }
          return { points: pts.length, oldestX: pts[0]?.x, newestX: pts[pts.length - 1]?.x, missing, drawnPoints: chart.getDatasetMeta(i).data.length };
        }),
      };
    },
    destroy: () => chart.destroy(),
  };
}

export function newState() {
  const state = { drawnNewest: NaN };
  state.ready = new Promise(r => { state.readyResolve = r; });
  return state;
}

export function canvasIn(el) {
  const c = document.createElement('canvas');
  el.appendChild(c);
  return c;
}
