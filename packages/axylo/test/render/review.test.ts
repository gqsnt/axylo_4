/**
 * Regression tests for the render review (reviews/2026-11-18/impl/wp/render.review.md), Node side.
 * Each block names its finding.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MISSING_MIN, MISSING_STROKE, missingBox, sector, SECTOR_APEX, SECTOR_ARCS, SECTOR_NONE, SECTOR_RING } from '../../src/render/geometry';
import { areaData } from '../../src/render/svg';
import type { AreaMark } from '../../src/core/contracts';

const TAU = 2 * Math.PI;
const f32 = (v: number): number => Math.fround(v);

/** Every vertex the renderers will emit for one sector, as [radius, canvas angle] pairs. */
function vertices(kind: number, s: Float64Array, r1: number): [number, number][] {
  if (kind === SECTOR_NONE || kind === SECTOR_RING) return [];
  const v: [number, number][] = [[r1, s[0]!], [r1, s[1]!]];
  if (kind === SECTOR_ARCS) v.push([s[6]!, s[2]!], [s[6]!, s[3]!]);
  if (kind === SECTOR_APEX) v.push([s[4]!, s[5]!]);
  return v;
}

describe('finding 1: sectors for any span up to a full turn, at Float32 precision', () => {
  const s = new Float64Array(8);

  it('the reported 99.9 % slice keeps its hole and stays inside the ring', () => {
    const kind = sector(0, 0.999 * TAU, 25, 40, 1, s);
    expect(kind).toBe(SECTOR_ARCS);
    for (const [r] of vertices(kind, s, 40)) {
      expect(r).toBeGreaterThanOrEqual(25 - 1e-9);
      expect(r).toBeLessThanOrEqual(40 + 1e-9);
    }
  });

  it('a full turn stored as Float32 is a ring, from any start', () => {
    for (const start of [0, 0.3, 1, 2.5, 3.14159, 5, 6.2]) {
      expect(sector(f32(start), f32(start + TAU), 25, 40, 1, s), `start ${start}`).toBe(SECTOR_RING);
    }
  });

  it('every vertex stays within [r0, r1] of the centre and each side keeps gap/2 from its radius (property, whole range)', () => {
    fc.assert(fc.property(
      fc.double({ min: 0, max: TAU, noNaN: true }), fc.double({ min: 1e-4, max: TAU, noNaN: true }),
      fc.double({ min: 0, max: 60, noNaN: true }), fc.double({ min: 1, max: 200, noNaN: true }), fc.double({ min: 0, max: 8, noNaN: true }),
      (start, span, r0, thickness, gap) => {
        const a0 = f32(start), a1 = f32(start + span), r1 = r0 + thickness;
        const kind = sector(a0, a1, r0, r1, gap, s);
        const d = gap / 2;
        const tol = 1e-6 * Math.max(1, r1);
        if (kind === SECTOR_NONE) {
          // Only a slice too thin to show anything beside its gaps may be dropped: the region at least
          // gap/2 from both sides starts at radius d / sin(span / 2) (or d for a reflex slice) and must
          // still reach inside r1.
          const realSpan = a1 - a0;
          const clearing = realSpan <= Math.PI ? d / Math.sin(realSpan / 2) : d;
          expect(Math.max(r0, clearing) >= r1 - tol).toBe(true);
          return;
        }
        if (kind === SECTOR_RING) { expect(a1 - a0).toBeGreaterThan(TAU - 1e-4); return; }
        for (const [r] of vertices(kind, s, r1)) {
          expect(r).toBeGreaterThanOrEqual(r0 - tol);
          expect(r).toBeLessThanOrEqual(r1 + tol);
        }
        // Distance from the start side's radius line (through the centre at angle a0) of the outer start point.
        const side0 = a0 - Math.PI / 2, side1 = a1 - Math.PI / 2;
        const dist = (r: number, a: number, side: number): number => r * Math.sin(a - side);
        expect(dist(r1, s[0]!, side0)).toBeCloseTo(d, 6);
        expect(-dist(r1, s[1]!, side1)).toBeCloseTo(d, 6);
        if (kind === SECTOR_ARCS) {
          expect(dist(s[6]!, s[3]!, side0)).toBeGreaterThanOrEqual(d - tol);
          expect(-dist(s[6]!, s[2]!, side1)).toBeGreaterThanOrEqual(d - tol);
        }
        // The outer arc stays within the slice's own angles.
        expect(s[0]!).toBeGreaterThanOrEqual(side0 - 1e-9);
        expect(s[1]!).toBeLessThanOrEqual(side1 + 1e-9);
        expect(s[1]!).toBeGreaterThanOrEqual(s[0]!);
      }), { numRuns: 2000 });
  });

  it('reflex slices of a pie (r0 = 0) keep a gap-sized clearing at the centre instead of a distant apex', () => {
    const kind = sector(0, 1.5 * Math.PI, 0, 50, 4, s);
    for (const [r] of vertices(kind, s, 50)) expect(r).toBeLessThanOrEqual(50);
    expect(kind).toBe(SECTOR_ARCS);
    expect(s[6]).toBeCloseTo(2, 9);
  });
});

