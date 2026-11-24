import { expect, it } from 'vitest';
import type { Layout, Projection, RuleMark } from '../../src/core/contracts';
import { linearScale } from '../../src/scale/linear';
import { buildScene } from '../../src/scene';
import { projectReference } from '../../src/scene/geometry';
import { aligned } from '../view/fixtures';

const plot = { x: 11.8, y: 11.2, width: 210, height: 180 };
const right = plot.x + plot.width;
const bottom = plot.y + plot.height;
const fit = { hidden: 0, remedies: [] };
const ticks = [-1e-6, 0, 1, 1 + 1e-6].map(value => ({ value, label: String(value) }));

it.each([false, true])('pins boundary ticks, gridlines and references to fractional plot edges (horizontal %s)', horizontal => {
  // Let projection and layout arrive at the same edge by different floating-point calculations.
  const across = linearScale([0, 1], [plot.x - 2 ** -49, right + 2 ** -45]);
  const up = linearScale([0, 1], [bottom + 2 ** -45, plot.y - 2 ** -49]);
  const projection: Projection = horizontal ? { kind: 'bands', horizontal, band: up, value: across }
    : { kind: 'xy', x: across, y: up };
  const { view } = aligned({ x: 'x', y: 'y', data: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, {
    kind: horizontal ? 'bar' : 'line', horizontal, xDomain: [0, 1], valueDomain: [0, 1],
    references: [{ x: 1, label: 'End' }, { y: 1, label: 'Maximum' }],
  });
  const layout: Layout = { kind: 'plot', plot, projection, width: 240, height: 220,
    xTicks: ticks, yTicks: ticks, texts: [], fit: { x: fit, y: fit } };
  const rules = buildScene(view, layout, 1).marks.filter((mark): mark is RuleMark => mark.type === 'rule');
  const coords = (role: RuleMark['role']) => rules.filter(rule => rule.role === role)
    .map(({ x1, y1, x2, y2 }) => [x1, y1, x2, y2]);
  expect(coords('tick')).toEqual([
    [plot.x, bottom, plot.x, bottom + 4], [right, bottom, right, bottom + 4],
    [plot.x - 4, bottom, plot.x, bottom], [plot.x - 4, plot.y, plot.x, plot.y],
  ]);
  expect(coords('grid')).toEqual(horizontal ? [
    [plot.x, plot.y, plot.x, bottom], [right, plot.y, right, bottom],
  ] : [[plot.x, bottom, right, bottom], [plot.x, plot.y, right, plot.y]]);
  expect(coords('reference')).toHaveLength(2);
  expect(coords('reference')).toEqual(expect.arrayContaining([
    [right, plot.y, right, bottom], [plot.x, plot.y, right, plot.y],
  ]));
});

it('rejects out-of-domain y lines and bands on a constant value axis', () => {
  const y = linearScale([5, 5], [bottom, plot.y]);
  const projection = { kind: 'xy', x: y, y } as const;
  const ref = (from: number, to: number) => projectReference({ axis: 'y', from, to, label: 'Goal' }, projection, plot);
  expect(ref(900, 900)).toBeNull();
  expect(ref(-20, -10)).toBeNull();
  expect(ref(5, 5)).toEqual({ vertical: false, low: y.map(5), high: y.map(5) });
});

it('rejects reference lines farther outside the plot than the layout tolerance', () => {
  const y = linearScale([0, 1], [bottom, plot.y - 1e-6]);
  expect(projectReference({ axis: 'y', from: 1, to: 1, label: 'Goal' }, { kind: 'xy', x: y, y }, plot)).toBeNull();
});
