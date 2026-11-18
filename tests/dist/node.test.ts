/**
 * Spec DX8, the Node half, from the packed files in child processes started inside the fixtures (so Node,
 * not Vitest's resolver, finds the packages, and no test-runner globals are present):
 * - importing `axylo` without DOM globals does not throw and adds no globals (the `sideEffects` claim);
 * - `validate()` runs there and reports the Phase 1 `dirty` fixture as spec 3.5 and plan 1.6 say.
 */
import { describe, expect, it } from 'vitest';
import { fixture, inside, nodeJson } from './paths';

interface Probe {
  domGlobals: string[];
  resolved: string;
  exports: string[];
  addedGlobals: string[];
  diagnostics: { code: string; level: string; field?: string; rows?: number[]; count?: number; chart: string }[];
  missingTarget: string | null;
}

describe.each([[[]], [['--conditions=development']]] as const)('axylo in plain Node %j', conditions => {
  const probe = nodeJson<Probe>(fixture('npm'), [...conditions, 'node-import.mjs']);

  it('ran without DOM globals, from the packed file', () => {
    // Node itself has had a `navigator` global since v21; the DOM ones must be absent.
    expect(probe.domGlobals.filter(g => g !== 'navigator')).toEqual([]);
    expect(inside(fixture('npm', 'node_modules/axylo'), new URL(probe.resolved).pathname)).toBe(true);
  });

  it('exports the five chart functions and validate, and adds no globals on import', () => {
    expect(probe.exports).toEqual(['area', 'bar', 'donut', 'line', 'scatter', 'validate']);
    expect(probe.addedGlobals).toEqual([]);
  });

  it('validate() reports the dirty fixture: AX102, AX103 and AX106 once each, with field and rows (spec 3.5, plan 1.6)', () => {
    const problems = probe.diagnostics.filter(d => d.level !== 'hint');
    expect(problems.map(d => d.code).sort()).toEqual(['AX102', 'AX103', 'AX106']);
    const by = Object.fromEntries(problems.map(d => [d.code, d]));
    // Row indexes: NaN is row 3 (Thu), '40' row 4 (Fri), the absent value row 5 (Sat).
    expect(by.AX103).toMatchObject({ level: 'warning', field: 'value', rows: [3], chart: 'Dirty input' });
    expect(by.AX106).toMatchObject({ level: 'warning', field: 'value', rows: [4], chart: 'Dirty input' });
    expect(by.AX102).toMatchObject({ level: 'warning', field: 'value', rows: [5], chart: 'Dirty input' });
  });

  it('a chart function called without a document throws an error that names the target', () => {
    expect(probe.missingTarget).toContain('#nowhere');
  });
});
