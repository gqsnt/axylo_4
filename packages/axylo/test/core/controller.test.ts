/**
 * The controller's commit contract (plan 1.5, 2.2; spec 3.5, DX5), driven in Node through a recording host
 * with a manual animation-frame queue (test/core/host.ts). One block per finding of the core review
 * (reviews/2026-11-18/impl/wp/core1.review.md); expected values come from the plan and the spec.
 */
import { describe, expect, it } from 'vitest';
import type { AlignedView, DatumRef, DonutView, ScatterView } from '../../src/core/contracts';
import type { Diagnostic, Point } from '../../src/public';
import { validate } from '../../src/index';
import { lastModel, record, type Recording } from './host';

const codes = (list: readonly { code: string }[]) => list.map(d => d.code).sort();
const describeOf = (r: Recording) => r.controller.handle.__bench!.describe();
const stages = (r: Recording) => r.controller.handle.__dev!.stages();
const xs = (r: Recording) => {
  const view = r.committed!.view as AlignedView;
  return Array.from(view.frame.x.values);
};
const rowsOf = (values: readonly number[], field = 'y') => values.map(x => ({ x, [field]: x * 10 }));

function catching(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

describe('finding 1: a strict append is prepared, validated with its view, and only then committed', () => {
  it('a ninth series is rejected (AX130), leaves store, frame, view and diagnostics as they were, and later appends work', () => {
    const series = Array.from({ length: 8 }, (_, i) => `S${i}`);
    const data = series.flatMap(s => [{ x: 1, s, y: 1 }, { x: 2, s, y: 2 }]);
    const r = record('line', { title: 'Strict', strict: true, data, x: 'x', y: 'y', series: 's' });
    r.frames();
    const chart = r.controller.handle;
    const before = { diagnostics: chart.diagnostics, describe: describeOf(r), revision: chart.__bench!.revision };
    const error = catching(() => chart.append([{ x: 3, s: 'S8', y: 3 }]));
    expect(String(error)).toMatch(/AX130/);
    r.frames();
    expect(chart.diagnostics).toEqual(before.diagnostics);
    expect(describeOf(r)).toEqual(before.describe);
    expect(chart.__bench!.revision).toBe(before.revision);
    // A valid append to an existing series goes through.
    chart.append([{ x: 3, s: 'S0', y: 3 }]);
    r.frames();
    expect(describeOf(r).series.length).toBe(8);
    expect(describeOf(r).series[0]!.newestX).toBe(3);
    // The rejected ninth series never entered the store.
    chart.update({ strict: false });
    r.frames();
    expect(describeOf(r).series.map(s => s.key)).toEqual(series);
  });

  it('a rejected strict append is still delivered to onDiagnostic and the console, without replacing diagnostics', () => {
    const seen: Diagnostic[] = [];
    const r = record('line', { title: 'Strict', strict: true, data: rowsOf([1, 2]), x: 'x', y: 'y', onDiagnostic: (d: Diagnostic) => seen.push(d) });
    r.frames();
    expect(catching(() => r.controller.handle.append([{ x: 3, y: NaN }]))).toBeTruthy();
    expect(codes(seen)).toEqual(['AX103']);
    expect(r.printed.some(line => line.includes('AX103'))).toBe(true);
    expect(r.controller.handle.diagnostics).toEqual([]);
  });
});

describe('finding 2: an encoding change after streaming re-encodes the retained rows', () => {
  it('[1,2,3] + 4 with keep 2 shows [3,4]; a new y field keeps [3,4] in a new epoch, and focus refs are cleared', () => {
    const data = [1, 2, 3].map(x => ({ x, a: x, b: -x }));
    const r = record('line', { title: 'Stream', data, x: 'x', y: 'a' });
    r.frames();
    r.controller.handle.append([{ x: 4, a: 4, b: -4 }], { keep: 2 });
    r.frames();
    expect(xs(r)).toEqual([3, 4]);
    const epoch = r.committed!.epoch;
    r.controller.handle.update({ y: 'b' });
    r.frames();
    expect(xs(r)).toEqual([3, 4]);
    const view = r.committed!.view as AlignedView;
    expect(Array.from(view.frame.series[0]!.y)).toEqual([-3, -4]);
    expect(r.committed!.epoch).toBeGreaterThan(epoch);
  });

  it('a chart created empty and filled by append keeps its rows when re-encoded', () => {
    const r = record('line', { title: 'Empty', data: [], x: 'x', y: 'a' });
    r.frames();
    r.controller.handle.append([{ x: 1, a: 1, b: 2 }, { x: 2, a: 2, b: 3 }]);
    r.frames();
    r.controller.handle.update({ y: 'b' });
    r.frames();
    expect(xs(r)).toEqual([1, 2]);
  });

  it('update({ data }) replaces the stream, even with the original array', () => {
    const data = rowsOf([1, 2, 3]);
    const r = record('line', { title: 'Replace', data, x: 'x', y: 'y' });
    r.frames();
    r.controller.handle.append([{ x: 4, y: 40 }]);
    r.frames();
    expect(xs(r)).toEqual([1, 2, 3, 4]);
    r.controller.handle.update({ data });
    r.frames();
    expect(xs(r)).toEqual([1, 2, 3]);
  });
});

describe('finding 3: rows of the displayed revision stay readable until the frame that replaced it is drawn', () => {
  it('appending with keep 1 does not change a hover on the frame still shown', () => {
    const data = [0, 1, 2].map(x => ({ x, y: x }));
    const r = record('line', { title: 'Evict', data, x: 'x', y: 'y' });
    r.frames();
    const hovers: (Point<unknown> | null)[] = [];
    r.controller.handle.on('hover', p => hovers.push(p));
    r.controller.handle.append([{ x: 3, y: 3 }], { keep: 1 });
    const ref: DatumRef = { kind: 'aligned', seriesKey: 'y', x: 0 };
    r.controller.actions.hover(ref);
    expect(hovers[0]).toEqual({ series: 'y', x: 0, y: 0, row: data[0], index: 0 });
    r.frames();
    expect(xs(r)).toEqual([3]);
    // Once the new frame is drawn the old revision is retired: only the kept row is held.
    expect(r.controller.handle.__dev!.retainedRows()).toBe(1);
  });
});

describe('finding 4: an internal failure publishes a complete error revision, and recovery redraws everything', () => {
  it('after a failing frame the pointer finds nothing; once the cause is gone an update draws axis labels again', async () => {
    const r = record('line', { title: 'Fail', data: rowsOf([1, 2, 3, 4]), x: 'x', y: 'y' });
    r.frames();
    const labels = r.texts.at(-1)!.length;
    expect(labels).toBeGreaterThan(2);
    const hovers: unknown[] = [];
    r.controller.handle.on('hover', p => hovers.push(p));
    r.controller.handle.__dev!.fail('reader');
    r.controller.handle.update({ title: 'Fail 2' });
    r.frames();
    expect(lastModel(r).message).toBe('Something went wrong while drawing the chart.');
    expect(r.committed).toBeNull();
    expect(r.texts.at(-1)).toEqual([]);
    expect(codes(r.controller.handle.diagnostics)).toEqual(['AX199']);
    r.controller.actions.hover({ kind: 'aligned', seriesKey: 'y', x: 2 });
    expect(hovers).toEqual([null]);
    // Readiness settles on the error revision.
    await r.controller.handle.__bench!.ready();
    r.controller.handle.__dev!.fail(null);
    r.controller.handle.update({ title: 'Recovered' });
    r.frames();
    expect(lastModel(r).message).toBeNull();
    expect(r.texts.at(-1)!.length).toBe(labels);
    expect(r.committed?.ready).toBe(true);
    expect(r.controller.handle.diagnostics).toEqual([]);
  });
});

describe('finding 5: zoom and select events', () => {
  it('a zoom from the controls fires zoom with the window as the author writes it; a select fires select', () => {
    const r = record('line', { title: 'Events', data: rowsOf([0, 5, 10]), x: 'x', y: 'y' });
    r.frames();
    const zooms: unknown[] = [];
    const selects: unknown[] = [];
    r.controller.handle.on('zoom', w => zooms.push(w));
    r.controller.handle.on('select', p => selects.push(p));
    r.controller.actions.zoom([5, 10]);
    r.controller.actions.zoom(null);
    r.frames();
    r.controller.actions.select({ kind: 'aligned', seriesKey: 'y', x: 5 });
    expect(zooms).toEqual([[5, 10], null]);
    expect(selects).toEqual([{ series: 'y', x: 5, y: 50, row: { x: 5, y: 50 }, index: 1 }]);
  });
});

describe('finding 6: author callbacks cannot repeat a delivery or continue work after destruction', () => {
  it('an onDiagnostic that updates the description is given each diagnostic once', () => {
    const seen: string[] = [];
    let chart: Recording['controller']['handle'] | null = null;
    let nested = 0;
    const r = record('line', {
      title: 'Named', data: rowsOf([1, 2]), x: 'x', y: 'y',
      onDiagnostic: (d: Diagnostic) => {
        seen.push(d.code);
        if (chart) { nested += 1; chart.update({ description: `seen ${seen.length}` }); }
      },
    });
    chart = r.controller.handle;
    // AX140 arrives after `chart` is assigned, so the nested update really runs (controller review, finding 20).
    chart.update({ title: undefined });
    chart.update({ subtitle: 'again' });
    r.frames();
    expect(nested).toBe(1);
    expect(seen).toEqual(['AX140']);
    expect(lastModel(r).summary).toContain('seen 1');
  });

  it('an onDiagnostic that destroys the chart on its first diagnostic receives no other', () => {
    const seen: string[] = [];
    const r = record('line', { title: 'Clean', data: rowsOf([1, 2]), x: 'x', y: 'y' });
    const chart = r.controller.handle;
    // Three findings (AX103, AX106, AX140) arrive with one update; the handler destroys on the first.
    chart.update({
      title: undefined, data: [{ x: 1, y: NaN }, { x: 2, y: '3' }, { x: 3, y: 1 }],
      onDiagnostic: (d: Diagnostic) => { seen.push(d.code); chart.destroy(); },
    });
    r.frames();
    expect(seen.length).toBe(1);
    expect(r.draws.length).toBe(0);
    expect(r.disposed).toBe(1);
  });

  it('a hover listener that destroys the chart stops the listeners after it', () => {
    const r = record('line', { title: 'H', data: rowsOf([1, 2]), x: 'x', y: 'y' });
    r.frames();
    const calls: string[] = [];
    r.controller.handle.on('hover', () => { calls.push('first'); r.controller.handle.destroy(); });
    r.controller.handle.on('hover', () => { calls.push('second'); });
    r.controller.actions.hover({ kind: 'aligned', seriesKey: 'y', x: 1 });
    expect(calls).toEqual(['first']);
  });

  it('a formatter that destroys the chart during a frame stops that frame before anything is drawn', () => {
    let destroy = (): void => {};
    const r = record('line', {
      title: 'F', data: rowsOf([1, 2]), x: 'x',
      y: { field: 'y', format: (v: number) => { destroy(); return String(v); } },
    });
    destroy = () => r.controller.handle.destroy();
    r.frames();
    expect(r.draws.length).toBe(0);
    expect(r.commits).toBe(0);
    expect(r.disposed).toBe(1);
    expect(describeOf(r)).toEqual({ xDomain: null, yDomain: null, series: [], plot: null, renderer: 'svg' });
  });
});

describe('finding 7: scatter and donut append through their stores', () => {
  it('scatter [10, 20] + 5 with keep 2 keeps the latest two x positions [10, 20] and raises AX151', () => {
    const r = record('scatter', { title: 'S', data: [{ x: 10, y: 1 }, { x: 20, y: 2 }], x: 'x', y: 'y' });
    r.frames();
    r.controller.handle.append([{ x: 5, y: 3 }], { keep: 2 });
    r.frames();
    const view = r.committed!.view as ScatterView;
    expect(Array.from(view.frame.series[0]!.x)).toEqual([10, 20]);
    expect(codes(r.controller.handle.diagnostics)).toContain('AX151');
  });

  it('a silent NaN in typed columns stays silent after a clean append (scatter and donut)', () => {
    const s = record('scatter', { title: 'S', data: { columns: { x: Float64Array.of(1, 2, 3), y: Float64Array.of(1, NaN, 3) } }, x: 'x', y: 'y' });
    s.frames();
    s.controller.handle.append([{ x: 4, y: 4 }]);
    s.frames();
    expect(s.controller.handle.diagnostics).toEqual([]);
    const d = record('donut', { title: 'D', data: { columns: { label: ['a', 'b'], value: Float64Array.of(1, NaN) } }, label: 'label', value: 'value' });
    d.frames();
    d.controller.handle.append([{ label: 'c', value: 2 }]);
    d.frames();
    expect(d.controller.handle.diagnostics).toEqual([]);
    expect((d.committed!.view as DonutView).frame.labels).toEqual(['a', 'b', 'c']);
  });

  it('while paused, scatter and donut validate appended rows when append is called', () => {
    const r = record('scatter', { title: 'P', strict: true, data: [{ x: 1, y: 1 }], x: 'x', y: 'y' });
    r.frames();
    r.controller.handle.append([{ x: 2, y: 2 }]);
    r.controller.actions.pause(true);
    r.frames();
    expect(String(catching(() => r.controller.handle.append([{ x: 3, y: NaN }])))).toMatch(/AX103/);
    r.controller.handle.append([{ x: 3, y: 3 }]);
    r.frames();
    expect(Array.from((r.committed!.view as ScatterView).frame.series[0]!.x)).toEqual([1, 2]);
    r.controller.actions.pause(false);
    r.frames();
    expect(Array.from((r.committed!.view as ScatterView).frame.series[0]!.x)).toEqual([1, 2, 3]);
  });
});

describe('finding 8: "nothing to show" comes from what the view draws', () => {
  it('a line segment that crosses a zoomed window between its two points is drawn, not "No data"', () => {
    const r = record('line', { title: 'Z', data: [{ x: 0, y: 0 }, { x: 10, y: 10 }], x: 'x', y: 'y' });
    r.controller.handle.zoom([2, 4]);
    r.frames();
    expect(lastModel(r).message).toBeNull();
    expect(r.draws.at(-1)!.marks.some(m => m.type === 'path')).toBe(true);
  });

  it('a scatter window with no point shows the empty state, and its zoom can still be reset', () => {
    const r = record('scatter', { title: 'Z', data: [{ x: 0, y: 0 }, { x: 10, y: 10 }], x: 'x', y: 'y' });
    r.controller.handle.zoom([2, 4]);
    r.frames();
    expect(lastModel(r).message).toBe('No data to show.');
    expect(r.prepared.at(-1)!.zoomed).toBe(true);
  });

  it('an all-invalid chart keeps the reader note in its empty state (F12), and the compact marker (C5)', () => {
    const data = [{ x: 1, y: 'n/a' }, { x: 2, y: 'n/a' }];
    const full = record('line', { title: 'Bad', data, x: 'x', y: 'y' });
    full.frames();
    expect(lastModel(full).message).toBe('No data to show.');
    expect(lastModel(full).note).toMatch(/Values not shown: 2/);
    const compact = record('line', { title: 'Bad', compact: true, data, x: 'x', y: 'y' });
    compact.frames();
    expect(lastModel(compact).note).toMatch(/Values not shown: 2/);
    expect(lastModel(compact).summary).toMatch(/^No data to show\./);
  });
});

describe('finding 9: the zoom window and the follow flag are reconciled when data or bounds change', () => {
  it('[5,10] of [0,5,10]; data replaced up to 15: the window stays [5,10], and appending 20 does not move it', () => {
    const r = record('line', { title: 'F', data: rowsOf([0, 5, 10]), x: 'x', y: 'y' });
    r.controller.handle.zoom([5, 10]);
    r.controller.handle.update({ data: rowsOf([0, 5, 10, 15]) });
    r.frames();
    expect(describeOf(r).xDomain).toEqual([5, 10]);
    r.controller.handle.append([{ x: 20, y: 200 }]);
    r.frames();
    expect(describeOf(r).xDomain).toEqual([5, 10]);
  });

  it('a window at the latest edge follows appended data', () => {
    const r = record('line', { title: 'F', data: rowsOf([0, 5, 10]), x: 'x', y: 'y' });
    r.controller.handle.zoom([5, 10]);
    r.controller.handle.append([{ x: 15, y: 150 }]);
    r.frames();
    expect(describeOf(r).xDomain).toEqual([10, 15]);
  });
});

describe('finding 10: one set of call-origin diagnostics, whatever the entry point', () => {
  const bar = { title: 'B', data: [{ x: 'a', y: 2 }, { x: 'b', y: 3 }], x: 'x', y: { field: 'y', domain: [1, 3] } } as const;

  it('validate and a created bar chart both report AX110; a clean append keeps it while the domain excludes zero', () => {
    expect(codes(validate('bar', bar as never))).toEqual(['AX110']);
    const r = record('bar', { ...bar });
    expect(codes(r.controller.handle.diagnostics)).toEqual(['AX110']);
    r.controller.handle.append([{ x: 'c', y: 2 }]);
    expect(codes(r.controller.handle.diagnostics)).toEqual(['AX110']);
  });

  it('validate and creation agree on AX130 and AX131 too', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ x: 1, s: `S${i}`, y: i }));
    const options = { title: 'M', data: many, x: 'x', y: 'y', series: 's', compact: true };
    const created = record('line', options).controller.handle.diagnostics;
    expect(codes(validate('line', options as never))).toEqual(codes(created));
    expect(codes(created)).toEqual(['AX130', 'AX131']);
  });

  it('zoom never throws for a value it cannot read: it reports it and keeps the window', () => {
    const seen: string[] = [];
    const r = record('line', { title: 'Z', strict: true, data: rowsOf([1, 2, 3]), x: 'x', y: 'y', onDiagnostic: (d: Diagnostic) => seen.push(d.code) });
    r.controller.handle.zoom([1, 2]);
    expect(() => r.controller.handle.zoom(['oops', 'bad'])).not.toThrow();
    r.frames();
    expect(seen).toEqual(['AX107']);
    expect(r.controller.handle.diagnostics).toEqual([]);
    expect(describeOf(r).xDomain).toEqual([1, 2]);
  });
});

