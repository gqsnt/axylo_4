import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AlignedView, DatumRef } from '../../src/core/contracts';
import { buildLookup } from '../../src/lookup';
import { defaultMessages } from '../../src/messages';
import { bandScale, linearScale } from '../../src/scale';
import { aligned, formatter, frame, plot } from './fixtures';

const datum = (seriesKey: string, x: number): DatumRef => ({ kind: 'aligned', seriesKey, x });

function lookup(view: AlignedView) {
  const layout = plot({ kind: 'xy', x: linearScale(view.xDomain, [0, 100]), y: linearScale(view.yDomain, [100, 0]) });
  return buildLookup(view, layout, formatter(view.frame), defaultMessages);
}

describe('aligned picking', () => {
  it('uses only visible slots, includes both plot edges, and gives midpoints to the later slot', () => {
    // An irregular step keeps normalization from inserting missing slots between 20 and 50.
    const data = frame('line', { data: [0, 10, 20, 50, 61].map(x => ({ x, y: 10 })), x: 'x', y: 'y' });
    const model = lookup(aligned(data, { visibleSlots: { start: 1, end: 4 }, xDomain: [0, 50] }));
    expect(model.pick(0, 0)).toEqual({ kind: 'x', x: 10 });
    expect(model.pick(29.99, 90)).toEqual({ kind: 'x', x: 10 });
    expect(model.pick(30, 90)).toEqual({ kind: 'x', x: 20 });
    expect(model.pick(70, 10)).toEqual({ kind: 'x', x: 50 });
    expect(model.pick(100, 100)).toEqual({ kind: 'x', x: 50 });
    for (const [x, y] of [[-0.1, 50], [100.1, 50], [50, -0.1], [50, 100.1]] as const) expect(model.pick(x, y)).toBeNull();
  });

  it('picks a horizontal bar by y and returns the grouped mark bounds', () => {
    const data = frame('bar', { data: [{ x: 'A', a: 2, b: 3 }, { x: 'B', a: 4, b: 5 }], x: 'x', y: ['a', 'b'] });
    const view = aligned(data, { kind: 'bar', horizontal: true });
    const layout = plot({ kind: 'bands', horizontal: true, band: bandScale(2, [100, 0], 0), value: linearScale([0, 10], [0, 100]) });
    const model = buildLookup(view, layout, formatter(data), defaultMessages);
    expect(model.pick(80, 75)).toEqual({ kind: 'x', x: 0 });
    expect(model.pick(20, 25)).toEqual({ kind: 'x', x: 1 });
    expect(model.anchor(datum('a', 0))).toEqual({ x: 0, y: 50, width: 20, height: 25 });
    expect(model.anchor(datum('b', 1))).toEqual({ x: 0, y: 25, width: 50, height: 25 });
  });
});