describe('finding 2: the "no data" mark grows toward the inside of the clip and never past its slot', () => {
  const out = new Float64Array(4);
  const clip = { x: 40, y: 20, width: 340, height: 240 };
  const inside = (o: Float64Array): void => {
    const pad = MISSING_STROKE / 2 + 1e-9;
    expect(o[0]! - pad).toBeGreaterThanOrEqual(clip.x - 1e-9);
    expect(o[1]! - pad).toBeGreaterThanOrEqual(clip.y - 1e-9);
    expect(o[0]! + o[2]! + pad).toBeLessThanOrEqual(clip.x + clip.width + 1e-9);
    expect(o[1]! + o[3]! + pad).toBeLessThanOrEqual(clip.y + clip.height + 1e-9);
  };

  it('vertical, all-negative chart: zero at the top of the plot, the mark grows downwards', () => {
    missingBox(50, 20, 20, 0, out, clip);
    inside(out);
    expect(out[3]! + MISSING_STROKE).toBeCloseTo(MISSING_MIN, 9);
    expect(out[1]! - MISSING_STROKE / 2).toBeCloseTo(20, 9);
  });

  it('vertical, ordinary chart: zero at the bottom, the mark grows upwards and stands on the baseline', () => {
    missingBox(50, 260, 20, 0, out, clip);
    inside(out);
    expect(out[1]! + out[3]! + MISSING_STROKE / 2).toBeCloseTo(260, 9);
  });

  it('horizontal, all-negative chart: zero at the right edge, the mark grows leftwards', () => {
    missingBox(380, 100, 0, 20, out, clip);
    inside(out);
    expect(out[2]! + MISSING_STROKE).toBeCloseTo(MISSING_MIN, 9);
    expect(out[0]! + out[2]! + MISSING_STROKE / 2).toBeCloseTo(380, 9);
  });

  it('horizontal, ordinary chart: zero at the left edge, the mark grows rightwards', () => {
    missingBox(40, 100, 0, 20, out, clip);
    inside(out);
    expect(out[0]! - MISSING_STROKE / 2).toBeCloseTo(40, 9);
  });

  it('a narrow slot is never widened onto its neighbour, down to the outline width (property)', () => {
    fc.assert(fc.property(fc.double({ min: MISSING_STROKE, max: 30, noNaN: true }), fc.double({ min: 41, max: 370, noNaN: true }), fc.boolean(), (band, at, vertical) => {
      if (vertical) {
        missingBox(at, 200, band, 0, out, clip);
        expect(out[2]! + MISSING_STROKE).toBeLessThanOrEqual(Math.max(band, MISSING_STROKE) + 1e-9);
        expect(out[0]! - MISSING_STROKE / 2).toBeGreaterThanOrEqual(at - 1e-9);
      } else {
        missingBox(200, 100, 0, band, out, clip);
        expect(out[3]! + MISSING_STROKE).toBeLessThanOrEqual(Math.max(band, MISSING_STROKE) + 1e-9);
      }
    }));
  });
});

describe('finding 2, stacked bars: the mark sits at the outer end of the stack', () => {
  const out = new Float64Array(4);
  const clip = { x: 40, y: 20, width: 340, height: 240 };
  it('a positive stack ending mid-plot: the mark stands on the stack end, growing outwards (up)', () => {
    missingBox(100, 120, 20, 0, out, clip);
    expect(out[1]! + out[3]! + MISSING_STROKE / 2).toBeCloseTo(120, 9);
  });
  it('a stack that reaches the top of the plot: the mark grows inwards (down, over the stack) and stays visible', () => {
    missingBox(100, 20, 20, 0, out, clip);
    expect(out[1]! - MISSING_STROKE / 2).toBeCloseTo(20, 9);
    expect(out[1]! + out[3]! + MISSING_STROKE / 2).toBeCloseTo(20 + MISSING_MIN, 9);
  });
  it('a negative stack ending mid-plot grows upwards too (toward the plot inside, onto the stack end)', () => {
    missingBox(100, 200, 20, 0, out, clip);
    expect(out[1]! + out[3]! + MISSING_STROKE / 2).toBeCloseTo(200, 9);
  });
  it('a horizontal stack ending at the right edge grows leftwards', () => {
    missingBox(380, 100, 0, 20, out, clip);
    expect(out[0]! + out[2]! + MISSING_STROKE / 2).toBeCloseTo(380, 9);
  });
});

describe('finding 16: an area run with an empty side draws nothing', () => {
  const area = (runs: number[]): AreaMark => ({
    type: 'area', series: 0, fill: { kind: 'series', index: 0 }, opacity: 1,
    upper: Float32Array.of(0, 0, 1, 2, 2, 0), lower: Float32Array.of(0, 0, 1, 2, 2, 0), runs: Uint32Array.from(runs),
  });
  it('upper empty, lower empty, both empty', () => {
    expect(areaData(area([0, 0, 0, 3]))).toBe('');
    expect(areaData(area([0, 3, 0, 0]))).toBe('');
    expect(areaData(area([0, 0, 0, 0]))).toBe('');
    expect(areaData(area([0, 3, 0, 3]))).toBe('M0 0L1 2L2 0L2 0L1 2L0 0Z');
  });
});
