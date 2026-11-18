// Pure tests: per-run summaries of every workload, the memory-unavailable paths, and the plain-text report's
// consistency with the analysis it prints (review finding 18). Expected values are worked out by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRun, analyze, slope } from '../src/stats.js';
import { formatAnalysis } from '../lib/report.mjs';
import { timedRuns } from './helpers.mjs';

const env = { refresh: { medianIntervalMs: 1000 / 60 } };
const d = (pairs) => Object.fromEntries(Object.entries(pairs).map(([k, v]) => [k, { TaskDuration: v }]));

test('theme: median and maximum of per-toggle task time, from the toggle windows only', () => {
  // TaskDuration seconds per toggle: 0.001, 0.003, 0.002 -> 1, 3, 2 ms: median 2, max 3.
  const run = { result: { env, theme: { toggles: 3 } }, deltas: d({ 'toggle0:start->toggle0:end': 0.001, 'toggle1:start->toggle1:end': 0.003, 'toggle2:start->toggle2:end': 0.002, 'create:start->create:end': 1 }) };
  const s = summarizeRun('theme', run);
  assert.equal(s.taskMsPerToggle, 2);
  assert.equal(s.taskMsToggleMax, 3);
  assert.equal(s.canvasCallsPerToggle, undefined, 'counters are not part of a timed run');
});

test('hover (P4): nearest-rank percentiles with misses kept as deadline failures', () => {
  // The reviewer's counterexample: 189 moves at 8 ms, one at 100 ms, ten misses. Nearest-rank p95 of 200 values is
  // the 190th smallest: 100 ms. Dropping the misses (the earlier summary) gave 8 ms.
  const lat = [...Array(189).fill(8), 100, ...Array(10).fill(null)];
  const run = { result: { env, hover: { moves: 200, latencies: lat } }, deltas: d({ 'hover:start->hover:end': 0.4 }) };
  const s = summarizeRun('hover', run);
  assert.equal(s.inputToReadoutP95Ms, 100);
  assert.equal(s.inputToReadoutP50Ms, 8);
  assert.equal(s.missedMoves, 10);
  assert.equal(s.taskMsPerMove, 2);
  // One more miss and the 190th value is a miss: the run's p95 is a deadline failure.
  const worse = summarizeRun('hover', { ...run, result: { env, hover: { moves: 200, latencies: [...Array(188).fill(8), 100, ...Array(11).fill(null)] } } });
  assert.equal(worse.inputToReadoutP95Ms, Infinity);
});

test('zoom: task time per step and step-to-frame p95', () => {
  const run = { result: { env, zoom: { steps: 60, stepToFrame: Array(60).fill(20), frames: [0, 16, 32], startAt: 0, endAt: 32 } }, deltas: d({ 'zoom:start->zoom:end': 0.6 }) };
  const s = summarizeRun('zoom', run);
  assert.equal(s.taskMsPerStep, 10);
  assert.equal(s.stepToFrameP95Ms, 20);
  assert.match(s.frameP95Ms.na, /only 2 frame intervals/);
});

test('mem (P7): owned bytes only from the library\'s own count; isolate deltas reported separately', () => {
  // Data: heap 10 MB + backing 16 MB; chart: heap 13 MB + backing 20 MB. Those are isolate-wide deltas (3 MB heap,
  // 4 MB backing storage, which includes external strings): never called owned bytes.
  const MB = 1e6;
  const samples = { data: { heapUsed: 10 * MB, backingStorage: 16 * MB, renderer: { pss: 100 } }, chart: { heapUsed: 13 * MB, backingStorage: 20 * MB, renderer: { pss: 150 } } };
  const run = { result: { env, callerColumnBytes: 16 * MB, canvasBacking: { chartCanvasBytes: 123 } }, memory: { samples }, deltas: {} };
  const s = summarizeRun('mem', run);
  assert.match(s.ownedBytes.na, /__bench\.memory\(\) missing/);
  assert.match(s.ownedRatio.na, /owned bytes not available/);
  assert.equal(s.heapChartBytes, 3 * MB);
  assert.equal(s.backingStorageChartBytes, 4 * MB);
  assert.equal(s.rendererPssChartBytes, 50);
  assert.equal(s.canvasBackingBytes, 123);
  // With the library's count (7 MB beyond the 16 MB of columns): 0.4375x.
  const counted = summarizeRun('mem', { ...run, result: { ...run.result, owned: { bytes: 7 * MB } } });
  assert.equal(counted.ownedBytes, 7 * MB);
  assert.equal(counted.ownedRatio, 7 / 16);
  const noBacking = { ...run, memory: { samples: { data: { ...samples.data, backingStorage: null }, chart: { ...samples.chart, backingStorage: null } } } };
  assert.match(summarizeRun('mem', noBacking).backingStorageChartBytes.na, /backingStorageSize/);
  assert.match(summarizeRun('mem', { ...run, memory: { na: 'memory not sampled in this workload' } }).heapChartBytes.na, /memory not sampled/);
});

