/**
 * N8b review repairs: coincident boundaries, open contours, sub-lattice radii, duplicate collapse, nearest-edge
 * ties, keyboard over clipped centres, the drawn export snapshot, and AX160 for the size format.
 *
 * Expected values come from the painter's rule (oracle.ts: the topmost shape containing a point owns it), the
 * stated pick rule (latest row within half a device pixel of the true nearest edge), and the fixture data.
 */
import { describe, expect, it } from 'vitest';
import { controllerFor, type Controller } from '../../../src/core/controller';
import type { Committed } from '../../../src/dom/interaction';
import type { ScatterView } from '../../../src/core/contracts';
import { paintedMap } from '../../../src/spatial/bubble/paint';
import { pickGrid, type BubbleMark } from '../../../src/spatial/bubble/composition';
import { bubbleInternals, openBubbleChart } from '../../../src/spatial/bubble';
import { checkPicture, expectedOwner, flatten, geometryOf, winding } from './oracle';
import { record, type Recording } from '../../finance/host';

function open(options: Record<string, unknown>) {
  const rec = record({ width: 720, height: 420 });
  let controller: Controller | null = null;
  const chart = openBubbleChart({ title: 'Bubbles', ...options }, (composition, input) => {
    controller = controllerFor(composition, input, rec.host, null);
    return controller.handle;
  });
  rec.frames();
  return { rec, chart };
}
const last = (rec: Recording): Committed => rec.committed!;
const firstKey = (rec: Recording): string => (last(rec).view as ScatterView).frame.series[0]!.key;

describe('painted picture at coincident boundaries', () => {
  it('concentric disc, small disc and zero ring of three series: the hole of the ring shows the small disc\'s gap, not the large disc', () => {
    const discs = [
      { x: 100, y: 100, r: 10, series: 0, row: 0 },
      { x: 100, y: 100, r: 0.5, series: 1, row: 1 },
      { x: 100, y: 100, r: 0, series: 2, row: 2 },
    ];
    const g = geometryOf(discs);
    const map = paintedMap(g, 3);
    // (101, 100) is 1 px from the centre: inside the zero ring's hole (radius < 1.5), in the 0.5 disc's gap band
    // (0.5 to 1.5), which paints nothing; the large disc beneath is hidden by that gap.
    expect(expectedOwner(discs, g, 101, 100, 0.05)).toBe(-1);
    expect(map.series.map(s => winding(flatten(s.d), 101, 100))).toEqual([0, 0, 0]);
    expect(map.series.map(s => s.open)).toEqual([0, 0, 0]);
    expect(checkPicture(discs, 3, 7).wrong).toEqual([]);
  });

  it('the reviewer\'s minimized open-contour fixture closes every contour and matches the painter\'s picture', () => {
    const discs = [
      { x: 9.5, y: 5.5, r: 4.5, series: 2, row: 1 },
      { x: 6.5, y: 5, r: 0.5, series: 0, row: 5 },
      { x: 6.5, y: 5, r: 0, series: 0, row: 10 },
    ];
    const { wrong, map } = checkPicture(discs, 3, 11, 20, 4000);
    expect(map.series.map(s => s.open)).toEqual([0, 0, 0]);
    expect(wrong).toEqual([]);
  });

  it('a seeded half-pixel lattice of 20 to 40 discs (many coincident centres) never leaves a contour open', () => {
    let seed = 89123;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let run = 0; run < 400; run++) {
      const n = run < 200 ? 20 : 40;
      const discs = Array.from({ length: n }, (_, row) => ({
        x: Math.round(rand() * 20) / 2, y: Math.round(rand() * 20) / 2, r: Math.round(rand() * 24) / 2, series: Math.floor(rand() * 3), row,
      }));
      const { wrong, map } = checkPicture(discs, 3, run, 30, run % 20 === 0 ? 600 : 1);
      expect(map.series.map(s => s.open), JSON.stringify(discs)).toEqual([0, 0, 0]);
      expect(wrong, JSON.stringify(discs)).toEqual([]);
    }
  });
});

