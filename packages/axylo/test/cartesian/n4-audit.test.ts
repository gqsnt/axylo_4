/**
 * N4 repair audit of the dense drawing before sealing, from the spec's rules:
 * - F13 / RFC §4.4: on a log axis a value at or below zero breaks the line where it stands and is never projected;
 *   a positive value between two such values is isolated (F2) and drawn as a marker.
 * - A5: the last-point marker sits on the last value the line draws inside the window, so trailing nonpositive
 *   values on a log axis do not carry it.
 * - F10: a stacked area's edge follows its band (each edge vertex is a vertex of its band's outer boundary).
 * - RFC C4.1 §5.2: drawing and picking share one projection (the A5 marker and the lookup's anchor coincide).
 */
import { describe, expect, it } from 'vitest';
import type { AreaMark, PathMark, PointMark } from '../../src/core/contracts';
import { run } from './n4-pipeline';

const marks = <T>(scene: { marks: readonly { type: string }[] }, type: string, series: number) =>
  scene.marks.filter(m => m.type === type && (m as { series?: number }).series === series) as T[];
const pairs = (xy: Float32Array) => Array.from({ length: xy.length / 2 }, (_, k) => [xy[2 * k]!, xy[2 * k + 1]!] as const);

describe('N4 audit: log gating, isolated values and A5', () => {
  it('breaks at nonpositive values, isolates a value between two of them, and puts A5 on the last positive value', () => {
    // x:      0  1  2  3   4  5  6
    const v = [5, 0, 7, -1, 8, 9, 0];
    const res = run({
      title: 'Log gating', data: v.map((y, x) => ({ x, v: y })), x: 'x',
      axes: { v: { position: 'left', scale: 'log' } }, layers: [{ type: 'line', y: 'v', yAxis: 'v' }],
    });
    if (res.layout.kind !== 'plot' || res.layout.projection.kind !== 'xy') throw new Error('expected an xy plot');
    const x = res.layout.projection.x;
    const path = marks<PathMark>(res.scene, 'path', 0)[0]!;
    // Only the run [8, 9] (x = 4, 5) is a path; 5 and 7 have no joined neighbour.
    expect(pairs(path.xy).map(([px]) => px)).toEqual([Math.fround(x.map(4)), Math.fround(x.map(5))]);
    const points = marks<PointMark>(res.scene, 'points', 0)[0]!;
    const xs = pairs(points.xy).map(([px]) => px).sort((a, b) => a - b);
    // Isolated x = 0 and x = 2, and the A5 marker on x = 5 (x = 6 is 0, not drawn on a log axis).
    expect(xs).toEqual([0, 2, 5].map(i => Math.fround(x.map(i))));
    for (const [px, py] of pairs(points.xy)) { expect(Number.isFinite(px)).toBe(true); expect(Number.isFinite(py)).toBe(true); }
    expect(res.diagnostics.find(d => d.code === 'AX171')?.count).toBe(3);
  });

  it('places the A5 marker where the lookup anchors the same datum (one projection), on the right log axis too', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ x: i, bars: 10 + (i % 7), lat: i === 49 ? -2 : 1 + i * i }));
    const res = run({
      title: 'Projection', data: rows, x: 'x',
      axes: { bars: { position: 'left' }, lat: { position: 'right', scale: 'log' } },
      layers: [{ type: 'bar', y: 'bars', yAxis: 'bars' }, { type: 'line', y: 'lat', yAxis: 'lat' }],
    });
    const points = marks<PointMark>(res.scene, 'points', 1)[0]!;
    const [[px, py]] = pairs(points.xy) as [readonly [number, number]];
    const anchor = res.lookup.anchor({ kind: 'aligned', seriesKey: res.frame.series[1]!.key, x: 48 })!;
    expect(anchor).not.toBeNull();
    expect(Math.fround(anchor.x + anchor.width / 2)).toBe(px);
    expect(Math.fround(anchor.y + anchor.height / 2)).toBe(py);
    // The nonpositive last value has no anchor: it is not drawn.
    expect(res.lookup.anchor({ kind: 'aligned', seriesKey: res.frame.series[1]!.key, x: 49 })).toBeNull();
  });
});

describe('N4 audit: stacked area edges follow their bands', () => {
  it('every edge vertex of a component is a vertex of its band boundary on the side of its value', () => {
    const rows = [
      { x: 1, a: 3, b: 2 }, { x: 2, a: -2, b: 4 }, { x: 3, a: 5, b: -1 }, { x: 4, a: 1, b: null }, { x: 5, a: 2, b: 3 }, { x: 6, a: -4, b: -2 },
    ];
    const res = run({
      title: 'Edges', data: rows, x: 'x', axes: { v: { position: 'left' } },
      layers: [{ type: 'area', y: ['a', 'b'], yAxis: 'v', stacked: true }],
    });
    const areas = res.scene.marks.filter((m): m is AreaMark => m.type === 'area');
    for (const series of [0, 1]) {
      const bands = areas.filter(a => a.series === series);
      const boundary = new Set(bands.flatMap(b => pairs(b.upper).map(([px, py]) => `${px},${py}`)));
      for (const edge of marks<PathMark>(res.scene, 'path', series)) {
        for (const [px, py] of pairs(edge.xy)) {
          if (Number.isNaN(px)) continue;
          expect(boundary.has(`${px},${py}`)).toBe(true);
        }
      }
    }
  });
});
