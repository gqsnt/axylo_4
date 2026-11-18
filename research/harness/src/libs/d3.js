import * as d3 from 'd3';

// D3 has no chart-level API. These follow the structure of the official gallery examples
// (line chart, bar chart, donut chart); title, legend and readout are hand-built.
export const meta = { name: 'D3', pkg: 'd3' };

function frame(el, d) {
  const width = el.clientWidth, height = el.clientHeight;
  const m = { top: 44, right: 24, bottom: 30, left: 56 };
  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height)
    .attr('viewBox', [0, 0, width, height]).attr('style', 'max-width: 100%; height: auto; font: 10px sans-serif;');
  svg.append('text').attr('x', m.left).attr('y', 16).attr('font-size', 14).attr('font-weight', 'bold').attr('fill', 'currentColor').text(d.title);
  return { svg, width, height, m };
}

function yAxis(svg, y, { width, height, m }, label) {
  svg.append('g').attr('transform', `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(height / 40))
    .call(g => g.select('.domain').remove())
    .call(g => g.selectAll('.tick line').clone().attr('x2', width - m.left - m.right).attr('stroke-opacity', 0.1))
    .call(g => label && g.append('text').attr('x', -m.left).attr('y', 34).attr('fill', 'currentColor').attr('text-anchor', 'start').text(`↑ ${label}`));
}

function lineChart(el, d, names, cols, t, fromZero = true) {
  const f = frame(el, d), { svg, width, height, m } = f;
  const x = d3.scaleUtc(d3.extent(t), [m.left, width - m.right]);
  const lo = fromZero ? 0 : d3.min(cols, c => d3.min(c));
  const y = d3.scaleLinear([lo, d3.max(cols, c => d3.max(c))], [height - m.bottom, m.top]).nice();
  const color = d3.scaleOrdinal(names, d3.schemeTableau10);
  const xAxisG = svg.append('g').attr('transform', `translate(0,${height - m.bottom})`);
  const drawX = () => xAxisG.call(d3.axisBottom(x).ticks(width / 80).tickSizeOuter(0));
  drawX();
  yAxis(svg, y, f, d.yTitle);
  const line = d3.line().defined(v => v != null).x((v, i) => x(t[i])).y(v => y(v));
  const paths = svg.append('g').attr('fill', 'none').attr('stroke-width', 1.5)
    .selectAll('path').data(cols).join('path').attr('stroke', (c, i) => color(names[i])).attr('d', c => line(c));
  // legend
  const lg = svg.append('g').attr('transform', `translate(${width - m.right - 330},8)`);
  names.forEach((n, i) => {
    const g = lg.append('g').attr('transform', `translate(${i * 110},0)`);
    g.append('rect').attr('width', 12).attr('height', 12).attr('fill', color(n));
    g.append('text').attr('x', 16).attr('y', 10).attr('fill', 'currentColor').text(n);
  });
  // readout on pointer move
  const rule = svg.append('line').attr('stroke', 'currentColor').attr('stroke-opacity', 0.4).attr('y1', m.top).attr('y2', height - m.bottom).attr('display', 'none');
  const tip = svg.append('text').attr('fill', 'currentColor').attr('y', m.top - 6).attr('display', 'none');
  const fmt = d3.utcFormat('%b %-d, %Y'), num = d3.format(',');
  svg.on('pointermove', e => {
    const i = d3.bisectCenter(t, x.invert(d3.pointer(e)[0]));
    rule.attr('display', null).attr('x1', x(t[i])).attr('x2', x(t[i]));
    tip.attr('display', null).attr('x', Math.min(x(t[i]), width - 300))
      .text(`${fmt(t[i])} — ` + names.map((n, k) => `${n}: ${cols[k][i] == null ? 'no data' : num(cols[k][i])}`).join(' · '));
  }).on('pointerleave', () => { rule.attr('display', 'none'); tip.attr('display', 'none'); });
  return { svg, x, y, line, paths, drawX, destroy: () => svg.remove() };
}

export function trend(el, d) {
  return lineChart(el, d, d.series.map(s => s.name), d.series.map(s => s.values), d.t);
}

export function bars(el, d) {
  const f = frame(el, d), { svg, width, height, m } = f;
  const x = d3.scaleBand(d.categories, [m.left, width - m.right]).padding(0.1);
  const y = d3.scaleLinear([0, d3.max(d.values)], [height - m.bottom, m.top]);
  svg.append('g').attr('fill', 'steelblue').selectAll('rect').data(d.values).join('rect')
    .attr('x', (v, i) => x(d.categories[i])).attr('y', v => y(v)).attr('height', v => y(0) - y(v)).attr('width', x.bandwidth())
    .append('title').text((v, i) => `${d.categories[i]}: ${v}`);
  svg.append('g').attr('transform', `translate(0,${height - m.bottom})`).call(d3.axisBottom(x).tickSizeOuter(0));
  yAxis(svg, y, f, d.yTitle);
  return { destroy: () => svg.remove() };
}

export function parts(el, d) {
  const { svg, width, height } = frame(el, d);
  const radius = Math.min(width, height - 40) / 2;
  const arc = d3.arc().innerRadius(radius * 0.5).outerRadius(radius - 1);
  const pie = d3.pie().padAngle(1 / radius).sort(null);
  const color = d3.scaleOrdinal(d.labels, d3.quantize(t => d3.interpolateSpectral(t * 0.8 + 0.1), d.labels.length).reverse());
  const g = svg.append('g').attr('transform', `translate(${width / 2},${height / 2 + 16})`);
  g.selectAll('path').data(pie(d.values)).join('path').attr('fill', (a, i) => color(d.labels[i])).attr('d', arc)
    .append('title').text((a, i) => `${d.labels[i]}: ${a.data}`);
  g.append('g').attr('font-size', 12).attr('text-anchor', 'middle').selectAll('text').data(pie(d.values)).join('text')
    .attr('transform', a => `translate(${arc.centroid(a)})`)
    .call(t => t.append('tspan').attr('y', '-0.4em').attr('font-weight', 'bold').text((a, i) => d.labels[i]))
    .call(t => t.filter(a => a.endAngle - a.startAngle > 0.25).append('tspan').attr('x', 0).attr('y', '0.7em').attr('fill-opacity', 0.7).text(a => a.data));
  return { destroy: () => svg.remove() };
}

export function dirty(el, d) {
  const f = frame(el, d), { svg, width, height, m } = f;
  const x = d3.scalePoint(d.categories, [m.left, width - m.right]);
  const y = d3.scaleLinear([0, d3.max(d.values)], [height - m.bottom, m.top]);
  svg.append('g').attr('transform', `translate(0,${height - m.bottom})`).call(d3.axisBottom(x));
  yAxis(svg, y, f);
  const line = d3.line().x((v, i) => x(d.categories[i])).y(v => y(v)); // no .defined(): what you get if you forget it
  svg.append('path').attr('fill', 'none').attr('stroke', 'steelblue').attr('stroke-width', 1.5).attr('d', line(d.values));
  return { destroy: () => svg.remove() };
}

export function scale(el, d) {
  return lineChart(el, d, [d.name], [d.y.slice()], d.t.slice(), false);
}

export function stream(el, d) {
  const t = d.t.slice(), yv = d.y.slice();
  const h = lineChart(el, d, [d.name], [yv], t, false);
  // moves the x domain, redraws the x axis and re-paths; the y axis keeps its initial range
  h.push = (x, y) => { t.push(x); t.shift(); yv.push(y); yv.shift(); h.x.domain([t[0], t[t.length - 1]]); h.drawX(); h.paths.attr('d', c => h.line(c)); };
  return h;
}

// Authored code: parses the strings as UTC and uses scaleUtc, as the official examples do.
export function dates(el, d) {
  return lineChart(el, d, d.series.map(s => s.name), d.series.map(s => s.values), d.days.map(s => Date.parse(s)));
}