describe('very small positive radii (no floor beyond radius.min)', () => {
  /** Radii of every circle written in a path's arcs (`A rx ry ...`). */
  const arcRadii = (d: string): number[] => [...d.matchAll(/[Aa]([0-9.e-]+) /g)].map(m => Number(m[1]));

  it('a radius of 0.0048 px is painted and picked at 0.0048 px, written at 0.0001 px', () => {
    const g = geometryOf([{ x: 100, y: 100, r: 0.0048, series: 0, row: 0 }]);
    const d = paintedMap(g, 1).series[0]!.d;
    expect(arcRadii(d).every(r => r === 0.0048)).toBe(true);
    expect(pickGrid(g).pick(100.5, 100, 0.5)).toBe(0); // within r + 0.5
    expect(pickGrid(g).pick(100 + 0.0048 + 0.5 + 0.001 + 24, 100, 0.5)).toBe(-1);
  });

  it('radius { min: 0, max: 24 }, sizes 0.0001 and 1: radii 0.24 and 24 through geometry, anchor, path and legend', () => {
    // Expected by the spec rule r = max · √(v / vMax): 24 · √0.0001 = 0.24, area ratio 0.0001.
    const data = [{ x: 0, y: 0, s: 0.0001 }, { x: 10, y: 10, s: 1 }];
    const { rec, chart } = open({ x: 'x', y: 'y', size: 's', radius: { min: 0, max: 24 }, data });
    const key = firstKey(rec);
    const small = last(rec).lookup.anchor({ kind: 'point', seriesKey: key, row: 0, x: 0 })!;
    const big = last(rec).lookup.anchor({ kind: 'point', seriesKey: key, row: 1, x: 10 })!;
    expect(small.width / 2).toBeCloseTo(0.24, 9);
    expect(big.width / 2).toBeCloseTo(24, 9);
    expect((small.width / big.width) ** 2).toBeCloseTo(0.0001, 12);
    const marks = rec.draws.at(-1)!.marks.filter((m): m is BubbleMark => m.type === 'points' && 'bubble' in m);
    const g = marks[0]!.bubble.geometry;
    expect([...g.r].sort((p, q) => p - q)).toEqual([0.24, 24]);
    const radii = arcRadii(paintedMap(g, marks[0]!.bubble.seriesCount).series[0]!.d);
    expect(radii).toContain(0.24);
    expect(radii).toContain(24);
    const snap = bubbleInternals(chart)!.snapshot()!;
    // Reference sizes 1, niceFloor(1/4) = 0.25, niceFloor(1/16) = 0.05 → radii 24, 12, 24 · √0.05 (24 · √(v / 1)).
    expect(snap.legend.entries.map(e => e.value)).toEqual([1, 0.25, 0.05]);
    expect(snap.legend.entries[0]!.radius).toBeCloseTo(24, 12);
    expect(snap.legend.entries[1]!.radius).toBeCloseTo(12, 12);
    expect(snap.legend.entries[2]!.radius).toBeCloseTo(24 * Math.sqrt(0.05), 12);
  });

  it('radius { max: 0.25 }: every positive bubble and legend reference below 0.25 px keeps its own radius', () => {
    const data = [{ x: 0, y: 0, s: 1 }, { x: 5, y: 5, s: 4 }, { x: 10, y: 10, s: 100 }];
    const { rec, chart } = open({ x: 'x', y: 'y', size: 's', radius: { min: 0, max: 0.25 }, data });
    const marks = rec.draws.at(-1)!.marks.filter((m): m is BubbleMark => m.type === 'points' && 'bubble' in m);
    const g = marks[0]!.bubble.geometry;
    // 0.25 · √(1/100) = 0.025, 0.25 · √(4/100) = 0.05, 0.25.
    expect([...g.r].sort((p, q) => p - q).map(r => Math.round(r * 1e12) / 1e12)).toEqual([0.025, 0.05, 0.25]);
    const radii = arcRadii(paintedMap(g, 1).series[0]!.d);
    for (const r of [0.025, 0.05, 0.25]) expect(radii).toContain(r);
    const snap = bubbleInternals(chart)!.snapshot()!;
    // References 100, 25, 5 (niceFloor(100/16) = 5) → 0.25, 0.125, 0.25 · √0.05.
    expect(snap.legend.entries.map(e => e.value)).toEqual([100, 25, 5]);
    expect(snap.legend.entries[0]!.radius).toBeCloseTo(0.25, 12);
    expect(snap.legend.entries[1]!.radius).toBeCloseTo(0.125, 12);
    expect(snap.legend.entries[2]!.radius).toBeCloseTo(0.25 * Math.sqrt(0.05), 12);
  });
});

describe('exact duplicate paint geometry', () => {
  it('50,000 coincident equal discs in three series: one painted shape, no neighbour pairs, the latest row on top', () => {
    const n = 50_000;
    const g = geometryOf(Array.from({ length: n }, (_, row) => ({ x: 100, y: 100, r: 24, series: row % 3, row })), 200, 200);
    const t = performance.now();
    const map = paintedMap(g, 3);
    const ms = performance.now() - t;
    expect(map.painted).toBe(1);
    expect(map.pairs).toBe(0);
    // Row 49,999 is painted on top (equal radii: the later row), and it is in series 49,999 mod 3 = 1.
    expect(map.series.map(s => s.d.length > 0)).toEqual([false, true, false]);
    expect(pickGrid(g).pick(100, 100, 0.5)).toBe(n - 1);
    expect(ms).toBeLessThan(2000); // generous: the quadratic path took ~8 s here
  });

  it('collapsing duplicates keeps every row in the table and lookup', () => {
    const data = Array.from({ length: 300 }, (_, i) => ({ x: 5, y: 5, s: 2, g: ['a', 'b', 'c'][i % 3]! }));
    const { rec, chart } = open({ x: 'x', y: 'y', series: 'g', size: 's', data });
    expect(bubbleInternals(chart)!.table!.rowCount).toBe(300);
    expect(last(rec).lookup.count).toBe(300);
    const marks = rec.draws.at(-1)!.marks.filter((m): m is BubbleMark => m.type === 'points' && 'bubble' in m);
    expect(marks.length).toBe(3); // one path per series that has a drawn bubble
    const map = paintedMap(marks[0]!.bubble.geometry, 3);
    expect(map.painted).toBe(1);
    expect(map.series.filter(s => s.d.length > 0).length).toBe(1);
  });
});

