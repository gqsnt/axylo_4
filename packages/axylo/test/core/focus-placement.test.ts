/**
 * Decision 0004 revision 3, rules 1, 2, 3b, 6 and 10, in the pure placement arithmetic (src/dom/placement.ts)
 * and in the pure helpers of the interaction layer (src/core/focus.ts). The placement cases are the ones the
 * final review ran against the old function (reviews/2026-11-18/impl/wp/core-final.interaction.review.md,
 * "Placement arithmetic I ran"); the expected positions are derived here from the rules, by hand, in the
 * comments beside them.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Rect } from '../../src/core/contracts';
import { fallbackPlacement, insideCorridor, OFFSET, overlapArea, placeTooltip, validSpot, type PlacementInput } from '../../src/dom/placement';
import { pinchWidth } from '../../src/core/focus';
import { parseNumberAs } from '../../src/dom/interaction';

/** A 300 × 200 plot whose focus outline reaches 4 px in: the visible part is (4, 4, 292, 192). */
const VISIBLE: Rect = { x: 4, y: 4, width: 292, height: 192 };
/** A point datum's box: the point enlarged by the ring's reach of 10 px. */
const point = (x: number, y: number): Rect => ({ x: x - 10, y: y - 10, width: 20, height: 20 });

function input(box: Rect, extra: Partial<PlacementInput> = {}): PlacementInput {
  return { box, visible: VISIBLE, order: 'vertical', hole: null, controls: [], rings: [], ringStroke: 4, ...extra };
}

const rect = (spot: { x: number; y: number }, width: number, height: number): Rect => ({ x: spot.x, y: spot.y, width, height });

describe('rule 2: candidates in order, centred and shifted only as far as needed', () => {
  it('a 100 × 40 tooltip for a point at each corner of the plot goes below or above it, pushed inside along x', () => {
    // Top-left (0, 0): above would start at -10 - 8 - 40 < 4; below starts at 10 + 8 = 18; centred x is
    // 0 - 50, shifted to the visible left edge 4. Top-right: x shifted to 296 - 100 = 196. Bottom corners:
    // above at 190 - 8 - 40 = 142.
    expect(placeTooltip(input(point(0, 0)), 100, 40)).toMatchObject({ x: 4, y: 18, side: 'below' });
    expect(placeTooltip(input(point(300, 0)), 100, 40)).toMatchObject({ x: 196, y: 18, side: 'below' });
    expect(placeTooltip(input(point(0, 200)), 100, 40)).toMatchObject({ x: 4, y: 142, side: 'above' });
    expect(placeTooltip(input(point(300, 200)), 100, 40)).toMatchObject({ x: 196, y: 142, side: 'above' });
  });

  it('a full-height box sends the tooltip to its right, centred on it; a full-width horizontal bar sends it above', () => {
    // Box x 110–130 over the whole height: no room above or below; right at 130 + 8, centred y 100 - 20.
    const tall: Rect = { x: 110, y: -10, width: 20, height: 220 };
    expect(placeTooltip(input(tall), 100, 40)).toMatchObject({ x: 138, y: 80, side: 'right' });
    // Horizontal bars try right and left first; a bar across the whole width leaves neither, so above:
    // y = 75 - 8 - 40, centred x 150 - 50.
    const wide: Rect = { x: -10, y: 75, width: 320, height: 30 };
    expect(placeTooltip(input(wide, { order: 'horizontal' }), 100, 40)).toMatchObject({ x: 100, y: 27, side: 'above' });
  });

  it('a control where the side candidate would go: the tooltip shifts along that side clear of it, it does not cover it', () => {
    const tall: Rect = { x: 110, y: -10, width: 20, height: 220 };
    const controls = [{ x: 140, y: 70, width: 60, height: 60 }, { x: 0, y: 70, width: 100, height: 60 }];
    const spot = placeTooltip(input(tall, { controls }), 100, 40)!;
    expect(spot.side).toBe('right');
    expect(spot.x).toBe(138);
    // The nearest clear positions along y are 70 - 40 = 30 and 130; both are 50 from the centred 80.
    expect([30, 130]).toContain(spot.y);
    for (const c of controls) expect(overlapArea(rect(spot, 100, 40), c)).toBe(0);
  });

  it('an ancestor that shows only x 80–220: the preferred candidate above is shifted to x 80, not abandoned', () => {
    // Point at (80, 110): above at 100 - 8 - 40 = 52, centred x 30, shifted to the visible left edge 80.
    const visible = { x: 80, y: 4, width: 140, height: 192 };
    expect(placeTooltip(input(point(80, 110), { visible }), 100, 40)).toMatchObject({ x: 80, y: 52, side: 'above' });
  });

  it('a tooltip wider than the visible part is never placed, by the rules or by the last resort', () => {
    // The layer limits the tooltip's width to the visible part (it wraps), so 320 px never reaches here; if
    // it did, nothing would be placed rather than a rectangle 28 px past the edge.
    expect(placeTooltip(input(point(150, 100)), 320, 40)).toBeNull();
    expect(fallbackPlacement(input(point(150, 100)), 320, 40)).toBeNull();
    const wrapped = placeTooltip(input(point(150, 100)), 292, 40)!;
    expect(validSpot(input(point(150, 100)), wrapped, 292, 40)).toBe(true);
  });

  it('a keyboard ring elsewhere is kept clear like the datum (review finding 10)', () => {
    // Hovering B at (150, 150) while A's ring is at (150, 80): above B would be (100, 92–132), over A's ring.
    const ringA: Rect = { x: 136, y: 66, width: 28, height: 28 };
    const spot = placeTooltip(input(point(150, 150), { rings: [ringA] }), 100, 40)!;
    expect(overlapArea(rect(spot, 100, 40), ringA)).toBe(0);
    expect(overlapArea(rect(spot, 100, 40), point(150, 150))).toBe(0);
  });

  it('for any box, controls and rings, a placed tooltip is inside the visible part and covers none of them', () => {
    const r = (max: number) => fc.record({ x: fc.integer({ min: -20, max }), y: fc.integer({ min: -20, max: 220 }), width: fc.integer({ min: 0, max: 120 }), height: fc.integer({ min: 0, max: 120 }) });
    fc.assert(fc.property(r(300), fc.array(r(300), { maxLength: 4 }), fc.array(r(300), { maxLength: 2 }), fc.integer({ min: 20, max: 200 }), fc.integer({ min: 10, max: 100 }),
      (box, controls, rings, w, h) => {
        const p = input(box, { controls, rings });
        const spot = placeTooltip(p, w, h);
        if (spot) expect(validSpot(p, spot, w, h)).toBe(true);
        const last = fallbackPlacement(p, w, h);
        if (last) {
          const t = rect(last, w, h);
          expect(t.x).toBeGreaterThanOrEqual(VISIBLE.x - 1e-6);
          expect(t.y).toBeGreaterThanOrEqual(VISIBLE.y - 1e-6);
          expect(t.x + w).toBeLessThanOrEqual(VISIBLE.x + VISIBLE.width + 1e-6);
          expect(t.y + h).toBeLessThanOrEqual(VISIBLE.y + VISIBLE.height + 1e-6);
          for (const c of [...controls, ...rings]) expect(overlapArea(t, c)).toBe(0);
        }
      }));
  });
});

