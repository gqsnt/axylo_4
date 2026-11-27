/**
 * Treemap and sunburst geometry (N9b). Squarified tiles conserve every branch's inner area, never overlap and
 * stay inside their parent; sunburst arcs conserve the full turn and every parent's span, are proportional to
 * value, start at 12 o'clock and go clockwise, and rings grow with depth.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DiagnosticCollector } from '../../src/diagnostics/collector';
import { buildHierarchy, childAt, childCount, isPositive, shareOfParent, subtreeEnd, type HierarchyModel, type HierarchyNode } from '../../src/hierarchy/tree';
import { layoutTreemap, pickTreemap } from '../../src/hierarchy/treemap/layout';
import { inSector, layoutSunburst, pickSunburst, polar, sectorPath, TURN } from '../../src/hierarchy/sunburst/layout';
import { fitLabel } from '../../src/hierarchy/draw';
import { arbTree } from './fixtures';

const model = (data: unknown): HierarchyModel => buildHierarchy(data, 'All', new DiagnosticCollector());
const flatTree = (values: readonly number[]): HierarchyNode => ({ label: 'R', children: values.map((value, i) => ({ label: `c${i}`, value })) });
const OPTIONS = { header: 18, padding: 2 };

describe('squarified treemap', () => {
  it('follows Bruls et al.: areas 6,6,4,3,2,2,1 in a 6×4 rectangle start with a column of 6,6 then a row of 4,3', () => {
    const m = model(flatTree([6, 6, 4, 3, 2, 2, 1]));
    const g = layoutTreemap(m, 0, { x: 0, y: 0, width: 6, height: 4 }, OPTIONS);
    const box = (i: number) => [g.x[i]!, g.y[i]!, g.w[i]!, g.h[i]!].map(v => Math.round(v * 1e9) / 1e9);
    // Column of width 12 / 4 = 3: two tiles of height 2.
    expect(box(1)).toEqual([0, 0, 3, 2]);
    expect(box(2)).toEqual([0, 2, 3, 2]);
    // In the 3×4 rest the short side is the width: a row of 4 and 3, height 7 / 3.
    const t = 7 / 3;
    expect(box(3)).toEqual([3, 0, 4 / t, t].map(v => Math.round(v * 1e9) / 1e9));
    expect(box(4)).toEqual([3 + 4 / t, 0, 3 / t, t].map(v => Math.round(v * 1e9) / 1e9));
  });

  it('four equal values in a square make a 2×2 grid', () => {
    const m = model(flatTree([1, 1, 1, 1]));
    const g = layoutTreemap(m, 0, { x: 0, y: 0, width: 100, height: 100 }, OPTIONS);
    for (let i = 1; i <= 4; i++) { expect(g.w[i]).toBeCloseTo(50, 9); expect(g.h[i]).toBeCloseTo(50, 9); }
  });

  it('for any tree and plot: children conserve the parent inner area, never overlap and stay inside it', () => {
    fc.assert(fc.property(arbTree(4), fc.integer({ min: 40, max: 1200 }), fc.integer({ min: 40, max: 900 }), (tree, width, height) => {
      const m = model(tree);
      const g = layoutTreemap(m, 0, { x: 0, y: 0, width, height }, OPTIONS);
      expect(g.w[0]! * g.h[0]!).toBe(width * height);
      for (let p = 0; p < m.count; p++) {
        const k = childCount(m, p);
        if (!k) continue;
        const ix = g.inner[p * 4]!, iy = g.inner[p * 4 + 1]!, iw = g.inner[p * 4 + 2]!, ih = g.inner[p * 4 + 3]!;
        let area = 0;
        const tol = 1e-7 * Math.max(1, width * height);
        for (let c = 0; c < k; c++) {
          const i = childAt(m, p, c);
          area += g.w[i]! * g.h[i]!;
          // Inside the inner rectangle (float tolerance).
          expect(g.x[i]!).toBeGreaterThanOrEqual(ix - 1e-6);
          expect(g.y[i]!).toBeGreaterThanOrEqual(iy - 1e-6);
          expect(g.x[i]! + g.w[i]!).toBeLessThanOrEqual(ix + iw + 1e-6);
          expect(g.y[i]! + g.h[i]!).toBeLessThanOrEqual(iy + ih + 1e-6);
          // Proportional to weight.
          if (isPositive(m, p)) expect(Math.abs(g.w[i]! * g.h[i]! - shareOfParent(m, i)! * iw * ih)).toBeLessThan(tol + 1e-6 * iw * ih);
          for (let d = c + 1; d < k; d++) {
            const j = childAt(m, p, d);
            const ox = Math.min(g.x[i]! + g.w[i]!, g.x[j]! + g.w[j]!) - Math.max(g.x[i]!, g.x[j]!);
            const oy = Math.min(g.y[i]! + g.h[i]!, g.y[j]! + g.h[j]!) - Math.max(g.y[i]!, g.y[j]!);
            expect(ox <= 1e-6 || oy <= 1e-6).toBe(true);
          }
        }
        if (isPositive(m, p)) expect(Math.abs(area - iw * ih)).toBeLessThanOrEqual(tol);
        else expect(area).toBe(0);
      }
    }), { numRuns: 200 });
  });

  it('zero values get an empty tile, and the pick returns the deepest tile under the pointer', () => {
    const m = model({ label: 'R', children: [{ label: 'A', children: [{ label: 'a1', value: 1 }, { label: 'a2', value: 1 }] }, { label: 'Z', value: 0 }] });
    const g = layoutTreemap(m, 0, { x: 0, y: 0, width: 200, height: 100 }, OPTIONS);
    expect(g.w[4]! * g.h[4]!).toBe(0);
    // A fills the plot: header strip of 18 px, children below it.
    expect(g.header[1]).toBe(18);
    expect(pickTreemap(m, g, 5, 5)).toBe(1);
    expect(pickTreemap(m, g, 50, 60)).toBe(2);
    expect(pickTreemap(m, g, 150, 60)).toBe(3);
    expect(pickTreemap(m, g, 250, 60)).toBe(-1);
  });

  it('drilled: the subtree fills the plot and nodes outside it are not laid out', () => {
    const m = model({ label: 'R', children: [{ label: 'A', children: [{ label: 'a1', value: 1 }, { label: 'a2', value: 3 }] }, { label: 'B', value: 4 }] });
    const g = layoutTreemap(m, 1, { x: 0, y: 0, width: 100, height: 100 }, OPTIONS);
    expect(g.w[2]! * g.h[2]! + g.w[3]! * g.h[3]!).toBeCloseTo(10000, 9);
    expect(g.w[3]! * g.h[3]!).toBeCloseTo(7500, 9);
    expect(Number.isNaN(g.x[4]!)).toBe(true);
  });

  it('tiny positive values next to large ones still get a positive area', () => {
    const m = model(flatTree([1e-9, 1]));
    const g = layoutTreemap(m, 0, { x: 0, y: 0, width: 100, height: 100 }, OPTIONS);
    expect(g.w[1]! * g.h[1]!).toBeGreaterThan(0);
    expect(g.w[1]! * g.h[1]! + g.w[2]! * g.h[2]!).toBeCloseTo(10000, 9);
  });

  it('a share below double resolution of the plot (1e-300 of it) has no representable area, yet a laid-out tile at the edge, with the total conserved', () => {
    const m = model(flatTree([1e-300, 1]));
    const g = layoutTreemap(m, 0, { x: 0, y: 0, width: 100, height: 100 }, OPTIONS);
    expect(Number.isNaN(g.x[1]!)).toBe(false);
    expect(g.w[1]! * g.h[1]!).toBeLessThan(1e-12);
    expect(g.w[1]! * g.h[1]! + g.w[2]! * g.h[2]!).toBeCloseTo(10000, 9);
  });

  it('overflowing totals still split by exact proportion', () => {
    const m = model(flatTree([Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE]));
    const g = layoutTreemap(m, 0, { x: 0, y: 0, width: 100, height: 100 }, OPTIONS);
    for (let i = 1; i <= 4; i++) expect(g.w[i]! * g.h[i]!).toBeCloseTo(2500, 9);
  });
});

describe('sunburst partition', () => {
  it('clockwise from 12 o\'clock: the first child starts at the top and a quarter ends at 3 o\'clock', () => {
    const m = model(flatTree([1, 3]));
    const g = layoutSunburst(m, 0, 100, 100, 90);
    expect(g.a0[1]).toBe(0);
    expect(g.a1[1]).toBeCloseTo(Math.PI / 2, 12);
    expect(g.a1[2]).toBe(TURN);
    const [tx, ty] = polar(100, 100, 0, 50);
    expect([tx, ty]).toEqual([100, 50]);
    const [rx, ry] = polar(100, 100, Math.PI / 2, 50);
    expect(rx).toBeCloseTo(150, 9); expect(ry).toBeCloseTo(100, 9);
    // Up and right of the center is the first child (top right quadrant); left is the second.
    expect(pickSunburst(m, g, 130, 60)).toBe(1);
    expect(pickSunburst(m, g, 50, 100)).toBe(2);
    expect(pickSunburst(m, g, 100, 100)).toBe(0);
    expect(pickSunburst(m, g, 100, 5)).toBe(-1);
    expect(sectorPath(100, 100, 45, 90, 0, Math.PI / 2).startsWith('M100,10A90,90 0 0 1 190,100')).toBe(true);
  });

  it('for any tree: the root\'s children cover exactly 2π, every parent\'s span is conserved and split by value', () => {
    fc.assert(fc.property(arbTree(4), tree => {
      const m = model(tree);
      const g = layoutSunburst(m, 0, 0, 0, 300);
      for (let p = 0; p < m.count; p++) {
        const k = childCount(m, p);
        if (!k || !isPositive(m, p)) continue;
        let span = 0;
        for (let c = 0; c < k; c++) {
          const i = childAt(m, p, c);
          const s = g.a1[i]! - g.a0[i]!;
          span += s;
          expect(s).toBeGreaterThanOrEqual(0);
          expect(Math.abs(s - shareOfParent(m, i)! * (g.a1[p]! - g.a0[p]!))).toBeLessThan(1e-9);
          // Contiguous and inside the parent.
          if (c > 0) expect(g.a0[i]).toBeCloseTo(g.a1[childAt(m, p, c - 1)]!, 12);
        }
        expect(Math.abs(span - (g.a1[p]! - g.a0[p]!))).toBeLessThan(1e-9);
        if (p === 0) expect(Math.abs(span - TURN)).toBeLessThan(1e-12);
        // The last arc with something to show ends exactly where its parent ends.
        let last = -1;
        for (let c = 0; c < k; c++) if (isPositive(m, childAt(m, p, c))) last = childAt(m, p, c);
        expect(g.a1[last]).toBe(g.a1[p]);
      }
    }), { numRuns: 200 });
  });

  it('for any tree: rings are monotone in depth and each child ring starts where its parent ring ends', () => {
    fc.assert(fc.property(arbTree(5), fc.integer({ min: 20, max: 500 }), (tree, radius) => {
      const m = model(tree);
      const g = layoutSunburst(m, 0, 0, 0, radius);
      expect(g.r0[0]).toBe(0);
      for (let i = 1; i < m.count; i++) {
        const p = m.parent[i]!;
        expect(g.r0[i]).toBeCloseTo(g.r1[p]!, 9);
        expect(g.r1[i]!).toBeGreaterThan(g.r0[i]!);
        expect(g.r1[i]!).toBeLessThanOrEqual(radius + 1e-9);
      }
    }), { numRuns: 150 });
  });

  it('drilled: the node becomes the center disc with the full turn; outside nodes are not laid out', () => {
    const m = model({ label: 'R', children: [{ label: 'A', children: [{ label: 'a1', value: 1 }, { label: 'a2', value: 3 }] }, { label: 'B', value: 4 }] });
    const g = layoutSunburst(m, 1, 0, 0, 100);
    expect([g.a0[1], g.a1[1], g.r0[1], g.r1[1]]).toEqual([0, TURN, 0, 50]);
    expect(g.a1[2]).toBeCloseTo(TURN / 4, 12);
    expect(Number.isNaN(g.a0[4]!)).toBe(true);
    expect(subtreeEnd(m, 1)).toBe(4);
  });

  it('inSector agrees with the 12 o\'clock clockwise angle', () => {
    expect(inSector(0, 0, 10, 20, 0, Math.PI / 2, 10, -10)).toBe(true);
    expect(inSector(0, 0, 10, 20, 0, Math.PI / 2, -10, -10)).toBe(false);
    expect(inSector(0, 0, 10, 20, 0, TURN, -10, 10)).toBe(true);
  });
});

describe('label fitting', () => {
  const measure = (t: string) => t.length * 7;
  it('keeps a label that fits, cuts one that does not with an ellipsis, and omits it when nothing fits', () => {
    expect(fitLabel('Alpha', measure, w => w <= 40)).toBe('Alpha');
    expect(fitLabel('Alphabetical', measure, w => w <= 40)).toBe('Alph…');
    expect(fitLabel('Alphabetical', measure, w => w <= 10)).toBeNull();
    expect(fitLabel('', measure, () => true)).toBeNull();
  });
  it('for any label and width the result fits, or is null', () => {
    fc.assert(fc.property(fc.string({ maxLength: 40 }), fc.integer({ min: 0, max: 300 }), (text, width) => {
      const out = fitLabel(text, measure, w => w <= width);
      if (out !== null) expect(measure(out)).toBeLessThanOrEqual(width);
    }));
  });
});

describe('disparate magnitudes (review finding 3)', () => {
  // R0 big1 (1e200) small2 { s1 3 (1e-200), s2 4 (2e-200) }.
  const m = model({ label: 'R', children: [
    { label: 'big', value: 1e200 },
    { label: 'small', children: [{ label: 's1', value: 1e-200 }, { label: 's2', value: 2e-200 }] },
  ] });

  it('treemap drilled into the tiny branch: its children split the whole plot 1 : 2', () => {
    const g = layoutTreemap(m, 2, { x: 0, y: 0, width: 300, height: 200 }, OPTIONS);
    const a3 = g.w[3]! * g.h[3]!, a4 = g.w[4]! * g.h[4]!;
    expect(a3).toBeCloseTo(20000, 6);
    expect(a4).toBeCloseTo(40000, 6);
    expect(a3 + a4).toBeCloseTo(60000, 6);
    // At the root, the tiny branch is below double resolution of the plot and 1e200 takes it all.
    const top = layoutTreemap(m, 0, { x: 0, y: 0, width: 300, height: 200 }, OPTIONS);
    expect(top.w[1]! * top.h[1]!).toBeCloseTo(60000, 6);
  });

  it('sunburst drilled into the tiny branch: its children cover the full turn, one third and two thirds', () => {
    const g = layoutSunburst(m, 2, 0, 0, 100);
    expect(g.a1[3]! - g.a0[3]!).toBeCloseTo(TURN / 3, 12);
    expect(g.a1[4]! - g.a0[4]!).toBeCloseTo((2 * TURN) / 3, 12);
    expect(g.a0[3]).toBe(0);
    expect(g.a1[4]).toBe(TURN);
    // The picker follows child links from the drilled root: the second child is to the left of the center.
    expect(pickSunburst(m, g, -75, 0)).toBe(4);
    expect(pickSunburst(m, g, 40, -60)).toBe(3);
  });
});
