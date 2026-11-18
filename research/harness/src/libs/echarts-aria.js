// ECharts with its documented accessibility switch turned on.
import * as echarts from 'echarts';
export const meta = { name: 'Apache ECharts (aria enabled)', pkg: 'echarts' };
export function trend(el, d) {
  const chart = echarts.init(el);
  chart.setOption({ aria: { enabled: true }, title: { text: d.title }, tooltip: { trigger: 'axis' }, legend: {}, xAxis: { type: 'time' }, yAxis: { type: 'value', name: d.yTitle },
    series: d.series.map(s => ({ type: 'line', name: s.name, data: s.values.map((v, i) => [d.t[i], v]) })) });
  return { chart, destroy: () => chart.dispose() };
}
