import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Layout, Mark, Projection, Rect, Tick, View } from '../../src/core/contracts';
import { buildScene } from '../../src/scene';
import { bandScale, linearScale } from '../../src/scale';
import { aligned, donut, scatter } from '../view/fixtures';

const clip: Rect = { x: 10, y: 20, width: 140, height: 100 };
const tick = (value: number): Tick => ({ value, label: String(value) });
const fit = { remedies: [], hidden: 0 };
const dpr = 1;

function layout(view: View, plot = clip, compact = false, padding = 0): Layout {
  const across = [plot.x, plot.x + plot.width] as const;
  const up = [plot.y + plot.height, plot.y] as const;
  let projection: Projection;
  if (view.kind === 'donut') {
    projection = {
      kind: 'ring', cx: plot.x + plot.width / 2, cy: plot.y + plot.height / 2,
      r0: Math.min(plot.width, plot.height) * 0.3, r1: Math.min(plot.width, plot.height) / 2,
    };
  } else if (view.kind === 'bar') {
    const range = view.horizontal ? up : across;
    projection = {
      kind: 'bands', horizontal: view.horizontal,
      band: view.frame.x.kind === 'category' ? bandScale(view.frame.length, range, padding) : linearScale(view.xDomain, range),
      value: linearScale(view.yDomain, view.horizontal ? across : up),
    };
  } else {
    projection = {
      kind: 'xy',
      x: view.kind !== 'scatter' && view.frame.x.kind === 'category'
        ? bandScale(view.frame.length, across, padding) : linearScale(view.xDomain, across),
      y: linearScale(view.yDomain, up),
    };
  }

  const size = { width: plot.x + plot.width + 10, height: plot.y + plot.height + 10, plot, projection };
  if (compact) return { ...size, kind: 'compact' };
  return {
    ...size, kind: 'plot', xTicks: view.kind === 'donut' ? [] : view.xDomain.map(tick),
    yTicks: view.kind === 'donut' ? [] : view.yDomain.map(tick), texts: [], fit: { x: fit, y: fit },
  };
}

function marksOf<T extends Mark['type']>(marks: readonly Mark[], type: T): Extract<Mark, { type: T }>[] {
  return marks.filter((mark): mark is Extract<Mark, { type: T }> => mark.type === type);
}

function line(values: readonly (number | null)[], compact = false) {
  return aligned({ x: 'x', y: 'y', data: values.map((y, x) => ({ x, y })) },
    { kind: 'line', compact, valueDomain: [0, 10] }).view;
}

