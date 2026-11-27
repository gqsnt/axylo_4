/**
 * Finite-range extremes of the size channel (repair N8b-R8): a size whose ratio to the largest one is subnormal
 * or underflows, a subnormal `radius.max`, and the legend of a subnormal maximum.
 *
 * Expected values are derived by hand from binary exponents: MIN_VALUE = 2^-1074 and MAX_VALUE ≈ 2^1024, so
 * √(MIN / MAX) ≈ 2^-1049 (itself subnormal) and 24 px · 2^-1049 = 3 · 2^-1046, a subnormal double held exactly. Reference sizes come
 * from the nice-step rule (1, 2, 2.5, 5 × 10^k at or below the value) applied to decimal literals.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { controllerFor, type Controller } from '../../../src/core/controller';
import type { Scene } from '../../../src/core/contracts';
import { radiusOf, ZERO_RADIUS } from '../../../src/spatial/bubble/geometry';
import { niceFloor, referenceSizes } from '../../../src/spatial/bubble/legend';
import { paintedMap } from '../../../src/spatial/bubble/paint';
import type { BubbleMark } from '../../../src/spatial/bubble/composition';
import { bubbleInternals, openBubbleChart } from '../../../src/spatial/bubble';
import { record } from '../../finance/host';

const MIN = Number.MIN_VALUE, MAX = Number.MAX_VALUE, MIN_NORMAL = 2 ** -1022;

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
const geometryOf = (scene: Scene) =>
  scene.marks.filter((m): m is BubbleMark => m.type === 'points' && 'bubble' in m)[0]!.bubble.geometry;

describe('radius of a size whose ratio to the maximum is subnormal or underflows', () => {
  it('MIN_VALUE beside MAX_VALUE at 24 px is 3 · 2^-1046 (≈ 3.97874211e-315), not the zero marker', () => {
    const r = radiusOf(MIN, MAX, 0, 24);
    expect(r).toBe(3 * 2 ** -1046);
    expect(r).toBeCloseTo(3.97874211e-315, 323);
    expect(r).toBeGreaterThan(0);
  });

  it('MIN_VALUE beside 2^-50 at max 2^-560 is 2^-1072 = 4 · MIN_VALUE: the root quotient comes before the product', () => {
    // √(2^-1074) / √(2^-50) = 2^-537 / 2^-25 = 2^-512, and 2^-512 · 2^-560 = 2^-1072, a subnormal held exactly.
    // Multiplying first (2^-560 · 2^-537 = 2^-1097) underflows to 0 before the division.
    expect(radiusOf(MIN, 2 ** -50, 0, 2 ** -560)).toBe(2 ** -1072);
    expect(2 ** -1072).toBe(4 * MIN);
    expect(radiusOf(2 ** -50, 2 ** -50, 0, 2 ** -560)).toBe(2 ** -560);
  });

  it('2 · MIN_VALUE beside MAX_VALUE at 1000 px keeps full precision although √v / √max is subnormal', () => {
    // √(2^-1073 / MAX) ≈ 2^-1048.5 is subnormal, so the root quotient alone has lost bits.
    // r = 1000 · √(2^-1073 / (2^1024 · (1 − 2^-53))) = 1000 · 2^25 · √2 · (1 + ~2^-54) · MIN_VALUE
    //   ≈ 47453132812.126 · MIN_VALUE, which rounds to 47453132812 · MIN_VALUE ≈ 2.344496271e-313.
    const v1 = 2 * MIN, v2 = v1 * 2 ** 60;
    const r1 = radiusOf(v1, MAX, 0, 1000), r2 = radiusOf(v2, MAX, 0, 1000);
    expect(Number(r1.toPrecision(10))).toBe(2.344496271e-313);
    expect(r1).toBe(47453132812 * MIN);
    // r1 is subnormal, held to within half its spacing MIN_VALUE: a relative error of at most MIN / (2 · r1).
    // r2 ≈ 2.5e-304 is normal (relative error ≤ 2^-53 per rounding, a few roundings). The area ratio (r2/r1)²
    // doubles both relative errors: |A2/A1 / (v2/v1) − 1| ≤ 2 · (MIN / (2 · r1) + 4 · 2^-53) ≈ 2.1e-11.
    const tolerance = 2 * (MIN / (2 * r1) + 4 * 2 ** -53);
    expect(Math.abs((r2 / r1) ** 2 / (v2 / v1) - 1)).toBeLessThanOrEqual(tolerance);
  });

  it('keeps A(v2)/A(v1) = v2/v1 when v/max underflows to zero, for any data', () => {
    fc.assert(fc.property(
      fc.double({ min: 1e308, max: MAX, noNaN: true }),
      fc.double({ min: 1e-20, max: 1e-1, noNaN: true }), fc.double({ min: 1e-20, max: 1e-1, noNaN: true }),
      (max, v1, v2) => {
        // The quotient alone has no precision left here: the old rule drew these as zero markers.
        expect(v1 / max).toBeLessThan(MIN_NORMAL);
        const r1 = radiusOf(v1, max, 0, 24), r2 = radiusOf(v2, max, 0, 24);
        expect(r1).toBeGreaterThan(0);
        expect(r2).toBeGreaterThan(0);
        expect((r2 / r1) ** 2 / (v2 / v1)).toBeCloseTo(1, 9);
      },
    ), { numRuns: 500 });
  });

  it('is monotonic in the size across the subnormal boundary of v/max, for any data', () => {
    fc.assert(fc.property(
      fc.double({ min: 1, max: MAX, noNaN: true }), fc.double({ min: -60, max: 60, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }),
      (max, offset, step) => {
        // Two sizes either side of v/max = 2^-1022, a few binades apart at most.
        const v1 = max * MIN_NORMAL * 2 ** offset, v2 = v1 * (1 + step);
        fc.pre(v1 > 0 && Number.isFinite(v2) && v2 <= max);
        expect(radiusOf(v2, max, 0, 24)).toBeGreaterThanOrEqual(radiusOf(v1, max, 0, 24));
      },
    ), { numRuns: 500 });
  });

  it('a positive size is never 0 (the zero-marker sentinel), even with a subnormal radius.max, for any data', () => {
    expect(radiusOf(1, 4, 0, MIN)).toBe(MIN);
    expect(radiusOf(MIN, MAX, 0, MIN)).toBe(MIN);
    fc.assert(fc.property(
      fc.double({ min: MIN, max: MAX, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: MIN, max: 1000, noNaN: true }),
      (max, share, maxRadius) => {
        const v = max * share;
        fc.pre(v > 0);
        const r = radiusOf(v, max, 0, maxRadius);
        expect(r).toBeGreaterThan(0);
        expect(r).toBeLessThanOrEqual(maxRadius);
      },
    ), { numRuns: 1000 });
  });

  it('ordinary ratios keep the formula maxRadius · √(v / max) bit for bit, for any data', () => {
    fc.assert(fc.property(
      fc.double({ min: 1e-300, max: 1e300, noNaN: true }), fc.double({ min: 1e-6, max: 1, noNaN: true }),
      (max, share) => {
        const v = max * share;
        fc.pre(v > 0 && v / max >= MIN_NORMAL);
        expect(radiusOf(v, max, 0, 24)).toBe(24 * Math.sqrt(v >= max ? 1 : v / max));
      },
    ), { numRuns: 500 });
  });
});

describe('reference sizes of a subnormal maximum', () => {
  it('MIN_VALUE gives the one positive reference MIN_VALUE (5e-324), no zero and nothing above the data', () => {
    expect(niceFloor(MIN)).toBe(MIN);
    expect(referenceSizes(MIN)).toEqual([5e-324]);
    // 2 · MIN_VALUE: its quarter and sixteenth round to 0, so they add nothing.
    expect(referenceSizes(2 * MIN)).toEqual([1e-323]);
    // 1e-322: a quarter is 2.5e-323 (a nice value), a sixteenth 6.25e-324 floors to 5e-324.
    expect(referenceSizes(1e-322)).toEqual([1e-322, 2.5e-323, 5e-324]);
    expect(referenceSizes(1e-310)).toEqual([1e-310, 2.5e-311, 5e-312]);
  });

  it('for any positive finite maximum: 1 to 3 positive, strictly decreasing references at or below it', () => {
    fc.assert(fc.property(fc.oneof(fc.double({ min: MIN, max: 1e-300, noNaN: true }), fc.double({ min: MIN, max: MAX, noNaN: true })), max => {
      const top = niceFloor(max);
      expect(top).toBeGreaterThan(0);
      expect(top).toBeLessThanOrEqual(max);
      const refs = referenceSizes(max);
      expect(refs.length).toBeGreaterThanOrEqual(1);
      expect(refs.length).toBeLessThanOrEqual(3);
      expect(refs[0]).toBe(top);
      refs.forEach((v, i) => {
        expect(v).toBeGreaterThan(0);
        if (i > 0) expect(v).toBeLessThan(refs[i - 1]!);
      });
    }), { numRuns: 1000 });
  });
});

describe('extremes through the chart', () => {
  it('sizes MIN_VALUE and MAX_VALUE with radius.min 0: the tiny bubble is a positive circle, not a hollow marker', () => {
    const { rec, chart } = open({ data: [{ x: 1, y: 1, s: MIN }, { x: 2, y: 2, s: MAX }], x: 'x', y: 'y', size: 's', radius: { min: 0 } });
    const g = geometryOf(rec.draws[rec.draws.length - 1]!);
    expect(g.count).toBe(2);
    const tiny = [0, 1].find(b => g.row[b] === 0)!, large = 1 - tiny;
    expect(g.r[tiny]).toBe(3 * 2 ** -1046);
    expect(g.r[large]).toBe(24);
    // Painted on top of the large one (smaller radius, later in painter's order), and the path stays finite.
    expect(g.rank[tiny]).toBeGreaterThan(g.rank[large]!);
    const d = paintedMap(g, 1).series[0]!.d;
    expect(d).not.toMatch(/NaN|Infinity/);
    const legend = bubbleInternals(chart)!.legend!;
    expect(legend.entries.length).toBeGreaterThan(0);
    for (const e of legend.entries) {
      expect(e.value).toBeGreaterThan(0);
      expect(e.radius).toBeGreaterThan(0);
    }
  });

  it('a subnormal radius.max draws positive sizes at MIN_VALUE, never as the zero marker', () => {
    const { rec } = open({ data: [{ x: 1, y: 1, s: 1 }, { x: 2, y: 2, s: 4 }, { x: 3, y: 3, s: 0 }], x: 'x', y: 'y', size: 's', radius: { min: 0, max: MIN } });
    const g = geometryOf(rec.draws[rec.draws.length - 1]!);
    expect(g.count).toBe(3);
    for (let b = 0; b < g.count; b++) {
      // Row 2 has size 0: the only zero marker.
      if (g.row[b] === 2) expect(g.r[b]).toBe(0);
      else expect(g.r[b]).toBe(MIN);
    }
    expect(g.reach).toBe(ZERO_RADIUS);
    expect(paintedMap(g, 1).series[0]!.d).not.toMatch(/NaN|Infinity/);
  });
  it('sizes MIN_VALUE and 2^-50 at radius { min: 0, max: 2^-560 }: chart radius and written path are 2^-1072', () => {
    const { rec } = open({ data: [{ x: 1, y: 1, s: MIN }, { x: 2, y: 2, s: 2 ** -50 }], x: 'x', y: 'y', size: 's', radius: { min: 0, max: 2 ** -560 } });
    const g = geometryOf(rec.draws[rec.draws.length - 1]!);
    expect(g.count).toBe(2);
    const tiny = [0, 1].find(b => g.row[b] === 0)!, large = 1 - tiny;
    expect(g.r[tiny]).toBe(2 ** -1072);
    expect(g.r[large]).toBe(2 ** -560);
    const d = paintedMap(g, 1).series[0]!.d;
    expect(d).not.toMatch(/NaN|Infinity/);
    // writeRadius writes 7 significant digits as the shortest round-trip string: 4 · MIN_VALUE ≈ 1.976e-323 lies
    // within half a step (≈ 2.47e-324) of 2e-323, so it writes "2e-323"; MIN_VALUE would write "5e-324".
    expect(d).toContain('a2e-323 2e-323 ');
    expect(d).not.toContain('a5e-324 ');
  });
});
