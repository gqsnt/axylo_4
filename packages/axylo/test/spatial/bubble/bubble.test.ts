/**
 * N8b bubble: radius rule, painter's order and paint plan, picking, diagnostics, table, legend and strict
 * rollback on the real controller (recording host, no DOM).
 *
 * Expected values come from the stated rules (area ∝ size; smallest containing disc wins, ties to the later
 * row; nearest edge within 24 px only outside every disc; AX187 counts every negative or non-finite size once
 * with its source rows) and from the fixture data, never from a run of this code.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { controllerFor, type Controller } from '../../../src/core/controller';
import type { Lookup, Scene, ScatterView } from '../../../src/core/contracts';
import { StrictError } from '../../../src/core/delivery';
import type { Committed } from '../../../src/dom/interaction';
import type { ControllerCore } from '../../../src/core/controller-types';
import { bubbleGeometry, radiusOf, ZERO_RADIUS, type BubbleGeometry } from '../../../src/spatial/bubble/geometry';
import { paintedMap } from '../../../src/spatial/bubble/paint';
import { checkPicture, discsOf } from './oracle';
import { bubbleInternals, openBubbleChart, validateBubble } from '../../../src/spatial/bubble';
import { niceFloor, referenceSizes } from '../../../src/spatial/bubble/legend';
import { pickGrid, type BubbleMark } from '../../../src/spatial/bubble/composition';
import { record, type Recording } from '../../finance/host';

/** The registry's outcome sentence of a chart-error finding (diagnostics/registry.ts). */
const CHART_ERROR = 'The chart shows its error state.';

type Row = { x: number; y: number; s: number | null | string | undefined; g?: string };

function open(options: Record<string, unknown>, size = { width: 720, height: 420 }) {
  const rec = record(size);
  let controller: Controller | null = null;
  const chart = openBubbleChart({ title: 'Bubbles', ...options }, (composition, input) => {
    controller = controllerFor(composition, input, rec.host, null);
    return controller.handle;
  });
  rec.frames();
  return { rec, chart, controller: () => controller! };
}

/** The controller's accepted state (ControllerCore; not part of the Controller type the host sees). */
const accepted = (c: Controller) => (c as unknown as Pick<ControllerCore, 'accepted'>).accepted;
const last = (rec: Recording): Committed => rec.committed!;
const lastScene = (rec: Recording): Scene => rec.draws[rec.draws.length - 1]!;
const bubbleMarks = (scene: Scene) => scene.marks.filter((m): m is BubbleMark => m.type === 'points' && 'bubble' in m);
function svgNodes(scene: Scene): number {
  let nodes = 0;
  for (let i = 0; i < scene.marks.length; nodes++) {
    const m = scene.marks[i]!;
    i++;
    if (m.type !== 'rule' || (m.role !== 'grid' && m.role !== 'tick')) continue;
    while (i < scene.marks.length) {
      const n = scene.marks[i]!;
      if (n.type !== 'rule' || n.role !== m.role || n.strokeWidth !== m.strokeWidth || JSON.stringify(n.stroke) !== JSON.stringify(m.stroke) ||
        JSON.stringify(n.dash) !== JSON.stringify(m.dash)) break;
      i++;
    }
  }
  return nodes;
}
const geometryOf = (scene: Scene): BubbleGeometry => bubbleMarks(scene)[0]!.bubble.geometry;

function centre(lookup: Lookup, seriesKey: string, row: number, x: number) {
  const box = lookup.anchor({ kind: 'point', seriesKey, row, x })!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, r: box.width / 2 };
}

