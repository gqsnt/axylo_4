/**
 * Round 3: the narrow cross-provider re-check of the blocking defects (reviews/2026-11-18/impl/wp/blockers-recheck.review.md),
 * the controller's items, each as the reviewer's sequence. Expected values come from the spec, the fixture
 * rows and the retention policy's stated bound (twice what was on screen when the shown rows last changed,
 * plus 8).
 */
import { describe, expect, it } from 'vitest';
import type { AlignedView, DatumRef, ScatterView } from '../../src/core/contracts';
import type { Diagnostic, Point } from '../../src/public';
import { lastModel, record, type Recording } from './host';

const rowsOf = (values: readonly number[]) => values.map(x => ({ x, y: x * 10 }));
const ref = (x: number, seriesKey = 'y'): DatumRef => ({ kind: 'aligned', seriesKey, x });
const xsOf = (r: Recording) => Array.from((r.committed!.view as AlignedView).frame.x.values);
const codes = (r: Recording) => r.controller.handle.diagnostics.map(d => d.code);

function hoverPoint(r: Recording, target: DatumRef): Point<unknown> | null | undefined {
  let seen: Point<unknown> | null | undefined;
  const off = r.controller.handle.on('hover', p => { seen = p; });
  r.controller.actions.hover(null);
  r.controller.actions.hover(target);
  r.frames(1);
  off();
  return seen;
}

describe('C2: retention while paused across hide and show', () => {
  it('x=2 drawn with keep 1, Pause, then 100 cycles of hide, append with keep 1, show: within the bound; Resume shows the newest row', () => {
    const r = record('line', { title: 'K', data: rowsOf([0, 1]), x: 'x', y: 'y' });
    r.frames();
    r.controller.handle.append([{ x: 2, y: 20 }], { keep: 1 });
    r.frames();
    const baseline = r.controller.handle.__dev!.retainedRows();
    r.controller.actions.pause(true);
    let most = 0;
    for (let x = 3; x < 103; x++) {
      r.container = null;
      r.controller.invalidate.resize();
      r.frames();
      r.controller.handle.append([{ x, y: x * 10 }], { keep: 1 });
      r.container = { width: 720, height: 400 };
      r.controller.invalidate.resize();
      r.frames();
      expect(xsOf(r)).toEqual([2]);
      most = Math.max(most, r.controller.handle.__dev!.retainedRows());
    }
    expect(most).toBeLessThanOrEqual(2 * baseline + 8);
    expect(hoverPoint(r, ref(2))?.row).toEqual({ x: 2, y: 20 });
    r.controller.actions.pause(false);
    r.frames();
    expect(xsOf(r)).toEqual([102]);
    expect(hoverPoint(r, ref(102))?.row).toEqual({ x: 102, y: 1020 });
  });
});

