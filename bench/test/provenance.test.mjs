// Pure tests (Node only, no browser): sealed artifacts and the file server (review finding 17), the runner's
// parameters and two-build screening rule (findings 8, 16), and the named trend fixture (finding 8).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build, readArtifact, removeArtifact, REPO } from '../build.mjs';
import { startServer } from '../lib/driver.mjs';
import { harnessDifferences, workloadParams, screeningVerdict, DEFAULT_BLOCKS } from '../run.mjs';
import { trendFixture, trendSeries, zoomSteps, lineFixture, scatterFixture, expectedView, lowerBound } from '../src/fixtures.js';
import { scratchDir } from './helpers.mjs';

let dir, art;
before(async () => { dir = scratchDir('artifact'); art = await build({ out: path.join(dir, 'a') }); });
after(() => { removeArtifact(path.join(dir, 'a')); fs.rmSync(dir, { recursive: true, force: true }); });

test('an artifact is sealed: its own directory, read-only, every file hashed, the source recorded at build time', () => {
  const m = readArtifact(art.dir);
  assert.equal(m.id, 'a');
  for (const f of ['index.html', 'page.js', 'adapters/axylo-svg.js', 'axylo/axylo.iife.min.js', 'axylo/axylo.iife.min.js.map', 'axylo/axylo.bench.iife.min.js', 'axylo/axylo.bench.iife.min.js.map', 'axylo/axylo.iife.js.map']) assert.ok(m.files[f]?.sha256, f);
  // Decision 0002 removed Canvas marks from new artifacts. Old artifact manifests are untouched.
  assert.equal(m.adapters['axylo-canvas'], undefined);
  assert.equal(m.files['adapters/axylo-canvas.js'], undefined);
  // Two production builds: the shipped recipe (no hook) and the instrumented one (__BENCH__ true); they differ.
  assert.equal(m.source.recipe.release.__BENCH__, 'false');
  assert.equal(m.source.recipe.instrumented.__BENCH__, 'true');
  assert.notEqual(m.files['axylo/axylo.iife.min.js'].sha256, m.files['axylo/axylo.bench.iife.min.js'].sha256);
  assert.throws(() => fs.writeFileSync(path.join(art.dir, 'page.js'), 'x'), /EACCES|EPERM/);
  assert.match(m.source.head, /^[0-9a-f]{40}$|not available/);
  assert.ok(Object.keys(m.source.axyloInputs).some(p => p.endsWith('core/chart.ts')));
  assert.match(m.source.shippedOptions, /^identical/, 'the source map must not change the measured JavaScript');
  assert.equal(m.source.root, REPO);
});

test('a changed file is detected before a session serves it', () => {
  const copy = path.join(dir, 'b');
  fs.cpSync(art.dir, copy, { recursive: true });
  fs.chmodSync(copy, 0o755);
  fs.chmodSync(path.join(copy, 'page.js'), 0o644);
  fs.appendFileSync(path.join(copy, 'page.js'), '\n// changed');
  assert.throws(() => readArtifact(copy), /page\.js changed since the build/);
  fs.writeFileSync(path.join(copy, 'extra.js'), '');
  assert.throws(() => readArtifact(copy), /extra\.js is not in the manifest/);
  removeArtifact(copy);
});

test('two builds may differ in Canvas adapter availability while comparing a different adapter', () => {
  const canvas = 'adapters/axylo-canvas.js';
  const adapter = 'adapters/axylo.js';
  const svgOnly = {
    'page.js': { sha256: 'page' },
    [adapter]: { sha256: 'adapter' },
    'axylo/capabilities.json': { sha256: 'svg only' },
  };
  const legacy = { ...svgOnly, [canvas]: { sha256: 'canvas adapter' }, 'axylo/capabilities.json': { sha256: 'both' } };
  assert.deepEqual(harnessDifferences(legacy, svgOnly, 'axylo'), []);
  assert.deepEqual(harnessDifferences(legacy, svgOnly, 'axylo-canvas'), [canvas]);
  const changed = { ...svgOnly, [adapter]: { sha256: 'changed adapter' }, 'page.js': { sha256: 'changed page' } };
  assert.deepEqual(harnessDifferences(legacy, changed, 'axylo'), ['page.js', adapter]);
});

test('the server sends only manifest files, records the hash of what it sent, and refuses changed bytes', async () => {
  const copy = path.join(dir, 'c');
  fs.cpSync(art.dir, copy, { recursive: true });
  const m = readArtifact(copy);
  const server = await startServer({ A: m });
  try {
    const ok = await fetch(`${server.url('A')}page.js`);
    assert.equal(ok.status, 200);
    assert.equal(server.served().A['page.js'], m.files['page.js'].sha256);
    assert.equal((await fetch(`${server.url('A')}manifest.json`)).status, 404);
    assert.equal((await fetch(`${server.url('A')}../build.mjs`)).status, 404);
    assert.equal((await fetch(`${server.url('B')}page.js`)).status, 404);
    fs.chmodSync(copy, 0o755);
    fs.chmodSync(path.join(copy, 'index.html'), 0o644);
    fs.appendFileSync(path.join(copy, 'index.html'), '<!-- changed -->');
    assert.equal((await fetch(`${server.url('A')}index.html`)).status, 500);
    assert.match(server.violations()[0], /A\/index\.html: served bytes .* differ from the manifest/);
  } finally { await server.close(); removeArtifact(copy); }
});