describe('radius rule (area proportional)', () => {
  it('A(v2)/A(v1) = v2/v1 for unclamped positive sizes, for any data', () => {
    fc.assert(fc.property(
      fc.double({ min: 1e-300, max: 1e300, noNaN: true }), fc.double({ min: 1e-6, max: 1, noNaN: true }), fc.double({ min: 1e-6, max: 1, noNaN: true }),
      (max, a, b) => {
        const v1 = max * a, v2 = max * b;
        const r1 = radiusOf(v1, max, 0, 24), r2 = radiusOf(v2, max, 0, 24);
        fc.pre(v1 > 0 && v2 > 0 && Number.isFinite(v1) && Number.isFinite(v2));
        expect((r2 * r2) / (r1 * r1)).toBeCloseTo(v2 / v1, 6);
      },
    ), { numRuns: 1000 });
  });

  it('the largest size gets the maximum radius, zero the hollow marker, a positive size never below the floor', () => {
    expect(radiusOf(50, 50, 2, 24)).toBe(24);
    expect(radiusOf(0, 50, 2, 24)).toBe(0);
    expect(radiusOf(1e-9, 50, 2, 24)).toBe(2);
    expect(radiusOf(12.5, 50, 0, 24)).toBe(12);
    expect(radiusOf(-1, 50, 2, 24)).toBeNaN();
    expect(radiusOf(Infinity, 50, 2, 24)).toBeNaN();
    // Extremes of finite inputs: no overflow (v / max ≤ 1), an underflow only reaches the floor.
    expect(radiusOf(Number.MAX_VALUE, Number.MAX_VALUE, 2, 24)).toBe(24);
    expect(radiusOf(Number.MIN_VALUE, Number.MAX_VALUE, 2, 24)).toBe(2);
    expect(radiusOf(Number.MAX_VALUE / 4, Number.MAX_VALUE, 0, 24)).toBeCloseTo(12, 9);
  });
});

describe('painter order and per-series paths', () => {
  it('orders largest first, equal radii by source row, for any data (a permutation)', () => {
    fc.assert(fc.property(fc.array(fc.record({ x: fc.integer({ min: 0, max: 100 }), y: fc.integer({ min: 0, max: 100 }), s: fc.integer({ min: 0, max: 20 }) }), { minLength: 1, maxLength: 60 }), rows => {
      const { rec } = open({ data: rows, x: 'x', y: 'y', size: 's' });
      const g = geometryOf(lastScene(rec));
      const seen = new Set(g.order);
      expect(seen.size).toBe(g.count);
      for (let i = 1; i < g.order.length; i++) {
        const a = g.order[i - 1]!, b = g.order[i]!;
        expect(g.r[a]! > g.r[b]! || (g.r[a] === g.r[b] && g.row[a]! < g.row[b]!)).toBe(true);
      }
    }), { numRuns: 120 });
  });

  it('adversarial interleaved series through the chart: one path per series, painting exactly the painter\'s order', () => {
    // Concentric discs alternating A, B, A, B (sizes 16, 9, 4, 1: radii 24, 18, 12, 6), a disc of each series
    // crossing them, and a zero marker on top: the picture one path of whole circles per series cannot paint.
    const rows: Row[] = [
      { x: 5, y: 5, s: 16, g: 'A' }, { x: 5, y: 5, s: 9, g: 'B' }, { x: 5, y: 5, s: 4, g: 'A' }, { x: 5, y: 5, s: 1, g: 'B' },
      { x: 5.4, y: 5, s: 4, g: 'B' }, { x: 4.6, y: 5.3, s: 9, g: 'A' }, { x: 5, y: 5, s: 0, g: 'A' },
      { x: 0, y: 0, s: 1, g: 'A' }, { x: 10, y: 10, s: 1, g: 'B' },
    ];
    for (const order of [rows, [...rows].reverse()]) {
      const { rec } = open({ data: order, x: 'x', y: 'y', size: 's', series: 'g', radius: { min: 0 } });
      const marks = bubbleMarks(lastScene(rec));
      expect(marks.map(m => m.bubble.paint)).toEqual(['series', 'series']);
      expect(new Set(marks.map(m => m.series)).size).toBe(2);
      const g = marks[0]!.bubble.geometry;
      const { wrong, map } = checkPicture(discsOf(g), 2, 3, Math.max(g.plot.x + g.plot.width, g.plot.y + g.plot.height), 3000);
      expect(wrong).toEqual([]);
      expect(map.series.map(s => s.open)).toEqual([0, 0]);
      // What the drawer writes is the map's path of the mark's series.
      for (const m of marks) expect(map.series[m.series]!.d.length).toBeGreaterThan(0);
    }
  });

  it('any data through the chart: every series path paints the painter\'s order picture (property)', () => {
    fc.assert(fc.property(fc.array(fc.record({
      x: fc.integer({ min: 0, max: 40 }), y: fc.integer({ min: 0, max: 40 }), s: fc.integer({ min: 0, max: 50 }), g: fc.constantFrom('a', 'b', 'c'),
    }), { minLength: 2, maxLength: 30 }), fc.integer({ min: 1, max: 1000 }), (rows, seed) => {
      const { rec } = open({ data: rows, x: 'x', y: 'y', size: 's', series: 'g', radius: { min: 0, max: 40 } }, { width: 240, height: 200 });
      const marks = bubbleMarks(lastScene(rec));
      if (!marks.length) return;
      const g = marks[0]!.bubble.geometry;
      const S = (last(rec).view as ScatterView).frame.series.length;
      const { wrong, map } = checkPicture(discsOf(g), S, seed, 240, 600);
      expect(wrong).toEqual([]);
      expect(map.series.reduce((n, s) => n + s.open, 0)).toBe(0);
      expect(marks.length).toBeLessThanOrEqual(S);
    }), { numRuns: 60 });
  });

  it('draws 50,000 bubbles of three series as one path per series, at most 25 SVG nodes (scene marks)', () => {
    const data = { columns: { x: new Float64Array(50_000), y: new Float64Array(50_000), s: new Float64Array(50_000), g: new Array<string>(50_000) } };
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 50_000; i++) {
      data.columns.x[i] = rand() * 1000; data.columns.y[i] = rand() * 1000;
      data.columns.s[i] = i % 97 === 0 ? 0 : rand() * 1e6; data.columns.g[i] = ['a', 'b', 'c'][i % 3]!;
    }
    // Phases: create = bubble() on the recording host (resolve, size column, normalize, view, diagnostics);
    // frame = the first animation frame (layout, scene, lookup, reader); paths = the visible map and every `d`
    // string the SVG drawer writes (paint.ts). DOM writes are not part of a Node run: Chrome measures them.
    const rec = record({ width: 720, height: 420 });
    let controller: Controller | null = null;
    const t0 = performance.now();
    const chart = openBubbleChart({ title: '50k', data, x: 'x', y: 'y', size: 's', series: 'g' }, (composition, input) => {
      controller = controllerFor(composition, input, rec.host, null);
      return controller.handle;
    });
    const t1 = performance.now();
    rec.frames();
    const t2 = performance.now();
    void controller;
    const scene = lastScene(rec);
    // One SVG node per mark, except that SvgRenderer.draw merges a run of grid or tick rules of one role,
    // width, paint and dash into one path (render/svg.ts ruleRunEnd). The DOM count itself is checked in Chrome.
    expect(svgNodes(scene)).toBeLessThanOrEqual(25);
    const marks = bubbleMarks(scene);
    expect(marks.map(m => [m.series, m.bubble.paint])).toEqual([[0, 'series'], [1, 'series'], [2, 'series']]);
    const g = marks[0]!.bubble.geometry;
    expect(g.count).toBe(50_000);
    const t3 = performance.now();
    const map = paintedMap(g, 3);
    const t4 = performance.now();
    const bytes = map.series.map(s => s.d.length);
    expect(map.series.map(s => s.open)).toEqual([0, 0, 0]);
    expect(chart.diagnostics.some(d => d.code === 'AX189')).toBe(true);
    console.info(`[N8b 50k] Node recording host: create ${(t1 - t0).toFixed(1)} ms, first frame ${(t2 - t1).toFixed(1)} ms, visible map + d ${(t4 - t3).toFixed(1)} ms, ` +
      `${scene.marks.length} scene marks, ${svgNodes(scene)} svg nodes, ${marks.length} bubble paths, d bytes ${bytes.join(' + ')} = ${bytes.reduce((a, b) => a + b, 0)}, ` +
      `pieces ${map.series.map(s => s.arcs).join('/')}, contours ${map.series.map(s => s.contours).join('/')}, circles ${map.circles} (culled ${map.culled})`);
  });
});

