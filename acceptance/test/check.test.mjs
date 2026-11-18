import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../check.mjs';

const root = fileURLToPath(new URL('./fixtures/', import.meta.url));
const matrixFile = resolve(root, 'matrix.json');
const passed = resolve(root, 'results.json');
const failed = resolve(root, 'failed.json');
const run = options => check({ root, matrixFile, ...options });
const read = file => JSON.parse(readFileSync(file, 'utf8'));

function workspace(t) {
  const directory = mkdtempSync(resolve(tmpdir(), 'axylo-acceptance-'));
  t.after(() => rmSync(directory, { recursive: true }));
  return (name, data) => {
    const file = resolve(directory, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.isBuffer(data) ? data : JSON.stringify(data));
    return file;
  };
}

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
  assert.match(normal.table, /^\| F1 \| [^|]+\| fail \(failed\.json fail\) \| weak \(failed\.json pass\) \| not run \|/m);
  assert.match(normal.report, /1 passed assertions, 1 reported failures/);
  assert.equal(normal.counts.fail, 3);
  assert.equal(normal.exitCode, 0);
  assert.equal(run({ ...options, release: true }).exitCode, 1);
});

test('evidence applies per chart type and weak tests cannot fill an evidence gap', () => {
  const normal = run({ resultFiles: [passed] });
  assert.match(normal.table, /^\| F1 \| [^|]+\| pass \(results\.json pass\) \| weak \(results\.json skipped\) \| pass \(results\.json pass\) \| not applicable \|/m);
  assert.match(normal.table, /^\| F2 \| [^|]+\| cannot be verified here \|/m);
  assert.match(normal.report, /Weak · area/);
  assert.match(normal.report, /## Evidence that exists but was not run for this report[\s\S]*F1\/area/);
  assert.match(normal.report, /The smoke test does not check the geometry\./);
  assert.deepEqual(normal.counts, {
    pass: 2, fail: 0, weak: 1, 'no evidence': 0, 'not run': 2, 'cannot be verified here': 1, 'not applicable': 18,
  });
  assert.equal(run({ resultFiles: [passed], release: true }).exitCode, 1);
});

test('a describe prefix needs all its cases, and a failure in either report remains a failure', () => {
  const partial = run({ resultFiles: [passed] });
  assert.match(partial.table, /^\| T-pointer-line \| [^|]+\| not run \(results\.json pass\/skipped\) \|/m);
  const combined = run({ resultFiles: [passed, failed] });
  assert.match(combined.table, /^\| T-pointer-line \| [^|]+\| fail \(results\.json pass\/skipped, failed\.json fail\/pass\) \|/m);
  assert.equal(combined.counts.pass, 1);
});

test('without results, named tests are not run and gaps remain visible', () => {
  const result = run();
  assert.match(result.report, /Static coverage only/);
  assert.equal(result.counts.pass, 0);
  assert.equal(result.counts['not run'], 4);
  assert.equal(result.counts.weak, 1);
  assert.equal(result.exitCode, 0);
});

test('relative paths from multiple report roots join once, and each cell names its sources', t => {
  const write = workspace(t);
  const first = read(passed);
  first.testResults[0].name = 'fixtures/chart.test.ts';
  const second = read(failed);
  second.testResults[0].name = 'test\\fixtures\\chart.test.ts';
  second.testResults[0].assertionResults.shift();
  const one = write('one.json', first);
  const two = write('two.json', second);
  const resultFiles = [one, two, one];
  const resultRoots = [resolve(root, '..'), resolve(root, '../..')];
  assert.equal(run({ resultFiles }).counts.pass, 0);
  const result = run({ resultFiles, resultRoots });
  assert.match(result.table, /^\| T-pointer-line \| [^|]+\| pass \(one\.json pass\/skipped, two\.json pass\) \|/m);
  assert.doesNotMatch(result.table, /\(one\.json pass, two\.json pass\)/);
  assert.equal(result.report.match(/one\.json.*passed assertions/g).length, 1);
});

test('an archived absolute result path can match its repository-relative suffix', t => {
  const write = workspace(t);
  const data = read(passed);
  data.testResults[0].name = 'C:\\old-checkout\\acceptance\\test\\fixtures\\chart.test.ts';
  const matrix = read(matrixFile).map(row => ({
    ...row,
    evidence: Object.fromEntries(Object.entries(row.evidence ?? {}).map(([type, refs]) => [
      type, refs.map(ref => ({ ...ref, file: 'test/fixtures/' + ref.file })),
    ])),
    weak: {},
  }));
  for (const name of ['chart.test.ts', 'cases.ts']) {
    write('test/fixtures/' + name, readFileSync(resolve(root, name)));
  }
  const spec = write('docs/02-product-spec.md', readFileSync(resolve(root, 'docs/02-product-spec.md')));
  const result = check({
    root: resolve(spec, '../..'),
    matrixFile: write('matrix.json', matrix),
    resultFiles: [write('archive.json', data)],
  });
  assert.equal(result.counts.pass, 2);
  assert.match(result.table, /\bpass \(archive\.json pass\)/);
});

test('a report path that matches two configured roots is rejected', t => {
  const write = workspace(t);
  const matrix = read(matrixFile);
  matrix[0].evidence.line.push({ ...matrix[0].evidence.line[0], file: 'other/chart.test.ts' });
  for (const dir of ['', 'other/']) for (const name of ['chart.test.ts', 'cases.ts']) {
    write(dir + name, readFileSync(resolve(root, name)));
  }
  const spec = write('docs/02-product-spec.md', readFileSync(resolve(root, 'docs/02-product-spec.md')));
  const options = {
    root: resolve(spec, '../..'),
    matrixFile: write('matrix.json', matrix),
    resultFiles: [passed],
    resultRoots: ['other'],
  };
  assert.throws(() => check(options), /ambiguous report path \.\/chart\.test\.ts/);
});

test('a dynamic title needs a source template and exactly the cited report suite', t => {
  const write = workspace(t);
  const matrix = read(matrixFile);
  const ref = matrix[0].evidence.line[0];
  ref.title = 'generated sample case';
  ref.registration = 'generated ${sample.label} case';
  ref.ancestors = ['generated cases'];
  const report = write('cases.json', { testResults: [{
    name: './chart.test.ts',
    assertionResults: [
      { title: ref.title, ancestorTitles: ['generated cases'], status: 'passed' },
      { title: ref.title, ancestorTitles: ['other suite'], status: 'failed' },
    ],
  }] });
  const result = run({ resultFiles: [report], matrixFile: write('matrix.json', matrix) });
  assert.match(result.table, /^\| F1 \| [^|]+\| pass \(cases\.json pass\) \|/m);
  ref.title = 'unrelated case';
  assert.throws(() => run({ matrixFile: write('invalid.json', matrix) }), /invalid source registration/);
});

test('a known coverage gap prevents passing despite positive results, but a required failure still counts', t => {
  const write = workspace(t);
  const matrix = read(matrixFile);
  matrix[0].gaps = { line: 'The browser still needs to prove the plot wraps.' };
  const matrixFileWithGap = write('gap.json', matrix);
  const result = run({ matrixFile: matrixFileWithGap, resultFiles: [passed] });
  assert.match(result.table, /^\| F1 \| [^|]+\| weak \(results\.json pass\) \|/m);
  assert.match(result.report, /The browser still needs to prove the plot wraps/);
  assert.match(run({ matrixFile: matrixFileWithGap, resultFiles: [failed] }).table,
    /^\| F1 \| [^|]+\| fail \(failed\.json fail\) \|/m);
});

test('packed size verdict uses exact bytes and names the measurement file', t => {
  const write = workspace(t);
  const matrix = read(matrixFile).map(row => ({ ...row, evidence: {}, weak: {} }));
  matrix[0].evidence = { line: [{ kind: 'size', file: 'size.json', entries: ['line only'] }] };
  const packed = { axylo: 'sha512-axylo', react: 'sha512-react' };
  const bytes = totalGzipBytes => ({
    packed, rows: [{ entry: 'line only', minBytes: 2000, totalGzipBytes, targetKiB: 1 }],
  });
  const spec = write('docs/02-product-spec.md', readFileSync(resolve(root, 'docs/02-product-spec.md')));
  const options = { root: resolve(spec, '../..'), matrixFile: write('matrix.json', matrix) };
  write('size.json', bytes(1024));
  assert.match(check(options).table, /\bpass \(size\.json pass\)/);
  write('size.json', bytes(1025));
  assert.match(check(options).table, /\bfail \(size\.json fail\)/);
});
