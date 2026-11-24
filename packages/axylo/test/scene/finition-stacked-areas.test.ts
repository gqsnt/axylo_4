import fc from 'fast-check';
import { expect, it } from 'vitest';
import type { AreaMark, Mark } from '../../src/core/contracts';
import { linearScale } from '../../src/scale';
import { buildScene } from '../../src/scene';
import { aligned } from '../view/fixtures';

type Row = { x: number; a: number | null; b: number | null };

function draw(data: Row[], zoom?: readonly [number, number], width = 200, long = false) {
  // In long form b's missing observations have no row. In wide form the same cells are explicit nulls.
  const options = long ? { x: 'x', y: 'y', series: 's', data: [
    ...data.map(r => ({ x: r.x, s: 'a', y: r.a })),
    ...data.flatMap(r => r.b === null ? [] : [{ x: r.x, s: 'b', y: r.b }]),
  ] } : { x: 'x', y: ['a', 'b'], data };
  const { view } = aligned(options, { kind: 'area', stacked: true, zoom });
  const x = linearScale(view.xDomain, [0, width]);
  const plot = { x: 0, y: 0, width, height: 200 };
  const fit = { remedies: [], hidden: 0 };
  const { marks } = buildScene(view, {
    kind: 'plot', width, height: 200, plot, xTicks: [], yTicks: [], texts: [], fit: { x: fit, y: fit },
    projection: { kind: 'xy', x, y: linearScale(view.yDomain, view.yDomain) },
  }, 1);
  function seriesMarks<T extends 'area' | 'path' | 'points'>(type: T, series: number) {
    return marks.filter((m): m is Extract<Mark, { type: T }> => m.type === type && 'series' in m && m.series === series);
  }
  return { seriesMarks, px: x.map };
}

// Read only the vertices referenced by the polygon, as the renderer does.
function ordinate(area: AreaMark, side: 'upper' | 'lower', x: number, run = 0) {
  const offset = 4 * run + (side === 'upper' ? 0 : 2);
  const start = area.runs[offset]!;
  const end = start + area.runs[offset + 1]!;
  const xy = area[side];
  for (let i = start + 1; i < end; i++) {
    const x0 = xy[2 * i - 2]!;
    const x1 = xy[2 * i]!;
    if (x0 <= x && x <= x1) return xy[2 * i - 1]! + (xy[2 * i + 1]! - xy[2 * i - 1]!) * (x - x0) / (x1 - x0);
  }
  throw new Error(`No polygon at x=${x}`);
}

it.each([1, -1])('keeps both fill tapers and joins the observed tips across a sign change (direction %i)', sign => {
  const { seriesMarks, px } = draw([{ x: 0, a: 10, b: 5 * sign }, { x: 1, a: 10, b: -5 * sign }]);
  const band = seriesMarks('area', 1)[0]!;
  expect(ordinate(band, 'upper', px(0.5))).toBe(12.5);
  expect(ordinate(band, 'lower', px(0.5))).toBe(10);
  expect(ordinate(band, 'upper', px(0.5), 1)).toBe(-2.5);
  expect(ordinate(band, 'lower', px(0.5), 1)).toBe(0);

  const tips = sign > 0 ? [0, 15, 200, -5] : [0, -5, 200, 15];
  const paths = seriesMarks('path', 1).filter(m => m.stroke.kind === 'series');
  expect(paths.map(m => [...m.xy])).toEqual([tips]);
  expect(seriesMarks('points', 1).flatMap(m => [...m.xy])).toEqual(tips);
});

it.each([false, true])('draws complementary tapers between slots without a stroke or offscreen marker (long=%s)', long => {
  const { seriesMarks, px } = draw([{ x: 0, a: 100, b: null }, { x: 2, a: null, b: 100 }], [0.5, 1.5], 200, long);
  for (const x of [0.5, 1, 1.5]) {
    const base = seriesMarks('area', 0)[0]!;
    const top = seriesMarks('area', 1)[0]!;
    expect(ordinate(base, 'upper', px(x))).toBeCloseTo(100 - 50 * x);
    expect(ordinate(top, 'lower', px(x))).toBeCloseTo(100 - 50 * x);
    expect(ordinate(top, 'upper', px(x))).toBeCloseTo(100);
  }
  for (const i of [0, 1]) {
    expect(seriesMarks('points', i)).toHaveLength(0);
    expect(seriesMarks('path', i).filter(m => m.stroke.kind === 'series')).toHaveLength(0);
  }
});

it('keeps the visible taper and its shared seam on the far side of a missing component (F10)', () => {
  const { seriesMarks, px } = draw([5, null, 5].map((b, x) => ({ x, a: 10, b })), [0.5, 2]);
  const band = seriesMarks('area', 1)[0]!;
  expect(ordinate(band, 'upper', px(0.5))).toBeCloseTo(12.5);
  expect(ordinate(band, 'lower', px(0.5))).toBeCloseTo(10);
  expect(ordinate(band, 'upper', px(1))).toBeCloseTo(10);
  const seam = seriesMarks('path', 0).find(m => m.stroke.kind === 'token')!;
  expect([...seam.xy]).toEqual([px(0.5), 10, Math.fround(px(1)), 10, px(2), 10]);
  expect(seriesMarks('points', 1).flatMap(m => [...m.xy])).toEqual([200, 15]);
});

it.each([1, -1])('keeps ordered cumulative extrema in a single dense column (sign %i)', sign => {
  const lower = [1, 100, 1, 5, 1, 1, 1, 1, 1];
  const upper = [2, 101, 2, 121, 2, 2, 2, 2, 2];
  const { seriesMarks, px } = draw(lower.map((a, x) => ({ x, a: sign * a, b: sign * (upper[x]! - a) })), undefined, 1);
  const band = seriesMarks('area', 1)[0]!;
  expect(band.lower).toBe(seriesMarks('area', 0)[0]!.upper);
  expect(ordinate(band, 'lower', px(1))).toBe(100 * sign);
  expect(ordinate(band, 'upper', px(3))).toBe(121 * sign);
  for (let x = 0; x <= 8; x += 0.25) {
    expect(sign * (ordinate(band, 'upper', px(x)) - ordinate(band, 'lower', px(x)))).toBeGreaterThanOrEqual(0);
  }
});

it.each([false, true])('pinches dense bands at partial and all-missing runs (long=%s)', long => {
  fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 17, maxLength: 17 }), base => {
    const data = base.map((a, x) => ({
      x, a: x === 12 || x === 13 ? null : a, b: x >= 4 && x <= 7 || x >= 12 && x <= 13 ? null : 3,
    }));
    const { seriesMarks, px } = draw(data, undefined, 1, long);
    const band = seriesMarks('area', 1)[0]!;
    for (const x of [3, 8, 11, 14]) {
      expect(ordinate(band, 'upper', px(x)) - ordinate(band, 'lower', px(x))).toBe(3);
    }
    for (const x of [4, 5, 6, 7, 12, 12.5, 13]) {
      expect(ordinate(band, 'upper', px(x))).toBe(ordinate(band, 'lower', px(x)));
      if (x >= 12) expect(ordinate(band, 'upper', px(x))).toBe(0);
    }
  }));
});
