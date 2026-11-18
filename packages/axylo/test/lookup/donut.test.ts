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
