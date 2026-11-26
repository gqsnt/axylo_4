import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { check, formatPersSummary } from '../check.mjs';
import {
  CORE_JOURNEY_IDS, evaluateJourneys, evaluateTestCitation, JOURNEY_IDS, OPT_IN_FAMILIES, OPT_IN_JOURNEY_IDS,
  PERS_KINDS, readJourneys, renderJourneysMarkdown,
} from '../journeys.mjs';
import { citedTestFiles, hashFile, snapshot } from '../provenance.mjs';
import { readTitles } from '../titles.mjs';

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

/** A minimal Git-backed copy of fixtures so snapshot() / provenance checks work without repo .git. */
function gitFixture(t, extraFiles = {}) {
  const write = workspace(t);
  const copy = rel => write(rel, readFileSync(resolve(fixtures, rel), 'utf8'));
  copy('docs/02-product-spec.md');
  copy('chart.test.ts');
  copy('cases.ts');
  copy('matrix.json');
  const root = dirname(write('chart.browser.test.ts', "import { describe, it } from 'vitest';\ndescribe('browser', () => {\n  it('aria check', () => {});\n});\n"));
  for (const [rel, content] of Object.entries(extraFiles)) {
    write(rel, typeof content === 'string' ? content : JSON.stringify(content));
  }
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture');
  return { write, root, git };
}

/** Sixteen journeys over the fixture tree: core journeys cite F1 unless overridden; opt-in journeys use direct evidence. */
function fixtureJourneys(edit = journeys => journeys) {
  return edit(JOURNEY_IDS.map(id => {
    const optIn = OPT_IN_JOURNEY_IDS.includes(id);
    const kindByOptIn = {
      'static-stream': ['static', 'stream'],
      'cartesian-multiscale': ['cartesian'],
      'stats-sync': ['stats', 'sync'],
      'export-finance': ['export', 'finance'],
    };
    const entryByOptIn = {
      'static-stream': ['axylo/static', 'axylo/stream'],
      'cartesian-multiscale': ['axylo/cartesian'],
      'stats-sync': ['axylo/stats', 'axylo/sync'],
      'export-finance': ['axylo/export', 'axylo/finance'],
    };
    return {
      id,
      title: `Journey ${id}`,
      owner: 'fixture-owner',
      ...(optIn ? { entryPoints: entryByOptIn[id] } : {}),
      outcomeGuarantees: ['The reader sees the fixture faithfully.'],
      applicableKinds: optIn ? kindByOptIn[id] : ['line', 'area', 'bar'],
      matrixIds: optIn ? [] : ['F1'],
      testFiles: ['chart.test.ts'],
      screenshots: [],
      benchWorkloads: [],
      rehearsalTasks: [],
      accessibilityEvidence: {
        automated: ['chart.browser.test.ts'],
        manualAt: { status: 'not-applicable', environments: [], protocolNote: 'Fixture.' },
      },
      ownedGaps: [],
    };
  }));
}

/** Clean fixture journeys + matching clean matrix where every F1 cell passes (line & bar). */
function cleanGraduationSetup(t, { extraTests = '', journeysEdit = j => j } = {}) {
  const { write, root, git } = gitFixture(t, {
    'docs/02-product-spec.md': readFileSync(resolve(fixtures, 'docs/02-product-spec.md'), 'utf8').split('| F2 |')[0],
    'chart.test.ts': readFileSync(resolve(fixtures, 'chart.test.ts'), 'utf8') + extraTests,
  });
  const [f1] = read(fixtureMatrix);
  // Remove weak area so F1 only has passing line + bar cells.
  f1.appliesTo = ['line', 'bar'];
  f1.notApplicable.area = 'Out of scope for clean fixture.';
  delete f1.weak;
  const matrix = [f1];
  const matrixFile = write('acceptance/matrix.json', matrix);
  const journeys = fixtureJourneys(list => journeysEdit(list.map(j => ({
    ...j,
    testCitations: [
      { kind: 'unit', file: 'chart.test.ts', title: 'line renders', ancestors: ['render examples'] },
      { kind: 'browser', file: 'chart.browser.test.ts', title: 'aria check', ancestors: ['browser'] },
    ],
  }))));
  const journeysFile = write('acceptance/journeys.json', journeys);
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Clean graduation fixture');
  return { write, root, git, matrix, matrixFile, journeys, journeysFile };
}

function writeCleanRun(outputWrite, root, matrix, journeys, fileName, testResults) {
  const runFile = outputWrite(fileName, { testResults });
  const sidecar = outputWrite(fileName.replace(/\.json$/, '.provenance.json'), {
    ...snapshot(root, citedTestFiles(matrix, journeys)),
    resultSha256: hashFile(runFile),
    changedDuringRun: false,
  });
  return { runFile, sidecar };
}

test('the real journeys index names all 16 journeys, covers all 7 opt-in manifest exports, and every citation resolves', () => {
  const journeys = readJourneys({ root: repo, matrixIds: realMatrixIds() });
  assert.equal(journeys.length, 16);
  assert.deepEqual(journeys.map(journey => journey.id), [...JOURNEY_IDS]);
  assert.equal(CORE_JOURNEY_IDS.length, 12);
  assert.equal(OPT_IN_JOURNEY_IDS.length, 4);
  assert.deepEqual([...PERS_KINDS], ['line', 'area', 'bar', 'histogram', 'scatter', 'donut', 'compact']);
  assert.deepEqual([...OPT_IN_FAMILIES], ['static', 'stream', 'cartesian', 'stats', 'sync', 'export', 'finance']);

  const pkg = read(resolve(repo, 'packages/axylo/package.json'));
  const expectedOptIns = Object.keys(pkg.exports)
    .filter(k => k.startsWith('./') && k !== './axylo.css')
    .map(k => `axylo/${k.slice(2)}`);
  const coveredOptIns = new Set(journeys.flatMap(j => j.entryPoints ?? []));
  assert.deepEqual([...coveredOptIns].sort(), expectedOptIns.sort());

  for (const journey of journeys) {
    const { automated, manualAt } = journey.accessibilityEvidence;
    assert.ok(Array.isArray(automated) && automated.length > 0, `${journey.id}: automated ARIA evidence`);
    assert.ok(['verified', 'waived-for-1.0', 'gap-open', 'not-applicable'].includes(manualAt.status), journey.id);
    if (journey.applicableKinds.includes('histogram')) {
      assert.ok(journey.testFiles.some(file => file.includes('histogram'))
        || journey.ownedGaps.some(gap => gap.kinds.includes('histogram')), `${journey.id}: histogram citation`);
    }
    for (const gap of journey.ownedGaps) {
      assert.ok(/^N[2-9]|N1[01]$/.test(gap.targetCycle), `${journey.id}.${gap.id} targetCycle should be N2-N11, got ${gap.targetCycle}`);
    }
  }
  // Generic boilerplate histogram-matrix-column is retired; invalid-data/keyboard/screen-reader/customization retire it completely.
  for (const journey of journeys) {
    assert.ok(!journey.ownedGaps.some(gap => gap.id === 'histogram-matrix-column'), `${journey.id} still has boilerplate histogram-matrix-column`);
  }
  const keyboard = journeys.find(journey => journey.id === 'keyboard');
  assert.ok(keyboard.matrixIds.includes('A3'));
  assert.notEqual(keyboard.accessibilityEvidence.manualAt.status, 'verified', 'A3 manual AT has not been run');
  assert.ok(keyboard.ownedGaps.some(gap => gap.id === 'histogram-keyboard-update-append-focus' && gap.targetCycle === 'N3'));
  const customization = journeys.find(journey => journey.id === 'customization');
  assert.equal(customization.accessibilityEvidence.manualAt.status, 'not-applicable');
  assert.ok(customization.ownedGaps.some(gap => gap.id === 'windows-forced-colors'));
  assert.ok(customization.ownedGaps.some(gap => gap.id === 'histogram-messages-font-spacing' && gap.targetCycle === 'N2'));
  const invalidData = journeys.find(journey => journey.id === 'invalid-data');
  assert.ok(invalidData.ownedGaps.some(gap => gap.id === 'histogram-strict-update-rollback' && gap.targetCycle === 'N2'));
  const staticStream = journeys.find(journey => journey.id === 'static-stream');
  const staticCompositions = staticStream.testCitations.filter(c => c.ancestors?.length === 1 && c.ancestors[0] === 'static compositions');
  assert.equal(staticCompositions.length, 6);
  assert.ok(staticCompositions.every(c => c.title && c.registration && c.atLeast === undefined));
  const exportFinance = journeys.find(journey => journey.id === 'export-finance');
  assert.ok(exportFinance.ownedGaps.some(gap => gap.id === 'finance-strict-rollback-state-assertion' && gap.targetCycle === 'N7'));
  const totalGaps = journeys.reduce((sum, j) => sum + j.ownedGaps.length, 0);
  assert.equal(totalGaps, 28);
});

