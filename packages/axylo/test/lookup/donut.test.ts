import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
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

describe('a pointer up to 1 CSS px outside the plot picks as on its edge (decision 0004, clarifications)', () => {
  // A ring whose outer edge touches the plot's fractional top and bottom edges.
  const rect = { x: 10.4, y: 20.27, width: 120.3, height: 100.6 };
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const touching = { ...plot({ kind: 'ring', cx, cy, r0: 30, r1: rect.height / 2 }, 150, 140), plot: rect };
  const ring = buildLookup(donut(data), touching, formatter(data), defaultMessages, 'en-US');
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  it('at the top and bottom edges: 0.27, 0.99 and 1 px outside pick the edge slice; 1.01 px nothing', () => {
    for (const [y, out] of [[rect.y, -1], [rect.y + rect.height, 1]] as const) {
      const edge = ring.pick(cx, y);
      expect(edge).toMatchObject({ kind: 'slice' });
      for (const distance of [0.27, 0.99, 1]) expect(ring.pick(cx, y + out * distance)).toEqual(edge);
      expect(ring.pick(cx, y + out * 1.01)).toBeNull();
    }
    expect(ring.pick(cx, rect.y)).toEqual({ kind: 'slice', sliceKey: 'Chrome' });
  });

  it('for any position within 1 px outside, the pick is the pick at the position moved onto the rectangle', () => {
    const unit = fc.oneof(fc.double({ min: 0, max: 1, noNaN: true }), fc.constantFrom(0, 0.5, 1));
    fc.assert(fc.property(unit, unit, (u, v) => {
      const x = rect.x - 1 + u * (rect.width + 2);
      const y = rect.y - 1 + v * (rect.height + 2);
      expect(ring.pick(x, y)).toEqual(ring.pick(clamp(x, rect.x, rect.x + rect.width), clamp(y, rect.y, rect.y + rect.height)));
    }), { numRuns: 2_000 });
  });
});
