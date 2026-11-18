// ECharts with its documented large-data options: LTTB sampling, no symbols, no animation.
import * as echarts from 'echarts';
export const meta = { name: 'Apache ECharts (tuned)', pkg: 'echarts' };
export function scale(el, d) {
  const chart = echarts.init(el);
  const data = d.t.map((t, i) => [t, d.y[i]]);
  chart.setOption({ animation: false, title: { text: d.title }, tooltip: { trigger: 'axis' }, xAxis: { type: 'time' }, yAxis: { type: 'value', scale: true },
    series: [{ type: 'line', name: d.name, data, showSymbol: false, sampling: 'lttb', lineStyle: { width: 1 } }] });
  return { chart, data, destroy: () => chart.dispose() };
}
export function stream(el, d) {
  const h = scale(el, d);
  h.push = (x, y) => { h.data.push([x, y]); h.data.shift(); h.chart.setOption({ series: [{ data: h.data }] }); };
  return h;
}
