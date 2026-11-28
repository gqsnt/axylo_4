import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { circleCenters, circleSpelling } from '../src/adapters/axylo-common.js';
import { checkScatterPoints } from '../src/admission.js';

// Plot 400 x 200 at (0, 0) over x [0, 400] and y [0, 200]: a datum (x, y) maps to (x, 200 - y) px.
const plot = { x: 0, y: 0, width: 400, height: 200 };
const X = [0, 400], Y = [0, 200];
const AXYLO = { radius: 3, precision: 'float32' };

// The real SVG circle encoder: sparse marks use absolute arcs to hundredths, dense marks (>= 2,000) relative arcs to tenths.
async function circlePathOf() {
  const repo = new URL('../../', import.meta.url).pathname;
  const { outputFiles } = await build({ stdin: { contents: "export {svgPoints} from './packages/axylo/src/render/svg.ts'", resolveDir: repo },
    bundle: true, format: 'esm', write: false, define: { __DEV__: 'true', __BENCH__: 'true' } });
  const { svgPoints } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'));
  return xy => {
    const attrs = {};
    const el = { setAttribute: (k, v) => { attrs[k] = String(v); }, getAttribute: k => attrs[k] ?? null, removeAttribute: k => { delete attrs[k]; },
      style: { setProperty() {}, removeProperty() {} } };
    svgPoints({}, { key: 'p', el, attrs: null, styles: null, source: null }, { type: 'points', xy, shape: 'circle', size: 6, fill: { kind: 'none' } }, { series: [], tokens: {} });
    return attrs.d;
  };
}

test('circleCenters reads the same centres from sparse absolute and dense relative circle paths of the encoder', async () => {
  const circlePath = await circlePathOf();
  const sparse = Float32Array.from([10, 5, 20.5, 7.25, -4, 3]);
  const sparseD = circlePath(sparse);
  assert.match(sparseD, /A/);
  assert.doesNotMatch(sparseD, /a/);
  assert.deepEqual(circleCenters(sparseD), [10, 5, 20.5, 7.25, -4, 3]);
  const dense = new Float32Array(2 * 2500);
  for (let i = 0; i < 2500; i++) { dense[2 * i] = 10 + (i % 50) * 1.3; dense[2 * i + 1] = 5 + Math.floor(i / 50) * 0.7; }
  const denseD = circlePath(dense);
  assert.match(denseD, /^M\S+ \S+a3 3 0 11-6 0a3 3 0 116 0M/, 'compact relative producer syntax');
  assert.doesNotMatch(denseD, /A/);
  const read = circleCenters(denseD);
  assert.equal(read.length, dense.length);
  // Dense centres are serialised to tenths.
  for (let i = 0; i < dense.length; i++) assert.ok(Math.abs(read[i] - dense[i]) <= 0.05 + 1e-6, `coordinate ${i}: ${read[i]} vs ${dense[i]}`);
  // Hand-written spellings: both arc cases, signs, and the same centres.
  assert.deepEqual(circleCenters('M13 5a3 3 0 11-6 0a3 3 0 116 0M23.5 7.2a3 3 0 11-6 0a3 3 0 116 0M-1.5 -2a3 3 0 11-6 0a3 3 0 116 0'), [10, 5, 20.5, 7.2, -4.5, -2]);
  assert.deepEqual(circleCenters('M13 5 A3 3 0 1 1 7 5 A3 3 0 1 1 13 5ZM23.5 7.2 A3 3 0 1 1 17.5 7.2 A3 3 0 1 1 23.5 7.2Z'), [10, 5, 20.5, 7.2]);
});

// A 60 x 50 unit lattice of data at (100.3 + i, 50.3 + j) px, plus four drawn anchors that set the bounds; the
// injected extreme is the lattice's first point. Dropped lattice points (odd i and j, at least 5 px inside) have
// every tile of their 7 x 7 block inside one retained neighbour's disk, but none coincides with a drawn centre.
function lattice(extra = []) {
  const px = [], py = [];
  for (let j = 0; j < 50; j++) for (let i = 0; i < 60; i++) { px.push(100.3 + i); py.push(50.3 + j); }
  for (const [a, b] of [[20.3, 10.3], [380.3, 190.3], [20.3, 190.3], [380.3, 10.3], ...extra]) { px.push(a); py.push(b); }
  const x = Float64Array.from(px), y = Float64Array.from(py, v => 200 - v);
  const droppable = k => {
    if (k >= 3000) return false;
    const i = k % 60, j = Math.floor(k / 60);
    return i % 2 === 1 && j % 2 === 1 && i >= 5 && i < 55 && j >= 5 && j < 45;
  };
  return { x, y, px, py, droppable, extreme: { x: x[0], y: y[0], injected: true } };
}
const centersOf = (d, drop) => {
  const c = [];
  // As the scene stores them: Float32 of origin + fraction * extent, y from the plot bottom up.
  for (let k = 0; k < d.px.length; k++) if (!drop(k)) c.push(Math.fround(d.x[k] / 400 * 400), Math.fround(200 - d.y[k] / 200 * 200));
  return c;
};