describe('C4 remainder: re-encoding while paused validates the displayed window too', () => {
  it('strict: a field only the held rows have is rejected, and the plot on screen stays', () => {
    const r = record('line', { title: 'S', strict: true, data: rowsOf([0, 1, 2]), x: 'x', y: 'y' });
    r.frames();
    r.controller.handle.append([{ x: 3, y: 30 }]);
    r.frames();
    r.controller.actions.pause(true);
    // Held with keep 1: the store's retained rows all have w, the rows on screen none.
    r.controller.handle.append([{ x: 4, y: 40, w: 4 }], { keep: 1 });
    // AX101 for the rows on screen: they have no field w (spec 3.5).
    expect(() => r.controller.handle.update({ y: 'w' })).toThrow(/AX101/);
    r.frames();
    expect(xsOf(r)).toEqual([0, 1, 2, 3]);
    expect(lastModel(r).message).toBeNull();
  });

  it('not strict: the same re-encoding reports AX101 for what is on screen', () => {
    const r = record('line', { title: 'N', data: rowsOf([0, 1, 2]), x: 'x', y: 'y' });
    r.frames();
    r.controller.handle.append([{ x: 3, y: 30 }]);
    r.frames();
    r.controller.actions.pause(true);
    r.controller.handle.append([{ x: 4, y: 40, w: 4 }], { keep: 1 });
    r.controller.handle.update({ y: 'w' });
    r.frames();
    expect(codes(r)).toContain('AX101');
  });

  it('a retained imputed-zero row behind an evicted source index is re-read while paused', () => {
    // missing: 'zero' makes y null a value of 0, and on a line such a slot refers to no source row. Keep 3
    // after x 7 arrives keeps x 10 (index 0, y null), 5 (index 2) and 7 (index 3); x 1 at index 1 is evicted.
    const data = [{ x: 10, y: null, u: 3 }, { x: 1, y: 1, u: 1 }, { x: 5, y: 1, u: 2 }];
    const r = record('line', { title: 'Z', data, x: 'x', y: { field: 'y', missing: 'zero' } });
    r.frames();
    r.controller.handle.append([{ x: 7, y: 2, u: 2 }], { keep: 3 });
    r.frames();
    const shown = () => {
      const view = r.committed!.view as AlignedView;
      const s = view.frame.series[0]!;
      return Array.from(view.frame.x.values, (x, i) => [x, s.y[i]]);
    };
    const before = shown();
    expect(before.map(p => p[0])).toEqual([5, 7, 10]);
    r.controller.actions.pause(true);
    r.controller.handle.append([{ x: 12, y: 4, u: 4 }], { keep: 3 });
    r.controller.handle.update({ y: { field: 'u', missing: 'zero' } });
    r.frames();
    // The same x on screen, each read with u.
    expect(shown().map(p => p[0])).toEqual(before.map(p => p[0]));
    expect(shown().find(p => p[0] === 10)?.[1]).toBe(3);
  });

  it('R7: x 10000 kept with the newest of 1,000 late arrivals (keep 2): re-encoding reads the two rows, not 1,002 indexes', () => {
    const r = record('scatter', { title: 'L', data: [{ x: 10_000, y: 1 }], x: 'x', y: 'y' });
    r.frames();
    for (let i = 0; i < 1000; i++) r.controller.handle.append([{ x: i, y: 2 }], { keep: 2 });
    r.frames();
    const frame = (r.committed!.view as ScatterView).frame;
    expect(frame.series.flatMap(s => Array.from(s.x)).sort((p, q) => p - q)).toEqual([999, 10_000]);
    const source = frame.source as { rowAt(row: number): unknown };
    const original = source.rowAt.bind(source);
    let reads = 0;
    source.rowAt = row => { reads++; return original(row); };
    r.controller.actions.pause(true);
    r.controller.handle.append([{ x: 1000, y: 3 }], { keep: 2 });
    r.controller.handle.update({ y: { field: 'y', label: 'Renamed' } });
    r.frames();
    expect(reads).toBeLessThanOrEqual(10);
  });
});

describe('C6 remainder: a throwing option getter under strict', () => {
  it('strict: an update whose option getter throws is rejected, and the chart stays as it was', () => {
    const r = record('line', { title: 'S', strict: true, data: rowsOf([0, 1, 2]), x: 'x', y: 'y' });
    r.frames();
    const patch = { get title(): string { throw new Error('option getter'); } };
    expect(() => r.controller.handle.update(patch)).toThrow();
    r.frames();
    expect(codes(r)).not.toContain('AX199');
    expect(lastModel(r).message).toBeNull();
    expect(lastModel(r).title?.text).toBe('S');
  });
});

