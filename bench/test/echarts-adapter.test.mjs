import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getInstanceByDom } from 'echarts/core';
import { libraryVersions } from '../build.mjs';
import { checkView } from '../src/admission.js';
import { expectedView, heldColumns, lineFixture, scatterFixture, streamFixture, trendFixture, zoomSteps } from '../src/fixtures.js';

const installed = JSON.parse(readFileSync(new URL('../node_modules/echarts/package.json', import.meta.url))).version;
let adapter, echartsDrawnPaths;
before(async () => {
  globalThis.__VERSIONS__ = libraryVersions();
  ({ default: adapter, echartsDrawnPaths } = await import('../src/adapters/echarts.js'));
});

// Only the drawing surface is stubbed. ECharts performs layout, sampling, tooltip selection,
// progressive rendering and draw notifications through its normal Canvas entry point.
function element(tag) {
  const attrs = new Map();
  const children = [];
  return {
    nodeName: tag.toUpperCase(), style: {}, children,
    get firstChild() { return children[0]; },
    get childElementCount() { return children.length; },
    appendChild(child) { return this.insertBefore(child, null); },
    insertBefore(child, before) {
      const pos = children.indexOf(before);
      children.splice(pos < 0 ? children.length : pos, 0, child);
      child.parentNode = this;
      return child;
    },
    remove() { this.parentNode.removeChild(this); },
    removeChild(child) { children.splice(children.indexOf(child), 1); child.parentNode = null; },
    setAttribute(key, value) { attrs.set(key, value); },
    getAttribute(key) { return attrs.get(key) ?? null; },
    getBoundingClientRect() { return { left: 8, top: 8 }; },
  };
}

function surface(tag) {
  const el = element(tag);
  if (tag === 'canvas') {
    const ctx = { canvas: el, measureText: s => ({ width: String(s).length * 7 }) };
    for (const op of ['save', 'restore', 'setTransform', 'clearRect', 'fillRect', 'beginPath', 'closePath',
      'moveTo', 'lineTo', 'rect', 'arc', 'clip', 'fill', 'stroke', 'setLineDash', 'fillText', 'strokeText']) ctx[op] = () => {};
    el.getContext = () => ctx;
  }
  return el;
}

function mount(t, fix, opts = {}, width = 800) {
  globalThis.document = { createElement: surface };
  const el = Object.assign(element('div'), { clientWidth: width, clientHeight: 400 });
  const handle = adapter.create(el, fix, opts);
  const chart = getInstanceByDom(el.firstChild);
  t.after(() => {
    handle.destroy();
    assert.ok(chart.isDisposed());
    assert.equal(el.childElementCount, 0);
  });
  return { el, chart, handle };
}

function admission(handle, fix, window) {
  return checkView(expectedView(fix, window), handle.describe({ probe: 'geometry' }), { columns: heldColumns(fix), requireDrawn: true });
}

function assertAdmitted(handle, fix, window) {
  const { admitted, reasons, limits } = admission(handle, fix, window);
  assert.ok(admitted, reasons.join('\n'));
  assert.deepEqual(limits, []);
}

test('installed version and configuration are reported in benchmark metadata', () => {
  assert.equal(libraryVersions().echarts, installed);
  assert.equal(adapter.version, installed);
  assert.equal(adapter.id, 'echarts');
  assert.equal(adapter.library, 'Apache ECharts');
  assert.equal(adapter.config, 'modular tree-shaken (Canvas, ARIA, tooltip, legend, animation: false)');
  assert.match(adapter.configFor(), /line sampling: none/);
  for (const sampling of ['lttb', 'minmax', 'none']) assert.ok(adapter.configFor({ sampling }).includes(`line sampling: ${sampling}`));
  assert.throws(() => adapter.configFor({ sampling: 'minimum' }), /Unknown ECharts sampling/);
  for (const w of ['first', 'page', 'compact', 'scatter', 'hover', 'zoom', 'stream', 'resize', 'lifecycle', 'mem']) {
    assert.deepEqual(adapter.available(w), { ok: true });
  }
  assert.deepEqual(adapter.available('theme'), { ok: false, reason: 'no CSS-class dark-theme reactivity configured for ECharts in this harness' });
});

test('processed row indices encode runs, NaN breaks, skipped rows and drawing order', () => {
  const paths = (indices, ys, connectNulls) => echartsDrawnPaths({
    count: () => indices.length, getRawIndex: k => indices[k], get: (dim, k) => { assert.equal(dim, 'y'); return ys[k]; },
  }, connectNulls);
  assert.deepEqual(paths([0, 1, 2], [1, 2, 3]), { kind: 'indices', paths: [[0, 2]] });
  assert.deepEqual(paths([0, 1, 2, 3, 4], [NaN, 3, NaN, 2, NaN]), { kind: 'indices', paths: [[1, 1], [3, 3]] });
  assert.deepEqual(paths([1, 2, 3], [3, NaN, 2], true), { kind: 'indices', paths: [[1, 1, 3, 3]] });
  assert.deepEqual(paths([0, 4, 5, 8], [5, 1, 9, 3]), { kind: 'indices', paths: [[0, 0, 4, 5, 8, 8]] });
  assert.deepEqual(paths([5, 5, 3, 4], [8, 8, 1, 2]), { kind: 'indices', paths: [[5, 5, 3, 4]] });
});