describe('finding 11: presentation diagnostics belong to the stage and revision that found them', () => {
  it('a tick formatter that throws gives AX160 on that frame and no note (a tick label is not a value); a working one retires it', () => {
    const throwing = { field: 'y', tickFormat: () => { throw new Error('tick'); } };
    const r = record('line', { title: 'T', data: rowsOf([1, 2, 3]), x: 'x', y: throwing });
    r.frames();
    expect(codes(r.controller.handle.diagnostics)).toEqual(['AX160']);
    // Closing pass, item 2 (coordinator's decision): a tick-only AX160 has no effect on the figure (F12 is
    // about values left out or changed), so it adds no note.
    expect(lastModel(r).note).toBeNull();
    r.controller.handle.update({ y: { field: 'y', tickFormat: (v: number) => `${v}!` } });
    r.frames();
    expect(r.controller.handle.diagnostics).toEqual([]);
    expect(lastModel(r).note).toBeNull();
  });

  it('a formatter that throws only for a hovered value is delivered when it is found', () => {
    const seen: string[] = [];
    const r = record('line', {
      title: 'H', data: rowsOf([1, 2, 3]), x: 'x', onDiagnostic: (d: Diagnostic) => seen.push(d.code),
      y: { field: 'y', format: (v: number) => { if (v === 20) throw new Error('hovered'); return String(v); } },
    });
    r.frames();
    expect(seen).toEqual([]);
    r.controller.actions.hover({ kind: 'aligned', seriesKey: 'y', x: 2 });
    r.committed!.lookup.tooltip({ kind: 'x', x: 2 });
    expect(seen).toEqual(['AX160']);
  });
});

