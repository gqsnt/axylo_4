import fc from 'fast-check';
import { expect, it, vi } from 'vitest';
import { SLOT_GAP, SLOT_NO_ROW, SLOT_NULL, SLOT_VALUE, type PointMark } from '../../src/core/contracts';
import { defaultMessages } from '../../src/messages';
import { buildReader } from '../../src/reader';
import { areaData } from '../../src/render/svg';
import { linearScale } from '../../src/scale/linear';
import { addArea } from '../../src/scene/areas';
import { COORDINATE_LIMIT, position } from '../../src/scene/geometry';
import { addLine, drawing } from '../../src/scene/lines';
import { buildPoints, simplifyLine } from '../../src/simplify';
import { alignedStatistics } from '../../src/view';
import { formatter } from '../lookup/fixtures';
import { aligned } from '../view/fixtures';

const { view } = aligned({ data: [{ x: 0, y: 1 }], x: 'x', y: 'y' }, { kind: 'line' });

it('uses the continuous scale’s division order at a dense device-column boundary', () => {
  const x = Float64Array.from({ length: 373 }, (_, i) => i < 370 ? 6.9 + i / 10_000 : 7 + (i - 370) / 100);
  const y = new Float64Array(x.length).fill(1);
  y.set([8, 3, 2], 370);
  const xy = { kind: 'xy', x: linearScale([0, 10], [0, 90]), y: linearScale([0, 10], [0, 10]) } as const;
  const input = drawing(x, xy, { x: 0, y: 0, width: 90, height: 10 }, 1);
  expect(Math.floor((7 / 10) * 90)).toBe(62);
  expect(Math.floor(7 * (90 / 10))).toBe(63);
  const kept = simplifyLine({ ...input, y, slot: new Uint8Array(x.length).fill(SLOT_VALUE), range: { start: 0, end: x.length } });
  expect(kept.indexes).toEqual(Uint32Array.of(0, 370, 371, 372));
});

it('falls back for degenerate scales and extrapolation beyond packed coordinate bounds', () => {
  const x = Float64Array.of(0, 1, Number.MAX_VALUE);
  const y = Float64Array.of(0, 3, Number.MAX_VALUE);
  const xy = { kind: 'xy', x: linearScale([0, 1], [10, 20]), y: linearScale([3, 3], [5, 15]) } as const;
  const input = drawing(x, xy, { x: 10, y: 5, width: 10, height: 10 }, 1);
  expect(input.affineX).toBeUndefined();
  expect(input.affineY).toBeUndefined();
  expect(buildPoints(Uint32Array.of(0, 1, 2), { ...input, y }))
    .toEqual(Float32Array.of(10, 10, 20, 10, COORDINATE_LIMIT, 10));
});

it('matches the marker spacing rules across ascending and descending projections and missing slots', () => {
  const state = fc.constantFrom(SLOT_VALUE, SLOT_VALUE, SLOT_VALUE, SLOT_NULL, SLOT_NO_ROW, SLOT_GAP);
  fc.assert(fc.property(
    fc.array(fc.tuple(fc.integer({ min: 1, max: 15 }), state), { minLength: 100, maxLength: 200 }),
    fc.boolean(), fc.boolean(),
    (samples, reversed, requireIsolated) => {
      let value = 0;
      const x = Float64Array.from(samples, ([step]) => value += step);
      const y = Float64Array.from(samples, (_, i) => i);
      const slot = Uint8Array.from(samples, ([, status]) => status);
      const range = { start: 2, end: x.length - 2 };
      const xy = {
        kind: 'xy', x: linearScale([0, 1], reversed ? [1, 0] : [0, 1]),
        y: linearScale([0, 100], [100, 0]),
      } as const;
      const input = drawing(x, xy, { x: 0, y: 0, width: 1, height: 100 }, 1);
      const observed = Array.from(slot.keys()).filter(i => i >= range.start && i < range.end && slot[i] === SLOT_VALUE);
      const isolated = new Uint32Array(requireIsolated
        ? observed.filter(i => slot[i - 1] === SLOT_GAP && slot[i + 1] === SLOT_GAP)
        : []);
      const points: PointMark[] = [];
      addLine({ ...input, y, slot, range }, view, 0, range, false, [], points,
        { indexes: new Uint32Array(), breaks: new Uint32Array(), isolated });

      const pixel = (i: number) => position(xy.x, x[i]!);
      const showAll = observed.every((i, j) => j === 0 || Math.abs(pixel(i) - pixel(observed[j - 1]!)) >= 12);
      let last = Infinity;
      const expected: number[] = [];
      for (const i of observed.reverse()) {
        const p = pixel(i);
        if (showAll || isolated.includes(i) || Math.abs(p - last) >= 80) {
          expected.unshift(p, position(xy.y, y[i]!));
          last = p;
        }
      }
      expect(points[0]?.xy ?? new Float32Array()).toEqual(Float32Array.from(expected));
    },
  ));
});

