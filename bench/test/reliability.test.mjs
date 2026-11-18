// Pure tests: failed work cannot win the speed comparison (review finding 7); frame lateness over a full window
// (finding 2). Expected values are worked out by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, streamCompletion, intervalsOverlapping, lateWindow, summarizeRun, MIN_PAIRS } from '../src/stats.js';

const frameLog = (from, count, step = 1000 / 60) => Array.from({ length: count }, (_, i) => from + i * step);

test('a stream whose last sequences were never acknowledged is not complete', () => {
  // The reviewer's case: the final held window is right, but the watchdog fired with two sequences unacknowledged.
  const s = { samples: 300, receivedCount: 300, visibleCount: 298, ended: 'timeout: not every sample became visible within 5 s of the last one', due: [100], frames: frameLog(90, 400) };
  const c = streamCompletion(s);
  assert.equal(c.complete, false);
  assert.ok(c.reasons.some(r => r.includes('2 of 300 samples never acknowledged')), c.reasons.join('|'));
  const ok = streamCompletion({ ...s, visibleCount: 300, ended: 'all visible' });
  assert.deepEqual(ok, { complete: true, reasons: [] });
  const short = streamCompletion({ ...s, visibleCount: 300, ended: 'all visible', frames: frameLog(90, 250) });
  assert.equal(short.complete, false, 'a frame log shorter than 300 intervals cannot give P3\'s count');
});

const pair = (b, a, bOut) => [
  { phase: 'timed', block: b, position: b % 2, config: 'A', outcome: 'ok', summary: { taskMs: a } },
  { phase: 'timed', block: b, position: 1 - (b % 2), config: 'B', ...bOut },
];

test('incomplete candidate runs are never paired, so they cannot beat complete baseline runs', () => {
  // Eight "incomplete" candidate streams at 0.5 ms/update against eight complete baseline runs at 2 ms: nothing to pair.
  const runs = [];
  for (let b = 0; b < 8; b++) {
    runs.push({ phase: 'timed', block: b, position: 0, config: 'A', outcome: 'ok', summary: { taskMsPerUpdate: 2 } });
    runs.push({ phase: 'timed', block: b, position: 1, config: 'B', outcome: 'incomplete', reason: '2 of 300 samples never acknowledged' });
  }
  const res = analyze('stream', runs);
  assert.equal(res.completePairs, 0);
  assert.ok(res.metrics.taskMsPerUpdate.na);
  assert.equal(res.reliability.failed.B, 8);
});

test('a candidate that fails more runs than the baseline gets no "better", and its timing is labelled conditional', () => {
  // The reviewer's case: 20 blocks, B timed out 14 times and took 5 ms on the 6 survivors; A took 10 ms every run.
  const reviewer = [];
  for (let b = 0; b < 20; b++) reviewer.push(...pair(b, 10, b < 14 ? { outcome: 'timeout' } : { outcome: 'ok', summary: { taskMs: 5 } }));
  const r1 = analyze('first', reviewer);
  assert.notEqual(r1.metrics.taskMs.outcome, 'better');
  assert.equal(r1.reliability.failed.B, 14);
  assert.equal(r1.reliability.failureRate.B, 0.7);
  // Enough survivors for a verdict (40 blocks, 14 failures, 26 pairs): the interval alone says "better"; the
  // differential failures block it.
  const many = [];
  for (let b = 0; b < 40; b++) many.push(...pair(b, 10, b < 14 ? { outcome: 'timeout' } : { outcome: 'ok', summary: { taskMs: 5 } }));
  const r2 = analyze('first', many);
  const m = r2.metrics.taskMs;
  assert.ok(m.pairs >= MIN_PAIRS);
  assert.ok(m.hi < 0, 'the interval itself is below zero');
  assert.equal(m.outcome, 'inconclusive');
  assert.match(m.outcomeNote, /"better" blocked: the candidate failed 14 of 40/);
  assert.match(m.conditional, /survivor-only/);
  assert.match(r2.reliability.betterBlocked, /14 of 40/);
});

