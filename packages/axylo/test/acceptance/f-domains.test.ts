import fc from 'fast-check';
import { expect, it } from 'vitest';
import { axes, chart, codes, committed, expectCompact, expectGeometry, expectValues, lastModel, marks, plot, points, rows } from './model';

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
    }), { numRuns: 1_000, seed: 4026 });
  });

  it(`F1 ${type}: ${kind} draws the 82 to 97 fixture from zero and reads the actual values`, () => {
    const r = chart(type, [{ x: 'Floor', y: 82 }, { x: 'Ceiling', y: 97 }], { y: { field: 'y', domain: [80, 100] } }, undefined, kind);
    r.frames();
    expect(axes(r).y.domain).toEqual([0, 100]);
    expect(codes(r)).toEqual(['AX110']);
    expect(lastModel(r).summary).toContain('minimum 82, maximum 97, last 97');
    expect(lastModel(r).note).toBeNull();
    if (type === 'compact') expectCompact(r);
    else {
      expect(rows(r)).toEqual([['Floor', '82'], ['Ceiling', '97']]);
      expectValues(r, 0, ['82']);
      expectValues(r, 1, ['97']);
    }
  });
}

for (const type of ['line', 'area', 'bar', 'scatter', 'compact'] as const) {
  it(`F7 ${type}: for any generated extents the automatic domain includes data and references and the zoom stays inside its governing domain`, () => {
    fc.assert(fc.property(fc.integer({ min: 6, max: 40 }), fc.integer({ min: 41, max: 70 }), fc.boolean(), (max, reference, authored) => {
      const r = chart(type, [{ x: 2, y: -5 }, { x: 4, y: max }], {
        x: { field: 'x', domain: authored ? [0, 10] : undefined }, reference: [{ x: 8, label: 'Deadline' }, { y: reference, label: 'Target' }],
      });
      r.frames();
      const initial = axes(r);
      expect(initial.y.domain[0]).toBeLessThanOrEqual(-5);
      expect(initial.y.domain[1]).toBeGreaterThanOrEqual(reference);
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
    }), { numRuns: 1_000, seed: 4026 });
  });

  for (const [scale, small, half, full, above] of [['percent', 4, 50, 100, 110], ['ratio', 0.04, 0.5, 1, 1.1]] as const) {
    it(`F7 ${type}: declared ${scale} reaches full scale at half scale while a small maximum uses the first tick`, () => {
      for (const [maximum, relation] of [[small, 'below'], [half, 'full'], [full, 'full'], [above, 'above']] as const) {
        const r = chart(type, pair(maximum), { y: { field: 'y', scale } });
        r.frames();
        const upper = axes(r).y.domain[1];
        if (relation === 'below') expect(upper).toBeLessThan(full);
        if (relation === 'full') expect(upper).toBe(full);
        if (relation === 'above') expect(upper).toBeGreaterThan(full);
        expect(upper).toBeGreaterThanOrEqual(maximum);
      }
      const labelOnly = chart(type, pair(half), { y: { field: 'y', label: 'Percent (%)' } });
      labelOnly.frames();
      expect(axes(labelOnly).y.domain[1]).toBeLessThan(full);
    });
  }
}

for (const type of ['line', 'area', 'bar', 'scatter'] as const) {
  it(`F7 ${type}: for any generated reference extreme the automatic value domain ends at the first drawn tick that reaches it (reading: the tick is the one the reader sees)`, () => {
    fc.assert(fc.property(fc.integer({ min: 41, max: 70 }), reference => {
      const r = chart(type, [{ x: 2, y: -5 }, { x: 4, y: 6 }], { reference: [{ y: reference, label: 'Target' }] });
      r.frames();
      const layout = plot(r);
      if (layout.kind !== 'plot') throw new Error('Expected tick labels');
      const { domain } = axes(r).y;
      expect(layout.yTicks[0]?.value).toBe(domain[0]);
      expect(domain[1]).toBe(layout.yTicks.find(tick => tick.value >= reference)?.value);
    }), { numRuns: 1_000, seed: 4026 });
  });
}