describe('picking', () => {
  const nested: Row[] = [
    { x: 0, y: 0, s: 100, g: 'big' }, { x: 0.2, y: 0, s: 1, g: 'small' }, { x: 10, y: 10, s: 4, g: 'big' }, { x: -10, y: -10, s: 4, g: 'small' },
  ];
  for (const [name, rows] of [['big first', nested], ['small first', [...nested].reverse()]] as const) {
    it(`the smallest containing bubble wins over a larger one of another series (${name})`, () => {
      const { rec } = open({ data: rows, x: 'x', y: 'y', size: 's', series: 'g' });
      const { lookup } = last(rec);
      const smallRow = rows.findIndex(r => r.s === 1);
      const bigRow = rows.findIndex(r => r.s === 100);
      const small = centre(lookup, 'small', smallRow, 0.2);
      const big = centre(lookup, 'big', bigRow, 0);
      expect(big.r).toBe(24);
      const pickedSmall = lookup.pick(small.x, small.y);
      expect(pickedSmall?.kind === 'point' && pickedSmall.refs[0]).toMatchObject({ seriesKey: 'small', row: smallRow });
      // Inside the big disc, away from the small one: the big one.
      const pickedBig = lookup.pick(big.x, big.y + 15);
      expect(pickedBig?.kind === 'point' && pickedBig.refs[0]).toMatchObject({ seriesKey: 'big', row: bigRow });
      // Tooltip and reading carry x, y and size, each formatted.
      const tip = lookup.tooltip(pickedSmall!);
      expect(tip.rows[0]!.value).toBe('0; s: 1');
      expect(tip.title).toBe('0.2');
    });
  }

  it('equal radii tie to the later source row; outside every disc, nearest edge within 24 px', () => {
    const rows: Row[] = [{ x: 0, y: 0, s: 4, g: 'a' }, { x: 0, y: 0, s: 4, g: 'b' }, { x: 100, y: 100, s: 1, g: 'a' }];
    const { rec } = open({ data: rows, x: 'x', y: 'y', size: 's', series: 'g', radius: { min: 0, max: 20 } });
    const { lookup } = last(rec);
    const c = centre(lookup, 'a', 0, 0);
    expect(c.r).toBe(20);
    const hit = lookup.pick(c.x, c.y);
    expect(hit?.kind === 'point' && hit.refs[0]).toMatchObject({ seriesKey: 'b', row: 1 });
    // 20 px outside the edge: the nearest edge; 30 px outside: nothing.
    const edgeHit = lookup.pick(c.x + 40, c.y);
    expect(edgeHit?.kind === 'point' && edgeHit.refs[0]).toMatchObject({ row: 1 });
    // Containment is r + 0.5: 20.4 px from the centre is inside, so the nearest-edge rule does not apply.
    const inside = lookup.pick(c.x + 20.4, c.y);
    expect(inside?.kind === 'point' && inside.refs[0]).toMatchObject({ row: 1 });
  });

  it('pick grid agrees with a brute-force containment rule for any bubbles (property)', () => {
    fc.assert(fc.property(
      fc.array(fc.record({ x: fc.double({ min: 0, max: 300, noNaN: true }), y: fc.double({ min: 0, max: 200, noNaN: true }), r: fc.integer({ min: 0, max: 30 }) }), { minLength: 1, maxLength: 40 }),
      fc.double({ min: 0, max: 300, noNaN: true }), fc.double({ min: 0, max: 200, noNaN: true }),
      (items, px, py) => {
        const n = items.length;
        const ids = Uint32Array.from({ length: n }, (_, i) => i);
        // Painter's order: largest size first (a zero marker after every disc), equal sizes by row.
        const order = Uint32Array.from(ids).sort((p, q) => (items[q]!.r - items[p]!.r) || (p - q));
        const rank = new Int32Array(n);
        order.forEach((b, o) => { rank[b] = o; });
        const g: BubbleGeometry = {
          count: n, x: Float32Array.from(items, i => i.x), y: Float32Array.from(items, i => i.y), r: Float64Array.from(items, i => i.r),
          series: new Uint16Array(n), index: Uint32Array.from(ids), row: Int32Array.from(ids), order, rank,
          reach: Math.max(ZERO_RADIUS, ...items.map(i => i.r)), plot: { x: 0, y: 0, width: 300, height: 200 },
        };
        // Containment of what is painted: a disc to r + 0.5; a zero marker only its ring (ZERO_RADIUS ± 0.5, with
        // the same 0.5 reach), never its hollow centre. The one painted on top wins (smaller size; a zero marker
        // above any disc; equal sizes the later row).
        const contains = (b: number) => {
          const d = Math.hypot(px - g.x[b]!, py - g.y[b]!);
          return g.r[b] === 0 ? d >= ZERO_RADIUS - 1 && d <= ZERO_RADIUS + 0.5 : d <= g.r[b]! + 0.5;
        };
        // Fallback distance: to the disc's edge; a zero marker's hollow centre counts as touching its ring.
        const edgeOf = (b: number) => {
          const d = Math.hypot(px - g.x[b]!, py - g.y[b]!);
          return g.r[b] === 0 ? Math.max(0, d - ZERO_RADIUS) : d - g.r[b]!;
        };
        let expected = -1, es = Infinity;
        for (let b = 0; b < n; b++) {
          if (contains(b) && (g.r[b]! < es || (g.r[b] === es && b > expected))) { expected = b; es = g.r[b]!; }
        }
        if (expected < 0) {
          let best = Infinity;
          for (let b = 0; b < n; b++) {
            const e = edgeOf(b);
            if (e <= 24 && (e < best - 0.5 || (Math.abs(e - best) <= 0.5 && b > expected))) { expected = b; best = Math.min(best, e); }
          }
        }
        const got = pickGrid(g).pick(px, py, 0.5);
        if (expected >= 0 && got >= 0 && got !== expected) {
          // Only the edge tie window can legitimately differ by scan order; containment never may.
          expect(contains(expected)).toBe(false);
          expect(Math.abs(edgeOf(got) - edgeOf(expected))).toBeLessThanOrEqual(1);
        } else {
          expect(got).toBe(expected);
        }
      },
    ), { numRuns: 1000 });
  });

  it('zero sizes are hollow, pickable markers; keyboard order is x then y', () => {
    const rows: Row[] = [{ x: 2, y: 1, s: 0 }, { x: 1, y: 5, s: 9 }, { x: 1, y: 2, s: 4 }];
    const { rec } = open({ data: rows, x: 'x', y: 'y', size: 's' });
    const { lookup } = last(rec);
    const marks = bubbleMarks(lastScene(rec));
    // One series: one path, holding the disc and the ring of the zero marker (paint.test.ts checks the picture).
    expect(marks.map(m => m.bubble.paint)).toEqual(['series']);
    const zero = centre(lookup, 'y', 0, 2);
    expect(zero.r).toBe(ZERO_RADIUS);
    const at = lookup.pick(zero.x, zero.y);
    expect(at?.kind === 'point' && at.refs[0]).toMatchObject({ row: 0 });
    const first = lookup.step(null, 'next')!;
    const second = lookup.step(first, 'next')!;
    const third = lookup.step(second, 'next')!;
    expect([first, second, third].map(r => r.kind === 'point' ? r.row : -1)).toEqual([2, 1, 0]);
    expect(lookup.datum(third)!.value).toBe('1; s: 0');
  });

  it('zoom keeps radii (the size domain is the data, not the window) and picks within the window', () => {
    const rows: Row[] = [{ x: 0, y: 0, s: 1 }, { x: 5, y: 5, s: 4 }, { x: 10, y: 10, s: 16 }];
    const { rec, chart } = open({ data: rows, x: 'x', y: 'y', size: 's', radius: { min: 0 } });
    chart.zoom([0, 6]);
    rec.frames();
    const g = geometryOf(lastScene(rec));
    expect(g.count).toBe(2);
    expect([...g.r].sort((a, b) => a - b)).toEqual([6, 12]);
    const { lookup } = last(rec);
    expect(lookup.anchor({ kind: 'point', seriesKey: 'y', row: 2, x: 10 })).toBeNull();
  });
});

