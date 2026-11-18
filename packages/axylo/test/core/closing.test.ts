/**
 * Closing fix pass (reviews/2026-11-18/impl/wp/closing.fix.md, controller author; the check is
 * final-check.review.md): each remaining sequence, proven by its own test since no review round follows.
 */
import { describe, expect, it } from 'vitest';
import type { DatumRef, ScatterView } from '../../src/core/contracts';
import type { Point } from '../../src/public';
import { lastModel, record, type Recording } from './host';

const pointsOf = (r: Recording) => (r.committed!.view as ScatterView).frame.series.flatMap(s => Array.from(s.x)).sort((p, q) => p - q);

describe('C2, last sequence: late appends while paused and hidden', () => {
  it('scatter x=101 with keep 1, Pause, 100 times hide, append a late x=0, show: the revisions kept stay bounded', () => {
    const r = record('scatter', { title: 'C', data: [{ x: 100, y: 1 }], x: 'x', y: 'y' });
    r.frames();
    r.controller.handle.append([{ x: 101, y: 2 }], { keep: 1 });
    r.frames();
    expect(pointsOf(r)).toEqual([101]);
    // The policy's baseline: what the store held right after the frame that showed x=101.
    const baseline = r.controller.handle.__dev!.retainedRows();
    r.controller.actions.pause(true);
    let most = 0;
    for (let i = 0; i < 100; i++) {
      r.container = null;
      r.controller.invalidate.resize();
      r.frames();
      r.controller.handle.append([{ x: 0, y: i }], { keep: 1 });
      r.container = { width: 720, height: 400 };
      r.controller.invalidate.resize();
      r.frames();
      expect(pointsOf(r)).toEqual([101]);
      most = Math.max(most, r.controller.handle.__dev!.retainedSources());
    }
    // Revisions kept within the policy's bound (twice the baseline plus 8, and the head), not one per append.
    expect(most).toBeLessThanOrEqual(2 * baseline + 8 + 1);
    let seen: Point<unknown> | null | undefined;
    const series = (r.committed!.view as ScatterView).frame.series[0]!;
    r.controller.handle.on('hover', p => { seen = p; });
    r.controller.actions.hover({ kind: 'point', seriesKey: series.key, row: series.row ? series.row[0]! : 0, x: 101 } as DatumRef);
    r.frames(1);
    expect(seen?.row).toEqual({ x: 101, y: 2 });
    r.controller.actions.pause(false);
    r.frames();
    expect(pointsOf(r)).toEqual([101]);
  });
});

describe('closing, item 2: a tick formatter\'s AX160 does not change the fit', () => {
  it('y domain [0, 10] and a tick formatter that throws at 2: after a resize notification the layout settles, at every height', () => {
    const tickFormat = (v: number) => { if (v === 2) throw new Error('two'); return String(v); };
    for (let height = 120; height <= 320; height += 2) {
      const r = record('line', { title: 'T', data: [0, 1, 2, 3].map(x => ({ x, y: x * 3 })), x: 'x', y: { field: 'y', domain: [0, 10], tickFormat } }, { container: { width: 600, height } });
      r.frames(20);
      expect(r.pending, `height ${height}`).toBe(0);
      const layouts = r.controller.handle.__dev!.stages().layout;
      // The page's resize observer reports every change of the figure's size: one notification per frame.
      for (let k = 0; k < 6; k++) {
        r.controller.invalidate.resize();
        r.frames(1);
      }
      r.frames(20);
      expect(r.pending, `height ${height}`).toBe(0);
      expect(r.controller.handle.__dev!.stages().layout - layouts, `height ${height}`).toBeLessThanOrEqual(1);
      // A tick label in the default format is not a value shown differently: no note for it (F12).
      expect(lastModel(r).note, `height ${height}`).toBeNull();
    }
  });

  it('a value formatter that throws still has the note (F12)', () => {
    const format = () => { throw new Error('value'); };
    const tickFormat = (v: number) => { if (v === 2) throw new Error('two'); return String(v); };
    const r = record('line', { title: 'V', data: [0, 1, 2, 3].map(x => ({ x, y: x * 3 })), x: 'x', y: { field: 'y', domain: [0, 10], tickFormat, format } });
    r.frames();
    expect(r.controller.handle.diagnostics.map(d => d.code)).toContain('AX160');
    expect(lastModel(r).note).toMatch(/shown differently|changed/i);
  });
});

describe('closing, item 3: an append keeps a narrow scatter\'s zoom', () => {
  it('the R8 fixture zoomed to −1000…1500, then x=1600 appended: the window stays', () => {
    const r = record('scatter', { title: 'R', data: [{ x: -3.3, y: 1 }, { x: 7.7, y: 2 }, { x: 1001.5, y: null }], x: 'x', y: 'y' }, { container: { width: 195, height: 400 } });
    r.frames();
    r.controller.handle.zoom([-1000, 1500]);
    r.frames();
    expect((r.committed!.view as ScatterView).xDomain).toEqual([-1000, 1500]);
    r.controller.handle.append([{ x: 1600, y: 3 }]);
    r.frames();
    const view = r.committed!.view as ScatterView;
    expect(view.xDomain).toEqual([-1000, 1500]);
    // The bounds a window may take grew with the data.
    expect(view.xFull[0]).toBeLessThanOrEqual(-1000);
    expect(view.xFull[1]).toBeGreaterThanOrEqual(1600);
  });
});