test('workload parameters: P1 and P5 use the named trend fixture; budget workloads default to 20 runs', () => {
  assert.equal(DEFAULT_BLOCKS, 20);
  assert.deepEqual(workloadParams('first', { fixture: 'trend' }), { fixture: 'trend' });
  assert.deepEqual(workloadParams('page', { fixture: 'trend' }), { fixture: 'trend', charts: 24 });
  assert.deepEqual(workloadParams('compact', {}), { fixture: 'trend', charts: 40 });
  assert.deepEqual(workloadParams('first', { size: '10x100000' }), { size: '10x100000', gaps: false });
  assert.deepEqual(workloadParams('scatter', { size: '1x200000', clustered: true }), { size: '1x200000', clustered: true });
  assert.deepEqual(workloadParams('lifecycle', {}), { fixture: 'trend', cycles: 2500 });
  for (const w of ['first', 'page', 'compact', 'scatter', 'stream', 'theme', 'resize', 'hover', 'zoom', 'mem', 'lifecycle'])
    assert.ok(Object.values(workloadParams(w, {})).every(v => v !== undefined), w);
});

test('screening: worse beyond the tolerance means the lower bound of the regression is above it', () => {
  const rec = m => ({ analysis: { metrics: { taskMs: { key: 'taskMs', primary: true, ...m } } } });
  assert.equal(screeningVerdict(rec({ outcome: 'worse', lo: 3, hi: 5 }), 2).exceeds, true);
  assert.equal(screeningVerdict(rec({ outcome: 'worse', lo: 1, hi: 5 }), 2).exceeds, false);
  assert.equal(screeningVerdict(rec({ outcome: 'inconclusive', lo: 3, hi: 5 }), 2).exceeds, false);
  // A candidate that never finished is not "within tolerance" (review 2, finding 10): its own outcome, retried.
  const na = screeningVerdict(rec({ na: 'not available: x' }), 2);
  assert.equal(na.status, 'failed');
  assert.equal(na.failed, true);
  const allTimeouts = { analysis: { reliability: { failed: { A: 0, B: 20 }, timed: { A: 20, B: 20 } }, metrics: { taskMs: { key: 'taskMs', primary: true, na: 'not available: no complete pair' } } } };
  assert.equal(screeningVerdict(allTimeouts, 2).status, 'failed');
  assert.equal(screeningVerdict({ analysis: { notCompared: ['B:axylo-svg: not-admitted'] } }, 2).status, 'failed');
});

test('the trend fixture is the specification\'s: Phase 1 values, names, the 7-day outage', async () => {
  const t = trendFixture();
  assert.equal(t.x.length, 120);
  assert.deepEqual(t.names, ['Direct', 'Organic search', 'Referral']);
  assert.equal(t.x[0], Date.UTC(2026, 0, 1));
  assert.equal(t.x[119] - t.x[118], 86_400_000);
  for (let i = 0; i < 120; i++) assert.equal(Number.isNaN(t.ys[2][i]), i >= 60 && i < 67, `Referral ${i}`);
  // Compared value for value with the Phase 1 harness it was copied from (read here only, never imported by bench/src).
  const original = path.join(REPO, 'research/harness/src/data.js');
  if (fs.existsSync(original)) {
    const { trend } = await import(original);
    assert.deepEqual(Array.from(t.x), trend.t);
    trend.series.forEach((s, k) => assert.deepEqual(Array.from(t.ys[k], v => (v === v ? v : null)), s.values, s.name));
  }
  assert.equal(t.extreme.y, Math.max(...t.ys[0]));
  assert.equal(trendSeries(4).names[0], 'Organic search');
});

test('zoom steps end on a known window that contains the extreme; scatter x is sorted', () => {
  const fix = lineFixture({ series: 1, points: 100000 });
  const steps = zoomSteps(fix);
  assert.equal(steps.length, 60);
  const [lo, hi] = steps[59];
  assert.ok(lo <= fix.extreme.x && fix.extreme.x <= hi);
  const e = expectedView(fix, steps[59]);
  assert.deepEqual(e.visibleX, [lo, hi]);
  assert.ok(fix.x[e.window[0]] >= lo && fix.x[e.window[0] - 1] < lo);
  assert.ok(fix.x[e.window[1]] <= hi && fix.x[e.window[1] + 1] > hi);
  assert.equal(e.seriesY[0][1], fix.extreme.y);
  const s = scatterFixture({ points: 1000 });
  for (let i = 1; i < 1000; i++) assert.ok(s.x[i] > s.x[i - 1]);
  assert.equal(lowerBound(Float64Array.from([1, 3, 5]), 4), 2);
});
