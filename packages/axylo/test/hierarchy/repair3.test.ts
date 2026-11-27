/**
 * Repair round 3: (1) a presentation finding (AX160) found again by every repaint is handed to the same
 * handler with the same format once, so a handler that updates on each delivery lets `update` return;
 * (2) an explicit nested id used once in the tree is the node's public id on its own, so drill, focus and
 * lookup survive reordering of label-only ancestors, generated suffixes and colliding insertions.
 */
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { sunburst, treemap, type HierarchyOptions, type SunburstChart, type TreemapChart } from '../../src/hierarchy';
import { DiagnosticCollector } from '../../src/diagnostics/collector';
import { buildHierarchy, type HierarchyModel, type HierarchyNode } from '../../src/hierarchy/tree';
import { fakeTarget, type FakeElement } from './fake-dom';
import type { Diagnostic } from '../../src/public';

const TWO = { label: 'R', children: [
  { label: 'A', children: [{ label: 'a1', value: 30 }, { label: 'a2', value: 10 }] },
  { label: 'B', children: [{ label: 'b1', value: 6 }, { label: 'b2', value: 5 }] },
] };
const KINDS = [['treemap', treemap], ['sunburst', sunburst]] as const;
type Kind = typeof treemap | typeof sunburst;
type Chart = TreemapChart & SunburstChart;
const FALLBACK = 'Values use the default number format: the value format failed.';

function open(kind: Kind, options: Partial<HierarchyOptions> = {}) {
  const { target, host } = fakeTarget();
  const chart = kind(target, { title: 'T0', data: TWO, ...options } as HierarchyOptions) as Chart;
  const plot = host.find(e => e.attributes.get('class') === 'axylo-h-plot')!;
  const note = host.find(e => e.attributes.get('class') === 'axylo-h-note')!;
  const heading = () => host.find(e => e.tagName === 'H3');
  return { host, chart, plot, note, heading };
}
const key = (plot: FakeElement, k: string) => plot.dispatch('keydown', { key: k });
const thrower = () => (): string => { throw new Error('format failed'); };
const quiet = () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  return () => { warn.mockRestore(); error.mockRestore(); };
};

describe('1. a persistent AX160 with a handler that updates on each delivery', () => {
  // Without carry-forward each callback's update repaints, finds AX160 again and calls back: the sentinel
  // stops retitling after LIMIT callbacks so a regression shows as LIMIT calls instead of a hang.
  const LIMIT = 8;

  it.each(KINDS)('%s: one callback, update returns, and the current revision still reports and discloses AX160', (_n, kind) => {
    const restore = quiet();
    try {
      let calls = 0;
      let chart: Chart | null = null;
      const onDiagnostic = (d: Diagnostic): void => {
        if (d.code !== 'AX160') return;
        calls++;
        if (calls > LIMIT) return;
        chart!.update({ title: `T${calls}` });
      };
      const o = open(kind, { onDiagnostic });
      chart = o.chart;
      expect(calls).toBe(0);
      let returned = false;
      const format = thrower();
      o.chart.update({ value: { format } });
      returned = true;
      expect(returned).toBe(true);
      expect(calls).toBe(1);
      // The handler's retitle committed: the new revision found AX160 again on its own.
      expect(o.heading()?.textContent).toBe('T1');
      expect(o.chart.diagnostics.map(d => d.code)).toEqual(['AX160']);
      expect(o.chart.diagnostics[0]!.chart).toBe('T1');
      expect(o.note.hidden).toBe(false);
      expect(o.note.textContent).toBe(FALLBACK);
      // More updates with the same handler and the same format (even in a new `value` object) hand nothing again.
      o.chart.update({ data: { label: 'R', children: [{ label: 'x', value: 4 }] } });
      o.chart.update({ value: { format } });
      expect(calls).toBe(1);
      expect(o.chart.diagnostics.map(d => d.code)).toEqual(['AX160']);
      expect(o.note.textContent).toBe(FALLBACK);
      // A strict call rejected for its own finding hands that finding, not AX160 again.
      const strictSeen: string[] = [];
      const strictHandler = (d: Diagnostic): void => { strictSeen.push(d.code); onDiagnostic(d); };
      expect(() => o.chart.update({ strict: true, onDiagnostic: strictHandler, data: { label: 'R', children: [{ label: 'x', value: -1 }] } })).toThrow();
      expect(strictSeen.filter(c => c === 'AX160')).toEqual([]);
      expect(o.chart.diagnostics.map(d => d.code)).toEqual(['AX160']);
      expect(calls).toBe(1);
    } finally { restore(); }
  });

  it.each(KINDS)('%s: a replacement handler with the unchanged format is handed AX160 once; the old one never again', (_n, kind) => {
    const restore = quiet();
    try {
      const first: string[] = [];
      const second: string[] = [];
      const format = thrower();
      const o = open(kind, { onDiagnostic: d => first.push(d.code), value: { format } });
      expect(first).toEqual(['AX160']);
      o.chart.update({ onDiagnostic: d => second.push(d.code) });
      expect(second).toEqual(['AX160']);
      o.chart.update({ title: 'Other' });
      expect(first).toEqual(['AX160']);
      expect(second).toEqual(['AX160']);
      expect(o.chart.diagnostics.map(d => d.code)).toEqual(['AX160']);
    } finally { restore(); }
  });

  it.each(KINDS)('%s: a changed throwing format with the same handler is handed AX160 again, once', (_n, kind) => {
    const restore = quiet();
    try {
      const seen: string[] = [];
      const o = open(kind, { onDiagnostic: d => seen.push(d.code), value: { format: thrower() } });
      expect(seen).toEqual(['AX160']);
      o.chart.update({ value: { format: thrower() } });
      expect(seen).toEqual(['AX160', 'AX160']);
      o.chart.update({ title: 'Again' });
      expect(seen).toEqual(['AX160', 'AX160']);
      // A working format clears the finding; a throwing one afterwards is a new format, handed again.
      o.chart.update({ value: { format: (v: number) => String(v) } });
      expect(o.chart.diagnostics).toEqual([]);
      expect(o.note.hidden).toBe(true);
      o.chart.update({ value: { format: thrower() } });
      expect(seen).toEqual(['AX160', 'AX160', 'AX160']);
    } finally { restore(); }
  });

  it.each(KINDS)('%s: the same format and handler back after a working format are handed AX160 again (no stale carry)', (_n, kind) => {
    const restore = quiet();
    try {
      const seen: string[] = [];
      const format = thrower();
      const o = open(kind, { onDiagnostic: d => seen.push(d.code), value: { format } });
      o.chart.update({ value: { format: (v: number) => String(v) } });
      o.chart.update({ value: { format } });
      expect(seen).toEqual(['AX160', 'AX160']);
    } finally { restore(); }
  });
});

