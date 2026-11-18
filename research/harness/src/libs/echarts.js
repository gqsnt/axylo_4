import * as echarts from 'echarts';

export const meta = { name: 'Apache ECharts', pkg: 'echarts' };

export function trend(el, d) {
  const chart = echarts.init(el);
  chart.setOption({
    title: { text: d.title },
    tooltip: { trigger: 'axis' }, // tooltip and legend are opt-in components
    legend: {},
    xAxis: { type: 'time' },
    yAxis: { type: 'value', name: d.yTitle },
    series: d.series.map(s => ({ type: 'line', name: s.name, data: s.values.map((v, i) => [d.t[i], v]) })),
  });
  return { chart, destroy: () => chart.dispose() };
}

export function bars(el, d) {
  const chart = echarts.init(el);
  chart.setOption({
    title: { text: d.title },
    tooltip: {},
    xAxis: { type: 'category', data: d.categories },
    yAxis: { type: 'value', name: d.yTitle },
    series: [{ type: 'bar', name: d.name, data: d.values }],
  });
  return { chart, destroy: () => chart.dispose() };
}

export function parts(el, d) {
  const chart = echarts.init(el);
  chart.setOption({
    title: { text: d.title },
    tooltip: { trigger: 'item' },
    legend: {},
    series: [{ type: 'pie', name: d.name, radius: ['40%', '70%'], data: d.labels.map((name, i) => ({ name, value: d.values[i] })) }],
  });
  return { chart, destroy: () => chart.dispose() };
}

export function dirty(el, d) {
  const chart = echarts.init(el);
  chart.setOption({
    title: { text: d.title },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: d.categories },
    yAxis: { type: 'value' },
    series: [{ type: 'line', name: d.name, data: d.values }],
  });
  return { chart, destroy: () => chart.dispose() };
}

export function scale(el, d) {
  const chart = echarts.init(el);
  const data = d.t.map((t, i) => [t, d.y[i]]);
  chart.setOption({
    title: { text: d.title },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'time' },
    yAxis: { type: 'value', scale: true },
    series: [{ type: 'line', name: d.name, data }],
  });
  return { chart, data, destroy: () => chart.dispose() };
}

export function stream(el, d) {
  const h = scale(el, d);
  h.push = (x, y) => { h.data.push([x, y]); h.data.shift(); h.chart.setOption({ series: [{ data: h.data }] }); };
  return h;
}

export function dates(el, d) {
  const chart = echarts.init(el);
  chart.setOption({ title: { text: d.title }, tooltip: { trigger: 'axis' }, legend: {}, xAxis: { type: 'time' }, yAxis: { type: 'value' },
    series: d.series.map(s => ({ type: 'line', name: s.name, data: s.values.map((v, i) => [d.days[i], v]) })) });
  return { chart, destroy: () => chart.dispose() };
}