describe('finding 13: the L8 fallback is stable', () => {
  it('stepping the container one pixel at a time through the boundary, both ways, switches once and never alternates', () => {
    const r = record('line', { title: 'Small', data: rowsOf([1, 2, 3]), x: 'x', y: 'y' });
    const states = (heights: number[]) => heights.map(height => {
      r.container = { width: 400, height };
      r.controller.invalidate.resize();
      r.frames();
      const settled = r.committed!.tooSmall;
      // Ten more frames at the same size change nothing.
      for (let i = 0; i < 10; i++) {
        r.controller.invalidate.resize();
        r.frames();
        expect(r.committed!.tooSmall, `height ${height}, frame ${i}`).toBe(settled);
      }
      return settled;
    });
    const up = Array.from({ length: 80 }, (_, i) => 100 + i);
    const grow = states(up);
    const shrink = states([...up].reverse()).reverse();
    expect(grow).toEqual(shrink);
    const switches = grow.filter((v, i) => i > 0 && v !== grow[i - 1]).length;
    expect(switches).toBe(1);
    expect(grow[0]).toBe(true);
    expect(grow.at(-1)).toBe(false);
  });
});

describe('finding 15: bars on a continuous x use the view domain for ticks, marks and lookup', () => {
  it('with x.domain [0, 20] no tick lies outside [0, 20], and the projection is the view domain', () => {
    const r = record('bar', { title: 'B', data: [{ x: 5, y: 1 }, { x: 10, y: 2 }, { x: 15, y: 3 }], x: { field: 'x', domain: [0, 20] }, y: 'y' });
    r.frames();
    const layout = r.committed!.layout;
    if (layout.kind !== 'plot' || layout.projection.kind !== 'bands') throw new Error('expected a bar layout');
    const view = r.committed!.view as AlignedView;
    expect(view.xDomain).toEqual([0, 20]);
    expect((layout.projection.band as { domain: readonly number[] }).domain).toEqual([0, 20]);
    for (const tick of layout.xTicks) {
      expect(tick.value).toBeGreaterThanOrEqual(0);
      expect(tick.value).toBeLessThanOrEqual(20);
    }
  });
});

