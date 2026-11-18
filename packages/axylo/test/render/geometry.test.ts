import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MARKER_POLYGONS, MISSING_MIN, MISSING_STROKE, missingBox, paintOf, sector, SECTOR_APEX, SECTOR_ARCS, SECTOR_NONE, SECTOR_RING, signedArea, snapRule,
} from '../../src/render/geometry';
import { areaData, pathData } from '../../src/render/svg';
import type { PaintBindings } from '../../src/core/contracts';

describe('snapRule', () => {
  const out = new Float64Array(5);
  it('puts a 1 px horizontal rule on whole device rows', () => {
    fc.assert(fc.property(fc.double({ min: -1000, max: 1000, noNaN: true }), fc.constantFrom(1, 1.5, 2, 3), fc.constantFrom(0.5, 1, 2), (y, dpr, w) => {
      snapRule(0, y, 100, y, w, dpr, out);
      const lineWidth = out[4]! * dpr;
      expect(Number.isInteger(Math.round(lineWidth * 1e9) / 1e9)).toBe(true);
      const top = out[1]! * dpr - lineWidth / 2;
      expect(Math.abs(top - Math.round(top))).toBeLessThan(1e-6);
      // Within one device pixel of where it was asked for.
      expect(Math.abs(out[1]! - y)).toBeLessThanOrEqual(1 / dpr);
    }));
  });

  it('leaves a diagonal alone', () => {
    snapRule(0.3, 0.4, 10.7, 20.1, 1, 2, out);
    expect(Array.from(out)).toEqual([0.3, 0.4, 10.7, 20.1, 1]);
  });
});

describe('sector (ring slices with a constant-width gap)', () => {
  const s = new Float64Array(8);
  it('moves each side gap/2 into the slice, parallel to its radius', () => {
    fc.assert(fc.property(
      fc.double({ min: 0, max: 5, noNaN: true }), fc.double({ min: 0.3, max: 3, noNaN: true }),
      fc.double({ min: 10, max: 50, noNaN: true }), fc.double({ min: 60, max: 200, noNaN: true }), fc.double({ min: 0.5, max: 8, noNaN: true }),
      (a0, span, r0, r1, gap) => {
        const kind = sector(a0, a0 + span, r0, r1, gap, s);
        if (kind === SECTOR_NONE) return;
        // Distance of the outer start point from the start radius line is gap / 2.
        const sideAngle = a0 - Math.PI / 2;
        const distance = (r: number, a: number): number => Math.abs(r * Math.sin(a - sideAngle));
        expect(distance(r1, s[0]!)).toBeCloseTo(gap / 2, 9);
        if (kind === SECTOR_ARCS) expect(distance(r0, s[3]!)).toBeCloseTo(gap / 2, 9);
        if (kind === SECTOR_APEX) expect(distance(s[4]!, s[5]!)).toBeCloseTo(gap / 2, 9);
      }));
  });

  it('draws a single full slice as a ring and refuses empty ones', () => {
    expect(sector(0, 2 * Math.PI, 10, 20, 2, s)).toBe(SECTOR_RING);
    expect(sector(1, 1, 10, 20, 2, s)).toBe(SECTOR_NONE);
    expect(sector(0, 0.01, 10, 20, 4, s)).toBe(SECTOR_NONE);
  });

  it('closes at an apex when the gap meets before the inner radius (a pie, r0 = 0)', () => {
    expect(sector(0, Math.PI / 2, 0, 50, 4, s)).toBe(SECTOR_APEX);
    expect(s[4]).toBeCloseTo(2 / Math.sin(Math.PI / 4), 9);
    expect(sector(0, Math.PI / 2, 30, 50, 4, s)).toBe(SECTOR_ARCS);
  });
});

