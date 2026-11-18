// Pure tests: seeds, the estimand, order strata, carry-over visibility, the verdict rule (review findings 11, 12, 18).
// Expected values are worked out by hand from the definitions in the comments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pairedBootstrap, analyze, balancedOrder, parseSeed, checkSeed, MIN_PAIRS } from '../src/stats.js';
import { coverage } from '../tools/coverage.mjs';
import { BENCH } from '../build.mjs';

test('seeds: a seed the generator would coerce is an error, not zero', () => {
  assert.equal(parseSeed('42'), 42);
  assert.equal(parseSeed('0'), 0);
  for (const bad of ['12abc', '1.5', '', '-3', 'abc', '4294967296']) assert.throws(() => parseSeed(bad), /integer from 0 to 4294967295/, bad);
  for (const bad of [NaN, 1.5, -1, '7', null]) assert.throws(() => checkSeed(bad), /integer/);
  assert.throws(() => balancedOrder(4, 'x'), /order seed/);
  assert.throws(() => pairedBootstrap([1, 2], [3, 4], { seed: 0.5 }), /bootstrap seed/);
  assert.throws(() => analyze('first', [], { bootstrapSeed: -1 }), /bootstrap seed/);
});

test('seeds: the runner refuses an invalid --seed or --bootstrap-seed before doing anything', () => {
  for (const flag of ['--seed', '--bootstrap-seed']) {
    let err;
    try { execFileSync(process.execPath, [path.join(BENCH, 'run.mjs'), '--aa', 'noop', flag, 'abc'], { stdio: 'pipe' }); } catch (e) { err = e; }
    assert.ok(err, `${flag} abc must fail`);
    assert.equal(err.status, 2);
    assert.match(String(err.stderr), new RegExp(`${flag} must be an integer`));
  }
});

test('the estimand is the difference of medians, not the median of paired differences', () => {
  // median(B) = 100, median(A) = 101 -> -1. The paired differences are 99, -100, 1, whose median is +1.
  const ci = pairedBootstrap([1, 101, 102], [100, 1, 103]);
  assert.equal(ci.estimate, -1);
});

test('stratified bootstrap keeps the AB/BA balance in every resample', () => {
  // A is 0 everywhere. B is 10 in the two AB blocks and 0 in the two BA blocks. Keeping the strata, every resample
  // has two 10s and two 0s for B, so median(B) = 5 and the interval is [5, 5]. Ignoring them, resamples can hold
  // four 10s or four 0s, so the interval spreads from 0 to 10.
  const a = [0, 0, 0, 0], b = [10, 10, 0, 0], strata = ['AB', 'AB', 'BA', 'BA'];
  const s = pairedBootstrap(a, b, { strata });
  assert.equal(s.lo, 5); assert.equal(s.hi, 5);
  const u = pairedBootstrap(a, b);
  assert.ok(u.lo < 5 && u.hi > 5, `unstratified [${u.lo}, ${u.hi}]`);
});

const block = (b, order, a, bv) => [
  { phase: 'timed', block: b, position: order === 'AB' ? 0 : 1, config: 'A', outcome: 'ok', summary: { taskMs: a } },
  { phase: 'timed', block: b, position: order === 'AB' ? 1 : 0, config: 'B', outcome: 'ok', summary: { taskMs: bv } },
];

test('differential carry-over shows in the per-order estimates', () => {
  // The reviewer's case: every first run takes 10; a run after A takes 4, a run after B 12; no adapter effect.
  // AB block: A = 10 (first), B = 4 (after A): B - A = -6. BA block: B = 10 (first), A = 12 (after B): B - A = -2.
  const runs = [];
  for (let b = 0; b < 8; b++) runs.push(...(b % 2 ? block(b, 'BA', 12, 10) : block(b, 'AB', 10, 4)));
  const m = analyze('first', runs).metrics.taskMs;
  assert.equal(m.byOrder.AB.diff, -6);
  assert.equal(m.byOrder.BA.diff, -2);
  assert.equal(m.byOrder.AB.pairs, 4);
  assert.equal(m.outcome, 'inconclusive'); // 8 pairs: below the verdict rule
});

test('the verdict rule follows the plan: 20 runs per configuration before a verdict', () => {
  assert.equal(MIN_PAIRS, 20);
  const runs = [];
  for (let b = 0; b < MIN_PAIRS - 2; b++) runs.push(...block(b, b % 2 ? 'BA' : 'AB', 10, 5));
  const few = analyze('first', runs).metrics.taskMs;
  assert.equal(few.outcome, 'inconclusive');
  assert.match(few.outcomeNote, /fewer than 20/);
  for (let b = MIN_PAIRS - 2; b < MIN_PAIRS; b++) runs.push(...block(b, b % 2 ? 'BA' : 'AB', 10, 5));
  assert.equal(analyze('first', runs).metrics.taskMs.outcome, 'better');
});

test('coverage check: on the reviewer\'s discrete distribution six pairs give wrong-direction verdicts, which the rule withholds', () => {
  // A = 10; B = 5 with p = 0.49, else 11 (true difference +1, so "better" is wrong). With five or six 5s out of six
  // (probability 10.03%) the unstratified bootstrap called B better; the rule makes six pairs inconclusive.
  const res = coverage({ sizes: [6], trials: 400, iterations: 400, seed: 11 });
  const row = res.rows[0];
  assert.ok(row.falseVerdictRateUnguarded > 0.05, `unguarded false-verdict rate ${row.falseVerdictRateUnguarded}`);
  assert.equal(row.falseVerdictRate, 0);
  assert.equal(row.withRule.inconclusive, 1);
});
