/**
 * The conformance page's data (lib/conformance.mjs): it may say only what the specification and the
 * acceptance checker record.
 *
 * - The criteria come from the specification: every "WCAG x.y.z" in the last column of a criterion row (spec
 *   A9), and only those; every criterion no row cites has a reason in data/wcag.mjs.
 * - The checker's structured rows are read as its README documents them, and output outside that shape stops
 *   the build.
 * - Against the checker's own fixtures (acceptance/test/fixtures, whose expected cells its own tests state):
 *   a result without recorded provenance, and a size record of another pack, are "not recorded for this
 *   revision" (the checker's status, with 'not recorded' as the report's result), and a refused matrix
 *   leaves every criterion "not recorded".
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { citedCriteria, evidenceFor, readChecker, readConformance, readRows, uncited } from '../lib/conformance.mjs';
import { wcag } from '../data/wcag.mjs';
import { cacheDir, repoRoot } from '../lib/examples.mjs';
import { stageSite } from '../lib/site.mjs';
import { check, CHART_TYPES } from '../../../acceptance/check.mjs';
import { citedTestFiles, defaultResultFile, hashFile, snapshot } from '../../../acceptance/provenance.mjs';

const fixtures = path.join(repoRoot, 'acceptance/test/fixtures');
const spec = fs.readFileSync(path.join(repoRoot, 'docs/02-product-spec.md'), 'utf8');

describe('the criteria the specification cites', () => {
  it('reads citations from the last column of a criterion row, and nothing else', () => {
    const text = [
      '| ID | Criterion | Verified by | Driven by |',
      '|---|---|---|---|',
      '| I3 | Zoom four ways. | Clicks only | D7, R12, WCAG 2.5.1, 2.5.7, 1.4.4 |',
      '| L1 | Labels never overlap. | Repeated with the WCAG 1.4.12 text-spacing overrides | R2 |',
      '| A9 | Lists every applicable WCAG 2.2 AA success criterion. | CI | R11 |',
      '| Picking by pointer | WCAG 1.4.13 | x | x |',
      'Prose that names WCAG 2.4.7 outside a table.',
    ].join('\n');
    const cited = citedCriteria(text);
    expect([...cited.keys()]).toEqual(['1.4.4', '2.5.1', '2.5.7']);
    expect(cited.get('2.5.7')).toEqual([{ id: 'I3', criterion: 'Zoom four ways.' }]);
  });

  it('a criterion that is not level A or AA of WCAG 2.2 stops the build', () => {
    expect(() => citedCriteria('| X1 | Something. | x | WCAG 1.4.6 |')).toThrow(/1\.4\.6/);
  });

  it('on the specification: every number a "WCAG" in a criterion row\'s last column names is listed', () => {
    const cited = citedCriteria(spec);
    const named = new Set<string>();
    for (const line of spec.split('\n')) {
      if (!/^\| [A-Z]+\d+ \|/.test(line)) continue;
      const last = line.replace(/\|\s*$/, '').split('|').at(-1)!;
      for (const m of last.matchAll(/WCAG ((?:\d\.\d+\.\d+(?:, )?)+)/g)) for (const n of m[1]!.split(', ')) named.add(n);
    }
    expect(named.size).toBeGreaterThan(0);
    expect([...cited.keys()].sort()).toEqual([...named].sort());
  });

  it('every criterion no row cites has a reason: one of the two A9 names, or "not assessed"', () => {
    const kinds = ['not applicable to a chart component', 'the page\'s responsibility', 'not assessed'];
    const missing = uncited(citedCriteria(spec)).filter(sc => !kinds.includes(wcag[sc]![2]!) || !wcag[sc]![3]);
    expect(missing).toEqual([]);
  });
});

describe('reading the checker', () => {
  const fixtureRun = () => check({ root: fixtures, matrixFile: path.join(fixtures, 'matrix.json'), resultFiles: [path.join(fixtures, 'results.json')] });

  it('reads the checker\'s rows on its fixtures as its own tests state them', () => {
    const rows = readRows(fixtureRun().rows);
    const f1 = rows.get('F1')!.cells;
    expect(Object.keys(f1)).toEqual(['line', 'area', 'bar', 'scatter', 'donut', 'compact']);
    expect(f1.line).toEqual({ status: 'pass', releasedGap: null, reports: [{ file: 'results.json', source: 'run', results: ['pass'], engine: null, counted: true, why: null, commit: null }] });
    expect(f1.area!.status).toBe('weak');
    expect(f1.area!.releasedGap).toBeNull();
    expect(f1.area!.reports.map(r => r.results)).toEqual([['skipped']]);
    expect(f1.scatter).toEqual({ status: 'not applicable', releasedGap: null, reports: [] });
    expect(rows.get('F2')!.cells.line!.status).toBe('cannot be verified here');
  });

  it('names the engine of a report that has none from its default result file', () => {
    const rows = readRows(fixtureRun().rows, { engineOf: file => file === 'results.json' ? 'chromium' : null, commitOf: () => 'abc1234' });
    expect(rows.get('F1')!.cells.line!.reports[0]).toMatchObject({ engine: 'chromium', commit: 'abc1234' });
  });

  it('stops on output outside the documented shape', () => {
    const good = fixtureRun().rows;
    const change = (edit: (row: Record<string, any>) => void) => {
      const rows = structuredClone(good) as Record<string, any>[];
      edit(rows[0]!);
      return () => readRows(rows);
    };
    expect(change(row => { row.cells.line.status = 'passed'; })).toThrow(/cannot read/);
    expect(change(row => { delete row.cells.compact; })).toThrow(/cannot read/);
    expect(change(row => { delete row.cells.line.releasedGap; })).toThrow(/invalid released gap/);
    expect(change(row => { row.cells.line.releasedGap = 'A gap on a passing cell.'; })).toThrow(/invalid released gap/);
    expect(change(row => { row.cells.area.releasedGap = '  '; })).toThrow(/invalid released gap/);
    expect(change(row => { row.cells.area.releasedGap = 'Geometry remains unverified.'; })).toThrow(/released gap needs passing results/);
    expect(change(row => { row.cells.line.reports = [{ file: 'x.json', source: 'run', results: ['green'], engine: null, provenanceError: null }]; })).toThrow(/cannot read/);
    expect(change(row => { row.cells.line.reports = [{ file: 'x.json', source: 'run', results: ['pass'], engine: 'safari', provenanceError: null }]; })).toThrow(/cannot read/);
    expect(() => readRows(undefined)).toThrow(/cannot read/);
    // 'not recorded' is a result only with the provenance error that explains it.
    expect(change(row => { row.cells.line.reports = [{ file: 'x.json', source: 'run', results: ['not recorded'], engine: null, provenanceError: null }]; })).toThrow(/cannot read/);
    expect(change(row => { row.cells.line.reports = [{ file: 'x.json', source: 'run', results: ['not recorded'], engine: null, provenanceError: 'provenance does not match the working tree' }]; })).not.toThrow();
    expect(change(row => { row.cells.line.status = 'not recorded for this revision'; })).not.toThrow();
  });

  it('a result without recorded provenance is not counted for this revision', async () => {
    const checker = await readChecker({ root: fixtures, matrixFile: path.join(fixtures, 'matrix.json'), resultFiles: [path.join(fixtures, 'results.json')] });
    expect(checker.refused).toBeNull();
    const { verdict, engines } = evidenceFor([{ id: 'F1', criterion: '' }], checker);
    expect(verdict).toEqual([{ id: 'F1', text: 'not recorded for this revision' }]);
    expect(engines.null).toBe('not recorded for this revision (results from unknown)');
    expect(engines.chromium).toBe('not recorded');
  });

  it('the checker\'s own "not recorded for this revision": a run without provenance in a release', async () => {
    const checker = await readChecker({ root: fixtures, matrixFile: path.join(fixtures, 'matrix.json'), resultFiles: [path.join(fixtures, 'results.json')] });
    const line = checker.rows.get('F1')!.cells.line!;
    expect(line.status).toBe('not recorded for this revision');
    expect(line.reports).toEqual([{ file: 'results.json', source: 'run', results: ['not recorded'], engine: null, counted: false, why: 'release requires recorded provenance', commit: null }]);
    expect(checker.files).toEqual([expect.objectContaining({ file: 'results.json', counted: false, why: 'release requires recorded provenance' })]);
  });

  it('counts matching provenance while the docs build stages its output', async () => {
    fs.mkdirSync(cacheDir, { recursive: true });
    const root = fs.mkdtempSync(path.join(cacheDir, 'conformance-'));
    try {
      const write = (relative: string, contents: string | Buffer) => {
        const file = path.join(root, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, contents);
        return file;
      };
      write('.gitignore', fs.readFileSync(path.join(repoRoot, '.gitignore')));
      const statement = 'Show the fixture faithfully.';
      const citations = [...citedCriteria(spec).keys()].join(', ');
      const specFile = write('docs/02-product-spec.md', `### 3.1 Faithful representation\n| F1 | ${statement} | WCAG ${citations} |\n`);
      const file = 'chart.test.ts';
      const title = 'line renders';
      const areaTitle = 'area renders';
      const gap = 'The area test leaves its geometry unverified.';
      write(file, `it('${title}', () => {});\nit('${areaTitle}', () => {});\n`);
      const matrix = [{
        id: 'F1', statement, appliesTo: ['line', 'area'],
        notApplicable: Object.fromEntries(CHART_TYPES.filter(type => type !== 'line' && type !== 'area').map(type => [type, 'Only line and area fixtures.'])),
        evidence: { line: [{ kind: 'unit', file, title }], area: [{ kind: 'unit', file, title: areaTitle }] },
        gaps: { area: gap },
      }];
      write('acceptance/matrix.json', JSON.stringify(matrix));
      const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
      git('init', '-q');
      git('add', '.');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture');

      const relative = defaultResultFile('unit');
      const result = write(relative, JSON.stringify({
        testResults: [{ name: file, assertionResults: [title, areaTitle].map(title => ({ title, status: 'passed', ancestorTitles: [] })) }],
      }));
      const recorded = { ...snapshot(root, citedTestFiles(matrix)), resultSha256: hashFile(result) };
      write(relative.replace(/\.json$/, '.provenance.json'), JSON.stringify(recorded));
      const direct = check({ root, release: true, resultFiles: [result] });
      expect(direct.exitCode).toBe(0);
      expect(direct.rows[0]!.cells.line.status).toBe('pass');

      await stageSite(path.join(root, 'apps/docs/dist'), async tmp => {
        fs.mkdirSync(path.join(tmp, 'assets'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'assets/site.css'), 'body {}\n');
        const { checker, criteria } = await readConformance({ root });
        expect(checker.refused).toBeNull();
        expect(checker.files).toMatchObject([{ file: relative, counted: true, why: null }]);
        expect(checker.rows.get('F1')!.cells.line!.status).toBe(direct.rows[0]!.cells.line.status);
        expect(checker.rows.get('F1')!.cells.area).toMatchObject({ status: 'weak', releasedGap: gap });
        expect(criteria[0]!.verdict).toEqual([{ id: 'F1', text: `Released with documented gaps (area) · ${gap} · pass (line); not applicable (bar, scatter, donut, compact)` }]);

        fs.appendFileSync(specFile, '\nA source edit made after recording.\n');
        const stale = await readConformance({ root });
        expect(stale.checker.files).toMatchObject([{ file: relative, counted: false, why: 'provenance does not match the working tree' }]);
        expect(stale.criteria[0]!.verdict).toEqual([{ id: 'F1', text: 'not recorded for this revision' }]);
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('a size record of another pack is not recorded for this revision, and no engine\'s', async () => {
    // As the checker's own test of size records builds it (acceptance/test/check.test.mjs, defect 5).
    const dir = fs.mkdtempSync(path.join(cacheDir, 'conformance-'));
    try {
      fs.mkdirSync(path.join(dir, 'docs'));
      fs.copyFileSync(path.join(fixtures, 'docs/02-product-spec.md'), path.join(dir, 'docs/02-product-spec.md'));
      const matrix = JSON.parse(fs.readFileSync(path.join(fixtures, 'matrix.json'), 'utf8')).map((row: object) => ({ ...row, evidence: {}, weak: {} }));
      matrix[0].evidence = { line: [{ kind: 'size', file: 'size.json', entries: ['line only'] }] };
      fs.writeFileSync(path.join(dir, 'matrix.json'), JSON.stringify(matrix));
      fs.writeFileSync(path.join(dir, 'size.json'), JSON.stringify({ packed: { axylo: 'sha512-measured' }, rows: [{ entry: 'line only', minBytes: 2000, totalGzipBytes: 1000, targetKiB: 1 }] }));
      const options = { root: dir, matrixFile: path.join(dir, 'matrix.json'), resultFiles: [], sizeTargets: { 'line only': 1 } };
      const same = await readChecker({ ...options, packIntegrity: 'sha512-measured' });
      expect(same.rows.get('F1')!.cells.line!.status).toBe('pass');
      const other = await readChecker({ ...options, packIntegrity: 'sha512-current' });
      const line = other.rows.get('F1')!.cells.line!;
      expect(line.status).toBe('not recorded for this revision');
      expect(line.reports).toEqual([{ file: 'size.json', source: 'size', results: ['not recorded'], engine: null, counted: false, why: 'the size record measured another pack (sha512-measured)', commit: null }]);
      expect(evidenceFor([{ id: 'F1', criterion: '' }], other)).toEqual({
        verdict: [{ id: 'F1', text: 'not recorded for this revision' }],
        engines: { chromium: 'not recorded', firefox: 'not recorded', webkit: 'not recorded', null: 'not recorded' },
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a refused matrix leaves every criterion not recorded', async () => {
    const checker = await readChecker({ root: fixtures, matrixFile: path.join(fixtures, 'stale.json'), resultFiles: [path.join(fixtures, 'results.json')] });
    expect(checker.refused!.join('\n')).toMatch(/stale criterion ID: F88/);
    expect(evidenceFor([{ id: 'F1', criterion: '' }], checker)).toEqual({
      verdict: [{ id: 'F1', text: 'not recorded' }],
      engines: { chromium: 'not recorded', firefox: 'not recorded', webkit: 'not recorded', null: 'not recorded' },
    });
  });
});

describe('what is counted', () => {
  // A checker report as readChecker returns it, written out: one row, two engines, one stale run.
  const report = (file: string, engine: string, results: string[], counted = true, commit = 'aaaaaaa1') => ({ file, source: 'run', results, engine, counted, commit });
  const checker = {
    refused: null,
    rows: new Map([['I4', { statement: '', cells: {
      line: { status: 'pass', reports: [report('browser.json', 'chromium', ['pass']), report('browser-webkit.json', 'webkit', ['fail', 'pass'])] },
      donut: { status: 'not applicable', reports: [] },
    } }]]),
  };

  it('each engine says what its own results said, and the verdict lists the chart types', () => {
    expect(evidenceFor([{ id: 'I4', criterion: '' }], checker)).toEqual({
      verdict: [{ id: 'I4', text: 'pass (line); not applicable (donut)' }],
      engines: { chromium: 'pass', firefox: 'not recorded', webkit: 'fail/pass', null: 'not recorded' },
    });
  });

  it('a row with a result from another revision has no verdict for this one', () => {
    const stale = { ...checker, rows: new Map([['I4', { statement: '', cells: { line: { status: 'pass', reports: [report('browser-firefox.json', 'firefox', ['pass'], false, 'bbbbbbb2')] } } }]]) };
    expect(evidenceFor([{ id: 'I4', criterion: '' }], stale)).toEqual({
      verdict: [{ id: 'I4', text: 'not recorded for this revision' }],
      engines: { chromium: 'not recorded', firefox: 'not recorded for this revision (results from bbbbbbb)', webkit: 'not recorded', null: 'not recorded' },
    });
  });

  it('shows a documented gap that qualifies even when another chart type has stale results', () => {
    const gap = 'The compact chart has no pause control.';
    const mixed = { ...checker, rows: new Map([['I6', { statement: '', cells: {
      line: { status: 'weak', releasedGap: null, reports: [report('browser.json', 'chromium', ['not recorded'], false)] },
      compact: { status: 'weak', releasedGap: gap, reports: [] },
    } }]]) };
    expect(evidenceFor([{ id: 'I6', criterion: '' }], mixed).verdict).toEqual([
      { id: 'I6', text: `Released with documented gaps (compact) · ${gap} · not recorded for this revision` },
    ]);
  });

  it('a row the checker does not have is not recorded', () => {
    expect(evidenceFor([{ id: 'A99', criterion: '' }], checker).verdict).toEqual([{ id: 'A99', text: 'not recorded' }]);
  });
});
