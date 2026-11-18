import fc from 'fast-check';
import { expect, it } from 'vitest';
import { at, axes, chart, expectCompact, expectGeometry, lastModel, marks, pixel, points, reading, refAt, rows } from './model';

const stacks = [['area', 'area'], ['bar', 'bar'], ['compact', 'area'], ['compact', 'bar']] as const;
const options = (kind: 'area' | 'bar') => ({ y: ['a', 'b', 'c', 'd'], ...(kind === 'area' ? { stacked: true } : { layout: 'stacked' }) });

for (const [type, kind] of stacks) {
  it(`F10 ${type}: for any generated mixed-sign ${kind} stacks each drawn component uses its own side of zero and the axis covers both sums`, () => {
    const value = fc.integer({ min: 2, max: 20 });
    fc.assert(fc.property(value, value, value, value, (a, b, c, d) => {
      const records = [{ x: 1, a, b: -b, c, d: -d }, { x: 2, a, b: -b, c, d: -d }];
      const r = chart(type, records, options(kind), undefined, kind);
      r.frames();
      const { y } = axes(r);
      const bases = [0, 0, a, -b];
      const tips = [a, -b, a + c, -b - d];
      expect(y.domain[0]).toBeLessThanOrEqual(-b - d);
      expect(y.domain[1]).toBeGreaterThanOrEqual(a + c);
      if (kind === 'bar') {
        for (const mark of marks(r, 'rects')) {
          expect(mark.variant).toBe('bar');
          expect(mark.xywh).toHaveLength(8);
          for (const offset of [0, 4]) {
            const pixelTop = mark.xywh[offset + 1]!;
            const pixelBottom = pixelTop + mark.xywh[offset + 3]!;
            const positive = tips[mark.series]! > 0;
            expect(positive ? pixelTop : pixelBottom).toBeCloseTo(y.map(tips[mark.series]!), 3);
            const base = positive ? pixelBottom : pixelTop;
            expect(Math.abs(base - y.map(bases[mark.series]!))).toBeLessThanOrEqual(1.001);
            expect(Math.sign(y.invert((pixelTop + pixelBottom) / 2))).toBe(positive ? 1 : -1);
          }
        }
      } else {
        for (const mark of marks(r, 'area')) {
          const [top, count, bottom, lowerCount] = mark.runs;
          expect([count, lowerCount]).toEqual([2, 2]);
          expectGeometry(points(mark.upper).slice(top!, top! + count!).map(p => p[1]), [y.map(tips[mark.series]!), y.map(tips[mark.series]!)]);
          expectGeometry(points(mark.lower).slice(bottom!, bottom! + lowerCount!).map(p => p[1]), [y.map(bases[mark.series]!), y.map(bases[mark.series]!)]);
        }
      }
    }), { numRuns: 1_000 });
  });

  it(`F10 ${type}: a missing ${kind} component has zero height and the reader is told which stack is incomplete${type === 'compact' ? ' (reading: the summary provides the incomplete warning)' : ''}`, () => {
    const r = chart(type, [
      { x: 1, a: 5, b: -3, c: 4, d: -2 },
      { x: 2, a: 5, b: -3, c: null, d: -2 },
      { x: 3, a: 5, b: -3, c: 4, d: -2 },
    ], options(kind), undefined, kind);
    r.frames();
    const { x, y } = axes(r);
    if (kind === 'bar') {
      const missing = marks(r, 'rects').find(mark => mark.series === 2 && mark.variant === 'missing');
      expect(missing?.xywh).toHaveLength(4);
      expectGeometry([missing!.xywh[1]!, missing!.xywh[3]!], [y.map(5), 0]);
    } else {
      const mark = marks(r, 'area').find(mark => mark.series === 2)!;
      const middle = pixel(x, 2);
      const ordinate = (xy: Float32Array) => points(xy).filter(p => Math.abs(p[0] - middle) < 0.001);
      expect(ordinate(mark.upper).some(p => Math.abs(p[1] - y.map(5)) < 0.001)).toBe(true);
      expect(ordinate(mark.lower).some(p => Math.abs(p[1] - y.map(5)) < 0.001)).toBe(true);
    }
    if (type === 'compact') {
      expectCompact(r);
      expect(lastModel(r).summary).toContain('incomplete');
    } else {
      expect(at(r, 1).total).toBe('4');
      expect(at(r, 2).total).toBe('0 (incomplete)');
      expect(at(r, 2).rows.map(row => row.value)).toEqual(['5', '-3', 'No data', '-2']);
      expect(rows(r)[1]).toEqual(['2 (incomplete)', '5', '-3', 'No data', '-2']);
      expect(reading(r, refAt(r, 2))).toContain('Total 0 (incomplete)');
      expect(lastModel(r).note).toBeNull();
    }
  });
}
