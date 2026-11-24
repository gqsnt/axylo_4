// Default line sampling is 'none'. On the 1×100000 fixture at DPR 1, LTTB keeps both
// extremes at 800 px but loses the minimum at 400 px. Minmax keeps the extremes but
// loses the endpoints. Full resolution also gives axis tooltips every hover candidate.
// Explicit sampling applies even on hover and zoom, and goes through the same admission checks.
import { kindAvailability } from '../multichart.js';
import * as echarts from 'echarts/core';
import { LineChart, ScatterChart, BarChart, PieChart } from 'echarts/charts';
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([LineChart, ScatterChart, BarChart, PieChart, GridComponent, LegendComponent, TooltipComponent, AriaComponent, CanvasRenderer]);

const config = 'modular tree-shaken (Canvas, ARIA, tooltip, legend, animation: false)';
function samplingFor(params) {
  const sampling = params?.sampling ?? 'none';
  if (!['none', 'lttb', 'minmax'].includes(sampling)) throw new Error(`Unknown ECharts sampling: ${sampling}`);
  return sampling;
}

// The line view visits processed rows in order. Adjacent duplicate vertices have
// zero length. A backwards jump must survive the encoding so admission can reject it.
export function echartsDrawnPaths(data, connectNulls = false) {
  const paths = [];
  let path = null;
  for (let i = 0; i < data.count(); i++) {
    if (!Number.isFinite(data.get('y', i))) {
      if (!connectNulls) path = null;
      continue;
    }
    const index = data.getRawIndex(i);
    if (!path) {
      path = [index, index];
      paths.push(path);
    } else {
      const end = path.length - 1;
      if (index === path[end] + 1) path[end] = index;
      else if (index !== path[end]) path.push(index, index);
    }
  }
  return { kind: 'indices', paths };
}

function seriesData(x, y, rolling) {
  if (rolling) return Array.from(x, (v, i) => [v, y[i]]);
  const data = new Float64Array(2 * x.length);
  for (let i = 0; i < x.length; i++) {
    data[2 * i] = x[i];
    data[2 * i + 1] = y[i];
  }
  return data;
}

function heldSeries(series) {
  const raw = series.getRawData();
  const points = raw.count();
  let missing = 0;
  for (let i = 0; i < points; i++) if (!Number.isFinite(raw.get('y', i))) missing++;
  return {
    points, missing, oldestX: raw.get('x', 0), newestX: raw.get('x', points - 1),
    drawn: series.subType === 'scatter' ? { kind: 'points' } : echartsDrawnPaths(series.getData(), series.get('connectNulls')),
  };
}

function scatterCenters(chart, data) {
  // The harness records arc arguments before the Canvas transform. ZRender paints
  // each circle around its local origin, so read the painted path and its transform.
  const displayed = new Set(chart.getZr().storage.getDisplayList());
  const centers = [];
  for (let i = 0; i < data.count(); i++) {
    const path = data.getItemGraphicEl(i)?.getSymbolPath();
    if (!displayed.has(path) || !path.__isRendered || path.shape.symbolType !== 'circle') continue;
    const { x, y, width, height } = path.shape;
    centers.push(...path.transformCoordToGlobal(x + width / 2, y + height / 2));
  }
  return centers;
}