describe('line and area geometry', () => {
  it('packs the exact projected vertices and a pen lift, and shows the isolated value', () => {
    const view = line([1, 2, null, 3, null, 4, 5, 6]);
    const scene = buildScene(view, layout(view), dpr);
    const [path] = marksOf(scene.marks, 'path');
    expect(path).toEqual({
      type: 'path', series: 0, xy: Float32Array.of(10, 110, 30, 100, NaN, NaN, 110, 80, 130, 70, 150, 60),
      stroke: { kind: 'series', index: 0 }, strokeWidth: 2, dash: view.cues[0]!.dash,
    });
    expect(marksOf(scene.marks, 'points')).toEqual([{
      type: 'points', series: 0, xy: Float32Array.of(10, 110, 30, 100, 70, 90, 110, 80, 130, 70, 150, 60),
      shape: 'circle', size: 6, fill: { kind: 'series', index: 0 },
    }]);
    expect(scene.clip).toBe(clip);
  });

  it('keeps the joined neighbours past the zoom edges and puts identity markers inside the view', () => {
    const { view } = aligned({ x: 'x', y: 'y', data: [0, 1, 2, 3, 4, 5].map(x => ({ x, y: x + 1 })) },
      { kind: 'line', zoom: [1.5, 3.5], valueDomain: [0, 10] });
    const { marks } = buildScene(view, layout(view), dpr);
    expect(marksOf(marks, 'path')[0]!.xy).toEqual(Float32Array.of(-25, 100, 45, 90, 115, 80, 185, 70));
    expect(marksOf(marks, 'points')[0]!.xy).toEqual(Float32Array.of(45, 90, 115, 80));
  });

  it('uses a zero baseline for an unstacked area backed by a borrowed Float32 column', () => {
    const x = Float64Array.of(0, 1, 2);
    const y = Float32Array.of(2, -4, 6);
    const { view } = aligned({ data: { columns: { x, y } }, x: 'x', y: 'y' },
      { kind: 'area', valueDomain: [-5, 5] });
    expect(view.frame.series[0]!.y).toBe(y);
    const { marks } = buildScene(view, layout(view), dpr);
    const [area] = marksOf(marks, 'area');
    expect(area).toMatchObject({
      opacity: 0.25, upper: Float32Array.of(10, 50, 80, 110, 150, 10),
      lower: Float32Array.of(10, 70, 80, 70, 150, 70), runs: Uint32Array.of(0, 3, 0, 3),
    });
    expect(marksOf(marks, 'path')[0]!.strokeWidth).toBe(2);
  });

  it('shares exact packed boundaries between adjacent stacked areas on both sides of zero', () => {
    const { view } = aligned({
      x: 'x', y: ['a', 'b', 'c'], data: [
        { x: 0, a: 2, b: 3, c: -2 }, { x: 1, a: -4, b: -1, c: 3 }, { x: 2, a: 2, b: null, c: 5 },
      ],
    }, { kind: 'area', stacked: true, valueDomain: [-10, 10] });
    const { marks } = buildScene(view, layout(view), dpr);
    const areas = marksOf(marks, 'area');
    expect(areas).toHaveLength(3);
    expect(areas[0]!.upper).toBe(areas[1]!.lower);
    expect(areas[1]!.upper).toBe(areas[2]!.lower);
    expect(areas[1]!.opacity).toBe(0.8);
    expect(areas[1]!.upper).toEqual(Float32Array.of(10, 45, 80, 70, 150, 60, 10, 70, 80, 95, 150, 70));
    expect(areas[1]!.runs).toEqual(Uint32Array.of(0, 3, 0, 3, 3, 3, 3, 3));
    const paths = marksOf(marks, 'path').filter(mark => mark.stroke.kind === 'series');
    expect(paths[1]!.xy).toEqual(Float32Array.of(10, 45, 80, 95));
  });

  it.each([1, 2])('retains the actual extrema in sampled columns of 100,000 points at DPR %s', ratio => {
    const count = 100_000;
    const x = Float64Array.from({ length: count }, (_, i) => i + 0.5);
    const y = Float64Array.from({ length: count }, (_, i) => i % 101 - 50);
    const { view } = aligned({ x: 'x', y: 'y', data: { columns: { x, y } } },
      { kind: 'line', xDomain: [0, count], valueDomain: [-50, 50] });
    const scene = buildScene(view, layout(view, { x: 0, y: 0, width: 200, height: 100 }), ratio);
    const path = marksOf(scene.marks, 'path')[0]!;
    expect(path.xy.length / 2).toBeLessThanOrEqual(4 * 200 * ratio);

    const samplesPerColumn = count / (200 * ratio);
    for (const column of [0, 1, 83, 137, 200 * ratio - 1]) {
      const source = y.subarray(column * samplesPerColumn, (column + 1) * samplesPerColumn);
      const drawn: number[] = [];
      for (let i = 0; i < path.xy.length; i += 2) {
        if (Math.floor(path.xy[i]! * ratio) === column) drawn.push(path.xy[i + 1]!);
      }
      expect(Math.min(...drawn)).toBe(50 - Math.max(...source));
      expect(Math.max(...drawn)).toBe(50 - Math.min(...source));
    }
    const markers = marksOf(scene.marks, 'points')[0]!;
    expect(markers.xy.length / 2).toBe(3);
    expect(markers.xy.at(-2)).toBeCloseTo(199.999, 4);
    expect(markers.xy.at(-1)).toBe(50 - y[count - 1]!);
    for (let i = 0; i < markers.xy.length; i += 2) {
      const index = Math.round(markers.xy[i]! * 500 - 0.5);
      expect(markers.xy[i + 1]).toBe(50 - y[index]!);
    }
  });

  it('draws compact paths without axes, references, or regular markers but keeps isolated points', () => {
    const view = line([2, 4, 6], true);
    const { marks } = buildScene({
      ...view, references: [{ axis: 'y', from: 2, to: 2, label: 'Reference' }],
    }, layout(view, clip, true), dpr);
    expect(marks.map(mark => mark.type)).toEqual(['path']);
    const isolated = line([null, 4, null], true);
    const isolatedScene = buildScene(isolated, layout(isolated, clip, true), dpr);
    expect(marksOf(isolatedScene.marks, 'points')[0]!.xy).toEqual(Float32Array.of(80, 80));
  });
});

