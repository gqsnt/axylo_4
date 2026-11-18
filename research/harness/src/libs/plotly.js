import Plotly from 'plotly.js-dist-min';

export const meta = { name: 'Plotly.js', pkg: 'plotly.js-dist-min' };
const toDates = t => t.map(v => new Date(v));

export async function trend(el, d) {
  await Plotly.newPlot(el, d.series.map(s => ({ type: 'scatter', name: s.name, x: toDates(d.t), y: s.values })),
    { title: { text: d.title }, yaxis: { title: { text: d.yTitle } } });
  return { destroy: () => Plotly.purge(el) };
}

export async function bars(el, d) {
  await Plotly.newPlot(el, [{ type: 'bar', name: d.name, x: d.categories, y: d.values }],
    { title: { text: d.title }, yaxis: { title: { text: d.yTitle } } });
  return { destroy: () => Plotly.purge(el) };
}

export async function parts(el, d) {
  await Plotly.newPlot(el, [{ type: 'pie', name: d.name, labels: d.labels, values: d.values, hole: 0.5 }], { title: { text: d.title } });
  return { destroy: () => Plotly.purge(el) };
}

export async function dirty(el, d) {
  await Plotly.newPlot(el, [{ type: 'scatter', name: d.name, x: d.categories, y: d.values }], { title: { text: d.title } });
  return { destroy: () => Plotly.purge(el) };
}

export async function scale(el, d) {
  await Plotly.newPlot(el, [{ type: 'scatter', name: d.name, x: toDates(d.t), y: d.y }], { title: { text: d.title } });
  return { destroy: () => Plotly.purge(el) };
}

export async function stream(el, d) {
  const h = await scale(el, d);
  h.push = (x, y) => Plotly.extendTraces(el, { x: [[new Date(x)]], y: [[y]] }, [0], 600);
  return h;
}

export async function dates(el, d) {
  await Plotly.newPlot(el, d.series.map(s => ({ type: 'scatter', name: s.name, x: d.days, y: s.values })), { title: { text: d.title } });
  return { destroy: () => Plotly.purge(el) };
}
