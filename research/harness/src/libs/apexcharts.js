import ApexCharts from 'apexcharts';

export const meta = { name: 'ApexCharts', pkg: 'apexcharts' };

export async function trend(el, d) {
  const chart = new ApexCharts(el, {
    chart: { type: 'line', height: el.clientHeight },
    title: { text: d.title },
    series: d.series.map(s => ({ name: s.name, data: s.values.map((v, i) => [d.t[i], v]) })),
    xaxis: { type: 'datetime' },
    yaxis: { title: { text: d.yTitle } },
  });
  await chart.render();
  return { chart, destroy: () => chart.destroy() };
}

export async function bars(el, d) {
  const chart = new ApexCharts(el, {
    chart: { type: 'bar', height: el.clientHeight },
    title: { text: d.title },
    series: [{ name: d.name, data: d.values }],
    xaxis: { categories: d.categories },
    yaxis: { title: { text: d.yTitle } },
  });
  await chart.render();
  return { chart, destroy: () => chart.destroy() };
}

export async function parts(el, d) {
  const chart = new ApexCharts(el, {
    chart: { type: 'donut', height: el.clientHeight },
    title: { text: d.title },
    series: d.values,
    labels: d.labels,
  });
  await chart.render();
  return { chart, destroy: () => chart.destroy() };
}

export async function dirty(el, d) {
  const chart = new ApexCharts(el, {
    chart: { type: 'line', height: el.clientHeight },
    title: { text: d.title },
    series: [{ name: d.name, data: d.values }],
    xaxis: { categories: d.categories },
  });
  await chart.render();
  return { chart, destroy: () => chart.destroy() };
}

export async function scale(el, d) {
  const data = d.t.map((t, i) => [t, d.y[i]]);
  const chart = new ApexCharts(el, {
    chart: { type: 'line', height: el.clientHeight },
    title: { text: d.title },
    series: [{ name: d.name, data }],
    xaxis: { type: 'datetime' },
  });
  await chart.render();
  return { chart, data, destroy: () => chart.destroy() };
}

export async function stream(el, d) {
  const h = await scale(el, d);
  h.push = (x, y) => { h.data.push([x, y]); h.data.shift(); h.chart.updateSeries([{ data: h.data }]); };
  return h;
}

export async function dates(el, d) {
  const chart = new ApexCharts(el, { chart: { type: 'line', height: el.clientHeight }, title: { text: d.title },
    series: d.series.map(s => ({ name: s.name, data: s.values.map((y, i) => ({ x: d.days[i], y })) })), xaxis: { type: 'datetime' } });
  await chart.render();
  return { chart, destroy: () => chart.destroy() };
}
