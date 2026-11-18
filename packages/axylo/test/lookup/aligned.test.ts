import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AlignedView, DatumRef } from '../../src/core/contracts';
import { buildLookup } from '../../src/lookup';
import { defaultMessages, pointOf } from '../../src/messages';
import { bandScale, linearScale } from '../../src/scale';
import { buildStack } from '../../src/view/stack';
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
    // Decision 0004 (clarifications): up to 1 CSS px outside picks as on the edge; further out, nothing.
    expect(model.pick(-0.1, 50)).toEqual(model.pick(0, 50));
    expect(model.pick(100.1, 50)).toEqual(model.pick(100, 50));
    for (const [x, y] of [[-1.01, 50], [101.01, 50], [50, -1.01], [50, 101.01]] as const) expect(model.pick(x, y)).toBeNull();
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
    expect(model.tooltip({ kind: 'x', x: 0 }).total).toBe('3 and -2 (incomplete)');
    expect(model.tooltip({ kind: 'x', x: 0 }).rows[1]?.value).toBe('No data');
    expect(model.tooltip({ kind: 'x', x: 1 }).total).toBe('7 and -2');
    expect(model.datum(datum('b', 0))?.value).toBe('No data (incomplete)');
  });

  it('uses the author’s mixed total format and leaves same-sign and all-zero totals plain', () => {
    const data = frame('bar', { data: [
      { x: 0, a: -3, b: -1 }, { x: 1, a: 0, b: 0 }, { x: 2, a: 3, b: -1 },
    ], x: 'x', y: ['a', 'b'] });
    const view = aligned(data, { kind: 'bar', stack: buildStack(data, [true, true]) });
    const layout = plot({ kind: 'xy', x: linearScale([0, 2], [0, 100]), y: linearScale([-4, 3], [100, 0]) });
    const model = buildLookup(view, layout, formatter(data), { ...defaultMessages, totalMixed: '{negative} bis {positive}' });
    expect(model.tooltip({ kind: 'x', x: 0 }).total).toBe('-4');
    expect(model.tooltip({ kind: 'x', x: 1 }).total).toBe('0');
    expect(model.tooltip({ kind: 'x', x: 2 }).total).toBe('-1 bis 3');
  });

  it('steps within a series, switches series at the same x, and ranks by visible slot', () => {
    const model = lookup(aligned(data));
    expect(model.step(null, 'next')).toEqual(datum('A', 0));
    expect(model.step(datum('A', 0), 'next')).toEqual(datum('A', 2));
    expect(model.step(datum('A', 2), 'previous')).toEqual(datum('A', 0));
    expect(model.step(datum('A', 0), 'series-next')).toEqual(datum('B', 0));
    expect(model.step(datum('B', 0), 'series-previous')).toEqual(datum('A', 0));
    expect(model.datum(datum('B', 0))?.value).toBe('No observation');
    expect(model.ordinal(datum('B', 0))).toBe(0);
    const formatters = { ...formatter(data), count: (n: number) => `count(${n})` };
    expect(pointOf(model, datum('B', 0), formatters, defaultMessages))
      .toBe('B, 0, No observation. Point count(1) of count(3).');
    expect(pointOf(model, datum('B', -1), formatters, defaultMessages)).toBeNull();
    expect(model.step(datum('B', 0), 'first')).toEqual(datum('B', 1));
    expect(model.step(datum('B', 1), 'last')).toEqual(datum('B', 2));
    expect([datum('A', 0), datum('B', 1), datum('A', 2), datum('B', 2)].map(ref => model.ordinal(ref))).toEqual([0, 1, 2, 2]);
    expect(model.count).toBe(3);
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

  it('assigns the same visible-slot ordinal across series and skips a hidden middle series', () => {
    const value = fc.option(fc.integer({ min: 0, max: 99 }), { nil: null });
    fc.assert(fc.property(fc.array(fc.tuple(value, value), { minLength: 2, maxLength: 50 }),
      fc.nat(50), fc.nat(50), (values, a, b) => {
        const start = Math.min(a % values.length, b % values.length);
        const end = Math.max(a % values.length, b % values.length) + 1;
        const data = frame('line', { data: values.map(([a, b], x) => ({ x, a, hidden: 1, b })), x: 'x', y: ['a', 'hidden', 'b'] });
        const model = lookup(aligned(data, { visibleSlots: { start, end }, visible: [true, false, true] }));
        expect(model.count).toBe(end - start);
        for (let x = start; x < end; x++) {
          const first = datum('a', x);
          const second = datum('b', x);
          expect(model.step(first, 'series-next')).toEqual(second);
          expect(model.ordinal(first)).toBe(x - start);
          expect(model.ordinal(second)).toBe(x - start);
          expect(model.ordinal(datum('hidden', x))).toBe(-1);
          expect(model.datum(second)).not.toBeNull();
          const next = values.findIndex(([value], i) => i > x && i < end && value !== null);
          expect(model.step(first, 'next')).toEqual(next < 0 ? null : datum('a', next));
        }
      }), { numRuns: 100 });
  });

  it('resolves hidden aligned focus and steps from the primary datum', () => {
    const data = frame('line', { data: [0, 1, 2, 3].map(x => ({ x, a: x, b: x })), x: 'x', y: ['a', 'b'] });
    const model = lookup(aligned(data, { visible: [true, false] }));
    const from = datum('b', 1);
    expect(model.resolve(from)).toEqual(datum('a', 1));
    expect(model.step(from, 'next')).toEqual(datum('a', 2));
    expect(model.step(from, 'first')).toEqual(datum('a', 0));
    expect(model.resolve(datum('b', -1))).toBeNull();
  });

  it('resolves zoomed-out aligned focus to the next value in range, then the previous one', () => {
    const data = frame('line', { data: [0, 1, 2, 3, 4, 5].map(x => ({ x, y: x === 1 ? null : x })), x: 'x', y: 'y' });
    const model = lookup(aligned(data, { visibleSlots: { start: 1, end: 5 } }));
    expect(model.resolve(datum('y', 0))).toEqual(datum('y', 2));
    expect(model.resolve(datum('y', 5))).toEqual(datum('y', 4));
    expect(model.step(datum('y', 0), 'next')).toEqual(datum('y', 3));
    expect(model.step(datum('y', 5), 'previous')).toEqual(datum('y', 3));
    expect(model.step(datum('y', 2), 'first')).toBeNull();
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

it('uses the later instant at a midpoint on a reversed, irregular time scale', () => {
  const data = frame('line', { data: [0, 1000, 4000, 7001].map(x => ({ x, y: 10 })), x: { field: 'x', type: 'time' }, y: 'y' });
  const view = aligned(data, { visibleSlots: { start: 0, end: 3 }, xDomain: [0, 4000] });
  const model = buildLookup(view, plot({
    kind: 'xy', x: linearScale(view.xDomain, [100, 0]), y: linearScale([0, 10], [100, 0]),
  }), formatter(data), defaultMessages);
  expect(model.pick(100, 50)).toEqual({ kind: 'x', x: 0 });
  expect(model.pick(37.51, 50)).toEqual({ kind: 'x', x: 1000 });
  expect(model.pick(37.5, 50)).toEqual({ kind: 'x', x: 4000 });
  expect(model.pick(0, 50)).toEqual({ kind: 'x', x: 4000 });
});

it('reads a stack total with no components as missing', () => {
  const data = frame('area', { data: [{ x: 0, a: null, b: null }], x: 'x', y: ['a', 'b'] });
  const model = lookup(aligned(data, { kind: 'area', stack: {
    order: [0, 1], incomplete: Uint8Array.of(1),
    positive: [Float64Array.of(0), Float64Array.of(0)], negative: [Float64Array.of(0), Float64Array.of(0)],
  } }));
  expect(model.tooltip({ kind: 'x', x: 0 }).total).toBe('No data');
});

describe('an incomplete stack is qualified once (spec F10, review C2-7)', () => {
  const keys = Array.from({ length: 10 }, (_, i) => `S${i}`);
  // S9, past the tooltip's eight rows, has no value at x = 0.
  const data = [0, 1].flatMap(x => keys.map((s, i) => ({ x, s, y: x === 0 && i === 9 ? null : i + 1 })));
  const stacked = frame('area', { x: 'x', y: 'y', series: 's', data });
  const model = lookup(aligned(stacked, { kind: 'area', stack: buildStack(stacked, keys.map(() => true)) }));
  const qualified = (text: string | null | undefined) => (text ?? '').split('(incomplete)').length - 1;

  it('on the total of the tooltip model, never on its rows', () => {
    const tooltip = model.tooltip({ kind: 'x', x: 0 });
    expect(tooltip.rows).toHaveLength(8);
    expect(tooltip.count).toBe(10);
    expect(tooltip.rows.map(row => qualified(row.value))).toEqual(new Array(8).fill(0));
    expect(tooltip.total).toBe('45 (incomplete)');
    expect(qualified(model.tooltip({ kind: 'x', x: 1 }).total)).toBe(0);
  });

  it('on a datum read alone only where the stack has no value', () => {
    expect(model.datum(datum('S8', 0))?.value).toBe('9');
    expect(model.datum(datum('S0', 0))?.value).toBe('1');
    expect(model.datum(datum('S9', 0))?.value).toBe('No data (incomplete)');
    expect(model.datum(datum('S9', 1))?.value).toBe('10');
  });
});

describe('a pointer up to 1 CSS px outside the plot picks as on its edge (decision 0004, clarifications)', () => {
  // Firefox and WebKit report whole pixels: the first datum on a left edge at x 65.6 is pointed at from 65.
  const rect = { x: 65.6, y: 82.267, width: 300.4, height: 150.3 };
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const data = frame('line', { data: [0, 1, 2, 3, 4].map(x => ({ x, y: x + 1 })), x: 'x', y: 'y' });
  const layout = { ...plot({ kind: 'xy', x: linearScale([0, 4], [rect.x, right]), y: linearScale([0, 5], [bottom, rect.y]) }, 400, 260), plot: rect };
  const model = buildLookup(aligned(data), layout, formatter(data), defaultMessages);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const along = [0, 0.3, 0.7, 1];
  // [edge point, outward direction]
  const edges = along.flatMap(t => [
    [[rect.x, rect.y + t * rect.height], [-1, 0]], [[right, rect.y + t * rect.height], [1, 0]],
    [[rect.x + t * rect.width, rect.y], [0, -1]], [[rect.x + t * rect.width, bottom], [0, 1]],
  ] as const);

  it.each([0.27, 0.99, 1])('%f px outside each edge picks what the edge picks', distance => {
    for (const [[x, y], [dx, dy]] of edges) {
      const edge = model.pick(x, y);
      expect(edge).not.toBeNull();
      expect(model.pick(x + dx * distance, y + dy * distance)).toEqual(edge);
    }
  });

  it('1.01 px outside any edge picks nothing', () => {
    for (const [[x, y], [dx, dy]] of edges) expect(model.pick(x + dx * 1.01, y + dy * 1.01)).toBeNull();
  });

  it('for any position within 1 px outside, the pick is the pick at the position moved onto the rectangle', () => {
    // Anywhere in the rectangle grown by 1 px on every side, the edges and corners of the band included.
    const unit = fc.double({ min: 0, max: 1, noNaN: true });
    const edge = fc.constantFrom(0, 1);
    fc.assert(fc.property(fc.oneof(unit, edge), fc.oneof(unit, edge), (u, v) => {
      const x = rect.x - 1 + u * (rect.width + 2);
      const y = rect.y - 1 + v * (rect.height + 2);
      expect(model.pick(x, y)).toEqual(model.pick(clamp(x, rect.x, right), clamp(y, rect.y, bottom)));
    }), { numRuns: 2_000 });
  });
});