test('create workloads: memory-unavailable paths say why and put no number in place', () => {
  const run = { result: { env, timing: { readyMs: 1, readyFrameMs: 2 }, canvasBacking: null }, memory: { na: 'memory not sampled in this workload' }, deltas: d({ 'create:start->create:end': 0.005 }) };
  const s = summarizeRun('first', run);
  assert.equal(s.taskMs, 5);
  for (const k of ['heapChartBytes', 'rendererPssBytes', 'gpuPssChartBytes']) assert.match(s[k].na, /memory not sampled/);
  assert.match(s.canvasBackingBytes.na, /not recorded/);
  const pssMissing = { ...run, memory: { samples: { data: { heapUsed: 1, renderer: { na: 'not available: ENOENT' }, gpu: { na: 'not available: no GPU process' } }, chart: { heapUsed: 3, renderer: { na: 'not available: ENOENT' }, gpu: { na: 'not available: no GPU process' } } } } };
  const p = summarizeRun('first', pssMissing);
  assert.equal(p.heapChartBytes, 2);
  assert.match(p.rendererPssBytes.na, /ENOENT/);
  assert.match(p.gpuPssBytes.na, /no GPU process/);
});

test('lifecycle (P7): heap growth between cycles 1,500-2,000 and 2,000-2,500, gated at 1%', () => {
  // Checkpoints every 100 cycles from 0 to 2,500. Heap = 1,000,000 + 2 * cycles bytes: window medians are
  // 1,000,000 + 2 * 1,750 and 1,000,000 + 2 * 2,250, growth 1,000 / 1,003,500 = 0.0996%: passes the 1% gate.
  const cps = Array.from({ length: 26 }, (_, k) => ({ cycles: k * 100, label: `cycles${k * 100}`, observers: 4 + (k === 25 ? 2 : 0) }));
  const samples = Object.fromEntries(cps.map(c => [c.label, { heapUsed: 1_000_000 + 2 * c.cycles, backingStorage: 50, listeners: 10 + (c.cycles === 2500 ? 3 : 0), nodes: 40 }]));
  const s = summarizeRun('lifecycle', { result: { env, lifecycle: { checkpoints: cps } }, memory: { samples }, deltas: {} });
  assert.ok(Math.abs(s.heapGrowth - 1000 / 1_003_500) < 1e-12);
  assert.equal(s.heapGate, 'pass');
  assert.ok(Math.abs(s.heapSlopeBytesPerCycle - 2) < 1e-9);
  assert.equal(s.listenersAfter, 3);
  assert.equal(s.observersAfter, 2);
  assert.equal(s.nodesAfter, 0);
  // 1,000 bytes per cycle on a 100,000-byte heap: windows 1,850,000 and 2,350,000, growth 27%: fails.
  const leak = Object.fromEntries(cps.map(c => [c.label, { heapUsed: 100_000 + 1000 * c.cycles, listeners: 10, nodes: 40 }]));
  assert.equal(summarizeRun('lifecycle', { result: { env, lifecycle: { checkpoints: cps } }, memory: { samples: leak }, deltas: {} }).heapGate, 'fail');
  // The old default of 1,000 cycles does not reach the windows.
  const short = cps.slice(0, 11);
  assert.match(summarizeRun('lifecycle', { result: { env, lifecycle: { checkpoints: short } }, memory: { samples }, deltas: {} }).heapGrowth.na, /1,500-2,500/);
  assert.equal(slope([0, 1, 2], [5, 5, 5]), 0);
});

test('the report prints each metric\'s outcome and the band it used, as the analysis says', () => {
  const runs = timedRuns(20, k => 10 + (k % 3) * 0.1, k => 8 + (k % 3) * 0.1);
  const analysis = analyze('first', runs, { noise: { metrics: { taskMs: { lo: -0.5, hi: 0.5 } } } });
  const rec = { runId: 'r', status: 'complete', design: { mode: 'compare', baseline: 'a', candidate: 'b', workload: 'first', params: {}, seed: 3, noiseFrom: [{ runId: 'aa' }] }, analysis };
  const out = formatAnalysis(rec);
  for (const [key, m] of Object.entries(analysis.metrics)) {
    const line = out.split('\n').find(l => l.startsWith(`${key}${m.primary ? ' *' : ''} `));
    assert.ok(line, key);
    if (m.na) assert.ok(line.includes(m.na)); else assert.ok(line.includes(m.outcome), `${key}: ${line}`);
  }
  assert.match(out.split('\n').find(l => l.startsWith('taskMs *')), /\[-0\.500, 0\.500\]\s+better/);
  assert.match(out, /analysis: stored in the record/);
  assert.match(formatAnalysis(rec, { source: 're-analysis' }), /RE-ANALYSIS/);
  // Failures make every timing conditional, and the report says so.
  const failed = timedRuns(20, () => 10, () => 8);
  failed[3] = { ...failed[3], outcome: 'timeout', summary: undefined };
  const out2 = formatAnalysis({ ...rec, analysis: analyze('first', failed) });
  assert.match(out2, /TIMINGS ARE CONDITIONAL/);
  assert.match(out2, /no "better" verdict: the candidate failed 1 of 20/);
});
