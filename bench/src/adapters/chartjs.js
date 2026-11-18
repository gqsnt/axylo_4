// Chart.js, starter default: what the "Getting started" page and the time-scale page lead a new user to write.
//
// Options set, and why (none of them is a performance option):
//   type: 'line', data.labels + datasets[].data   the starter shape: x values as labels, y values as arrays
//   scales.x.type: 'time'                         the fixture's x is time; without it Chart.js draws a category axis
//                                                 of 120 to 1,000,000 label strings (needs the date-fns adapter)
//   datasets[].label                              names in the legend
// Everything else is the default: animation on, point markers on, responsive with the default 2:1 aspect ratio
// (the bench containers are 2:1 so the canvas fills them as the other libraries do), legend, tooltip, Colors plugin.
//
// Input: Chart.js needs plain arrays here, so each typed column is copied with Array.from inside the timed work.
// NaN is kept; Chart.js parses it to null and leaves a gap. Streaming uses push/shift and chart.update(), the
// pattern in the Chart.js "Updating charts" page, with its default update animation.
import { Chart, benchPlugin, handleFor, newState, canvasIn } from './chartjs-common.js';

const newestParsed = chart => { const p = chart.getDatasetMeta(0)._parsed; return p[p.length - 1]?.x; };

export default {
  id: 'chartjs',
  library: 'Chart.js',
  version: __VERSIONS__['chart.js'],
  config: 'starter default',
  available: () => ({ ok: true }),
  create(el, fix) {
    const state = newState();
    const labels = Array.from(fix.x);
    const datasets = fix.ys.map((c, i) => ({ label: fix.names[i], data: Array.from(c) }));
    const chart = new Chart(canvasIn(el), {
      type: 'line',
      data: { labels, datasets },
      options: { scales: { x: { type: 'time' } } },
      plugins: [benchPlugin(state, newestParsed)],
    });
    const append = (x, ys) => {
      labels.push(x); labels.shift();
      for (let s = 0; s < ys.length; s++) { datasets[s].data.push(ys[s]); datasets[s].data.shift(); }
      chart.update();
    };
    return handleFor(chart, state, append, (ch, i) => ch.getDatasetMeta(i)._parsed);
  },
};
