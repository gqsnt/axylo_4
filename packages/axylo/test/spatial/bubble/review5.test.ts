/**
 * N8b fifth-review regressions. Rules under test (stated, not read off a run):
 *  - a zero marker paints only its ring: inside its hollow centre a painted positive disc is what is seen and
 *    picked; an isolated zero marker is still picked from its hole (the fallback counts the hole as touching);
 *  - single-series stepping across 50,000 rows with only the first and last drawn lands on the other drawn row
 *    in one step, in bounded time;
 *  - the export snapshot reads the legend committed for the drawn layout: the author's format is not called
 *    again, the texts equal the ones drawn, and a format with side effects cannot run (or destroy) on that read;
 *  - a size format that throws only for a value read lazily (a table row) reports AX160 (effect 'changed', so the
 *    reader's note says it) once the scheduled frame has run, to chart.diagnostics and onDiagnostic, once.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { controllerFor, type Controller } from '../../../src/core/controller';
import type { Composition } from '../../../src/core/composition';
import type { DatumRef, ScatterView } from '../../../src/core/contracts';
import type { Committed } from '../../../src/dom/interaction';
import { bubbleInternals, openBubbleChart } from '../../../src/spatial/bubble';
import { pickGrid } from '../../../src/spatial/bubble/composition';
import { ZERO_RADIUS } from '../../../src/spatial/bubble/geometry';
import { paintedMap } from '../../../src/spatial/bubble/paint';
import { checkPicture, expectedOwner, flatten, geometryOf, winding } from './oracle';
import { record } from '../../finance/host';

function open(options: Record<string, unknown>) {
  const rec = record({ width: 720, height: 420 });
  let controller: Controller | null = null;
  let composition: Composition | null = null;
  const chart = openBubbleChart({ title: 'Bubbles', ...options }, (c, input) => {
    composition = c;
    controller = controllerFor(c, input, rec.host, null);
    return controller.handle;
  });
  rec.frames();
  return { rec, chart, controller: () => controller!, composition: () => composition! };
}
const last = (rec: ReturnType<typeof record>): Committed => rec.committed!;

describe('zero marker picking follows the painted ring', () => {
  it('a radius 2 disc (series 0) and a zero ring (series 1) at (100, 100): the centre picks the disc', () => {
    const g = geometryOf([
      { x: 100, y: 100, r: 2, series: 0, row: 0 },
      { x: 100, y: 100, r: 0, series: 1, row: 1 },
    ]);
    const pick = pickGrid(g);
    // Centre: inside the ring's hole, inside the disc (painted there, the ring's inner gap ends at 1.5).
    expect(pick.pick(100, 100, 0.5)).toBe(0);
    // On the ring (ZERO_RADIUS from the centre): the ring, painted above the disc.
    expect(pick.pick(100 + ZERO_RADIUS, 100, 0.5)).toBe(1);
  });

  it('an isolated zero ring is picked from its hollow centre and from its ring', () => {
    const g = geometryOf([{ x: 100, y: 100, r: 0, series: 0, row: 0 }]);
    const pick = pickGrid(g);
    expect(pick.pick(100, 100, 0.5)).toBe(0);
    expect(pick.pick(101, 100, 0.5)).toBe(0);
    expect(pick.pick(100 + ZERO_RADIUS, 100, 0.5)).toBe(0);
    expect(pick.pick(100 + ZERO_RADIUS + 24.5, 100, 0.5)).toBe(-1);
  });
});

describe('single-series stepping over 50,000 mostly omitted rows', () => {
  it('first and last rows drawn: next from the first is the last, previous from the last is the first, fast', () => {
    const n = 50_000;
    const data = Array.from({ length: n }, (_, i) => ({ x: i, y: i % 7, s: i === 0 || i === n - 1 ? 1 : -1 }));
    const { rec, composition } = open({ data, x: 'x', y: 'y', size: 's' });
    const step = composition().interaction.stepInSeries!;
    const view = last(rec).view as ScatterView;
    const key = view.frame.series[0]!.key;
    const at = (row: number): DatumRef => ({ kind: 'point', seriesKey: key, row, x: row });
    const t = performance.now();
    const next = step(view, at(0), 'next');
    const previous = step(view, at(n - 1), 'previous');
    const ms = performance.now() - t;
    expect(next && next.kind === 'point' ? next.row : null).toBe(n - 1);
    expect(previous && previous.kind === 'point' ? previous.row : null).toBe(0);
    expect(step(view, at(n - 1), 'next')).toBeNull();
    expect(step(view, at(0), 'first')).toBeNull();
    const page = step(view, at(0), 'page-next');
    expect(page && page.kind === 'point' ? page.row : null).toBe(n - 1);
    // One O(n) index pass plus binary searches; the old per-row rescans took seconds here.
    expect(ms).toBeLessThan(250);
  });
});

describe('export reads the committed legend', () => {
  it('a stateful format (call counter): snapshot reads call nothing and equal the drawn legend texts', () => {
    let calls = 0;
    const format = (v: number) => `${v} #${++calls}`;
    const data = [{ x: 0, y: 0, s: 1 }, { x: 1, y: 5, s: 50 }, { x: 2, y: 5, s: 100 }];
    const { chart } = open({ x: 'x', y: 'y', size: { field: 's', format }, data });
    const ex = bubbleInternals(chart)!;
    const before = calls;
    const first = ex.snapshot()!;
    const again = ex.legend!;
    expect(calls).toBe(before);
    expect(again).toBe(first.legend);
    expect(first.legend.entries.every(e => / #\d+$/.test(e.text))).toBe(true);
  });

  it('a format with side effects (destroys the chart when called) is never called by an export read', () => {
    let armed = false, destroyed = 0;
    let target: { destroy(): void } | null = null;
    const format = (v: number) => { if (armed && target) { destroyed++; target.destroy(); } return `${v} u`; };
    const data = [{ x: 0, y: 0, s: 1 }, { x: 1, y: 5, s: 100 }];
    const { chart } = open({ x: 'x', y: 'y', size: { field: 's', format }, data });
    target = chart;
    const ex = bubbleInternals(chart)!;
    armed = true;
    const snap = ex.snapshot();
    expect(destroyed).toBe(0);
    expect(snap).not.toBeNull();
    expect(snap!.legend.entries.map(e => e.text)).toEqual(['100 u', '25 u', '5 u']);
    armed = false;
    chart.destroy();
    expect(ex.snapshot()).toBeNull();
  });
});

describe('AX160 for a size read lazily', () => {
  it('sizes 1, 37, 100; the format throws only for 37: reading its table row reports AX160 after the frame', () => {
    const seen: string[] = [];
    const format = (v: number) => { if (v === 37) throw new Error('no 37'); return `${v} u`; };
    const data = [{ x: 0, y: 0, s: 1 }, { x: 1, y: 5, s: 37 }, { x: 2, y: 5, s: 100 }];
    const { rec, chart } = open({ x: 'x', y: 'y', size: { field: 's', format }, data, onDiagnostic: (d: { code: string }) => seen.push(d.code) });
    // Legend references 100, 25, 5 and the range 1 to 100 never format 37.
    expect(chart.diagnostics.filter(d => d.code === 'AX160')).toEqual([]);
    const table = last(rec).reader.table!;
    const cells = Array.from({ length: table.rowCount }, (_, i) => table.row(i)!.at(-1));
    expect(cells.filter(c => c === '1 u' || c === '100 u').length).toBe(2);
    // The default text for 37 (not the author's), shown rather than nothing.
    expect(cells.some(c => typeof c === 'string' && c.includes('37'))).toBe(true);
    rec.frames();
    expect(chart.diagnostics.filter(d => d.code === 'AX160').map(d => d.field)).toEqual(['s']);
    expect(seen.filter(c => c === 'AX160')).toEqual(['AX160']);
    expect(last(rec).reader.note).not.toBeNull();
    // Further failing reads do not report again.
    table.row(1); table.row(1);
    rec.frames();
    expect(chart.diagnostics.filter(d => d.code === 'AX160').length).toBe(1);
    expect(seen.filter(c => c === 'AX160').length).toBe(1);
  });
});

describe('near-coincident radii and tangencies close every contour', () => {
  it('the review\'s four rows: one closed picture, (54.25, 51.25) is background (inside the top disc\'s gap)', () => {
    const discs = [
      { x: 55.5, y: 55.5, r: 3.5000005, series: 1, row: 0 },
      { x: 59, y: 57.5, r: 10.5, series: 1, row: 1 },
      { x: 55.5, y: 57, r: 0, series: 0, row: 2 },
      { x: 55.5, y: 55.5, r: 3.5, series: 1, row: 3 },
    ];
    const g = geometryOf(discs);
    // Painted largest first: row 1 (10.5), row 0, row 3 (3.5, on top of row 0), the zero ring. (54.25, 51.25) is
    // 4.43 px from (55.5, 55.5): in row 3's unpainted 3.5–4.5 band, so nothing is painted there.
    expect(expectedOwner(discs, g, 54.25, 51.25, 0.01)).toBe(-1);
    const { wrong, map } = checkPicture(discs, 2, 5, 120, 4000);
    expect(map.series.map(s => s.open)).toEqual([0, 0]);
    expect(map.series.map(s => winding(flatten(s.d), 54.25, 51.25))).toEqual([0, 0]);
    expect(wrong).toEqual([]);
  });

  it('pairs and triples whose radii or centre distances differ from coincidence or tangency by 1e-8 to 1e-4 px (property)', () => {
    const deltas = [0, 1e-8, 1e-7, 5e-7, 1e-6, 2e-6, 1e-5, 1e-4];
    fc.assert(fc.property(
      fc.record({
        cx: fc.integer({ min: 30, max: 90 }).map(v => v / 2), cy: fc.integer({ min: 30, max: 90 }).map(v => v / 2),
        r: fc.integer({ min: 2, max: 30 }).map(v => v / 2), k: fc.integer({ min: 0, max: 3 }),
        di: fc.integer({ min: 0, max: deltas.length - 1 }), sign: fc.constantFrom(1, -1),
        angle: fc.integer({ min: 0, max: 7 }), series: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 3, maxLength: 3 }),
        zero: fc.boolean(), rows: fc.constantFrom([0, 1, 2], [2, 1, 0], [1, 0, 2]),
      }),
      ({ cx, cy, r, k, di, sign, angle, series, zero, rows }) => {
        const delta = sign * deltas[di]!;
        const t = (angle * Math.PI) / 4, ux = Math.cos(t), uy = Math.sin(t);
        const r2 = Math.max(0.5, r / 2);
        // k picks the boundary pair made near-coincident: 0 equal radii, concentric; 1 a disc edge on another's
        // gap edge (r + GAP), concentric; 2 internal tangency; 3 external tangency of the gap bands.
        const second = k === 0 ? { x: cx, y: cy, r: r + delta }
          : k === 1 ? { x: cx, y: cy, r: r + 1 + delta }
            : k === 2 ? { x: cx + (r - r2 + delta) * ux, y: cy + (r - r2 + delta) * uy, r: r2 }
              : { x: cx + (r + r2 + 2 + delta) * ux, y: cy + (r + r2 + 2 + delta) * uy, r: r2 };
        const discs = [
          { x: cx, y: cy, r, series: series[0]!, row: rows[0]! },
          { ...second, series: series[1]!, row: rows[1]! },
          { x: cx + 1.5 * ux, y: cy + 1.5 * uy, r: zero ? 0 : r2, series: series[2]!, row: rows[2]! },
        ];
        const { wrong, map } = checkPicture(discs, 3, 7 + angle, 120, 600);
        expect(map.series.map(s => s.open), JSON.stringify(discs)).toEqual([0, 0, 0]);
        expect(wrong, JSON.stringify(discs)).toEqual([]);
      },
    ), { numRuns: 300, seed: 20261127 });
  });
});

/**
 * Independent check of a concentric picture along one ray: at `count` radii, the oracle's painter's owner against
 * the nonzero winding of each series' flattened path (samples within the oracle's margin of an edge are skipped).
 */
