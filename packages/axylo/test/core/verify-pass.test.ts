/**
 * The cross-provider verification of the controller fixes (reviews/2026-11-18/impl/wp/fixes-verify.controller.review.md):
 * each new defect in the controller's files as the reviewer's call sequence, and the regressions the review
 * found missing. Expected values come from the spec, the fixture rows and the retention policy's stated bound.
 */
import { describe, expect, it } from 'vitest';
import type { AlignedView, DatumRef, Frame, ScatterView } from '../../src/core/contracts';
import type { Diagnostic, Point } from '../../src/public';
import { lastModel, record, type Recording } from './host';

const rowsOf = (values: readonly number[]) => values.map(x => ({ x, y: x * 10 }));
const ref = (x: number, seriesKey = 'y'): DatumRef => ({ kind: 'aligned', seriesKey, x });
const xsOf = (r: Recording) => Array.from((r.committed!.view as AlignedView).frame.x.values);
const codes = (r: Recording) => r.controller.handle.diagnostics.map(d => d.code);
const points = (r: Recording) => (r.committed!.view as ScatterView).frame.series.flatMap(s => Array.from(s.x));

function hoverPoint(r: Recording, target: DatumRef): Point<unknown> | null | undefined {
  let seen: Point<unknown> | null | undefined;
  const off = r.controller.handle.on('hover', p => { seen = p; });
  r.controller.actions.hover(null);
  r.controller.actions.hover(target);
  r.frames(1);
  off();
  return seen;
}

describe('new defect 2: a hidden, paused chart keeps the retention bound', () => {
  it('x=2 drawn with keep 1, Pause, hide, 500 appends with keep 1 and a frame after each: within twice what was on screen plus 8', () => {
    const r = record('line', { title: 'K', data: rowsOf([0, 1]), x: 'x', y: 'y' });
    r.frames();
    r.controller.handle.append([{ x: 2, y: 20 }], { keep: 1 });
    r.frames();
    expect(xsOf(r)).toEqual([2]);
    // The policy's baseline: what the store held right after the frame that showed x=2.
    const baseline = r.controller.handle.__dev!.retainedRows();
    r.controller.actions.pause(true);
    r.container = null;
    r.controller.invalidate.resize();
    let most = 0;
    for (let x = 3; x <= 503; x++) {
      r.controller.handle.append([{ x, y: x }], { keep: 1 });
      r.frames();
      most = Math.max(most, r.controller.handle.__dev!.retainedRows());
    }
    expect(most).toBeLessThanOrEqual(2 * baseline + 8);
    // Shown again and resumed: the newest row, with its own row.
    r.container = { width: 720, height: 400 };
    r.controller.invalidate.resize();
    r.controller.actions.pause(false);
    r.frames();
    expect(xsOf(r)).toEqual([503]);
    expect(hoverPoint(r, ref(503))?.row).toEqual({ x: 503, y: 503 });
  });
});

describe('new defect 3: a tick formatter that changes the chart', () => {
  it('(a) one that switches to an unformatted field and throws: no AX160 is delivered under the new title', () => {
    const seen: [string, string][] = [];
    let chart: Recording['controller']['handle'] | null = null;
    let armed = true;
    const tickFormat = (v: number) => {
      if (armed && chart) {
        armed = false;
        chart.update({ title: 'New', y: 'z' });
        throw new Error('tick');
      }
      return String(v);
    };
    const data = [0, 1, 2].map(x => ({ x, y: x, z: 2 * x }));
    const r = record('line', {
      title: 'Old', data, x: 'x', y: { field: 'y', tickFormat }, onDiagnostic: (d: Diagnostic) => seen.push([d.code, d.chart]),
    });
    chart = r.controller.handle;
    r.frames();
    expect(lastModel(r).title?.text).toBe('New');
    // The revision whose formatter threw was never drawn; the one drawn has no tick formatter.
    expect(seen.filter(([code]) => code === 'AX160')).toEqual([]);
    expect(codes(r)).not.toContain('AX160');
  });

  it('(b) one that calls update({ title }) on every call: the new title is drawn and no frame stays pending', () => {
    let chart: Recording['controller']['handle'] | null = null;
    const tickFormat = (v: number) => {
      chart?.update({ title: 'New title' });
      return String(v);
    };
    const r = record('line', { title: 'Old title', data: rowsOf([0, 1, 2]), x: 'x', y: { field: 'y', tickFormat } });
    chart = r.controller.handle;
    r.frames(6);
    expect(lastModel(r).title?.text).toBe('New title');
    expect(r.pending).toBe(0);
  });
});