describe('finding 16: a pinned donut color lands on its own slice', () => {
  it('Empty: 0 before Sales: 4 with Sales pinned: the theme binds the pin to the palette slot the Sales arc uses', () => {
    const r = record('donut', { title: 'D', data: [{ l: 'Empty', v: 0 }, { l: 'Sales', v: 4 }], label: 'l', value: 'v', colors: { Sales: 'red' } });
    r.frames();
    const view = r.committed!.view as DonutView;
    const sales = view.slices.find(s => s.label === 'Sales')!;
    const keys = r.themeCalls.at(-1)!.keys;
    expect(keys[sales.colorIndex!]).toBe('Sales');
    const arcs = r.draws.at(-1)!.marks.find(m => m.type === 'arcs');
    if (!arcs || arcs.type !== 'arcs') throw new Error('expected arcs');
    expect(arcs.fills).toContainEqual({ kind: 'series', index: sales.colorIndex });
  });
});

describe('finding 17: a static chart borrows typed columns; author bounds do not renormalize', () => {
  it('ascending Float64Array x and y are shared by the frame; x.domain, a value domain, reference, zoom and colors keep it', () => {
    const t = Float64Array.of(1, 2, 3, 4);
    const v = Float64Array.of(5, 6, 7, 8);
    const r = record('line', { title: 'Borrowed', data: { columns: { t, v } }, x: 't', y: 'v' });
    r.frames();
    const frame = (r.committed!.view as AlignedView).frame;
    expect(frame.x.values.buffer).toBe(t.buffer);
    expect(frame.series[0]!.y.buffer).toBe(v.buffer);
    const normalized = stages(r).normalize;
    r.controller.handle.update({ x: { field: 't', domain: [0, 5] } });
    r.controller.handle.update({ y: { field: 'v', domain: [0, 10] } });
    r.controller.handle.update({ reference: [{ y: 6, label: 'Six' }] });
    r.controller.handle.update({ zoom: false });
    r.controller.handle.update({ colors: { v: 'red' } });
    r.frames();
    expect(stages(r).normalize).toBe(normalized);
    expect((r.committed!.view as AlignedView).frame).toBe(frame);
  });
});

