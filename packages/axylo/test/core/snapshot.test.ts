/**
 * The displayed snapshot, the accepted state and the held state (core/controller.ts, invariants at the top):
 * the controller review's sequences (reviews/2026-11-18/impl/wp/core3.controller.review.md) as Node tests, and
 * the invariants as a property over random call sequences.
 */
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import type { AlignedView, DatumRef } from '../../src/core/contracts';
import type { Diagnostic, Point } from '../../src/public';
import { defaultMessages } from '../../src/messages';
import { lastModel, record, type Recording } from './host';

const xsOf = (r: Recording) => Array.from((r.committed!.view as AlignedView).frame.x.values);
const rowsOf = (values: readonly number[]) => values.map(x => ({ x, y: x * 10 }));
const ref = (x: number, seriesKey = 'y'): DatumRef => ({ kind: 'aligned', seriesKey, x });
const internal = 'Something went wrong while drawing the chart.';

function hoverRow(r: Recording, x: number, seriesKey = 'y'): unknown {
  let seen: Point<unknown> | null | undefined;
  const off = r.controller.handle.on('hover', p => { seen = p; });
  r.controller.actions.hover(null);
  r.controller.actions.hover(ref(x, seriesKey));
  off();
  return seen?.row;
}

describe('controller blocker 1: one generation per frame', () => {
  it('a readout formatter that updates the chart mid-frame leaves every layer on one revision', () => {
    let chart: Recording['controller']['handle'] | null = null;
    let fired = false;
    const format = (v: number) => {
      if (!fired && chart && v >= 50) { fired = true; chart.update({ data: rowsOf([10, 12]) }); }
      return String(v);
    };
    const r = record('line', { title: 'First', data: rowsOf([0, 2]), x: 'x', y: { field: 'y', format } });
    chart = r.controller.handle;
    r.frames();
    chart.update({ title: 'Intermediate', data: rowsOf([5, 7]) });
    r.frames(1);
    // Whatever this frame showed, the title, the controls and the marks belong together.
    const title = lastModel(r).title?.text;
    const xs = xsOf(r);
    const prepared = r.prepared.at(-1)!.view as AlignedView;
    expect(Array.from(prepared.frame.x.values)).toEqual(xs);
    if (title === 'Intermediate') expect(xs).not.toEqual([0, 2]);
    r.frames();
    expect(xsOf(r)).toEqual([10, 12]);
    expect(lastModel(r).title?.text).toBe('Intermediate');
  });

  it('a formatter that destroys the chart mid-frame stops all host writes', () => {
    let chart: Recording['controller']['handle'] | null = null;
    const r = record('line', { title: 'D', data: rowsOf([0, 2]), x: 'x', y: { field: 'y', format: (v: number) => { if (v > 0) chart?.destroy(); return String(v); } } });
    chart = r.controller.handle;
    r.frames();
    expect(r.disposed).toBe(1);
    expect(r.writesAfterDispose).toBe(0);
  });
});

describe('controller blocker 2: the displayed snapshot owns its rows until its replacement is drawn', () => {
  it('pause, append with keep 1, resume: a hover before the next frame still has the displayed row', () => {
    const data = rowsOf([0, 1]);
    const r = record('line', { title: 'R', data, x: 'x', y: 'y' });
    r.frames();
    const added = rowsOf([2, 3]);
    r.controller.handle.append(added, { keep: 2 });
    r.frames();
    expect(xsOf(r)).toEqual([2, 3]);
    r.controller.actions.pause(true);
    r.controller.handle.append(rowsOf([4]), { keep: 1 });
    expect(hoverRow(r, 2)).toBe(added[0]);
    r.controller.actions.pause(false);
    expect(hoverRow(r, 2)).toBe(added[0]);
    r.frames();
    expect(xsOf(r)).toEqual([4]);
  });

  it('an append pending when Pause comes: the frame on screen keeps its rows', () => {
    const data = rowsOf([0, 1]);
    const r = record('line', { title: 'R', data, x: 'x', y: 'y' });
    r.frames();
    const two = rowsOf([2]);
    r.controller.handle.append(two, { keep: 1 });
    r.controller.actions.pause(true);
    r.controller.handle.append(rowsOf([3]), { keep: 1 });
    // x = 0 is still on screen (no frame ran since the first draw).
    expect(hoverRow(r, 0)).toBe(data[0]);
    // The next frame draws what was accepted before Pause ([2]); its row came from the stream.
    r.frames();
    expect(xsOf(r)).toEqual([2]);
    expect(hoverRow(r, 2)).toBe(two[0]);
  });
});

