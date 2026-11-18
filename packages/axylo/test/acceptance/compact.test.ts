import { expect, it, vi } from 'vitest';
import { aligned, at, axes, chart, codes, committed, message, expectCompact, expectGeometry, lastModel, marks, pathRuns, pixel, plot, points, scene } from './model';

it('C1 compact line: a reference has no effect on the domain or the description and is reported as not applicable', () => {
  const onDiagnostic = vi.fn();
  const r = chart('compact', [{ x: 1, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 4 }], {
    x: { field: 'x', label: 'Day' }, y: { field: 'y', label: 'Energy' },
    reference: [{ y: 1_000, label: 'Target' }], description: 'Collected outdoors.', onDiagnostic,
  });

  const checkCompact = () => {
    r.frames();
    expect(axes(r).y.domain).toEqual([2, 4]);
    expect(lastModel(r).summary).toBe('Line chart with 1 series. Day from 1 to 3. Energy from 2 to 4. '
      + 'Energy: minimum 2, maximum 4, last 4. Collected outdoors.');
    expect(at(r, 1).rows.map(row => row.value)).toEqual(['2']);
    expect(r.controller.handle.diagnostics).toMatchObject([{
      code: 'AX150', level: 'warning', field: 'reference', chart: 'Measurements',
      message: expect.stringContaining('Compact charts draw no references.'),
    }]);
    expectCompact(r);
  };

  checkCompact();
  expect(onDiagnostic).toHaveBeenCalledTimes(1);
  r.controller.handle.update({ description: 'Collected outdoors.' });
  checkCompact();
  expect(onDiagnostic).toHaveBeenCalledTimes(1);

  r.controller.handle.update({ compact: false });
  r.frames();
  expect(axes(r).y.domain).toEqual([0, 1_000]);
  expect(lastModel(r).summary).toContain('Reference line Target at 1,000.');
  expect(committed(r).reader.table?.caption).toContain('Reference line Target at 1,000.');
  expect(codes(r)).toEqual([]);

  r.controller.handle.update({ compact: true });
  checkCompact();
  expect(onDiagnostic).toHaveBeenCalledTimes(2);
});

for (const kind of aligned) {
  it(`C1 compact: ${kind} has a name and full summary, and the committed model is static`, () => {
    const r = chart('compact', [{ x: 1, y: 6 }, { x: 2, y: 4 }, { x: 3, y: 8 }], {
      title: undefined, description: 'Collected outdoors.',
    }, undefined, kind);
    r.frames();
    expect(codes(r)).toEqual(['AX140']);
    const capitalized = kind[0]!.toUpperCase() + kind.slice(1);
    expect(lastModel(r)).toMatchObject({ compact: true, name: message('chartName', { type: capitalized, x: 'x', y: 'y' }), summaryVisible: false });
    expect(lastModel(r).summary).toContain('1 series');
    expect(lastModel(r).summary).toContain('x from 1 to 3');
    expect(lastModel(r).summary).toContain(message('seriesSummary', { series: 'y', min: 4, max: 8, last: 8 }));
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
    expect(lastModel(r).summary).toContain(message('seriesSummary', { series: 'y', min: 4, max: 8, last: 8 }));
    r.controller.handle.zoom([1, 2]);
    r.frames();
    expect(scene(r)).toEqual(initial);
    r.controller.handle.update({ data: [{ x: 3, y: 20 }, { x: 1, y: 5 }, { x: 2, y: 9 }] });
    expect(scene(r)).toBe(initial);
    expect(r.frames()).toBe(1);
    expect(scene(r)).not.toEqual(initial);
    expect(lastModel(r).summary).toContain(message('seriesSummary', { series: 'y', min: 5, max: 20, last: 20 }));
    // Sorted: the rows came as x 3, 1, 2; the geometry runs in x order, 1, 2, 3, with the values 5, 9, 20.
    const { x, y } = axes(r);
    if (kind === 'bar') {
      const bars = marks(r, 'rects').find(mark => mark.variant === 'bar')!.xywh;
      const tops = [0, 4, 8].map(i => [bars[i]! + bars[i + 2]! / 2, Math.min(bars[i + 1]!, bars[i + 1]! + bars[i + 3]!)] as const);
      expect(tops.map(top => top[0])).toEqual([...tops.map(top => top[0])].sort((a, b) => a - b));
      expectGeometry(tops.map(top => top[1]), [y.map(5), y.map(9), y.map(20)]);
    } else {
      const vertices = points(marks(r, 'path')[0]!.xy);
      expectGeometry(vertices.flat(), [1, 2, 3].flatMap((at, i) => [pixel(x, at), y.map([5, 9, 20][i]!)]));
    }
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
    expect(lastModel(r).summary).toContain(message('seriesSummary', { series: 'y', min: 4, max: 6, last: 6 }));
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