describe('new defect 4: re-encoding while paused', () => {
  it('a ninth series held: after y is changed to another populated field AX130 stays, and update({ strict: true }) is rejected', () => {
    const data = Array.from({ length: 8 }, (_, k) => ({ x: 0, s: `s${k}`, y: k, w: k + 1 }));
    const r = record('line', { title: 'P', data, x: 'x', y: 'y', series: 's' });
    r.frames();
    r.controller.handle.append([{ x: 1, s: 's0', y: 1, w: 2 }]);
    r.frames();
    r.controller.actions.pause(true);
    r.controller.handle.append([{ x: 2, s: 'ninth', y: 1, w: 2 }]);
    expect(codes(r)).toContain('AX130');
    r.controller.handle.update({ y: 'w' });
    expect(codes(r)).toContain('AX130');
    expect(() => r.controller.handle.update({ strict: true })).toThrow(/AX130/);
  });

  it('scatter: a displayed row with x null and a valid u is a point as soon as x becomes u, while paused', () => {
    const data = [{ x: 0, u: 0, y: 1 }, { x: null, u: 5, y: 2 }, { x: 2, u: 2, y: 3 }];
    const r = record('scatter', { title: 'S', data, x: 'x', y: 'y' });
    r.frames();
    r.controller.handle.append([{ x: 3, u: 3, y: 4 }]);
    r.frames();
    r.controller.actions.pause(true);
    r.controller.handle.append([{ x: 4, u: 4, y: 5 }]);
    r.controller.handle.update({ x: 'u' });
    r.frames();
    // The displayed rows read with x = u: 0, 5, 2, 3; the held arrival (u 4) waits for Resume.
    expect(points(r).sort((p, q) => p - q)).toEqual([0, 2, 3, 5]);
    r.controller.actions.pause(false);
    r.frames();
    expect(points(r).sort((p, q) => p - q)).toEqual([0, 2, 3, 4, 5]);
  });

  it('typed columns: a NaN in a typed column is "no data", not an omitted value, when re-encoded while paused', () => {
    const columns = { x: Float64Array.from([0, 1, 2]), y: Float64Array.from([1, NaN, 3]), w: Float64Array.from([2, NaN, 4]) };
    const r = record('line', { title: 'T', data: { columns }, x: 'x', y: 'y' });
    r.frames();
    expect(lastModel(r).note).toBeNull();
    r.controller.handle.append([{ x: 3, y: 4, w: 5 }]);
    r.frames();
    r.controller.actions.pause(true);
    r.controller.handle.append([{ x: 4, y: 5, w: 6 }]);
    r.controller.handle.update({ y: 'w' });
    r.frames();
    expect(xsOf(r)).toEqual([0, 1, 2, 3]);
    expect(codes(r)).not.toContain('AX103');
    expect(lastModel(r).note).toBeNull();
  });
});

