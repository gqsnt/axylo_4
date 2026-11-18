import fc from 'fast-check';
import { expect, it } from 'vitest';
import { axes, chart, codes, committed, compactKinds, message, expectCompact, expectGeometry, expectValues, lastModel, marks, plot, points, rows } from './model';

const pair = (value: number) => [{ x: 1, y: value }, { x: 2, y: value }];

for (const [type, kind] of [['area', 'area'], ['bar', 'bar'], ['compact', 'area'], ['compact', 'bar']] as const) {
  it(`F1 ${type}: for any generated signed ${kind} data the value domain and drawn baseline include zero, even with an excluding author domain`, () => {
    const values = fc.integer({ min: -100, max: 100 });
    fc.assert(fc.property(values, values, fc.boolean(), (a, b, authored) => {
      const domain = authored ? (a < 0 && b < 0 ? [-120, -1] : [1, 120]) : undefined;
      const r = chart(type, [{ x: 1, y: a }, { x: 2, y: b }], { y: { field: 'y', domain } }, undefined, kind);
      r.frames();
      const { y } = axes(r);
      expect(y.domain[0]).toBeLessThanOrEqual(0);
      expect(y.domain[1]).toBeGreaterThanOrEqual(0);
      if (authored) {
        expect(y.domain).toEqual(domain![0]! < 0 ? [-120, 0] : [0, 120]);
        expect(codes(r)).toEqual(['AX110']);
      } else {
        expect(y.domain[0]).toBeLessThanOrEqual(Math.min(a, b));
        expect(y.domain[1]).toBeGreaterThanOrEqual(Math.max(a, b));
        expect(codes(r)).toEqual([]);
      }
      const baseline = y.map(0);
      if (kind === 'area') {
        const lower = points(marks(r, 'area')[0]!.lower);
        expectGeometry(lower.map(p => p[1]), [baseline, baseline]);
      } else {
        const { xywh } = marks(r, 'rects')[0]!;
        expect(xywh).toHaveLength(8);
        for (const i of [0, 4]) expect(Math.min(Math.abs(xywh[i + 1]! - baseline), Math.abs(xywh[i + 1]! + xywh[i + 3]! - baseline))).toBeLessThan(0.001);
      }
    }), { numRuns: 1_000 });
  });

  it(`F1 ${type}: ${kind} draws the 82 to 97 fixture from zero and reads the actual values`, () => {
    const r = chart(type, [{ x: 'Floor', y: 82 }, { x: 'Ceiling', y: 97 }], { y: { field: 'y', domain: [80, 100] } }, undefined, kind);
    r.frames();
    expect(axes(r).y.domain).toEqual([0, 100]);
    expect(codes(r)).toEqual(['AX110']);
    expect(lastModel(r).summary).toContain(message('seriesSummary', { series: 'y', min: '82', max: '97', last: '97' }));
    expect(lastModel(r).note).toBeNull();
    if (type === 'compact') expectCompact(r);
    else {
      expect(rows(r)).toEqual([['Floor', '82'], ['Ceiling', '97']]);
      expectValues(r, 0, ['82']);
      expectValues(r, 1, ['97']);
    }
  });
}

function firstTicks(r: ReturnType<typeof chart>, min: number, max: number, full?: number) {
  const layout = plot(r);
  if (min === max) return; // A constant dataset needs a nonzero domain to show a plot.
  if (layout.kind !== 'plot') return;
  const { domain } = axes(r).y;
  const ticks = layout.yTicks.map(tick => tick.value);
  expect(domain[0]).toBe(ticks.filter(tick => tick <= min).at(-1));
  expect(domain[1]).toBe(full ?? ticks.find(tick => tick >= max));
}

