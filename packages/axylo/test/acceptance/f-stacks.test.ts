import fc from 'fast-check';
import { expect, it } from 'vitest';
import { at, axes, chart, expectCompact, expectGeometry, lastModel, marks, message, pixel, points, reading, refAt, rows, defaultMessages } from './model';

const stacks = [['area', 'area'], ['bar', 'bar'], ['compact', 'area'], ['compact', 'bar']] as const;
const options = (kind: 'area' | 'bar') => ({ y: ['a', 'b', 'c', 'd'], ...(kind === 'area' ? { stacked: true } : { layout: 'stacked' }) });

for (const [type, kind] of stacks) {
  it(`F10 ${type}: for any generated mixed-sign ${kind} stacks each drawn component uses its own side of zero and the axis covers both sums`, () => {
    const value = fc.oneof(fc.integer({ min: -20, max: 20 }), fc.constant(0), fc.constant(null));
    const cells = fc.tuple(value, value, value, value);
    fc.assert(fc.property(cells, cells, ([a, b, c, d], [e, f, g, h]) => {
      const records = [
        { x: 1, a: 7, b: -4, c: 2, d: -3 }, { x: 2, a, b, c, d },
        { x: 3, a: -6, b: 5, c: -8, d: 6 }, { x: 4, a: e, b: f, c: g, d: h },
        { x: 5, a: 5, b: -3, c: 0, d: null },
      ];
      const r = chart(type, records, options(kind), undefined, kind);
      r.frames();
      const { x, y } = axes(r);
      const components = records.map(row => {
        let positive = 0;
        let negative = 0;
        return [row.a, row.b, row.c, row.d].map(value => {
          const base = (value ?? 0) < 0 ? negative : positive;
          if ((value ?? 0) < 0) negative += value!;
          else positive += value ?? 0;
          return { value, base, tip: base + (value ?? 0), positive, negative };
        });
      });
      expect(y.domain[0]).toBeLessThanOrEqual(Math.min(...components.map(row => row[3]!.negative)));
      expect(y.domain[1]).toBeGreaterThanOrEqual(Math.max(...components.map(row => row[3]!.positive)));
      const indexAt = (px: number) => records.findIndex(row => Math.abs(pixel(x, row.x) - px) < 0.001);
      if (kind === 'bar') {
        expect(marks(r, 'rects').reduce((n, mark) => n + mark.xywh.length / 4, 0)).toBe(records.length * 4);
        for (const mark of marks(r, 'rects')) {
          for (let i = 0; i < mark.xywh.length; i += 4) {
            const cell = components[indexAt(mark.xywh[i]! + mark.xywh[i + 2]! / 2)]![mark.series]!;
            const top = mark.xywh[i + 1]!;
            const bottom = top + mark.xywh[i + 3]!;
            expect(mark.variant).toBe(cell.value === null ? 'missing' : 'bar');
            if (cell.value === null) {
              expect(top).toBe(bottom);
              continue;
            }
            const tip = cell.tip < cell.base ? bottom : top;
            const base = cell.tip < cell.base ? top : bottom;
            expect(tip).toBeCloseTo(y.map(cell.tip), 3);
            expect(Math.abs(base - y.map(cell.base))).toBeLessThanOrEqual(1.001);
            if (!cell.value) expect(top).toBe(bottom);
          }
        }
      } else {
        const bands = marks(r, 'area');
        expect(bands).toHaveLength(4);
        for (const mark of bands) {
          const upper = points(mark.upper);
          const lower = points(mark.lower);
          expect(mark.runs).toHaveLength(8);
          for (const [side, offset] of [['positive', 0], ['negative', 4]] as const) {
            const [start, count, base, baseCount] = mark.runs.slice(offset, offset + 4);
            expect([count, baseCount]).toEqual([records.length, records.length]);
            expectGeometry(upper.slice(start!, start! + count!).map(p => p[1]), components.map(row => y.map(row[mark.series]![side])));
            expectGeometry(lower.slice(base!, base! + baseCount!).map(p => p[1]),
              components.map(row => y.map(row[mark.series - 1]?.[side] ?? 0)));
          }
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
      // The summary names the incomplete stack by its position (one stack: incompleteAt).
      expect(lastModel(r).summary).toContain(message('incompleteAt', { label: 'x', positions: '2' }));
      expect(lastModel(r).summary).not.toContain(message('incompleteAt', { label: 'x', positions: '1' }));
    } else {
      expect(at(r, 2).rows.map(row => row.value)).toEqual(['5', '-3', 'No data', '-2']);
      // The tooltip's total is marked incomplete where a component is missing, and only there.
      const mixed = (positive: number, negative: number) => message('totalMixed', { positive, negative });
      expect(at(r, 2).total).toBe(`${mixed(5, -5)} (${defaultMessages.incompleteStack})`);
      expect(at(r, 1).total).toBe(mixed(9, -5));
      expect(rows(r)[1]).toEqual(['2 (incomplete)', '5', '-3', 'No data', '-2']);
      const announced = reading(r, refAt(r, 2));
      expect(announced).toContain(defaultMessages.incompleteStack);
      const spokenTotals = announced?.split(defaultMessages.total)[1]?.split(defaultMessages.incompleteStack)[0];
      expect.soft(spokenTotals?.match(/-?\d+/g)?.map(Number)).toEqual(expect.arrayContaining([5, -5]));
      for (const [x, positive, negative] of [[1, 9, -5], [2, 5, -5]] as const) {
        const total = at(r, x).total;
        const totals = total?.match(/-?\d+/g)?.map(Number);
        expect.soft(totals, 'the mixed-sign stack readout gives both sides').toEqual(expect.arrayContaining([positive, negative]));
      }
      expect(lastModel(r).note).toBeNull();
    }
  });
}

for (const kind of ['area', 'bar'] as const) {
  it(`F10 ${kind}: the readout's total of an all-negative stack is its sum`, () => {
    const r = chart(kind, [{ x: 1, a: -3, b: -5 }, { x: 2, a: -1, b: -2 }], { y: ['a', 'b'], ...(kind === 'area' ? { stacked: true } : { layout: 'stacked' }) });
    r.frames();
    // Every component has the same sign: the total is the sum, -8 and -3 (F10).
    expect(at(r, 1).total).toBe('-8');
    expect(at(r, 2).total).toBe('-3');
    expect(reading(r, refAt(r, 1))).toContain(message('seriesValue', { series: defaultMessages.total, value: '-8' }));
  });
}
