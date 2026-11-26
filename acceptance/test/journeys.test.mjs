import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { check } from '../check.mjs';
import { evaluateJourneys, JOURNEY_IDS, PERS_KINDS, readJourneys, renderJourneysMarkdown } from '../journeys.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fixtureMatrix = resolve(fixtures, 'matrix.json');
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const realMatrixIds = () => read(resolve(repo, 'acceptance/matrix.json')).map(row => row.id);

function workspace(t) {
  const directory = mkdtempSync(resolve(tmpdir(), 'axylo-pers-'));
  t.after(() => rmSync(directory, { recursive: true }));
  return (name, data) => {
    const file = resolve(directory, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
    return file;
  };
}

/** Twelve journeys over the fixture tree: every one cites F1, the fixture row whose line cell failed.json fails. */
function fixtureJourneys(edit = journeys => journeys) {
  return edit(JOURNEY_IDS.map(id => ({
    id, title: `Journey ${id}`, owner: 'fixture-owner',
    outcomeGuarantees: ['The reader sees the fixture faithfully.'],
    applicableKinds: ['line', 'area', 'bar'],
    matrixIds: ['F1'],
    testFiles: ['chart.test.ts'],
    screenshots: [], benchWorkloads: [], rehearsalTasks: [],
    accessibilityEvidence: { automated: ['chart.browser.test.ts'],
      manualAt: { status: 'not-applicable', environments: [], protocolNote: 'Fixture.' } },
    ownedGaps: [],
  })));
}

test('the real journeys index names all twelve journeys and every citation resolves', () => {
  const journeys = readJourneys({ root: repo, matrixIds: realMatrixIds() });
  assert.deepEqual(journeys.map(journey => journey.id), [...JOURNEY_IDS]);
  assert.deepEqual([...PERS_KINDS], ['line', 'area', 'bar', 'histogram', 'scatter', 'donut', 'compact']);
  for (const journey of journeys) {
    const { automated, manualAt } = journey.accessibilityEvidence;
    // Automated ARIA evidence and manual assistive-technology status are recorded apart, never merged.
    assert.ok(Array.isArray(automated) && automated.length > 0, `${journey.id}: automated ARIA evidence`);
    assert.ok(['verified', 'waived-for-1.0', 'gap-open', 'not-applicable'].includes(manualAt.status), journey.id);
    if (journey.applicableKinds.includes('histogram')) {
      assert.ok(journey.testFiles.some(file => file.includes('histogram'))
        || journey.ownedGaps.some(gap => gap.kinds.includes('histogram')), `${journey.id}: histogram citation`);
    }
  }
  // The matrix has no histogram column, so every histogram journey must own that gap explicitly.
  for (const journey of journeys.filter(journey => journey.applicableKinds.includes('histogram'))) {
    assert.ok(journey.ownedGaps.some(gap => gap.id === 'histogram-matrix-column'), journey.id);
  }
  const keyboard = journeys.find(journey => journey.id === 'keyboard');
  assert.ok(keyboard.matrixIds.includes('A3'));
  assert.notEqual(keyboard.accessibilityEvidence.manualAt.status, 'verified', 'A3 manual AT has not been run');
  const customization = journeys.find(journey => journey.id === 'customization');
  assert.equal(customization.accessibilityEvidence.manualAt.status, 'not-applicable');
  assert.ok(customization.ownedGaps.some(gap => gap.id === 'windows-forced-colors'));
  for (const journey of journeys) {
    for (const gap of journey.ownedGaps) {
      assert.notEqual(gap.targetCycle, 'C2', `${journey.id}.${gap.id} should not target C2`);
    }
  }
});

test('check({ pers: true }) on the real repository evaluates all twelve journeys without blocking', () => {
  const result = check({ root: repo, pers: true });
  assert.equal(result.pers.journeys.length, 12);
  assert.deepEqual(result.pers.journeys.map(journey => journey.id), [...JOURNEY_IDS]);
  assert.ok(result.pers.journeys.filter(journey => journey.histogramApplies).every(journey => journey.histogramCited));
  assert.equal(result.pers.summary.histogramApplicable, 11);
  assert.equal(result.pers.summary.histogramTestBacked + result.pers.summary.histogramGapOnly, 11);
  assert.ok(result.pers.summary.histogramGapOnly > 0);
  assert.match(result.report, /## Product Experience Regression Suite \(12 journeys\)/);
  assert.match(result.report, /11 histogram-applicable \(\d+ test-backed, \d+ gap-only\)/);
  assert.doesNotMatch(result.report, /cover histogram/);
  assert.equal(result.pers.blocked, false);
  assert.equal(result.exitCode, 0);
});

test('a missing journey is refused', t => {
  const write = workspace(t);
  const journeysFile = write('journeys.json', fixtureJourneys(journeys => journeys.filter(journey => journey.id !== 'live-data')));
  assert.throws(() => readJourneys({ root: fixtures, journeysFile, matrixIds: ['F1'] }), /missing journey: live-data/);
});

test('a duplicated or unknown journey is refused', t => {
  const write = workspace(t);
  const journeysFile = write('journeys.json', fixtureJourneys(journeys => [...journeys, { ...journeys[0] }, { ...journeys[1], id: 'telepathy' }]));
  assert.throws(() => readJourneys({ root: fixtures, journeysFile, matrixIds: ['F1'] }),
    /duplicate journey: first-impression[\s\S]*unknown journey: "telepathy"/);
});

test('an unknown matrix ID is refused', t => {
  const write = workspace(t);
  const journeysFile = write('journeys.json', fixtureJourneys(journeys => { journeys[2].matrixIds = ['F1', 'F404']; return journeys; }));
  assert.throws(() => readJourneys({ root: fixtures, journeysFile, matrixIds: ['F1'] }), /hover\.matrixIds: unknown matrix ID F404/);
});

test('a test file that does not exist is refused', t => {
  const write = workspace(t);
  const journeysFile = write('journeys.json', fixtureJourneys(journeys => { journeys[0].testFiles = ['missing.test.ts']; return journeys; }));
  assert.throws(() => readJourneys({ root: fixtures, journeysFile, matrixIds: ['F1'] }), /first-impression\.testFiles: missing file missing\.test\.ts/);
});

test('malformed fields are refused: kind, owner, guarantees, manual AT, rehearsal task, and evidence-free journeys', t => {
  const write = workspace(t);
  const journeysFile = write('journeys.json', fixtureJourneys(journeys => {
    journeys[0].applicableKinds = ['line', 'pie'];
    journeys[1].owner = ' ';
    journeys[2].outcomeGuarantees = [];
    journeys[3].accessibilityEvidence.manualAt = { status: 'probably', environments: [], protocolNote: '' };
    journeys[4].rehearsalTasks = ['no-such-task'];
    journeys[5].testFiles = [];
    journeys[6].applicableKinds = ['histogram'];
    return journeys;
  }));
  assert.throws(() => readJourneys({ root: fixtures, journeysFile, matrixIds: ['F1'] }), error => {
    for (const expected of ['first-impression.applicableKinds: unknown kind pie', 'reading.owner must name an owner',
      'hover.outcomeGuarantees must not be empty', 'explore.accessibilityEvidence.manualAt.status: unknown status "probably"',
      'explore.accessibilityEvidence.manualAt.protocolNote must be a non-empty string',
      'compare.rehearsalTasks: missing rehearsal/prompts/no-such-task.md', 'resize: no test files and no owned gap',
      'mobile-touch: histogram applies but no histogram test file or histogram gap is cited']) {
      assert.ok(error.message.includes(expected), `expected: ${expected}\n${error.message}`);
    }
    return true;
  });
});

test('a failing result fails the journeys that cite it and blocks --pers', t => {
  const write = workspace(t);
  const journeysFile = write('journeys.json', fixtureJourneys());
  const options = { root: fixtures, matrixFile: fixtureMatrix, resultFiles: [resolve(fixtures, 'failed.json')] };
  // Without --pers the failure blocks only a release, as before.
  assert.equal(check(options).exitCode, 0);
  const result = check({ ...options, pers: true, journeysFile });
  assert.equal(result.exitCode, 1);
  assert.equal(result.pers.blocked, true);
  const first = result.pers.journeys.find(journey => journey.id === 'first-impression');
  assert.equal(first.status, 'fail');
  assert.equal(first.cells.fail, 1);
  assert.deepEqual(first.failing, ['F1/line: fail', 'chart.test.ts: line renders']);
  assert.match(result.report, /### Failing journey evidence\n\n- \*\*first-impression\*\* · F1\/line: fail; chart\.test\.ts: line renders/);
});

test('a failing test cited only by journeys (outside matrix.json) fails those journeys and blocks --pers', t => {
  const write = workspace(t);
  const histogramPath = 'packages/axylo/test/browser/chart/histogram.browser.test.ts';
  const synthetic = write('histogram-failed.json', {
    testResults: [{
      name: `/archived/checkout/${histogramPath}`,
      status: 'failed',
      assertionResults: [{
        title: 'renders histogram bars with interval labels',
        ancestorTitles: ['histogram'],
        status: 'failed',
        meta: { engine: 'chromium', engineVersion: '130' },
      }],
    }],
  });
  const result = check({ root: repo, resultFiles: [synthetic], pers: true });
  assert.equal(result.exitCode, 1);
  assert.equal(result.pers.blocked, true);
  const first = result.pers.journeys.find(journey => journey.id === 'first-impression');
  assert.equal(first.status, 'fail');
  assert.equal(first.cells.fail, 0);
  assert.deepEqual(first.testFailures, [`${histogramPath}: renders histogram bars with interval labels`]);
  const compare = result.pers.journeys.find(journey => journey.id === 'compare');
  assert.notEqual(compare.status, 'fail');
  assert.equal(compare.testFailures.length, 0);
});

test('a suite-level failure in an automated ARIA test cited only by journeys blocks --pers', t => {
  const write = workspace(t);
  const journeysFile = write('journeys.json', fixtureJourneys(journeys => {
    journeys[0].accessibilityEvidence.automated = ['chart.browser.test.ts'];
    for (let i = 1; i < journeys.length; i++) journeys[i].accessibilityEvidence.automated = [];
    return journeys;
  }));
  const suiteCrash = write('aria-crash.json', {
    testResults: [{
      name: 'chart.browser.test.ts',
      status: 'failed',
      message: 'beforeAll crashed in browser setup',
      assertionResults: [],
    }],
  });
  const result = check({ root: fixtures, matrixFile: fixtureMatrix, resultFiles: [suiteCrash], pers: true, journeysFile });
  assert.equal(result.exitCode, 1);
  assert.equal(result.pers.blocked, true);
  assert.equal(result.pers.journeys[0].status, 'fail');
  assert.match(result.pers.journeys[0].testFailures[0], /chart\.browser\.test\.ts: suite failed without assertion \(beforeAll crashed in browser setup\)/);
  assert.notEqual(result.pers.journeys[1].status, 'fail');
});

test('evidence validation rejects non-test files, noncanonical/escaping paths, unconfined names, and missing bench runner', t => {
  const write = workspace(t);
  const absTest = resolve(repo, 'acceptance/test/journeys.test.mjs');
  const journeysFile = write('journeys.json', fixtureJourneys(journeys => {
    journeys[0].testFiles = ['matrix.json'];
    journeys[1].testFiles = [absTest];
    journeys[2].testFiles = ['../journeys.test.mjs'];
    journeys[3].accessibilityEvidence.automated = ['matrix.json'];
    journeys[4].screenshots = ['../README'];
    journeys[5].rehearsalTasks = ['nested/task'];
    journeys[6].benchWorkloads = ['first'];
    journeys[7].testFiles = ['./chart.test.ts'];
    return journeys;
  }));
  assert.throws(() => readJourneys({ root: fixtures, journeysFile, matrixIds: ['F1'] }), error => {
    for (const expected of [
      'first-impression.testFiles: expected a test file (*.test.*), got matrix.json',
      `reading.testFiles: expected a canonical repository-relative test file, got ${absTest}`,
      'hover.testFiles: expected a canonical repository-relative test file, got ../journeys.test.mjs',
      'explore.accessibilityEvidence.automated: expected a test file (*.test.*), got matrix.json',
      'compare.screenshots: invalid docs page name ../README',
      'resize.rehearsalTasks: invalid rehearsal task name nested/task',
      'mobile-touch.benchWorkloads: missing benchmark runner bench/run.mjs',
      'keyboard.testFiles: expected a canonical repository-relative test file, got ./chart.test.ts',
    ]) {
      assert.ok(error.message.includes(expected), `expected: ${expected}\n${error.message}`);
    }
    return true;
  });
});

test('noncanonical in-repo alias paths, commented-out cases, and string-literal cases/braces are handled accurately', t => {
  const directory = mkdtempSync(resolve(tmpdir(), 'axylo-pers-bench-'));
  t.after(() => rmSync(directory, { recursive: true }));
  const put = (rel, content) => {
    const file = resolve(directory, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
    return file;
  };
  put('packages/a/chart.test.ts', 'export {};\n');
  put('bench/lib/refs.mjs', "export const WORKLOADS = ['first', 'page', 'zoom', 'hover'];\n");
  put('bench/run.mjs', [
    'export function workloadParams(workload) {',
    '  switch (workload) {',
    "    // case 'first': return {};",
    "    /* case 'page': return {}; */",
    "    case 'zoom': return { note: \"case 'first': }\" };",
    "    case 'hover': return {};",
    '  }',
    '}',
  ].join('\n'));
  const journeysFile = put('journeys.json', fixtureJourneys(journeys => {
    for (const j of journeys) {
      j.testFiles = ['packages/a/chart.test.ts'];
      j.accessibilityEvidence.automated = ['packages/a/chart.test.ts'];
    }
    journeys[0].testFiles = ['packages/a/../a/chart.test.ts'];
    journeys[1].benchWorkloads = ['first', 'page', 'zoom', 'hover'];
    return journeys;
  }));
  assert.throws(() => readJourneys({ root: directory, journeysFile, matrixIds: ['F1'] }), error => {
    assert.ok(error.message.includes('first-impression.testFiles: expected a canonical repository-relative test file, got packages/a/../a/chart.test.ts'), error.message);
    assert.ok(error.message.includes('reading.benchWorkloads: unknown bench workload first'), error.message);
    assert.ok(error.message.includes('reading.benchWorkloads: unknown bench workload page'), error.message);
    assert.ok(!error.message.includes('unknown bench workload zoom'), error.message);
    assert.ok(!error.message.includes('unknown bench workload hover'), error.message);
    return true;
  });
});

test('passing results let the journeys through, and a passing journey with an owned gap stays weak', t => {
  const write = workspace(t);
  const journeysFile = write('journeys.json', fixtureJourneys(journeys => {
    journeys[0].ownedGaps = [{ id: 'fixture-gap', kinds: ['line'], reason: 'Fixture gap.', owner: 'fixture-owner', targetCycle: 'C1.2' }];
    return journeys;
  }));
  const result = check({ root: fixtures, matrixFile: fixtureMatrix, resultFiles: [resolve(fixtures, 'results.json')], pers: true, journeysFile });
  assert.equal(result.exitCode, 0);
  assert.equal(result.pers.blocked, false);
  // F1 has a weak area cell in the fixture, so no F1 journey can pass outright.
  assert.ok(result.pers.journeys.every(journey => journey.status === 'weak'));
  assert.match(renderJourneysMarkdown(result.pers), /`fixture-gap` \(line\) · fixture-owner → C1\.2: Fixture gap\./);
});

test('a run whose provenance records another tree blocks --pers', t => {
  const write = workspace(t);
  const journeysFile = write('journeys.json', fixtureJourneys());
  const results = write('run.json', readFileSync(resolve(fixtures, 'results.json'), 'utf8'));
  write('run.provenance.json', { commit: 'older', dirty: false, tree: 'older', hashes: {} });
  const options = { root: fixtures, matrixFile: fixtureMatrix, resultFiles: [results] };
  assert.equal(check(options).exitCode, 0);
  const result = check({ ...options, pers: true, journeysFile });
  assert.equal(result.runs[0].provenanceError, 'provenance does not match the working tree');
  assert.equal(result.exitCode, 1);
  assert.equal(result.pers.blocked, true);
  const first = result.pers.journeys.find(journey => journey.id === 'first-impression');
  assert.equal(first.status, 'fail');
  assert.ok(first.cells.stale > 0);
  assert.deepEqual(first.provenanceErrors, ['run.json: provenance does not match the working tree']);
});

test('a structurally broken journeys file is an error from check({ pers: true }) but ignored without it', t => {
  const write = workspace(t);
  const journeysFile = write('journeys.json', fixtureJourneys(journeys => journeys.slice(1)));
  assert.throws(() => check({ root: fixtures, matrixFile: fixtureMatrix, pers: true, journeysFile }), /missing journey: first-impression/);
  assert.equal(check({ root: fixtures, matrixFile: fixtureMatrix, journeysFile }).pers, undefined);
});

test('evaluateJourneys reports not run when no cell has been run', () => {
  const journeys = fixtureJourneys();
  const checkResult = { runs: [], rows: [{ id: 'F1', cells: { line: { status: 'not run', reports: [] }, area: { status: 'weak', reports: [] } } }] };
  const evaluation = evaluateJourneys({ journeys, checkResult });
  assert.ok(evaluation.journeys.every(journey => journey.status === 'not run'));
  assert.equal(evaluation.blocked, false);
  assert.equal(evaluation.summary['not run'], 12);
});

test('node acceptance/check.mjs --pers exits 0 on the repository and prints all twelve journeys', () => {
  const run = spawnSync(process.execPath, [resolve(repo, 'acceptance/check.mjs'), '--pers'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr.split('\n').slice(0, 3).join('\n'));
  assert.match(run.stdout, /## Product Experience Regression Suite \(12 journeys\)/);
  for (const id of JOURNEY_IDS) assert.match(run.stdout, new RegExp(`\\| ${id} — `));
});