describe('finding 18: a caption-only update reruns only the reader', () => {
  it('every stage but options, frame, reader and figure keeps its count', () => {
    const r = record('scatter', { title: 'Before', data: rowsOf([1, 2, 3]), x: 'x', y: 'y' });
    r.frames();
    const before = stages(r);
    r.controller.handle.update({ description: 'Now with a description.' });
    r.frames();
    const after = stages(r);
    const changed = Object.keys(after).filter(k => after[k as keyof typeof after] !== before[k as keyof typeof before]).sort();
    expect(changed).toEqual(['figure', 'frame', 'options', 'reader']);
    expect(after.reader - before.reader).toBe(1);
  });

  it('an aligned line whose interior sample count changes, with the same ranges, does not relayout', () => {
    const r = record('line', { title: 'L', data: rowsOf([0, 5, 10]), x: 'x', y: 'y' });
    r.frames();
    const before = stages(r).layout;
    r.controller.handle.update({ data: rowsOf([0, 2, 5, 7, 10]) });
    r.frames();
    expect(stages(r).layout).toBe(before);
  });
});

describe('finding 19: naming and state text', () => {
  it('a labelledBy that names nothing falls back to the generated name and raises AX140', () => {
    const r = record('line', { labelledBy: 'missing', data: rowsOf([1, 2]), x: 'x', y: 'y' });
    r.frames();
    expect(lastModel(r).labelledBy).toBeNull();
    expect(lastModel(r).name).toBe('Line chart of y by x');
    expect(codes(r.controller.handle.diagnostics)).toEqual(['AX140']);
    r.ids.missing = 'Now it exists';
    r.controller.handle.update({ description: 'redraw' });
    r.frames();
    expect(lastModel(r).labelledBy).toBe('missing');
    expect(r.controller.handle.diagnostics).toEqual([]);
  });

  it('labelledBy with a title creates no second heading', () => {
    const r = record('line', { labelledBy: 'card', title: 'Also a title', data: rowsOf([1, 2]), x: 'x', y: 'y' });
    r.ids.card = 'Card heading';
    r.frames();
    expect(lastModel(r).title).toBeNull();
    expect(lastModel(r).labelledBy).toBe('card');
  });

  it("a compact chart's description says its current state", () => {
    for (const [state, text] of [['loading', 'Loading chart.'], [{ error: 'The query failed.' }, 'The query failed.']] as const) {
      const r = record('line', { title: 'C', compact: true, state, data: rowsOf([1, 2]), x: 'x', y: 'y' });
      r.frames();
      expect(lastModel(r).summary).toBe(text);
    }
  });
});