describe('C7 remainder and R6: the hover payload reads the frame, not the caller\'s rows', () => {
  it('50,000 coincident points: hovering the latest reads a few row indexes', () => {
    const n = 50_000;
    const r = record('scatter', { title: 'C', data: Array.from({ length: n }, () => ({ x: 1, y: 1 })), x: 'x', y: 'y' });
    r.frames();
    const series = (r.committed!.view as ScatterView).frame.series[0]!;
    const rows = series.row!;
    // The pointer's pick, as the interaction layer hands it on: the latest source row wins a tie.
    const layout = r.layout!;
    if (layout.kind !== 'plot' || layout.projection.kind !== 'xy') throw new Error('expected a plot');
    const pick = r.committed!.lookup.pick(layout.projection.x.map(1), layout.projection.y.map(1));
    if (pick?.kind !== 'point') throw new Error('expected a point');
    const target = pick.refs[0]!;
    expect(target.kind === 'point' && target.row).toBe(n - 1);
    let reads = 0;
    const counted = new Proxy(rows, { get(t, key) { if (typeof key === 'string' && /^\d+$/.test(key)) reads++; const v = Reflect.get(t, key, t); return typeof v === 'function' ? v.bind(t) : v; } });
    Object.defineProperty(series, 'row', { value: counted, configurable: true });
    const point = hoverPoint(r, target);
    expect(point?.y).toBe(1);
    expect(point?.index).toBe(n - 1);
    expect(reads).toBeLessThanOrEqual(4);
  });

  it('a row getter that throws once drawn: hover still delivers the point, with its normalized x and y', () => {
    let armed = false;
    const row = { get x(): number { if (armed) throw new Error('later'); return 2; }, get y(): number { if (armed) throw new Error('later'); return 5; } };
    const r = record('scatter', { title: 'G', data: [{ x: 1, y: 1 }, row], x: 'x', y: 'y' });
    r.frames();
    armed = true;
    const series = (r.committed!.view as ScatterView).frame.series[0]!;
    const errors: unknown[] = [];
    let point: Point<unknown> | null | undefined;
    r.controller.handle.on('hover', p => { point = p; });
    try {
      r.controller.actions.hover({ kind: 'point', seriesKey: series.key, row: 1, x: 2 });
      r.frames(1);
    } catch (error) {
      errors.push(error);
    }
    expect(errors).toEqual([]);
    expect(point?.x).toBe(2);
    expect(point?.y).toBe(5);
    expect(point?.index).toBe(1);
  });
});

describe('R11: the strip\'s height follows the page after a resize', () => {
  // The plot's height without a strip, laid out at a container height (the caption and controls take theirs).
  const plotHeightAt = (height: number) => {
    const r = record('line', { title: 'S', data: rowsOf([0, 1, 2, 3]), x: 'x', y: 'y' }, { container: { width: 600, height } });
    r.frames();
    const l = r.layout!;
    return l.kind === 'plot' ? l.plot.height : -1;
  };
  const containerFor = (plot: number) => {
    for (let h = 120; h < 400; h += 0.5) if (plotHeightAt(h) >= plot) return h;
    throw new Error('no container');
  };
  const mode = (r: Recording) => (r.prepared.at(-1) as unknown as { readoutMode?: string }).readoutMode;

  it('a 135 px plot with a 98 px strip, then 134 px while responsive CSS makes the strip 48 px: the strip is reserved', () => {
    let strip = 98;
    const r = record('line', { title: 'S', data: rowsOf([0, 1, 2, 3]), x: 'x', y: 'y' }, { container: { width: 600, height: containerFor(135) }, strip: () => strip });
    r.frames();
    // 135 − 98 leaves less than 80 px: no strip and no tooltip (rule 5).
    expect(mode(r)).toBe('none');
    strip = 48;
    r.container = { width: 600, height: containerFor(134) };
    r.controller.invalidate.resize();
    r.frames();
    // 134 − 48 = 86 px, at least 80: the strip, as a fresh chart at that size has it.
    const fresh = record('line', { title: 'S', data: rowsOf([0, 1, 2, 3]), x: 'x', y: 'y' }, { container: { width: 600, height: containerFor(134) }, strip: 48 });
    fresh.frames();
    expect(mode(fresh)).toBe('strip');
    expect(mode(r)).toBe('strip');
    expect(r.layout!.kind).toBe('plot');
  });
});

