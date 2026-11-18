import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../check.mjs';

const root = fileURLToPath(new URL('./fixtures/', import.meta.url));
const matrixFile = resolve(root, 'matrix.json');
const passed = resolve(root, 'results.json');
const failed = resolve(root, 'failed.json');
const run = options => check({ root, matrixFile, ...options });

test('a stale ID and its missing replacement are structural errors without --release', () => {
  assert.throws(() => run({ matrixFile: resolve(root, 'stale.json') }),
    /stale criterion ID: F88\nmissing criterion ID: F1/);
});

test('a title in a comment does not satisfy even a weak test reference', () => {
  assert.throws(() => run({ matrixFile: resolve(root, 'missing-title.json') }),
    /F1\/area: missing test title in chart\.test\.ts: title in a comment/);
});

test('a failed named result appears in the table and only blocks --release', () => {
  const options = { resultFiles: [failed] };
  const normal = run(options);
  assert.match(normal.table, /^\| F1 \| [^|]+\| fail \| no evidence \| not run \|/m);
  assert.match(normal.report, /1 passed assertions, 1 reported failures/);
  assert.equal(normal.counts.fail, 3);
  assert.equal(normal.exitCode, 0);
  assert.equal(run({ ...options, release: true }).exitCode, 1);
});

test('evidence applies per chart type and weak tests cannot fill an evidence gap', () => {
  const normal = run({ resultFiles: [passed] });
  assert.match(normal.table, /^\| F1 \| [^|]+\| pass \| no evidence \| pass \| not applicable \|/m);
  assert.match(normal.table, /^\| F2 \| [^|]+\| cannot be verified here \|/m);
  assert.match(normal.report, /No evidence · area/);
  assert.match(normal.report, /The smoke test does not check the geometry\./);
  assert.deepEqual(normal.counts, {
    pass: 2, fail: 0, 'no evidence': 1, 'not run': 2, 'cannot be verified here': 1, 'not applicable': 18,
  });
  assert.equal(run({ resultFiles: [passed], release: true }).exitCode, 1);
});

test('a describe prefix needs all its cases, and a failure in either report remains a failure', () => {
  const partial = run({ resultFiles: [passed] });
  assert.match(partial.table, /^\| T-pointer-line \| [^|]+\| not run \|/m);
  const combined = run({ resultFiles: [passed, failed] });
  assert.match(combined.table, /^\| T-pointer-line \| [^|]+\| fail \|/m);
  assert.equal(combined.counts.pass, 1);
});

test('without results, named tests are not run and gaps remain visible', () => {
  const result = run();
  assert.match(result.report, /Static coverage only/);
  assert.equal(result.counts.pass, 0);
  assert.equal(result.counts['not run'], 4);
  assert.equal(result.counts['no evidence'], 1);
  assert.equal(result.exitCode, 0);
});
