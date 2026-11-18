/**
 * The final review of the controller (reviews/2026-11-18/impl/wp/core-final.controller.review.md): its Node
 * sequences, each as the reviewer ran it through this host stand-in.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AlignedView, DatumRef } from '../../src/core/contracts';
import type { Diagnostic, Point } from '../../src/public';
import { lastModel, record, type Recording } from './host';
import { defaultMessages } from '../../src/messages';

const rowsOf = (values: readonly number[]) => values.map(x => ({ x, y: x * 10 }));
const ref = (x: number, seriesKey = 'y'): DatumRef => ({ kind: 'aligned', seriesKey, x });
const xsOf = (r: Recording) => Array.from((r.committed!.view as AlignedView).frame.x.values);

function hoverRow(r: Recording, x: number, seriesKey = 'y'): Point<unknown> | null | undefined {
  let seen: Point<unknown> | null | undefined;
  const off = r.controller.handle.on('hover', p => { seen = p; });
  r.controller.actions.hover(null);
  r.controller.actions.hover(ref(x, seriesKey));
  r.frames(1);
  off();
  return seen;
}

describe('final review, finding 1: a frame keeps its source rows through publication', () => {
  it('a tick formatter that appends during the frame: the frame draws 3 and hovering 3 gives its row', () => {
    let chart: Recording['controller']['handle'] | null = null;
    let armed = false;
    const tickFormat = (v: number) => {
      if (armed && chart) { armed = false; chart.append([{ x: 4, y: 40 }], { keep: 1 }); }
      return String(v);
    };
    const r = record('line', { title: 'T', data: rowsOf([0, 1, 2]), x: 'x', y: { field: 'y', tickFormat } });
    chart = r.controller.handle;
    r.frames();
    chart.append([{ x: 3, y: 30 }], { keep: 1 });
    armed = true;
    r.frames(1);
    // What the first frame after the append drew, it can describe: its row is still there.
    const shownXs = xsOf(r);
    const x = shownXs[shownXs.length - 1]!;
    const point = hoverRow(r, x);
    expect(point?.row).toEqual({ x, y: x * 10 });
    r.frames();
    expect(xsOf(r)).toEqual([4]);
  });

  it('no author callback runs once a frame has started writing: tick and value formatters run before the first write', () => {
    const calls: string[] = [];
    let writes = 0;
    const r = record('line', {
      title: 'T', data: rowsOf([0, 1, 2]), x: 'x',
      y: { field: 'y', tickFormat: (v: number) => { calls.push(`tick@${writes}`); return String(v); }, format: (v: number) => { calls.push(`value@${writes}`); return String(v); } },
    });
    const draws = () => r.models.length + r.draws.length + r.commits;
    r.frames();
    writes = draws();
    calls.length = 0;
    // A title update: everything the frame needs from the author is computed before the figure is written.
    r.controller.handle.update({ title: 'U', data: rowsOf([5, 6, 7]) });
    const before = draws();
    let first: number | null = null;
    const original = r.host.figure.update;
    (r.host.figure as { update: typeof original }).update = model => { first ??= calls.length; return original(model); };
    r.frames();
    expect(draws()).toBeGreaterThan(before);
    // Every formatter call came before the first host write of the frame.
    expect(first).not.toBeNull();
    expect(calls.length).toBe(first);
  });

  it('a stage failing after a callback changed the chart mid-publication does not put the newer update into AX199', () => {
    let once = true;
    const r = record('line', { title: 'A', data: rowsOf([0, 1, 2]), x: 'x', y: 'y' }, {
      onCommit: (_state, controller) => {
        if (!once) return;
        once = false;
        controller.handle.update({ title: 'B' });
        throw new Error('the interaction layer failed after the update');
      },
    });
    r.frames();
    expect(r.controller.handle.diagnostics.map(d => d.code)).not.toContain('AX199');
    expect(lastModel(r).title?.text).toBe('B');
    expect(lastModel(r).message).toBeNull();
  });

  it('destroy() from a hover listener while the frame commits: nothing is published after it, the data is let go', () => {
    let destroyedAt = -1;
    const r = record('line', { title: 'D', data: rowsOf([0, 1, 2]), x: 'x', y: 'y' }, {
      onCommit: (_state, controller) => controller.actions.hover(ref(1)),
    });
    r.controller.handle.on('hover', () => { destroyedAt = r.commits; r.controller.handle.destroy(); });
    r.frames();
    expect(destroyedAt).toBeGreaterThan(0);
    expect(r.disposed).toBe(1);
    expect(r.writesAfterDispose).toBe(0);
    expect(r.controller.handle.__dev?.retainedRows()).toBe(0);
  });
});

describe('final review, finding 2: keep bounds retention while paused', () => {
  it('paused before the frame of an append, 500 more appends with keep 1 and no frames: a bounded store', () => {
    const r = record('line', { title: 'K', data: rowsOf([0, 1]), x: 'x', y: 'y' });
    r.frames();
    r.controller.handle.append([{ x: 2, y: 20 }], { keep: 1 });
    r.controller.actions.pause(true);
    for (let x = 3; x <= 503; x++) r.controller.handle.append([{ x, y: x }], { keep: 1 });
    // Twice what was on screen (two rows) plus the slack of 8, at most: then the frames copy their rows.
    expect(r.controller.handle.__dev?.retainedRows()).toBeLessThanOrEqual(12);
  });

  it('paused with 2 on screen, a frame after every append with keep 1: a bounded store', () => {
    const r = record('line', { title: 'K', data: rowsOf([0, 1]), x: 'x', y: 'y' });
    r.frames();
    r.controller.handle.append([{ x: 2, y: 20 }], { keep: 1 });
    r.frames();
    r.controller.actions.pause(true);
    for (let x = 3; x <= 503; x++) {
      r.controller.handle.append([{ x, y: x }], { keep: 1 });
      r.frames();
    }
    // Twice what was on screen (two rows) plus the slack of 8, at most: then the frames copy their rows.
    expect(r.controller.handle.__dev?.retainedRows()).toBeLessThanOrEqual(12);
    // The paused screen still shows 2, with its row.
    expect(xsOf(r)).toEqual([2]);
    expect(hoverRow(r, 2)?.row).toEqual({ x: 2, y: 20 });
  });
});

describe('final review, finding 3: an append after a failed Resume supersedes the held revision', () => {
  it('display 2, pause, append 3, Resume fails, append 4, draw; a title update keeps 4 on screen with its row', () => {
    const r = record('line', { title: 'R', data: rowsOf([0, 1]), x: 'x', y: 'y' });
    r.frames();
    r.controller.handle.append([{ x: 2, y: 20 }], { keep: 1 });
    r.frames();
    r.controller.actions.pause(true);
    r.controller.handle.append([{ x: 3, y: 30 }], { keep: 1 });
    r.controller.handle.__dev!.fail('view');
    r.controller.actions.pause(false);
    r.controller.handle.__dev!.fail(null);
    r.frames();
    r.controller.handle.append([{ x: 4, y: 40 }], { keep: 1 });
    r.frames();
    expect(xsOf(r)).toEqual([4]);
    r.controller.handle.update({ title: 'R2' });
    r.frames();
    expect(xsOf(r)).toEqual([4]);
    expect(hoverRow(r, 4)?.row).toEqual({ x: 4, y: 40 });
    const ax199 = r.controller.handle.diagnostics.filter((d: Diagnostic) => d.code === 'AX199');
    expect(ax199).toEqual([]);
  });
});

describe('final review, finding 11: a cached layout keeps its findings', () => {
  it('a throwing y tick formatter: AX160 and the note survive a loading state and its end at the same size', () => {
    const tickFormat = () => { throw new Error('tick'); };
    const r = record('line', { title: 'C', data: rowsOf([0, 1, 2]), x: 'x', y: { field: 'y', tickFormat } });
    r.frames();
    expect(r.controller.handle.diagnostics.map(d => d.code)).toContain('AX160');
    r.controller.handle.update({ state: 'loading' });
    r.frames();
    r.controller.handle.update({ state: undefined });
    r.frames();
    expect(r.controller.handle.diagnostics.map(d => d.code)).toContain('AX160');
    expect(lastModel(r).note).toMatch(/shown differently|changed/i);
  });
});

describe('final review, finding 12: temporal inputs are snapshots; emitted windows round-trip', () => {
  const t = Date.UTC(2026, 0, 1);
  const day = 86_400_000;
  const data = [0, 1, 2, 3, 4].map(i => ({ x: new Date(t + i * day), y: i }));

  it('a Date in x.domain mutated and resubmitted takes effect', () => {
    const from = new Date(t);
    const x = { field: 'x', domain: [from, new Date(t + 4 * day)] };
    const r = record('line', { title: 'D', data, x, y: 'y' });
    r.frames();
    from.setTime(t + 2 * day);
    r.controller.handle.update({ x });
    r.frames();
    expect((r.committed!.view as AlignedView).xDomain[0]).toBe(t + 2 * day);
  });

  it('a Date passed to zoom() and mutated later does not move the window', () => {
    const r = record('line', { title: 'Z', data, x: 'x', y: 'y' });
    r.frames();
    const start = new Date(t + day);
    r.controller.handle.zoom([start, new Date(t + 3 * day)]);
    r.frames();
    start.setTime(t);
    r.controller.handle.update({ reference: [{ y: 1, label: 'R' }] });
    r.frames();
    expect((r.committed!.view as AlignedView).xDomain).toEqual([t + day, t + 3 * day]);
  });

  it('a window between milliseconds is emitted as numbers, which another chart reads as the same window', () => {
    const r = record('line', { title: 'Z', data, x: 'x', y: 'y' });
    r.frames();
    let window: unknown = null;
    r.controller.handle.on('zoom', w => { window = w; });
    r.controller.actions.zoom([t + 0.25, t + 0.75]);
    r.frames();
    expect(window).toEqual([t + 0.25, t + 0.75]);
    const other = record('line', { title: 'O', data, x: 'x', y: 'y' });
    other.frames();
    other.controller.handle.zoom(window as never);
    other.frames();
    expect((other.committed!.view as AlignedView).xDomain).toEqual([t + 0.25, t + 0.75]);
  });
});

describe('final review, finding 13: zoom on a compact chart is a reported no-op', () => {
  for (const kind of ['line', 'area', 'bar'] as const) {
    it(`${kind}: no event, AX150, and nothing applied when compact is turned off`, () => {
      const seen: string[] = [];
      const r = record(kind, { title: 'C', compact: true, data: rowsOf([0, 1, 2, 3, 4]), x: 'x', y: 'y', onDiagnostic: (d: Diagnostic) => seen.push(d.code) });
      r.frames();
      let events = 0;
      r.controller.handle.on('zoom', () => { events++; });
      r.controller.handle.zoom([1, 3]);
      r.frames();
      expect(events).toBe(0);
      expect(seen).toContain('AX150');
      r.controller.handle.update({ compact: false });
      r.frames();
      const view = r.committed!.view as AlignedView;
      expect(view.xDomain).toEqual(view.xFull);
    });
  }
});

describe('final review, finding 14: a watcher that fails part-way leaves nothing registered', () => {
  it('the theme observer\'s observe() throws after its three media listeners registered: all three are removed', async () => {
    const { watchTheme } = await import('../../src/theme/watch');
    const live = new Set<unknown>();
    const list = () => ({
      addEventListener: (_: string, fn: unknown) => { live.add(fn); },
      removeEventListener: (_: string, fn: unknown) => { live.delete(fn); },
    });
    const win = {
      matchMedia: () => list(),
      MutationObserver: class { observe() { throw new Error('observe failed'); } disconnect() {} },
    };
    const doc = { defaultView: win, documentElement: {} };
    const element = { ownerDocument: doc, getRootNode: () => doc };
    expect(() => watchTheme(element as unknown as Element, () => {})).toThrow(/observe failed/);
    expect(live.size).toBe(0);
  });
});

describe('final review, finding 9 and decision 0004 revision 3, rule 5: three readout modes', () => {
  const modeOf = (r: Recording) => (r.prepared.at(-1) as unknown as { readoutMode?: string }).readoutMode;
  it('a 330 × 205 container: a 92 px plot cannot spare a strip and stay at 80 px, so no readout at all (not floating)', () => {
    const r = record('line', { title: 'S', data: rowsOf([0, 1, 2, 3]), x: 'x', y: 'y' }, { container: { width: 330, height: 205 } });
    r.frames();
    const layout = r.layout!;
    if (layout.kind !== 'plot') throw new Error('expected a plot');
    expect(layout.plot.height).toBeLessThan(140);
    expect(modeOf(r)).toBe('none');
    expect(r.prepared.at(-1)!.readout).toBe(false);
  });

  it('a plot under 140 px that keeps 80 px beside the strip reserves the strip', () => {
    const r = record('line', { title: 'S', data: rowsOf([0, 1, 2, 3]), x: 'x', y: 'y' }, { container: { width: 600, height: 250 } });
    r.frames();
    const layout = r.layout!;
    if (layout.kind !== 'plot') throw new Error('expected a plot');
    expect(layout.plot.height).toBeLessThan(140);
    expect(layout.plot.height).toBeGreaterThanOrEqual(80 + 40);
    expect(modeOf(r)).toBe('strip');
    expect(r.prepared.at(-1)!.readout).toBe(true);
  });

  it('a large plot floats', () => {
    const r = record('line', { title: 'S', data: rowsOf([0, 1, 2, 3]), x: 'x', y: 'y' }, { container: { width: 720, height: 400 } });
    r.frames();
    expect(modeOf(r)).toBe('floating');
  });
});

describe('final review, finding 15 and amended F7: which axes follow the first-tick rule', () => {
  it('a line on x 1.1 to 8.9 spans exactly its data (x is not a value axis)', () => {
    const r = record('line', { title: 'L', data: [{ x: 1.1, y: 1 }, { x: 8.9, y: 2 }], x: 'x', y: 'y' });
    r.frames();
    expect((r.committed!.view as AlignedView).xDomain).toEqual([1.1, 8.9]);
  });

  it('a scatter on x 1.1 to 8.9: the x domain ends at its first and last drawn ticks, which reach the data', () => {
    const r = record('scatter', { title: 'S', data: [{ x: 1.1, y: 1 }, { x: 8.9, y: 2 }], x: 'x', y: 'y' });
    r.frames();
    const layout = r.layout!;
    if (layout.kind !== 'plot' || layout.projection.kind !== 'xy' || layout.projection.x.type === 'band') throw new Error('expected a plot');
    const [a, b] = layout.projection.x.domain;
    const ticks = layout.xTicks.map(t => t.value);
    expect(a).toBeLessThanOrEqual(1.1);
    expect(b).toBeGreaterThanOrEqual(8.9);
    expect(ticks[0]).toBe(a);
    expect(ticks.at(-1)).toBe(b);
    // The lookup reads the same projection: the leftmost point is at the domain's place for 1.1.
    expect(ticks.find(t => t >= 8.9)).toBe(b);
    expect([...ticks].reverse().find(t => t <= 1.1)).toBe(a);
  });
});

describe('eighth pass: what describe() reports is what was drawn', () => {
  it('a short wide tile whose layout widens the automatic y domain: describe() gives the drawn domain', () => {
    const data = Array.from({ length: 40 }, (_, i) => ({ x: i, y: 80 + (i * 37) % 100 }));
    const r = record('line', { title: 'Tile', data, x: 'x', y: 'y' }, { container: { width: 1200, height: 180 } });
    r.frames();
    const layout = r.layout!;
    if (layout.kind !== 'plot' || layout.projection.kind !== 'xy') throw new Error('expected a plot');
    // The case the harness met: the drawn domain is not the view's (F7 widened it for the short plot).
    expect(layout.projection.y.domain).not.toEqual((r.committed!.view as AlignedView).yDomain);
    const d = r.controller.handle.__bench!.describe() as { yDomain: readonly number[] | null; plot?: { height: number } | null };
    expect(d.yDomain).toEqual(layout.projection.y.domain);
    expect(d.plot?.height).toBe(layout.plot.height);
  });

  it('describe() gives the drawn runs and the basis of kept indexes; memory() lists the chart\'s own buffers', () => {
    const data = [0, 1, 2, 3, 4, 5].map(x => ({ x, y: x === 3 ? null : x }));
    const r = record('line', { title: 'Runs', data, x: 'x', y: 'y' });
    r.frames();
    const bench = r.controller.handle.__bench as unknown as {
      describe(): { series: { kept?: number[]; breaks?: number[]; keptBasis?: string; isolatedMarkers?: boolean }[] };
      memory(): { bytes: number; buffers: { name: string; bytes: number }[] };
    };
    const s = bench.describe().series[0]!;
    expect(s.kept).toEqual([0, 1, 2, 4, 5]);
    expect(s.breaks).toEqual([3]);
    expect(s.keptBasis).toBe('rows');
    const m = bench.memory();
    expect(m.bytes).toBeGreaterThan(0);
    expect(m.buffers.reduce((a, b) => a + b.bytes, 0)).toBe(m.bytes);
  });
});

describe('final review, finding 7: a call that fails part-way agrees with validate() and with strict', () => {
  const bad = () => [{ get x(): number { throw new Error('getter'); }, y: 1 }, { x: 2, y: 2 }];
  for (const kind of ['line', 'area', 'bar', 'scatter'] as const) {
    it(`${kind}: an unknown option and a throwing x getter: AX150 then AX199, as validate() says`, async () => {
      const { staticDiagnostics } = await import('../../src/core/stages');
      const options = { title: 'V', palete: 'x', data: bad(), x: 'x', y: 'y' };
      const expected = staticDiagnostics(kind, options, 'UTC').map(d => d.code);
      expect(expected).toEqual(['AX150', 'AX199']);
      const r = record(kind, options);
      r.frames();
      expect(r.controller.handle.diagnostics.map(d => d.code)).toEqual(expected);
    });
  }

  it('strict: create with them throws, and a strict update with a throwing getter keeps the last good chart', () => {
    expect(() => record('line', { title: 'S', strict: true, palete: 'x', data: bad(), x: 'x', y: 'y' })).toThrow();
    const r = record('line', { title: 'Good', strict: true, data: rowsOf([0, 1, 2]), x: 'x', y: 'y' });
    r.frames();
    expect(() => r.controller.handle.update({ title: 'Bad', data: bad() })).toThrow();
    r.frames();
    expect(lastModel(r).title?.text).toBe('Good');
    expect(lastModel(r).message).toBeNull();
    expect(r.controller.handle.diagnostics.map(d => d.code)).not.toContain('AX199');
  });
});

describe('final review, finding 6 (part): while paused the held window counts for strict', () => {
  it('a ninth series held while paused: update({ strict: true }) is rejected, as the append reported AX130', () => {
    const data = Array.from({ length: 8 }, (_, k) => ({ x: 0, s: `s${k}`, y: k }));
    const r = record('line', { title: 'P', data, x: 'x', y: 'y', series: 's' });
    r.frames();
    r.controller.handle.append([{ x: 1, s: 's0', y: 1 }]);
    r.frames();
    r.controller.actions.pause(true);
    r.controller.handle.append([{ x: 2, s: 'ninth', y: 1 }]);
    expect(r.controller.handle.diagnostics.map(d => d.code)).toContain('AX130');
    expect(() => r.controller.handle.update({ strict: true })).toThrow();
  });
});

describe('final review, displayed snapshots: a property over richer call sequences, against an independent model', () => {
  type Op =
    | { op: 'append'; n: number; keep: number | null } | { op: 'title' } | { op: 'data' } | { op: 'reencode' }
    | { op: 'pause' } | { op: 'resume' } | { op: 'zoom'; from: number; width: number } | { op: 'unzoom' } | { op: 'frame' }
    | { op: 'fail'; stage: 'view' | 'layout' | 'scene' | 'lookup' | 'reader' | 'draw' | 'figure' } | { op: 'heal' }
    | { op: 'collapse' } | { op: 'restore' } | { op: 'reenter' };
  const ops = fc.oneof(
    fc.record({ op: fc.constant('append' as const), n: fc.integer({ min: 1, max: 3 }), keep: fc.option(fc.integer({ min: 1, max: 6 }), { nil: null }) }),
    fc.record({ op: fc.constant('zoom' as const), from: fc.integer({ min: 0, max: 30 }), width: fc.integer({ min: 2, max: 10 }) }),
    fc.record({ op: fc.constant('fail' as const), stage: fc.constantFrom('view', 'layout', 'scene', 'lookup', 'reader', 'draw', 'figure') }),
    ...(['title', 'data', 'reencode', 'pause', 'resume', 'unzoom', 'frame', 'frame', 'frame', 'heal', 'collapse', 'restore', 'reenter'] as const)
      .map(op => fc.constant({ op })),
  ) as fc.Arbitrary<Op>;

  it('what is drawn after each frame is the model\'s window, with its caption, its rows and bounded retention', () => {
    fc.assert(fc.property(fc.array(ops, { maxLength: 30 }), fc.boolean(), (sequence, destroyAtEnd) => {
      const rows = new Map<number, Record<string, unknown>>();
      const add = (xs: number[]) => xs.map(x => { const row = { x, a: x % 7, b: -(x % 5) }; rows.set(x, row); return row; });
      let reenterOnce = false;
      let chart: Recording['controller']['handle'] | null = null;
      const format = (v: number) => {
        // A formatter calling back into the chart once: the frame stays coherent and the call is drawn next.
        if (reenterOnce && chart) { reenterOnce = false; chart.update({ subtitle: `re${v}` }); }
        return String(v);
      };
      const r = record('line', { title: 'M0', data: add([0, 1, 2]), x: 'x', y: { field: 'a', format } });
      chart = r.controller.handle;
      // The model: the stream's rows (oldest first), what the screen may show, the caption.
      let data = [0, 1, 2];
      let visible = [0, 1, 2];
      let title = 'M0';
      let field: 'a' | 'b' = 'a';
      let paused = false;
      let failing = false;
      let failedSinceHeal = false;
      let collapsed = false;
      let next = 3;
      let tick = 1;
      let keepUsed = Infinity;
      /** The store's rows (0 while the chart shows the caller's own data) and the policy's baseline. */
      let streamed = false;
      let baseline = 0;
      let lastShown: number[] | null = null;
      for (const step of sequence) {
        switch (step.op) {
          case 'append': {
            const xs = Array.from({ length: step.n }, () => next++);
            chart.append(add(xs), step.keep === null ? undefined : { keep: step.keep });
            data = [...data, ...xs];
            streamed = true;
            if (step.keep !== null) { data = data.slice(-step.keep); keepUsed = step.keep; }
            if (!paused) visible = data;
            break;
          }
          case 'title': title = `M${tick++}`; chart.update({ title }); break;
          case 'data': data = [next, next + 1]; next += 2; add(data); chart.update({ data: data.map(x => rows.get(x)) }); visible = data; keepUsed = Infinity; streamed = false; break;
          case 'reencode': field = field === 'a' ? 'b' : 'a'; chart.update({ y: { field, format } }); break;
          case 'pause': chart && r.controller.actions.pause(true); paused = true; break;
          case 'resume': r.controller.actions.pause(false); paused = false; if (!failing) visible = data; break;
          case 'zoom': chart.zoom([step.from, step.from + step.width]); break;
          case 'unzoom': chart.zoom(null); break;
          case 'frame': r.frames(); break;
          case 'fail': chart.__dev!.fail(step.stage); failing = true; failedSinceHeal = true; break;
          case 'heal': chart.__dev!.fail(null); failing = false; break;
          case 'collapse': r.container = { width: 0, height: 0 }; r.controller.invalidate.resize(); collapsed = true; break;
          case 'restore': r.container = { width: 720, height: 400 }; r.controller.invalidate.resize(); collapsed = false; break;
          case 'reenter': reenterOnce = true; chart.update({ description: `d${tick++}` }); break;
        }
        if (step.op !== 'frame') continue;
        if (collapsed) {
          // Nothing could be measured: no marks outlive the frame, and the error state, if any, is complete.
          if (r.draws.length) expect(r.draws.at(-1)!.marks).toEqual([]);
          continue;
        }
        const errorShown = lastModel(r)?.message === defaultMessages.internalError;
        if (failing || failedSinceHeal) {
          // A frame that hit the failing stage, or a call that did, shows the error state: AX199 and no marks.
          if (errorShown) {
            expect(chart.diagnostics.map(d => d.code)).toContain('AX199');
            if (r.draws.length) expect(r.draws.at(-1)!.marks).toEqual([]);
          }
          if (failing || errorShown) continue;
          failedSinceHeal = false;
        }
        expect(errorShown).toBe(false);
        // After a clean frame: the drawn window is the model's (marks, lookup and caption on one revision).
        const committed = r.committed;
        if (!committed) continue;
        const view = committed.view as AlignedView;
        const xs = Array.from(view.frame.x.values);
        if (!paused) expect(xs).toEqual(visible);
        else expect(visible.slice(-xs.length)).toEqual(xs);
        expect(lastModel(r).title?.text).toBe(title);
        // The marks, read back through the drawn projection, are the model's rows: every vertex is a row of the
        // window (its x and its value of the current field), inside the zoomed domain or the nearest row beyond
        // each end of it (a segment crossing the edge), and a window with rows in the domain has a path.
        const layout = committed.layout;
        if (layout.kind === 'plot' && layout.projection.kind === 'xy' && layout.projection.x.type !== 'band') {
          const { x: px, y: py } = layout.projection;
          const [d0, d1] = px.domain;
          const inside = xs.filter(x => x >= d0 && x <= d1);
          const allowed = new Set(inside);
          const below = xs.filter(x => x < d0).at(-1);
          const above = xs.find(x => x > d1);
          if (below !== undefined) allowed.add(below);
          if (above !== undefined) allowed.add(above);
          const path = r.draws.at(-1)!.marks.find(m => m.type === 'path');
          if (inside.length > 1) expect(path).toBeDefined();
          if (path?.type === 'path') {
            for (let k = 0; k < path.xy.length; k += 2) {
              const x = px.invert(path.xy[k]!);
              const nearest = Math.round(x);
              expect(Math.abs(x - nearest)).toBeLessThan(0.1);
              expect(allowed.has(nearest)).toBe(true);
              expect(py.invert(path.xy[k + 1]!)).toBeCloseTo(rows.get(nearest)![field] as number, 1);
            }
          }
        }
        // Every x on screen answers a hover with the caller's own row.
        for (const x of xs) expect(hoverRow(r, x, view.frame.series[0]!.key)?.row).toBe(rows.get(x));
        // Retention, at the policy's own bound: running, the store holds the model's window and nothing else;
        // paused, at most twice what it held when the shown rows last changed, plus 8, or the window itself.
        const retained = chart.__dev!.retainedRows();
        if (lastShown === null || lastShown.join() !== xs.join()) { baseline = retained; lastShown = xs; }
        if (!paused) expect(retained).toBe(streamed ? data.length : 0);
        else expect(retained).toBeLessThanOrEqual(Math.max(2 * baseline + 8, data.length));
      }
      if (destroyAtEnd) {
        chart.destroy();
        expect(chart.__dev!.retainedRows()).toBe(0);
        expect(r.writesAfterDispose).toBe(0);
      }
    }), { numRuns: 300 });
  });
});

