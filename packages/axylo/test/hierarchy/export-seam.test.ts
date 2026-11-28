/**
 * W4 integration: the `axylo/export` capability of the hierarchy charts (export/contract.ts) and the table's
 * paging (spec A4: 100 rows per page), on the minimal DOM.
 *
 * Rules under test, from the contract and the spec, not from a run:
 * - the capability sits on the handle under Symbol.for('axylo.export'), not enumerable and not writable, and in
 *   the shared registry under the figure and the element it is mounted in; destroy removes both entries and every
 *   getter then reads null;
 * - its table is the committed table, every node in pre-order; `exportCsv` gives one line per node plus the header,
 *   the same with the table closed or open and on any page;
 * - while parts are drawn (a value formatter runs then) the plot is null and the table is the one last shown;
 * - the reader pages that table 100 rows at a time without changing the drilled node or the focus.
 *
 * Fixture: one root, three branches B0..B2, 130 leaves L0..L129 (L_i under B_(i mod 3), value i + 1): 134 nodes.
 */
import { describe, expect, it } from 'vitest';
import { sunburst, treemap, type HierarchyNode, type HierarchyOptions, type TreemapChart } from '../../src/hierarchy';
import { exportCsv, parseCsv } from '../../src/export';
import { fakeTarget, type FakeElement } from './fake-dom';

const EXPORT = Symbol.for('axylo.export');
type Seam = { readonly table: { rowCount: number; pageSize: number; row(i: number): readonly string[] | null; pageForX(x: string): number | null } | null; readonly figure: unknown; readonly plot: unknown };

const LEAVES = 130;
const branches: HierarchyNode[] = [0, 1, 2].map(b => ({
  id: `B${b}`, label: `B${b}`,
  children: Array.from({ length: LEAVES }, (_, i) => i).filter(i => i % 3 === b).map(i => ({ id: `L${i}`, label: `L${i}`, value: i + 1 })),
}));
const DATA: HierarchyNode = { id: 'Root', label: 'Root', children: branches };
/** Pre-order paths and depths, from the fixture. */
const PREORDER: { path: string; depth: number; label: string }[] = [{ path: 'Root', depth: 0, label: 'Root' }];
for (const b of branches) {
  PREORDER.push({ path: `Root / ${b.label}`, depth: 1, label: b.label! });
  for (const l of b.children!) PREORDER.push({ path: `Root / ${b.label} / ${l.label}`, depth: 2, label: l.label! });
}
const NODES = PREORDER.length;

function open(kind: typeof treemap, options: Partial<HierarchyOptions> = {}) {
  const { target, host } = fakeTarget();
  const chart = kind(target, { title: 'Tree', data: DATA, ...options } as HierarchyOptions);
  return { chart, host, seam: (chart as unknown as Record<symbol, Seam>)[EXPORT]! };
}
const button = (host: FakeElement, text: string) => host.find(e => e.tagName === 'BUTTON' && e.textContent === text)!;
const bodyRows = (host: FakeElement) => host.all(e => e.tagName === 'TR' && e.hasAttribute('data-node'));