test('check({ pers: true }) on the real repository evaluates all 16 journeys without blocking in diagnostic mode', () => {
  const result = check({ root: repo, pers: true });
  assert.equal(result.pers.mode, 'diagnostic');
  assert.equal(result.pers.journeys.length, 16);
  assert.deepEqual(result.pers.journeys.map(journey => journey.id), [...JOURNEY_IDS]);
  assert.ok(result.pers.journeys.filter(journey => journey.histogramApplies).every(journey => journey.histogramCited));
  assert.equal(result.pers.summary.histogramApplicable, 11);
  assert.equal(result.pers.summary.histogramTestBacked, 10);
  assert.equal(result.pers.summary.histogramGapOnly, 1);
  assert.equal(result.pers.summary.optInJourneys, 4);
  assert.match(result.report, /## Product Experience Regression Suite \(16 journeys\)/);
  assert.match(result.report, /11 histogram-applicable \(10 test-backed, 1 gap-only\)/);
  assert.equal(result.pers.blocked, false);
  assert.equal(result.exitCode, 0);
});

test('strict graduation (--pers --release and --pers-strict) blocks on the real repo when no results or open gaps remain', () => {
  const releasePers = check({ root: repo, pers: true, release: true });
  const strictPers = check({ root: repo, persStrict: true });
  for (const res of [releasePers, strictPers]) {
    assert.equal(res.exitCode, 1);
    assert.equal(res.pers.mode, 'strict');
    assert.equal(res.pers.blocked, true);
    assert.ok(res.pers.blockers.some(b => b.code === 'no-runs'));
    assert.ok(res.pers.blockers.some(b => b.code === 'open-gaps'));
    assert.match(res.report, /### Graduation blockers/);
  }
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

test('readJourneys rejects unknown test titles, .skip citations, missing testFiles backing, and missing manifest export coverage', t => {
  const { write, root } = gitFixture(t, {
    'packages/axylo/package.json': {
      name: 'axylo',
      exports: {
        '.': './dist/index.js',
        './static': './dist/static.js',
        './stream': './dist/stream.js',
        './cartesian': './dist/cartesian.js',
        './stats': './dist/stats.js',
        './sync': './dist/sync.js',
        './export': './dist/export.js',
        './finance': './dist/finance.js',
        './axylo.css': './dist/axylo.css',
      },
    },
    'chart.test.ts': readFileSync(resolve(fixtures, 'chart.test.ts'), 'utf8') + "\nit.skip('skipped in source', () => {});\n",
  });
  const badTitle = write('bad-title.json', fixtureJourneys(list => {
    list[0].testCitations = [{ kind: 'unit', file: 'chart.test.ts', title: 'does not exist in source' }];
    return list;
  }));
  assert.throws(() => readJourneys({ root, journeysFile: badTitle, matrixIds: ['F1'] }),
    /first-impression\.testCitations\[0\]: missing test title in chart\.test\.ts: does not exist in source/);

  const skippedTitle = write('skipped-title.json', fixtureJourneys(list => {
    list[0].testCitations = [{ kind: 'unit', file: 'chart.test.ts', title: 'skipped in source' }];
    return list;
  }));
  assert.throws(() => readJourneys({ root, journeysFile: skippedTitle, matrixIds: ['F1'] }),
    /first-impression\.testCitations\[0\]: citation uses \.skip in chart\.test\.ts: skipped in source/);

  const unbacked = write('unbacked.json', fixtureJourneys(list => {
    list[0].testFiles = [];
    list[0].testCitations = [{ kind: 'unit', file: 'chart.test.ts', title: 'line renders' }];
    return list;
  }));
  assert.throws(() => readJourneys({ root, journeysFile: unbacked, matrixIds: ['F1'] }),
    /must also be listed in testFiles or accessibilityEvidence\.automated/);

  const missingExport = write('missing-export.json', fixtureJourneys(list => {
    const j16 = list.find(j => j.id === 'export-finance');
    j16.entryPoints = ['axylo/export'];
    return list;
  }));
  assert.throws(() => readJourneys({ root, journeysFile: missingExport, matrixIds: ['F1'] }),
    /opt-in manifest export axylo\/finance is not covered by any journey entryPoints/);

  const unknownExport = write('unknown-export.json', fixtureJourneys(list => {
    const j16 = list.find(j => j.id === 'export-finance');
    j16.entryPoints = ['axylo/export', 'axylo/finance', 'axylo/telepathy'];
    return list;
  }));
  assert.throws(() => readJourneys({ root, journeysFile: unknownExport, matrixIds: ['F1'] }),
    /export-finance\.entryPoints: unknown package export axylo\/telepathy/);
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

test('a failing test cited only by journeys (outside matrix.json) fails those journeys and blocks --pers and graduation', t => {
  const write = workspace(t);
  const histogramPath = 'packages/axylo/test/browser/chart/histogram.browser.test.ts';
  const synthetic = write('histogram-failed.json', {
    testResults: [{
      name: `/archived/checkout/${histogramPath}`,
      status: 'failed',
      assertionResults: [{
        title: 'draws unequal bins, reads intervals by pointer and keyboard, zooms and exposes the data table',
        ancestorTitles: [],
        status: 'failed',
        meta: { engine: 'chromium', engineVersion: '130' },
      }],
    }],
  });
  const diag = check({ root: repo, resultFiles: [synthetic], pers: true });
  assert.equal(diag.exitCode, 1);
  assert.equal(diag.pers.blocked, true);
  const first = diag.pers.journeys.find(journey => journey.id === 'first-impression');
  assert.equal(first.status, 'fail');
  assert.equal(first.cells.fail, 0);
  assert.ok(first.testFailures.some(msg => msg.startsWith(`${histogramPath}: draws unequal bins`)));
  const compare = diag.pers.journeys.find(journey => journey.id === 'compare');
  assert.notEqual(compare.status, 'fail');
  assert.equal(compare.testFailures.length, 0);

  // With clean provenance on a fixture where chart.browser.test.ts is cited ONLY by journeys (outside matrix.json),
  // a failure there fails those journeys and blocks --pers, --pers-strict, and --pers --release.
  const out = workspace(t);
  const { root, matrix, matrixFile, journeys, journeysFile } = cleanGraduationSetup(t);
  const { runFile } = writeCleanRun(out, root, matrix, journeys, 'journey-only-fail.json', [
    {
      name: 'chart.test.ts',
      status: 'passed',
      assertionResults: [
        { title: 'line renders', ancestorTitles: ['render examples'], status: 'passed' },
        { title: 'bar has a baseline', ancestorTitles: ['render examples'], status: 'passed' },
      ],
    },
    {
      name: 'chart.browser.test.ts',
      status: 'failed',
      assertionResults: [
        { title: 'aria check', ancestorTitles: ['browser'], status: 'failed', meta: { engine: 'chromium', engineVersion: '130' } },
      ],
    },
  ]);
  for (const flags of [{ pers: true }, { persStrict: true }, { pers: true, release: true }]) {
    const res = check({ root, matrixFile, journeysFile, resultFiles: [runFile], ...flags });
    assert.equal(res.exitCode, 1);
    assert.equal(res.pers.blocked, true);
    const j0 = res.pers.journeys[0];
    assert.equal(j0.status, 'fail');
    assert.equal(j0.cells.fail, 0);
    assert.ok(j0.testFailures.some(msg => msg.includes('chart.browser.test.ts: aria check')));
  }
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

test('passing results let diagnostic --pers through, and a passing journey with an owned gap stays weak', t => {
  const write = workspace(t);
  const journeysFile = write('journeys.json', fixtureJourneys(journeys => {
    journeys[0].ownedGaps = [{ id: 'fixture-gap', kinds: ['line'], reason: 'Fixture gap.', owner: 'fixture-owner', targetCycle: 'N2' }];
    return journeys;
  }));
  const result = check({ root: fixtures, matrixFile: fixtureMatrix, resultFiles: [resolve(fixtures, 'results.json')], pers: true, journeysFile });
  assert.equal(result.exitCode, 0);
  assert.equal(result.pers.blocked, false);
  // F1 has a weak area cell in the fixture, and opt-in journeys lack chart.browser.test.ts here, so diagnostic --pers stays weak/not run without blocking.
  assert.ok(result.pers.journeys.filter(j => j.matrixIds.length > 0).every(journey => journey.status === 'weak'));
  assert.match(renderJourneysMarkdown(result.pers), /`fixture-gap` \(line\) · fixture-owner → N2: Fixture gap\./);
});

test('a run whose provenance records another tree (or changed journey-only hash) blocks both --pers and graduation', t => {
  const { write, root } = gitFixture(t);
  const out = workspace(t);
  const matrix = read(fixtureMatrix);
  const journeys = fixtureJourneys();
  const journeysFile = write('acceptance/journeys.json', journeys);
  const results = out('run.json', readFileSync(resolve(fixtures, 'results.json'), 'utf8'));
  const valid = { ...snapshot(root, citedTestFiles(matrix, journeys)), resultSha256: hashFile(results) };

  // Wrong commit in provenance blocks --pers and graduation.
  out('run.provenance.json', { ...valid, commit: 'older' });
  const options = { root, matrixFile: resolve(root, 'matrix.json'), resultFiles: [results], journeysFile };
  assert.equal(check(options).exitCode, 0);
  for (const flags of [{ pers: true }, { persStrict: true }, { pers: true, release: true }]) {
    const result = check({ ...options, ...flags });
    assert.equal(result.runs[0].provenanceError, 'provenance does not match the working tree');
    assert.equal(result.exitCode, 1);
    assert.equal(result.pers.blocked, true);
    const first = result.pers.journeys.find(journey => journey.id === 'first-impression');
    assert.equal(first.status, 'fail');
    assert.ok(first.cells.stale > 0);
    assert.deepEqual(first.provenanceErrors, ['run.json: provenance does not match the working tree']);
  }

  // Tampered journey-only test file hash in provenance (even when commit/tree match) blocks --pers and graduation.
  out('run.provenance.json', { ...valid, hashes: { ...valid.hashes, 'chart.browser.test.ts': '0'.repeat(64) } });
  for (const flags of [{ pers: true }, { persStrict: true }, { pers: true, release: true }]) {
    const result = check({ ...options, ...flags });
    assert.equal(result.runs[0].provenanceError, 'provenance does not match the working tree');
    assert.equal(result.exitCode, 1);
    assert.equal(result.pers.blocked, true);
  }
});

test('strict graduation mandatory negative controls: dirty tree, not run, weak, passed sibling, skipped exact assertion, empty suite, wrong ancestor, and clean pass', t => {
  const out = workspace(t);
  const { write, root, git, matrix, matrixFile, journeys, journeysFile } = cleanGraduationSetup(t, {
    extraTests: "\ndescribe('render examples', () => {\n  it('sibling passes', () => {});\n});\n",
  });
  const passingSuite = [
    {
      name: 'chart.test.ts',
      status: 'passed',
      assertionResults: [
        { title: 'line renders', ancestorTitles: ['render examples'], status: 'passed' },
        { title: 'bar has a baseline', ancestorTitles: ['render examples'], status: 'passed' },
        { title: 'sibling passes', ancestorTitles: ['render examples'], status: 'passed' },
      ],
    },
    {
      name: 'chart.browser.test.ts',
      status: 'passed',
      assertionResults: [
        { title: 'aria check', ancestorTitles: ['browser'], status: 'passed', meta: { engine: 'chromium', engineVersion: '130' } },
      ],
    },
  ];

  // Control 6: Clean-provenance passing results with zero open gaps pass BOTH --pers --release and --pers-strict,
  // including J13–J16 direct-evidence journeys with matrixIds: []!
  const { runFile: cleanRun } = writeCleanRun(out, root, matrix, journeys, 'clean.json', passingSuite);
  for (const flags of [{ persStrict: true }, { pers: true, release: true }]) {
    const ok = check({ root, matrixFile, journeysFile, resultFiles: [cleanRun], ...flags });
    assert.equal(ok.exitCode, 0, JSON.stringify(ok.pers.blockers));
    assert.equal(ok.pers.blocked, false);
    assert.deepEqual(ok.pers.blockers, []);
    assert.equal(ok.pers.summary.pass, 16);
    assert.ok(ok.pers.journeys.filter(j => j.matrixIds.length === 0).every(j => j.status === 'pass'));
    assert.match(ok.report, /graduation passed/);
  }

  // Control 1: dirty: true provenance sidecar blocks graduation EVEN when the working tree matches the dirty snapshot!
  const dirtyOut = workspace(t);
  write('chart.test.ts', readFileSync(resolve(root, 'chart.test.ts'), 'utf8') + '\n// dirty edit\n');
  const { runFile: dirtyRun } = writeCleanRun(dirtyOut, root, matrix, journeys, 'dirty.json', passingSuite);
  assert.equal(read(dirtyRun.replace(/\.json$/, '.provenance.json')).dirty, true);
  for (const flags of [{ persStrict: true }, { pers: true, release: true }]) {
    const dirtyRes = check({ root, matrixFile, journeysFile, resultFiles: [dirtyRun], ...flags });
    assert.equal(dirtyRes.exitCode, 1);
    assert.equal(dirtyRes.pers.blocked, true);
    assert.ok(dirtyRes.pers.blockers.some(b => b.code === 'dirty-provenance'));
    assert.ok(dirtyRes.pers.journeys.every(j => j.status !== 'pass'));
  }
  // Restore clean tree for subsequent controls.
  git('checkout', '--', 'chart.test.ts');

  // Control 2a: not run journey (no results supplied) blocks graduation.
  for (const flags of [{ persStrict: true }, { pers: true, release: true }]) {
    const noRuns = check({ root, matrixFile, journeysFile, resultFiles: [], ...flags });
    assert.equal(noRuns.exitCode, 1);
    assert.equal(noRuns.pers.blocked, true);
    assert.ok(noRuns.pers.blockers.some(b => b.code === 'no-runs'));
  }

  // Control 2b: passed sibling only (cited 'line renders' missing from results) blocks graduation.
  const siblingOut = workspace(t);
  const { runFile: siblingRun } = writeCleanRun(siblingOut, root, matrix, journeys, 'sibling.json', [
    {
      name: 'chart.test.ts',
      status: 'passed',
      assertionResults: [
        { title: 'bar has a baseline', ancestorTitles: ['render examples'], status: 'passed' },
        { title: 'sibling passes', ancestorTitles: ['render examples'], status: 'passed' },
      ],
    },
    passingSuite[1],
  ]);
  for (const flags of [{ persStrict: true }, { pers: true, release: true }]) {
    const sibRes = check({ root, matrixFile, journeysFile, resultFiles: [siblingRun], ...flags });
    assert.equal(sibRes.exitCode, 1);
    assert.equal(sibRes.pers.blocked, true);
    assert.ok(sibRes.pers.blockers.some(b => b.code === 'unrun-citations'));
    assert.ok(sibRes.pers.journeys.every(j => j.status !== 'pass'));
  }

  // Control 2c: skipped exact assertion blocks graduation.
  const skippedOut = workspace(t);
  const { runFile: skippedRun } = writeCleanRun(skippedOut, root, matrix, journeys, 'skipped.json', [
    {
      name: 'chart.test.ts',
      status: 'passed',
      assertionResults: [
        { title: 'line renders', ancestorTitles: ['render examples'], status: 'skipped' },
        { title: 'bar has a baseline', ancestorTitles: ['render examples'], status: 'passed' },
      ],
    },
    passingSuite[1],
  ]);
  for (const flags of [{ persStrict: true }, { pers: true, release: true }]) {
    const skipRes = check({ root, matrixFile, journeysFile, resultFiles: [skippedRun], ...flags });
    assert.equal(skipRes.exitCode, 1);
    assert.equal(skipRes.pers.blocked, true);
    assert.ok(skipRes.pers.blockers.some(b => b.code === 'unrun-citations'));
  }

  // Control 2d: empty suite (assertionResults: []) blocks graduation even when testCitations is absent.
  const emptyJourneysFile = out('empty-journeys.json', journeys.map(j => ({ ...j, testCitations: [] })));
  const emptyOut = workspace(t);
  const { runFile: emptyRun } = writeCleanRun(emptyOut, root, matrix, journeys, 'empty.json', [
    { name: 'chart.test.ts', status: 'passed', assertionResults: [] },
    passingSuite[1],
  ]);
  const emptyRes = check({ root, matrixFile, journeysFile: emptyJourneysFile, resultFiles: [emptyRun], persStrict: true });
  assert.equal(emptyRes.exitCode, 1);
  assert.equal(emptyRes.pers.blocked, true);
  assert.ok(emptyRes.pers.blockers.some(b => b.code === 'empty-test-suites'));

  // Control 2e: wrong suite ancestor for cited test blocks graduation.
  const wrongAncOut = workspace(t);
  const { runFile: wrongAncRun } = writeCleanRun(wrongAncOut, root, matrix, journeys, 'wrong-anc.json', [
    {
      name: 'chart.test.ts',
      status: 'passed',
      assertionResults: [
        { title: 'line renders', ancestorTitles: ['wrong suite'], status: 'passed' },
        { title: 'bar has a baseline', ancestorTitles: ['render examples'], status: 'passed' },
      ],
    },
    passingSuite[1],
  ]);
  const wrongAncRes = check({ root, matrixFile, journeysFile, resultFiles: [wrongAncRun], persStrict: true });
  assert.equal(wrongAncRes.exitCode, 1);
  assert.equal(wrongAncRes.pers.blocked, true);
  assert.ok(wrongAncRes.pers.blockers.some(b => b.code === 'unrun-citations'));

  // Control 3: weak journey (passing tests, but open ownedGaps) blocks graduation.
  const weakJourneysFile = out('weak-journeys.json', journeys.map((j, i) => i === 0
    ? { ...j, ownedGaps: [{ id: 'open-n2-gap', kinds: ['line'], reason: 'Still open.', owner: 'core-experience', targetCycle: 'N2' }] }
    : j));
  for (const flags of [{ persStrict: true }, { pers: true, release: true }]) {
    const weakRes = check({ root, matrixFile, journeysFile: weakJourneysFile, resultFiles: [cleanRun], ...flags });
    assert.equal(weakRes.exitCode, 1);
    assert.equal(weakRes.pers.blocked, true);
    assert.equal(weakRes.pers.journeys[0].status, 'weak');
    assert.ok(weakRes.pers.blockers.some(b => b.journeyId === 'first-impression' && b.code === 'open-gaps'));
  }

  // Control 5b: historical failure (both un-sidecar'd archive and in-provenance legacy title) remains visible
  // alongside a passing current assertion and blocks both --pers and graduation.
  const histOut = workspace(t);
  const histSuite = [
    {
      name: 'chart.test.ts',
      status: 'passed',
      assertionResults: [
        { title: 'line renders', ancestorTitles: ['render examples'], status: 'passed' },
        { title: 'bar has a baseline', ancestorTitles: ['render examples'], status: 'passed' },
      ],
    },
    {
      name: 'chart.browser.test.ts',
      status: 'failed',
      assertionResults: [
        { title: 'aria check', ancestorTitles: ['browser'], status: 'passed', meta: { engine: 'chromium', engineVersion: '130' } },
        { title: 'legacy aria check', ancestorTitles: ['browser'], status: 'failed', meta: { engine: 'chromium', engineVersion: '130' } },
      ],
    },
  ];
  const histArchived = histOut('hist-archived.json', { testResults: [histSuite[1]] });
  const diagHist = check({ root, matrixFile, journeysFile, resultFiles: [cleanRun, histArchived], pers: true });
  assert.equal(diagHist.exitCode, 1);
  assert.equal(diagHist.pers.blocked, true);
  assert.ok(diagHist.pers.journeys[0].testFailures.some(msg => msg.includes('legacy aria check')));

  const { runFile: histProvenanced } = writeCleanRun(histOut, root, matrix, journeys, 'hist-provenanced.json', histSuite);
  for (const flags of [{ pers: true }, { persStrict: true }, { pers: true, release: true }]) {
    const histRes = check({ root, matrixFile, journeysFile, resultFiles: [histProvenanced], ...flags });
    assert.equal(histRes.exitCode, 1);
    assert.equal(histRes.pers.blocked, true);
    assert.ok(histRes.pers.journeys.every(j => j.status === 'fail'));
    assert.ok(histRes.pers.journeys[0].testFailures.some(msg => msg.includes('legacy aria check')));
  }
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
  assert.equal(evaluation.summary['not run'], 16);
});

test('CLI check.mjs prints accurate exit codes and summaries for --pers, --pers-strict, --pers --release, and --help', () => {
  const diag = spawnSync(process.execPath, [resolve(repo, 'acceptance/check.mjs'), '--pers'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(diag.status, 0, diag.stderr.split('\n').slice(0, 3).join('\n'));
  assert.match(diag.stdout, /## Product Experience Regression Suite \(16 journeys\)/);
  assert.match(diag.stdout, /PERS \(diagnostic\): PASS \(exit 0\)/);
  for (const id of JOURNEY_IDS) assert.match(diag.stdout, new RegExp(`\\| ${id} — `));

  for (const args of [['--pers-strict'], ['--pers', '--release']]) {
    const strictRun = spawnSync(process.execPath, [resolve(repo, 'acceptance/check.mjs'), ...args], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.equal(strictRun.status, 1);
    assert.match(strictRun.stdout, /## Product Experience Regression Suite \(16 journeys · strict graduation\)/);
    assert.match(strictRun.stdout, /PERS \(strict\): BLOCKED \(exit 1\)/);
  }

  const help = spawnSync(process.execPath, [resolve(repo, 'acceptance/check.mjs'), '--help'], { cwd: repo, encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--pers-strict/);
});

test('source-backed citation ancestry, file-only registration checks, and identifiable browser engine admission', t => {
  const out = workspace(t);
  const { write, root, matrix, matrixFile, journeys, journeysFile } = cleanGraduationSetup(t, {
    extraTests: "\ndescribe('render examples', () => {\n  const mode = pick();\n  it(`param ${mode} case`, () => {});\n});\n",
  });

  // 1a. Nonexistent source ancestry is rejected structurally by readJourneys even when title exists elsewhere.
  const badAncestryFile = out('bad-ancestry.json', journeys.map((j, i) => i === 0
    ? { ...j, testCitations: [{ kind: 'unit', file: 'chart.test.ts', title: 'line renders', ancestors: ['nonexistent suite'] }] }
    : j));
  assert.throws(() => readJourneys({ root, journeysFile: badAncestryFile, matrixIds: ['F1'] }),
    /first-impression\.testCitations\[0\]: missing suite ancestors for chart\.test\.ts: line renders/);

  // 1b. Direct evaluateTestCitation with nonexistent source ancestry never grants positive pass.
  const chartPath = resolve(root, 'chart.test.ts');
  const sourceEntry = { path: chartPath, titles: readTitles(readFileSync(chartPath, 'utf8'), chartPath) };
  const directOutcome = evaluateTestCitation(
    sourceEntry,
    { kind: 'unit', file: 'chart.test.ts', title: 'line renders', ancestors: ['nonexistent suite'] },
    {
      results: new Map([[chartPath, [{ title: 'line renders', ancestorTitles: ['nonexistent suite'], status: 'passed', file: 'fake.json', engine: null, runEngine: null }]]]),
      suiteFailures: new Map(),
      stale: new Map(),
    },
  );
  assert.equal(directOutcome.status, 'not run');

  // 2a. File-only cited file with ONLY an unknown/fabricated passing title blocks strict graduation.
  const fileOnlyJourneysFile = out('file-only-journeys.json', journeys.map(j => ({ ...j, testCitations: [] })));
  const unknownOnly = writeCleanRun(out, root, matrix, journeys, 'unknown-only.json', [
    {
      name: 'chart.test.ts',
      status: 'passed',
      assertionResults: [
        { title: 'line renders', ancestorTitles: ['render examples'], status: 'passed' },
        { title: 'bar has a baseline', ancestorTitles: ['render examples'], status: 'passed' },
      ],
    },
    {
      name: 'chart.browser.test.ts',
      status: 'passed',
      assertionResults: [
        { title: 'completely unknown title', ancestorTitles: ['browser'], status: 'passed', meta: { engine: 'chromium', engineVersion: '130' } },
      ],
    },
  ]);
  const unknownRes = check({ root, matrixFile, journeysFile: fileOnlyJourneysFile, resultFiles: [unknownOnly.runFile], persStrict: true });
  assert.equal(unknownRes.exitCode, 1);
  assert.equal(unknownRes.pers.blocked, true);
  assert.ok(unknownRes.pers.blockers.some(b => b.code === 'unpassed-test-files'));

  // 2b. Coexisting valid source-registered title + template match + unrelated title: only valid identities count positively,
  //     and legacy/packed Chrome assertions (no meta.engine on test or sidecar) are admitted.
  const coexistRun = writeCleanRun(out, root, matrix, journeys, 'coexist.json', [
    {
      name: 'chart.test.ts',
      status: 'passed',
      assertionResults: [
        { title: 'line renders', ancestorTitles: ['render examples'], status: 'passed' },
        { title: 'bar has a baseline', ancestorTitles: ['render examples'], status: 'passed' },
        { title: 'param alpha case', ancestorTitles: ['render examples'], status: 'passed' },
        { title: 'unrelated extra helper title', ancestorTitles: ['render examples'], status: 'passed' },
      ],
    },
    {
      name: 'chart.browser.test.ts',
      status: 'passed',
      // Legacy/packed Chrome style (no meta.engine on test or sidecar -> admitted as chromium).
      assertionResults: [
        { title: 'aria check', ancestorTitles: ['browser'], status: 'passed' },
      ],
    },
  ]);
  const coexistRes = check({ root, matrixFile, journeysFile: fileOnlyJourneysFile, resultFiles: [coexistRun.runFile], persStrict: true });
  assert.equal(coexistRes.exitCode, 0, JSON.stringify(coexistRes.pers.blockers));
  assert.equal(coexistRes.pers.blocked, false);
  assert.equal(coexistRes.pers.summary.pass, 16);

  // 2c. Archived canonical suffix paths resolve cleanly for nested files and valid Chrome / packed browser assertions.
  const nestedOut = workspace(t);
  const nestedSetup = gitFixture(t, {
    'docs/02-product-spec.md': readFileSync(resolve(fixtures, 'docs/02-product-spec.md'), 'utf8').split('| F2 |')[0],
    'packages/sub/chart.test.ts': readFileSync(resolve(fixtures, 'chart.test.ts'), 'utf8'),
    'packages/sub/cases.ts': readFileSync(resolve(fixtures, 'cases.ts'), 'utf8'),
    'packages/sub/chart.browser.test.ts': "import { describe, it } from 'vitest';\ndescribe('browser', () => {\n  it('aria check', () => {});\n});\n",
  });
  const [nestedF1] = read(fixtureMatrix);
  nestedF1.appliesTo = ['line', 'bar'];
  nestedF1.notApplicable.area = 'Out of scope.';
  nestedF1.evidence.line[0].file = 'packages/sub/chart.test.ts';
  nestedF1.evidence.bar[0].file = 'packages/sub/chart.test.ts';
  delete nestedF1.weak;
  const nestedMatrix = [nestedF1];
  const nestedMatrixFile = nestedSetup.write('acceptance/matrix.json', nestedMatrix);
  const nestedJourneys = fixtureJourneys(list => list.map(j => ({
    ...j,
    testFiles: ['packages/sub/chart.test.ts'],
    accessibilityEvidence: {
      automated: ['packages/sub/chart.browser.test.ts'],
      manualAt: { status: 'not-applicable', environments: [], protocolNote: 'Fixture.' },
    },
    testCitations: [],
  })));
  const nestedJourneysFile = nestedSetup.write('acceptance/journeys.json', nestedJourneys);
  nestedSetup.git('add', '.');
  nestedSetup.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Nested');
  const nestedClean = writeCleanRun(nestedOut, nestedSetup.root, nestedMatrix, nestedJourneys, 'nested.json', [
    {
      name: '/archived/checkout/packages/sub/chart.test.ts',
      status: 'passed',
      assertionResults: [
        { title: 'line renders', ancestorTitles: ['render examples'], status: 'passed' },
        { title: 'bar has a baseline', ancestorTitles: ['render examples'], status: 'passed' },
        { title: 'unrelated extra', ancestorTitles: ['render examples'], status: 'passed' },
      ],
    },
    {
      name: '/archived/checkout/packages/sub/chart.browser.test.ts',
      status: 'passed',
      assertionResults: [
        { title: 'aria check', ancestorTitles: ['browser'], status: 'passed' },
      ],
    },
  ]);
  const nestedRes = check({ root: nestedSetup.root, matrixFile: nestedMatrixFile, journeysFile: nestedJourneysFile, resultFiles: [nestedClean.runFile], persStrict: true });
  assert.equal(nestedRes.exitCode, 0, JSON.stringify(nestedRes.pers.blockers));
  assert.equal(nestedRes.pers.blocked, false);
  assert.equal(nestedRes.pers.summary.pass, 16);

  // 3. Browser assertion without an identifiable engine (no meta.engine inside a Firefox run) is NOT admitted for file-only evidence.
  const noEngineRunFile = nestedOut('firefox-missing-engine.json', {
    testResults: [
      {
        name: 'packages/sub/chart.test.ts',
        status: 'passed',
        assertionResults: [
          { title: 'line renders', ancestorTitles: ['render examples'], status: 'passed' },
          { title: 'bar has a baseline', ancestorTitles: ['render examples'], status: 'passed' },
        ],
      },
      {
        name: 'packages/sub/chart.browser.test.ts',
        status: 'passed',
        assertionResults: [
          // No meta.engine while provenance declares firefox -> testEngine() yields null!
          { title: 'aria check', ancestorTitles: ['browser'], status: 'passed' },
        ],
      },
    ],
  });
  nestedOut('firefox-missing-engine.provenance.json', {
    ...snapshot(nestedSetup.root, citedTestFiles(nestedMatrix, nestedJourneys)),
    resultSha256: hashFile(noEngineRunFile),
    changedDuringRun: false,
    engine: 'firefox',
  });
  const noEngineRes = check({ root: nestedSetup.root, matrixFile: nestedMatrixFile, journeysFile: nestedJourneysFile, resultFiles: [noEngineRunFile], persStrict: true });
  assert.equal(noEngineRes.exitCode, 1);
  assert.equal(noEngineRes.pers.blocked, true);
  assert.ok(noEngineRes.pers.blockers.some(b => b.code === 'unpassed-test-files'));
});

test('provenance strict boolean checks, malformed JSON sidecars, resultSha256 mismatch, and legacy matrix-only inventory', t => {
  const out = workspace(t);
  const { root, matrix, matrixFile, journeys, journeysFile } = cleanGraduationSetup(t);
  const passingSuite = [
    {
      name: 'chart.test.ts',
      status: 'passed',
      assertionResults: [
        { title: 'line renders', ancestorTitles: ['render examples'], status: 'passed' },
        { title: 'bar has a baseline', ancestorTitles: ['render examples'], status: 'passed' },
      ],
    },
    {
      name: 'chart.browser.test.ts',
      status: 'passed',
      assertionResults: [
        { title: 'aria check', ancestorTitles: ['browser'], status: 'passed', meta: { engine: 'chromium', engineVersion: '130' } },
      ],
    },
  ];
  const runFile = out('run.json', { testResults: passingSuite });
  const sidecarFile = runFile.replace(/\.json$/, '.provenance.json');
  const fullSnap = snapshot(root, citedTestFiles(matrix, journeys));
  const sha = hashFile(runFile);

  // Missing changedDuringRun or non-boolean changedDuringRun: 0 blocks strict PERS.
  for (const variant of [
    { ...fullSnap, resultSha256: sha },
    { ...fullSnap, resultSha256: sha, changedDuringRun: 0 },
    { ...fullSnap, resultSha256: sha, changedDuringRun: 'false' },
  ]) {
    writeFileSync(sidecarFile, JSON.stringify(variant));
    for (const flags of [{ persStrict: true }, { pers: true, release: true }]) {
      const res = check({ root, matrixFile, journeysFile, resultFiles: [runFile], ...flags });
      assert.equal(res.exitCode, 1);
      assert.equal(res.pers.blocked, true);
      assert.ok(res.pers.blockers.some(b => b.code === 'stale-provenance' && b.message.includes('changedDuringRun')));
      assert.match(res.report, /### Graduation blockers/);
    }
  }

  // Malformed JSON sidecar returns structured blockers without throwing early.
  writeFileSync(sidecarFile, '{ not valid json');
  for (const flags of [{ pers: true }, { persStrict: true }, { pers: true, release: true }]) {
    const res = check({ root, matrixFile, journeysFile, resultFiles: [runFile], ...flags });
    assert.equal(res.exitCode, 1);
    assert.equal(res.pers.blocked, true);
    assert.ok(res.pers.blockers.some(b => b.code === 'malformed-provenance'));
    assert.match(res.report, /malformed provenance JSON/);
  }

  // Non-object JSON sidecar also returns structured blockers without throwing early.
  writeFileSync(sidecarFile, '[]');
  const arrayRes = check({ root, matrixFile, journeysFile, resultFiles: [runFile], persStrict: true });
  assert.equal(arrayRes.exitCode, 1);
  assert.equal(arrayRes.pers.blocked, true);
  assert.ok(arrayRes.pers.blockers.some(b => b.code === 'malformed-provenance'));

  // resultSha256 mismatch blocks both diagnostic --pers and strict graduation.
  writeFileSync(sidecarFile, JSON.stringify({ ...fullSnap, resultSha256: '0'.repeat(64), changedDuringRun: false }));
  for (const flags of [{ pers: true }, { persStrict: true }, { pers: true, release: true }]) {
    const shaRes = check({ root, matrixFile, journeysFile, resultFiles: [runFile], ...flags });
    assert.equal(shaRes.exitCode, 1);
    assert.equal(shaRes.pers.blocked, true);
    assert.ok(shaRes.pers.blockers.some(b => b.code === 'stale-provenance'));
  }

  // Matching legacy matrix-only inventory (hashes cover citedTestFiles(matrix) only, omitting journey-only chart.browser.test.ts):
  const matrixOnlySnap = snapshot(root, citedTestFiles(matrix));
  assert.equal(Object.hasOwn(matrixOnlySnap.hashes, 'chart.browser.test.ts'), false);
  writeFileSync(sidecarFile, JSON.stringify({ ...matrixOnlySnap, resultSha256: sha, changedDuringRun: false }));
  // 1) Ordinary --release accepts the genuinely matching legacy matrix-only sidecar!
  const ordinaryRel = check({ root, matrixFile, resultFiles: [runFile], release: true });
  assert.equal(ordinaryRel.exitCode, 0);
  assert.equal(ordinaryRel.runs[0].provenanceInventory, 'matrix-only');
  assert.equal(ordinaryRel.runs[0].provenanceError, undefined);
  // 2) Diagnostic --pers accepts it, documents matrix-only inventory, and grants no credit for unhashed journey-only file.
  const diagLegacy = check({ root, matrixFile, journeysFile, resultFiles: [runFile], pers: true });
  assert.equal(diagLegacy.exitCode, 0);
  assert.equal(diagLegacy.pers.blocked, false);
  assert.match(diagLegacy.report, /matrix-only inventory/);
  assert.ok(diagLegacy.pers.journeys.every(j => j.status !== 'pass'));
  // 3) Strict PERS blocks legacy matrix-only inventory!
  for (const flags of [{ persStrict: true }, { pers: true, release: true }]) {
    const strictLegacy = check({ root, matrixFile, journeysFile, resultFiles: [runFile], ...flags });
    assert.equal(strictLegacy.exitCode, 1);
    assert.equal(strictLegacy.pers.blocked, true);
    assert.ok(strictLegacy.pers.blockers.some(b => b.code === 'stale-provenance' && b.message.includes('matrix-only')));
  }

  // Extra unknown or corrupted hash alongside legacy matrix-only inventory MUST NOT be ignored.
  writeFileSync(sidecarFile, JSON.stringify({
    ...matrixOnlySnap,
    hashes: { ...matrixOnlySnap.hashes, 'unknown.test.ts': 'f'.repeat(64) },
    resultSha256: sha,
    changedDuringRun: false,
  }));
  assert.equal(check({ root, matrixFile, resultFiles: [runFile], release: true }).exitCode, 1);
  assert.equal(check({ root, matrixFile, journeysFile, resultFiles: [runFile], pers: true }).exitCode, 1);
});

test('filtered journey-only template omission surfaces unrun-citations, weak-matrix control, and combined release vs PERS summary', t => {
  const out = workspace(t);
  const { write, root, git, matrix, matrixFile, journeys, journeysFile } = cleanGraduationSetup(t, {
    extraTests: "\ndescribe('dynamic templates', () => {\n  const mode = pick();\n  it(`tmpl ${mode} case`, () => {});\n  it('other unmentioned test', () => {});\n});\n",
  });
  // Add a journey-only template-backed citation (not in matrix.json).
  const tmplJourneys = journeys.map((j, i) => i === 0
    ? {
        ...j,
        testCitations: [
          ...j.testCitations,
          { kind: 'unit', file: 'chart.test.ts', title: 'tmpl foo case', registration: 'tmpl ${mode} case', ancestors: ['dynamic templates'] },
        ],
      }
    : j);
  const tmplJourneysFile = write('acceptance/journeys.json', tmplJourneys);
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Add template');

  // Filtered run executes chart.test.ts ('line renders', 'other unmentioned test') while omitting 'tmpl foo case'.
  const { runFile: filteredRun } = writeCleanRun(out, root, matrix, tmplJourneys, 'filtered.json', [
    {
      name: 'chart.test.ts',
      status: 'passed',
      assertionResults: [
        { title: 'line renders', ancestorTitles: ['render examples'], status: 'passed' },
        { title: 'bar has a baseline', ancestorTitles: ['render examples'], status: 'passed' },
        { title: 'other unmentioned test', ancestorTitles: ['dynamic templates'], status: 'passed' },
      ],
    },
    {
      name: 'chart.browser.test.ts',
      status: 'passed',
      assertionResults: [
        { title: 'aria check', ancestorTitles: ['browser'], status: 'passed', meta: { engine: 'chromium', engineVersion: '130' } },
      ],
    },
  ]);

  // Does NOT throw from confirmTitles; diagnostic --pers succeeds while strict surfaces unrun-citations.
  const diagFiltered = check({ root, matrixFile, journeysFile: tmplJourneysFile, resultFiles: [filteredRun], pers: true });
  assert.equal(diagFiltered.exitCode, 0);
  assert.equal(diagFiltered.pers.blocked, false);
  assert.equal(diagFiltered.pers.journeys[0].unrunCitations.length, 1);

  for (const flags of [{ persStrict: true }, { pers: true, release: true }]) {
    const strictFiltered = check({ root, matrixFile, journeysFile: tmplJourneysFile, resultFiles: [filteredRun], ...flags });
    assert.equal(strictFiltered.exitCode, 1);
    assert.equal(strictFiltered.pers.blocked, true);
    assert.ok(strictFiltered.pers.blockers.some(b => b.code === 'unrun-citations' && b.message.includes('tmpl foo case')));
    assert.match(strictFiltered.report, /### Graduation blockers/);
  }

  // Isolated deterministic weak-matrix control: clean current provenance, all tests passing, zero owned gaps,
  // and F1 has a documented weak 'area' cell. Ordinary --release admits it; both strict flags block with matrix-incomplete.
  const weakMatSetup = gitFixture(t, {
    'docs/02-product-spec.md': readFileSync(resolve(fixtures, 'docs/02-product-spec.md'), 'utf8').split('| F2 |')[0],
  });
  const weakMatrix = [read(fixtureMatrix)[0]];
  weakMatrix[0].gaps = { area: 'Area geometry verification remains open.' };
  const weakMatrixFile = weakMatSetup.write('acceptance/matrix.json', weakMatrix);
  const weakMatJourneys = fixtureJourneys(list => list.map(j => ({
    ...j,
    ownedGaps: [],
    testCitations: [
      { kind: 'unit', file: 'chart.test.ts', title: 'line renders', ancestors: ['render examples'] },
      { kind: 'browser', file: 'chart.browser.test.ts', title: 'aria check', ancestors: ['browser'] },
    ],
  })));
  const weakMatJourneysFile = weakMatSetup.write('acceptance/journeys.json', weakMatJourneys);
  weakMatSetup.git('add', '.');
  weakMatSetup.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Weak matrix');
  const { runFile: weakMatRun } = writeCleanRun(out, weakMatSetup.root, weakMatrix, weakMatJourneys, 'weak-mat.json', [
    {
      name: 'chart.test.ts',
      status: 'passed',
      assertionResults: [
        { title: 'line renders', ancestorTitles: ['render examples'], status: 'passed' },
        { title: 'area renders', ancestorTitles: ['render examples'], status: 'passed' },
        { title: 'bar has a baseline', ancestorTitles: ['render examples'], status: 'passed' },
      ],
    },
    {
      name: 'chart.browser.test.ts',
      status: 'passed',
      assertionResults: [
        { title: 'aria check', ancestorTitles: ['browser'], status: 'passed', meta: { engine: 'chromium', engineVersion: '130' } },
      ],
    },
  ]);
  const ordinaryWeak = check({ root: weakMatSetup.root, matrixFile: weakMatrixFile, resultFiles: [weakMatRun], release: true });
  assert.equal(ordinaryWeak.exitCode, 0);
  assert.equal(ordinaryWeak.rows[0].cells.area.status, 'weak');
  assert.equal(ordinaryWeak.rows[0].cells.area.releasedGap, 'Area geometry verification remains open.');
  for (const flags of [{ persStrict: true }, { pers: true, release: true }]) {
    const strictWeak = check({ root: weakMatSetup.root, matrixFile: weakMatrixFile, journeysFile: weakMatJourneysFile, resultFiles: [weakMatRun], ...flags });
    assert.equal(strictWeak.exitCode, 1);
    assert.equal(strictWeak.pers.blocked, true);
    assert.ok(strictWeak.pers.blockers.some(b => b.code === 'matrix-incomplete'));
  }

  // Combined --pers --release where PERS rollup passes (16/16, 0 PERS blockers) while an independent matrix row
  // (not in any journey's matrixIds) fails release rules -> exit 1, NEVER prints overall PASS (exit 1).
  const splitSetup = gitFixture(t, {
    'docs/02-product-spec.md': readFileSync(resolve(fixtures, 'docs/02-product-spec.md'), 'utf8').split('### 3.6 Type matrix')[0],
  });
  const splitMatrix = read(fixtureMatrix).slice(0, 2); // F1 (line+bar pass if area removed) + F2 (cannotVerify without waiver)
  splitMatrix[0].appliesTo = ['line', 'bar'];
  splitMatrix[0].notApplicable.area = 'Out of scope.';
  delete splitMatrix[0].weak;
  const splitMatrixFile = splitSetup.write('acceptance/matrix.json', splitMatrix);
  const splitJourneys = fixtureJourneys(list => list.map(j => ({
    ...j,
    ownedGaps: [],
    testCitations: [
      { kind: 'unit', file: 'chart.test.ts', title: 'line renders', ancestors: ['render examples'] },
      { kind: 'browser', file: 'chart.browser.test.ts', title: 'aria check', ancestors: ['browser'] },
    ],
  })));
  const splitJourneysFile = splitSetup.write('acceptance/journeys.json', splitJourneys);
  splitSetup.git('add', '.');
  splitSetup.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Split release');
  const { runFile: splitRun } = writeCleanRun(out, splitSetup.root, splitMatrix, splitJourneys, 'split.json', [
    {
      name: 'chart.test.ts',
      status: 'passed',
      assertionResults: [
        { title: 'line renders', ancestorTitles: ['render examples'], status: 'passed' },
        { title: 'bar has a baseline', ancestorTitles: ['render examples'], status: 'passed' },
      ],
    },
    {
      name: 'chart.browser.test.ts',
      status: 'passed',
      assertionResults: [
        { title: 'aria check', ancestorTitles: ['browser'], status: 'passed', meta: { engine: 'chromium', engineVersion: '130' } },
      ],
    },
  ]);
  const combinedBlocked = check({ root: splitSetup.root, matrixFile: splitMatrixFile, journeysFile: splitJourneysFile, resultFiles: [splitRun], pers: true, release: true });
  assert.equal(combinedBlocked.pers.blocked, false);
  assert.equal(combinedBlocked.pers.summary.pass, 16);
  assert.equal(combinedBlocked.matrixReleaseBlocked, true);
  assert.equal(combinedBlocked.exitCode, 1);
  assert.match(combinedBlocked.report, /PERS graduation passed; overall release blocked by matrix rules/);
  const cliLine = formatPersSummary(combinedBlocked);
  assert.doesNotMatch(cliLine, /PASS \(exit 1\)/);
  assert.match(cliLine, /16\/16 pass, 0 PERS blocker\(s\); Overall release: BLOCKED by matrix release rules \(exit 1\)/);
});

test('repair item 1: explicit J13 static compositions and strict prefix source-backed identity reject unrelated titles and extra nesting', t => {
  const out = workspace(t);
  const { write, root, git, matrix, matrixFile, journeys, journeysFile } = cleanGraduationSetup(t, {
    extraTests: [
      '',
      "const PAIRS = [['line', 1], ['area', 2], ['bar', 3], ['histogram', 4], ['scatter', 5], ['donut', 6]] as const;",
      "describe('static compositions', () => {",
      '  for (const [kind] of PAIRS) {',
      '    it(`${kind}: has no openStore and agrees with the streaming composition on every other stage`, () => {});',
      '  }',
      '});',
      "describe('prefix suite', () => {",
      "  it('known prefix case', () => {});",
      '});',
    ].join('\n'),
  });
  const kinds = ['line', 'area', 'bar', 'histogram', 'scatter', 'donut'];
  const j13Journeys = journeys.map(j => j.id === 'static-stream'
    ? {
        ...j,
        testCitations: [
          ...kinds.map(kind => ({
            kind: 'unit',
            file: 'chart.test.ts',
            title: `${kind}: has no openStore and agrees with the streaming composition on every other stage`,
            registration: '${kind}: has no openStore and agrees with the streaming composition on every other stage',
            ancestors: ['static compositions'],
          })),
          { kind: 'unit', file: 'chart.test.ts', prefix: 'prefix suite' },
          { kind: 'browser', file: 'chart.browser.test.ts', title: 'aria check', ancestors: ['browser'] },
        ],
      }
    : j);
  const j13File = write('acceptance/journeys.json', j13Journeys);
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'J13 fixture');

  const baseChartAssertions = [
    { title: 'line renders', ancestorTitles: ['render examples'], status: 'passed' },
    { title: 'bar has a baseline', ancestorTitles: ['render examples'], status: 'passed' },
  ];
  const browserSuite = {
    name: 'chart.browser.test.ts',
    status: 'passed',
    assertionResults: [{ title: 'aria check', ancestorTitles: ['browser'], status: 'passed', meta: { engine: 'chromium', engineVersion: '130' } }],
  };
  const validStaticAssertions = kinds.map(kind => ({
    title: `${kind}: has no openStore and agrees with the streaming composition on every other stage`,
    ancestorTitles: ['static compositions'],
    status: 'passed',
  }));

  // Clean match passes strict graduation.
  const { runFile: validRun } = writeCleanRun(out, root, matrix, j13Journeys, 'j13-valid.json', [
    {
      name: 'chart.test.ts',
      status: 'passed',
      assertionResults: [
        ...baseChartAssertions,
        ...validStaticAssertions,
        { title: 'known prefix case', ancestorTitles: ['prefix suite'], status: 'passed' },
      ],
    },
    browserSuite,
  ]);
  assert.equal(check({ root, matrixFile, journeysFile: j13File, resultFiles: [validRun], persStrict: true }).exitCode, 0);

  // Unrelated titles under static compositions are rejected.
  const { runFile: unrelatedRun } = writeCleanRun(out, root, matrix, j13Journeys, 'j13-unrelated.json', [
    {
      name: 'chart.test.ts',
      status: 'passed',
      assertionResults: [
        ...baseChartAssertions,
        ...kinds.map(kind => ({ title: `unrelated ${kind}`, ancestorTitles: ['static compositions'], status: 'passed' })),
        { title: 'known prefix case', ancestorTitles: ['prefix suite'], status: 'passed' },
      ],
    },
    browserSuite,
  ]);
  const unrelatedRes = check({ root, matrixFile, journeysFile: j13File, resultFiles: [unrelatedRun], persStrict: true });
  assert.equal(unrelatedRes.exitCode, 1);
  assert.ok(unrelatedRes.pers.blockers.some(b => b.journeyId === 'static-stream' && b.code === 'unrun-citations'));

  // Extra nesting under static compositions or prefix suite is rejected.
  const { runFile: nestedRun } = writeCleanRun(out, root, matrix, j13Journeys, 'j13-nested.json', [
    {
      name: 'chart.test.ts',
      status: 'passed',
      assertionResults: [
        ...baseChartAssertions,
        ...validStaticAssertions.map(a => ({ ...a, ancestorTitles: ['static compositions', 'extra nested'] })),
        { title: 'known prefix case', ancestorTitles: ['prefix suite', 'extra nested'], status: 'passed' },
      ],
    },
    browserSuite,
  ]);
  const nestedRes = check({ root, matrixFile, journeysFile: j13File, resultFiles: [nestedRun], persStrict: true });
  assert.equal(nestedRes.exitCode, 1);
  assert.ok(nestedRes.pers.blockers.some(b => b.journeyId === 'static-stream' && b.code === 'unrun-citations'));

  // Direct evaluateTestCitation on a template-backed atLeast prefix in strict mode rejects unrelated titles & extra nesting,
  // while keeping matrix non-strict dynamic atLeast and historical failures blocking.
  const chartPath = resolve(root, 'chart.test.ts');
  const sourceEntry = { path: chartPath, titles: readTitles(readFileSync(chartPath, 'utf8'), chartPath) };
  const tmplAtLeastRef = { kind: 'unit', file: 'chart.test.ts', prefix: 'static compositions', atLeast: 6 };
  const unrelatedAtLeast = evaluateTestCitation(sourceEntry, tmplAtLeastRef, {
    strict: true,
    results: new Map([[chartPath, [
      ...kinds.map(kind => ({ title: `unrelated ${kind}`, ancestorTitles: ['static compositions'], status: 'passed', file: 'r.json', engine: null, runEngine: null })),
      ...validStaticAssertions.map(a => ({ ...a, ancestorTitles: ['static compositions', 'nested'], file: 'r.json', engine: null, runEngine: null })),
    ]]]),
    suiteFailures: new Map(),
    stale: new Map(),
  });
  assert.equal(unrelatedAtLeast.status, 'not run');

  const histFailAtLeast = evaluateTestCitation(sourceEntry, tmplAtLeastRef, {
    strict: true,
    results: new Map([[chartPath, [
      ...validStaticAssertions.map(a => ({ ...a, file: 'r.json', engine: null, runEngine: null })),
      { title: 'historical crash', ancestorTitles: ['static compositions'], status: 'failed', file: 'r.json', engine: null, runEngine: null },
    ]]]),
    suiteFailures: new Map(),
    stale: new Map(),
  });
  assert.equal(histFailAtLeast.status, 'fail');
});

test('repair item 2: strict mode requires meta.engine for packages/axylo/test/browser/** across exact, file-only, and linked matrix evidence while keeping packed Chrome fallback', t => {
  const out = workspace(t);
  const { write, root, git } = gitFixture(t, {
    'docs/02-product-spec.md': readFileSync(resolve(fixtures, 'docs/02-product-spec.md'), 'utf8').split('| F2 |')[0],
    'packages/axylo/test/browser/sample.browser.test.ts': "import { describe, it } from 'vitest';\ndescribe('pkg browser', () => {\n  it('renders cleanly', () => {});\n});\n",
    'tests/dist/sample.browser.test.ts': "import { describe, it } from 'vitest';\ndescribe('dist browser', () => {\n  it('packed renders', () => {});\n});\n",
  });
  const [f1] = read(fixtureMatrix);
  f1.appliesTo = ['line'];
  f1.notApplicable.area = 'Out of scope.';
  f1.notApplicable.bar = 'Out of scope.';
  delete f1.evidence.area;
  delete f1.evidence.bar;
  delete f1.weak;
  f1.evidence.line = [{ kind: 'browser', file: 'packages/axylo/test/browser/sample.browser.test.ts', title: 'renders cleanly', ancestors: ['pkg browser'] }];
  const matrix = [f1];
  const matrixFile = write('acceptance/matrix.json', matrix);

  // Test 1: Exact citation + linked matrix on packages/axylo/test/browser/**
  const exactJourneys = fixtureJourneys(list => list.map(j => ({
    ...j,
    testFiles: ['chart.test.ts'],
    accessibilityEvidence: {
      automated: ['packages/axylo/test/browser/sample.browser.test.ts', 'tests/dist/sample.browser.test.ts'],
      manualAt: { status: 'not-applicable', environments: [], protocolNote: 'Fixture.' },
    },
    testCitations: [
      { kind: 'browser', file: 'packages/axylo/test/browser/sample.browser.test.ts', title: 'renders cleanly', ancestors: ['pkg browser'] },
      { kind: 'browser', file: 'tests/dist/sample.browser.test.ts', title: 'packed renders', ancestors: ['dist browser'] },
    ],
  })));
  const exactJourneysFile = write('acceptance/journeys.json', exactJourneys);
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Engine check');

  // Neither meta.engine nor sidecar engine on packages/axylo/test/browser/** -> diagnostic passes, strict blocks!
  const { runFile: noMetaRun } = writeCleanRun(out, root, matrix, exactJourneys, 'no-meta.json', [
    { name: 'chart.test.ts', status: 'passed', assertionResults: [{ title: 'line renders', ancestorTitles: ['render examples'], status: 'passed' }] },
    { name: 'packages/axylo/test/browser/sample.browser.test.ts', status: 'passed', assertionResults: [{ title: 'renders cleanly', ancestorTitles: ['pkg browser'], status: 'passed' }] },
    { name: 'tests/dist/sample.browser.test.ts', status: 'passed', assertionResults: [{ title: 'packed renders', ancestorTitles: ['dist browser'], status: 'passed' }] },
  ]);
  const diagRes = check({ root, matrixFile, journeysFile: exactJourneysFile, resultFiles: [noMetaRun], pers: true });
  assert.equal(diagRes.exitCode, 0);
  assert.equal(diagRes.pers.summary.pass, 16);

  for (const flags of [{ persStrict: true }, { pers: true, release: true }]) {
    const strictNoMeta = check({ root, matrixFile, journeysFile: exactJourneysFile, resultFiles: [noMetaRun], ...flags });
    assert.equal(strictNoMeta.exitCode, 1);
    assert.equal(strictNoMeta.pers.blocked, true);
    assert.ok(strictNoMeta.pers.blockers.some(b => b.code === 'unrun-citations' && b.message.includes('meta.engine')));
    assert.ok(strictNoMeta.pers.blockers.some(b => b.code === 'matrix-incomplete'));
  }

  // File-only citation (testCitations: []) also blocks without meta.engine on packages/axylo/test/browser/**.
  const fileOnlyJourneysFile = out('file-only-pkg.json', exactJourneys.map(j => ({ ...j, testCitations: [] })));
  const strictFileOnlyNoMeta = check({ root, matrixFile, journeysFile: fileOnlyJourneysFile, resultFiles: [noMetaRun], persStrict: true });
  assert.equal(strictFileOnlyNoMeta.exitCode, 1);
  assert.ok(strictFileOnlyNoMeta.pers.blockers.some(b => b.code === 'unpassed-test-files' && b.message.includes('packages/axylo/test/browser/sample.browser.test.ts')));

  // With meta.engine on packages/axylo/test/browser/** and metadata-free packed tests/dist/** -> passes strict graduation!
  const { runFile: stampedRun } = writeCleanRun(out, root, matrix, exactJourneys, 'stamped.json', [
    { name: 'chart.test.ts', status: 'passed', assertionResults: [{ title: 'line renders', ancestorTitles: ['render examples'], status: 'passed' }] },
    {
      name: 'packages/axylo/test/browser/sample.browser.test.ts',
      status: 'passed',
      assertionResults: [{ title: 'renders cleanly', ancestorTitles: ['pkg browser'], status: 'passed', meta: { engine: 'chromium', engineVersion: '130' } }],
    },
    { name: 'tests/dist/sample.browser.test.ts', status: 'passed', assertionResults: [{ title: 'packed renders', ancestorTitles: ['dist browser'], status: 'passed' }] },
  ]);
  for (const jFile of [exactJourneysFile, fileOnlyJourneysFile]) {
    for (const flags of [{ persStrict: true }, { pers: true, release: true }]) {
      const ok = check({ root, matrixFile, journeysFile: jFile, resultFiles: [stampedRun], ...flags });
      assert.equal(ok.exitCode, 0, JSON.stringify(ok.pers.blockers));
      assert.equal(ok.pers.blocked, false);
      assert.equal(ok.pers.summary.pass, 16);
    }
  }
});

test('repair item 3: strict mode surfaces matrix-incomplete for linked template omissions, classifies invalid sidecar engine and absent sidecars cleanly, without hiding malformed results', t => {
  const out = workspace(t);
  const specF1Only = readFileSync(resolve(fixtures, 'docs/02-product-spec.md'), 'utf8').split('| F2 |')[0];
  const { write, root, git } = gitFixture(t, {
    'docs/02-product-spec.md': specF1Only.replace('| F1 |', '| DX1 |'),
    'tests/dist/first-chart.browser.test.ts': [
      "import { describe, it } from 'vitest';",
      'const flavours = pickFlavours();',
      'for (const flavour of flavours) {',
      '  it(`renders under the ${flavour} condition`, () => {});',
      '}',
    ].join('\n'),
  });
  const [f1] = read(fixtureMatrix);
  f1.id = 'DX1';
  f1.appliesTo = ['line'];
  f1.notApplicable.area = 'Out of scope.';
  f1.notApplicable.bar = 'Out of scope.';
  delete f1.evidence.area;
  delete f1.evidence.bar;
  delete f1.weak;
  f1.evidence.line = [
    { kind: 'browser', file: 'tests/dist/first-chart.browser.test.ts', title: 'renders under the production condition', registration: 'renders under the ${flavour} condition' },
    { kind: 'browser', file: 'tests/dist/first-chart.browser.test.ts', title: 'renders under the development condition', registration: 'renders under the ${flavour} condition' },
  ];
  const matrix = [f1];
  const matrixFile = write('acceptance/matrix.json', matrix);
  const dxJourneys = fixtureJourneys(list => list.map(j => ({
    ...j,
    matrixIds: j.matrixIds.length ? ['DX1'] : [],
    testFiles: ['chart.test.ts'],
    accessibilityEvidence: { automated: ['tests/dist/first-chart.browser.test.ts'], manualAt: { status: 'not-applicable', environments: [], protocolNote: 'Fixture.' } },
  })));
  const dxJourneysFile = write('acceptance/journeys.json', dxJourneys);
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'DX1 template');

  const { runFile: omittedProdRun } = writeCleanRun(out, root, matrix, dxJourneys, 'omitted-prod.json', [
    { name: 'chart.test.ts', status: 'passed', assertionResults: [{ title: 'line renders', ancestorTitles: ['render examples'], status: 'passed' }] },
    { name: 'tests/dist/first-chart.browser.test.ts', status: 'passed', assertionResults: [{ title: 'renders under the development condition', ancestorTitles: [], status: 'passed' }] },
  ]);

  // Ordinary matrix & diagnostic mode keep existing confirmation throw.
  assert.throws(() => check({ root, matrixFile, resultFiles: [omittedProdRun] }), /DX1\/line: title never ran/);
  assert.throws(() => check({ root, matrixFile, journeysFile: dxJourneysFile, resultFiles: [omittedProdRun], pers: true }), /DX1\/line: title never ran/);

  // Both strict modes reach structured matrix-incomplete blockers without throwing.
  for (const flags of [{ persStrict: true }, { pers: true, release: true }]) {
    const res = check({ root, matrixFile, journeysFile: dxJourneysFile, resultFiles: [omittedProdRun], ...flags });
    assert.equal(res.exitCode, 1);
    assert.equal(res.pers.blocked, true);
    assert.ok(res.pers.blockers.some(b => b.journeyId === 'first-impression' && b.code === 'matrix-incomplete'));
  }

  // Absent provenance sidecar is classified as missing-provenance (not stale-provenance).
  const noSidecarRun = out('no-sidecar.json', {
    testResults: [
      { name: 'chart.test.ts', status: 'passed', assertionResults: [{ title: 'line renders', ancestorTitles: ['render examples'], status: 'passed' }] },
      { name: 'tests/dist/first-chart.browser.test.ts', status: 'passed', assertionResults: [
        { title: 'renders under the production condition', ancestorTitles: [], status: 'passed' },
        { title: 'renders under the development condition', ancestorTitles: [], status: 'passed' },
      ] },
    ],
  });
  for (const flags of [{ persStrict: true }, { pers: true, release: true }]) {
    const missingRes = check({ root, matrixFile, journeysFile: dxJourneysFile, resultFiles: [noSidecarRun], ...flags });
    assert.equal(missingRes.exitCode, 1);
    assert.ok(missingRes.pers.blockers.some(b => b.code === 'missing-provenance'));
    assert.ok(!missingRes.pers.blockers.some(b => b.code === 'stale-provenance'));
  }

  // Invalid sidecar engine metadata is reported as malformed-provenance in strict mode,
  // without hiding malformed testResults.
  const fullSnap = snapshot(root, citedTestFiles(matrix, dxJourneys));
  const badEngineSidecar = noSidecarRun.replace(/\.json$/, '.provenance.json');
  writeFileSync(badEngineSidecar, JSON.stringify({ ...fullSnap, resultSha256: hashFile(noSidecarRun), changedDuringRun: false, engine: 'safari' }));
  for (const flags of [{ persStrict: true }, { pers: true, release: true }]) {
    const badEngRes = check({ root, matrixFile, journeysFile: dxJourneysFile, resultFiles: [noSidecarRun], ...flags });
    assert.equal(badEngRes.exitCode, 1);
    assert.ok(badEngRes.pers.blockers.some(b => b.code === 'malformed-provenance' && b.message.includes('unknown engine')));
  }

  const malformedResultFile = out('malformed-results.json', { testResults: [{ name: 'chart.test.ts', assertionResults: [{ title: '', status: 'passed', ancestorTitles: [] }] }] });
  writeFileSync(malformedResultFile.replace(/\.json$/, '.provenance.json'), JSON.stringify({ engine: 'safari' }));
  assert.throws(() => check({ root, matrixFile, journeysFile: dxJourneysFile, resultFiles: [malformedResultFile], persStrict: true }), /expected assertion title/);
});

test('repair item 4: plain --release tolerates malformed default journeys.json (including malformed testFiles) and falls back to matrix-only inventory', t => {
  const out = workspace(t);
  const { write, root, git } = gitFixture(t, {
    'docs/02-product-spec.md': readFileSync(resolve(fixtures, 'docs/02-product-spec.md'), 'utf8').split('| F2 |')[0],
    'acceptance/journeys.json': JSON.stringify([{ id: 'first-impression', testFiles: 123 }]),
  });
  const [f1] = read(fixtureMatrix);
  f1.appliesTo = ['line', 'bar'];
  f1.notApplicable.area = 'Out of scope.';
  delete f1.weak;
  const matrix = [f1];
  const matrixFile = write('acceptance/matrix.json', matrix);
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Malformed journeys');

  // Even with no reports, plain --release must not throw on malformed testFiles.
  const noReports = check({ root, matrixFile, release: true });
  assert.equal(noReports.exitCode, 1);

  // With a matching matrix-only sidecar, plain --release succeeds using matrix-only inventory.
  const runFile = out('matrix-run.json', {
    testResults: [{
      name: 'chart.test.ts',
      status: 'passed',
      assertionResults: [
        { title: 'line renders', ancestorTitles: ['render examples'], status: 'passed' },
        { title: 'bar has a baseline', ancestorTitles: ['render examples'], status: 'passed' },
      ],
    }],
  });
  out('matrix-run.provenance.json', {
    ...snapshot(root, citedTestFiles(matrix)),
    resultSha256: hashFile(runFile),
    changedDuringRun: false,
  });
  const okRel = check({ root, matrixFile, resultFiles: [runFile], release: true });
  assert.equal(okRel.exitCode, 0);
  assert.equal(okRel.runs[0].provenanceError, undefined);

  // Invalid JSON in default journeys.json also falls back cleanly.
  write('acceptance/journeys.json', '{ invalid json');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Broken JSON');
  out('matrix-run.provenance.json', {
    ...snapshot(root, citedTestFiles(matrix)),
    resultSha256: hashFile(runFile),
    changedDuringRun: false,
  });
  const brokenJsonRel = check({ root, matrixFile, resultFiles: [runFile], release: true });
  assert.equal(brokenJsonRel.exitCode, 0);

  // Valid default journeys.json preserves both combined sidecars and legacy matrix-only sidecars in ordinary --release.
  const validDefaultJourneys = fixtureJourneys();
  write('acceptance/journeys.json', validDefaultJourneys);
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Valid default journeys');
  out('matrix-run.provenance.json', {
    ...snapshot(root, citedTestFiles(matrix)),
    resultSha256: hashFile(runFile),
    changedDuringRun: false,
  });
  const legacyMatch = check({ root, matrixFile, resultFiles: [runFile], release: true });
  assert.equal(legacyMatch.exitCode, 0);
  assert.equal(legacyMatch.runs[0].provenanceInventory, 'matrix-only');

  out('matrix-run.provenance.json', {
    ...snapshot(root, citedTestFiles(matrix, validDefaultJourneys)),
    resultSha256: hashFile(runFile),
    changedDuringRun: false,
  });
  const combinedMatch = check({ root, matrixFile, resultFiles: [runFile], release: true });
  assert.equal(combinedMatch.exitCode, 0);
  assert.equal(combinedMatch.runs[0].provenanceInventory, 'combined');
});
