// Highcharts with the Boost module (WebGL path for large series) and animation off.
import Highcharts from 'highcharts';
import 'highcharts/modules/boost';
import 'highcharts/modules/accessibility';
export const meta = { name: 'Highcharts (boost)', pkg: 'highcharts' };
export function scale(el, d) {
  const chart = Highcharts.chart(el, { chart: { animation: false }, plotOptions: { series: { animation: false } }, title: { text: d.title },
    xAxis: { type: 'datetime' }, series: [{ name: d.name, lineWidth: 1, data: d.t.map((t, i) => [t, d.y[i]]) }] });
  return { chart, destroy: () => chart.destroy() };
}
export function stream(el, d) {
  const h = scale(el, d);
  h.push = (x, y) => h.chart.series[0].addPoint([x, y], true, true, false);
  return h;
}