describe('diagnostics', () => {
  it('AX187: negative and non-finite sizes are omitted with the exact count and source rows, rows kept in the table', () => {
    const rows: Row[] = [
      { x: 1, y: 1, s: 5 }, { x: 2, y: 2, s: -1 }, { x: 3, y: 3, s: Infinity }, { x: 4, y: 4, s: NaN }, { x: 5, y: 5, s: 7 }, { x: 6, y: 6, s: null },
    ];
    const found = validateBubble({ title: 't', data: rows as never, x: 'x', y: 'y', size: 's' } as never);
    const ax187 = found.filter(d => d.code === 'AX187');
    expect(ax187).toHaveLength(1);
    expect(ax187[0]).toMatchObject({ level: 'warning', count: 3, rows: [1, 2, 3], field: 's' });
    const { rec, chart } = open({ data: rows, x: 'x', y: 'y', size: 's' });
    expect(chart.diagnostics.filter(d => d.code === 'AX187')[0]).toMatchObject({ count: 3, rows: [1, 2, 3] });
    expect(geometryOf(lastScene(rec)).count).toBe(2);
    const table = last(rec).reader.table!;
    expect(table.headers).toEqual(['x', 'Series', 'y', 's']);
    expect(table.rowCount).toBe(6);
    expect(table.row(1)).toEqual(['2', 'y', '2', '-1']);
    expect(table.row(2)![3]).toBe('∞');
    expect(table.row(3)![3]).toBe('No data');
    expect(table.row(5)![3]).toBe('No data');
    expect(last(rec).reader.note).not.toBeNull();
    expect(bubbleInternals(chart)?.table?.rowCount).toBe(6);
  });

  it('AX187 counts every negative or non-finite size once, with the first ten source rows (property)', () => {
    const size = fc.oneof(fc.double({ min: -1e9, max: 1e9, noNaN: true }), fc.constantFrom(Infinity, -Infinity, NaN, null, 0, -0));
    fc.assert(fc.property(fc.array(size, { minLength: 1, maxLength: 60 }), sizes => {
      const data = sizes.map((s, i) => ({ x: i, y: i % 5, s }));
      const bad = sizes.flatMap((s, i) => (typeof s === 'number' && (!Number.isFinite(s) || s < 0) ? [i] : []));
      const found = validateBubble({ title: 't', data, x: 'x', y: 'y', size: 's' } as never).filter(d => d.code === 'AX187');
      if (!bad.length) expect(found).toEqual([]);
      else expect(found).toEqual([expect.objectContaining({ level: 'warning', count: bad.length, rows: bad.slice(0, 10), field: 's' })]);
    }), { numRuns: 1000 });
  });

  it('AX188 only when every size is zero; AX189 only above 10,000 sized bubbles', () => {
    const zeros = validateBubble({ title: 't', data: [{ x: 1, y: 1, s: 0 }, { x: 2, y: 2, s: 0 }], x: 'x', y: 'y', size: 's' } as never);
    expect(zeros.map(d => d.code)).toEqual(['AX188']);
    const mixed = validateBubble({ title: 't', data: [{ x: 1, y: 1, s: 0 }, { x: 2, y: 2, s: 3 }], x: 'x', y: 'y', size: 's' } as never);
    expect(mixed).toEqual([]);
    const n = 10_001;
    const cols = { x: Float64Array.from({ length: n }, (_, i) => i), y: Float64Array.from({ length: n }, (_, i) => i % 7), s: new Float64Array(n).fill(2) };
    expect(validateBubble({ title: 't', data: { columns: cols }, x: 'x', y: 'y', size: 's' } as never).map(d => d.code)).toEqual(['AX189']);
    const fewer = { x: cols.x.subarray(0, 10_000), y: cols.y.subarray(0, 10_000), s: cols.s.subarray(0, 10_000) };
    expect(validateBubble({ title: 't', data: { columns: fewer }, x: 'x', y: 'y', size: 's' } as never)).toEqual([]);
  });

  it('no size option at all: AX150 for size with the chart-error effect, and no per-row finding', () => {
    const found = validateBubble({ title: 't', data: [{ x: 1, y: 1 }, { x: 2, y: 2 }], x: 'x', y: 'y' } as never);
    expect(found.filter(d => d.field === 'size').map(d => [d.code, d.level, d.message.endsWith(CHART_ERROR)])).toEqual([['AX150', 'warning', true]]);
    expect(found.filter(d => d.code === 'AX101' || d.code === 'AX102')).toEqual([]);
  });

  it('a typed size column is borrowed, not copied', () => {
    const s = Float64Array.of(1, 2, 3);
    const { chart } = open({ data: { columns: { x: Float64Array.of(1, 2, 3), y: Float64Array.of(1, 2, 3), s } }, x: 'x', y: 'y', size: 's' });
    expect(bubbleInternals(chart)!.meta!.sizes.values).toBe(s);
  });

  it('a size field no row has is AX150 (chart-error) naming it and the fields there are; unknown size and radius keys are AX150', () => {
    const found = validateBubble({ title: 't', data: [{ x: 1, y: 1 }], x: 'x', y: 'y', size: { field: 'nope', colour: 1 }, radius: { max: -3 } } as never);
    expect(found.filter(d => d.code === 'AX101' || d.code === 'AX102')).toEqual([]);
    const size = found.filter(d => d.field === 'size');
    expect(size.map(d => [d.code, d.message.endsWith(CHART_ERROR)])).toEqual([['AX150', true]]);
    expect(size[0]!.message).toContain("'nope'");
    expect(size[0]!.message).toContain("'x', 'y'");
    expect(found.filter(d => d.code === 'AX150' && d.field !== 'size').map(d => d.field).sort()).toEqual(['radius.max', 'size.colour']);
  });
});

