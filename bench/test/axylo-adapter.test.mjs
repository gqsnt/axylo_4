// Pure tests: the Axylo adapters select their renderer explicitly (review finding 9), read the renderer back from
// the committed chart's elements, and never scan the held frame through describe() inside a measured window
// (finding 8). Axylo itself is replaced by a spy that records the options it is called with.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

let canvas, svg, generic, rendererIn, parsePolylines, keptPaths, circleCenters;
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
  ({ rendererIn, parsePolylines, keptPaths, circleCenters } = await import('../src/adapters/axylo-common.js'));
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

test('the generic adapter follows the public default unless a renderer is named; the fixed ones always name theirs', () => {
  // Budget paths (P1-P8) measure the library as users get it: no __renderer, the renderer read back afterwards.
  calls.length = 0;
  generic.create(fakeEl(0, 0), fix, { params: {} });
  generic.create(fakeEl(0, 0), fix, { params: { renderer: 'svg' } });
  generic.create(fakeEl(0, 0), fix, { params: { renderer: 'svg' }, kind: 'scatter' });
  assert.equal(Object.hasOwn(calls[0].opts, '__renderer'), false);
  assert.deepEqual(calls.slice(1).map(c => [c.type, c.opts.__renderer]), [['line', 'svg'], ['scatter', 'svg']]);
  assert.equal(generic.expectRendererFor({}), null);
  assert.equal(canvas.expectRendererFor({}), 'canvas');
  assert.equal(svg.expectRendererFor({ renderer: 'canvas' }), 'svg'); // the fixed id wins over a parameter
  assert.equal(generic.expectRendererFor({ renderer: 'svg' }), 'svg');
  assert.throws(() => generic.create(fakeEl(0, 0), fix, { params: { renderer: 'webgl' } }), /renderer must be canvas or svg/);
});

test('the library\'s renderer report and the mark elements must agree', () => {
  assert.equal(rendererIn(fakeEl(0, 1), 'svg').kind, 'svg');
  assert.equal(rendererIn(fakeEl(0, 1), 'canvas').kind, 'inconsistent');
});

test('kept indexes and run starts become index paths; the readback uses the library\'s kept selection', () => {
  // kept 0,1,2,5,6 with a new run starting at offset 3 (index 5): two runs, [0..2] and [5..6].
  assert.deepEqual(keptPaths([0, 1, 2, 5, 6], [3]), [[0, 2], [5, 6]]);
  // Without the break the same kept list is one run: 2 joined to 5 (a bridge if 3..4 are missing).
  assert.deepEqual(keptPaths([0, 1, 2, 5, 6], []), [[0, 2, 5, 6]]);
  assert.deepEqual(keptPaths([3, 3, 4], []), [[3, 4]]);
});

test('scatter marker centres are read from SVG circle paths', () => {
  assert.deepEqual(circleCenters('M12 5 A2 2 0 1 1 8 5 A2 2 0 1 1 12 5ZM22.5 7 A2 2 0 1 1 18.5 7 A2 2 0 1 1 22.5 7Z'), [10, 5, 20.5, 7]);
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
