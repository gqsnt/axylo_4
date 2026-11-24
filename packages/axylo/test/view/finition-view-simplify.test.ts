import { expect, it } from 'vitest';
import { hasData } from '../../src/core/controller';
import { buildView } from '../../src/view';
import { aligned } from './fixtures';

it('fits the visible cumulative fill and counts it as data between complementary missing samples (F7/F10)', () => {
  const { view } = aligned({
    x: 'x', y: ['a', 'b'], data: [{ x: 0, a: 100, b: null }, { x: 2, a: null, b: 100 }],
  }, { kind: 'area', stacked: true, zoom: [0.5, 1.5] });
  expect(view.visibleSlots).toEqual({ start: 1, end: 1 });
  expect(view.drawSlots).toEqual([{ start: 0, end: 1 }, { start: 1, end: 2 }]);
  expect(hasData(view)).toBe(true);
  expect(view.yDomain).toEqual([0, 100]);
});

it('uses adjacent stack totals on both zoom edges, even when all strokes are broken (F7)', () => {
  const { view } = aligned({
    x: 'x', y: ['a', 'b'], data: [{ x: 0, a: -80, b: null }, { x: 4, a: null, b: 160 }],
  }, { kind: 'area', stacked: true, zoom: [1, 3] });
  // Negative totals are -60 and -20 at the edges. Positive totals are 40 and 120.
  expect(view.yDomain).toEqual([-100, 150]);
});

it('changes the draw window when switching between stacked and unstacked sparse observations (F5/F7)', () => {
  const data = [
    { x: 0, s: 'weekly', y: 1000 }, { x: 4, s: 'weekly', y: 1000 },
    ...[0, 1, 2, 3, 4].map(x => ({ x, s: 'daily', y: 10 })),
  ];
  const state = { kind: 'area', zoom: [1, 3] } as const;
  const { view, frame, diagnostics } = aligned({ x: 'x', y: 'y', series: 's', data }, state);
  const stacked = buildView(frame, { ...state, stacked: true, previous: view }, diagnostics);
  const weekly = frame.series.findIndex(s => s.key === 'weekly');
  expect(view.drawSlots[weekly]).toEqual({ start: 0, end: 5 });
  expect(stacked.drawSlots[weekly]).toEqual({ start: 1, end: 4 });
  expect(stacked.yDomain).toEqual([0, 10]);
  const restored = buildView(frame, { ...state, previous: stacked }, diagnostics);
  expect(restored.drawSlots).toEqual(view.drawSlots);
  expect(restored.yDomain).toEqual([0, 1000]);
});

it('preserves endpoint-relative precision when fitting a sloped segment (F7)', () => {
  const { view } = aligned({
    x: 'x', y: 'y', data: [{ x: -(2 ** 54), y: 2 ** 60 }, { x: 0, y: 0 }],
  }, { kind: 'line', zoom: [-1, -0.5] });
  // y = -64x, so the edge values are 64 and 32. The enclosing nice ticks are 70 and 30.
  expect(view.yDomain).toEqual([30, 70]);
});