describe('the stores retire what no displayed frame can address', () => {
  it('a long stream with keep holds about keep rows once each frame is drawn', () => {
    const r = record('line', { title: 'S', data: rowsOf([0]), x: 'x', y: 'y' });
    r.frames();
    for (let i = 1; i <= 200; i++) {
      r.controller.handle.append([{ x: i, y: i }], { keep: 10 });
      if (i % 7 === 0) r.frames();
    }
    r.frames();
    expect(xs(r).length).toBe(10);
    expect(r.controller.handle.__dev!.retainedRows()).toBeLessThanOrEqual(10);
  });
});

describe('finding 14: typography is read again when a size change or a font load could have changed it', () => {
  it('a resize rereads the computed text style; a font load reruns layout with the cached size', () => {
    const r = record('line', { title: 'T', data: rowsOf([1, 2, 3]), x: 'x', y: 'y' });
    let reads = 0;
    const read = r.host.textStyle;
    (r.host as { textStyle: () => ReturnType<typeof read> }).textStyle = () => { reads++; return read(); };
    r.frames();
    const first = reads;
    r.frames();
    expect(reads).toBe(first);
    r.controller.invalidate.resize();
    r.frames();
    expect(reads).toBe(first + 1);
    const layouts = stages(r).layout;
    r.controller.invalidate.fonts();
    r.frames();
    expect(stages(r).layout).toBe(layouts + 1);
  });
});

