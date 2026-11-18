import { expect, it } from 'vitest';
import { aligned, axes, chart, codes, committed, expectCompact, lastModel, marks, pathRuns, plot, scene } from './model';

for (const kind of aligned) {
  it(`C1 compact: ${kind} has a name and full summary, and the committed model is static`, () => {
    const r = chart('compact', [{ x: 1, y: 6 }, { x: 2, y: 4 }, { x: 3, y: 8 }], {
      title: undefined, description: 'Collected outdoors.',
    }, undefined, kind);
    r.frames();
    expect(codes(r)).toEqual(['AX140']);
    const capitalized = kind[0]!.toUpperCase() + kind.slice(1);
    expect(lastModel(r)).toMatchObject({ compact: true, name: capitalized + ' chart of y by x', summaryVisible: false });
    expect(lastModel(r).summary).toContain('1 series');
    expect(lastModel(r).summary).toContain('x from 1 to 3');
    expect(lastModel(r).summary).toContain('minimum 4, maximum 8, last 8');
    expect(lastModel(r).summary).toContain('Collected outdoors.');
    expectCompact(r);
  });

  it(`C2 compact: ${kind} draws only data marks, commits the sorted final geometry in one frame, and ignores public zoom`, () => {
    const r = chart('compact', [{ x: 3, y: 8 }, { x: 1, y: 6 }, { x: 2, y: 4 }], {
      reference: [{ y: 10, label: 'Target' }],
    }, undefined, kind);
    r.frames();
    const initial = scene(r);
    expect(initial.marks.length).toBeGreaterThan(0);
    expect(initial.marks.every(mark => ['rects', 'area', 'path', 'points'].includes(mark.type))).toBe(true);
    expect(lastModel(r).summary).toContain('last 8');
    r.controller.handle.zoom([1, 2]);
    r.frames();
    expect(scene(r)).toEqual(initial);
    r.controller.handle.update({ data: [{ x: 3, y: 20 }, { x: 1, y: 5 }, { x: 2, y: 9 }] });
    expect(scene(r)).toBe(initial);
    expect(r.frames()).toBe(1);
    expect(scene(r)).not.toEqual(initial);
    expect(lastModel(r).summary).toContain('minimum 5, maximum 20, last 20');
    expectCompact(r);
  });

  it(`C3 compact: ${kind} fills a 24 by 16 CSS-pixel container and expands when measured (reading: stroke clearance can sit inside the container)`, () => {
    const r = chart('compact', [{ x: 1, y: 3 }, { x: 2, y: 8 }], {}, { container: { width: 24, height: 16 } }, kind);
    r.frames();
    const initial = plot(r);
    expect(initial).toMatchObject({ kind: 'compact', width: 24, height: 16 });
    expect(initial.plot.width).toBeGreaterThan(0);
    expect(initial.plot.height).toBeGreaterThan(0);
    expect(scene(r).marks.length).toBeGreaterThan(0);
    r.container = { width: 137, height: 32 };
    r.controller.invalidate.resize();
    r.frames();
    expect(plot(r)).toMatchObject({ kind: 'compact', width: 137, height: 32 });
    expect(plot(r).plot.width).toBeGreaterThan(initial.plot.width);
    expect(plot(r).plot.height).toBeGreaterThan(initial.plot.height);
    expect(codes(r)).toEqual([]);
  });

  it(`C5 compact: ${kind} supplies omission text for the corner marker and summary (reading: neither refers to an unavailable table)`, () => {
    const r = chart('compact', [{ x: 1, y: 4 }, { x: 2, y: Infinity }, { x: 3, y: 6 }], {}, undefined, kind);
    r.frames();
    expect(codes(r)).toEqual(['AX103']);
    expect(lastModel(r).compact).toBe(true);
    expect(lastModel(r).note).toContain('Values not shown: 1.');
    expect(lastModel(r).summary).toContain('Values not shown: 1.');
    expect(lastModel(r).summary).toContain('minimum 4, maximum 6, last 6');
    expectCompact(r);
    expect(committed(r).reader.table).toBeNull();
    expect(lastModel(r).note).not.toContain('See table');
    expect(lastModel(r).summary).not.toContain('See table');
  });
}

for (const kind of ['line', 'area'] as const) {
  it(`C4 compact: two ${kind} strokes use distinct paint bindings and dashes and AX131 suggests one series`, () => {
    const r = chart('compact', [{ x: 1, a: 3, b: 7 }, { x: 2, a: 4, b: 5 }], { y: ['a', 'b'] }, undefined, kind);
    r.frames();
    const [first, second] = marks(r, 'path');
    expect(first?.stroke).toEqual({ kind: 'series', index: 0 });
    expect(second?.stroke).toEqual({ kind: 'series', index: 1 });
    expect(first?.dash.normal).not.toEqual(second?.dash.normal);
    expect(pathRuns(first!.xy)[0]).toHaveLength(2);
    expect(axes(r).y.domain[1]).toBeGreaterThanOrEqual(7);
    expect(r.controller.handle.diagnostics).toMatchObject([{ code: 'AX131', message: expect.stringMatching(/one series/i) }]);
    expectCompact(r);
  });
}
