/**
 * The two ends of a range picked on the plot (spec I4, WCAG 2.5.7: a drag, or the two clicks of "Select
 * range"; review C2-8), in the pure part (src/core/focus.ts), with layouts from the DOM-free controller.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minimumWidth, pixelOf, positionAt, rangeWindow } from '../../src/core/focus';
import { record } from './host';

describe('rangeWindow: the window between two picked positions', () => {
  it('is the same in either order, clamped to the full range, and the whole range is null', () => {
    expect(rangeWindow([0, 100], 20, 60, 2)).toEqual([20, 60]);
    expect(rangeWindow([0, 100], 60, 20, 2)).toEqual([20, 60]);
    expect(rangeWindow([0, 100], -10, 30, 2)).toEqual([0, 30]);
    expect(rangeWindow([0, 100], 0, 100, 2)).toBeNull();
    expect(rangeWindow([0, 100], -5, 120, 2)).toBeNull();
  });

  it('does nothing below the smallest window, or for one position twice', () => {
    expect(rangeWindow([0, 100], 40, 41, 2)).toBeUndefined();
    expect(rangeWindow([0, 100], 40, 40, 0)).toBeUndefined();
    expect(rangeWindow([0, 100], 40, 42, 2)).toEqual([40, 42]);
  });

  it('for any two positions: ordered, inside the full range, at least the minimum wide, symmetric', () => {
    fc.assert(fc.property(fc.double({ min: -50, max: 150, noNaN: true }), fc.double({ min: -50, max: 150, noNaN: true }), fc.double({ min: 0, max: 50, noNaN: true }), (a, b, min) => {
      const w = rangeWindow([0, 100], a, b, min);
      expect(rangeWindow([0, 100], b, a, min)).toEqual(w);
      if (w) {
        expect(w[0]).toBeGreaterThanOrEqual(0);
        expect(w[1]).toBeLessThanOrEqual(100);
        expect(w[1] - w[0]).toBeGreaterThanOrEqual(min);
        expect(w[1]).toBeGreaterThan(w[0]);
      }
    }));
  });
});

describe('pixelOf is positionAt\'s inverse where drag-to-zoom applies, and absent on band axes', () => {
  it('a number line: the pixel of a position reads back as that position', () => {
    const r = record('line', { title: 'T', data: Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: i })), x: 'x', y: 'y' });
    r.frames();
    const { layout, view } = r.committed!;
    for (const x of [0, 25, 50, 99]) {
      const px = pixelOf(layout, x)!;
      expect(positionAt(layout, px, 0)).toBeCloseTo(x, 6);
    }
    expect(minimumWidth(view)).toBeGreaterThan(0);
  });

  it('a category bar chart has no position axis to pick a range on', () => {
    const r = record('bar', { title: 'T', data: [{ x: 'a', y: 1 }, { x: 'b', y: 2 }], x: 'x', y: 'y' });
    r.frames();
    const { layout } = r.committed!;
    expect(pixelOf(layout, 0)).toBeNull();
    expect(r.committed!.zoom).toBe(false);
  });
});
