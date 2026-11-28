/**
 * N9a repair round 8 (review sol-6.2-medium__20261127T220111Z): an empty grid / density pair is malformed where
 * the chart reads the row's median as a value, so the decision follows the chart's own value admission (missing
 * values, row vs column NaN, whole-column decimal strings, x admission), not a second parser in the violin reader.
 *
 * Fixtures: two rows with distinct x, min 1, Q1 1, Q3 4, max 4, an empty pair on row 0 and a valid outline on row 1.
 * Expected values come from the data rules (spec 3.5): '' and a column NaN are missing; a row-form NaN is a
 * non-finite number (AX103), which makes the column's decimal strings non-numeric (AX106 on the median); a decimal
 * string column is read as numbers (AX104 hint); a row whose x is not admitted is not in the frame.
 */
import { describe, expect, it } from 'vitest';
import { validateCartesian } from '../../src/cartesian';
import { readerDisclosure } from '../../src/diagnostics/collector';
import { n5run, type N5Run } from './n5-pipeline';

type Row = Record<string, unknown>;
const box = { min: 1, q1: 1, q3: 4, max: 4 };
const outline = { grid: [0, 1], density: [1, 1] };
const pair = (m0: unknown, m1: unknown, extra: Row = {}): Row[] => [
  { x: 'A', ...box, median: m0, grid: [], density: [], ...extra },
  { x: 'B', ...box, median: m1, ...outline },
];
const options = (data: unknown, median: unknown = 'median') =>
  ({ data, x: 'x', axes: { v: { position: 'left' } }, layers: [{ type: 'violin', yAxis: 'v', median }] }) as never;
const run = (data: unknown, median?: unknown) => n5run(options(data, median));
const omissions = (r: N5Run) => r.diagnostics.filter(d => d.level !== 'hint').map(d => [d.code, d.field, d.rows]);
const grid = (r: N5Run) => r.diagnostics.filter(d => d.field === 'grid');

describe('N9a repair 8: the empty-outline AX106 follows the normalized median', () => {
  it("['', '3']: the empty median is missing, so row 0 is silent no data", () => {
    const r = run(pair('', '3'));
    expect(grid(r)).toEqual([]);
    expect(omissions(r)).toEqual([]);
  });

  it("['2', NaN] in row form: the median is rejected (AX106 on median) and row 0 is not also an AX106 grid", () => {
    const r = run(pair('2', NaN));
    expect(grid(r)).toEqual([]);
    expect(omissions(r)).toEqual([['AX106', 'median', [0]], ['AX103', 'median', [1]]]);
    // An explicit parse does not change what the chart reads here, so neither does it change the outline report.
    expect(grid(run(pair('2', NaN), { field: 'median', parse: 'number' }))).toEqual([]);
  });

  it('a column-form NaN is missing: silent on its own empty row, and it leaves a decimal column numeric', () => {
    const cols = (median: unknown[]) => ({ columns: { x: ['A', 'B'], ...Object.fromEntries(Object.entries(box).map(([k, v]) => [k, [v, v]])), median, grid: [[], outline.grid], density: [[], outline.density] } });
    expect(omissions(run(cols([NaN, 3])))).toEqual([]);
    const decimal = run(cols(['2', NaN]));
    expect(grid(decimal).map(d => [d.code, d.rows, d.effect])).toEqual([['AX106', [0], 'omitted']]);
  });

  it("['2', 2]: a mixed column rejects the string (AX106 on median only)", () => {
    const r = run(pair('2', 2));
    expect(grid(r)).toEqual([]);
    expect(omissions(r)).toEqual([['AX106', 'median', [0]]]);
  });

  it("['2', '3']: an accepted decimal median with an empty outline is reported once, as an omission", () => {
    for (const median of ['median', { field: 'median', parse: 'number' }]) {
      const r = run(pair('2', '3'), median);
      expect(grid(r).map(d => [d.code, d.level, d.rows, d.count, d.effect])).toEqual([['AX106', 'warning', [0], 1, 'omitted']]);
      expect(readerDisclosure(r.diagnostics).omitted).toBe(1);
    }
  });

  it('a row whose x is not admitted is not in the frame, so its finite median does not make its empty pair malformed', () => {
    const rows = pair(2, 3);
    rows[0]!.x = null;
    const r = run(rows);
    expect(grid(r)).toEqual([]);
    expect(r.diagnostics.some(d => d.field === 'x')).toBe(true);
    // The same row with an admitted x is reported: the frame, not the payload alone, decides.
    expect(grid(run(pair(2, 3))).map(d => d.rows)).toEqual([[0]]);
  });

  it('a positive n still reports the empty pair, whatever the median or x, and only once per row', () => {
    const rows = [...pair(NaN, 3, { n: 4 }), { x: null, ...box, median: 2, n: 5, grid: [], density: [] }, { x: 'D', ...box, median: 2, n: 6, grid: [], density: [] }];
    expect(grid(run(rows)).map(d => [d.code, d.rows, d.count])).toEqual([['AX106', [0, 2, 3], 3]]);
  });

  it('samples the first source rows in source order, not slot order, and counts them all', () => {
    // Numeric x descending: the frame sorts slots by x, so slot order is the reverse of source order.
    const rows: Row[] = Array.from({ length: 14 }, (_, i) => ({ x: 100 - i, ...box, median: 2, grid: [], density: [] }));
    rows.push({ x: 0, ...box, median: 2, ...outline });
    const [d, ...more] = grid(run(rows));
    expect(more).toEqual([]);
    expect([d!.rows, d!.count]).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 14]);
  });

  it('validateCartesian reports the same as the chart pipeline', () => {
    const found = validateCartesian(options(pair('2', '3'))).filter(d => d.field === 'grid');
    expect(found.map(d => [d.code, d.rows])).toEqual([['AX106', [0]]]);
    expect(validateCartesian(options(pair('2', NaN))).filter(d => d.field === 'grid')).toEqual([]);
  });
});
