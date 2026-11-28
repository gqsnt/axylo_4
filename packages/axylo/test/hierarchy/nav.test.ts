/**
 * Hierarchical keyboard movement (N9b brief): ArrowLeft / ArrowRight siblings, Home / End first and last
 * sibling, ArrowDown first child, ArrowUp / Escape parent, Enter / Space drill into a branch or select a leaf.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DiagnosticCollector } from '../../src/diagnostics/collector';
import { buildHierarchy, childAt, childCount, within, type HierarchyModel } from '../../src/hierarchy/tree';
import { activate, navigate, type HierarchyKey } from '../../src/hierarchy/nav';
import { arbTree } from './fixtures';

const model = (data: unknown): HierarchyModel => buildHierarchy(data, 'All', new DiagnosticCollector());
const FIXTURE = { label: 'R', children: [
  { label: 'A', children: [{ label: 'a1', value: 1 }, { label: 'a2', value: 2 }, { label: 'a3', value: 3 }] },
  { label: 'B', value: 4 },
  { label: 'C', children: [{ label: 'c1', value: 5 }] },
] };
// Pre-order: R0 A1 a1 2 a2 3 a3 4 B5 C6 c1 7
const KEYS: readonly HierarchyKey[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' ', 'Escape'];

describe('hierarchical keyboard movement', () => {
  const m = model(FIXTURE);
  const at = (focus: number, key: HierarchyKey, root = 0) => navigate(m, { root, focus }, key);

  it('siblings, ends, child and parent on the fixture', () => {
    expect(at(1, 'ArrowRight').focus).toBe(5);
    expect(at(5, 'ArrowRight').focus).toBe(6);
    expect(at(6, 'ArrowRight').focus).toBe(6);
    expect(at(1, 'ArrowLeft').focus).toBe(1);
    expect(at(3, 'Home').focus).toBe(2);
    expect(at(2, 'End').focus).toBe(4);
    expect(at(1, 'ArrowDown').focus).toBe(2);
    expect(at(5, 'ArrowDown').focus).toBe(5);
    expect(at(3, 'ArrowUp').focus).toBe(1);
    expect(at(3, 'Escape').focus).toBe(1);
    expect(at(0, 'ArrowUp')).toEqual({ root: 0, focus: 0, select: false });
  });

  it('Enter and Space drill into a branch and focus its first child; on a leaf they select', () => {
    expect(at(1, 'Enter')).toEqual({ root: 1, focus: 2, select: false });
    expect(at(6, ' ')).toEqual({ root: 6, focus: 7, select: false });
    expect(at(5, 'Enter')).toEqual({ root: 0, focus: 5, select: true });
  });

  it('up from the drilled root drills up and keeps focus on the node we came from', () => {
    expect(at(1, 'ArrowUp', 1)).toEqual({ root: 0, focus: 0, select: false });
    expect(at(2, 'ArrowUp', 1)).toEqual({ root: 1, focus: 1, select: false });
    // Siblings of the drilled root are outside the view: Left and Right stay.
    expect(at(1, 'ArrowRight', 1).focus).toBe(1);
  });

  it('treemap activation: a branch drills in, a leaf is selected where it is (never opening its parent)', () => {
    expect(activate(m, 'treemap', 0, 1)).toEqual({ root: 1, focus: 2, select: false });
    expect(activate(m, 'treemap', 0, 3)).toEqual({ root: 0, focus: 3, select: true });
    expect(activate(m, 'treemap', 0, 5)).toEqual({ root: 0, focus: 5, select: true });
    expect(activate(m, 'treemap', 1, 3)).toEqual({ root: 1, focus: 3, select: true });
    // The drilled root: one level up, focus on the node we came from; the top root does nothing.
    expect(activate(m, 'treemap', 1, 1)).toEqual({ root: 0, focus: 1, select: false });
    expect(activate(m, 'treemap', 0, 0)).toEqual({ root: 0, focus: 0, select: false });
  });

  it('sunburst activation: any arc, a leaf included, becomes the center; the center goes up', () => {
    expect(activate(m, 'sunburst', 0, 1)).toEqual({ root: 1, focus: 2, select: false });
    expect(activate(m, 'sunburst', 0, 3)).toEqual({ root: 3, focus: 3, select: false });
    expect(activate(m, 'sunburst', 0, 5)).toEqual({ root: 5, focus: 5, select: false });
    expect(activate(m, 'sunburst', 3, 3)).toEqual({ root: 1, focus: 3, select: false });
    expect(activate(m, 'sunburst', 0, 0)).toEqual({ root: 0, focus: 0, select: false });
    // The keyboard uses the same rule.
    expect(navigate(m, { root: 0, focus: 5 }, 'Enter', 'sunburst')).toEqual({ root: 5, focus: 5, select: false });
    expect(navigate(m, { root: 5, focus: 5 }, ' ', 'sunburst')).toEqual({ root: 0, focus: 5, select: false });
    expect(navigate(m, { root: 0, focus: 5 }, 'Enter', 'treemap')).toEqual({ root: 0, focus: 5, select: true });
    // A treemap's drilled root is the whole plot: Enter goes into it.
    expect(navigate(m, { root: 1, focus: 1 }, 'Enter', 'treemap')).toEqual({ root: 1, focus: 2, select: false });
  });

  it('for any tree and node, sunburst activation then activation of the new center returns to the same root', () => {
    fc.assert(fc.property(arbTree(4), fc.nat(), (tree, pick) => {
      const mm = model(tree);
      const n = 1 + (pick % Math.max(1, mm.count - 1));
      if (n >= mm.count) return;
      const p = mm.parent[n]!;
      const r = activate(mm, 'sunburst', p, n);
      expect(r.root).toBe(n);
      expect(within(mm, r.root, r.focus)).toBe(true);
      const back = activate(mm, 'sunburst', n, n);
      expect(back).toEqual({ root: p, focus: n, select: false });
      const t = activate(mm, 'treemap', p, n);
      if (childCount(mm, n) === 0) expect(t).toEqual({ root: p, focus: n, select: true });
      else expect(t.root).toBe(n);
    }), { numRuns: 200 });
  });

  it('for any tree, node and key: focus stays in the drilled subtree and the moves are consistent', () => {
    fc.assert(fc.property(arbTree(4), fc.nat(), fc.constantFrom(...KEYS), (tree, pick, key) => {
      const mm = model(tree);
      const focus = pick % mm.count;
      const root = mm.parent[focus]! >= 0 && pick % 2 ? mm.parent[focus]! : 0;
      if (!within(mm, root, focus)) return;
      const r = navigate(mm, { root, focus }, key);
      expect(within(mm, r.root, r.focus)).toBe(true);
      const p = mm.parent[focus]!;
      if (key === 'ArrowDown' && childCount(mm, focus) > 0) expect(mm.parent[r.focus]).toBe(focus);
      if ((key === 'ArrowUp' || key === 'Escape') && p >= 0) expect(r.focus).toBe(p);
      if ((key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Home' || key === 'End') && focus !== root) expect(mm.parent[r.focus]).toBe(p);
      if (key === 'Home' && focus !== root) expect(r.focus).toBe(childAt(mm, p, 0));
      if (key === 'End' && focus !== root) expect(r.focus).toBe(childAt(mm, p, childCount(mm, p) - 1));
      if (key === 'ArrowRight' && r.focus !== focus) expect(navigate(mm, r, 'ArrowLeft').focus).toBe(focus);
      if (key === 'ArrowDown' && r.focus !== focus) expect(navigate(mm, r, 'ArrowUp').focus).toBe(focus);
      if ((key === 'Enter' || key === ' ') && childCount(mm, focus) > 0) { expect(r.root).toBe(focus); expect(mm.parent[r.focus]).toBe(focus); }
      if ((key === 'Enter' || key === ' ') && childCount(mm, focus) === 0) expect(r.select).toBe(true);
    }), { numRuns: 400 });
  });
});