describe.each([['treemap', treemap], ['sunburst', sunburst]] as const)('%s export capability', (_name, kind) => {
  it('is on the handle, not enumerable and read-only, and in the shared registry under the figure and its mount', () => {
    const { chart, host, seam } = open(kind);
    const descriptor = Object.getOwnPropertyDescriptor(chart, EXPORT)!;
    expect(descriptor.enumerable).toBe(false);
    expect(descriptor.writable).toBe(false);
    expect(Object.keys(chart)).not.toContain(EXPORT.toString());
    expect(Object.isFrozen(seam)).toBe(true);
    const registry = (globalThis as unknown as Record<symbol, WeakMap<object, Seam>>)[EXPORT]!;
    expect(registry.get(chart.element)).toBe(seam);
    expect(registry.get(host)).toBe(seam);
    expect(seam.figure).toBe(chart.element);
    expect(seam.plot).not.toBeNull();
    chart.destroy();
    expect([seam.table, seam.figure, seam.plot]).toEqual([null, null, null]);
    expect(registry.get(chart.element)).toBeUndefined();
    expect(registry.get(host)).toBeUndefined();
  });

  it('exports every node as CSV, the same with the table closed, open on page 1 and open on page 2', () => {
    const { chart, host, seam } = open(kind);
    expect(seam.table).toBe(chart.table);
    expect(seam.table!.rowCount).toBe(NODES);
    const closed = exportCsv(chart);
    const rows = parseCsv(closed);
    expect(rows.length).toBe(1 + NODES);
    expect(rows[0]).toEqual(['Path', 'Depth', 'Value', '% of Parent', '% of Root']);
    expect(rows.slice(1).map(r => [r[0], Number(r[1])])).toEqual(PREORDER.map(n => [n.path, n.depth]));

    button(host, 'View as table').dispatch('click', {});
    expect(bodyRows(host).length).toBe(100);
    expect(exportCsv(chart)).toBe(closed);
    button(host, 'Next page').dispatch('click', {});
    expect(bodyRows(host).length).toBe(NODES - 100);
    expect(bodyRows(host)[0]!.getAttribute('data-node')).toBe('100');
    expect(exportCsv(chart)).toBe(closed);
    // The mounted-target lookup (figure, container) needs a real DOM: tests/dist/w4-spatial-hierarchy.browser.test.ts.
  });
});

describe('hierarchy table paging (spec A4)', () => {
  it('pages 100 rows, finds a node\'s page, and leaves the drilled node and focus as they were', () => {
    const { chart, host } = open(treemap);
    const table = chart.table!;
    expect(table.pageSize).toBe(100);
    const at = (label: string) => PREORDER.findIndex(n => n.label === label);
    for (const label of ['Root', 'B1', 'L0', 'L129', PREORDER[100]!.label, PREORDER[99]!.label]) {
      expect(table.pageForX(label), label).toBe(Math.floor(at(label) / 100));
    }
    expect(chart.drill('B1')).toBe(true);
    const drilled = chart.drilled.id, focused = chart.focused?.id;
    button(host, 'View as table').dispatch('click', {});
    const status = () => host.find(e => e.getAttribute('class') === 'axylo-h-page')!.textContent;
    expect(status()).toBe('Page 1 of 2');
    button(host, 'Next page').dispatch('click', {});
    expect(status()).toBe('Page 2 of 2');
    // Past the last page: nothing moves.
    button(host, 'Next page').dispatch('click', {});
    expect(status()).toBe('Page 2 of 2');
    expect(bodyRows(host).map(r => r.find(c => c.tagName === 'TH')!.textContent)).toEqual(PREORDER.slice(100).map(n => n.path));
    button(host, 'Previous page').dispatch('click', {});
    expect(status()).toBe('Page 1 of 2');
    expect([chart.drilled.id, chart.focused?.id]).toEqual([drilled, focused]);
  });

  it('a small tree has one page and no pager', () => {
    const { chart, host } = open(treemap, { data: { label: 'R', children: [{ label: 'a', value: 1 }] } });
    button(host, 'View as table').dispatch('click', {});
    expect(chart.table!.rowCount).toBe(2);
    expect(host.find(e => e.getAttribute('class') === 'axylo-h-pager')!.hidden).toBe(true);
  });
});

describe('the capability while a frame is drawn', () => {
  it('a value formatter that reads it during a redraw finds no plot and the table last shown', () => {
    const seen: { plot: unknown; table: unknown }[] = [];
    let probe: Seam | null = null;
    const format = (v: number) => { if (probe) seen.push({ plot: probe.plot, table: probe.table }); return String(v); };
    const { chart, seam } = open(treemap, { value: { format } });
    const before = seam.table;
    expect(before).not.toBeNull();
    probe = seam;
    chart.update({ data: { label: 'R2', children: [{ label: 'x', value: 2 }, { label: 'y', value: 3 }] } });
    probe = null;
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) {
      expect(s.plot).toBeNull();
      expect(s.table).toBe(before);
    }
    // Once drawn: the new table and the plot.
    expect(seam.table).toBe(chart.table);
    expect(seam.table).not.toBe(before);
    expect(seam.plot).not.toBeNull();
  });
});

export type { TreemapChart };