describe('missingBox', () => {
  const out = new Float64Array(4);
  it('grows a zero-height slot upwards from the baseline to a visible box', () => {
    missingBox(10, 200, 20, 0, out);
    const [x, y, w, h] = Array.from(out);
    expect(x).toBe(10 + MISSING_STROKE / 2);
    expect(y! + h! + MISSING_STROKE / 2).toBe(200);
    expect(h! + MISSING_STROKE).toBe(MISSING_MIN);
    expect(w! + MISSING_STROKE).toBe(20);
  });

  it('keeps a box that is already large enough', () => {
    missingBox(10, 190, 20, 10, out);
    expect(Array.from(out)).toEqual([10.75, 190.75, 18.5, 8.5]);
  });
});

describe('markers', () => {
  it('every polygon is clockwise on screen and fits the unit box', () => {
    for (const [shape, poly] of Object.entries(MARKER_POLYGONS)) {
      expect(signedArea(poly), shape).toBeGreaterThan(0);
      for (const v of poly) expect(Math.abs(v), shape).toBeLessThanOrEqual(0.5 + 1e-12);
    }
  });
});

describe('paintOf', () => {
  const table: PaintBindings = { tokens: { axis: 'A', grid: 'G', reference: 'R', muted: 'M', focus: 'F', background: 'B', text: 'T' }, series: ['s0', 's1'] };
  it('looks up series, tokens and none', () => {
    expect(paintOf({ kind: 'series', index: 1 }, table)).toBe('s1');
    expect(paintOf({ kind: 'series', index: 3 }, table)).toBe('s1');
    expect(paintOf({ kind: 'token', name: 'grid' }, table)).toBe('G');
    expect(paintOf({ kind: 'none' }, table)).toBeNull();
  });
});

describe('SVG path data', () => {
  it('a NaN pair lifts the pen', () => {
    expect(pathData(Float32Array.of(0, 0, 10, 0, NaN, NaN, 20, 5, 30, 5))).toBe('M0 0L10 0M20 5L30 5');
  });

  it('has one M per run and one L per further vertex, for any input (property)', () => {
    fc.assert(fc.property(fc.array(fc.oneof(fc.double({ min: -1e4, max: 1e4, noNaN: true }), fc.constant(NaN)), { maxLength: 400 }), values => {
      const xy = Float32Array.from(values.length % 2 === 0 ? values : values.slice(1));
      let runs = 0, vertices = 0, pen = false;
      for (let i = 0; i < xy.length; i += 2) {
        if (Number.isNaN(xy[i]!) || Number.isNaN(xy[i + 1]!)) { pen = false; continue; }
        vertices++;
        if (!pen) runs++;
        pen = true;
      }
      const d = pathData(xy);
      expect((d.match(/M/g) ?? []).length).toBe(runs);
      expect((d.match(/L/g) ?? []).length).toBe(vertices - runs);
    }));
  });

  it('is correct across chunk boundaries', () => {
    const n = 5000;
    const xy = new Float32Array(2 * n);
    for (let i = 0; i < n; i++) { xy[2 * i] = i; xy[2 * i + 1] = i % 7; }
    const d = pathData(xy);
    expect(d.startsWith('M0 0L1 1L2 2')).toBe(true);
    expect((d.match(/L/g) ?? []).length).toBe(n - 1);
    expect(d.endsWith(`L${n - 1} ${(n - 1) % 7}`)).toBe(true);
  });

  it('an area run is its upper vertices forward, then its lower vertices in reverse', () => {
    const d = areaData({
      type: 'area', series: 0, fill: { kind: 'series', index: 0 }, opacity: 1,
      upper: Float32Array.of(0, 1, 1, 1, 2, 1, 9, 9, 10, 2, 11, 2),
      lower: Float32Array.of(0, 5, 1, 5, 2, 5, 10, 6, 11, 6),
      runs: Uint32Array.of(0, 3, 0, 3, 4, 2, 3, 2),
    });
    expect(d).toBe('M0 1L1 1L2 1L2 5L1 5L0 5ZM10 2L11 2L11 6L10 6Z');
  });
});