describe('bar geometry', () => {
  it('uses projected zero as the baseline and represents missing and zero bars separately', () => {
    const { view } = aligned({
      x: 'x', y: 'y', data: [{ x: 'A', y: 4 }, { x: 'B', y: null }, { x: 'C', y: 0 }],
    }, { kind: 'bar', valueDomain: [0, 10] });
    const scene = buildScene(view, layout(view, { ...clip, width: 120 }), dpr);
    expect(marksOf(scene.marks, 'rects')).toEqual([
      { type: 'rects', variant: 'bar', series: 0, xywh: Float32Array.of(10, 80, 40, 40, 90, 120, 40, 0),
        fill: { kind: 'series', index: 0 } },
      { type: 'rects', variant: 'missing', series: 0, xywh: Float32Array.of(50, 120, 40, 0),
        fill: { kind: 'token', name: 'muted' } },
    ]);
  });

  it.each([false, true])('keeps both grouped bars in their band without overlap, horizontal %s', horizontal => {
    const { view } = aligned({
      x: 'x', y: ['a', 'b'], data: [{ x: 'A', a: 2, b: 3 }, { x: 'B', a: 4, b: 5 }],
    }, { kind: 'bar', horizontal, valueDomain: [0, 10] });
    const scene = buildScene(view, layout(view, clip, false, 0.25), dpr);
    const [a, b] = marksOf(scene.marks, 'rects');
    const dimension = horizontal ? clip.height : clip.width;
    const step = dimension / 2.25;
    const band = 0.75 * step;
    const axis = horizontal ? 1 : 0;
    for (let i = 0; i < 2; i++) {
      const start = horizontal
        ? clip.y + clip.height - (i + 0.25) * step - band : clip.x + (i + 0.25) * step;
      expect(a!.xywh[4 * i + axis]).toBeCloseTo(start, 4);
      expect(a!.xywh[4 * i + axis + 2]).toBeCloseTo(band / 2, 4);
      expect(b!.xywh[4 * i + axis]).toBeCloseTo(start + band / 2, 4);
      expect(b!.xywh[4 * i + axis + 2]).toBeCloseTo(band / 2, 4);
    }
  });

  it('places mixed-sign stacks on their own sides with separation between filled segments', () => {
    const { view } = aligned({
      x: 'x', y: ['a', 'b', 'c', 'd'], data: [{ x: 'A', a: 3, b: -2, c: 4, d: -5 }],
    }, { kind: 'bar', stacked: true, valueDomain: [-10, 10] });
    const { marks } = buildScene(view, layout(view), dpr);
    const bars = marksOf(marks, 'rects');
    expect(bars.map(bar => Array.from(bar.xywh))).toEqual([
      [10, 55, 140, 15], [10, 71, 140, 9], [10, 35, 140, 19], [10, 81, 140, 24],
    ]);
  });

  it('draws every subpixel band with at least a CSS pixel of width', () => {
    const { view } = aligned({
      x: 'x', y: 'y', data: Array.from({ length: 250 }, (_, i) => ({ x: 'Category ' + i, y: 4 })),
    }, { kind: 'bar' });
    const { marks } = buildScene(view, layout(view), dpr);
    const [bar] = marksOf(marks, 'rects');
    expect(bar!.xywh).toHaveLength(1000);
    expect(bar!.xywh.every((value, i) => i % 4 !== 2 || value >= 1)).toBe(true);
  });
});