describe('updates and strict rollback', () => {
  const rows: Row[] = [{ x: 1, y: 1, s: 4 }, { x: 2, y: 2, s: 16 }, { x: 3, y: 3, s: 1 }];
  const t: Row[] = [{ x: 1, y: 1, s: 4, }, { x: 2, y: 2, s: 16 }, { x: 3, y: 3, s: 1 }].map(r => ({ ...r, t: r.s * 2 })) as never;

  it('a size-only update redraws with the new field and keeps the frame', () => {
    const { rec, chart, controller } = open({ data: t, x: 'x', y: 'y', size: 's', radius: { min: 0 } });
    const before = accepted(controller())!.frame;
    chart.update({ size: { field: 't', label: 'Twice', unit: 'kg' } } as never);
    rec.frames();
    expect(accepted(controller())!.frame).toBe(before);
    const { lookup, reader } = last(rec);
    expect(lookup.datum({ kind: 'point', seriesKey: 'y', row: 1, x: 2 })!.value).toBe('2; Twice: 32 kg');
    expect(reader.table!.headers[3]).toBe('Twice (kg)');
    expect(bubbleInternals(chart)!.legend!.title).toBe('Twice (kg)');
  });

  it('strict rejects a size patch that adds AX187 and keeps the committed size channel and revision', () => {
    const bad = rows.map((r, i) => ({ ...r, n: i === 1 ? -5 : r.s }));
    const { rec, chart, controller } = open({ data: bad, x: 'x', y: 'y', size: 's', strict: true, radius: { min: 0 } });
    const committed = accepted(controller())!;
    const radii = [...geometryOf(lastScene(rec)).r];
    expect(() => chart.update({ size: 'n' } as never)).toThrow(StrictError);
    expect(accepted(controller())).toBe(committed);
    rec.frames();
    expect([...geometryOf(lastScene(rec)).r]).toEqual(radii);
    expect(last(rec).lookup.datum({ kind: 'point', seriesKey: 'y', row: 1, x: 2 })!.value).toBe('2; s: 16');
    expect(chart.diagnostics.filter(d => d.code === 'AX187')).toEqual([]);
    // A data patch that adds a negative size is rejected the same way.
    expect(() => chart.update({ data: rows.map(r => ({ ...r, s: -r.s! })) } as never)).toThrow(StrictError);
    expect(accepted(controller())).toBe(committed);
    // A label-only y update clones the frame and keeps the size channel.
    chart.update({ y: { field: 'y', label: 'Height' } } as never);
    rec.frames();
    expect(accepted(controller())!.frame).not.toBe(committed.frame);
    expect([...geometryOf(lastScene(rec)).r]).toEqual(radii);
    expect(last(rec).reader.table!.headers).toEqual(['x', 'Series', 'Height', 's']);
  });

  it('strict rejects a bubble-only radius patch (AX150) and keeps the committed revision, layout and radii; an x-label clone keeps the channel', () => {
    const { rec, chart, controller } = open({ data: rows, x: 'x', y: 'y', size: 's', strict: true, radius: { min: 0 } });
    const committed = accepted(controller())!;
    const layout = last(rec).layout;
    const radii = [...geometryOf(lastScene(rec)).r];
    expect(() => chart.update({ radius: { min: 0, max: -1 } } as never)).toThrow(StrictError);
    expect(accepted(controller())).toBe(committed);
    expect(accepted(controller())!.revision).toBe(committed.revision);
    rec.frames();
    expect(last(rec).layout).toBe(layout);
    expect([...geometryOf(lastScene(rec)).r]).toEqual(radii);
    chart.update({ x: { field: 'x', label: 'Across', unit: 'km' } } as never);
    rec.frames();
    const after = accepted(controller())!;
    expect(after.revision).toBeGreaterThan(committed.revision);
    expect(after.frame).not.toBe(committed.frame);
    expect([...geometryOf(lastScene(rec)).r]).toEqual(radii);
    expect(last(rec).reader.table!.headers).toEqual(['Across (km)', 'Series', 'y', 's']);
    expect(last(rec).lookup.datum({ kind: 'point', seriesKey: 'y', row: 1, x: 2 })!.value).toBe('2; s: 16');
  });

  it('a size-only patch to a field no row has: AX150 for size on that call and on data calls, gone with the fix', () => {
    const { rec, chart } = open({ data: rows, x: 'x', y: 'y', size: 's' });
    chart.update({ size: 'nope' } as never);
    rec.frames();
    const sizeCodes = () => chart.diagnostics.filter(d => d.field === 'size' || d.field === 'nope').map(d => `${d.code}:${d.message.endsWith(CHART_ERROR) ? 'chart-error' : 'other'}`);
    expect(sizeCodes()).toEqual(['AX150:chart-error']);
    // New rows are a data call: the same single finding, not a retained AX101.
    chart.update({ data: [...rows, { x: 4, y: 4, s: 2 }] } as never);
    expect(sizeCodes()).toEqual(['AX150:chart-error']);
    chart.update({ size: 's' } as never);
    rec.frames();
    expect(sizeCodes()).toEqual([]);
    expect(chart.diagnostics.filter(d => d.code === 'AX101')).toEqual([]);
    expect(geometryOf(lastScene(rec)).count).toBe(4);
  });

  it('a title update keeps the layout, scene and lookup', () => {
    const { rec, chart } = open({ data: rows, x: 'x', y: 'y', size: 's' });
    const before = last(rec);
    const scene = lastScene(rec);
    chart.update({ title: 'Other' });
    rec.frames();
    expect(last(rec).layout).toBe(before.layout);
    expect(lastScene(rec)).toBe(scene);
  });

  it('a radius update changes radii without renormalizing', () => {
    const { rec, chart, controller } = open({ data: rows, x: 'x', y: 'y', size: 's', radius: { min: 0 } });
    const frame = accepted(controller())!.frame;
    chart.update({ radius: { min: 0, max: 12 } } as never);
    rec.frames();
    expect(accepted(controller())!.frame).toBe(frame);
    expect(Math.max(...geometryOf(lastScene(rec)).r)).toBe(12);
  });
});

