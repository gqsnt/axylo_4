// Pure tests: the Axylo adapters select their renderer explicitly (review finding 9), read the renderer back from
// the committed chart's elements, and never scan the held frame through describe() inside a measured window
// (finding 8). Axylo itself is replaced by a spy that records the options it is called with.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

let canvas, svg, generic, rendererIn, parsePolylines;
const calls = [];
let describeCalls = 0;
const fakeChart = () => {
  const listeners = {};
  return {
    __bench: { revision: 1, ready: () => Promise.resolve(), describe: () => { describeCalls++; return { xDomain: [0, 1], yDomain: [0, 1], series: [] }; } },
    on: (e, f) => { listeners[e] = f; return () => {}; },
    append: () => {}, zoom: () => {}, destroy: () => {},
  };
};
const fakeEl = (canvases, svgs) => ({
  querySelectorAll: sel => (sel === '.axylo-canvas canvas' ? Array(canvases).fill({}) : sel === 'svg.axylo-svg' ? Array(svgs).fill({}) : []),
  querySelector: () => null,
});

before(async () => {
  globalThis.__VERSIONS__ = { axylo: 'spy' };
  globalThis.Axylo = {
    line: (el, opts) => { calls.push({ type: 'line', opts }); return fakeChart(); },
    scatter: (el, opts) => { calls.push({ type: 'scatter', opts }); return fakeChart(); },
  };
  canvas = (await import('../src/adapters/axylo-canvas.js')).default;
  svg = (await import('../src/adapters/axylo-svg.js')).default;
  generic = (await import('../src/adapters/axylo.js')).default;
  ({ rendererIn, parsePolylines } = await import('../src/adapters/axylo-common.js'));
});

const fix = { x: Float64Array.from([1, 2, 3]), ys: [Float64Array.from([4, 5, 6])], names: ['s0'] };

test('both fixed adapters pass __renderer explicitly, canvas included', () => {
  calls.length = 0;
  canvas.create(fakeEl(0, 0), fix, {});
  svg.create(fakeEl(0, 0), fix, {});
  assert.equal(calls[0].opts.__renderer, 'canvas');
  assert.equal(calls[1].opts.__renderer, 'svg');
  assert.ok(Object.hasOwn(calls[0].opts, '__renderer'), 'canvas must not rely on the library default');
});

test('the parameterized adapter passes its renderer explicitly too, default canvas', () => {
  calls.length = 0;
  generic.create(fakeEl(0, 0), fix, { params: {} });
  generic.create(fakeEl(0, 0), fix, { params: { renderer: 'svg' } });
  generic.create(fakeEl(0, 0), fix, { params: { renderer: 'svg' }, kind: 'scatter' });
  assert.deepEqual(calls.map(c => [c.type, c.opts.__renderer]), [['line', 'canvas'], ['line', 'svg'], ['scatter', 'svg']]);
  assert.equal(canvas.expectRendererFor({}), 'canvas');
  assert.equal(svg.expectRendererFor({ renderer: 'canvas' }), 'svg'); // the fixed id wins over a parameter
  assert.equal(generic.expectRendererFor({ renderer: 'svg' }), 'svg');
  assert.throws(() => generic.create(fakeEl(0, 0), fix, { params: { renderer: 'webgl' } }), /renderer must be canvas or svg/);
});

test('compact charts pass compact: true; other options stay default', () => {
  calls.length = 0;
  canvas.create(fakeEl(0, 0), fix, { compact: true });
  assert.equal(calls[0].opts.compact, true);
  assert.deepEqual(Object.keys(calls[0].opts).sort(), ['__renderer', 'compact', 'data', 'title', 'x', 'y']);
});

test('renderer readback comes from the elements in the committed chart', () => {
  assert.deepEqual(rendererIn(fakeEl(2, 0)), { kind: 'canvas', canvases: 2, svgs: 0 });
  assert.deepEqual(rendererIn(fakeEl(0, 1)), { kind: 'svg', canvases: 0, svgs: 1 });
  assert.deepEqual(rendererIn(fakeEl(2, 1)), { kind: 'mixed', canvases: 2, svgs: 1 });
  assert.deepEqual(rendererIn(fakeEl(0, 0)), { kind: 'none', canvases: 0, svgs: 0 });
  const h = svg.create(fakeEl(0, 1), fix, {});
  assert.equal(h.describe().renderer.kind, 'svg');
});

test('no describe() scan during create or streaming; the draw record is constant time', async () => {
  describeCalls = 0;
  const h = canvas.create(fakeEl(2, 0), fix, {});
  await h.ready;
  await new Promise(r => setTimeout(r, 0));
  assert.equal(describeCalls, 0, 'create');
  const s = canvas.create(fakeEl(2, 0), fix, { window: 3 });
  await s.ready;
  await new Promise(r => setTimeout(r, 0));
  assert.equal(s.drawnNewestX(), 3);
  s.append(4, [7]);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(s.drawnNewestX(), 4);
  assert.equal(describeCalls, 0, 'stream');
});

test('SVG path data parses to polylines; arcs and curves are not taken for line marks', () => {
  assert.deepEqual(parsePolylines('M1 2L3 4L5.5 -6M7 8L9 10'), [[1, 2, 3, 4, 5.5, -6], [7, 8, 9, 10]]);
  assert.equal(parsePolylines('M1 2A3 3 0 1 1 4 5Z'), null);
  assert.equal(parsePolylines(''), null);
});
