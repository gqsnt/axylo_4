/**
 * The conformance page's data (lib/conformance.mjs): it may say only what the specification and the
 * acceptance checker record.
 *
 * - The criteria come from the specification: every "WCAG x.y.z" a criterion row cites, and only those.
 * - The checker's table is read cell by cell, and output it cannot read stops the build.
 * - Against the checker's own fixtures (acceptance/test/fixtures, whose expected cells its own tests state):
 *   a result without recorded provenance is not counted for this revision, and a refused matrix leaves
 *   every criterion "not recorded".
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { citedCriteria, evidenceFor, parseCell, parseTable, readChecker } from '../lib/conformance.mjs';
import { repoRoot } from '../lib/examples.mjs';
import { check } from '../../../acceptance/check.mjs';

const fixtures = path.join(repoRoot, 'acceptance/test/fixtures');
const spec = fs.readFileSync(path.join(repoRoot, 'docs/02-product-spec.md'), 'utf8');

describe('the criteria the specification cites', () => {
  it('reads citations from any cell of a criterion row, and nothing else', () => {
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
    expect([...cited.keys()]).toEqual(['1.4.4', '1.4.12', '2.5.1', '2.5.7']);
    expect(cited.get('2.5.7')).toEqual([{ id: 'I3', criterion: 'Zoom four ways.' }]);
    expect(cited.get('1.4.12')).toEqual([{ id: 'L1', criterion: 'Labels never overlap.' }]);
  });

  it('a criterion that is not level A or AA of WCAG 2.2 stops the build', () => {
    expect(() => citedCriteria('| X1 | Something. | x | WCAG 1.4.6 |')).toThrow(/1\.4\.6/);
  });

  it('on the specification: every number a "WCAG" in a criterion row names is listed', () => {
    const cited = citedCriteria(spec);
    const named = new Set<string>();
    for (const line of spec.split('\n')) {
      if (!/^\| [A-Z]+\d+ \|/.test(line)) continue;
      for (const m of line.matchAll(/WCAG ((?:\d\.\d+\.\d+(?:, )?)+)/g)) for (const n of m[1]!.split(', ')) named.add(n);
    }
    expect(named.size).toBeGreaterThan(0);
    expect([...cited.keys()].sort()).toEqual([...named].sort());
  });
});

describe('reading the checker', () => {
  it('reads a cell with and without reports', () => {
    expect(parseCell('not applicable')).toEqual({ status: 'not applicable', reports: [] });
    expect(parseCell('cannot be verified here')).toEqual({ status: 'cannot be verified here', reports: [] });
    expect(parseCell('pass (unit.json pass, acceptance/results/browser.json pass/fail)')).toEqual({
      status: 'pass', reports: [{ label: 'unit.json', results: ['pass'] }, { label: 'acceptance/results/browser.json', results: ['pass', 'fail'] }],
    });
  });

  it('stops on a cell it cannot read', () => {
    expect(() => parseCell('passed')).toThrow(/cannot read/);
    expect(() => parseCell('pass (unit.json green)')).toThrow(/cannot read/);
  });

  it('reads the checker\'s table on its fixtures as its own tests state it', () => {
    const { types, rows } = parseTable(check({ root: fixtures, matrixFile: path.join(fixtures, 'matrix.json'), resultFiles: [path.join(fixtures, 'results.json')] }).table);
    expect(types).toEqual(['line', 'area', 'bar', 'scatter', 'donut', 'compact']);
    const f1 = rows.get('F1')!.cells;
    expect(f1.line).toEqual({ status: 'pass', reports: [{ label: 'results.json', results: ['pass'] }] });
    expect(f1.area).toEqual({ status: 'weak', reports: [{ label: 'results.json', results: ['skipped'] }] });
    expect(f1.scatter!.status).toBe('not applicable');
    expect(rows.get('F2')!.cells.line!.status).toBe('cannot be verified here');
  });

  it('a result without recorded provenance is not counted for this revision', async () => {
    const checker = await readChecker({ root: fixtures, matrixFile: path.join(fixtures, 'matrix.json'), resultFiles: [path.join(fixtures, 'results.json')] });
    expect(checker.refused).toBeNull();
    const { verdict, engines } = evidenceFor([{ id: 'F1', criterion: '' }], checker);
    expect(verdict).toEqual([{ id: 'F1', text: 'not recorded for this revision' }]);
    expect(engines.null).toBe('not recorded for this revision (results from unknown)');
    expect(engines.chromium).toBe('not recorded');
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
  const checker = {
    refused: null,
    rows: new Map([['I4', { statement: '', cells: {
      line: { status: 'pass', reports: [{ label: 'browser.json', results: ['pass'] }, { label: 'browser-webkit.json', results: ['pass', 'fail'] }] },
      donut: { status: 'not applicable', reports: [] },
    } }]]),
    runs: new Map([
      ['browser.json', { engine: 'chromium', counted: true, commit: 'aaaaaaa1' }],
      ['browser-webkit.json', { engine: 'webkit', counted: true, commit: 'aaaaaaa1' }],
      ['browser-firefox.json', { engine: 'firefox', counted: false, commit: 'bbbbbbb2' }],
    ]),
  };

  it('each engine says what its own results said, and the verdict lists the chart types', () => {
    expect(evidenceFor([{ id: 'I4', criterion: '' }], checker)).toEqual({
      verdict: [{ id: 'I4', text: 'pass (line); not applicable (donut)' }],
      engines: { chromium: 'pass', firefox: 'not recorded', webkit: 'fail/pass', null: 'not recorded' },
    });
  });

  it('a row with a result from another revision has no verdict for this one', () => {
    const stale = { ...checker, rows: new Map([['I4', { statement: '', cells: { line: { status: 'pass', reports: [{ label: 'browser-firefox.json', results: ['pass'] }] } } }]]) };
    expect(evidenceFor([{ id: 'I4', criterion: '' }], stale)).toEqual({
      verdict: [{ id: 'I4', text: 'not recorded for this revision' }],
      engines: { chromium: 'not recorded', firefox: 'not recorded for this revision (results from bbbbbbb)', webkit: 'not recorded', null: 'not recorded' },
    });
  });

  it('a row the checker does not have is not recorded', () => {
    expect(evidenceFor([{ id: 'A99', criterion: '' }], checker).verdict).toEqual([{ id: 'A99', text: 'not recorded' }]);
  });
});
