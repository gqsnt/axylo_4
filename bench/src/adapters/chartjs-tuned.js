// Chart.js, tuned, keeping the same visible features as the starter default: time x axis, y axis, legend, tooltip.
//
// Every option that differs from chartjs.js, with the reason and the page that recommends it
// (https://www.chartjs.org/docs/latest/general/performance.html unless noted):
//   animation: false            "Disable animations": no entry or update animation, so a create or an update is
//                               one render. Visible difference: the line appears without the entry animation.
//   parsing: false, data as     "Data structure and format": skip parsing; data handed in Chart.js's internal
//   {x, y} with numeric x       format. Required for the decimation plugin.
//   normalized: true            "Data normalization": the fixture's x is unique, sorted and consistent across
//                               datasets, so Chart.js may skip checking it.
//   plugins.decimation:         "Data decimation" (docs/latest/configuration/decimation.html). min-max keeps each
//     { enabled, 'min-max' }    pixel column's lowest and highest point, so spikes such as the injected extreme stay.
//                               Active only above 4x the canvas width in points. Known fidelity risk: min-max skips
//                               NaN values, so above that threshold a gap can be drawn across. The readback reports
//                               the decimated copy Chart.js draws (chartjs-common.js, chartjsDrawnPaths), and the
//                               admission check rejects a drawing that joins retained points across a missing value:
//                               on gappy data above the threshold this configuration is not admitted.
//   elements.point.radius: 0    "Disable point drawing" (elements.point.radius / pointRadius). Visible difference:
//                               no point markers, which on 3x120 are visible dots and on 10k+ points a solid band.
//   interaction: { mode:        keeps the tooltip reachable without markers: with the default intersect: true and
//     'nearest', axis: 'x',     radius 0 the pointer must hit a 1 px target (docs/latest/configuration/interactions.html).
//     intersect: false }
// Not applied: fixed scale min/max and ticks.sampleSize / rotation limits ("Specify min and max for scales",
// "Disable ticks rotation") because they need knowledge of the data or change the axis labels.
//
// Input: one {x, y, i} object per point is built from the typed columns inside the timed work; Chart.js has no typed
// column input. `i` (the source index) is instrumentation: Chart.js ignores it, its decimation copies keep it, and the
// readback uses it because decimation rewrites the x of some points (one extra property per point, timed). Streaming pushes and shifts the same array and calls chart.update('none').
import { Chart, benchPlugin, handleFor, newState, canvasIn, chartjsAvailable, chartjsPaintProbe } from './chartjs-common.js';

import { kindAvailability } from '../multichart.js';

const held = (chart, i) => { const d = chart.data.datasets[i]; return d._data ?? d.data; };
const newestHeld = chart => { const d = held(chart, 0); return d[d.length - 1]?.x; };

export default {
  id: 'chartjs-tuned',
  library: 'Chart.js',
  version: __VERSIONS__['chart.js'],
  config: 'tuned, same visible features',
  available: (workload, params) => kindAvailability('Chart.js', workload, params) ?? chartjsAvailable(workload),
  create(el, fix, opts = {}) {
    const state = newState();
    const kind = fix.kind ?? opts.kind ?? 'line';
    const bar = kind === 'bar', donut = kind === 'donut', scatter = kind === 'scatter', area = kind === 'area';
    const n = fix.x?.length ?? 0;
    let next = 0;
    const arrays = donut ? [Array.from(fix.values)] : fix.ys.map(col => {
      if (bar) return Array.from(col);
      const pts = new Array(n);
      for (let k = 0; k < n; k++) pts[k] = { x: fix.x[k], y: col[k], i: k };
      return pts;
    });
    const chart = new Chart(canvasIn(el, state, opts), {
      type: donut ? 'doughnut' : bar || scatter ? kind : 'line',
      data: { ...(donut || bar ? { labels: fix.labels ?? fix.categories } : {}),
        datasets: arrays.map((data, i) => ({ label: fix.names?.[i] ?? fix.title, data,
          ...(area ? { fill: true } : {}) })) },
      options: {
        animation: false,
        ...(kind !== 'line' ? { maintainAspectRatio: false } : {}),
        ...(!bar && !donut ? { parsing: false } : {}),
        normalized: true,
        elements: { point: { radius: scatter ? 2 : 0 } },
        interaction: { mode: 'nearest', axis: scatter || bar || donut ? 'xy' : 'x', intersect: bar || donut },
        plugins: {
          decimation: { enabled: kind === 'line' || (area && !opts.hover), algorithm: 'min-max' },
          ...(opts.hover && kind !== 'line' ? { tooltip: { callbacks: { label: item => donut
            ? item.label + ': ' + item.parsed : item.dataset.label + ': ' + item.parsed.y } } } : {}),
        },
        ...(!donut && { scales: { x: { type: bar ? 'category' : scatter ? 'linear' : 'time' },
          ...(area ? { y: { beginAtZero: true } } : {}) } }),
      },
      plugins: [benchPlugin(state, bar || donut ? () => NaN : newestHeld),
        ...(fix.kind && opts.capture ? [chartjsPaintProbe(opts.capture, state)] : [])],
    });
    const append = (x, ys) => {
      next++;
      for (let s = 0; s < ys.length; s++) { arrays[s].push({ x, y: ys[s], i: n + next - 1 }); arrays[s].shift(); }
      chart.update('none');
    };
    return handleFor(chart, state, append, held, kind, fix);
  },
};
