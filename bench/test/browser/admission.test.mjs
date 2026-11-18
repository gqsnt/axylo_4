// Browser tests: the admission check, run against real charts in system Chrome, rejects deliberately broken adapters
// (test/adapters) and the runner then times nothing for them. The artifact is built from the current sources in
// before(), so every Axylo test here runs against a fresh production rebuild.
//   node --test --test-concurrency=1 bench/test/browser/*.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { build, readArtifact, removeArtifact, BENCH } from '../../build.mjs';
import { startServer, launchBrowser, runOnce } from '../../lib/driver.mjs';
import { workloadParams } from '../../run.mjs';
import { scratchDir } from '../helpers.mjs';

let browser, server, artifact, scratch;
const spec = (adapter, workload, params, extra = {}) => ({ adapter, workload, params, settleMs: 200, timeoutMs: 60000, ...extra });
const probe = (adapter, workload, params, extra = {}) => spec(adapter, workload, params, { probe: 'geometry', ...extra });

before(async () => {
  scratch = scratchDir('browser');
  artifact = readArtifact((await build({ out: path.join(scratch, 'artifact') })).dir);
  browser = await launchBrowser();
  server = await startServer({ A: artifact });
});
after(async () => {
  await browser?.close();
  await server?.close();
  if (scratch) { removeArtifact(path.join(scratch, 'artifact')); fs.rmSync(scratch, { recursive: true, force: true }); }
});

test('uPlot default is admitted on first 3x120', async () => {
  const r = await runOnce(browser, server, spec('uplot', 'first', { size: '3x120', gaps: false }));
  assert.equal(r.outcome, 'ok', r.reason ?? r.error);
  assert.ok(r.deltas['create:start->create:end'].TaskDuration > 0);
});

test('uPlot with its y range pinned away from the data is not admitted, and its timing is not kept', async () => {
  const r = await runOnce(browser, server, spec('uplot-pinned-y', 'first', { size: '3x120', gaps: false }));
  assert.equal(r.outcome, 'not-admitted');
  assert.match(r.reason, /visible y \[1000000, 2000000\] does not contain/);
  assert.match(r.reason, /injected extreme/);
  assert.equal(r.deltas, undefined);
});

test('a streaming window that is never trimmed is not admitted', async () => {
  const r = await runOnce(browser, server, spec('uplot-no-trim', 'stream', { window: 600, samples: 300 }));
  assert.equal(r.outcome, 'not-admitted');
  assert.match(r.reason, /holds 900 points, fixture 600/);
});

test('a stream whose draw record stops advancing is a failed run (incomplete), not a timing', async () => {
  const r = await runOnce(browser, server, spec('uplot-stalls', 'stream', { window: 600, samples: 300 }));
  assert.equal(r.outcome, 'incomplete');
  assert.match(r.reason, /samples never acknowledged by the chart's draw record/);
  assert.equal(r.deltas, undefined);
});

test('the runner records "not admitted" and times nothing', () => {
  const dir = path.join(scratch, 'hist-not-admitted');
  execFileSync(process.execPath, [path.join(BENCH, 'run.mjs'), '--baseline', 'uplot', '--candidate', 'uplot-pinned-y', '--workload', 'first', '--size', '3x120', '--blocks', '2', '--settle', '200', '--history-dir', dir, '--artifact', artifact.dir, '--quiet']);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  assert.equal(files.length, 1);
  const rec = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
  assert.equal(rec.status, 'complete');
  assert.equal(rec.admission['A:uplot-pinned-y'].outcome, 'not-admitted');
  assert.equal(rec.admission['A:uplot'].outcome, 'ok');
  assert.equal(rec.runs.filter(r => r.phase === 'timed').length, 0);
  assert.match(rec.analysis.notCompared[0], /uplot-pinned-y: not-admitted/);
  assert.equal(rec.hashes.slots.A.artifact, artifact.id);
  assert.equal(rec.hashes.slots.A.served['adapters/uplot.js'], artifact.files['adapters/uplot.js'].sha256);
});

test('errors, timeouts and crashes are distinct outcomes', async () => {
  const err = await runOnce(browser, server, spec('broken-throws', 'first', { size: '3x120', gaps: false }));
  assert.equal(err.outcome, 'error');
  assert.match(err.error, /deliberate failure in create/);
  const slow = await runOnce(browser, server, { ...spec('broken-never-ready', 'first', { size: '3x120', gaps: false }), timeoutMs: 3000 });
  assert.equal(slow.outcome, 'timeout');
  const crash = await runOnce(browser, server, { ...spec('uplot', 'stream', { window: 600, samples: 300 }), testCrashAfterMs: 2500 });
  assert.equal(crash.outcome, 'crash');
});

test('a runner killed mid-session (as by a restart) leaves its record marked interrupted, with the runs so far', async () => {
  const dir = path.join(scratch, 'hist-killed');
  fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, [path.join(BENCH, 'run.mjs'), '--baseline', 'noop', '--candidate', 'uplot', '--workload', 'first', '--size', '3x120', '--blocks', '6', '--settle', '200', '--history-dir', dir, '--artifact', artifact.dir, '--quiet'], { stdio: 'ignore' });
  const read = () => { const f = fs.readdirSync(dir).find(n => n.endsWith('.json')); return f ? JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) : null; };
  const t0 = Date.now();
  while (Date.now() - t0 < 60000 && !(read()?.runs.some(r => r.phase === 'timed'))) await new Promise(r => setTimeout(r, 100));
  child.kill('SIGKILL'); // no handler runs: the file must already say "interrupted"
  await new Promise(r => child.on('exit', r));
  const rec = read();
  assert.equal(rec.status, 'interrupted');
  assert.ok(rec.runs.some(r => r.phase === 'timed'));
  assert.equal(rec.analysis, null);
});