describe('data agent, item 1: the caller\'s columns become collectible', () => {
  const collect = async (): Promise<void> => {
    const gc = (globalThis as { gc?: () => void }).gc;
    if (!gc) throw new Error('needs --expose-gc');
    for (let i = 0; i < 3; i++) { gc(); await new Promise(r => setTimeout(r, 0)); }
  };
  /** The recording host keeps every state it was given: only the current ones may hold anything. */
  const forget = (r: Recording) => { r.prepared = r.prepared.slice(-1); r.models = r.models.slice(-1); r.draws = r.draws.slice(-1); r.texts = r.texts.slice(-1); };
  const columns = (n: number) => ({ x: Float64Array.from({ length: n }, (_, i) => i), y: Float64Array.from({ length: n }, (_, i) => i % 7) });

  it('after a replacement the first columns are let go, with no locale change', async () => {
    let first: ReturnType<typeof columns> | null = columns(1000);
    const ref = new WeakRef(first.x);
    const r = record('line', { title: 'C', data: { columns: first }, x: 'x', y: { field: 'y', format: (v: number) => String(v) } });
    r.frames();
    first = null;
    r.controller.handle.update({ data: { columns: columns(10) } });
    r.frames();
    forget(r);
    await collect();
    expect(ref.deref()).toBeUndefined();
  });

  it('a stream with keep 2 lets the opening columns go once they left the window', async () => {
    let first: ReturnType<typeof columns> | null = columns(1000);
    const ref = new WeakRef(first.x);
    const r = record('line', { title: 'K', data: { columns: first }, x: 'x', y: 'y' });
    r.frames();
    first = null;
    for (let x = 1000; x < 1010; x++) { r.controller.handle.append([{ x, y: 1 }], { keep: 2 }); r.frames(); }
    forget(r);
    await collect();
    expect(ref.deref()).toBeUndefined();
  });
});