describe('nearest edge ties against the true minimum', () => {
  it('edges 8.0, 7.6 and 7.2 px (rows 2, 1, 0) with a 0.5 px window: row 1, the latest within 0.5 of 7.2', () => {
    const g = geometryOf([10, 9.6, 9.2].map((x, b) => ({ x, y: 50, r: 2, series: b, row: 2 - b })));
    expect(g.row[pickGrid(g).pick(0, 50, 0.5)]).toBe(1);
  });

  it('visiting order does not matter', () => {
    const g = geometryOf([9.2, 10, 9.6].map((x, b) => ({ x, y: 50, r: 2, series: 0, row: [0, 2, 1][b]! })));
    expect(g.row[pickGrid(g).pick(0, 50, 0.5)]).toBe(1);
  });
});

describe('keyboard over centres outside the plotted domain', () => {
  it('y domain [0, 10] with y 0, 100, 5: the clipped middle row is skipped by step, count, ordinal and anchor', () => {
    const data = [{ x: 0, y: 0, s: 1 }, { x: 1, y: 100, s: 2 }, { x: 2, y: 5, s: 3 }];
    const { rec } = open({ x: 'x', y: { field: 'y', domain: [0, 10] }, size: 's', data });
    const l = last(rec).lookup;
    const visited: [number, number, boolean][] = [];
    for (let at = l.step(null, 'next'); at; at = l.step(at, 'next')) visited.push([at.kind === 'point' ? at.row : -1, l.ordinal(at), l.anchor(at) !== null]);
    expect(visited).toEqual([[0, 0, true], [2, 1, true]]);
    expect(l.count).toBe(2);
    const key = firstKey(rec);
    expect(l.ordinal({ kind: 'point', seriesKey: key, row: 1, x: 1 })).toBe(-1);
    const recovered = l.resolve({ kind: 'point', seriesKey: key, row: 1, x: 1 });
    expect(recovered && recovered.kind === 'point' ? recovered.row : null).not.toBe(1);
  });
});

describe('export snapshot is one drawn revision', () => {
  it('before a frame the old revision is reported whole; after, the new; table: false clears the table; destroy clears all', () => {
    const data = [{ x: 0, y: 0, s: 1, s2: 2 }, { x: 1, y: 5, s: 2, s2: 4 }, { x: 2, y: 5, s: 3, s2: 6 }];
    const { rec, chart } = open({ x: 'x', y: 'y', size: 's', data });
    const ex = bubbleInternals(chart)!;
    const first = ex.snapshot()!;
    expect(first.meta.label).toBe('s');
    expect(first.table!.headers.at(-1)).toBe('s');
    expect(first.legend.title).toBe('s');
    expect(first.geometry!.count).toBe(3);
    chart.update({ size: 's2' });
    // Accepted but not drawn: still the first revision, every field.
    expect(ex.snapshot()).toBe(first);
    expect(ex.meta!.label).toBe('s');
    expect(ex.table!.headers.at(-1)).toBe('s');
    rec.frames();
    const second = ex.snapshot()!;
    expect(second.revision).toBeGreaterThan(first.revision);
    expect([second.meta.label, second.table!.headers.at(-1), second.legend.title]).toEqual(['s2', 's2', 's2']);
    chart.update({ table: false, data: [{ x: 1, y: 2, s: 8, s2: 16 }] });
    rec.frames();
    expect(ex.table).toBeNull();
    expect(ex.geometry!.count).toBe(1);
    chart.destroy();
    expect(ex.snapshot()).toBeNull();
    expect([ex.table, ex.legend, ex.meta, ex.geometry, ex.revision]).toEqual([null, null, null, null, null]);
  });
});

describe('AX160 for the size format', () => {
  it('a size format that throws reports AX160 for the size field, and the default text is shown', () => {
    const data = [{ x: 0, y: 0, s: 1 }, { x: 1, y: 5, s: 2 }];
    const { rec, chart } = open({ x: 'x', y: 'y', size: { field: 's', format() { throw new Error('formatter'); } }, data });
    expect(chart.diagnostics.filter(d => d.code === 'AX160').map(d => d.field)).toEqual(['s']);
    expect(bubbleInternals(chart)!.legend!.entries.every(e => e.text.length > 0)).toBe(true);
    expect(last(rec).ready).toBe(true);
  });

  it('a size format that works reports nothing', () => {
    const data = [{ x: 0, y: 0, s: 1 }, { x: 1, y: 5, s: 2 }];
    const { chart } = open({ x: 'x', y: 'y', size: { field: 's', format: (v: number) => `${v} u` }, data });
    expect(chart.diagnostics.filter(d => d.code === 'AX160')).toEqual([]);
  });
});