for (const type of ['line', 'area', 'bar', 'scatter', 'compact'] as const) {
  it(`F7 ${type}: for any generated extents the automatic domain includes data and references and the zoom stays inside its governing domain`, () => {
    for (const kind of compactKinds(type)) {
      const value = fc.integer({ min: -1_000, max: 1_000 }).map(value => value / 10);
      fc.assert(fc.property(value, value, value, fc.boolean(), (a, b, reference, authored) => {
        const r = chart(type, [{ x: 2, y: a }, { x: 4, y: b }], {
          x: { field: 'x', domain: authored ? [0, 10] : undefined }, reference: [{ x: 8, label: 'Deadline' }, { y: reference, label: 'Target' }],
        }, undefined, kind);
        r.frames();
        const initial = axes(r);
        const zero = type === 'bar' || type === 'area' || type === 'compact' && kind !== 'line';
        const lo = Math.min(a, b, reference, ...(zero ? [0] : []));
        const hi = Math.max(a, b, reference, ...(zero ? [0] : []));
        expect(initial.y.domain[0]).toBeLessThanOrEqual(lo);
        expect(initial.y.domain[1]).toBeGreaterThanOrEqual(hi);
        firstTicks(r, lo, hi);
        if (initial.x.type === 'band') throw new Error('Expected a continuous x axis');
        if (authored) expect(initial.x.domain).toEqual([0, 10]);
        else expect(initial.x.domain[1]).toBeGreaterThanOrEqual(8);
        r.controller.handle.zoom([-20, -17]);
        r.frames();
        const view = committed(r).view;
        if (view.kind === 'donut') throw new Error('Expected Cartesian view');
        if (type === 'compact') expect(view.xDomain).toEqual(initial.x.domain);
        else {
          expect(view.xDomain[0]).toBe(initial.x.domain[0]);
          expect(view.xDomain[1]).toBe(initial.x.domain[0] + 3);
          expect(view.xDomain[1]).toBeLessThanOrEqual(initial.x.domain[1]);
        }
      }), { numRuns: 1_000, examples: [[0, -0.8, 0.1, false]] });
    }
  });

  for (const [scale, full] of [['percent', 100], ['ratio', 1]] as const) {
    it(`F7 ${type}: declared ${scale} reaches full scale at half scale while a small maximum uses the first tick`, () => {
      for (const kind of compactKinds(type)) {
        const small = 0.04 * full;
        for (const maximum of [small, full / 2, full, 1.1 * full]) {
          const minimum = -0.01 * full;
          const r = chart(type, [{ x: 1, y: minimum }, { x: 2, y: maximum }], { y: { field: 'y', scale } }, undefined, kind);
          r.frames();
          const { domain } = axes(r).y;
          const atFull = maximum >= full / 2 && maximum <= full;
          expect(domain[0]).toBeLessThanOrEqual(minimum);
          expect(domain[1]).toBeGreaterThanOrEqual(maximum);
          // [-1, 4] (or [-0.01, 0.04]) has exact endpoints on the first 1% ticks.
          if (maximum === small) expect(domain).toEqual([minimum, small]);
          firstTicks(r, minimum, maximum, atFull ? full : undefined);
          if (atFull) expect(domain[1]).toBe(full);
        }
        const labelOnly = chart(type, pair(full / 2), { y: { field: 'y', label: 'Percent (%)' } }, undefined, kind);
        labelOnly.frames();
        expect(axes(labelOnly).y.domain[1]).toBeLessThan(full);
      }
    });
  }
}

for (const type of ['line', 'area', 'bar', 'scatter'] as const) {
  it(`F7 ${type}: for any generated reference extreme the automatic value domain ends at the first drawn tick that reaches it (reading: the tick is the one the reader sees)`, () => {
    const value = fc.integer({ min: 5, max: 100 });
    fc.assert(fc.property(value, value, fc.boolean(), (low, high, upper) => {
      const reference = upper ? high : -low;
      const r = chart(type, [{ x: 2, y: upper ? -low : -1 }, { x: 4, y: upper ? 1 : high }], { reference: [{ y: reference, label: 'Target' }] });
      r.frames();
      firstTicks(r, -low, high);
    }), { numRuns: 1_000 });
  });
}

it('F7 line: finite data spanning extreme magnitudes remains in the finite value domain', () => {
  const exponent = fc.constantFrom(-300, -225, -50, 50, 225, 300);
  fc.assert(fc.property(exponent, exponent, fc.double({ min: 1, max: 9, noNaN: true }), (lo, hi, factor) => {
    const a = -factor * 10 ** lo;
    const b = factor * 10 ** hi;
    const r = chart('line', [{ x: 1, y: a }, { x: 2, y: b }]);
    r.frames();
    const { y } = axes(r);
    expect(y.domain.every(Number.isFinite)).toBe(true);
    expect(y.domain[0]).toBeLessThanOrEqual(a);
    expect(y.domain[1]).toBeGreaterThanOrEqual(b);
    expectGeometry(points(marks(r, 'path')[0]!.xy).map(point => point[1]), [y.map(a), y.map(b)]);
  }), { numRuns: 1_000 });
});