describe('new defect 5: a frozen scatter frame keeps the precision its dates were written in', () => {
  it('March (YYYY-MM) queued with keep 1, Pause before its frame, April to December with keep 1: March still reads as a month', () => {
    const r = record('scatter', { title: 'M', data: [{ x: '2026-01', y: 1 }, { x: '2026-02', y: 2 }], x: 'x', y: 'y' });
    r.frames();
    r.controller.handle.append([{ x: '2026-03', y: 3 }], { keep: 1 });
    r.controller.actions.pause(true);
    for (let m = 4; m <= 12; m++) r.controller.handle.append([{ x: `2026-${String(m).padStart(2, '0')}`, y: m }], { keep: 1 });
    r.frames();
    const view = r.committed!.view as ScatterView;
    const s = view.frame.series[0]!;
    expect(s.x.length).toBe(1);
    // Spec F4: '2026-03' is a month; its text names no day.
    const text = r.committed!.formatters.x(s.x[0]!);
    expect(text).toMatch(/2026/);
    expect(text).not.toMatch(/\b1\b/);
    const point = hoverPoint(r, { kind: 'point', seriesKey: s.key, row: s.row ? s.row[0]! : 0, x: s.x[0]! });
    expect(point?.row).toEqual({ x: '2026-03', y: 3 });
  });
});

describe('new defect 6: a throwing or re-entrant getter during a call', () => {
  const throwing = () => ({ get x(): number { throw new Error('getter'); }, y: 1 });

  it('strict: an append whose x getter throws is rejected, and the chart stays as it was', () => {
    const r = record('line', { title: 'S', strict: true, data: rowsOf([0, 1, 2]), x: 'x', y: 'y' });
    r.frames();
    expect(() => r.controller.handle.append([throwing()])).toThrow();
    r.frames();
    expect(codes(r)).not.toContain('AX199');
    expect(lastModel(r).message).toBeNull();
    expect(xsOf(r)).toEqual([0, 1, 2]);
  });

  it('strict: a getter that runs a nested update does not end the outer call\'s strict check', () => {
    let chart: Recording['controller']['handle'] | null = null;
    const r = record('line', { title: 'S', strict: true, data: rowsOf([0, 1, 2]), x: 'x', y: 'y' });
    chart = r.controller.handle;
    r.frames();
    const data = [
      { get x(): number { chart!.update({ subtitle: 'nested' }); return 5; }, y: 1 },
      throwing(),
    ];
    expect(() => r.controller.handle.update({ data })).toThrow();
    r.frames();
    expect(codes(r)).not.toContain('AX199');
    expect(xsOf(r)).toEqual([0, 1, 2]);
  });

  it('a getter that destroys the chart and returns: the destroyed handle keeps nothing', () => {
    let chart: Recording['controller']['handle'] | null = null;
    const r = record('line', { title: 'D', data: rowsOf([0, 1, 2]), x: 'x', y: 'y' });
    chart = r.controller.handle;
    r.frames();
    const data = [{ get x(): number { chart!.destroy(); return 1; }, y: 1 }, { x: 2, y: 2 }];
    r.controller.handle.update({ palete: 'unknown option', data });
    r.frames();
    expect(r.disposed).toBe(1);
    expect(chart.diagnostics).toEqual([]);
    expect(chart.__dev!.retainedRows()).toBe(0);
    expect(r.writesAfterDispose).toBe(0);
    expect(r.pending).toBe(0);
  });
});

describe('table finding 7: a call that fails part-way agrees with validate()', () => {
  for (const kind of ['line', 'scatter'] as const) {
    it(`${kind}, untitled: a throwing x getter gives what validate() gives, AX140 included`, async () => {
      const { staticDiagnostics } = await import('../../src/core/stages');
      const options = { data: [{ get x(): number { throw new Error('getter'); }, y: 1 }], x: 'x', y: 'y' };
      const expected = staticDiagnostics(kind, options, 'UTC').map(d => d.code);
      expect(expected).toEqual(['AX199', 'AX140']);
      const r = record(kind, options);
      r.frames();
      expect(codes(r)).toEqual(expected);
    });
  }
});