describe('controller blocker 3: a renderer exception switches every layer to the error revision', () => {
  it('a throwing text renderer: interaction off, message shown, surfaces hidden; recovery shows them again', () => {
    const r = record('line', { title: 'T', data: rowsOf([0, 2]), x: 'x', y: 'y' });
    r.frames();
    const render = r.host.text.render;
    (r.host.text as { render: typeof render }).render = () => { throw new Error('text broke'); };
    r.controller.handle.update({ data: rowsOf([5, 7]) });
    r.frames();
    expect(r.committed).toBeNull();
    expect(lastModel(r).message).toBe(internal);
    expect(r.surfaces).toBe(false);
    (r.host.text as { render: typeof render }).render = render;
    r.controller.handle.update({ title: 'Back' });
    r.frames();
    expect(lastModel(r).message).toBeNull();
    expect(r.surfaces).toBe(true);
    expect(xsOf(r)).toEqual([5, 7]);
  });

  it('a mark renderer that always throws: the message still appears and the marks are hidden', () => {
    const r = record('line', { title: 'T', data: rowsOf([0, 2]), x: 'x', y: 'y' });
    r.frames();
    (r.host.renderer as unknown as { draw: () => void }).draw = () => { throw new Error('marks broke'); };
    r.controller.handle.update({ data: rowsOf([5, 7]) });
    r.frames();
    expect(lastModel(r).message).toBe(internal);
    expect(r.surfaces).toBe(false);
    expect(r.committed).toBeNull();
  });
});

describe('controller blocker 4: keep bounds a stream whether or not frames run', () => {
  it('1,000 appends with keep 3 and the first frame never run hold at most 3 rows', () => {
    const r = record('line', { title: 'K', data: rowsOf([0, 1, 2]), x: 'x', y: 'y' });
    for (let i = 3; i < 1003; i++) r.controller.handle.append([{ x: i, y: i }], { keep: 3 });
    expect(r.controller.handle.__dev!.retainedRows()).toBeLessThanOrEqual(3);
  });

  it('100 appends with keep 2 and every frame failing hold at most 2 rows', () => {
    const r = record('line', { title: 'K', data: rowsOf([0, 1]), x: 'x', y: 'y' });
    r.controller.handle.__dev!.fail('reader');
    for (let i = 2; i < 102; i++) {
      r.controller.handle.append([{ x: i, y: i }], { keep: 2 });
      r.frames();
    }
    expect(r.controller.handle.__dev!.retainedRows()).toBeLessThanOrEqual(2);
  });

  it('a frame with no size clears the marks before the rows behind them go', () => {
    const r = record('line', { title: 'Z', data: rowsOf([0, 1]), x: 'x', y: 'y' });
    r.frames();
    r.container = null;
    r.controller.handle.append(rowsOf([2]), { keep: 1 });
    r.controller.invalidate.resize();
    r.frames();
    expect(r.draws.at(-1)!.marks).toEqual([]);
  });
});

