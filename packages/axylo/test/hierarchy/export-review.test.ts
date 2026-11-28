/**
 * W4 integration review (blocker 4): the hierarchy export capability exposes only a fully drawn revision, and
 * the committed table's text is fixed once read.
 *
 * Rules under test (export contract: the capability reads the state the figure fully shows; spec A4: the table
 * holds every node, and an export reads what the reader reads, closed or open):
 * 1. drawing that stops because a value formatter keeps changing the chart (the retry limit) leaves parts of
 *    several revisions on screen, so the capability exposes no figure, plot or table until a paint completes;
 *    the next complete paint exposes that revision whole;
 * 2. a value formatter that exports the same table while it formats a row not read yet (a nested export) does
 *    not enter the formatter again for that table: the nested read gets the default text, the formatter runs
 *    once for that value, and the table's own row keeps the formatter's text;
 * 3. with more nodes than the bounded node cache holds (4,096), a formatter that answers differently on every
 *    call still gives one text per node: CSV closed, CSV again, CSV with the table open, and the open page agree.
 */
import { describe, expect, it, vi } from 'vitest';
import { treemap, sunburst, type HierarchyNode, type HierarchyOptions } from '../../src/hierarchy';
import { exportCsv, parseCsv } from '../../src/export';
import { fakeTarget, type FakeElement } from './fake-dom';

const EXPORT = Symbol.for('axylo.export');
type Seam = { readonly table: { rowCount: number; row(i: number): readonly string[] | null } | null; readonly figure: unknown; readonly plot: unknown };
type Chart = ReturnType<typeof treemap>;

function open(kind: typeof treemap, options: Partial<HierarchyOptions>) {
  const { target, host } = fakeTarget();
  const chart = kind(target, { title: 'Tree', ...options } as HierarchyOptions);
  return { chart, host, seam: (chart as unknown as Record<symbol, Seam>)[EXPORT]! };
}
const button = (host: FakeElement, text: string) => host.find(e => e.tagName === 'BUTTON' && e.textContent === text)!;
const bodyRows = (host: FakeElement) => host.all(e => e.tagName === 'TR' && e.hasAttribute('data-node'));
const heading = (host: FakeElement) => host.find(e => e.tagName === 'H3')?.textContent;

const SMALL: HierarchyNode = { label: 'R', children: [{ label: 'A', value: 40 }, { label: 'B', value: 2 }] };