describe('R12: AX160 comes from the tick sets drawn, not from unused coarser candidates', () => {
  it('a wide scatter on x 1.1, 8.9, 10.7 with an x tick formatter that throws above 12: no AX160', () => {
    const tickFormat = (v: number) => { if (v > 12) throw new Error('above 12'); return String(v); };
    const seen: string[] = [];
    const r = record('scatter', {
      title: 'W', data: [{ x: 1.1, y: 1 }, { x: 8.9, y: 2 }, { x: 10.7, y: null }], x: { field: 'x', tickFormat }, y: 'y',
      onDiagnostic: (d: Diagnostic) => seen.push(d.code),
    });
    r.frames();
    const layout = r.layout!;
    if (layout.kind !== 'plot') throw new Error('expected a plot');
    // Every drawn tick is at most 12, so the formatter formatted each of them.
    expect(layout.xTicks.every(t => t.value <= 12)).toBe(true);
    expect(codes(r)).not.toContain('AX160');
    expect(seen).not.toContain('AX160');
  });

  it('a formatter that throws for a drawn tick still reports AX160', () => {
    const tickFormat = (v: number) => { if (v === 0) throw new Error('zero'); return String(v); };
    const r = record('scatter', { title: 'W', data: [{ x: 1.1, y: 1 }, { x: 8.9, y: 2 }], x: { field: 'x', tickFormat }, y: 'y' });
    r.frames();
    const layout = r.layout!;
    if (layout.kind !== 'plot') throw new Error('expected a plot');
    expect(layout.xTicks.some(t => t.value === 0)).toBe(true);
    expect(codes(r)).toContain('AX160');
  });
});

describe('R8 (controller half): zoom() clamps to the x domain that is drawn', () => {
  it('a 195 px scatter on x −3.3, 7.7, 1001.5 drawn on a coarser domain: zoom to −1000…1500 is a window of it', () => {
    const r = record('scatter', { title: 'R', data: [{ x: -3.3, y: 1 }, { x: 7.7, y: 2 }, { x: 1001.5, y: null }], x: 'x', y: 'y' }, { container: { width: 195, height: 400 } });
    r.frames();
    const layout = r.layout!;
    if (layout.kind !== 'plot' || layout.projection.kind !== 'xy' || layout.projection.x.type === 'band') throw new Error('expected a plot');
    const drawn = layout.projection.x.domain;
    // The layout widened the automatic domain to end at ticks a narrow plot can draw (F7).
    expect(drawn).not.toEqual((r.committed!.view as ScatterView).xFull);
    expect(drawn[0]).toBeLessThanOrEqual(-1000);
    expect(drawn[1]).toBeGreaterThan(1500);
    let event: unknown = 'none';
    r.controller.handle.on('zoom', w => { event = w; });
    r.controller.handle.zoom([-1000, 1500]);
    r.frames();
    const view = r.committed!.view as ScatterView;
    expect(view.xDomain).toEqual([-1000, 1500]);
    expect(event).toEqual([-1000, 1500]);
    // The bounds gestures read are the drawn domain too.
    expect(view.xFull).toEqual(drawn);
  });
});

describe('R13: memory() leaves the caller\'s columns out of every frame it counts', () => {
  it('a line from two 10-entry Float64Array columns, before the first frame: only the 10 bytes of slot states', () => {
    const columns = { x: Float64Array.from({ length: 10 }, (_, i) => i), y: Float64Array.from({ length: 10 }, (_, i) => i * 2) };
    const r = record('line', { title: 'M', data: { columns }, x: 'x', y: 'y' });
    const memory = r.controller.handle.__bench!.memory();
    // The borrowed x and y (80 bytes each) are the caller's; one Uint8Array of 10 slot states is the chart's.
    expect(memory.bytes).toBe(10);
  });
});