describe('review 2, finding 5: keep bounds what the store holds, paused or not', () => {
  it('1,000 appends with keep 3 while paused hold at most the displayed rows plus 3 (scatter and line)', () => {
    for (const kind of ['scatter', 'line'] as const) {
      const r = record(kind, { title: 'K', data: rowsOf([0, 1, 2]), x: 'x', y: 'y' });
      r.frames();
      r.controller.handle.append([{ x: 3, y: 3 }], { keep: 3 });
      r.frames();
      r.controller.actions.pause(true);
      for (let i = 4; i < 1004; i++) r.controller.handle.append([{ x: i, y: i }], { keep: 3 });
      r.frames();
      // The displayed frame (3 rows) stays addressable; the held store keeps 3 more.
      expect(r.controller.handle.__dev!.retainedRows(), kind).toBeLessThanOrEqual(6);
      r.controller.actions.pause(false);
      r.frames();
      expect(r.controller.handle.__dev!.retainedRows(), kind).toBeLessThanOrEqual(3);
    }
  });
});

describe('review 2, finding 1: paused calls validate at the call and apply in call order', () => {
  it('a strict paused append that is invalid throws at once; the valid ones around it are shown on resume', () => {
    const r = record('line', { title: 'P', strict: true, data: rowsOf([1]), x: 'x', y: 'y' });
    r.frames();
    r.controller.handle.append([{ x: 2, y: 20 }]);
    r.controller.actions.pause(true);
    r.controller.handle.append([{ x: 3, y: 30 }]);
    expect(String(catching(() => r.controller.handle.append([{ x: 4, y: NaN }])))).toMatch(/AX103/);
    r.controller.handle.append([{ x: 5, y: 50 }]);
    r.frames();
    expect(xs(r)).toEqual([1, 2]);
    r.controller.actions.pause(false);
    r.frames();
    // x = 4 is an absent step of the regular axis (a gap slot, spec F2), not the rejected value.
    const view = r.committed!.view as AlignedView;
    const values = Array.from(view.frame.x.values).filter((_, i) => view.frame.series[0]!.slot[i] === 0);
    expect(values).toEqual([1, 2, 3, 5]);
  });
});