describe('2. explicit nested ids are stable public identities', () => {
  const model = (data: unknown): HierarchyModel => buildHierarchy(data, 'All', new DiagnosticCollector());
  const ops = { id: 'ops', label: 'Operations', children: [{ label: 'x', value: 2 }, { label: 'y', value: 3 }] };
  const sales = { id: 'sales', label: 'Sales', children: [{ label: 's1', value: 4 }] };
  const tree = (first: HierarchyNode, second: HierarchyNode, extra: readonly HierarchyNode[] = []): HierarchyNode =>
    ({ label: 'R', children: [...extra, { label: 'Region', children: [first] }, { label: 'Region', children: [second] }] });

  it('ids under two anonymous "Region" siblings do not depend on their order or on inserted collisions', () => {
    const a = model(tree(ops, sales));
    const b = model(tree(sales, ops));
    const c = model(tree(sales, ops, [{ label: 'Region', children: [{ label: 'ops', value: 1 }] }, { label: 'ops', value: 1 }]));
    for (const m of [a, b, c]) {
      const id = (label: string) => m.ids[m.labels.indexOf(label)];
      expect([id('Operations'), id('x'), id('y'), id('Sales'), id('s1')]).toEqual(['ops', 'ops/x', 'ops/y', 'sales', 'sales/s1']);
      expect(new Set(m.ids).size).toBe(m.count);
    }
    // The anonymous wrappers keep positional, numbered paths.
    expect(a.ids.slice(0, 2)).toEqual(['R', 'R/Region']);
    expect(c.ids.filter(s => s.startsWith('R/Region'))).toEqual(['R/Region', 'R/Region/ops', 'R/Region#2', 'R/Region#3']);
    expect(c.ids[c.labels.lastIndexOf('ops')]).toBe('R/ops');
  });

  it('a generated id that would equal an explicit one is numbered; the explicit one never moves', () => {
    const m = model([{ label: 'ops', value: 1 }, { label: 'Region', children: [ops] }]);
    expect(m.ids).toEqual(['', 'ops#2', 'Region', 'ops', 'ops/x', 'ops/y']);
    // Explicit ids with separators are escaped, so they never read as a path.
    const s = model({ label: 'R', children: [{ id: 'a/b', label: 'AB', value: 1 }, { label: 'a', children: [{ label: 'b', value: 1 }] }] });
    expect(s.ids).toEqual(['R', 'a\\/b', 'R/a', 'R/a/b']);
  });

  it('a repeated explicit id is ambiguous: every occurrence gets a path, numbered among siblings, explicit ones first', () => {
    const m = model({ label: 'R', children: [
      { label: 'Region', children: [{ label: 'ops', value: 1 }, { id: 'ops', label: 'One', value: 1 }] },
      { label: 'Region', children: [{ id: 'ops', label: 'Two', value: 1 }] },
    ] });
    expect(m.ids).toEqual(['R', 'R/Region', 'R/Region/ops#2', 'R/Region/ops', 'R/Region#2', 'R/Region#2/ops']);
  });

  it('for any order of label-only wrappers and any colliding labels, each once-used explicit id and its subtree keep their ids', () => {
    const explicitCount = fc.integer({ min: 1, max: 4 });
    fc.assert(fc.property(explicitCount, fc.array(fc.nat(), { minLength: 12, maxLength: 12 }), fc.array(fc.constantFrom('e0', 'e1', 'Region', 'e0/c0'), { maxLength: 4 }), (n, order, noise) => {
      const subtrees = Array.from({ length: n }, (_, k) => ({ id: `e${k}`, label: `E${k}`, children: [{ label: `c${k}`, value: k + 1 }, { label: 'Region', value: 1 }] }));
      const wrappers: unknown[] = subtrees.map(s => ({ label: 'Region', children: [s] }));
      for (const label of noise) wrappers.push({ label, value: 1 }, { label: 'Region', children: [{ label, value: 1 }] });
      const shuffled = wrappers.map((w, k) => [order[k % order.length]! + k * 0.001, w] as const).sort((x, y) => x[0] - y[0]).map(x => x[1]);
      for (const children of [wrappers, shuffled]) for (const data of [{ label: 'R', children }, children]) {
        const m = model(data);
        expect(new Set(m.ids).size).toBe(m.count);
        for (let k = 0; k < n; k++) {
          const at = m.labels.indexOf(`E${k}`);
          expect(m.ids[at]).toBe(`e${k}`);
          expect(m.ids[at + 1]).toBe(`e${k}/c${k}`);
          expect(m.ids[at + 2]).toBe(`e${k}/Region`);
        }
      }
    }), { numRuns: 300 });
  });

  it('flat row ids are the rows\' ids, untouched', () => {
    const m = model([{ id: 'r', parent: null, label: 'R' }, { id: 'a/b', parent: 'r', value: 1 }, { id: 'r/x', parent: 'r', value: 2 }]);
    expect(m.ids).toEqual(['r', 'a/b', 'r/x']);
  });

  it.each(KINDS)('%s: drilled into "ops" under swapped anonymous Regions: drilled root, focus and lookup by the pre-update id survive', (_n, kind) => {
    const o = open(kind, { data: tree(ops, sales) });
    expect(o.chart.drill('ops')).toBe(true);
    expect(o.chart.drilled.id).toBe('ops');
    expect(o.chart.drilled.value).toBe(5);
    o.plot.focus();
    key(o.plot, 'ArrowRight');
    expect(o.chart.focused?.id).toBe('ops/y');
    const drilledBefore = o.chart.drilled.id, focusedBefore = o.chart.focused!.id;
    o.chart.update({ data: tree(sales, ops) });
    expect(o.chart.drilled.id).toBe(drilledBefore);
    expect(o.chart.drilled.label).toBe('Operations');
    expect(o.chart.drilled.value).toBe(5);
    expect(o.chart.drilled.path).toEqual(['R', 'Region', 'Operations']);
    expect(o.chart.focused?.id).toBe(focusedBefore);
    expect(o.chart.focused?.value).toBe(3);
    // A colliding insert ahead of both.
    o.chart.update({ data: tree(sales, ops, [{ label: 'Region', children: [{ label: 'ops', value: 9 }] }]) });
    expect([o.chart.drilled.id, o.chart.focused?.id]).toEqual(['ops', 'ops/y']);
    expect(o.chart.drill(null)).toBe(true);
    expect(o.chart.drill(drilledBefore)).toBe(true);
    expect(o.chart.drilled.label).toBe('Operations');
    expect(o.chart.drill('sales')).toBe(true);
    expect(o.chart.drilled.label).toBe('Sales');
  });
});