describe('final review, finding 6 (rest): paused re-encoding and recovery', () => {
  it('scatter, paused: re-encoding y to z keeps the row { x: 1, y: null, z: 11 }, now a point', () => {
    const data = [{ x: 0, y: 5, z: 10 }, { x: 1, y: null, z: 11 }, { x: 2, y: 6, z: 12 }];
    const r = record('scatter', { title: 'S', data, x: 'x', y: 'y' });
    r.frames();
    r.controller.handle.append([{ x: 3, y: 7, z: 13 }]);
    r.frames();
    r.controller.actions.pause(true);
    r.controller.handle.append([{ x: 4, y: 8, z: 14 }]);
    r.controller.handle.update({ y: 'z' });
    r.frames();
    const view = r.committed!.view as unknown as { frame: { series: { x: Float64Array; y: Float64Array }[] } };
    const points = view.frame.series.flatMap(s => Array.from(s.x, (x, i) => [x, s.y[i]]));
    expect(points).toContainEqual([1, 11]);
    // Paused: the arrival (x 4) is still held.
    expect(points.map(p => p[0])).not.toContain(4);
    r.controller.actions.pause(false);
    r.frames();
    const after = (r.committed!.view as unknown as { frame: { series: { x: Float64Array }[] } }).frame.series.flatMap(s => Array.from(s.x));
    expect(after).toContain(4);
  });

  it('a Resume from an AX103 handler during a paused re-encoding: running, and the arrivals are shown', () => {
    let resume = false;
    const r = record('line', {
      title: 'R', data: [{ x: 0, y: 1, w: 1 }, { x: 1, y: 2, w: 2 }], x: 'x', y: 'y',
      onDiagnostic: (d: Diagnostic) => { if (resume && d.code === 'AX103') { resume = false; r.controller.actions.pause(false); } },
    });
    r.frames();
    r.controller.handle.append([{ x: 2, y: 3, w: 3 }]);
    r.frames();
    r.controller.actions.pause(true);
    r.controller.handle.append([{ x: 3, y: 4, w: Number.NaN }]);
    resume = true;
    r.controller.handle.update({ y: 'w' });
    r.frames();
    expect(resume).toBe(false);
    // Running again, so nothing may stay held: the arrival at x 3 is on screen.
    expect(xsOf(r)).toContain(3);
    r.controller.handle.append([{ x: 4, y: 5, w: 5 }]);
    r.frames();
    expect(xsOf(r)).toContain(4);
  });

  it('a missing-field AX101 goes once a valid held append is resumed', () => {
    const r = record('line', { title: 'A', data: [{ x: 0 }, { x: 1 }], x: 'x', y: 'y' });
    r.frames();
    expect(r.controller.handle.diagnostics.map(d => d.code)).toContain('AX101');
    r.controller.actions.pause(true);
    r.controller.handle.append([{ x: 2, y: 3 }]);
    r.controller.actions.pause(false);
    r.frames();
    expect(r.controller.handle.diagnostics.map(d => d.code)).not.toContain('AX101');
    expect(xsOf(r)).toContain(2);
  });
});

