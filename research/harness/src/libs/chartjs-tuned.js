// Chart.js with its documented performance options: no parsing, decimation plugin, no animation, no point markers.
import { Chart } from 'chart.js/auto';
import 'chartjs-adapter-date-fns';
export const meta = { name: 'Chart.js (tuned)', pkg: 'chart.js' };
export function scale(el, d) {
  const data = d.t.map((x, i) => ({ x, y: d.y[i] }));
  const chart = new Chart(el.appendChild(document.createElement('canvas')), {
    type: 'line',
    data: { datasets: [{ label: d.name, data, pointRadius: 0, borderWidth: 1 }] },
    options: { maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
      plugins: { title: { display: true, text: d.title }, decimation: { enabled: true, algorithm: 'min-max' } },
      scales: { x: { type: 'time' } } },
  });
  return { chart, data, destroy: () => chart.destroy() };
}
export function stream(el, d) {
  const h = scale(el, d);
  h.push = (x, y) => { h.data.push({ x, y }); h.data.shift(); h.chart.update('none'); };
  return h;
}
