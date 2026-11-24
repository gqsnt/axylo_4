import fc from 'fast-check';
import { expect, it, vi } from 'vitest';
import { donutGeometry } from '../../src/view/donut-geometry';
import { aligned, donut } from './fixtures';

const ring = { kind: 'ring', cx: 0, cy: 0 } as const;
const slices = donut([{ label: 'Large', value: 1 }, { label: 'Small', value: 1e-20 }]).view.slices;

it.each([[0, 0], [4, 4], [2, 1], [0, -1]])('draws no angles for an unusable ring (%s, %s)', (r0, r1) => {
  expect(donutGeometry(slices, { ...ring, r0, r1 })).toEqual({ drawn: [], angles: new Float32Array(0) });
});

it('keeps the separator angle finite when one pixel is wider than the ring', () => {
  const asin = vi.spyOn(Math, 'asin');
  try {
    donutGeometry(slices, { ...ring, r0: 0.1, r1: 0.2 });
    expect(asin.mock.results.every(result => Number.isFinite(result.value))).toBe(true);
  } finally {
    asin.mockRestore();
  }
});

it('keeps clockwise packed angles ordered through the final slice (F8)', () => {
  fc.assert(fc.property(fc.double({ min: 0.01, max: 0.5, noNaN: true }), r1 => {
    const { drawn, angles } = donutGeometry(slices, { ...ring, r0: 0, r1 });
    expect(drawn).toEqual(slices);
    expect(angles).toHaveLength(4);
    expect(angles[0]).toBe(0);
    expect(angles[1]).toBe(angles[2]);
    expect(angles[2]!).toBeLessThanOrEqual(angles[3]!);
    expect(angles[3]!).toBeLessThanOrEqual(2 * Math.PI);
    expect(angles[3]).toBeCloseTo(2 * Math.PI, 6);
  }));
});

it('reports invalid temporal domain bounds and keeps the data visible (F3, F4, F7)', () => {
  const times = [Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 2)];
  const { view, diagnostics } = aligned({
    x: { field: 't', type: 'time' }, y: 'v', data: times.map(t => ({ t, v: 2 })),
  }, { kind: 'line', xDomain: [1e20, 2e20] });
  expect(diagnostics.inputs()).toContainEqual(expect.objectContaining({ code: 'AX107', field: 'x.domain', effect: 'none' }));
  expect(view.xDomain).toEqual(times);
  expect(view.visibleSlots).toEqual({ start: 0, end: 2 });
});