test('runs with late frames block "better" even when the median late-frame count is zero', () => {
  // 22 blocks; B is cheaper per update (0.5 vs 2 ms) but 2 of its runs had 60 late intervals; A had none.
  const runs = [];
  for (let b = 0; b < 22; b++) {
    runs.push({ phase: 'timed', block: b, position: b % 2, config: 'A', outcome: 'ok', summary: { taskMsPerUpdate: 2, lateFrames: 0 } });
    runs.push({ phase: 'timed', block: b, position: 1 - (b % 2), config: 'B', outcome: 'ok', summary: { taskMsPerUpdate: 0.5, lateFrames: b < 2 ? 60 : 0 } });
  }
  const res = analyze('stream', runs);
  assert.equal(res.reliability.adverse.B, 2);
  assert.equal(res.reliability.adverse.A, 0);
  assert.equal(res.metrics.lateFrames.medianB, 0); // the median hides them ...
  assert.equal(res.metrics.taskMsPerUpdate.outcome, 'inconclusive'); // ... the gate does not
  assert.match(res.metrics.taskMsPerUpdate.outcomeNote, /lateFrames > 0/);
});

test('frame intervals that straddle a window boundary are counted', () => {
  // Frames every 16.67 ms up to 1000, then one 150 ms interval 1000 -> 1150 across the window end at 1100.
  const frames = [...frameLog(0, 60), 1000, 1150, 1166.67];
  const iv = intervalsOverlapping(frames, 100, 1100);
  assert.ok(iv.includes(150));
  // Old method (both ends inside the window) would drop it:
  const inside = frames.filter(t => t >= 100 && t <= 1100);
  assert.ok(!inside.slice(1).map((t, i) => t - inside[i]).some(v => v > 100));
  const run = { result: { env: { refresh: { medianIntervalMs: 1000 / 60 } }, resize: { frames, startAt: 100, endAt: 1100 } }, deltas: {} };
  const s = summarizeRun('resize', run);
  assert.equal(s.framesOverThreshold, 1);
  assert.equal(s.frameMaxMs, 150);
});

test('P3 lateness: exactly 300 intervals for 300 samples, from the interval holding the first due time', () => {
  // First sample due at 5 ms; frames every 16.67 ms from 0: the window starts with the frame at 0 and holds 300
  // intervals whatever the stream's end time. One 40 ms interval inside the window counts; one after it does not.
  const frames = frameLog(0, 200);
  frames.push(frames[199] + 40); // interval 199 -> 200 is 40 ms (inside: index 199 < 300)
  for (let i = 0; i < 120; i++) frames.push(frames[frames.length - 1] + 1000 / 60);
  frames.push(frames[frames.length - 1] + 90); // far past the 300th interval
  const w = lateWindow(frames, 5, 300);
  assert.equal(w.intervals.length, 300);
  assert.equal(w.firstFrame, 0);
  const samples = 300;
  const stream = { samples, due: Array.from({ length: samples }, (_, k) => 5 + k * 1000 / 60), visible: Array.from({ length: samples }, (_, k) => 20 + k * 1000 / 60), frames, maxBacklog: 0, coalesced: 0, neverVisible: 0, startAt: 0, endAt: 5100 };
  const s = summarizeRun('stream', { result: { env: { refresh: { medianIntervalMs: 1000 / 60 } }, stream }, deltas: { 'stream:start->stream:end': { TaskDuration: 0.3 }, 'create:start->create:end': { TaskDuration: 0.01 } } });
  assert.equal(s.lateWindowIntervals, 300);
  assert.equal(s.lateFrames, 1);
  // P3 as the plan defines it: TaskDuration over the stream window / samples = 300 ms / 300 = 1 ms per update.
  assert.ok(Math.abs(s.taskMsPerUpdate - 1) < 1e-9);
  assert.equal(lateWindow(frameLog(0, 250), 5, 300), null);
});