describe('final review, displayed snapshots: two series on line, bar and scatter, with re-entry from event handlers', () => {
  type Op =
    | { op: 'append'; n: number; keep: number | null } | { op: 'title' } | { op: 'data' } | { op: 'reencode' }
    | { op: 'pause' } | { op: 'resume' } | { op: 'zoom'; from: number; width: number } | { op: 'unzoom' } | { op: 'frame' }
    | { op: 'fail'; stage: 'view' | 'layout' | 'scene' | 'lookup' | 'reader' | 'draw' | 'figure' } | { op: 'heal' }
    | { op: 'collapse' } | { op: 'restore' } | { op: 'hoverHook' } | { op: 'zoomHook' } | { op: 'hover' };
  const ops = fc.oneof(
    fc.record({ op: fc.constant('append' as const), n: fc.integer({ min: 1, max: 3 }), keep: fc.option(fc.integer({ min: 2, max: 6 }), { nil: null }) }),
    fc.record({ op: fc.constant('zoom' as const), from: fc.integer({ min: 0, max: 30 }), width: fc.integer({ min: 2, max: 10 }) }),
    fc.record({ op: fc.constant('fail' as const), stage: fc.constantFrom('view', 'layout', 'scene', 'lookup', 'reader', 'draw', 'figure') }),
    ...(['title', 'data', 'reencode', 'pause', 'resume', 'unzoom', 'frame', 'frame', 'frame', 'heal', 'collapse', 'restore', 'hoverHook', 'zoomHook', 'hover'] as const)
      .map(op => fc.constant({ op })),
  ) as fc.Arbitrary<Op>;

  for (const kind of ['line', 'bar', 'scatter'] as const) {
    it(`${kind}: the drawn window is the model's after each clean frame; listeners may call back into the chart`, () => {
      fc.assert(fc.property(fc.array(ops, { maxLength: 30 }), sequence => {
        const rows = new Map<number, Record<string, unknown>>();
        // Two series, alternating, one row per x: the frame's x positions are the model's x values.
        const add = (xs: number[]) => xs.map(x => { const row = { x, s: x % 2 ? 'q' : 'p', a: x % 7, b: -(x % 5) }; rows.set(x, row); return row; });
        const r = record(kind, { title: 'M0', data: add([0, 1, 2, 3]), x: 'x', y: 'a', series: 's' });
        const chart = r.controller.handle;
        let data = [0, 1, 2, 3];
        let visible = [...data];
        let title = 'M0';
        let field: 'a' | 'b' = 'a';
        let paused = false;
        let failing = false;
        let failedSinceHeal = false;
        let collapsed = false;
        let next = 4;
        let tick = 1;
        let keepUsed = Infinity;
        let streamed = false;
        let baseline = 0;
        let lastShown: number[] | null = null;
        const appendModel = (xs: number[], keep: number | null) => {
          data = [...data, ...xs];
          streamed = true;
          if (keep !== null) { data = data.slice(-keep); keepUsed = keep; }
          if (!paused) visible = data;
        };
        for (const step of sequence) {
          switch (step.op) {
            case 'append': {
              const xs = Array.from({ length: step.n }, () => next++);
              chart.append(add(xs), step.keep === null ? undefined : { keep: step.keep });
              appendModel(xs, step.keep);
              break;
            }
            case 'title': title = `M${tick++}`; chart.update({ title }); break;
            case 'data': data = [next, next + 1, next + 2]; next += 3; add(data); chart.update({ data: data.map(x => rows.get(x)) }); visible = data; keepUsed = Infinity; streamed = false; break;
            case 'reencode': field = field === 'a' ? 'b' : 'a'; chart.update({ y: field }); break;
            case 'pause': r.controller.actions.pause(true); paused = true; break;
            case 'resume': r.controller.actions.pause(false); paused = false; if (!failing) visible = data; break;
            case 'zoom': chart.zoom([step.from, step.from + step.width]); break;
            case 'unzoom': chart.zoom(null); break;
            case 'frame': r.frames(); break;
            case 'fail': chart.__dev!.fail(step.stage); failing = true; failedSinceHeal = true; break;
            case 'heal': chart.__dev!.fail(null); failing = false; break;
            case 'collapse': r.container = { width: 0, height: 0 }; r.controller.invalidate.resize(); collapsed = true; break;
            case 'restore': r.container = { width: 720, height: 400 }; r.controller.invalidate.resize(); collapsed = false; break;
            case 'hoverHook': {
              // A hover listener that updates the chart and changes its zoom, once.
              const off = chart.on('hover', () => { off(); chart.update({ subtitle: `h${tick++}` }); chart.zoom(null); });
              break;
            }
            case 'zoomHook': {
              // A zoom listener that appends, once: the model takes the row when the listener runs.
              const off = chart.on('zoom', () => {
                off();
                const x = next++;
                chart.append(add([x]));
                appendModel([x], null);
              });
              break;
            }
            case 'hover': {
              const committed = r.committed;
              if (committed && committed.view.kind !== 'donut' && committed.view.kind !== 'scatter') {
                const v = committed.view as AlignedView;
                const x = v.frame.x.values[0];
                if (x !== undefined) r.controller.actions.hover(ref(x, String(rows.get(x)?.s ?? 'p')));
              }
              break;
            }
          }
          if (step.op !== 'frame') continue;
          if (collapsed) {
            if (r.draws.length) expect(r.draws.at(-1)!.marks).toEqual([]);
            continue;
          }
          const errorShown = lastModel(r)?.message === defaultMessages.internalError;
          if (failing || failedSinceHeal) {
            if (errorShown) {
              expect(chart.diagnostics.map(d => d.code)).toContain('AX199');
              if (r.draws.length) expect(r.draws.at(-1)!.marks).toEqual([]);
            }
            if (failing || errorShown) continue;
            failedSinceHeal = false;
          }
          expect(errorShown).toBe(false);
          const committed = r.committed;
          if (!committed) continue;
          const view = committed.view;
          const xs = view.kind === 'scatter'
            ? [...new Set(view.frame.series.flatMap(s => Array.from(s.x)))].sort((p, q) => p - q)
            : view.kind === 'donut' ? [] : Array.from((view as AlignedView).frame.x.values);
          if (!paused) expect(xs).toEqual(visible);
          else expect(visible.slice(-xs.length)).toEqual(xs);
          expect(lastModel(r).title?.text).toBe(title);
          if (view.kind !== 'scatter') {
            for (const x of xs) {
              const row = rows.get(x)!;
              expect(hoverRow(r, x, String(row.s))?.row).toBe(row);
            }
          } else {
            // Scatter provenance: every point answers a hover with the caller's own row, found by its source row.
            for (const s of view.frame.series) {
              for (let i = 0; i < s.x.length; i++) {
                const target: DatumRef = { kind: 'point', seriesKey: s.key, row: s.row ? s.row[i]! : i, x: s.x[i]! };
                let seen: Point<unknown> | null | undefined;
                const off = chart.on('hover', p => { seen = p; });
                r.controller.actions.hover(target);
                r.frames(1);
                off();
                expect(seen?.row).toBe(rows.get(s.x[i]!));
                expect(seen?.y).toBe(s.y[i]);
              }
            }
          }
          const retained = chart.__dev!.retainedRows();
          if (lastShown === null || lastShown.join() !== xs.join()) { baseline = retained; lastShown = xs; }
          if (!paused) expect(retained).toBe(streamed ? data.length : 0);
          else expect(retained).toBeLessThanOrEqual(Math.max(2 * baseline + 8, data.length));
        }
        chart.destroy();
        expect(chart.__dev!.retainedRows()).toBe(0);
        expect(r.writesAfterDispose).toBe(0);
      }), { numRuns: 200 });
    });
  }
});