test('the theme workload does not admit a chart whose marks keep their colors (uPlot has no theme mechanism)', async () => {
  const r = await runOnce(browser, server, probe('uplot', 'theme', { size: '3x120', toggles: 2 }));
  assert.equal(r.outcome, 'not-admitted');
  assert.match(r.reason, /no theme mechanism/);
});

test('theme: one stale mark is caught by the per-mark color check', async () => {
  const ok = await runOnce(browser, server, probe('axylo-svg', 'theme', { size: '3x120', toggles: 2 }));
  assert.equal(ok.outcome, 'ok', ok.reason ?? ok.error);
  const r = await runOnce(browser, server, probe('axylo-stale-mark', 'theme', { size: '3x120', toggles: 2 }));
  assert.equal(r.outcome, 'not-admitted');
  assert.match(r.reason, /theme: after toggle 1: series 1 /);
});

test('Axylo production build, both renderers, are admitted through adapter parameters', async () => {
  for (const renderer of ['canvas', 'svg']) {
    const r = await runOnce(browser, server, { ...spec('axylo', 'first', { size: '3x120', gaps: false }), adapterParams: { renderer } });
    assert.equal(r.outcome, 'ok', r.reason ?? r.error);
    assert.match(r.result.adapter.config, new RegExp(`${renderer} mark renderer \\(__renderer: '${renderer}'\\), production build`));
  }
});

test('after a production rebuild, each Axylo adapter commits the renderer it names, in timed and probe runs', async () => {
  for (const [id, kind] of [['axylo-canvas', 'canvas'], ['axylo-svg', 'svg']]) {
    for (const s of [spec(id, 'first', { size: '3x120', gaps: false }), probe(id, 'first', { size: '3x120', gaps: false })]) {
      const r = await runOnce(browser, server, s);
      assert.equal(r.outcome, 'ok', `${id} ${s.probe ?? 'timed'}: ${r.reason ?? r.error}`);
      assert.equal(r.result.describe[0].renderer.kind, kind);
      assert.equal(r.result.adapter.expectRenderer, kind);
    }
  }
  const wrong = await runOnce(browser, server, spec('axylo-wrong-renderer', 'first', { size: '3x120', gaps: false }));
  assert.equal(wrong.outcome, 'not-admitted');
  assert.match(wrong.reason, /renderer: the committed chart has svg marks .* the adapter was asked for canvas/);
});

test('admission reads what was drawn: tuned Chart.js decimation across gaps is rejected; uPlot and Axylo on the same data are admitted', async () => {
  const params = workloadParams('first', { size: '1x100000', gaps: true });
  const cj = await runOnce(browser, server, probe('chartjs-tuned', 'first', params));
  assert.equal(cj.outcome, 'not-admitted');
  assert.match(cj.reason, /drawn segments join retained neighbours across missing source values/);
  for (const id of ['uplot', 'axylo-canvas', 'axylo-svg']) {
    const r = await runOnce(browser, server, probe(id, 'first', params));
    assert.equal(r.outcome, 'ok', `${id}: ${r.reason ?? r.error}`);
  }
  const plain = await runOnce(browser, server, probe('chartjs-tuned', 'first', workloadParams('first', { size: '1x100000' })));
  assert.equal(plain.outcome, 'ok', plain.reason ?? plain.error);
});

test('resize: a chart that never follows its container passes the final check but not the one at the narrowest width', async () => {
  const params = { size: '1x10000', charts: 1 };
  const timed = await runOnce(browser, server, spec('uplot-fixed-width', 'resize', params));
  assert.equal(timed.outcome, 'ok', 'the final geometry alone cannot tell');
  const r = await runOnce(browser, server, probe('uplot-fixed-width', 'resize', params));
  assert.equal(r.outcome, 'not-admitted');
  assert.match(r.reason, /resize: chart 0 at 400 px: widest canvas\/svg is 1200\.0 px in a 400 px container/);
  const ok = await runOnce(browser, server, probe('uplot', 'resize', params));
  assert.equal(ok.outcome, 'ok', ok.reason ?? ok.error);
});

test('new workloads run end to end: hover (P4), zoom, compact (P8), scatter, mem and lifecycle (P7)', async () => {
  const cases = [
    ['uplot', 'hover', { size: '1x10000', gaps: false, moves: 30 }],
    ['axylo-svg', 'zoom', { size: '1x10000', gaps: false }],
    ['axylo-canvas', 'compact', { fixture: 'trend', charts: 40 }],
    ['axylo-svg', 'scatter', { size: '1x10000', clustered: true }],
    ['axylo-canvas', 'mem', { size: '1x100000', gaps: false }],
    ['axylo-svg', 'lifecycle', { fixture: 'trend', cycles: 20 }],
  ];
  for (const [id, workload, params] of cases) {
    const r = await runOnce(browser, server, probe(id, workload, params));
    assert.equal(r.outcome, 'ok', `${id} ${workload}: ${r.reason ?? r.error}`);
  }
  const na = await runOnce(browser, server, spec('uplot', 'compact', { fixture: 'trend', charts: 40 }));
  assert.equal(na.outcome, 'not-available');
});
