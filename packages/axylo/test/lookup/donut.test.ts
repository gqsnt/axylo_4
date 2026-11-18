import { expect, it } from 'vitest';
import type { DatumRef } from '../../src/core/contracts';
import { buildLookup } from '../../src/lookup';
import { defaultMessages } from '../../src/messages';
import { donut, formatter, frame, plot } from './fixtures';

const parts = [
  ['Chrome', 46.2], ['Safari', 27.5], ['Edge', 14.1], ['Firefox', 8.9], ['Samsung Internet', 2.1], ['Other', 1.2],
] as const;
const layout = plot({ kind: 'ring', cx: 50, cy: 50, r0: 20, r1: 40 });
const data = frame('donut', { data: [...parts, ['Zero', 0], ['No sample', null]].map(([category, value]) => ({ category, value })),
  label: 'category', value: { field: 'value', scale: 'percent' } });
const model = buildLookup(donut(data), layout, formatter(data), defaultMessages, 'en-US');

it('picks the parts fixture from 12 o’clock clockwise within the ring', () => {
  expect(model.pick(50, 20)).toEqual({ kind: 'slice', sliceKey: 'Chrome' });
  expect(model.pick(80, 50)).toEqual({ kind: 'slice', sliceKey: 'Chrome' });
  expect(model.pick(50, 80)).toEqual({ kind: 'slice', sliceKey: 'Safari' });
  expect(model.pick(50, 50)).toBeNull();
  expect(model.pick(50, 5)).toBeNull();
  const target = model.pick(50, 20)!;
  expect(model.tooltip(target)).toMatchObject({ title: 'Chrome', count: 1, total: null,
    rows: [{ value: '46.2%', percent: '46.2%', seriesLabel: 'Chrome', row: 0 }] });
  const anchor = model.anchor(model.primary(target)!);
  expect(anchor?.x).toBeCloseTo(50);
  expect(anchor?.y).toBeCloseTo(10);
  expect(anchor?.width).toBeCloseTo(40);
  expect(anchor?.height).toBeCloseTo(40 * (1 - Math.cos(0.462 * 2 * Math.PI)));
});

it('includes zero and missing slices in keyboard order, with no drawn anchor', () => {
  const zero: DatumRef = { kind: 'slice', sliceKey: 'Zero' };
  const missing: DatumRef = { kind: 'slice', sliceKey: 'No sample' };
  expect(model.count).toBe(8);
  expect(model.step({ kind: 'slice', sliceKey: 'Other' }, 'next')).toEqual(zero);
  expect(model.step(zero, 'next')).toEqual(missing);
  expect(model.ordinal(zero)).toBe(6);
  expect(model.anchor(zero)).toBeNull();
  expect(model.anchor(missing)).toBeNull();
  expect(model.datum(zero)).toMatchObject({ value: '0%', percent: '0%' });
  expect(model.datum(missing)).toMatchObject({ value: 'No data', percent: null });
});

it('picks a small slice in the space it gained while still reading its exact share', () => {
  const data = frame('donut', {
    data: [{ label: 'Large', value: 999 }, { label: 'Zero', value: 0 }, { label: 'Small', value: 1 }],
    label: 'label', value: 'value',
  });
  const layout = plot({ kind: 'ring', cx: 50, cy: 50, r0: 24, r1: 40 });
  const model = buildLookup(donut(data), layout, formatter(data), defaultMessages);
  // One pixel before twelve o'clock at mid-radius is beyond the small slice's proportional angle.
  const x = 50 - 32 * Math.sin(1 / 32);
  const y = 50 - 32 * Math.cos(1 / 32);
  const target = model.pick(x, y);
  const small = { kind: 'slice', sliceKey: 'Small' } as const;
  expect(target).toEqual(small);
  expect(model.tooltip(small).rows).toMatchObject([{ row: 2, value: '1', percent: '0.1%' }]);
  expect(model.anchor(small)?.x).toBeLessThan(x);
});

it('resolves a folded category through Other and returns null for a step that cannot move', () => {
  const original = donut(data);
  const grouped = buildLookup({
    ...original,
    slices: [original.slices[0]!, { key: '__other__', label: 'Other (2)', colorIndex: 1, members: [1, 2], value: 41.6, ratio: 0.416, angles: [3, 6] }],
  }, layout, formatter(data), defaultMessages);
  const stale = { kind: 'slice', sliceKey: 'Safari' } as const;
  expect(grouped.resolve(stale)).toEqual({ kind: 'slice', sliceKey: '__other__' });
  expect(grouped.step(stale, 'previous')).toEqual({ kind: 'slice', sliceKey: 'Chrome' });
  expect(grouped.step(stale, 'page-next')).toBeNull();
  expect(grouped.step(stale, 'last')).toBeNull();
  expect(grouped.step({ kind: 'slice', sliceKey: 'Chrome' }, 'page-previous')).toBeNull();
});

it('formats slice percentages through the supplied formatter regardless of the legacy locale argument', () => {
  const formatters = { ...formatter(data), percent: (ratio: number) => `share(${ratio.toFixed(3)})` };
  const lookup = buildLookup(donut(data), layout, formatters, defaultMessages, 'en-US');
  expect(lookup.datum({ kind: 'slice', sliceKey: 'Chrome' })?.percent).toBe('share(0.462)');
});
