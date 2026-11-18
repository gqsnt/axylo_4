import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export const meta = { name: 'uPlot', pkg: 'uplot' };
// uPlot needs explicit pixel sizes (no auto-resize), explicit stroke colors (no palette), and x in seconds.
const size = el => ({ width: el.clientWidth, height: el.clientHeight - 80 }); // title and legend sit outside `height`
const colors = ['red', 'green', 'blue']; // the colors used in uPlot's README example
const secs = t => t.map(v => v / 1000);

export function trend(el, d) {
  const u = new uPlot({
    title: d.title, ...size(el),
    series: [{}, ...d.series.map((s, i) => ({ label: s.name, stroke: colors[i] }))],
    axes: [{}, { label: d.yTitle }],
  }, [secs(d.t), ...d.series.map(s => s.values)], el);
  return { u, destroy: () => u.destroy() };
}

export function bars(el, d) {
  const idx = d.categories.map((_, i) => i);
  const u = new uPlot({
    title: d.title, ...size(el),
    scales: { x: { time: false, range: [-0.5, idx.length - 0.5] } },
    axes: [{ splits: () => idx, values: (u, splits) => splits.map(i => d.categories[i]) }, { label: d.yTitle }],
    series: [{}, { label: d.name, stroke: 'blue', fill: 'rgba(0,0,255,0.3)', paths: uPlot.paths.bars({ size: [0.6, 100] }) }],
  }, [idx, d.values], el);
  return { u, destroy: () => u.destroy() };
}

export const parts = null; // no pie/donut in uPlot

export function dirty(el, d) {
  const idx = d.categories.map((_, i) => i);
  const u = new uPlot({
    title: d.title, ...size(el),
    scales: { x: { time: false } },
    axes: [{ splits: () => idx, values: (u, splits) => splits.map(i => d.categories[i]) }, {}],
    series: [{}, { label: d.name, stroke: 'blue' }],
  }, [idx, d.values], el);
  return { u, destroy: () => u.destroy() };
}

export function scale(el, d) {
  const data = [secs(d.t), d.y.slice()];
  const u = new uPlot({ title: d.title, ...size(el), series: [{}, { label: d.name, stroke: 'blue' }] }, data, el);
  return { u, data, destroy: () => u.destroy() };
}

export function stream(el, d) {
  const h = scale(el, d);
  h.push = (x, y) => { h.data[0].push(x / 1000); h.data[0].shift(); h.data[1].push(y); h.data[1].shift(); h.u.setData(h.data); };
  return h;
}

// uPlot takes numbers only, so the date strings go through Date.parse (UTC midnight for date-only strings).
export function dates(el, d) {
  const u = new uPlot({ title: d.title, ...size(el), series: [{}, ...d.series.map((s, i) => ({ label: s.name, stroke: colors[i] }))] },
    [d.days.map(s => Date.parse(s) / 1000), ...d.series.map(s => s.values)], el);
  return { u, destroy: () => u.destroy() };
}
