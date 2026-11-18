// Plotly with its WebGL trace type.
import Plotly from 'plotly.js-dist-min';
export const meta = { name: 'Plotly.js (scattergl)', pkg: 'plotly.js-dist-min' };
export async function scale(el, d) {
  await Plotly.newPlot(el, [{ type: 'scattergl', mode: 'lines', name: d.name, x: d.t.map(v => new Date(v)), y: d.y, line: { width: 1 } }], { title: { text: d.title } });
  return { destroy: () => Plotly.purge(el) };
}
export async function stream(el, d) {
  const h = await scale(el, d);
  h.push = (x, y) => Plotly.extendTraces(el, { x: [[new Date(x)]], y: [[y]] }, [0], 600);
  return h;
}