describe.each([['treemap', treemap], ['sunburst', sunburst]] as const)('%s export after review', (_name, kind) => {
  it('exposes nothing after drawing stopped at the retry limit, and the whole next revision once it is drawn', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let chart: Chart | null = null;
    let flipping = true, flip = false;
    // Each update makes a new reader, so the table's row for A is formatted again on every retry.
    const format = (v: number) => { if (flipping && chart && v === 40) { flip = !flip; chart.update({ title: flip ? 'x' : 'y' }); } return `${v} u`; };
    const o = open(kind, { data: SMALL, value: { format } });
    chart = o.chart;
    button(o.host, 'View as table').dispatch('click', {});
    expect(error).toHaveBeenCalledWith(expect.stringContaining('keeps changing the chart'));
    expect([o.seam.figure, o.seam.plot, o.seam.table]).toEqual([null, null, null]);
    expect(() => exportCsv(o.chart)).toThrow();

    flipping = false;
    o.chart.update({ title: 'Settled' });
    expect(heading(o.host)).toBe('Settled');
    expect(o.seam.figure).toBe(o.chart.element);
    expect(o.seam.plot).not.toBeNull();
    expect(o.seam.table).toBe(o.chart.table);
    expect(parseCsv(exportCsv(o.chart)).slice(1).map(r => [r[0], r[2]])).toEqual([['R', '42 u'], ['R / A', '40 u'], ['R / B', '2 u']]);
    error.mockRestore();
  });

  it('after the retry limit, false drills keep export closed while parts are left; the paint that draws every part opens it on the drawn revision', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let chart: Chart | null = null;
    let flipping = true, flip = false;
    const format = (v: number) => { if (flipping && chart && v === 40) { flip = !flip; chart.update({ title: flip ? 'x' : 'y' }); } return `${v} u`; };
    const o = open(kind, { data: SMALL, value: { format } });
    chart = o.chart;
    button(o.host, 'View as table').dispatch('click', {});
    expect(error).toHaveBeenCalledWith(expect.stringContaining('keeps changing the chart'));
    expect([o.seam.figure, o.seam.plot, o.seam.table]).toEqual([null, null, null]);

    // A drill to nothing changes nothing, and its paint still stops at the limit: export stays closed.
    expect(o.chart.drill('missing')).toBe(false);
    expect([o.seam.figure, o.seam.plot, o.seam.table]).toEqual([null, null, null]);
    expect(() => exportCsv(o.chart)).toThrow();
    // A second false drill paints the parts still marked; with the table open the formatter flips again.
    expect(o.chart.drill('missing')).toBe(false);
    expect([o.seam.figure, o.seam.plot, o.seam.table]).toEqual([null, null, null]);

    // A partial action (the table toggle) closes the table, so the formatter is not run and the paint draws every
    // part still marked: export opens, and reads the revision whose title is on screen.
    o.host.find(e => e.tagName === 'BUTTON' && e.hasAttribute('aria-controls'))!.dispatch('click', {});
    const title = flip ? 'x' : 'y';
    expect(heading(o.host)).toBe(title);
    expect(o.seam.figure).toBe(o.chart.element);
    expect(o.seam.plot).not.toBeNull();
    expect(o.seam.table).toBe(o.chart.table);
    flipping = false;
    expect(parseCsv(exportCsv(o.chart)).slice(1).map(r => [r[0], r[2]])).toEqual([['R', '42 u'], ['R / A', '40 u'], ['R / B', '2 u']]);
    expect(o.chart.drill('missing')).toBe(false);
    expect(heading(o.host)).toBe(title);
    expect(o.seam.figure).toBe(o.chart.element);
    error.mockRestore();
  });

  it('a nested export from the formatter of a row not read yet does not enter the formatter again', () => {
    let chart: Chart | null = null;
    let calls40 = 0;
    const nested: string[] = [];
    const format = (v: number) => {
      if (v === 40) {
        calls40++;
        if (chart && calls40 < 50) nested.push(exportCsv(chart));
      }
      return `${v} u`;
    };
    const o = open(kind, { data: SMALL, value: { format } });
    chart = o.chart;
    const outer = exportCsv(o.chart);
    expect(calls40).toBe(1);
    expect(nested).toHaveLength(1);
    // The nested read of A (being formatted) is in the default format; the table's own row is the formatter's.
    expect(parseCsv(nested[0]!).slice(1).map(r => r[0])).toEqual(['R', 'R / A', 'R / B']);
    expect(parseCsv(nested[0]!)[2]![2]).not.toBe('40 u');
    expect(parseCsv(outer).slice(1).map(r => r[2])).toEqual(['42 u', '40 u', '2 u']);
    expect(exportCsv(o.chart)).toBe(outer);
    expect(calls40).toBe(1);
  });
});

describe('committed table text past the node cache', () => {
  it('a formatter that answers differently every call gives the same text closed, again and open, for 4,201 nodes', () => {
    const LEAVES = 4200;
    let calls = 0;
    const format = (v: number) => `${v}#${calls++}`;
    const data: HierarchyNode = { id: 'R', label: 'R', children: Array.from({ length: LEAVES }, (_, i) => ({ id: `L${i}`, label: `L${i}`, value: i + 1 })) };
    const o = open(treemap, { data, value: { format } });
    expect(o.seam.table!.rowCount).toBe(1 + LEAVES);
    const closed = exportCsv(o.chart);
    expect(parseCsv(closed).length).toBe(2 + LEAVES);
    expect(exportCsv(o.chart)).toBe(closed);
    button(o.host, 'View as table').dispatch('click', {});
    expect(exportCsv(o.chart)).toBe(closed);
    const page = bodyRows(o.host).map(r => [...r.children].map(c => c.textContent));
    expect(page.length).toBe(100);
    expect(page).toEqual(parseCsv(closed).slice(1, 101));
    expect(exportCsv(o.chart)).toBe(closed);
  });
});