test('dense Axylo scatter: a reduction whose dropped points lie under drawn disks is admitted', () => {
  const d = lattice();
  const centers = centersOf(d, d.droppable);
  const dropped = d.px.length - centers.length / 2;
  assert.ok(d.px.length >= 2000 && dropped > 300, `${dropped} dropped of ${d.px.length}`);
  assert.deepEqual(checkScatterPoints(d.x, d.y, { plot, centers, cover: AXYLO }, X, Y, d.extreme, 's'), []);
});

test('dense Axylo scatter: the real dense SVG encoding of the reduction is admitted through the adapter parse', async () => {
  const d = lattice();
  const xy = Float32Array.from(centersOf(d, d.droppable));
  const path = (await circlePathOf())(xy);
  assert.equal(circleSpelling(path), 10);
  const centers = circleCenters(path);
  assert.deepEqual(checkScatterPoints(d.x, d.y, { plot, centers, cover: { radius: 3, precision: 10 } }, X, Y, d.extreme, 's'), []);
  // The same tenths read as raw Float32 identities do not match the data.
  assert.notDeepEqual(checkScatterPoints(d.x, d.y, { plot, centers, cover: AXYLO }, X, Y, d.extreme, 's'), []);
});

test('dense Axylo scatter: near but distinct raw and SVG positions, wrong radius and malformed evidence are rejected', async () => {
  const d = lattice();
  const centers = centersOf(d, d.droppable);
  const lost = 60 * 20 + 21; // a droppable lattice point, shifted off its drawn neighbours' identity
  const moved = centers.slice();
  const at = centersOf(d, k => d.droppable(k) || k >= lost).length;
  moved[at] = Math.fround(moved[at] + 0.01);
  assert.match(checkScatterPoints(d.x, d.y, { plot, centers: moved, cover: AXYLO }, X, Y, d.extreme, 's').join('|'), /markers drawn where no visible point maps/);
  const hundredths = centers.map(v => Math.round((v + 3) * 100) / 100 - 3);
  assert.deepEqual(checkScatterPoints(d.x, d.y, { plot, centers: hundredths, cover: { radius: 3, precision: 100 } }, X, Y, d.extreme, 's'), []);
  hundredths[at] += 0.01;
  assert.match(checkScatterPoints(d.x, d.y, { plot, centers: hundredths, cover: { radius: 3, precision: 100 } }, X, Y, d.extreme, 's').join('|'), /markers drawn where no visible point maps/);
  for (const cover of [{ radius: 20, precision: 'float32' }, { radius: 3 }, { radius: 3, precision: 1 }])
    assert.match(checkScatterPoints(d.x, d.y, { plot, centers, cover }, X, Y, d.extreme, 's').join('|'), /no (radius-three|rendered centre precision)/);
  assert.match(checkScatterPoints(d.x, d.y, { plot, centers: [...centers, 5], cover: AXYLO }, X, Y, d.extreme, 's').join('|'), /malformed centre pairs/);
  assert.match(checkScatterPoints(d.x, d.y, { plot, centers: [...centers, Infinity, 5], cover: AXYLO }, X, Y, d.extreme, 's').join('|'), /non-finite drawn centre/);
  assert.equal(circleSpelling('M13 5a4 4 0 11-8 0a4 4 0 118 0'), null);
  assert.equal(circleSpelling('M13 5a3 3 0 11-6 0a3 3 0 116 0M1'), null);
  assert.equal(circleSpelling('M13 5A3 3 0 1 1 7 5A3 3 0 1 1 13 5Z'), 100);
});

test('dense Axylo scatter: 16,000 coincident retained markers are checked in bounded time', () => {
  const d = lattice();
  const centers = centersOf(d, d.droppable);
  const n = 16000, x = Float64Array.from({ length: d.x.length + n }, (_, i) => i < d.x.length ? d.x[i] : 30.3);
  const y = Float64Array.from({ length: x.length }, (_, i) => i < d.x.length ? d.y[i] : 100.3);
  const all = centers.concat(Array.from({ length: 2 * n }, (_, i) => i % 2 ? Math.fround(200 - 100.3) : Math.fround(30.3)));
  const t = performance.now();
  assert.deepEqual(checkScatterPoints(x, y, { plot, centers: all, cover: AXYLO }, X, Y, d.extreme, 's'), []);
  assert.ok(performance.now() - t < 500, `${performance.now() - t} ms`);
});

