#!/usr/bin/env node
// Coverage check of the comparison procedure (review finding 11): how often does it give a verdict in the wrong
// direction on a discrete metric where the true answer is known?
//
// The reviewer's distribution: A is always 10 ms; B is 5 ms with probability 0.49 and 11 ms otherwise, so B's true
// median is 11 ms and the true difference of medians is +1 ms (B is worse). Any "better" verdict is false.
//
// For each sample size, `trials` simulated sessions of n complete pairs in balanced blocks (n/2 AB, n/2 BA) go
// through the harness's own pairedBootstrap (stratified by order, as analyze() calls it) and classify(). Reported:
//   unguarded  the share of "better", "worse" and "inconclusive" from the interval alone;
//   with rule  the same after analyze()'s minimum-pairs rule (MIN_PAIRS), which is what a session reports.
//
//   node bench/tools/coverage.mjs [--trials 2000] [--iterations 2000] [--sizes 6,10,20,40] [--seed 7]
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { rng } from '../src/fixtures.js';
import { pairedBootstrap, classify, MIN_PAIRS, parseSeed } from '../src/stats.js';

export const reviewerDistribution = { A: () => 10, B: r => (r() < 0.49 ? 5 : 11), trueDiff: 1, wrong: 'better' };

export function coverage({ sizes = [6, 10, 20, 40], trials = 2000, iterations = 2000, seed = 7, dist = reviewerDistribution } = {}) {
  const r = rng(seed);
  const rows = [];
  for (const n of sizes) {
    if (n % 2) throw new Error('sizes must be even (balanced blocks)');
    const count = { better: 0, worse: 0, inconclusive: 0 };
    const strata = Array.from({ length: n }, (_, i) => (i < n / 2 ? 'AB' : 'BA'));
    for (let t = 0; t < trials; t++) {
      const a = Array.from({ length: n }, () => dist.A(r)), b = Array.from({ length: n }, () => dist.B(r));
      const ci = pairedBootstrap(a, b, { iterations, seed: Math.floor(r() * 2 ** 31), strata });
      count[classify(ci, null)]++;
    }
    const share = k => count[k] / trials;
    const guarded = n >= MIN_PAIRS;
    rows.push({
      pairs: n, trials,
      unguarded: { better: share('better'), worse: share('worse'), inconclusive: share('inconclusive') },
      withRule: guarded ? { better: share('better'), worse: share('worse'), inconclusive: share('inconclusive') } : { better: 0, worse: 0, inconclusive: 1 },
      falseVerdictRate: guarded ? share(dist.wrong) : 0,
      falseVerdictRateUnguarded: share(dist.wrong),
    });
  }
  return { distribution: 'A = 10; B = 5 (p = 0.49) or 11; true median(B) - median(A) = +1', minPairs: MIN_PAIRS, iterations, seed, rows };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { trials: { type: 'string', default: '2000' }, iterations: { type: 'string', default: '2000' }, sizes: { type: 'string', default: '6,10,20,40' }, seed: { type: 'string', default: '7' } } });
  const res = coverage({ trials: Number(values.trials), iterations: Number(values.iterations), sizes: values.sizes.split(',').map(Number), seed: parseSeed(values.seed, '--seed') });
  const pct = v => `${(100 * v).toFixed(1)}%`;
  console.log(`${res.distribution}\nbootstrap iterations ${res.iterations}, seed ${res.seed}, verdict rule: at least ${res.minPairs} complete pairs\n`);
  console.log('pairs  trials  unguarded better / worse / inconclusive   reported (with rule) better / worse / inconclusive');
  for (const row of res.rows) console.log(`${String(row.pairs).padStart(5)}  ${String(row.trials).padStart(6)}  ${pct(row.unguarded.better).padStart(6)} / ${pct(row.unguarded.worse).padStart(6)} / ${pct(row.unguarded.inconclusive).padStart(6)}            ${pct(row.withRule.better).padStart(6)} / ${pct(row.withRule.worse).padStart(6)} / ${pct(row.withRule.inconclusive).padStart(6)}`);
  console.log('\n"better" is the wrong direction here: it is the false-verdict rate.');
}