describe('aligned readout and steps', () => {
  const data = frame('line', { x: 'x', y: { field: 'y', unit: 'ms' }, series: 'series', data: [
    { x: 0, y: 10, series: 'A' }, { x: 1, y: 20, series: 'B' }, { x: 0, y: null, series: 'C' },
    { x: 2, y: 30, series: 'A' }, { x: 2, y: 40, series: 'B' },
  ] });

  it('reads values, absent observations, and explicit nulls in series order', () => {
    const model = lookup(aligned(data));
    const target = { kind: 'x', x: 0 } as const;
    const tooltip = model.tooltip(target);
    expect(tooltip).toMatchObject({ title: '0', count: 3, total: null });
    expect(tooltip.rows.map(({ seriesLabel, value, row }) => [seriesLabel, value, row])).toEqual([
      ['A', '10 ms', 0], ['B', 'No observation', -1], ['C', 'No data', 2],
    ]);
    expect(model.primary(target)).toEqual(datum('A', 0));
    expect(model.primary({ kind: 'x', x: 1 })).toEqual(datum('B', 1));
    expect(model.anchor(datum('B', 0))).toBeNull();
    const hidden = lookup(aligned(data, { visible: [false, true, true] }));
    expect(hidden.tooltip(target).rows.map(row => row.seriesLabel)).toEqual(['B', 'C']);
    expect(hidden.primary(target)).toEqual(datum('B', 0));
  });

  it('counts all nine series but returns only the first eight tooltip rows', () => {
    const series = Array.from({ length: 9 }, (_, i) => ({ x: 0, y: i, key: `S${i}` }));
    const model = lookup(aligned(frame('line', { data: series, x: 'x', y: 'y', series: 'key' })));
    const { rows, count } = model.tooltip({ kind: 'x', x: 0 });
    expect(count).toBe(9);
    expect(rows.map(row => row.seriesLabel)).toEqual(series.slice(0, 8).map(row => row.key));
  });

  it('formats stacked totals and preserves the incomplete marker for announcements', () => {
    const stacked = frame('area', { data: [{ x: 0, a: 3, b: null, c: -2 }, { x: 1, a: 3, b: 4, c: -2 }], x: 'x', y: ['a', 'b', 'c'] });
    const model = lookup(aligned(stacked, { kind: 'area', stack: {
      order: [0, 1, 2], incomplete: Uint8Array.of(1, 0),
      positive: [Float64Array.of(3, 3), Float64Array.of(3, 7), Float64Array.of(3, 7)],
      negative: [Float64Array.of(0, 0), Float64Array.of(0, 0), Float64Array.of(-2, -2)],
    } }));
    expect(model.tooltip({ kind: 'x', x: 0 }).total).toBe('1 (incomplete)');
    expect(model.tooltip({ kind: 'x', x: 0 }).rows[1]?.value).toBe('No data');
    expect(model.tooltip({ kind: 'x', x: 1 }).total).toBe('5');
    expect(model.datum(datum('b', 0))?.value).toBe('No data (incomplete)');
  });

  it('steps within a series, switches series at the same x, and ranks by x then series', () => {
    const model = lookup(aligned(data));
    expect(model.step(null, 'next')).toEqual(datum('A', 0));
    expect(model.step(datum('A', 0), 'next')).toEqual(datum('A', 2));
    expect(model.step(datum('A', 2), 'previous')).toEqual(datum('A', 0));
    expect(model.step(datum('A', 0), 'series-next')).toEqual(datum('B', 0));
    expect(model.step(datum('B', 0), 'series-previous')).toEqual(datum('A', 0));
    expect(model.datum(datum('B', 0))?.value).toBe('No observation');
    expect(model.ordinal(datum('B', 0))).toBe(-1);
    expect(model.step(datum('B', 0), 'first')).toEqual(datum('B', 1));
    expect(model.step(datum('B', 1), 'last')).toEqual(datum('B', 2));
    expect([datum('A', 0), datum('B', 1), datum('A', 2), datum('B', 2)].map(ref => model.ordinal(ref))).toEqual([0, 1, 2, 3]);
    expect(model.count).toBe(4);
  });

  it('pages by a tenth of the visible slots, then skips a gap in the direction of travel', () => {
    const data = frame('line', { data: Array.from({ length: 50 }, (_, x) => ({ x, y: x === 11 ? null : x })), x: 'x', y: 'y' });
    const model = lookup(aligned(data, { visibleSlots: { start: 8, end: 28 } }));
    expect(model.step(datum('y', 9), 'page-next')).toEqual(datum('y', 12));
    expect(model.step(datum('y', 13), 'page-previous')).toEqual(datum('y', 10));
    expect(model.step(datum('y', 13), 'first')).toEqual(datum('y', 8));
    expect(model.step(datum('y', 13), 'last')).toEqual(datum('y', 27));
    expect(model.step(datum('y', 27), 'page-next')).toBeNull();
  });

  it('walks every observation of the visible series with the correct identity and ordinal', () => {
    fc.assert(fc.property(fc.array(fc.option(fc.integer({ min: 0, max: 99 }), { nil: null }), { maxLength: 50 }),
      fc.nat(50), fc.nat(50), (values, a, b) => {
        const start = Math.min(a, b, values.length);
        const end = Math.min(Math.max(a, b), values.length);
        const data = frame('line', { data: values.map((y, x) => ({ x, y, hidden: 1 })), x: 'x', y: ['y', 'hidden'] });
        const model = lookup(aligned(data, { visibleSlots: { start, end }, visible: [true, false] }));
        const expected = values.flatMap((value, x) => value !== null && x >= start && x < end ? [x] : []);
        expect(model.count).toBe(expected.length);
        let current = model.step(null, 'next');
        for (const [ordinal, x] of expected.entries()) {
          expect(current).toEqual(datum('y', x));
          expect(model.ordinal(current!)).toBe(ordinal);
          expect(model.datum(current!)).not.toBeNull();
          expect(model.resolve(current!)).toBe(current);
          current = model.step(current, 'next');
        }
        expect(current).toBeNull();
      }), { numRuns: 100 });
  });

  it('resolves identity across eviction and anchors a survivor at its new pixel', () => {
    function window(start: number, revision: number) {
      const first = frame('line', { data: Array.from({ length: 11 }, (_, i) => ({ x: start + i, y: 20 })), x: 'x', y: 'y' }, revision);
      // Retained source rows keep their original indexes across an append in the same epoch.
      return lookup(aligned({ ...first, series: first.series.map(s => ({ ...s, row: Int32Array.from(s.y, (_, i) => start + i) })) }));
    }
    const first = window(0, 1);
    const second = window(5, 2);
    const surviving = datum('y', 7);
    const evicted = datum('y', 3);
    expect(second.resolve(surviving)).toBe(surviving);
    expect(second.datum(surviving)).toEqual(first.datum(surviving));
    expect(second.datum(evicted)).toBeNull();
    expect(second.resolve(evicted)).toEqual(datum('y', 5));
    expect(second.resolve(datum('y', 17))).toEqual(datum('y', 15));
    expect(first.anchor(surviving)).toEqual({ x: 70, y: 80, width: 0, height: 0 });
    expect(second.anchor(surviving)).toEqual({ x: 20, y: 80, width: 0, height: 0 });
  });
});