describe('verification review: reserving a strip never removes a readable plot (decision 0004 rule 5)', () => {
  // The plot's column is the container less the caption (20 px title) and the controls (30 px): the layout's plot
  // is that column less its axes. The container heights below are found from the layout itself.
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
  const run = (height: number, strip: number) => {
    const r = record('line', { title: 'S', data: rowsOf([0, 1, 2, 3]), x: 'x', y: 'y' }, { container: { width: 600, height }, strip });
    r.frames();
    return { layout: r.layout!, mode: (r.prepared.at(-1) as unknown as { readoutMode?: string }).readoutMode, readout: r.prepared.at(-1)!.readout };
  };

  it('a 112 px plot and a real strip of 98 px: no strip and no tooltip ("none"), and the plot stays readable', () => {
    const h = containerFor(112);
    const got = run(h, 98);
    expect(got.layout.kind).toBe('plot');
    expect(got.mode).toBe('none');
    expect(got.readout).toBe(false);
  });

  it('boundary: exactly 80 px left beside the strip keeps the strip; 79.9 px does not', () => {
    const h = containerFor(112);
    const unstripped = plotHeightAt(h);
    const keep = run(h, unstripped - 80);
    expect(keep.mode).toBe('strip');
    expect(keep.layout.kind).toBe('plot');
    if (keep.layout.kind === 'plot') expect(keep.layout.plot.height).toBeCloseTo(80, 6);
    const drop = run(h, unstripped - 79.9);
    expect(drop.mode).toBe('none');
    expect(drop.layout.kind).toBe('plot');
  });

  it('an estimate that is too low (no measured height): the strip that made the plot too small is retried as "none"', () => {
    // 135 px unstripped: the estimate (two 24 px lines) would leave 87 px, the real strip of 98 px leaves 37.
    const h = containerFor(135);
    const r = record('line', { title: 'S', data: rowsOf([0, 1, 2, 3]), x: 'x', y: 'y' }, { container: { width: 600, height: h }, strip: 98, stripUnknown: true });
    r.frames();
    expect(r.layout!.kind).toBe('plot');
    expect((r.prepared.at(-1) as unknown as { readoutMode?: string }).readoutMode).toBe('none');
    // And it stays there on later frames.
    r.controller.invalidate.resize();
    r.frames();
    expect(r.layout!.kind).toBe('plot');
    expect((r.prepared.at(-1) as unknown as { readoutMode?: string }).readoutMode).toBe('none');
  });

  it('a chart too small even without a strip stays too small', () => {
    const got = run(150, 40);
    expect(got.layout.kind).toBe('too-small');
  });
});

