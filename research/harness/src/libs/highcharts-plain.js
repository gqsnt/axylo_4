// Highcharts without its accessibility module: the state every other library was tested in.
import Highcharts from 'highcharts';
export const meta = { name: 'Highcharts (no accessibility module)', pkg: 'highcharts' };
export function trend(el, d) {
  const chart = Highcharts.chart(el, { title: { text: d.title }, xAxis: { type: 'datetime' }, yAxis: { title: { text: d.yTitle } },
    series: d.series.map(s => ({ name: s.name, data: s.values.map((v, i) => [d.t[i], v]) })) });
  return { chart, destroy: () => chart.destroy() };
}
