/**
 * Repair round 4: drill and focus survive an update only when the same kind of identity still holds the id.
 * The top-level view stays the top-level view even when an explicit child takes its old id; an explicit id
 * that disappears is not inherited by a generated node of the same name; a generated path is not inherited by
 * a descendant of a different owner. Public ids and `drill(id)` lookup are unchanged.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { sunburst, treemap, type HierarchyOptions, type SunburstChart, type TreemapChart } from '../../src/hierarchy';
import { DiagnosticCollector } from '../../src/diagnostics/collector';
import {
  buildHierarchy, restoreIndex, ID_EXPLICIT, ID_FLAT, ID_GENERATED, ID_REPEATED, ID_SYNTHETIC, type HierarchyModel,
} from '../../src/hierarchy/tree';
import { fakeTarget } from './fake-dom';

const KINDS = [['treemap', treemap], ['sunburst', sunburst]] as const;
type Kind = typeof treemap | typeof sunburst;
type Chart = TreemapChart & SunburstChart;
const model = (data: unknown): HierarchyModel => buildHierarchy(data, 'All', new DiagnosticCollector());

function open(kind: Kind, data: unknown) {
  const { target, host } = fakeTarget();
  const chart = kind(target, { title: 'T', data } as HierarchyOptions) as Chart;
  const plot = host.find(e => e.attributes.get('class') === 'axylo-h-plot')!;
  const drills: string[] = [];
  chart.on('drill', p => { drills.push(p.id); });
  return { chart, plot, drills };
}

describe('identity kinds in the model', () => {
  it('records who owns each id', () => {
    const m = model({ label: 'R', children: [
      { id: 'one', label: 'One', value: 1 },
      { id: 'twice', label: 'A', value: 1 },
      { id: 'twice', label: 'B', value: 1 },
      { label: 'anon', value: 1 },
    ] });
    expect(m.ids).toEqual(['R', 'one', 'R/twice', 'R/twice#2', 'R/anon']);
    expect([...m.idKind]).toEqual([ID_GENERATED, ID_EXPLICIT, ID_REPEATED, ID_REPEATED, ID_GENERATED]);
    expect([...model([{ label: 'a', value: 1 }, { label: 'b', value: 1 }]).idKind]).toEqual([ID_SYNTHETIC, ID_GENERATED, ID_GENERATED]);
    const flat = model([{ id: 'a', parent: null, value: 1 }, { id: 'b', parent: null, value: 2 }]);
    expect([...flat.idKind]).toEqual([ID_SYNTHETIC, ID_FLAT, ID_FLAT]);
  });

  it('flat ids are restored across reparenting; old node 0 always maps to new node 0', () => {
    const a = model([{ id: 'r', parent: null }, { id: 'p', parent: 'r' }, { id: 'q', parent: 'r' }, { id: 'b', parent: 'p', value: 1 }, { id: 'c', parent: 'q', value: 1 }]);
    const b = model([{ id: 'r', parent: null }, { id: 'p', parent: 'r' }, { id: 'q', parent: 'r' }, { id: 'b', parent: 'q', value: 1 }, { id: 'c', parent: 'p', value: 1 }]);
    const at = (m: HierarchyModel, id: string) => m.ids.indexOf(id);
    expect(restoreIndex(a, at(a, 'b'), b)).toBe(at(b, 'b'));
    expect(restoreIndex(a, 0, b)).toBe(0);
    expect(restoreIndex(a, at(a, 'c'), model([{ id: 'r', parent: null, value: 1 }]))).toBe(-1);
  });

  it('for any tree, every node restores to itself in a rebuild of the same data', () => {
    const leaf = fc.record({ label: fc.constantFrom('a', 'b', 'x'), value: fc.nat(5) });
    const node = fc.letrec<{ n: unknown }>(tie => ({
      n: fc.oneof({ depthSize: 'small', withCrossShrink: true },
        leaf,
        fc.record({ id: fc.option(fc.constantFrom('a', 'b', 'k'), { nil: undefined }), label: fc.constantFrom('a', 'b', 'x'), children: fc.array(tie('n'), { maxLength: 3 }) })),
    })).n;
    fc.assert(fc.property(fc.oneof(node, fc.array(node, { maxLength: 3 })), data => {
      const a = model(data), b = model(data);
      for (let i = 0; i < a.count; i++) expect(restoreIndex(a, i, b)).toBe(i);
    }), { numRuns: 300 });
  });
});

describe.each(KINDS)('%s: drill and focus restoration follows identity ownership', (_n, kind) => {
  it('an anonymous root keeps the top-level view when an explicit child takes its old id', () => {
    const before = { label: 'Sales', children: [{ label: 'East', children: [{ label: 'e1', value: 1 }] }, { label: 'West', value: 2 }] };
    const o = open(kind, before);
    expect(o.chart.drill(null)).toBe(true);
    expect([o.chart.drilled.id, o.chart.focused?.id]).toEqual(['Sales', 'Sales/East']);
    o.drills.length = 0;
    o.chart.update({ data: { label: 'Sales', children: [
      { id: 'Sales', label: 'Wholesale sales', children: [{ label: 'East', children: [{ label: 'e1', value: 1 }] }] },
      { label: 'West', value: 2 },
    ] } });
    // The explicit child now owns 'Sales' and its anonymous child owns 'Sales/East': neither is the old node.
    expect(o.chart.drilled.depth).toBe(0);
    expect(o.chart.drilled.label).toBe('Sales');
    expect(o.chart.drilled.id).toBe('Sales#2');
    expect(o.chart.focused?.id).toBe('Sales#2');
    expect(o.chart.breadcrumb.map(c => c.label)).toEqual(['Sales']);
    expect(o.drills).toEqual([]);
    // Public lookup reaches the explicit child by its id.
    expect(o.chart.drill('Sales')).toBe(true);
    expect(o.chart.drilled.label).toBe('Wholesale sales');
  });

  it('a removed explicit branch is not inherited by an anonymous branch with the same name', () => {
    const o = open(kind, [
      { id: 'Sales', label: 'Sales', children: [{ label: 'x', value: 1 }, { label: 'y', value: 2 }] },
      { label: 'Other', value: 3 },
    ]);
    expect(o.chart.drill('Sales')).toBe(true);
    expect([o.chart.drilled.id, o.chart.focused?.id]).toEqual(['Sales', 'Sales/x']);
    o.chart.update({ data: [{ label: 'Sales', children: [{ label: 'x', value: 5 }, { label: 'y', value: 1 }] }, { label: 'Other', value: 3 }] });
    expect(o.chart.drilled.depth).toBe(0);
    expect(o.chart.drilled.id).toBe('');
    expect(o.chart.focused?.id).toBe('');
    // The anonymous branch has the old public id and is reachable through it.
    expect(o.chart.drill('Sales')).toBe(true);
    expect(o.chart.drilled.value).toBe(6);
  });

  it('a generated path under an anonymous root is not inherited under an explicit node of that name', () => {
    const o = open(kind, { label: 'R', children: [{ label: 'A', children: [{ label: 'a1', value: 1 }, { label: 'a2', value: 2 }] }, { label: 'Z', value: 1 }] });
    expect(o.chart.drill('R/A')).toBe(true);
    expect(o.chart.focused?.id).toBe('R/A/a1');
    o.chart.update({ data: [{ id: 'R', label: 'Other', children: [{ label: 'A', children: [{ label: 'a1', value: 1 }, { label: 'a2', value: 2 }] }] }, { label: 'Z', value: 1 }] });
    expect(o.chart.drilled.depth).toBe(0);
    expect(o.chart.focused?.id).toBe('');
    expect(o.chart.drill('R/A')).toBe(true);
    expect(o.chart.drilled.path).toEqual(['T', 'Other', 'A']);
  });

  it('a generated path is not inherited when its generated ancestor becomes a repeated explicit id', () => {
    const o = open(kind, { label: 'R', children: [{ label: 'ops', children: [{ label: 'k', value: 1 }, { label: 'm', value: 1 }] }, { label: 'Z', value: 1 }] });
    expect(o.chart.drill('R/ops')).toBe(true);
    expect(o.chart.focused?.id).toBe('R/ops/k');
    o.chart.update({ data: { label: 'R', children: [
      { id: 'ops', label: 'Ops one', children: [{ label: 'k', value: 1 }, { label: 'm', value: 1 }] },
      { id: 'ops', label: 'Ops two', value: 1 },
      { label: 'Z', value: 1 },
    ] } });
    expect(o.chart.drilled.id).toBe('R');
    expect(o.chart.focused?.id).toBe('R');
  });

  it('focus alone falls back when its old generated path gets a different owner, while a stable drill stays', () => {
    const o = open(kind, { label: 'R', children: [{ id: 'keep', label: 'Keep', children: [{ label: 'q', value: 1 }] }, { label: 'B', children: [{ label: 'b1', value: 1 }, { label: 'b2', value: 1 }] }] });
    o.plot.focus();
    expect(o.chart.drill(null)).toBe(true);
    o.plot.dispatch('keydown', { key: 'ArrowRight' });
    o.plot.dispatch('keydown', { key: 'ArrowDown' });
    expect(o.chart.focused?.id).toBe('R/B/b1');
    // 'B' becomes a repeated explicit id; its first occurrence takes the path 'R/B' and its child 'R/B/b1'.
    o.chart.update({ data: { label: 'R', children: [
      { id: 'keep', label: 'Keep', children: [{ label: 'q', value: 1 }] },
      { id: 'B', label: 'B1', children: [{ label: 'b1', value: 1 }, { label: 'b2', value: 1 }] },
      { id: 'B', label: 'B2', value: 1 },
    ] } });
    expect(o.chart.drilled.id).toBe('R');
    expect(o.chart.focused?.id).toBe('R');
    // The same shape with unchanged ownership keeps the focus.
    o.plot.dispatch('keydown', { key: 'ArrowDown' });
    o.plot.dispatch('keydown', { key: 'ArrowRight' });
    o.plot.dispatch('keydown', { key: 'ArrowDown' });
    const focused = o.chart.focused?.id;
    expect(focused).toBe('R/B/b1');
    o.chart.update({ data: { label: 'R', children: [
      { id: 'keep', label: 'Keep', children: [{ label: 'q', value: 2 }] },
      { id: 'B', label: 'B1', children: [{ label: 'b1', value: 3 }, { label: 'b2', value: 1 }] },
      { id: 'B', label: 'B2', value: 1 },
    ] } });
    expect(o.chart.focused?.id).toBe(focused);
    expect(o.chart.focused?.value).toBe(3);
  });

  it('a unique explicit drill survives its anonymous ancestors being reordered', () => {
    const tree = (flip: boolean) => {
      const a = { label: 'W', children: [{ id: 'deep', label: 'Deep', children: [{ label: 'd', value: 1 }, { label: 'e', value: 1 }] }] };
      const b = { label: 'W', children: [{ label: 'n', value: 4 }] };
      return { label: 'R', children: flip ? [b, a] : [a, b] };
    };
    const o = open(kind, tree(false));
    expect(o.chart.drill('deep')).toBe(true);
    o.chart.update({ data: tree(true) });
    expect([o.chart.drilled.id, o.chart.focused?.id]).toEqual(['deep', 'deep/d']);
  });
});