describe('verification review, C3-5 (controller half): what the interaction layer is handed after a full replacement', () => {
  it('a replacement gives a new epoch, and prepare and commit of that frame agree on it, the view and the lookup', () => {
    const r = record('line', { title: 'E', data: rowsOf([0, 1, 2]), x: 'x', y: 'y' });
    r.frames();
    const before = r.committed!;
    r.controller.handle.update({ data: rowsOf([10, 11, 12, 13]) });
    r.frames();
    const after = r.committed!;
    expect(after.epoch).not.toBe(before.epoch);
    // The controls prepared for that frame and the committed state are the same revision.
    expect(r.prepared.at(-1)!.epoch).toBe(after.epoch);
    expect(r.prepared.at(-1)!.view).toBe(after.view);
    expect(xsOf(r)).toEqual([10, 11, 12, 13]);
    // The lookup is the new frame's: an old datum does not resolve, a new one reads its own value.
    expect(after.lookup.count).toBe(4);
    expect(after.lookup.datum(ref(1))).toBeNull();
    expect(after.lookup.datum(ref(11))?.value).toBe('110');
    // Enter (select) on the new datum reports the new row.
    let selected: unknown = null;
    r.controller.handle.on('select', p => { selected = p.row; });
    r.controller.actions.select(ref(11));
    r.frames(1);
    expect(selected).toEqual({ x: 11, y: 110 });
  });
});