describe('legend model', () => {
  it('nice reference values at or below the largest size; radii are the painted ones', () => {
    expect(niceFloor(1)).toBe(1);
    expect(niceFloor(999)).toBe(500);
    expect(niceFloor(1000)).toBe(1000);
    expect(niceFloor(0.03)).toBe(0.025);
    expect(referenceSizes(1.4e9)).toEqual([1e9, 2.5e8, 5e7]);
    expect(referenceSizes(0)).toEqual([0]);
    const { rec, chart } = open({ data: [{ x: 1, y: 1, s: 1000 }, { x: 2, y: 2, s: 10 }], x: 'x', y: 'y', size: 's', radius: { min: 0 } });
    rec.frames();
    const legend = bubbleInternals(chart)!.legend!;
    expect(legend.entries.map(e => e.value)).toEqual([1000, 250, 50]);
    expect(legend.entries.map(e => e.radius)).toEqual([24, 12, 24 * Math.sqrt(0.05)]);
    expect(legend.entries.map(e => e.text)).toEqual(['1,000', '250', '50']);
  });
});

describe('readout parity (the Chrome fixture, in Node)', () => {
  const NESTED = [
    { gdp: 50, life: 70, pop: 1000, region: 'Large' }, { gdp: 52, life: 70, pop: 4, region: 'Small' },
    { gdp: 0, life: 50, pop: 100, region: 'Large' }, { gdp: 100, life: 90, pop: 9, region: 'Small' }, { gdp: 20, life: 80, pop: 250, region: 'Third' },
  ];
  it('tooltip, keyboard reading and table give the same x, y and size with their units', () => {
    const { rec } = open({
      data: NESTED, x: { field: 'gdp', label: 'GDP', unit: 'k$' }, y: { field: 'life', label: 'Life', unit: 'years' },
      size: { field: 'pop', label: 'Population', unit: 'M' }, series: 'region',
    });
    const { lookup, reader } = last(rec);
    const table = reader.table!;
    expect(table.headers).toEqual(['GDP (k$)', 'Series', 'Life (years)', 'Population (M)']);
    // x then y order of the fixture: rows 2, 4, 0, 1, 3.
    const sourceRows = [2, 4, 0, 1, 3];
    let ref = lookup.step(null, 'first');
    for (let i = 0; i < 5; i++) {
      const d = lookup.datum(ref!)!;
      const row = NESTED[sourceRows[i]!]!;
      expect(ref!.kind === 'point' && ref!.row).toBe(sourceRows[i]);
      const expected = [`${row.gdp} k$`, row.region, `${row.life} years`, `${new Intl.NumberFormat('en-US').format(row.pop)} M`];
      expect(table.row(i)).toEqual(expected);
      expect([d.x, d.seriesLabel, d.value]).toEqual([expected[0], expected[1], `${expected[2]}; Population: ${expected[3]}`]);
      expect(lookup.tooltip({ kind: 'point', refs: [ref!], count: 1 }).rows[0]!.value).toBe(d.value);
      ref = lookup.step(ref, 'next');
    }
    expect(reader.summary).toContain('Bubble area shows Population, from 4 M to 1,000 M.');
  });
});

void (null as unknown as ScatterView);
void bubbleGeometry;