describe('controller finding 5: re-encoding while paused, and a failed Resume', () => {
  it('a failed Resume keeps the held rows; the next valid call after the cause is gone shows them', () => {
    const r = record('line', { title: 'P', data: rowsOf([1, 2, 3]), x: 'x', y: 'y' });
    r.frames();
    r.controller.handle.append(rowsOf([4]));
    r.frames();
    r.controller.actions.pause(true);
    r.controller.handle.append(rowsOf([5]));
    r.controller.handle.__dev!.fail('view');
    r.controller.actions.pause(false);
    r.frames();
    r.controller.handle.__dev!.fail(null);
    r.controller.handle.update({ title: 'Again' });
    r.frames();
    expect(xsOf(r)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('controller finding 6: append validation writes to the right state', () => {
  it('a first strict append with NaN throws and turns nothing on', () => {
    const r = record('line', { title: 'S', strict: true, data: rowsOf([1, 2]), x: 'x', y: 'y' });
    r.frames();
    expect(() => r.controller.handle.append([{ x: 3, y: NaN }])).toThrow(/AX103/);
    expect(r.pending).toBe(0);
    r.frames();
    expect(r.prepared.at(-1)!.streaming).toBe(false);
  });

  it('a ninth series appended while paused is in diagnostics at once', () => {
    const series = Array.from({ length: 8 }, (_, i) => `S${i}`);
    const r = record('line', { title: 'N', data: series.map(s => ({ x: 1, s, y: 1 })), x: 'x', y: 'y', series: 's' });
    r.frames();
    r.controller.handle.append([{ x: 2, s: 'S0', y: 1 }]);
    r.controller.actions.pause(true);
    r.controller.handle.append([{ x: 3, s: 'S8', y: 1 }]);
    expect(r.controller.handle.diagnostics.map(d => d.code)).toContain('AX130');
  });

  it('a negative donut value held while paused does not put the displayed ring into its error state', () => {
    const r = record('donut', { title: 'D', data: [{ l: 'a', v: 1 }, { l: 'b', v: 2 }], label: 'l', value: 'v' });
    r.frames();
    r.controller.handle.append([{ l: 'c', v: 3 }]);
    r.frames();
    r.controller.actions.pause(true);
    r.controller.handle.append([{ l: 'd', v: -1 }]);
    expect(r.controller.handle.diagnostics.map(d => d.code)).toContain('AX120');
    r.controller.invalidate.resize();
    r.frames();
    expect(lastModel(r).message).toBeNull();
  });
});

describe('controller finding 7: re-entrant calls do not drop deliveries', () => {
  it('a strict rejection delivers every finding even when the first handler updates the chart', () => {
    const seen: string[] = [];
    const r = record('line', { title: 'S', strict: true, data: rowsOf([1, 2]), x: 'x', y: 'y' });
    const chart = r.controller.handle;
    chart.update({ onDiagnostic: (d: Diagnostic) => { seen.push(d.code); if (seen.length === 1) chart.update({ title: 'Nested' }); } });
    expect(() => chart.update({ data: [{ x: 1, y: NaN }, { x: 2, y: 'n' }] })).toThrow();
    expect(seen.sort()).toEqual(['AX103', 'AX106']);
  });

  it('every zoom subscriber gets every zoom, in order, when the first one zooms again', () => {
    const r = record('line', { title: 'Z', data: rowsOf([0, 1, 2, 3]), x: 'x', y: 'y' });
    r.frames();
    const first: unknown[] = [];
    const second: unknown[] = [];
    r.controller.handle.on('zoom', w => { first.push(w); if (first.length === 1) r.controller.handle.zoom([1, 2]); });
    r.controller.handle.on('zoom', w => { second.push(w); });
    r.controller.handle.zoom([0.5, 2]);
    expect(second).toEqual([[0.5, 2], [1, 2]]);
  });
});

describe('controller finding 9: an unsubscribe kept after destroy holds nothing of others', () => {
  it('a kept unsubscribe function does not retain the other subscribers', () => {
    const r = record('line', { title: 'U', data: rowsOf([0, 1]), x: 'x', y: 'y' });
    const off = r.controller.handle.on('hover', () => {});
    const other = () => {};
    r.controller.handle.on('hover', other);
    r.controller.handle.destroy();
    // The closure resolves its set through the chart's (now emptied) map: nothing to reach `other` through.
    expect(off.toString()).not.toMatch(/own\b/);
    off();
  });
});

describe('controller finding 14: a create-stage exception is AX199, delivered, and validate agrees', () => {
  it('an x getter that throws during normalization reaches onDiagnostic as AX199', () => {
    const seen: string[] = [];
    const row = { get x(): number { throw new Error('getter'); }, y: 1 };
    const r = record('line', { title: 'E', data: [row], x: 'x', y: 'y', onDiagnostic: (d: Diagnostic) => seen.push(d.code) });
    expect(seen).toContain('AX199');
    expect(r.controller.handle.diagnostics.map(d => d.code)).toContain('AX199');
  });
});

describe('controller finding 15: scatter keeps the declared percent and ratio scale in its domain (F7)', () => {
  it('values 20 and 63 declared percent end at 100; 0.2 and 0.63 declared ratio end at 1', () => {
    const p = record('scatter', { title: 'P', data: [{ x: 1, y: 20 }, { x: 2, y: 63 }], x: 'x', y: { field: 'y', scale: 'percent' } });
    p.frames();
    expect(p.committed!.view.kind === 'scatter' && p.committed!.view.yDomain[1]).toBe(100);
    const q = record('scatter', { title: 'Q', data: [{ x: 1, y: 0.2 }, { x: 2, y: 0.63 }], x: 'x', y: { field: 'y', scale: 'ratio' } });
    q.frames();
    expect(q.committed!.view.kind === 'scatter' && q.committed!.view.yDomain[1]).toBe(1);
  });
});

describe('controller finding 16: a window at the latest datum follows, for scatter and continuous bars', () => {
  it('scatter [0, 9] zoomed to [5, 9]: appending 12 moves the window to end at 12', () => {
    const r = record('scatter', { title: 'S', data: [{ x: 0, y: 0 }, { x: 9, y: 1 }], x: 'x', y: 'y' });
    r.controller.handle.zoom([5, 9]);
    r.controller.handle.append([{ x: 12, y: 2 }]);
    r.frames();
    expect(r.controller.handle.__bench!.describe().xDomain![1]).toBe(12);
  });

  it('bars 0, 5, 10 zoomed to [5, 10]: appending 15 follows', () => {
    const r = record('bar', { title: 'B', data: [0, 5, 10].map(x => ({ x, y: 1 })), x: 'x', y: 'y' });
    r.controller.handle.zoom([5, 10]);
    r.controller.handle.append([{ x: 15, y: 1 }]);
    r.frames();
    const d = r.controller.handle.__bench!.describe().xDomain!;
    expect(d[0]).toBeGreaterThan(5);
  });
});

describe('controller finding 18: an all-missing bar window draws its missing marks (F2)', () => {
  it('A: null, B: null shows the missing glyphs, not "No data to show"', () => {
    const r = record('bar', { title: 'M', data: [{ x: 'A', y: null }, { x: 'B', y: null }], x: 'x', y: 'y' });
    r.frames();
    expect(lastModel(r).message).toBeNull();
    expect(r.draws.at(-1)!.marks.some(m => m.type === 'rects' && m.variant === 'missing')).toBe(true);
  });
});

describe('invariants over random call sequences', () => {
  type Op =
    | { op: 'append'; n: number; keep: number } | { op: 'title' } | { op: 'data' } | { op: 'pause' } | { op: 'resume' }
    | { op: 'zoom' } | { op: 'frame' } | { op: 'fail' } | { op: 'heal' };
  const ops = fc.oneof(
    fc.record({ op: fc.constant('append' as const), n: fc.integer({ min: 1, max: 3 }), keep: fc.integer({ min: 1, max: 5 }) }),
    ...(['title', 'data', 'pause', 'resume', 'zoom', 'frame', 'frame', 'fail', 'heal'] as const).map(op => fc.constant({ op })),
  ) as fc.Arbitrary<Op>;

  it('marks, lookup and figure agree on one revision; rows on screen keep their provenance; retention stays bounded', () => {
    fc.assert(fc.property(fc.array(ops, { maxLength: 40 }), sequence => {
      const rows = new Map<number, unknown>();
      const add = (xs: number[]) => xs.map(x => { const row = { x, y: x % 7 }; rows.set(x, row); return row; });
      const r = record('line', { title: 'Inv', data: add([0, 1, 2]), x: 'x', y: 'y' });
      let next = 3;
      let lastKeep = Infinity;
      for (const step of sequence) {
        switch (step.op) {
          case 'append': r.controller.handle.append(add(Array.from({ length: step.n }, () => next++)), { keep: step.keep }); lastKeep = step.keep; break;
          case 'title': r.controller.handle.update({ title: `T${next}` }); break;
          case 'data': r.controller.handle.update({ data: add([next, next + 1]) }); next += 2; lastKeep = Infinity; break;
          case 'pause': r.controller.actions.pause(true); break;
          case 'resume': r.controller.actions.pause(false); break;
          case 'zoom': r.controller.handle.zoom(null); break;
          case 'frame': r.frames(); break;
          case 'fail': r.controller.handle.__dev!.fail('reader'); r.controller.handle.update({ subtitle: `s${next}` }); r.frames(); break;
          case 'heal': r.controller.handle.__dev!.fail(null); break;
        }
        const committed = r.committed;
        const d = r.controller.handle.__bench!.describe();
        if (committed) {
          // The lookup the pointer reads and the view behind the marks are the same revision.
          const view = committed.view as AlignedView;
          expect(d.series[0]?.newestX).toBe(view.frame.x.values[view.frame.length - 1]);
          // Every x on screen answers a hover with the caller's own row object.
          for (const x of view.frame.x.values) {
            const i = Array.prototype.indexOf.call(view.frame.x.values, x);
            if (view.frame.series[0]!.slot[i] !== 0) continue;
            expect(hoverRow(r, x)).toBe(rows.get(x));
          }
          // The figure's caption belongs to the same accepted call as the marks (no frame mixed two).
          expect(r.prepared.at(-1)!.view).toBe(committed.view);
        }
        if (Number.isFinite(lastKeep)) {
          const shownRows = committed ? (committed.view as AlignedView).frame.length : 0;
          expect(r.controller.handle.__dev!.retainedRows()).toBeLessThanOrEqual(lastKeep + shownRows + 5 + 64);
        }
      }
    }), { numRuns: 300 });
  });
});

describe('controller finding 19: environment changes are read again, and one draw per animation frame', () => {
  it('a pixel ratio changed while detached is read on reattachment', () => {
    const r = record('line', { title: 'D', data: rowsOf([0, 1, 2]), x: 'x', y: 'y' });
    r.frames();
    (r.host as { devicePixelRatio: () => number }).devicePixelRatio = () => 3;
    r.controller.invalidate.page();
    r.frames();
    expect(r.committed!.pixelRatio).toBe(3);
  });

  it('a data update and a theme change in the same animation frame draw once', () => {
    const r = record('line', { title: 'T', data: rowsOf([0, 1, 2]), x: 'x', y: 'y' });
    r.frames();
    const before = r.draws.length;
    r.controller.handle.update({ data: rowsOf([0, 1, 3]) });
    // The theme watcher's own frame callback, in the same batch as the chart's.
    r.host.requestFrame(() => r.controller.invalidate.theme());
    r.frames(1);
    expect(r.draws.length - before).toBe(1);
    r.frames();
    expect(r.draws.length - before).toBeLessThanOrEqual(2);
  });
});

describe('scatter follow counts observations with no y (PointSeries.missingX)', () => {
  it('a window ending at an omission at the latest x follows the next append', () => {
    const r = record('scatter', { title: 'M', data: [{ x: 0, y: 0 }, { x: 9, y: 1 }, { x: 12, y: null }], x: 'x', y: 'y' });
    r.frames();
    r.controller.handle.zoom([6, 12]);
    r.controller.handle.append([{ x: 15, y: 2 }]);
    r.frames();
    expect(r.controller.handle.__bench!.describe().xDomain![1]).toBe(15);
  });
});

describe('pass 4: controller findings 5 and 8', () => {
  it('re-encoding while paused shows the rows on screen with the new field and keeps the arrivals held', () => {
    const data = [1, 2, 3].map(x => ({ x, a: x, b: -x }));
    const r = record('line', { title: 'P', data, x: 'x', y: 'a' });
    r.frames();
    r.controller.handle.append([{ x: 4, a: 4, b: -4 }], { keep: 3 });
    r.frames();
    expect(xsOf(r)).toEqual([2, 3, 4]);
    r.controller.actions.pause(true);
    r.controller.handle.append([{ x: 5, a: 5, b: -5 }], { keep: 3 });
    r.controller.handle.update({ y: 'b' });
    r.frames();
    const view = r.committed!.view as AlignedView;
    expect(Array.from(view.frame.x.values)).toEqual([2, 3, 4]);
    expect(Array.from(view.frame.series[0]!.y)).toEqual([-2, -3, -4]);
    expect(hoverRow(r, 2, 'b')).toMatchObject({ x: 2, b: -2 });
    r.controller.actions.pause(false);
    r.frames();
    const after = r.committed!.view as AlignedView;
    expect(Array.from(after.frame.x.values)).toEqual([3, 4, 5]);
    expect(Array.from(after.frame.series[0]!.y)).toEqual([-3, -4, -5]);
  });

  for (const kind of ['line', 'area', 'bar', 'scatter', 'donut'] as const) {
    it(`${kind}: a valid append clears a stale AX101 and draws`, () => {
      const enc = kind === 'donut' ? { label: 'x', value: 'v' } : { x: 'x', y: 'v' };
      const r = record(kind, { title: 'F', data: [{ x: kind === 'donut' ? 'a' : 1 }], ...enc });
      r.frames();
      expect(r.controller.handle.diagnostics.map(d => d.code)).toContain('AX101');
      r.controller.handle.append([{ x: kind === 'donut' ? 'b' : 2, v: 5 }], { keep: 1 });
      r.frames();
      expect(r.controller.handle.diagnostics.map(d => d.code)).not.toContain('AX101');
      expect(lastModel(r).message).toBeNull();
    });
  }
});

describe('pass 4: controller finding 12, resubmitted options', () => {
  it('an edited reference, color, message and label passed back in the same objects take effect', () => {
    const reference = [{ y: 5, label: 'Goal' }];
    const colors: Record<string, string> = { y: 'red' };
    const messages: Record<string, string> = { empty: 'Nothing' };
    const y = { field: 'y', label: 'Before' };
    const r = record('line', { title: 'M', data: rowsOf([0, 1]), x: 'x', y, reference, colors, messages });
    r.frames();
    reference[0]!.y = 7;
    colors.y = 'blue';
    messages.empty = 'Nichts';
    y.label = 'After';
    r.controller.handle.update({ reference, colors, messages, y });
    r.frames();
    const view = r.committed!.view as AlignedView;
    expect(view.references[0]!.from).toBe(7);
    expect(r.themeCalls.at(-1)!.colors).toEqual({ y: 'blue' });
    expect(r.committed!.messages.empty).toBe('Nichts');
    expect(view.frame.yLabel).toBe('After');
  });

  it('a label-only or unit-only change over static data does not renormalize', () => {
    const r = record('line', { title: 'L', data: rowsOf([0, 1, 2]), x: 'x', y: { field: 'y', label: 'A' } });
    r.frames();
    const before = r.controller.handle.__dev!.stages().normalize;
    r.controller.handle.update({ y: { field: 'y', label: 'B', unit: 'ms' } });
    r.frames();
    expect(r.controller.handle.__dev!.stages().normalize).toBe(before);
    const view = r.committed!.view as AlignedView;
    expect([view.frame.yLabel, view.frame.series[0]!.unit, view.frame.series[0]!.label]).toEqual(['B', 'ms', 'B']);
  });
});

describe('pass 4: controller finding 13, AX160 follows its formatter', () => {
  const throwing = () => { throw new Error('fmt'); };
  it('a readout formatter that always throws keeps AX160 when the data is replaced', () => {
    const r = record('line', { title: 'F', data: rowsOf([1, 2]), x: 'x', y: { field: 'y', format: throwing } });
    r.frames();
    expect(r.controller.handle.diagnostics.map(d => d.code)).toContain('AX160');
    r.controller.handle.update({ data: rowsOf([3, 4]) });
    r.frames();
    expect(r.controller.handle.diagnostics.map(d => d.code)).toContain('AX160');
    expect(lastModel(r).note).toMatch(/shown differently/);
  });

  it('an invalid Intl option combination reports AX160 when the formatters are built', () => {
    // style 'currency' without a currency is a TypeError from Intl.NumberFormat.
    const r = record('line', { title: 'F', data: rowsOf([1, 2]), x: 'x', y: { field: 'y', format: { style: 'currency' } } });
    r.frames();
    expect(r.controller.handle.diagnostics.filter(d => d.code === 'AX160').map(d => d.field)).toEqual(['y']);
  });

  it('one function for ticks and readouts gives one AX160', () => {
    const r = record('line', { title: 'F', data: rowsOf([1, 2]), x: 'x', y: { field: 'y', format: throwing, tickFormat: throwing } });
    r.frames();
    expect(r.controller.handle.diagnostics.filter(d => d.code === 'AX160').length).toBe(1);
  });

  it('removing the formatters while the chart shows an error state retires AX160 and the note', () => {
    const r = record('line', { title: 'F', data: rowsOf([1, 2]), x: 'x', y: { field: 'y', tickFormat: throwing } });
    r.frames();
    r.controller.handle.update({ y: 'y', state: { error: 'Down' } });
    r.frames();
    expect(r.controller.handle.diagnostics.map(d => d.code)).not.toContain('AX160');
  });
});

describe('pass 4: controller finding 11, a title update is cheap', () => {
  it('a title update on a stream does not walk the retained rows', async () => {
    const { StreamRows } = await import('../../src/data/store-rows');
    const many = Array.from({ length: 5000 }, (_, i) => ({ x: i, y: i }));
    const r = record('line', { title: 'Before', data: many, x: 'x', y: 'y' });
    r.frames();
    r.controller.handle.append([{ x: 5000, y: 1 }]);
    r.frames();
    const table = vi.spyOn(StreamRows.prototype, 'table');
    try {
      r.controller.handle.update({ title: 'After' });
      r.frames();
      expect(table).not.toHaveBeenCalled();
    } finally {
      table.mockRestore();
    }
    expect(lastModel(r).title?.text).toBe('After');
  });

  it('a title update does not compute the summary statistics again', () => {
    let calls = 0;
    const format = (v: number) => { calls += 1; return String(v); };
    const r = record('line', { title: 'Before', data: rowsOf([1, 2, 3]), x: 'x', y: { field: 'y', format } });
    r.frames();
    const summary = lastModel(r).summary;
    calls = 0;
    r.controller.handle.update({ title: 'After' });
    r.frames();
    // The summary's minimum, maximum and last value go through the readout formatter: nothing formatted again.
    expect(calls).toBe(0);
    expect(lastModel(r).summary).toBe(summary);
    expect(lastModel(r).title?.text).toBe('After');
  });
});

describe('pass 4: controller finding 17, zoom does not apply to a category axis in 1.0', () => {
  const data = ['A', 'B', 'C', 'D'].map((x, i) => ({ x, y: i + 1 }));
  for (const kind of ['line', 'area', 'bar'] as const) {
    it(`${kind}: zoom(['B', 'C']) is a no-op reported as AX150; marks, ticks, lookup and controls unchanged`, () => {
      const seen: Diagnostic[] = [];
      const r = record(kind, { title: 'Z', data, x: 'x', y: 'y', onDiagnostic: (d: Diagnostic) => seen.push(d) },
        { container: { width: 600, height: 300 } });
      r.frames();
      const before = { layout: r.layout, lookup: r.committed!.lookup, view: r.committed!.view, draws: r.draws.length };
      expect(r.prepared.at(-1)!.zoom).toBe(false);
      let zoomed = 0;
      r.controller.handle.on('zoom', () => { zoomed += 1; });
      r.controller.handle.zoom(['B', 'C']);
      r.frames();
      expect(seen.map(d => [d.code, d.field])).toEqual([['AX150', 'zoom']]);
      expect(zoomed).toBe(0);
      const c = r.committed!;
      expect(c.view).toBe(before.view);
      expect(c.lookup).toBe(before.lookup);
      expect(c.zoomed).toBe(false);
      expect(r.prepared.at(-1)!.zoom).toBe(false);
      expect(r.draws.length).toBe(before.draws);
      if (r.layout?.kind !== 'plot') throw new Error('expected a plot');
      expect(r.layout.xTicks.map(t => t.label)).toEqual(['A', 'B', 'C', 'D']);
      expect(r.layout).toBe(before.layout);
    });
  }

  it('donut: the same AX150 for a zoom request', () => {
    const seen: Diagnostic[] = [];
    const r = record('donut', { title: 'Z', data: [{ l: 'A', v: 1 }, { l: 'B', v: 2 }], label: 'l', value: 'v', onDiagnostic: (d: Diagnostic) => seen.push(d) });
    r.frames();
    r.controller.handle.zoom(['A', 'B']);
    r.controller.handle.zoom(null);
    expect(seen.map(d => [d.code, d.field])).toEqual([['AX150', 'zoom']]);
  });

  it('a window kept from a numeric axis does not narrow the categories that replace it', () => {
    const r = record('line', { title: 'Z', data: rowsOf([0, 1, 2, 3, 4]), x: 'x', y: 'y' }, { container: { width: 600, height: 300 } });
    r.frames();
    r.controller.handle.zoom([1, 3]);
    r.frames();
    r.controller.handle.update({ data });
    r.frames();
    const view = r.committed!.view as AlignedView;
    expect(view.visibleSlots).toEqual({ start: 0, end: 4 });
    if (r.layout?.kind !== 'plot') throw new Error('expected a plot');
    expect(r.layout.xTicks.map(t => t.label)).toEqual(['A', 'B', 'C', 'D']);
  });
});


describe('pass 4: documentation findings 1 and 3, the state the figure shows', () => {
  it('AX108 on the only series is not an empty chart: the figure says the series could not be drawn', () => {
    const r = record('line', { title: 'Dup', data: [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 3 }], x: 'x', y: 'y' });
    r.frames();
    expect(r.controller.handle.diagnostics.map(d => d.code)).toContain('AX108');
    const model = lastModel(r);
    expect(model.message).not.toBe(defaultMessages.empty);
    expect(model.message).toMatch(/could not be drawn/);
    expect(model.summary).not.toContain(defaultMessages.empty);
  });

  it('loading is not empty: the summary says the chart is loading', () => {
    const r = record('line', { title: 'Wait', data: [], x: 'x', y: 'y', state: 'loading' });
    r.frames();
    const model = lastModel(r);
    expect(model.message).toBe(defaultMessages.loading);
    expect(model.summary).toBe(defaultMessages.loading);
    expect(model.summary).not.toContain(defaultMessages.empty);
  });

  it('an error state does not describe data it does not show', () => {
    const r = record('line', { title: 'E', data: rowsOf([1, 2]), x: 'x', y: 'y', state: { error: 'Feed down.' } });
    r.frames();
    expect(lastModel(r).summary).toBe('Feed down.');
  });
});

describe('pass 4: documentation finding 2, the zoom event gives back what zoom() reads', () => {
  const cases = [
    { axis: 'time', xs: ['2026-01-01T00:00Z', '2026-01-02T00:00Z', '2026-01-03T00:00Z', '2026-01-04T00:00Z'].map(s => new Date(s)) },
    { axis: 'date', xs: ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'] },
    { axis: 'wall', xs: ['2026-01-01T00:00', '2026-01-02T00:00', '2026-01-03T00:00', '2026-01-04T00:00'] },
    { axis: 'number', xs: [1, 2, 3, 4] },
  ];
  for (const { axis, xs } of cases) {
    it(`${axis}: the event's window and Point.x are in the author's form and can be passed to another chart`, () => {
      const data = xs.map((x, i) => ({ x, y: i }));
      const rejected: string[] = [];
      const make = () => record('line', { title: 'T', data, x: 'x', y: 'y', onDiagnostic: (d: Diagnostic) => { if (d.field === 'zoom') rejected.push(d.code); } });
      const a = make();
      a.frames();
      let window: unknown = undefined;
      a.controller.handle.on('zoom', p => { window = p; });
      a.controller.handle.zoom([xs[1]!, xs[2]!]);
      expect(window).toEqual([xs[1], xs[2]]);
      let point: unknown;
      a.controller.handle.on('hover', p => { point = p?.x; });
      const view = a.committed!.view as AlignedView;
      a.controller.actions.hover({ kind: 'aligned', seriesKey: 'y', x: view.frame.x.values[1]! });
      expect(point).toEqual(xs[1]);
      // Straight into another chart's zoom().
      const b = make();
      b.frames();
      let again: unknown = undefined;
      b.controller.handle.on('zoom', p => { again = p; });
      b.controller.handle.zoom(window as never);
      expect(again).toEqual(window);
      expect(rejected).toEqual([]);
    });
  }
});

describe('pass 4: reader review finding 5, the sentences the controller shows', () => {
  const dup = [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 3 }];
  it('a series that could not be drawn points to the table the chart offers, as the summary does', () => {
    const r = record('line', { title: 'Dup', data: dup, x: 'x', y: 'y' });
    r.frames();
    expect(lastModel(r).message).toBe(`y could not be drawn. ${defaultMessages.seeTable}`);
    expect(r.prepared.at(-1)!.inspectable).toBe(true);
  });

  it("an override with the placeholder gets it filled; one without it is used as written", () => {
    const a = record('line', { title: 'Dup', data: dup, x: 'x', y: 'y', messages: { seriesNotDrawn: '{series} ({seeTable})!' } });
    a.frames();
    expect(lastModel(a).message).toBe(`y (${defaultMessages.seeTable})!`);
    const b = record('line', { title: 'Dup', data: dup, x: 'x', y: 'y', messages: { seriesNotDrawn: 'Not drawn: {series} ' } });
    b.frames();
    expect(lastModel(b).message).toBe('Not drawn: y ');
  });

  it('on a German page the note is tagged English only when all of it is built-in, "See table." included', () => {
    const data = [{ x: 1, y: 1 }, { x: 2, y: NaN }, { x: 3, y: 3 }];
    const built = record('line', { title: 'N', data, x: 'x', y: 'y' }, { pageLang: 'de' });
    built.frames();
    expect(lastModel(built).note).toMatch(/See table/);
    expect(lastModel(built).noteLang).toBe('en');
    const mixed = record('line', { title: 'N', data, x: 'x', y: 'y', messages: { seeTable: 'Siehe Tabelle.' } }, { pageLang: 'de' });
    mixed.frames();
    expect(lastModel(mixed).note).toMatch(/Siehe Tabelle/);
    expect(lastModel(mixed).noteLang).toBeNull();
    expect(lastModel(mixed).noteSegments).toEqual([{ text: lastModel(mixed).note, lang: null }]);
  });
});