describe('rule 6: the last resort covers the box least and never a control or a focus ring', () => {
  it('with the box over the whole plot and controls on every side, it shifts along a free axis clear of the controls', () => {
    const box: Rect = { x: -10, y: -10, width: 320, height: 220 };
    const controls = [{ x: 4, y: 4, width: 292, height: 30 }, { x: 4, y: 166, width: 292, height: 30 }];
    expect(placeTooltip(input(box, { controls }), 100, 40)).toBeNull();
    const spot = fallbackPlacement(input(box, { controls }), 100, 40)!;
    expect(spot).not.toBeNull();
    for (const c of controls) expect(overlapArea(rect(spot, 100, 40), c)).toBe(0);
  });

  it('when no position is clear of the controls, nothing is placed', () => {
    const box: Rect = { x: -10, y: -10, width: 320, height: 220 };
    const controls = [{ x: 0, y: 0, width: 300, height: 200 }];
    expect(fallbackPlacement(input(box, { controls }), 100, 40)).toBeNull();
  });
});

describe('rule 2: a donut\'s hole is tried first, by the tooltip\'s four corners against the inner radius', () => {
  // A hole of 96 px diameter at (150, 100); the slice's inner outline keeps 5 px: corners within 43 px.
  const hole = { cx: 150, cy: 100, rx: 43, ry: 43 };
  it('a 160 × 30 tooltip does not fit the hole and is not put there', () => {
    const slice: Rect = { x: 190, y: 40, width: 60, height: 60 };
    const spot = placeTooltip(input(slice, { hole }), 160, 30);
    expect(spot?.side).not.toBe('hole');
  });

  it('a 40 × 20 tooltip that fits goes in the hole although the selected slice\'s box encloses the centre', () => {
    // A 99 % slice's bounding box covers the whole ring, hole included: the hole is the exception to it.
    const slice: Rect = { x: 50, y: 0, width: 200, height: 200 };
    expect(placeTooltip(input(slice, { hole }), 40, 20)).toMatchObject({ x: 130, y: 90, side: 'hole' });
  });

  it('a keyboard ring stroke crossing the hole keeps the tooltip out of it', () => {
    const slice: Rect = { x: 50, y: 0, width: 200, height: 200 };
    const ring: Rect = { x: 140, y: 60, width: 60, height: 80 };
    expect(placeTooltip(input(slice, { hole, rings: [ring] }), 40, 20)?.side).not.toBe('hole');
  });
});

