// Browser test: the admission check, run against real charts in system Chrome, rejects deliberately broken
// adapters (test/adapters) and the runner then times nothing for them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { build, BENCH } from '../build.mjs';
import { startServer, launchBrowser, runOnce } from '../lib/driver.mjs';

let browser, server;
const spec = (adapter, workload, params) => ({ adapter, workload, params, settleMs: 200, timeoutMs: 60000 });

before(async () => { await build(); browser = await launchBrowser(); server = await startServer(); });
after(async () => { await browser?.close(); await server?.close(); });

test('uPlot default is admitted on first 3x120', async () => {
  const r = await runOnce(browser, server.base, spec('uplot', 'first', { size: '3x120', gaps: false }));
  assert.equal(r.outcome, 'ok', r.reason ?? r.error);
  assert.ok(r.deltas['create:start->create:end'].TaskDuration > 0);
});

test('uPlot with its y range pinned away from the data is not admitted, and its timing is not kept', async () => {
  const r = await runOnce(browser, server.base, spec('uplot-pinned-y', 'first', { size: '3x120', gaps: false }));
  assert.equal(r.outcome, 'not-admitted');
  assert.match(r.reason, /visible y \[1000000, 2000000\] does not contain/);
  assert.match(r.reason, /injected extreme/);
  assert.equal(r.deltas, undefined);
});

test('a streaming window that is never trimmed is not admitted', async () => {
  const r = await runOnce(browser, server.base, spec('uplot-no-trim', 'stream', { window: 600, samples: 300 }));
  assert.equal(r.outcome, 'not-admitted');
  assert.match(r.reason, /holds 900 points, fixture 600/);
});

test('the runner records "not admitted" and times nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axylo-bench-'));
  try {
    execFileSync(process.execPath, [path.join(BENCH, 'run.mjs'), '--baseline', 'uplot', '--candidate', 'uplot-pinned-y', '--workload', 'first', '--size', '3x120', '--blocks', '2', '--settle', '200', '--history-dir', dir, '--no-build', '--quiet']);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    assert.equal(files.length, 1);
    const rec = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
    assert.equal(rec.status, 'complete');
    assert.equal(rec.admission['uplot-pinned-y'].outcome, 'not-admitted');
    assert.equal(rec.admission.uplot.outcome, 'ok');
    assert.equal(rec.runs.filter(r => r.phase === 'timed').length, 0);
    assert.match(rec.analysis.notCompared[0], /uplot-pinned-y: not-admitted/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('errors, timeouts and crashes are distinct outcomes', async () => {
  const err = await runOnce(browser, server.base, spec('broken-throws', 'first', { size: '3x120', gaps: false }));
  assert.equal(err.outcome, 'error');
  assert.match(err.error, /deliberate failure in create/);
  const slow = await runOnce(browser, server.base, { ...spec('broken-never-ready', 'first', { size: '3x120', gaps: false }), timeoutMs: 3000 });
  assert.equal(slow.outcome, 'timeout');
  const crash = await runOnce(browser, server.base, { ...spec('uplot', 'stream', { window: 600, samples: 300 }), testCrashAfterMs: 2500 });
  assert.equal(crash.outcome, 'crash');
});

test('a runner killed mid-session (as by a restart) leaves its record marked interrupted, with the runs so far', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axylo-bench-'));
  try {
    const child = spawn(process.execPath, [path.join(BENCH, 'run.mjs'), '--baseline', 'noop', '--candidate', 'uplot', '--workload', 'first', '--size', '3x120', '--blocks', '6', '--settle', '200', '--history-dir', dir, '--no-build', '--quiet'], { stdio: 'ignore' });
    const read = () => { const f = fs.readdirSync(dir).find(n => n.endsWith('.json')); return f ? JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) : null; };
    const t0 = Date.now();
    while (Date.now() - t0 < 30000 && !(read()?.runs.some(r => r.phase === 'timed'))) await new Promise(r => setTimeout(r, 100));
    child.kill('SIGKILL'); // no handler runs: the file must already say "interrupted"
    await new Promise(r => child.on('exit', r));
    const rec = read();
    assert.equal(rec.status, 'interrupted');
    assert.ok(rec.runs.some(r => r.phase === 'timed'));
    assert.equal(rec.analysis, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the theme workload does not admit a chart whose marks keep their colors (uPlot has no theme mechanism)', async () => {
  const r = await runOnce(browser, server.base, spec('uplot', 'theme', { size: '3x120', toggles: 2 }));
  assert.equal(r.outcome, 'not-admitted');
  assert.match(r.reason, /marks did not change color/);
});

test('Axylo production build, both renderers, are admitted through adapter parameters', async () => {
  for (const renderer of ['canvas', 'svg']) {
    const r = await runOnce(browser, server.base, { ...spec('axylo', 'first', { size: '3x120', gaps: false }), adapterParams: { renderer } });
    assert.equal(r.outcome, 'ok', r.reason ?? r.error);
    assert.match(r.result.adapter.config, new RegExp(`${renderer} mark renderer, production build`));
  }
});
