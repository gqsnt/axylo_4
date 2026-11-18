import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../check.mjs';
import { citedTestFiles, hashFile, snapshot } from '../provenance.mjs';

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
  assert.match(combined.table, /^\| T-pointer-line \| [^|]+\| fail \(failed\.json fail\/pass, results\.json pass\/skipped\) \|/m);
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
  assert.match(result.table, /^\| T-pointer-line \| [^|]+\| not run \(one\.json pass\/skipped, two\.json pass\) \|/m);
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

test('a suite that aborts before any assertion fails every cell citing its file', t => {
  const write = workspace(t);
  const data = { testResults: [{ name: 'chart.test.ts', status: 'failed', message: 'import error', assertionResults: [] }] };
  const result = run({ resultFiles: [write('abort.json', data)] });
  assert.equal(result.counts.fail, 5);
  assert.match(result.report, /Suite failed without a failing assertion result \(import error\)/);
  data.testResults[0].assertionResults = [{ title: 'other failed test', ancestorTitles: [], status: 'failed' }];
  const combined = run({ resultFiles: [write('both.json', data)] });
  assert.equal(combined.counts.fail, 5);
  assert.match(combined.report, /Suite failed in addition to its failing assertions/);
});

test('a skipped twin blocks passing across reports and a hidden registration under a prefix can fail it', t => {
  const write = workspace(t);
  const report = read(passed);
  const assertions = report.testResults[0].assertionResults;
  assertions.push({ ...assertions[0], status: 'skipped' });
  assertions.push({ title: 'registered through a helper', status: 'failed', ancestorTitles: ['render examples'] });
  const result = run({ resultFiles: [passed, write('negative.json', report)] });
  assert.match(result.table, /^\| F1 \| [^|]+\| not run \(.*pass\/skipped/m);
  assert.match(result.table, /^\| T-pointer-line \| [^|]+\| fail /m);
});

function fixtureWith(t, specTransform = spec => spec, sourceTransform = source => source) {
  const write = workspace(t);
  const specFile = 'docs/02-product-spec.md';
  const spec = specTransform(readFileSync(resolve(root, specFile), 'utf8'));
  const fixtureRoot = resolve(write(specFile, Buffer.from(spec)), '../..');
  write('chart.test.ts', Buffer.from(sourceTransform(readFileSync(resolve(root, 'chart.test.ts'), 'utf8'))));
  write('cases.ts', readFileSync(resolve(root, 'cases.ts')));
  return { write, root: fixtureRoot };
}

test('fatal source modifiers cannot be cited even if Vitest would report a pass', t => {
  const matrix = read(matrixFile);
  const name = matrix[0].evidence.line[0].title;
  for (const modifier of ['fails', 'todo', 'skip']) {
    const { write, root } = fixtureWith(t, undefined, source => source + `\nit.${modifier}(${JSON.stringify(name)})\n`);
    assert.throws(() => check({ root, matrixFile: write('matrix.json', matrix) }), new RegExp(`citation uses \\.${modifier}`));
  }
});

test('the spec reader recognizes decorated IDs and rejects criteria in unlisted sections', t => {
  const { write, root } = fixtureWith(t, spec => spec.replace('| F1 |', '  | **F1** |').replace('| F2 |', '| `F2` |').replace(/\|$/gm, '|  '));
  assert.equal(check({ root, matrixFile: write('matrix.json', read(matrixFile)) }).counts['not run'], 4);
  const unlisted = fixtureWith(t, spec => spec + '\n### 3.9 Additional requirements\n| _F13_ | Unknown |  \n');
  assert.throws(() => check({ root: unlisted.root, matrixFile }), /criterion F13 is in unlisted spec section 3\.9/);
});

test('release requires an explicit waiver per missing run or environment and cannot waive an assertion failure', t => {
  const write = workspace(t);
  const matrix = read(matrixFile);
  const waive = { reason: 'Fixture exercise', grantedBy: 'Test owner' };
  for (const row of matrix) {
    row.evidence = {};
    row.weak = {};
    for (const type of row.appliesTo) {
      row.pending ??= {};
      if (!row.cannotVerify?.[type]) row.pending[type] = 'Awaiting a test run.';
      row.waivers ??= {};
      row.waivers[type] = waive;
    }
  }
  assert.equal(run({ release: true, matrixFile: write('waivers.json', matrix) }).exitCode, 0);
  assert.match(run({ matrixFile: write('waivers.json', matrix) }).report, /Waiver granted by Test owner/);
  delete matrix[0].waivers.line;
  assert.equal(run({ release: true, matrixFile: write('waivers.json', matrix) }).exitCode, 1);
  matrix[0].waivers.line = { reason: 'Missing owner' };
  assert.throws(() => run({ matrixFile: write('waivers.json', matrix) }), /waiver needs a reason and who granted it/);
  matrix[0].waivers.line = waive;
  matrix[0].evidence.line = read(matrixFile)[0].evidence.line;
  assert.match(run({ matrixFile: write('waivers.json', matrix), resultFiles: [failed] }).table, /\| F1 \|[^|]+\| fail/);
});

test('report content is independent of report argument order', () => {
  assert.equal(run({ resultFiles: [passed, failed] }).report, run({ resultFiles: [failed, passed] }).report);
});

test('release verifies the commit, dirty source, cited test hashes, and result bytes', t => {
  const { write, root } = fixtureWith(t);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'Fixture');
  const matrix = read(matrixFile);
  const outputs = mkdtempSync(resolve(tmpdir(), 'axylo-results-'));
  t.after(() => rmSync(outputs, { recursive: true }));
  const report = resolve(outputs, 'run.json');
  const sidecar = resolve(outputs, 'run.provenance.json');
  writeFileSync(report, readFileSync(passed));
  const options = { root, matrixFile: write('matrix.json', matrix), resultFiles: [report], release: true };
  assert.match(check(options).report, /Provenance: missing · release requires recorded provenance/);
  const prior = snapshot(root, citedTestFiles(matrix));
  const recorded = { ...prior, resultSha256: hashFile(report) };
  const record = data => writeFileSync(sidecar, JSON.stringify(data));
  record(recorded);
  assert.deepEqual(check(options).runs.map(run => run.provenanceError), [undefined]);
  for (const bad of [{ commit: 'old' }, { dirty: !prior.dirty }, { hashes: {} }]) {
    record({ ...recorded, ...bad });
    assert.match(check(options).report, /provenance does not match the working tree/);
  }
  record({ ...recorded, changedDuringRun: true });
  assert.match(check(options).report, /release requires an unchanged working tree during the run/);
  record(recorded);
  writeFileSync(report, readFileSync(failed));
  assert.match(check(options).report, /provenance does not match the working tree/);
  writeFileSync(report, readFileSync(passed));
  // This second workspace change leaves the existing dirty status unchanged.
  write('matrix.json', [...matrix].reverse());
  assert.match(check(options).report, /provenance does not match the working tree/);
});