function create(el, fix, opts = {}) {
  const kind = fix.kind ?? opts.kind ?? 'line';
  const scatter = kind === 'scatter', bar = kind === 'bar', donut = kind === 'donut', area = kind === 'area';
  const itemHover = (scatter && !!fix.kind) || donut;
  const compact = !!opts.compact;
  const sampling = samplingFor(opts.params);
  let series;
  if (donut) {
    series = [{ type: 'pie', radius: ['50%', '75%'],
      data: Array.from(fix.values, (value, i) => ({ name: fix.labels[i], value })) }];
  } else if (bar) {
    series = fix.ys.map((y, i) => ({ type: 'bar', name: fix.names[i], data: Array.from(y) }));
  } else {
    const marks = scatter ? { type: 'scatter', symbol: 'circle', symbolSize: 4, large: false }
      : { type: 'line', sampling, showSymbol: false, connectNulls: false, ...(area ? { areaStyle: { opacity: 0.25 } } : {}) };
    series = fix.ys.map((y, i) => ({
      ...marks, name: fix.names[i], dimensions: ['x', 'y'], encode: { x: 'x', y: 'y', tooltip: 'y' },
      data: seriesData(fix.x, y, opts.window),
    }));
  }
  const host = el.appendChild(document.createElement('div'));
  host.style.cssText = 'width:100%;height:100%';
  const chart = echarts.init(host, null, { renderer: 'canvas', width: el.clientWidth || undefined, height: el.clientHeight || undefined });
  const grid = () => chart.getModel().getComponent('grid').coordinateSystem.getRect();
  const extent = dim => chart.getModel().getComponent(dim + 'Axis').axis.scale.getExtent();
  let pending = true, drawnNewest = NaN, hovered = NaN;
  const waiters = [];
  // setOption can paint synchronously. 'finished' also waits for the last progressive scatter batch.
  chart.on('finished', () => {
    pending = false;
    for (const resolve of waiters.splice(0)) resolve();
  });
  if (!bar && !donut) chart.getZr().on('rendered', () => {
    const data = chart.getModel().getSeriesByIndex(0).getData();
    drawnNewest = data.get('x', data.count() - 1);
  });
  if (itemHover && opts.hover) {
    chart.on('mousemove', 'series', event => { hovered = event.dataIndex; });
    chart.on('mouseout', 'series', () => { hovered = NaN; });
  } else if (opts.hover) chart.on('updateAxisPointer', event => { hovered = event.dataIndex ?? NaN; });
  chart.setOption({
    animation: false, useUTC: true, aria: { enabled: true },
    ...(!donut && {
      grid: compact ? { left: 0, right: 0, top: 2, bottom: 2, containLabel: false }
        : { left: 56, right: 16, top: 36, bottom: 32, containLabel: false },
      xAxis: bar ? { type: 'category', data: fix.categories, show: !compact }
        : scatter ? { type: 'value', scale: true } : { type: 'time', min: 'dataMin', max: 'dataMax', show: !compact },
      yAxis: { type: 'value', scale: !bar && !area, show: !compact },
    }),
    legend: { show: !compact },
    tooltip: itemHover ? { trigger: 'item', transitionDuration: 0, renderMode: 'html', className: 'bench-echarts-tooltip',
      formatter: item => donut ? item.name + ': ' + item.value : item.seriesName + ': ' + item.value[1] }
      : scatter ? { trigger: 'item', transitionDuration: 0 } : {
      show: !compact, trigger: 'axis', transitionDuration: 0, renderMode: 'html',
      className: 'bench-echarts-tooltip', valueFormatter: String,
    },
    series,
  });

  let desc;
  if (compact) {
    desc = el.appendChild(document.createElement('span'));
    desc.id = chart.id + '-description';
    desc.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';
    desc.textContent = host.getAttribute('aria-label');
    host.setAttribute('aria-describedby', desc.id);
    host.setAttribute('aria-label', fix.title ?? 'Benchmark');
  }

  let observer;
  function resize() {
    const width = el.clientWidth, height = el.clientHeight;
    if (width === chart.getWidth() && height === chart.getHeight()) return;
    pending = true;
    chart.resize({ width, height });
  }
  if (opts.resize) {
    observer = new ResizeObserver(resize);
    observer.observe(el);
  }

  return {
    get ready() {
      if (observer) resize(); // the layout may have changed before the observer's delivery
      return pending ? new Promise(resolve => waiters.push(resolve)) : Promise.resolve();
    },
    append(x, ys) {
      const updates = series.map(({ data }, i) => {
        data.push([x, ys[i]]);
        if (data.length > opts.window) data.shift();
        return { data };
      });
      pending = true;
      chart.setOption({ series: updates });
    },
    drawnNewestX: () => drawnNewest,
    zoom(lo, hi) {
      pending = true;
      chart.setOption({ xAxis: { min: lo, max: hi } });
    },
    hoverTarget: () => host,
    hoverGeometry() {
      const origin = host.getBoundingClientRect();
      if (donut) {
        const data = chart.getModel().getSeriesByIndex(0).getData();
        const marks = Array.from({ length: data.count() }, (_, i) => {
          const { cx, cy, r, r0, startAngle, endAngle } = data.getItemLayout(i);
          const a = (startAngle + endAngle) / 2;
          return [origin.left + cx + Math.cos(a) * (r + r0) / 2, origin.top + cy + Math.sin(a) * (r + r0) / 2];
        });
        return { plot: { left: origin.left, top: origin.top, width: chart.getWidth(), height: chart.getHeight() }, marks };
      }
      const { x, y, width, height } = grid();
      const { left, top } = host.getBoundingClientRect();
      const plot = { left: left + x, top: top + y, width, height };
      if (bar) {
        const data = chart.getModel().getSeriesByIndex(0).getData();
        return { plot, marks: Array.from({ length: data.count() }, (_, i) => {
          const r = data.getItemLayout(i);
          return [left + r.x + r.width / 2, top + r.y + r.height / 2];
        }) };
      }
      return { plot, xDomain: extent('x'), ...(scatter ? { yDomain: extent('y') } : {}) };
    },
    hoveredIndex: () => hovered,
    readoutShows(i) {
      const tooltip = host.querySelector('.bench-echarts-tooltip');
      if (!tooltip || !Number.isInteger(i) || i < 0 || i >= (fix.x ?? fix.categories ?? fix.labels).length) return false;
      const style = getComputedStyle(tooltip);
      if (style.opacity === '0' || style.display === 'none' || style.visibility === 'hidden') return false;
      if (itemHover) {
        const want = donut ? fix.labels[i] + ': ' + fix.values[i] : fix.names[0] + ': ' + fix.ys[0][i];
        return tooltip.textContent.trim() === want;
      }
      // ECharts emits sibling spans for the series name and its value in each tooltip row.
      return Array.from(tooltip.querySelectorAll('span')).some(span =>
        span.textContent === fix.names[0] && span.nextElementSibling?.textContent === String(fix.ys[0][i]));
    },
    describe({ probe } = {}) {
      const model = chart.getModel();
      if (bar || donut) {
        const displayed = new Set(chart.getZr().storage.getDisplayList());
        const items = s => {
          const data = s.getData();
          return Array.from({ length: data.count() }, (_, i) => {
            const mark = data.getItemGraphicEl(i);
            if (!mark?.__isRendered || !displayed.has(mark)) return null;
            const shape = mark.shape;
            if (donut) return { label: data.getName(i), value: data.get('value', i), cx: shape.cx, cy: shape.cy, startAngle: shape.startAngle,
              sweep: Math.abs(shape.endAngle - shape.startAngle), innerRadius: shape.r0, outerRadius: shape.r };
            return { x: shape.x, y: Math.min(shape.y, shape.y + shape.height), width: shape.width, height: Math.abs(shape.height) };
          });
        };
        if (donut) return { kind, plot: { x: 0, y: 0, width: chart.getWidth(), height: chart.getHeight() }, slices: items(model.getSeriesByIndex(0)) };
        const { x, y, width, height } = grid();
        return { kind, y: extent('y'), plot: { x, y, width, height }, rectangles: model.getSeries().map(items) };
      }
      const seen = { ...(fix.kind ? { kind } : {}), reads: 'ECharts axis scales, raw SeriesData and processed line indices', x: extent('x'), y: extent('y'),
        series: model.getSeries().map(heldSeries) };
      if (area) seen.areaFills = chart.getZr().storage.getDisplayList().filter(p =>
        p.type === 'ec-polygon' && p.__isRendered && p.shape.points.length >= 4 && p.style.fill && p.style.opacity > 0).length;
      if (scatter && probe === 'geometry') {
        const { x, y, width, height } = grid();
        seen.drawnPoints = { plot: { x, y, width, height }, centers: scatterCenters(chart, model.getSeriesByIndex(0).getData()) };
      }
      return seen;
    },
    destroy() {
      observer?.disconnect();
      chart.dispose();
      host.remove();
      desc?.remove();
    },
  };
}

export default {
  id: 'echarts', library: 'Apache ECharts', version: __VERSIONS__.echarts, config,
  configFor: params => `${config}; line sampling: ${samplingFor(params)} (default none preserves endpoints, gaps, visible extrema and exact hover candidates)`,
  available: (workload, params) => kindAvailability('ECharts', workload, params) ?? (workload === 'theme'
    ? { ok: false, reason: 'no CSS-class dark-theme reactivity configured for ECharts in this harness' }
    : { ok: true }),
  create,
};
