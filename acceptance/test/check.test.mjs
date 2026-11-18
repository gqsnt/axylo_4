import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readTitles } from '../titles.mjs';
import { SIZE_TARGETS } from '../../scripts/size.mjs';
import test from 'node:test';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHART_TYPES, check, STATUSES } from '../check.mjs';
import { citedTestFiles, CONFIGS, CONFIGURATIONS, declaredEngines, defaultResultFile, hashFile, resultFiles, snapshot } from '../provenance.mjs';

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
    pass: 2, fail: 0, weak: 1, 'no evidence': 0, 'not run': 2, 'not recorded for this revision': 0, 'cannot be verified here': 1, 'not applicable': 18,
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

test('a scoped describe requires current cases for its chart and retains archived failures', t => {
  const { write, root } = fixtureWith(t, undefined, source => source + `
describe('I1 probes', () => {
  const span = 12 / 4;
  const pattern = () => /[\`{}]/;
  for (const type of ['line', 'area'] as const) {
    it(\`I1 \${type}: present \${type}\`, () => {});
  }
  it(\`I1 line: \${span > 1 ? \`wide \${span}\` : 'narrow'} readout\`, () => {});
});`);
  const matrix = read(matrixFile);
  matrix[0].evidence.line = [{
    kind: 'unit', file: 'chart.test.ts', prefix: 'I1 probes', casePrefix: 'I1 line:', cases: 2,
  }];
  const options = { root, matrixFile: write('matrix.json', matrix) };
  const assertion = (title, status) => ({ title, status, ancestorTitles: ['I1 probes'] });
  const summary = (title, status) => {
    const resultFiles = [write('scoped.json', { testResults: [{
      name: 'chart.test.ts',
      assertionResults: [assertion('I1 line: present line', 'passed'), assertion(title, status), assertion('I1 area: present area', 'failed')],
    }] })];
    return check({ ...options, resultFiles }).table;
  };
  assert.match(summary('I1 line: wide 3 readout', 'passed'), /\| F1 \|[^|]+\| pass \(scoped\.json pass\)/);
  assert.match(summary('I1 line: older test', 'passed'), /\| F1 \|[^|]+\| not run \(scoped\.json pass\)/);
  assert.match(summary('I1 line: older test', 'failed'), /\| F1 \|[^|]+\| fail \(scoped\.json fail\/pass\)/);
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
  // The React adapter is gone (owner's decision, 2026-11-18): the artifact names the core's tarball only.
  const packed = { axylo: 'sha512-axylo' };
  const bytes = totalGzipBytes => ({
    packed, rows: [{ entry: 'line only', minBytes: 2000, totalGzipBytes, targetKiB: 1 }],
  });
  const spec = write('docs/02-product-spec.md', readFileSync(resolve(root, 'docs/02-product-spec.md')));
  const options = { root: resolve(spec, '../..'), matrixFile: write('matrix.json', matrix), packIntegrity: 'sha512-axylo', sizeTargets: { 'line only': 1 } };
  write('size.json', bytes(1024));
  assert.match(check(options).table, /\bpass \(size\.json pass\)/);
  write('size.json', bytes(1025));
  assert.match(check(options).table, /\bfail \(size\.json fail\)/);
  // A measurement that does not say which packed core it measured is refused.
  write('size.json', { ...bytes(1024), packed: {} });
  assert.throws(() => check(options), /size\.json: expected packed size measurements/);
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

// ── engines (AXYLO_ENGINE) ──────────────────────────────────────────────────────────────────────────

/** F1's line cell cites `line renders` as browser evidence, optionally for named engines. */
function browserMatrix(...engines) {
  const matrix = read(matrixFile);
  const ref = { file: 'chart.browser.test.ts', kind: 'browser', title: 'line renders' };
  matrix[0].evidence.line = engines.length ? engines.map(engine => (engine ? { ...ref, engine } : ref)) : [ref];
  return matrix;
}

/** A report of `line renders` with the harness's engine record (none when `engine` is null). */
function engineReport(engine, status = 'passed', version = { chromium: '157.0.8103.78', firefox: '159.0', webkit: '27.2' }[engine], extra = {}) {
  const meta = engine ? { engine, engineVersion: version, ...extra } : undefined;
  return { testResults: [{ name: './chart.browser.test.ts', assertionResults: [
    { title: 'line renders', ancestorTitles: ['render examples'], status, ...(meta ? { meta } : {}) },
  ] }] };
}

const lineCell = table => /^\| F1 \| [^|]+\| ([^|]+) \|/m.exec(table)[1].trim();

test('a browser citation is answered only by results of its own engine, Chrome when it names none', t => {
  const write = workspace(t);
  const firefox = write('browser-firefox.json', engineReport('firefox'));
  const chrome = write('browser.json', engineReport('chromium'));
  const legacy = write('legacy.json', engineReport(null));
  const cell = (matrix, ...files) => {
    const result = run({ matrixFile: write('matrix.json', matrix), resultFiles: files });
    return { cell: lineCell(result.table), report: result.report };
  };
  // A Firefox pass is no evidence for a citation that needs Chrome.
  const unanswered = cell(browserMatrix(), firefox);
  assert.equal(unanswered.cell, 'not run');
  assert.match(unanswered.report, /line · Required assertions have no matching passing result\. No Chrome result\./);
  assert.equal(cell(browserMatrix('firefox'), firefox).cell, 'pass (browser-firefox.json pass)');
  assert.equal(cell(browserMatrix(), chrome, firefox).cell, 'pass (browser.json pass)');
  // Results that predate the engine record were all Chrome.
  assert.equal(cell(browserMatrix(), legacy).cell, 'pass (legacy.json pass)');
  assert.equal(cell(browserMatrix('firefox'), legacy).cell, 'not run');
  // Cited for two engines, the cell needs both; a failure on one engine fails only the citations for it.
  assert.equal(cell(browserMatrix(null, 'firefox'), chrome).cell, 'not run (browser.json pass)');
  const failing = write('browser-webkit.json', engineReport('webkit', 'failed'));
  assert.equal(cell(browserMatrix(), chrome, failing).cell, 'pass (browser.json pass)');
  assert.equal(cell(browserMatrix(null, 'webkit'), chrome, failing).cell, 'fail (browser.json pass, browser-webkit.json fail)');
});

test('a results file that mixes engines, or disagrees with its sidecar, is refused', t => {
  const write = workspace(t);
  const mixed = engineReport('chromium');
  mixed.testResults[0].assertionResults.push({ ...engineReport('firefox').testResults[0].assertionResults[0], title: 'area renders' });
  assert.throws(() => run({ resultFiles: [write('mixed.json', mixed)] }), /mixed\.json: mixes engines \(chromium, firefox\); run each engine into its own results file/);
  const versions = engineReport('firefox');
  versions.testResults[0].assertionResults.push({ ...versions.testResults[0].assertionResults[0], title: 'area renders', meta: { engine: 'firefox', engineVersion: '160.0' } });
  assert.throws(() => run({ resultFiles: [write('versions.json', versions)] }), /mixes engine versions \(firefox 159\.0, firefox 160\.0\)/);
  const report = write('browser-webkit.json', engineReport('webkit'));
  write('browser-webkit.provenance.json', { engine: 'firefox' });
  assert.throws(() => run({ resultFiles: [report] }), /the provenance records firefox but the results declare webkit/);
  assert.throws(() => run({ resultFiles: [write('odd.json', engineReport('safari'))] }), /unknown engine "safari"/);
});

test('a test reported as not run on an engine is "not run" with its reason, never a pass', t => {
  const write = workspace(t);
  const reason = "webkit: the browser's own computed accessibility tree is read through the Chrome DevTools protocol";
  const report = write('browser-webkit.json', engineReport('webkit', 'skipped', '27.2', { notRun: reason }));
  const result = run({ matrixFile: write('matrix.json', browserMatrix('webkit')), resultFiles: [report] });
  assert.equal(lineCell(result.table), 'not run (browser-webkit.json skipped)');
  assert.ok(result.report.includes(`Not run on ${reason}.`));
  assert.equal(result.counts.pass, 0);
});

test('the report names the engine of each run, and WebKit is not Safari', t => {
  const write = workspace(t);
  const result = run({ resultFiles: [
    write('browser.json', engineReport('chromium')),
    write('browser-firefox.json', engineReport('firefox')),
    write('browser-webkit.json', engineReport('webkit')),
  ] });
  assert.match(result.report, /`[^`]*browser\.json` · Chrome 157\.0\.8103\.78 · 1 passed assertions/);
  assert.match(result.report, /`[^`]*browser-firefox\.json` · Firefox \(Playwright\) 159\.0 · /);
  assert.match(result.report, /`[^`]*browser-webkit\.json` · WebKit \(Playwright\), not Safari 27\.2 · /);
  // Node results and archived Chrome results carry no engine and the report claims none for them.
  assert.match(run({ resultFiles: [passed] }).report, /`[^`]*results\.json` · 2 passed assertions/);
});

test('only browser evidence takes an engine, and only a known one', t => {
  const write = workspace(t);
  const unit = read(matrixFile);
  unit[0].evidence.line[0].engine = 'firefox';
  assert.throws(() => run({ matrixFile: write('unit.json', unit) }), /F1\/line: only browser evidence takes an engine/);
  assert.throws(() => run({ matrixFile: write('safari.json', browserMatrix('safari')) }), /F1\/line: unknown engine: safari \(expected chromium, firefox, webkit\)/);
});

test('in a run on another engine, a test without an engine record stands for no engine', t => {
  const write = workspace(t);
  // The docs and distribution suites launch Chrome themselves whatever AXYLO_ENGINE says.
  const report = engineReport('firefox');
  report.testResults[0].assertionResults[0].title = 'area renders';
  report.testResults[0].assertionResults.push(engineReport(null).testResults[0].assertionResults[0]);
  const resultFiles = [write('browser-firefox.json', report)];
  for (const engine of [null, 'firefox']) {
    const result = run({ matrixFile: write('matrix.json', browserMatrix(engine)), resultFiles });
    assert.equal(lineCell(result.table), 'not run');
    assert.match(result.report, /browser-firefox\.json: engine not recorded in a Firefox \(Playwright\) run\./);
  }
  // In a Chrome run the same test is Chrome's.
  const chrome = engineReport('chromium');
  chrome.testResults[0].assertionResults[0].title = 'area renders';
  chrome.testResults[0].assertionResults.push(engineReport(null).testResults[0].assertionResults[0]);
  assert.equal(lineCell(run({ matrixFile: write('matrix.json', browserMatrix()), resultFiles: [write('browser.json', chrome)] }).table), 'pass (browser.json pass)');
});

test('run.mjs names a results file per engine and reads the engine the results declare', () => {
  assert.equal(defaultResultFile('browser'), 'acceptance/results/browser.json');
  assert.equal(defaultResultFile('browser', 'chromium'), 'acceptance/results/browser.json');
  assert.equal(defaultResultFile('browser', 'firefox'), 'acceptance/results/browser-firefox.json');
  assert.equal(defaultResultFile('browser', 'webkit'), 'acceptance/results/browser-webkit.json');
  assert.equal(defaultResultFile('unit', 'webkit'), 'acceptance/results/unit.json');
  assert.deepEqual(declaredEngines(engineReport('webkit')), { engines: ['webkit'], versions: ['webkit 27.2'] });
  assert.deepEqual(declaredEngines(read(passed)), { engines: [], versions: [] });
});

// ── structured output (the docs' conformance page) ─────────────────────────────────────────────────

test('check() returns the table as data: per cell its status, reasons and reports with engine and provenance error', t => {
  const write = workspace(t);
  const files = [write('browser.json', engineReport('chromium')), write('browser-webkit.json', engineReport('webkit', 'skipped', '27.2', { notRun: 'webkit: no CDP' }))];
  // Not release mode: these runs have no provenance record, which a release refuses (the stale-run test below).
  const result = run({ matrixFile: write('matrix.json', browserMatrix(null, 'webkit')), resultFiles: files });
  // Every row and cell of the Markdown table, and nothing else, with the same status.
  const tableRows = result.table.split('\n').slice(2).map(line => line.slice(2, -2).split(' | '));
  assert.deepEqual(result.rows.map(row => row.id), tableRows.map(cells => cells[0]));
  for (const [i, row] of result.rows.entries()) {
    assert.deepEqual(Object.keys(row.cells), [...CHART_TYPES]);
    for (const [j, type] of CHART_TYPES.entries()) {
      const text = tableRows[i][j + 2];
      assert.ok(text === row.cells[type].status || text.startsWith(`${row.cells[type].status} (`), `${row.id}/${type}: ${text}`);
    }
  }
  const line = result.rows.find(row => row.id === 'F1').cells.line;
  assert.equal(line.status, 'not run');
  assert.deepEqual(line.reasons, ['Not run on webkit: no CDP']);
  assert.deepEqual(line.reports, [
    { file: relative(root, files[0]), label: 'browser.json', source: 'run', results: ['pass'], engine: 'chromium', engineVersion: '157.0.8103.78', provenanceError: null },
    { file: relative(root, files[1]), label: 'browser-webkit.json', source: 'run', results: ['skipped'], engine: 'webkit', engineVersion: '27.2', provenanceError: null },
  ]);
  // Archived Node results have no engine.
  const plain = run({ resultFiles: [passed] }).rows.find(row => row.id === 'F1').cells.line.reports;
  assert.deepEqual(plain, [{ file: 'results.json', label: 'results.json', source: 'run', results: ['pass'], engine: null, engineVersion: null, provenanceError: null }]);
  assert.equal(result.rows.find(row => row.id === 'F1').cells.scatter.status, 'not applicable');
});

test('the status list is exported and is the README\'s table', () => {
  const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');
  const documented = [...readme.matchAll(/^\| ([a-z ]+) \| .+ \|$/gm)].map(m => m[1]).filter(s => s !== 'status');
  assert.deepEqual([...STATUSES], documented);
  assert.ok(Object.isFrozen(STATUSES) && Object.isFrozen(CHART_TYPES));
});

test('the configurations and their default result files come from provenance.mjs, which run.mjs uses', () => {
  assert.deepEqual([...CONFIGS], ['unit', 'browser', 'dist', 'dist-browser']);
  assert.deepEqual(resultFiles(), [
    { config: 'unit', engine: null, file: 'acceptance/results/unit.json' },
    { config: 'browser', engine: 'chromium', file: 'acceptance/results/browser.json' },
    { config: 'browser', engine: 'firefox', file: 'acceptance/results/browser-firefox.json' },
    { config: 'browser', engine: 'webkit', file: 'acceptance/results/browser-webkit.json' },
    { config: 'dist', engine: null, file: 'acceptance/results/dist.json' },
    { config: 'dist-browser', engine: 'chromium', file: 'acceptance/results/dist-browser.json' },
  ]);
  assert.deepEqual([...CONFIGURATIONS.dist], ['--config', 'tests/dist/vitest.config.ts']);
  const runner = readFileSync(fileURLToPath(new URL('../run.mjs', import.meta.url)), 'utf8');
  assert.match(runner, /CONFIGURATIONS as configs/);
  assert.doesNotMatch(runner, /'dist-browser':/);
});

// ── the reviewed checker defects (reviews/2026-11-18/impl/wp/matrix-merge.report.md) ──────────────────────

/** A fixture tree under Git, so provenance can be recorded and compared. */
function gitFixture(t, sourceTransform) {
  const fixture = fixtureWith(t, undefined, sourceTransform);
  const git = (...args) => execFileSync('git', args, { cwd: fixture.root, stdio: ['ignore', 'pipe', 'inherit'] });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'Fixture');
  return fixture;
}

test('defect 5: a size record counts only for the pack this tree makes, against the targets of scripts/size.mjs', t => {
  const write = workspace(t);
  const matrix = read(matrixFile).map(row => ({ ...row, evidence: {}, weak: {} }));
  matrix[0].evidence = { line: [{ kind: 'size', file: 'size.json', entries: ['line only'] }] };
  const spec = write('docs/02-product-spec.md', readFileSync(resolve(root, 'docs/02-product-spec.md')));
  const options = { root: resolve(spec, '../..'), matrixFile: write('matrix.json', matrix), sizeTargets: { 'line only': 1 } };
  // The record's own targetKiB (1000) is not read: 1025 bytes is over the 1 KiB target.
  const record = totalGzipBytes => ({ packed: { axylo: 'sha512-measured', commit: 'abc1234' }, rows: [{ entry: 'line only', minBytes: 2000, totalGzipBytes, targetKiB: 1000 }] });
  write('size.json', record(1025));
  assert.match(check({ ...options, packIntegrity: 'sha512-measured' }).table, /\| F1 \| [^|]+\| fail \(size\.json fail\) \|/);
  write('size.json', record(1000));
  assert.match(check({ ...options, packIntegrity: 'sha512-measured' }).table, /\| F1 \| [^|]+\| pass \(size\.json pass\) \|/);
  // Another pack: never pass.
  const other = check({ ...options, packIntegrity: 'sha512-current' });
  assert.match(other.table, /\| F1 \| [^|]+\| not recorded for this revision \(size\.json not recorded\) \|/);
  assert.match(other.report, /size\.json: the size record measured another pack/);
  assert.match(other.report, /Not recorded for this revision: the record measured another pack/);
  assert.equal(other.rows[0].cells.line.reports[0].provenanceError, 'the size record measured another pack (sha512-measured)');
  assert.equal(other.counts.pass, 0);
  // A row without a target in scripts/size.mjs cannot be cited.
  assert.throws(() => check({ ...options, sizeTargets: {}, packIntegrity: 'sha512-measured' }), /no size target for line only \(scripts\/size\.mjs, SIZE_TARGETS\)/);
});

test('defect 5: the size targets are written once, in scripts/size.mjs, and are the spec DX7 row\'s', () => {
  const spec = readFileSync(fileURLToPath(new URL('../../docs/02-product-spec.md', import.meta.url)), 'utf8');
  const dx7 = spec.split('\n').find(line => line.startsWith('| DX7 |'));
  assert.deepEqual(Object.values(SIZE_TARGETS), [98, 116]);
  assert.match(dx7, /116 KiB gzipped for everything and 98 KiB for a page that uses only `line`/);
});

test('defect 8: a run whose provenance is another tree answers nothing, in every mode, and is still listed with its error', t => {
  const { write, root: fixtureRoot } = gitFixture(t);
  const outputs = mkdtempSync(resolve(tmpdir(), 'axylo-stale-'));
  t.after(() => rmSync(outputs, { recursive: true }));
  const report = resolve(outputs, 'run.json');
  writeFileSync(report, readFileSync(failed));
  const matrix = read(matrixFile);
  const options = { root: fixtureRoot, matrixFile: write('matrix.json', matrix), resultFiles: [report] };
  const recorded = { ...snapshot(fixtureRoot, citedTestFiles(matrix)), resultSha256: hashFile(report) };
  writeFileSync(resolve(outputs, 'run.provenance.json'), JSON.stringify(recorded));
  // Matching provenance: the failure counts.
  assert.match(check(options).table, /^\| F1 \| [^|]+\| fail \(run\.json fail\) \|/m);
  // Another tree: neither its failure nor its pass sets a status.
  writeFileSync(resolve(outputs, 'run.provenance.json'), JSON.stringify({ ...recorded, commit: 'old' }));
  for (const release of [false, true]) {
    const result = check({ ...options, release });
    assert.match(result.table, /^\| F1 \| [^|]+\| not recorded for this revision \(run\.json not recorded\) \| weak \(run\.json not recorded\) \|/m);
    assert.equal(result.counts.fail, 0);
    assert.equal(result.counts.pass, 0);
    assert.match(result.report, /run\.json` · 1 passed assertions, 1 reported failures\n {2}- Provenance: commit old, .* · provenance does not match the working tree/);
    assert.match(result.report, /### Not recorded for this revision\n\n- \*\*F1\*\* · line · run\.json: not recorded for this revision \(provenance does not match the working tree\)\./);
    assert.equal(result.rows[0].cells.line.reports[0].provenanceError, 'provenance does not match the working tree');
    assert.deepEqual(result.rows[0].cells.line.reports[0].results, ['not recorded']);
  }
  // Without a record only a release refuses the run.
  rmSync(resolve(outputs, 'run.provenance.json'));
  assert.match(check(options).table, /^\| F1 \| [^|]+\| fail \(run\.json fail\) \|/m);
  assert.match(check({ ...options, release: true }).table, /^\| F1 \| [^|]+\| not recorded for this revision /m);
});

test('defect 1: atLeast cites a suite of cases the scan cannot list, answered by the results', t => {
  const { write, root: fixtureRoot } = fixtureWith(t, undefined, source => source + `
const examples = discover();
describe('examples render', () => {
  it.each(examples)('%s renders', () => {});
  it('the inventory is not empty', () => {});
});`);
  const matrix = read(matrixFile);
  // atLeast counts the distinct passing tests under the prefix, the listed ones included: 3 cases + the inventory.
  matrix[0].evidence.line = [{ kind: 'unit', file: 'chart.test.ts', prefix: 'examples render', atLeast: 4 }];
  const options = { root: fixtureRoot, matrixFile: write('matrix.json', matrix) };
  const result = (cases, extra = []) => check({ ...options, resultFiles: [write('examples.json', { testResults: [{ name: 'chart.test.ts', assertionResults: [
    ...cases.map(([title, status]) => ({ title, status, ancestorTitles: ['examples render'] })),
    ...extra,
  ] }] })] }).table;
  const inventory = ['the inventory is not empty', 'passed'];
  assert.match(result([['a renders', 'passed'], ['b renders', 'passed'], ['c renders', 'passed'], inventory]), /\| F1 \| [^|]+\| pass \(examples\.json pass\) \|/);
  assert.match(result([['a renders', 'passed'], ['b renders', 'passed'], inventory]), /\| F1 \| [^|]+\| not run \(examples\.json pass\) \|/);
  assert.match(result([['a renders', 'passed'], ['b renders', 'failed'], ['c renders', 'passed'], ['d renders', 'passed'], inventory]), /\| F1 \| [^|]+\| fail \(examples\.json fail\/pass\) \|/);
  // The suite's titles the scan does know must still be among the passes.
  assert.match(result([['a renders', 'passed'], ['b renders', 'passed'], ['c renders', 'passed'], ['d renders', 'passed']]), /\| F1 \| [^|]+\| not run \(examples\.json pass\) \|/);
  // A skipped case keeps it from passing.
  assert.match(result([['a renders', 'passed'], ['b renders', 'passed'], ['c renders', 'passed'], ['d renders', 'skipped'], inventory]), /\| F1 \| [^|]+\| not run /);
  matrix[0].evidence.line = [{ kind: 'unit', file: 'chart.test.ts', prefix: 'render examp', atLeast: 1 }];
  assert.throws(() => check({ ...options, matrixFile: write('known.json', matrix) }), /atLeast is for a suite whose cases the source scan cannot list/);
});

test('defect 4: a title registered under a condition, or matched only by a template, needs a run that shows it', t => {
  const { write, root: fixtureRoot } = fixtureWith(t, undefined, source => source + `
describe('conditional', () => {
  for (const type of ['line', 'area'] as const) {
    if (type === 'line') it(\`only \${type}\`, () => {});
  }
  const name = pick();
  it(\`computed \${name}\`, () => {});
});`);
  const scan = readTitles(readFileSync(resolve(fixtureRoot, 'chart.test.ts'), 'utf8'), resolve(fixtureRoot, 'chart.test.ts'));
  assert.deepEqual(scan.tests.filter(test => test.title?.startsWith('only')).map(test => [test.title, test.conditional]), [['only line', true], ['only area', true]]);
  const cite = refs => { const matrix = read(matrixFile); matrix[0].evidence.line = refs; return write('matrix.json', matrix); };
  const ran = titles => write('ran.json', { testResults: [{ name: 'chart.test.ts', assertionResults: titles.map(title => ({ title, status: 'passed', ancestorTitles: ['conditional'] })) }] });
  const area = { kind: 'unit', file: 'chart.test.ts', title: 'only area' };
  const donut = { kind: 'unit', file: 'chart.test.ts', title: 'computed donut', registration: 'computed ${name}' };
  // No run of the file and no EVIDENCE.json beside it: accepted, with a warning the report lists.
  const unconfirmed = check({ root: fixtureRoot, matrixFile: cite([area, donut]) });
  assert.deepEqual(unconfirmed.warnings, [
    'F1/line: title not confirmed by any run (it is registered under a condition) in chart.test.ts: only area',
    'F1/line: title not confirmed by any run (it matches a template only) in chart.test.ts: computed donut',
  ]);
  assert.match(unconfirmed.report, /## Warnings[\s\S]*title not confirmed by any run \(it is registered under a condition\) in chart\.test\.ts: only area/);
  // A run of the file without those titles: structural errors.
  assert.throws(() => check({ root: fixtureRoot, matrixFile: cite([area, donut]), resultFiles: [ran(['only line', 'computed sample'])] }),
    /F1\/line: title never ran in chart\.test\.ts \(it is registered under a condition\): only area\nF1\/line: title never ran in chart\.test\.ts \(it matches a template only\): computed donut/);
  // An EVIDENCE.json beside the file that lists them confirms them, as does a run that has them.
  write('EVIDENCE.json', [{ file: 'chart.test.ts', title: 'only area' }, { file: 'chart.test.ts', title: 'computed donut' }]);
  assert.deepEqual(check({ root: fixtureRoot, matrixFile: cite([area, donut]) }).warnings, []);
  write('EVIDENCE.json', [{ file: 'chart.test.ts', title: 'only line' }]);
  assert.throws(() => check({ root: fixtureRoot, matrixFile: cite([area]) }), /title never ran in chart\.test\.ts \(it is registered under a condition\): only area/);
  assert.match(check({ root: fixtureRoot, matrixFile: cite([area]), resultFiles: [ran(['only line', 'only area'])] }).table, /\| F1 \| [^|]+\| pass \(ran\.json pass\) \|/);
});

test('defect 6: a browser citation must name a browser test file, and a Node citation must not', t => {
  const write = workspace(t);
  const browser = read(matrixFile);
  browser[0].evidence.line = [{ kind: 'browser', file: 'chart.test.ts', title: 'line renders' }];
  assert.throws(() => run({ matrixFile: write('browser.json', browser) }), /F1\/line: a browser citation names a file that is not a browser test \(\*\.browser\.test\.\*\): chart\.test\.ts/);
  const unit = read(matrixFile);
  unit[0].evidence.line = [{ kind: 'unit', file: 'chart.browser.test.ts', title: 'line renders' }];
  assert.throws(() => run({ matrixFile: write('unit.json', unit) }), /F1\/line: a unit citation names a browser test file: chart\.browser\.test\.ts/);
});

test('defects 2 and 3: describe.each suites get the ancestors a run gives them', t => {
  const { write, root: fixtureRoot } = fixtureWith(t, undefined, source => source + `
const modes = computeModes();
describe.each(modes)('mode %s', () => {
  it('inner case', () => {});
});
describe.each([['first'], ['second']])('row %s', () => {
  it('row case', () => {});
});`);
  const scan = readTitles(readFileSync(resolve(fixtureRoot, 'chart.test.ts'), 'utf8'), resolve(fixtureRoot, 'chart.test.ts'));
  // Literal rows: one test per row's suite, never one test in both.
  assert.deepEqual(scan.tests.filter(test => test.title === 'row case').map(test => test.ancestors), [['row first'], ['row second']]);
  // Computed rows: one suite of unknown title.
  assert.deepEqual(scan.tests.filter(test => test.title === 'inner case').map(test => test.ancestors), [[null]]);
  const matrix = read(matrixFile);
  matrix[0].evidence.line = [{ kind: 'unit', file: 'chart.test.ts', title: 'inner case' }];
  matrix[0].evidence.bar = [{ kind: 'unit', file: 'chart.test.ts', title: 'row case', ancestors: ['row first'] }];
  const results = write('each.json', { testResults: [{ name: 'chart.test.ts', assertionResults: [
    { title: 'inner case', status: 'passed', ancestorTitles: ['mode light'] },
    { title: 'inner case', status: 'passed', ancestorTitles: ['mode dark'] },
    { title: 'row case', status: 'passed', ancestorTitles: ['row first'] },
    { title: 'row case', status: 'passed', ancestorTitles: ['row second'] },
  ] }] });
  const table = check({ root: fixtureRoot, matrixFile: write('matrix.json', matrix), resultFiles: [results] }).table;
  assert.match(table, /^\| F1 \| [^|]+\| pass \(each\.json pass\) \| [^|]+\| pass \(each\.json pass\) \|/m);
});

test('defect 1: it.each over a const list declared in the file expands to its titles', t => {
  const { root: fixtureRoot } = fixtureWith(t, undefined, source => source + `
const combos = [['line', false], ['bar', true]] as const;
describe('combinations', () => {
  it.each(combos)('%s (compact: %s)', () => {});
});`);
  const file = resolve(fixtureRoot, 'chart.test.ts');
  const scan = readTitles(readFileSync(file, 'utf8'), file);
  assert.deepEqual(scan.tests.filter(test => test.ancestors[0] === 'combinations').map(test => test.title), ['line (compact: false)', 'bar (compact: true)']);
});