it('selects the last valid marker at or beyond the exact 80 px threshold', () => {
  const x = Float64Array.from({ length: 241 }, (_, i) => i);
  const y = new Float64Array(x.length).fill(2);
  const slot = new Uint8Array(x.length).fill(SLOT_VALUE);
  slot[160] = SLOT_NULL;
  const range = { start: 0, end: x.length };
  const xy = { kind: 'xy', x: linearScale([0, 256], [0, 256]), y: linearScale([0, 4], [0, 4]) } as const;
  const input = drawing(x, xy, { x: 0, y: 0, width: 256, height: 4 }, 1);
  const points: PointMark[] = [];
  addLine({ ...input, y, slot, range }, view, 0, range, false, [], points);
  expect(points[0]?.xy).toEqual(Float32Array.of(79, 2, 159, 2, 240, 2));
});

it.each([Float32Array, Float64Array])('closes dense zero-baseline polygons for %s with only two lower vertices per run', Column => {
  const x = Float64Array.from({ length: 11 }, (_, i) => i);
  const y = Column.of(1, 2, 4, 3, NaN, 7, 5, 2, 4, NaN, 9);
  const slot = Uint8Array.of(SLOT_VALUE, SLOT_VALUE, SLOT_VALUE, SLOT_VALUE, SLOT_GAP,
    SLOT_VALUE, SLOT_VALUE, SLOT_VALUE, SLOT_VALUE, SLOT_GAP, SLOT_VALUE);
  const range = { start: 0, end: x.length };
  const xy = { kind: 'xy', x: linearScale([0, 16], [0, 1]), y: linearScale([0, 10], [0, 10]) } as const;
  const input = drawing(x, xy, { x: 0, y: 0, width: 1, height: 10 }, 1);
  const areas: Parameters<typeof addArea>[4] = [];
  addArea({ ...input, y, slot, range }, { ...view, visibleSlots: range }, 0, false, areas, [], []);
  expect(areas[0]!.lower).toEqual(Float32Array.of(0, 0, 3 / 16, 0, 5 / 16, 0, 8 / 16, 0));
  expect(areas[0]!.runs).toEqual(Uint32Array.of(0, 3, 0, 2, 3, 3, 2, 2));
  expect(areaData(areas[0]!)).toBe('M0 1L0.13 4L0.19 3L0.19 0L0 0ZM0.31 7L0.44 2L0.5 4L0.5 0L0.31 0Z');
});

it('agrees with the finite slot values for whole blocks, partial blocks, and short ranges', () => {
  const values = fc.oneof(fc.integer({ min: -500, max: 500 }), fc.constantFrom(NaN, Infinity, -Infinity, -0, 0));
  const states = fc.constantFrom(SLOT_VALUE, SLOT_VALUE, SLOT_NO_ROW, SLOT_NULL);
  fc.assert(fc.property(
    fc.array(fc.tuple(values, states), { minLength: 1060, maxLength: 1500 }), fc.boolean(),
    (samples, float32) => {
      const y = new (float32 ? Float32Array : Float64Array)(samples.length);
      const slot = new Uint8Array(samples.length);
      for (const [i, [value, state]] of samples.entries()) {
        y[i] = value;
        slot[i] = state;
      }
      const series = { ...view.frame.series[0]!, y, slot };
      for (const [start, end] of [[0, slot.length], [13, slot.length - 13], [255, 258], [256, 256]] as const) {
        const finite = Array.from(y.subarray(start, end)).filter((value, i) => slot[start + i] === SLOT_VALUE && Number.isFinite(value));
        const min = Math.min(...finite);
        const max = Math.max(...finite);
        const last = finite.at(-1) ?? NaN;
        expect(alignedStatistics(series, start, end, true)).toEqual({ min, max, last });
        expect(alignedStatistics(series, start, end)).toEqual({
          min: finite.find(value => value === min) ?? min,
          max: finite.find(value => value === max) ?? max,
          last,
        });
      }
    },
  ));
});

it('preserves reader tie order and signed extrema in an otherwise empty block summary', () => {
  const slot = new Uint8Array(1281).fill(SLOT_NO_ROW);
  const y = new Float64Array(slot.length).fill(NaN);
  slot[256] = slot[257] = slot[1280] = SLOT_VALUE;
  y[256] = 0;
  y[257] = y[1280] = -0;
  const series = { ...view.frame.series[0]!, y, slot };
  expect(alignedStatistics(series, 0, slot.length, true)).toEqual({ min: -0, max: 0, last: -0 });
  expect(alignedStatistics(series, 0, slot.length)).toEqual({ min: 0, max: 0, last: -0 });
});

it('joins all drawable names and the visible subset in en without constructing a list formatter', () => {
  const data = [{ day: 0, Direct: 10, Search: 20, Referral: 30 }];
  const { view } = aligned({ data, x: 'day', y: ['Direct', 'Search', 'Referral'] },
    { kind: 'line', hidden: new Set(['Referral']) });
  const formatters = formatter(view.frame);
  const listFormat = vi.spyOn(Intl, 'ListFormat');
  try {
    const reader = buildReader({ view, formatters, messages: defaultMessages, type: 'Line', locale: 'en', table: false });
    expect(reader.name).toContain('Direct, Search, and Referral');
    expect(reader.summary).toContain('Direct and Search from 10 to 20.');
    expect(listFormat).not.toHaveBeenCalled();
  } finally {
    listFormat.mockRestore();
  }
});