describe('new defect 7 (controller half): the hover payload does not walk the points sharing x', () => {
  it('50,000 points at one x, a hover subscriber, the last row picked: a few row indexes read, not one per point', () => {
    const n = 50_000;
    const data = Array.from({ length: n }, (_, i) => ({ x: 1, y: i }));
    const r = record('scatter', { title: 'Same x', data, x: 'x', y: 'y' });
    r.frames();
    const view = r.committed!.view as ScatterView;
    const series = view.frame.series[0]!;
    const rows = series.row;
    expect(rows).not.toBeNull();
    const last = rows!.indexOf(n - 1);
    const target: DatumRef = { kind: 'point', seriesKey: series.key, row: n - 1, x: 1 };
    // The lookup locates the datum by itself; only the payload's own reads are counted.
    expect(r.committed!.lookup.datum(target)?.row).toBe(n - 1);
    let reads = 0;
    const counted = new Proxy(rows!, { get(t, key) { if (typeof key === 'string' && /^\d+$/.test(key)) reads++; const v = Reflect.get(t, key, t); return typeof v === 'function' ? v.bind(t) : v; } });
    Object.defineProperty(series, 'row', { value: counted, configurable: true });
    let seen: Point<unknown> | null = null;
    r.controller.handle.on('hover', p => { seen = p; });
    r.controller.actions.hover(target);
    r.frames(1);
    expect(seen).not.toBeNull();
    expect(seen!.y).toBe(series.y[last]);
    expect(seen!.row).toEqual({ x: 1, y: n - 1 });
    expect(reads).toBeLessThanOrEqual(4);
  });
});

describe('new defect 9: a donut with 112 px of plot room and a 48 px strip', () => {
  const at = (height: number, settings: { strip: number; stripUnknown?: boolean }) => {
    const r = record('donut', { title: 'D', data: [{ k: 'a', v: 1 }, { k: 'b', v: 2 }], label: 'k', value: 'v' }, { container: { width: 600, height }, ...settings });
    r.frames();
    return r;
  };
  // The plot's column is the container less the caption and the controls row (the host's model).
  const columnOf = (r: Recording) => (r.host.measure() as { room?: { height: number } } | null)?.room?.height ?? NaN;
  for (const stripUnknown of [false, true]) {
    it(`${stripUnknown ? 'estimated' : 'measured'} strip: no strip is reserved, and the ring is drawn (rule 5, L8)`, () => {
      let height = 100;
      while (columnOf(at(height, { strip: 48 })) < 112) height++;
      const r = at(height, { strip: 48, stripUnknown });
      expect(columnOf(r)).toBe(112);
      expect(r.layout!.kind).toBe('plot');
      expect(codes(r)).not.toContain('AX142');
      expect((r.prepared.at(-1) as unknown as { readoutMode?: string }).readoutMode).toBe('none');
    });
  }
});

describe('new defect 10: a narrow scatter keeps the automatic x domain ending at its ticks', () => {
  it('x 1.1, 8.9, 10.7 with the last y null, at 185 × 400: the x domain\'s ends are its first and last ticks', () => {
    const data = [{ x: 1.1, y: 1 }, { x: 8.9, y: 2 }, { x: 10.7, y: null }];
    const r = record('scatter', { title: 'N', data, x: 'x', y: 'y' });
    r.frames();
    r.container = { width: 185, height: 400 };
    r.controller.invalidate.resize();
    r.frames();
    const layout = r.layout!;
    if (layout.kind !== 'plot' || layout.projection.kind !== 'xy' || layout.projection.x.type === 'band') throw new Error('expected a plot');
    const [a, b] = layout.projection.x.domain;
    const ticks = layout.xTicks.map(t => t.value);
    expect(a).toBeLessThanOrEqual(1.1);
    expect(b).toBeGreaterThanOrEqual(10.7);
    expect(ticks[0]).toBe(a);
    expect(ticks.at(-1)).toBe(b);
  });
});

