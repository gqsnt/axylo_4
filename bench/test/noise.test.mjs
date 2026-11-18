// Pure tests: a noise band is used only for the comparison it was measured for (review finding 10), and replaying a
// record never silently drops its band (finding 6).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadNoise, bandMismatches, controlsOf } from '../lib/refs.mjs';
import { BENCH } from '../build.mjs';
import { MIN_BAND_PAIRS } from '../src/stats.js';
import { record, timedRuns, write, scratchDir } from './helpers.mjs';

const dir = scratchDir('noise');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

// An A-versus-A record of uplot whose band for taskMs is about +-1 ms, with 20 complete pairs.
const aaRuns = timedRuns(MIN_BAND_PAIRS, k => 10 + (k % 3) * 0.5, k => 10 + ((k + 1) % 3) * 0.5);
const aa = write(dir, record({ runId: 'aa-1', mode: 'aa', baseline: 'uplot', candidate: 'uplot', runs: aaRuns }));
const target = record({ runId: 'cmp', runs: [] });

test('a band from the same workload, bytes, pixel ratio, Chrome and host is accepted', () => {
  assert.deepEqual(bandMismatches(aa, controlsOf(target)), []);
  const n = loadNoise(['aa-1'], dir, controlsOf(target));
  assert.ok(Number.isFinite(n.metrics.taskMs.lo) && Number.isFinite(n.metrics.taskMs.hi));
  assert.match(n.calibration, /exploratory: band from 1 session; plan 3.3 asks for at least 3/);
});

test('a band from another pixel ratio, Chrome, host, build or parameter set is refused, not warned about', () => {
  const cases = [
    [{ dpr: 2 }, /device pixel ratio 1, comparison 2/],
    [{ chrome: '158.0' }, /Chrome 157\.0, comparison 158\.0/],
    [{ host: { hostname: 'other', cpuModel: 'Test CPU', logicalCores: 8 } }, /host bench-host/],
    [{ files: { 'index.html': 'h1', 'page.js': 'p2', 'adapters/uplot.js': 'u1' } }, /built from different bytes: page\.js/],
    [{ params: { size: '3x120', gaps: true } }, /parameters/],
    [{ settleMs: 200 }, /settle 500 ms, comparison 200 ms/],
    [{ headless: false }, /headless, comparison headed/],
  ];
  for (const [change, why] of cases) {
    const t = record({ runId: 'cmp', runs: [], ...change });
    assert.match(bandMismatches(aa, controlsOf(t)).join('|'), why, JSON.stringify(change));
    assert.throws(() => loadNoise(['aa-1'], dir, controlsOf(t)), why);
  }
});

test('a record that does not say which files it served cannot be a band (older records)', () => {
  const old = write(dir, record({ runId: 'aa-old', mode: 'aa', baseline: 'uplot', candidate: 'uplot', runs: aaRuns, served: {} }));
  assert.match(bandMismatches(old, controlsOf(target)).join('|'), /does not say which files it served/);
});

test('a band needs enough complete pairs per metric', () => {
  write(dir, record({ runId: 'aa-few', mode: 'aa', baseline: 'uplot', candidate: 'uplot', runs: timedRuns(6, () => 10, k => 10 + k * 0.1) }));
  const n = loadNoise(['aa-few'], dir, controlsOf(target));
  assert.equal(n.metrics.taskMs, undefined, 'six pairs give no usable band');
});

test('analyze.mjs prints the stored analysis by default, and re-analysis keeps or refuses the band', () => {
  // The comparison: B is 2 ms faster with small jitter, 20 blocks: interval [-2, -2]. The stored record used a
  // wide A-versus-A band (A and B spread over 10..19 in different orders: band [-2.5, 2.5]), which covers it.
  const wide = write(dir, record({ runId: 'aa-wide', mode: 'aa', baseline: 'uplot', candidate: 'uplot', runs: timedRuns(MIN_BAND_PAIRS, k => 10 + (k % 10), k => 10 + ((k * 7 + 3) % 10)) }));
  const noise = loadNoise(['aa-wide'], dir, controlsOf(target));
  const cmpRuns = timedRuns(20, k => 10 + (k % 3) * 0.2, k => 8 + (k % 3) * 0.2);
  write(dir, record({ runId: 'cmp-wide', runs: cmpRuns, noise, noiseFrom: noise.sources }));
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'cmp-wide.json'), 'utf8')).analysis.metrics.taskMs;
  assert.equal(stored.outcome, 'inconclusive', `the band ${JSON.stringify(stored.noiseBand)} covers [${stored.lo}, ${stored.hi}]`);
  const cli = (...args) => execFileSync(process.execPath, [path.join(BENCH, 'analyze.mjs'), 'cmp-wide', '--history-dir', dir, ...args], { encoding: 'utf8', stdio: 'pipe' });
  const def = cli();
  assert.match(def, /analysis: stored in the record/);
  assert.match(def, /taskMs \*.*inconclusive/);
  const re = cli('--reanalyze');
  assert.match(re, /RE-ANALYSIS/);
  assert.match(re, /taskMs \*.*\[-?\d.*inconclusive/, 'the recorded band is resolved again');
  const zero = cli('--reanalyze', '--zero-only');
  assert.match(zero, /ZERO-ONLY ANALYSIS, explicitly requested/);
  assert.match(zero, /taskMs \*.*zero only \(requested\)\s+better/);
  // The band's record is gone: re-analysis stops instead of classifying against zero.
  fs.rmSync(path.join(dir, `${wide.runId}.json`));
  let err;
  try { cli('--reanalyze'); } catch (e) { err = e; }
  assert.equal(err?.status, 2);
  assert.match(String(err.stderr), /the record's noise band cannot be used:[\s\S]*noise run aa-wide not found[\s\S]*--zero-only/);
  assert.throws(() => cli('--zero-only'), /add --reanalyze/);
});

test('the reviewer\'s replay of the M1 dashboard record now prints the published outcome', () => {
  // node bench/analyze.mjs 20261118T023718Z-page-3x120-x24-axylo-canvas-vs-axylo-svg-41e7 printed "better" for the
  // -22.01 ms task result before; the stored analysis (and the M1 report) say "inconclusive".
  const id = '20261118T023718Z-page-3x120-x24-axylo-canvas-vs-axylo-svg-41e7';
  const file = path.join(BENCH, 'history', `${id}.json`);
  if (!fs.existsSync(file)) return;
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = execFileSync(process.execPath, [path.join(BENCH, 'analyze.mjs'), id], { encoding: 'utf8' });
  assert.match(out, /analysis: stored in the record/);
  assert.match(out, new RegExp(`taskMs \\*.*${rec.analysis.metrics.taskMs.outcome}`));
  assert.equal(rec.analysis.metrics.taskMs.outcome, 'inconclusive');
  // Its bands come from records that predate host and served-file recording, so re-analysis refuses them.
  let err;
  try { execFileSync(process.execPath, [path.join(BENCH, 'analyze.mjs'), id, '--reanalyze'], { stdio: 'pipe' }); } catch (e) { err = e; }
  assert.equal(err?.status, 2);
  assert.match(String(err.stderr), /noise band cannot be used/);
});