test('dense Axylo scatter: losing an isolated point is rejected with bounds and injected extreme intact', () => {
  const d = lattice([[300.3, 150.3]]);
  const lost = d.px.length - 1;
  const reasons = checkScatterPoints(d.x, d.y, { plot, centers: centersOf(d, k => d.droppable(k) || k === lost), cover: AXYLO }, X, Y, d.extreme, 's');
  assert.equal(reasons.length, 1, reasons.join('|'));
  assert.match(reasons[0], /point markers drawn for 3005 points; 1 points neither drawn nor inside drawn markers' disks \(first at \(300\.3, 150\.3\) px\)/);
});

test('dense Axylo scatter: a lost point beside a drawn marker is not covered by proximity alone', () => {
  // One pixel from an isolated drawn anchor: well inside the 1.5 px span tolerance, but its tile block is not painted.
  const d = lattice([[300.3, 150.3], [301.3, 150.3]]);
  const lost = d.px.length - 1;
  const reasons = checkScatterPoints(d.x, d.y, { plot, centers: centersOf(d, k => d.droppable(k) || k === lost), cover: AXYLO }, X, Y, d.extreme, 's');
  assert.equal(reasons.length, 1, reasons.join('|'));
  assert.match(reasons[0], /1 points neither drawn nor inside drawn markers' disks \(first at \(301\.3, 150\.3\) px\)/);
});

test('dense Axylo scatter: losing a cluster is rejected', () => {
  const cluster = [];
  for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) cluster.push([300.3 + a, 40.3 + b]);
  const d = lattice(cluster);
  const reasons = checkScatterPoints(d.x, d.y, { plot, centers: centersOf(d, k => d.droppable(k) || k >= 3004), cover: AXYLO }, X, Y, d.extreme, 's');
  assert.equal(reasons.length, 1, reasons.join('|'));
  assert.match(reasons[0], /25 points neither drawn nor inside/);
});

test('dense Axylo scatter: dropping 10% of spread points at random is rejected', () => {
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const n = 3000, x = new Float64Array(n), y = new Float64Array(n), centers = [];
  for (let i = 0; i < n; i++) { x[i] = 10 + rand() * 380; y[i] = 10 + rand() * 180; }
  // Keep the bounding points and the extreme (index 0) so only coverage can reject.
  const keepIdx = new Set([0]);
  for (const col of [x, y]) { let lo = 0, hi = 0; for (let i = 1; i < n; i++) { if (col[i] < col[lo]) lo = i; if (col[i] > col[hi]) hi = i; } keepIdx.add(lo).add(hi); }
  let dropped = 0;
  for (let i = 0; i < n; i++) { if (!keepIdx.has(i) && rand() < 0.1) { dropped++; continue; } centers.push(x[i], 200 - y[i]); }
  const reasons = checkScatterPoints(x, y, { plot, centers, cover: AXYLO }, X, Y, { x: x[0], y: y[0] }, 's');
  assert.equal(reasons.length, 1, reasons.join('|'));
  assert.match(reasons[0], new RegExp(`${n - dropped} point markers drawn for ${n} points; \\d+ points neither drawn`));
});

test('dense Axylo scatter: a marker where no visible point maps is rejected', () => {
  const d = lattice();
  const centers = centersOf(d, d.droppable);
  centers.push(250.55, 120.55);
  assert.match(checkScatterPoints(d.x, d.y, { plot, centers, cover: AXYLO }, X, Y, d.extreme, 's').join('|'), /1 markers drawn where no visible point maps/);
});

test('exact marker count still holds for sparse scatter, excess markers, and readbacks without the Axylo disk contract', () => {
  // Sparse: 1,000 points, one dropped although it is under its neighbours' disks.
  const px = [], py = [];
  for (let j = 0; j < 20; j++) for (let i = 0; i < 50; i++) { px.push(100.3 + i); py.push(50.3 + j); }
  const x = Float64Array.from(px), y = Float64Array.from(py, v => 200 - v), extreme = { x: x[0], y: y[0] };
  const centers = [];
  for (let k = 0; k < px.length; k++) if (k !== 525) centers.push(px[k], py[k]);
  assert.deepEqual(checkScatterPoints(x, y, { plot, centers, cover: AXYLO }, X, Y, extreme, 's'), ['s: 999 point markers drawn for 1000 points']);
  // Dense, but another library's readback (no disk contract): every marker must be drawn.
  const d = lattice();
  const reduced = centersOf(d, d.droppable);
  const n = reduced.length / 2;
  assert.deepEqual(checkScatterPoints(d.x, d.y, { plot, centers: reduced }, X, Y, d.extreme, 's'), [`s: ${n} point markers drawn for 3004 points`]);
  // Dense with the contract, but more markers than points.
  const all = centersOf(d, () => false);
  all.push(all[0], all[1]);
  assert.deepEqual(checkScatterPoints(d.x, d.y, { plot, centers: all, cover: AXYLO }, X, Y, d.extreme, 's'), ['s: 3005 point markers drawn for 3004 points']);
  assert.deepEqual(checkScatterPoints(d.x, d.y, { plot, centers: [], cover: AXYLO }, X, Y, d.extreme, 's'), ['s: the chart drew no point markers']);
});
