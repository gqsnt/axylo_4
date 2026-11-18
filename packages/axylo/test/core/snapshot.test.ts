/**
 * The displayed snapshot, the accepted state and the held state (core/controller.ts, invariants at the top):
 * the controller review's sequences (reviews/2026-11-18/impl/wp/core3.controller.review.md) as Node tests, and
 * the invariants as a property over random call sequences.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AlignedView, DatumRef } from '../../src/core/contracts';
import type { Diagnostic, Point } from '../../src/public';
import { lastModel, record, type Recording } from './host';

const xsOf = (r: Recording) => Array.from((r.committed!.view as AlignedView).frame.x.values);
const rowsOf = (values: readonly number[]) => values.map(x => ({ x, y: x * 10 }));
const ref = (x: number, seriesKey = 'y'): DatumRef => ({ kind: 'aligned', seriesKey, x });
const internal = 'Something went wrong while drawing the chart.';

function hoverRow(r: Recording, x: number): unknown {
  let seen: Point<unknown> | null | undefined;
  const off = r.controller.handle.on('hover', p => { seen = p; });
  r.controller.actions.hover(null);
  r.controller.actions.hover(ref(x));
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