describe('the bench describe names the kept samples and the renderer', () => {
  it('a dense line keeps its outlier and both ends, never a missing row, and says which renderer draws it', () => {
    const n = 10_000;
    const y = Float64Array.from({ length: n }, (_, i) => (i === 5000 ? 1000 : i % 3));
    y[7000] = NaN;
    const r = record('line', { title: 'Dense', data: { columns: { x: Float64Array.from({ length: n }, (_, i) => i), y } }, x: 'x', y: 'y' });
    r.frames();
    const d = describeOf(r);
    expect(d.renderer).toBe('svg');
    const kept = d.series[0]!.kept!;
    expect(kept.length).toBeLessThan(n / 4);
    expect(kept).toContain(5000);
    expect(kept[0]).toBe(0);
    expect(kept.at(-1)).toBe(n - 1);
    expect(kept).not.toContain(7000);
    // The drawing itself, not describe()'s recomputation (controller review, finding 20): the stroke reaches
    // the outlier's pixel and both ends, lifts the pen at the missing row, and is simplified.
    const layout = r.layout;
    if (layout?.kind !== 'plot' || layout.projection.kind !== 'xy') throw new Error('expected a plot');
    const { x, y: yScale } = layout.projection;
    if (x.type === 'band') throw new Error('expected a continuous x');
    const path = r.draws.at(-1)!.marks.find(m => m.type === 'path' && m.series === 0);
    if (path?.type !== 'path') throw new Error('expected the line');
    const xs: number[] = [];
    const ys: number[] = [];
    let lifts = 0;
    for (let i = 0; i < path.xy.length; i += 2) {
      if (Number.isNaN(path.xy[i]!)) { lifts += 1; continue; }
      xs.push(path.xy[i]!);
      ys.push(path.xy[i + 1]!);
    }
    expect(xs.length).toBeLessThan(n / 4);
    expect(Math.min(...ys)).toBeCloseTo(yScale.map(1000), 1);
    expect(xs[0]).toBeCloseTo(x.map(0), 1);
    expect(xs.at(-1)).toBeCloseTo(x.map(n - 1), 1);
    expect(lifts).toBe(1);
  });
});