describe('new defect 12 (controller half): memory() counts the buffers of every live frame', () => {
  it('1,001 streamed rows drawn, Pause, an append with keep 2: the displayed frame\'s buffers are counted', () => {
    const r = record('line', { title: 'M', data: rowsOf([0]), x: 'x', y: 'y' });
    r.frames();
    r.controller.handle.append(rowsOf(Array.from({ length: 1000 }, (_, i) => i + 1)));
    r.frames();
    r.controller.actions.pause(true);
    r.controller.handle.append(rowsOf([1001]), { keep: 2 });
    r.frames();
    const frame = r.committed!.view.frame as Extract<Frame, { shape: 'aligned' }>;
    expect(frame.length).toBe(1001);
    // The displayed frame's own buffers, each counted once at its full length.
    const buffers = new Set<ArrayBufferLike>([frame.x.values.buffer]);
    for (const s of frame.series) for (const key of ['y', 'slot', 'row'] as const) {
      const value = Object.getOwnPropertyDescriptor(s, key)?.value as ArrayBufferView | null | undefined;
      if (value) buffers.add(value.buffer);
    }
    const displayed = [...buffers].reduce((sum, b) => sum + b.byteLength, 0);
    const memory = r.controller.handle.__bench!.memory();
    expect(memory.bytes).toBeGreaterThanOrEqual(displayed);
    expect(memory.buffers.reduce((sum, b) => sum + b.bytes, 0)).toBe(memory.bytes);
  });
});

describe('claims not confirmed: the in-flight pin', () => {
  it('the first stream frame publishing, an append with keep 1 from the commit, a hover from the commit: the frame\'s own row', () => {
    let seen: Point<unknown> | null | undefined;
    let once = false;
    const r = record('line', { title: 'Pin', data: rowsOf([0, 1, 2]), x: 'x', y: 'y' }, {
      onCommit: (_state, controller) => {
        if (!once) return;
        once = false;
        // The frame being published is the store's first; this append evicts every one of its rows.
        controller.handle.append([{ x: 9, y: 90 }], { keep: 1 });
        controller.actions.hover(ref(3));
      },
    });
    r.frames();
    r.controller.handle.on('hover', p => { seen = p; });
    r.controller.handle.append([{ x: 3, y: 30 }]);
    once = true;
    r.frames(1);
    expect(seen?.row).toEqual({ x: 3, y: 30 });
    r.frames();
    expect(xsOf(r)).toEqual([9]);
  });

  it('the held datum itself evicted: hovering it on the paused screen gives its own row, and after Resume nothing stale', () => {
    const r = record('line', { title: 'H', data: rowsOf([0, 1, 2]), x: 'x', y: 'y' });
    r.frames();
    r.controller.handle.append([{ x: 3, y: 30 }]);
    r.frames();
    r.controller.actions.pause(true);
    // Every row on screen, the hovered x 3 included, is evicted from the store while paused.
    for (let x = 4; x < 40; x++) r.controller.handle.append([{ x, y: x * 10 }], { keep: 1 });
    r.frames();
    expect(xsOf(r)).toEqual([0, 1, 2, 3]);
    expect(hoverPoint(r, ref(3))?.row).toEqual({ x: 3, y: 30 });
    r.controller.actions.pause(false);
    r.frames();
    expect(xsOf(r)).toEqual([39]);
    expect(hoverPoint(r, ref(3))).toBeNull();
    expect(hoverPoint(r, ref(39))?.row).toEqual({ x: 39, y: 390 });
  });
});

describe('claims not confirmed: a throwing value formatter and the first write', () => {
  it('no value formatter call after the first host write of a frame, with a formatter that throws', () => {
    let writes = 0;
    const calls: number[] = [];
    const format = () => { calls.push(writes); throw new Error('value'); };
    const r = record('line', { title: 'F', data: rowsOf([0, 1, 2]), x: 'x', y: { field: 'y', format } });
    const original = r.host.figure.update;
    (r.host.figure as { update: typeof original }).update = model => { writes++; return original(model); };
    const check = () => {
      const before = writes;
      calls.length = 0;
      r.frames();
      // Every call of this frame came before its first figure write.
      expect(calls.every(w => w === before)).toBe(true);
    };
    check();
    expect(codes(r)).toContain('AX160');
    r.controller.handle.update({ title: 'G' });
    check();
    r.controller.handle.update({ data: rowsOf([3, 4, 5]) });
    check();
  });
});
