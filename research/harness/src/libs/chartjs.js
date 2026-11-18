import { Chart } from 'chart.js/auto';
import 'chartjs-adapter-date-fns'; // a date adapter is required before a time scale works

export const meta = { name: 'Chart.js', pkg: 'chart.js' };
const canvas = el => el.appendChild(document.createElement('canvas'));
// maintainAspectRatio:false is needed for the chart to fill a fixed-height container
const base = d => ({ maintainAspectRatio: false, plugins: { title: { display: true, text: d.title } } });

export function trend(el, d) {
  const chart = new Chart(canvas(el), {
    type: 'line',
    data: { labels: d.t, datasets: d.series.map(s => ({ label: s.name, data: s.values })) },
    options: { ...base(d), scales: { x: { type: 'time' }, y: { title: { display: true, text: d.yTitle } } } },
  });
  return { chart, destroy: () => chart.destroy() };
}

export function bars(el, d) {
  const chart = new Chart(canvas(el), {
    type: 'bar',
    data: { labels: d.categories, datasets: [{ label: d.name, data: d.values }] },
    options: { ...base(d), scales: { y: { title: { display: true, text: d.yTitle } } } },
  });
  return { chart, destroy: () => chart.destroy() };
}

export function parts(el, d) {
  const chart = new Chart(canvas(el), {
    type: 'doughnut',
    data: { labels: d.labels, datasets: [{ label: d.name, data: d.values }] },
    options: base(d),
  });
  return { chart, destroy: () => chart.destroy() };
}

export function dirty(el, d) {
  const chart = new Chart(canvas(el), {
    type: 'line',
    data: { labels: d.categories, datasets: [{ label: d.name, data: d.values }] },
    options: base(d),
  });
  return { chart, destroy: () => chart.destroy() };
}

export function scale(el, d) {
  const chart = new Chart(canvas(el), {
    type: 'line',
    data: { labels: d.t, datasets: [{ label: d.name, data: d.y }] },
    options: { ...base(d), scales: { x: { type: 'time' } } },
  });
  return { chart, destroy: () => chart.destroy() };
}

export function stream(el, d) {
  const h = scale(el, d), { chart } = h;
  h.push = (x, y) => {
    chart.data.labels.push(x); chart.data.labels.shift();
    chart.data.datasets[0].data.push(y); chart.data.datasets[0].data.shift();
    chart.update();
  };
  return h;
}

export function dates(el, d) {
  const chart = new Chart(canvas(el), {
    type: 'line',
    data: { labels: d.days, datasets: d.series.map(s => ({ label: s.name, data: s.values })) },
    options: { ...base(d), scales: { x: { type: 'time' } } },
  });
  return { chart, destroy: () => chart.destroy() };
}