function radialMismatches(discs: Parameters<typeof expectedOwner>[0], g: ReturnType<typeof geometryOf>, map: ReturnType<typeof paintedMap>, count: number): string[] {
  const flat = map.series.map(s => flatten(s.d));
  const out: string[] = [];
  const cx = discs[0]!.x, cy = discs[0]!.y;
  for (let k = 0; k < count; k++) {
    const t = (27 * (k + 0.37)) / count, px = cx + t * Math.cos(0.3), py = cy + t * Math.sin(0.3);
    const owner = expectedOwner(discs, g, px, py, 1e-4);
    if (owner === null) continue;
    flat.forEach((f, s) => { if ((winding(f, px, py) !== 0) !== (owner === s)) out.push(`t=${t.toFixed(4)} series ${s} owner ${owner}`); });
    if (out.length > 5) break;
  }
  return out;
}

describe('concentric clusters: radial sweep', () => {
  it('6,000 shapes at one centre with distinct radii 2 + 22i/6000 in three series: no pair enumeration, the oracle picture', () => {
    const n = 6000;
    const discs = Array.from({ length: n }, (_, i) => ({ x: 100, y: 100, r: 2 + (22 * i) / n, series: i % 3, row: i }));
    const g = geometryOf(discs);
    const t = performance.now();
    const map = paintedMap(g, 3);
    const ms = performance.now() - t;
    expect(map.pairs).toBe(0);
    expect(map.series.map(s => s.open)).toEqual([0, 0, 0]);
    // Painted largest first, so the smallest (row 0, series 0, r = 2) is on top: its disc, then its gap to 3. At
    // any radius t in (3, 25) the topmost shape covering t is the smallest one with r + 1 > t, and t > r there,
    // so t is in that shape's gap: nothing else shows. One contour: the series 0 disc of radius 2.
    expect(map.series.map(s => s.contours)).toEqual([1, 0, 0]);
    expect(map.series[0]!.d).toMatch(/^M98 100a2 2 0 1 1 4 0a2 2 0 1 1 -4 0Z/);
    expect(radialMismatches(discs, g, map, 120)).toEqual([]);
    expect(ms).toBeLessThan(500);
  });

  it('50,000 at one centre (mixed series, zero rings, equal radii by row): bounded, matches the oracle', () => {
    const n = 50_000;
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const discs = Array.from({ length: n }, (_, i) => ({
      x: 100, y: 100, r: i % 97 === 0 ? 0 : Math.round(rand() * 2400) / 100, series: Math.floor(rand() * 3), row: i,
    }));
    const g = geometryOf(discs);
    const t = performance.now();
    const map = paintedMap(g, 3);
    const ms = performance.now() - t;
    expect(map.pairs).toBe(0);
    expect(map.series.map(s => s.open)).toEqual([0, 0, 0]);
    expect(radialMismatches(discs, g, map, 60)).toEqual([]);
    expect(ms).toBeLessThan(1500);
  });

  it('small concentric sets match the general step\'s oracle picture with zero rings and coincident edges (property)', () => {
    fc.assert(fc.property(
      fc.array(fc.record({ r: fc.integer({ min: 0, max: 16 }).map(v => v / 2), series: fc.integer({ min: 0, max: 2 }) }), { minLength: 3, maxLength: 12 }),
      items => {
        const discs = items.map((d, row) => ({ x: 50, y: 50, r: d.r, series: d.series, row }));
        const { wrong, map } = checkPicture(discs, 3, items.length, 100, 500);
        expect(map.series.map(s => s.open)).toEqual([0, 0, 0]);
        expect(wrong, JSON.stringify(discs)).toEqual([]);
      },
    ), { numRuns: 200, seed: 1127 });
  });
});