test('trend keeps the seven missing observations and compact exposes the generated ARIA description', async t => {
  const fix = trendFixture();
  const { el, handle } = mount(t, fix, { compact: true });
  await handle.ready;
  assertAdmitted(handle, fix);
  assert.deepEqual(handle.describe().series[2].drawn.paths, [[0, 59], [67, 119]]);
  const [host, desc] = el.children;
  assert.equal(host.getAttribute('role'), 'img');
  assert.equal(host.getAttribute('aria-label'), fix.title);
  assert.equal(host.getAttribute('aria-describedby'), desc.id);
  assert.ok(desc.textContent.includes('Referral'));
});

test('100k default passes first, zoom, resize and hover model admission', { timeout: 10000 }, async t => {
  const fix = lineFixture({ series: 1, points: 100000 });
  let disconnected = false;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() { disconnected = true; }
  };
  const { el, chart, handle } = mount(t, fix, { resize: true, hover: true });
  t.after(() => assert.ok(disconnected));
  await handle.ready;
  assertAdmitted(handle, fix);
  assert.deepEqual(handle.describe().series[0].drawn.paths, [[0, 99999]]);
  const { plot, xDomain } = handle.hoverGeometry();
  assert.deepEqual(xDomain, [fix.x[0], fix.x.at(-1)]);
  const idx = 54321;
  chart.dispatchAction({ type: 'updateAxisPointer', x: plot.left - 8 + plot.width * idx / (fix.x.length - 1), y: 180 });
  assert.equal(handle.hoveredIndex(), idx);
  const row = chart.getModel().getSeriesByIndex(0).formatTooltip(idx, true).blocks[0];
  const formatter = chart.getModel().getComponent('tooltip').get('valueFormatter');
  assert.equal(row.name, fix.names[0]);
  assert.equal(formatter(row.value), String(fix.ys[0][idx]));

  for (const width of [400, 1200]) {
    el.clientWidth = width;
    await handle.ready;
    assert.equal(chart.getWidth(), width);
    assertAdmitted(handle, fix);
  }
  const steps = zoomSteps(fix);
  for (const k of [9, 29, 49, 59]) {
    handle.zoom(...steps[k]);
    await handle.ready;
    assert.deepEqual(handle.describe().x, steps[k]);
  }
  assertAdmitted(handle, fix, steps.at(-1));
});

test('hover readback requires an exact value in the visible series-zero tooltip row', async t => {
  const fix = trendFixture();
  const { el, handle } = mount(t, fix, { hover: true });
  await handle.ready;
  const value = String(fix.ys[0][0]);
  const row = { textContent: fix.names[0], nextElementSibling: { textContent: value } };
  const style = { display: 'block', opacity: '1', visibility: 'visible' };
  const tooltip = { querySelectorAll: () => [row] };
  el.firstChild.querySelector = selector => selector === '.bench-echarts-tooltip' ? tooltip : null;
  globalThis.getComputedStyle = () => style;
  assert.ok(handle.readoutShows(0));
  for (const [key, hidden] of [['opacity', '0'], ['display', 'none'], ['visibility', 'hidden']]) {
    const visible = style[key];
    style[key] = hidden;
    assert.equal(handle.readoutShows(0), false);
    style[key] = visible;
  }
  row.nextElementSibling.textContent = value + '0';
  assert.equal(handle.readoutShows(0), false);
  row.nextElementSibling.textContent = value;
  row.textContent = fix.names[1];
  assert.equal(handle.readoutShows(0), false);
});

test('both optional ECharts samplers face the full 100k admission checks', async t => {
  const fix = lineFixture({ series: 1, points: 100000 });
  const { handle: lttb } = mount(t, fix, { params: { sampling: 'lttb' } }, 400);
  await lttb.ready;
  const { handle: minmax } = mount(t, fix, { params: { sampling: 'minmax' } }, 800);
  await minmax.ready;
  const triangle = admission(lttb, fix);
  assert.equal(triangle.admitted, false);
  assert.match(triangle.reasons.join('\n'), /drawn extremes/);
  const buckets = admission(minmax, fix);
  assert.equal(buckets.admitted, false);
  assert.match(buckets.reasons.join('\n'), /do not cover the visible data/);
  assert.ok(!buckets.reasons.some(reason => reason.includes('drawn extremes')));
});

test('stream acknowledges each paint and retains the rolling window', async t => {
  const fix = streamFixture({ window: 30, samples: 5 });
  const { handle } = mount(t, { ...fix.initial, names: fix.names }, { window: fix.window });
  await handle.ready;
  assert.equal(handle.drawnNewestX(), fix.initial.x.at(-1));
  for (let i = 0; i < fix.samples; i++) {
    handle.append(fix.stream.x[i], [fix.stream.y[i]]);
    await handle.ready;
    assert.equal(handle.drawnNewestX(), fix.stream.x[i]);
  }
  assertAdmitted(handle, fix);
});

test('scatter admission uses transformed centers of actually painted circle symbols', { timeout: 10000 }, async t => {
  const fix = scatterFixture({ points: 5000 });
  const { chart, handle } = mount(t, fix, { kind: 'scatter' });
  await handle.ready;
  assert.equal(handle.describe().drawnPoints, undefined);
  assertAdmitted(handle, fix);
  const data = chart.getModel().getSeriesByIndex(0).getData();
  const path = data.getItemGraphicEl(0).getSymbolPath();
  path.ignore = true;
  chart.getZr().refreshImmediately();
  const result = admission(handle, fix);
  assert.equal(result.admitted, false);
  assert.match(result.reasons.join('\n'), /point markers drawn/);
});
