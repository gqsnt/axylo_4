import Highcharts from 'highcharts';
import 'highcharts/modules/accessibility'; // separate module; Highcharts logs a console hint when it is missing

export const meta = { name: 'Highcharts', pkg: 'highcharts' };

export function trend(el, d) {
  const chart = Highcharts.chart(el, {
    title: { text: d.title },
    xAxis: { type: 'datetime' },
    yAxis: { title: { text: d.yTitle } },
    series: d.series.map(s => ({ name: s.name, data: s.values.map((v, i) => [d.t[i], v]) })),
  });
  return { chart, destroy: () => chart.destroy() };
}

export function bars(el, d) {
  const chart = Highcharts.chart(el, {
    chart: { type: 'column' },
    title: { text: d.title },
    xAxis: { categories: d.categories },
    yAxis: { title: { text: d.yTitle } },
    series: [{ name: d.name, data: d.values }],
  });
  return { chart, destroy: () => chart.destroy() };
}

export function parts(el, d) {
  const chart = Highcharts.chart(el, {
    chart: { type: 'pie' },
    title: { text: d.title },
    series: [{ name: d.name, innerSize: '50%', data: d.labels.map((l, i) => [l, d.values[i]]) }],
  });
  return { chart, destroy: () => chart.destroy() };
}

export function dirty(el, d) {
  const chart = Highcharts.chart(el, {
    title: { text: d.title },
    xAxis: { categories: d.categories },
    series: [{ name: d.name, data: d.values }],
  });
  return { chart, destroy: () => chart.destroy() };
}

export function scale(el, d) {
  const chart = Highcharts.chart(el, {
    title: { text: d.title },
    xAxis: { type: 'datetime' },
    series: [{ name: d.name, data: d.t.map((t, i) => [t, d.y[i]]) }],
  });
  return { chart, destroy: () => chart.destroy() };
}

export function stream(el, d) {
  const h = scale(el, d);
  h.push = (x, y) => h.chart.series[0].addPoint([x, y], true, true);
  return h;
}

export function dates(el, d) {
  const chart = Highcharts.chart(el, { title: { text: d.title }, xAxis: { type: 'datetime' },
    series: d.series.map(s => ({ name: s.name, data: s.values.map((v, i) => [d.days[i], v]) })) });
  return { chart, destroy: () => chart.destroy() };
}
