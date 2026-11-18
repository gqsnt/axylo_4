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

test('hover: percentiles of input-to-readout latency over the moves; misses do not count as fast', () => {
  // 20 moves with latencies 1..19 ms and one miss: p95 of 1..19 (19 values) = 18.1; median 10.
  const lat = Array.from({ length: 19 }, (_, i) => i + 1);
  const run = { result: { env, hover: { moves: 20, latencies: [...lat, NaN] } }, deltas: d({ 'hover:start->hover:end': 0.04 }) };
  const s = summarizeRun('hover', run);
  assert.ok(Math.abs(s.inputToReadoutP95Ms - 18.1) < 1e-9);
  assert.equal(s.inputToReadoutP50Ms, 10);
  assert.equal(s.inputToReadoutMaxMs, 19);
  assert.equal(s.taskMsPerMove, 2);
});

test('zoom: task time per step and step-to-frame p95', () => {
  const run = { result: { env, zoom: { steps: 60, stepToFrame: Array(60).fill(20), frames: [0, 16, 32], startAt: 0, endAt: 32 } }, deltas: d({ 'zoom:start->zoom:end': 0.6 }) };
  const s = summarizeRun('zoom', run);
  assert.equal(s.taskMsPerStep, 10);
  assert.equal(s.stepToFrameP95Ms, 20);
  assert.match(s.frameP95Ms.na, /only 2 frame intervals/);
});

test('mem (P7): owned bytes = heap + ArrayBuffer backing with the chart minus with the columns alone', () => {
  // Data: heap 10 MB + backing 16 MB; chart: heap 13 MB + backing 20 MB. Owned = 7 MB; columns 16 MB -> 0.4375x.
  const MB = 1e6;
  const samples = { data: { heapUsed: 10 * MB, backingStorage: 16 * MB, renderer: { pss: 100 } }, chart: { heapUsed: 13 * MB, backingStorage: 20 * MB, renderer: { pss: 150 } } };
  const run = { result: { env, callerColumnBytes: 16 * MB, canvasBacking: { chartCanvasBytes: 123 } }, memory: { samples }, deltas: {} };
  const s = summarizeRun('mem', run);
  assert.equal(s.ownedBytes, 7 * MB);
  assert.equal(s.ownedRatio, 7 / 16);
  assert.equal(s.heapChartBytes, 3 * MB);
  assert.equal(s.rendererPssChartBytes, 50);
  assert.equal(s.canvasBackingBytes, 123);
  // Chrome without backingStorageSize: not available, never the heap figure in its place.
  const noBacking = { ...run, memory: { samples: { data: { ...samples.data, backingStorage: null }, chart: { ...samples.chart, backingStorage: null } } } };
  assert.match(summarizeRun('mem', noBacking).ownedBytes.na, /backingStorageSize/);
  assert.match(summarizeRun('mem', { ...run, memory: { na: 'memory not sampled in this workload' } }).ownedBytes.na, /memory not sampled/);
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

test('lifecycle (P7): least-squares slope of heap over cycles, and leftover listeners and nodes', () => {
  // Checkpoints at 0, 100, 300, 1000 cycles; heap + backing = 1000 + 2 * cycles: slope 2 bytes per cycle.
  const cps = [0, 100, 300, 1000].map(c => ({ cycles: c, label: `cycles${c}` }));
  const samples = Object.fromEntries(cps.map(c => [c.label, { heapUsed: 1000 + 2 * c.cycles - 50, backingStorage: 50, listeners: 10 + (c.cycles === 1000 ? 3 : 0), nodes: 40 }]));
  const s = summarizeRun('lifecycle', { result: { env, lifecycle: { checkpoints: cps } }, memory: { samples }, deltas: {} });
  assert.ok(Math.abs(s.heapSlopeBytesPerCycle - 2) < 1e-12);
  assert.equal(s.listenersAfter, 3);
  assert.equal(s.nodesAfter, 0);
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