describe('chart decorations and other projections', () => {
  it('orders clipped reference bands, the value grid, data, axes, and reference rules', () => {
    const view = line([2, 4, 6]);
    const augmented = { ...view, references: [
      { axis: 'x' as const, from: -1, to: 1, label: 'Range' },
      { axis: 'y' as const, from: 5, to: 5, label: 'Goal' },
      { axis: 'x' as const, from: 3, to: 3, label: 'Outside' },
    ] };
    const { marks } = buildScene(augmented, layout(augmented), dpr);
    expect(marks.map(mark => mark.type === 'rule' ? mark.role : mark.type)).toEqual([
      'band', 'grid', 'grid', 'path', 'points', 'axis', 'axis', 'tick', 'tick', 'tick', 'tick', 'reference',
    ]);
    expect(marks[0]).toEqual({
      type: 'band', box: { ...clip, width: 70 }, fill: { kind: 'token', name: 'reference' }, opacity: 0.12,
    });
    expect(marks[1]).toMatchObject({ stroke: { kind: 'token', name: 'grid' }, x1: 10, y1: 120, x2: 150, y2: 120 });
    expect(marks.at(-1)).toMatchObject({ stroke: { kind: 'token', name: 'reference' }, x1: 10, y1: 70, x2: 150, y2: 70 });
  });

  it('swaps the grid and reference axes for horizontal bars', () => {
    const { view } = aligned({ x: 'x', y: 'y', data: [{ x: 'A', y: 4 }, { x: 'B', y: 7 }] }, {
      kind: 'bar', horizontal: true, valueDomain: [0, 10], references: [{ x: 'B', label: 'Category' }, { y: 5, label: 'Target' }],
    });
    const rules = marksOf(buildScene(view, layout(view), dpr).marks, 'rule');
    expect(rules.filter(mark => mark.role === 'grid')).toMatchObject([
      { x1: 10, y1: 20, x2: 10, y2: 120 }, { x1: 150, y1: 20, x2: 150, y2: 120 },
    ]);
    expect(rules.filter(mark => mark.role === 'reference')).toMatchObject([
      { x1: 10, y1: 45, x2: 150, y2: 45 }, { x1: 80, y1: 20, x2: 80, y2: 120 },
    ]);
  });

  it('draws scatter points in series shapes, excluding hidden and out-of-zoom points', () => {
    const { view } = scatter({ x: 'x', y: 'y', series: 's', data: [
      { x: 0, y: 7, s: 'a' }, { x: 2, y: 3, s: 'a' }, { x: 3, y: 6, s: 'b' },
      { x: 4, y: 5, s: 'b' }, { x: 2, y: 2, s: 'hidden' },
    ] }, { zoom: [1, 3], valueDomain: [0, 10], hidden: new Set(['hidden']) });
    const { marks } = buildScene(view, layout(view), dpr);
    expect(marksOf(marks, 'points')).toEqual([
      { type: 'points', series: 0, xy: Float32Array.of(80, 90), shape: 'circle', size: 6, fill: { kind: 'series', index: 0 } },
      { type: 'points', series: 1, xy: Float32Array.of(150, 60), shape: 'square', size: 6, fill: { kind: 'series', index: 1 } },
    ]);
  });

  it('uses the slice palette slots and a muted Other with a one-pixel gap', () => {
    const { view } = donut(Array.from({ length: 10 }, (_, i) => ({ label: 'Part ' + i, value: i })));
    const { marks } = buildScene(view, layout(view), dpr);
    expect(marks).toHaveLength(1);
    const [ring] = marksOf(marks, 'arcs');
    expect(ring).toMatchObject({
      cx: 80, cy: 70, r0: 30, r1: 50, gap: 1,
      fills: [
        ...Array.from({ length: 7 }, (_, i) => ({ kind: 'series', index: i + 1 })),
        { kind: 'token', name: 'muted' },
      ],
    });
    expect(ring!.angles).toHaveLength(16);
    expect(ring!.angles[0]).toBe(0);
    expect(ring!.angles.at(-1)).toBeCloseTo(2 * Math.PI, 6);
  });

  it('returns correctly sized empty scenes for non-drawing layouts and empty rings', () => {
    const view = line([2, 4]);
    for (const kind of ['too-small', 'unmeasured'] as const) {
      expect(buildScene(view, { kind, width: 48, height: 24 }, dpr)).toEqual({
        width: 48, height: 24, clip: { x: 0, y: 0, width: 48, height: 24 }, marks: [],
      });
    }
    const empty = donut([{ label: 'Zero', value: 0 }]).view;
    expect(buildScene(empty, layout(empty), dpr).marks).toEqual([]);
  });
});

function expectPoint(x: number, y: number, plot: Rect, stroke = 0): void {
  const margin = stroke + 0.0001;
  expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
  expect(x).toBeGreaterThanOrEqual(plot.x - margin);
  expect(x).toBeLessThanOrEqual(plot.x + plot.width + margin);
  expect(y).toBeGreaterThanOrEqual(plot.y - margin);
  expect(y).toBeLessThanOrEqual(plot.y + plot.height + margin);
}

