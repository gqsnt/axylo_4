/**
 * N8b renderer: the unhovered picture of the per-series paths equals the painter's order (oracle.ts).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GAP } from '../../../src/spatial/bubble/paint';
import { checkPicture, type Disc } from './oracle';

describe('per-series visible paths (unhovered picture oracle)', () => {
  it('alternating concentric series: every ring is painted by its own series, largest first, in two paths', () => {
    // A ⊃ B ⊃ A ⊃ B …: the case one path of whole circles per series cannot paint.
    const discs: Disc[] = [];
    for (let k = 0; k < 12; k++) discs.push({ x: 100, y: 100, r: 24 - 2 * k, series: k % 2, row: k });
    const { wrong, map } = checkPicture(discs, 2, 11);
    expect(wrong).toEqual([]);
    expect(map.series).toHaveLength(2);
    expect(map.series.every(s => s.open === 0)).toBe(true);
    // The same picture whatever order the rows come in.
    const reversed = discs.map((d, i) => ({ ...d, row: 11 - i }));
    expect(checkPicture(reversed.reverse(), 2, 12).wrong).toEqual([]);
  });

  it('partially intersecting discs of three interleaved series, equal discs, tangencies and zero rings', () => {
    const discs: Disc[] = [
      { x: 60, y: 60, r: 20, series: 0, row: 0 },
      { x: 80, y: 60, r: 14, series: 1, row: 1 },
      { x: 70, y: 72, r: 9, series: 2, row: 2 },
      { x: 72, y: 66, r: 5, series: 0, row: 3 },
      // equal discs: the later row is on top and is the only one painted
      { x: 130, y: 60, r: 12, series: 0, row: 4 },
      { x: 130, y: 60, r: 12, series: 1, row: 5 },
      // external and internal tangency
      { x: 60, y: 130, r: 10, series: 1, row: 6 },
      { x: 60 + 10 + 6 + GAP, y: 130, r: 6, series: 2, row: 7 },
      { x: 60 + 10 - 4, y: 130, r: 4, series: 0, row: 8 },
      // zero markers over a disc of another series and over one of their own
      { x: 140, y: 140, r: 18, series: 0, row: 9 },
      { x: 140, y: 140, r: 0, series: 1, row: 10 },
      { x: 146, y: 140, r: 0, series: 0, row: 11 },
      { x: 143, y: 140, r: 0, series: 2, row: 12 },
    ];
    const { wrong, map } = checkPicture(discs, 3, 5, 200, 4000);
    expect(wrong).toEqual([]);
    expect(map.series.every(s => s.open === 0)).toBe(true);
  });

  it('for any discs and zero markers of up to three series, the paths paint the painter\'s order (property)', () => {
    const disc = fc.record({
      x: fc.integer({ min: 20, max: 80 }).map(v => v + 0.25), y: fc.integer({ min: 20, max: 80 }).map(v => v + 0.5),
      r: fc.oneof(fc.constant(0), fc.integer({ min: 2, max: 24 })), series: fc.integer({ min: 0, max: 2 }),
    });
    fc.assert(fc.property(fc.array(disc, { minLength: 1, maxLength: 18 }), fc.integer({ min: 1, max: 1000 }), (list, seed) => {
      const discs = list.map((d, row) => ({ ...d, row }));
      const { wrong, map } = checkPicture(discs, 3, seed, 100, 600);
      expect(wrong).toEqual([]);
      expect(map.series.reduce((n, s) => n + s.open, 0)).toBe(0);
    }), { numRuns: 120 });
  });

  it('for any float32 positions and radii of up to four series, likewise (property)', () => {
    const disc = fc.record({
      x: fc.double({ min: 30, max: 70, noNaN: true }), y: fc.double({ min: 30, max: 70, noNaN: true }),
      r: fc.oneof(fc.constant(0), fc.double({ min: 2, max: 24, noNaN: true }), fc.integer({ min: 2, max: 24 })), series: fc.integer({ min: 0, max: 3 }),
    });
    fc.assert(fc.property(fc.array(disc, { minLength: 1, maxLength: 40 }), fc.integer({ min: 1, max: 1000 }), (list, seed) => {
      const discs = list.map((d, row) => ({ ...d, x: Math.fround(d.x), y: Math.fround(d.y), r: Math.fround(d.r), row }));
      const { wrong, map } = checkPicture(discs, 4, seed, 100, 800);
      expect(wrong).toEqual([]);
      expect(map.series.reduce((n, s) => n + s.open, 0)).toBe(0);
    }), { numRuns: 200 });
  }, 120_000);
});