describe('rule 3b: the corridor is the convex hull of the resting point and the content\'s rectangle', () => {
  const r: Rect = { x: 200, y: 50, width: 80, height: 40 };
  it('holds on the straight way to the rectangle and inside it, and not beside the way', () => {
    const from = { x: 100, y: 150 };
    for (let k = 0; k <= 20; k++) {
      const t = k / 20;
      expect(insideCorridor(from, r, { x: from.x + (220 - from.x) * t, y: from.y + (70 - from.y) * t })).toBe(true);
    }
    expect(insideCorridor(from, r, { x: 240, y: 70 })).toBe(true);
    expect(insideCorridor(from, r, { x: 100, y: 60 })).toBe(false);
    expect(insideCorridor(from, r, { x: 99, y: 151 })).toBe(false);
  });

  it('for any rectangle and resting point, every point on the segment to any point of the rectangle is inside', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 400 }), fc.integer({ min: 0, max: 400 }), fc.integer({ min: 1, max: 200 }), fc.integer({ min: 1, max: 200 }),
      fc.integer({ min: -100, max: 600 }), fc.integer({ min: -100, max: 600 }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }),
      (x, y, w, h, fx, fy, u, v, t) => {
        const box = { x, y, width: w, height: h };
        const to = { x: x + u * w, y: y + v * h };
        const at = { x: fx + (to.x - fx) * t, y: fy + (to.y - fy) * t };
        expect(insideCorridor({ x: fx, y: fy }, box, at)).toBe(true);
      }));
  });
});

describe('review C3-7: a pinch never zooms the wrong way', () => {
  it('spreading the fingers on a window below the smallest width leaves it as it is', () => {
    // Window [40, 45] (width 5) with a minimum of 20: spreading (factor < 1) must not impose 20.
    expect(pinchWidth(5, 0.5, 20)).toBe(5);
    expect(pinchWidth(5, 2, 20)).toBe(20);
  });

  it('for any start, factor and minimum, spreading never widens and pinching never narrows', () => {
    fc.assert(fc.property(fc.double({ min: 1e-3, max: 1e3, noNaN: true }), fc.double({ min: 0.05, max: 20, noNaN: true }), fc.double({ min: 0, max: 100, noNaN: true }), (start, factor, min) => {
      const width = pinchWidth(start, factor, min);
      if (factor < 1) expect(width).toBeLessThanOrEqual(start);
      if (factor > 1) expect(width).toBeGreaterThanOrEqual(start);
    }));
  });
});

describe('review C2-18: "Jump to" reads a number in the column\'s own format', () => {
  const en = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(n);
  it('rejects trailing text, accepts the unit the column writes, and needs grouping where the column groups', () => {
    const x = (n: number) => `${en(n)} ms`;
    expect(parseNumberAs('12garbage', x, en)).toBeNull();
    expect(parseNumberAs('12 ms extra', x, en)).toBeNull();
    expect(parseNumberAs('12 ms', x, en)).toBe(12);
    expect(parseNumberAs('12', x, en)).toBe(12);
    expect(parseNumberAs('1,234.5 ms', x, en)).toBe(1234.5);
    expect(parseNumberAs('1234.5', x, en)).toBe(1234.5);
    expect(parseNumberAs('1,2,34', x, en)).toBeNull();
    expect(parseNumberAs('-3', x, en)).toBe(-3);
  });

  it('reads Indian grouping and Arabic-Indic digits as their own locales write them', () => {
    const inFmt = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(n);
    expect(parseNumberAs('12,34,567.5', inFmt, inFmt)).toBe(1234567.5);
    expect(parseNumberAs('1,234,567.5', inFmt, inFmt)).toBeNull();
    const ar = (n: number) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 3 }).format(n);
    expect(parseNumberAs(ar(1234.5), ar, ar)).toBe(1234.5);
    expect(parseNumberAs(ar(42), ar, ar)).toBe(42);
  });

  it('a German column: comma decimal, point grouping', () => {
    const de = (n: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 }).format(n);
    expect(parseNumberAs('1.234,5', de, de)).toBe(1234.5);
    expect(parseNumberAs('1234,5', de, de)).toBe(1234.5);
    expect(parseNumberAs('1,234.5', de, de)).toBeNull();
  });
});

describe('the reviewer\'s offset is the decision\'s', () => {
  it('OFFSET is 8 px', () => expect(OFFSET).toBe(8));
});