function expectPacked(xy: Float32Array, plot: Rect, stroke?: number): void {
  for (let i = 0; i < xy.length; i += 2) {
    const x = xy[i]!;
    const y = xy[i + 1]!;
    if (stroke !== undefined && Number.isNaN(x)) expect(Number.isNaN(y)).toBe(true);
    else expectPoint(x, y, plot, stroke);
  }
}

function expectBox(x: number, y: number, width: number, height: number, plot: Rect): void {
  expect(width).toBeGreaterThanOrEqual(0);
  expect(height).toBeGreaterThanOrEqual(0);
  expectPoint(x, y, plot);
  expectPoint(x + width, y + height, plot);
}

function expectWithinClip(mark: Mark, plot: Rect): void {
  switch (mark.type) {
    case 'rule':
      if (mark.role === 'axis' || mark.role === 'tick') {
        expect([mark.x1, mark.y1, mark.x2, mark.y2].every(Number.isFinite)).toBe(true);
      } else {
        expectPoint(mark.x1, mark.y1, plot, mark.strokeWidth);
        expectPoint(mark.x2, mark.y2, plot, mark.strokeWidth);
      }
      break;
    case 'path': expectPacked(mark.xy, plot, mark.strokeWidth); break;
    case 'points': expectPacked(mark.xy, plot); break;
    case 'area':
      expectPacked(mark.upper, plot);
      expectPacked(mark.lower, plot);
      for (let i = 0; i < mark.runs.length; i += 4) {
        expect((mark.runs[i]! + mark.runs[i + 1]!) * 2).toBeLessThanOrEqual(mark.upper.length);
        expect((mark.runs[i + 2]! + mark.runs[i + 3]!) * 2).toBeLessThanOrEqual(mark.lower.length);
      }
      break;
    case 'rects':
      for (let i = 0; i < mark.xywh.length; i += 4) {
        expectBox(mark.xywh[i]!, mark.xywh[i + 1]!, mark.xywh[i + 2]!, mark.xywh[i + 3]!, plot);
      }
      break;
    case 'band': expectBox(mark.box.x, mark.box.y, mark.box.width, mark.box.height, plot); break;
    case 'arcs':
      expectPoint(mark.cx - mark.r1, mark.cy - mark.r1, plot);
      expectPoint(mark.cx + mark.r1, mark.cy + mark.r1, plot);
      expect(Number.isFinite(mark.r0) && mark.angles.every(Number.isFinite)).toBe(true);
      break;
  }
}

it('keeps generated mark coordinates finite and clipped, with non-negative rectangle sizes', () => {
  const value = fc.option(fc.integer({ min: -500, max: 500 }), { nil: null });
  const values = fc.array(fc.tuple(value, value), { minLength: 1, maxLength: 18 });
  const kind = fc.constantFrom('line', 'area', 'bar', 'scatter', 'donut');
  const size = fc.integer({ min: 1, max: 200 });
  fc.assert(fc.property(kind, values, size, size, fc.boolean(), fc.boolean(), (chart, rows, width, height, flag, compact) => {
    const plot = { x: 12.25, y: 16.5, width, height };
    const references = [{ y: [-15, 15] as const, label: 'Range' }, { y: 17, label: 'Goal' }];
    let view: View;
    if (chart === 'donut') {
      view = donut(rows.map(([value], i) => ({ label: 'Part ' + i, value: value === null ? null : Math.abs(value) }))).view;
    } else if (chart === 'scatter') {
      view = scatter({ x: 'x', y: 'y', data: rows.map(([y], x) => ({ x, y })) }, { references }).view;
    } else {
      const data = rows.map(([a, b], x) => ({ x: chart === 'bar' ? 'Band ' + x : x, a, b }));
      view = aligned({ x: 'x', y: ['a', 'b'], data }, {
        kind: chart, stacked: flag, horizontal: flag, compact, references,
      }).view;
    }
    const scene = buildScene(view, layout(view, plot, view.kind !== 'donut' && view.compact, 0.2), flag ? 2 : 1);
    expect(scene.clip).toBe(plot);
    for (const mark of scene.marks) expectWithinClip(mark, plot);
  }), { numRuns: 200 });
});
