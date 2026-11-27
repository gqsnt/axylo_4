/**
 * N6 passive peer cursors on the real interaction layer (dom/interaction.ts) in Node: each chart is a real
 * controller (recording host) whose interaction layer is the real one on the minimal DOM of n3-dom.ts.
 *
 * - Pointer and keyboard hover on A draw B's own crosshair and readout (B's datum and y), mark B's figure, and
 *   leave focus, B's aria-valuetext and B's live region alone (spec A3, A7).
 * - Showing, re-showing across committed frames (update, zoom, append, resize) and clearing raise no hover of
 *   B's own (no echo).
 * - Escape, blur and pointer leave on A clear B; B's own pointer and keyboard take over from the peer cursor.
 */
import { describe, expect, it } from 'vitest';
import { createFigure } from '../../src/dom/figure';
import { createInteraction, type Actions, type InteractionParts } from '../../src/dom/interaction';
import { lineSwatch } from '../../src/dom/swatch';
import { alignedTargetMarks, pixelOf, scatterTargetMarks } from '../../src/core/focus';
import type { MarkRenderer, Overlay } from '../../src/core/contracts';
import type { Point } from '../../src/public';
import { createSyncGroup, type SyncableChart } from '../../src/sync';
import { SYNC, type SyncCapable, type SyncResolve } from '../../src/core/peer';
import { record, type Recording } from '../core/host';
import { TestDocument, TestEvent, type TestElement } from '../core/n3-dom';

type Row = Record<string, unknown>;
let ids = 0;

function live(doc: TestDocument, options: Record<string, unknown>, kind: 'line' | 'bar' | 'scatter' = 'line') {
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  const id = `n6c${++ids}`;
  const fig = createFigure(root as unknown as HTMLElement, id, {
    marks: doc.createElement('svg') as unknown as Element,
    text: doc.createElement('div') as unknown as Element,
  });
  const overlays: (Overlay | null)[] = [];
  const renderer: MarkRenderer = {
    kind: 'svg', element: doc.createElement('svg') as unknown as SVGSVGElement,
    draw() {}, drawOverlay(o) { overlays.push(o); }, destroy() {},
  };
  let r: Recording | null = null;
  const actionHovers: (Parameters<Actions['hover']>[0])[] = [];
  const actions: Actions = {
    zoom: w => r!.controller.actions.zoom(w), toggle: k => r!.controller.actions.toggle(k),
    pause: p => r!.controller.actions.pause(p), select: ref => r!.controller.actions.select(ref),
    hover: ref => { actionHovers.push(ref); r!.controller.actions.hover(ref); },
  };
  const parts: InteractionParts = { overlay: kind === 'scatter' ? scatterTargetMarks : alignedTargetMarks, swatch: lineSwatch, stepInSeries: null, sliceList: null };
  const interaction = createInteraction(parts, fig, renderer, actions);
  r = record(kind, options, { container: { width: 480, height: 300 } });
  // The recording host's interaction layer forwards to the real one, as the browser host does.
  const hi = r.host.interaction as { prepare: (s: never) => boolean; commit: (s: never) => void; clear: () => void; sync?: unknown };
  const { prepare, commit, clear } = { prepare: hi.prepare.bind(hi), commit: hi.commit.bind(hi), clear: hi.clear.bind(hi) };
  hi.prepare = s => { prepare(s); return interaction.prepare(s); };
  hi.commit = s => { commit(s); interaction.commit(s); };
  hi.clear = () => { clear(); interaction.clear(); };
  let current: { f: SyncResolve; o: object } | null = null;
  hi.sync = (f: SyncResolve | null, o: object) => {
    if (f) current = { f, o }; else if (current?.o === o) current = null;
    interaction.sync!(f, o);
  };
  r.frames();
  const rec = r;
  const handle = rec.controller.handle as unknown as SyncableChart<Row> & SyncCapable;
  const hovers: (Point<Row> | null)[] = [];
  handle.on('hover', p => { hovers.push(p); });
  const plot = fig.plot as unknown as TestElement;
  const stage = fig.stage as unknown as TestElement;
  const figure = fig.figure as unknown as TestElement;
  const tooltip = fig.tooltip as unknown as TestElement;
  // The minimal DOM gives every element a 480×300 box: a tooltip that size fits nowhere, so it gets a real one.
  tooltip.rect = { x: 0, y: 0, left: 0, top: 0, width: 140, height: 60, right: 140, bottom: 60 };
  tooltip.scrollWidth = 140; tooltip.scrollHeight = 60; tooltip.clientWidth = 140; tooltip.clientHeight = 60;
  const proxy = plot.children.find(c => c.id === `${id}-proxy`)!;
  const liveRegion = () => figure.querySelectorAll('[aria-live]').map(e => e.textContent).join('|');
  const anchorAt = (x: number) => {
    const d = handle[SYNC]!.drawn!;
    const ref = kind === 'scatter'
      ? (() => {
        const s = d.accepted.view.kind === 'scatter' ? d.accepted.view.frame.series[0]! : null;
        const i = s ? s.x.indexOf(x) : -1;
        return i >= 0 && s ? ({ kind: 'point', seriesKey: s.key, row: s.row?.[i] ?? i, x: s.x[i]! } as const) : null;
      })()
      : d.lookup.primary({ kind: 'x', x });
    const b = d.lookup.anchor(ref!)!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  let clock = 1000;
  const flush = () => { doc.defaultView.flushFrames(); rec.frames(); };
  return {
    r: rec, fig, handle, hovers, actionHovers, overlays, interaction, proxy, figure, tooltip, liveRegion,
    synced: () => figure.getAttribute('data-axylo-sync') !== null,
    current: () => {
      if (!current) return null;
      const d = handle[SYNC]!.drawn;
      const t = d ? current.f(d.accepted.view, d.lookup) : null;
      return t ? { t, o: current.o } : null;
    },
    point(x: number) {
      const p = anchorAt(x);
      stage.dispatchEvent(new TestEvent('pointermove', { pointerType: 'mouse', pointerId: 1, clientX: p.x, clientY: p.y, timeStamp: clock += 40 }));
      flush();
    },
    leave() { stage.dispatchEvent(new TestEvent('pointerleave', { pointerType: 'mouse', pointerId: 1, bubbles: false })); flush(); },
    focus() { proxy.focus(); proxy.dispatchEvent(new TestEvent('focus', { bubbles: false })); flush(); },
    blur() { doc.body.focus(); proxy.dispatchEvent(new TestEvent('blur', { bubbles: false })); flush(); },
    key(k: string) {
      const e = new TestEvent('keydown', { key: k, bubbles: true });
      // The window's capturing keydown listener (dom/interaction.ts #onEscape) runs first, as in a browser.
      for (const l of [...(doc.defaultView as unknown as { _listeners: { type: string; fn: (e: unknown) => void }[] })._listeners]) {
        if (l.type === 'keydown') l.fn(e);
      }
      if (!e.defaultPrevented) proxy.dispatchEvent(new TestEvent('keydown', { key: k }));
      flush();
    },
    end() { rec.controller.handle.destroy(); interaction.destroy(); fig.destroy(); },
  };
}

const rows = (field: string, xs: readonly number[], value: (x: number) => number) => xs.map(t => ({ t, [field]: value(t) }));

function pair() {
  const doc = new TestDocument();
  const html = doc.documentElement as unknown as TestElement;
  html.clientWidth = 1200; html.clientHeight = 900;
  const a = live(doc, { title: 'Requests', data: rows('requests', [0, 1, 2, 3, 4], x => 10 * x), x: 't', y: { field: 'requests', unit: 'req' } });
  const b = live(doc, { title: 'Latency', data: rows('latency', [0, 1, 2, 3, 4], x => 5000 + 111 * x), x: 't', y: { field: 'latency', unit: 'ms' } });
  const peerPoints: (Point<unknown> | null)[] = [];
  const group = createSyncGroup();
  group.attach(a.handle, { id: 'A' });
  group.attach(b.handle, { id: 'B', onHoverSync: p => { peerPoints.push(p); } });
  return { doc, a, b, group, peerPoints };
}

describe('N6 passive peer cursor on the real interaction layer', () => {
  it('pointer hover on A draws B\'s own crosshair and readout, marked as a peer\'s, with no hover, focus, value text or announcement on B', () => {
    const { doc, a, b, group, peerPoints } = pair();
    const valueText = b.proxy.getAttribute('aria-valuetext');
    const announced = b.liveRegion();
    const active = doc.activeElement;
    b.overlays.length = 0;
    a.point(3);
    expect(a.hovers.at(-1)).toMatchObject({ series: 'requests', y: 30 });
    expect(peerPoints.at(-1)).toMatchObject({ series: 'latency', x: 3, y: 5333 });
    expect(b.overlays.at(-1)).not.toBeNull();
    expect(b.synced()).toBe(true);
    expect(a.synced()).toBe(false);
    // What B's readout lists at that cursor is its own lookup's model: B's series and value, not A's. (The
    // minimal DOM cannot place a floating tooltip; the packed Chrome test checks the visible text.)
    const t = b.current()!.t;
    expect(t).toEqual({ kind: 'x', x: 3 });
    const model = b.handle[SYNC]!.drawn!.lookup.tooltip(t);
    expect(model.rows.map(row => row.ref)).toEqual([{ kind: 'aligned', seriesKey: 'latency', x: 3 }]);
    expect(JSON.stringify(model)).toMatch(/5,333/);
    expect(JSON.stringify(model)).not.toMatch(/requests/);
    expect(b.tooltip.getAttribute('aria-hidden')).toBe('true');
    expect(b.hovers).toEqual([]);
    expect(doc.activeElement).toBe(active);
    expect(b.proxy.getAttribute('aria-valuetext')).toBe(valueText);
    expect(b.liveRegion()).toBe(announced);
    a.leave();
    expect(peerPoints.at(-1)).toBeNull();
    expect(b.overlays.at(-1)).toBeNull();
    expect(b.synced()).toBe(false);
    expect(b.hovers).toEqual([]);
    group.destroy(); a.end(); b.end();
  });

  it('keyboard on A drives B without moving focus; blur on A clears B', () => {
    const { doc, a, b, group, peerPoints } = pair();
    a.focus();
    expect(doc.activeElement).toBe(a.proxy);
    a.key('ArrowRight');
    const last = peerPoints.at(-1);
    expect(last).not.toBeNull();
    expect(last).toMatchObject({ series: 'latency', x: a.hovers.at(-1)!.x, y: 5000 + 111 * (a.hovers.at(-1)!.x as number) });
    expect(b.synced()).toBe(true);
    expect(doc.activeElement).toBe(a.proxy);
    // Escape needs a placed tooltip to close, which this DOM cannot place: the packed Chrome test covers it.
    a.key('ArrowRight');
    expect(b.synced()).toBe(true);
    a.blur();
    expect(b.synced()).toBe(false);
    expect(b.overlays.at(-1)).toBeNull();
    expect(b.hovers).toEqual([]);
    group.destroy(); a.end(); b.end();
  });

  it('B\'s own pointer and keyboard take over from the peer cursor, and a peer cannot take them back', () => {
    const { doc, a, b, group } = pair();
    a.point(1);
    expect(b.synced()).toBe(true);
    b.point(4);
    expect(b.synced()).toBe(false);
    expect(b.hovers.at(-1)).toMatchObject({ series: 'latency', x: 4, y: 5444 });
    // A's pointer is still over A: its own hover wins over B's, which leads the group now.
    expect(a.synced()).toBe(false);
    a.leave();
    b.point(3);
    expect(a.synced()).toBe(true);
    // A's late leave was ignored (B leads); B's local hover stayed.
    expect(b.hovers.at(-1)).toMatchObject({ x: 3 });
    b.leave();
    expect(a.synced()).toBe(false);
    a.point(2);
    expect(b.synced()).toBe(true);
    b.focus();
    expect(b.synced()).toBe(false);
    expect(doc.activeElement).toBe(b.proxy);
    const hoversWhileFocused = b.hovers.length;
    a.point(0);
    expect(b.synced()).toBe(false);
    expect(b.hovers.length).toBe(hoversWhileFocused);
    group.destroy(); a.end(); b.end();
  });

  it('no echo across committed frames: update, zoom, append and resize keep the cursor and raise no hover on B', () => {
    const { a, b, group } = pair();
    a.point(2);
    expect(b.synced()).toBe(true);
    b.r.controller.handle.update({ title: 'Latency (p95)' });
    b.r.frames();
    expect(b.synced()).toBe(true);
    b.handle.zoom([1, 4]);
    b.r.frames();
    a.point(2);
    expect(b.synced()).toBe(true);
    (b.r.controller.handle as unknown as { append(rows: unknown): void }).append(rows('latency', [5, 6], x => 5000 + 111 * x));
    b.r.frames();
    b.r.container = { width: 400, height: 280 };
    b.r.controller.invalidate.resize();
    b.r.frames();
    expect(b.synced()).toBe(true);
    expect(b.hovers).toEqual([]);
    a.leave();
    expect(b.synced()).toBe(false);
    expect(b.hovers).toEqual([]);
    group.destroy(); a.end(); b.end();
  });

  it('detaching B from the group, destroying the group, or destroying B clears B\'s cursor quietly', () => {
    const { a, b, group } = pair();
    a.point(1);
    expect(b.synced()).toBe(true);
    group.detach(b.handle);
    expect(b.synced()).toBe(false);
    group.attach(b.handle, { id: 'B' });
    a.point(2);
    expect(b.synced()).toBe(true);
    group.destroy();
    expect(b.synced()).toBe(false);
    expect(b.hovers).toEqual([]);
    a.end(); b.end();
  });

  it('re-resolves logical x across streaming category remap, data replacement, and clipped zoom/reset with zero echo', () => {
    const doc = new TestDocument();
    const html = doc.documentElement as unknown as TestElement;
    html.clientWidth = 1200; html.clientHeight = 900;
    const barA = live(doc, {
      title: 'A', data: [{ q: 'Q1', v: 1 }, { q: 'Q2', v: 2 }, { q: 'Q3', v: 3 }, { q: 'Q4', v: 4 }],
      x: 'q', y: 'v',
    }, 'bar');
    const barB = live(doc, {
      title: 'B', data: [{ q: 'Q1', w: 10 }, { q: 'Q2', w: 20 }, { q: 'Q3', w: 30 }, { q: 'Q4', w: 40 }],
      x: 'q', y: 'w',
    }, 'bar');
    const gBar = createSyncGroup();
    gBar.attach(barA.handle, { id: 'A' });
    gBar.attach(barB.handle, { id: 'B' });
    barA.point(2); // Q3 at slot 2
    expect(barB.synced()).toBe(true);
    expect(barB.current()?.t).toEqual({ kind: 'x', x: 2 });
    // Stream Q5 with keep: 4 -> categories shift to [Q2, Q3, Q4, Q5], so Q3 moves from slot 2 to slot 1.
    (barB.r.controller.handle as unknown as { append(rows: unknown, opts?: { keep?: number }): void }).append([{ q: 'Q5', w: 50 }], { keep: 4 });
    barB.r.frames();
    expect(barB.synced()).toBe(true);
    expect(barB.current()?.t).toEqual({ kind: 'x', x: 1 });
    const remapped = barB.handle[SYNC]!.drawn!.lookup.tooltip(barB.current()!.t);
    expect(remapped.title).toBe('Q3');
    expect(remapped.rows[0]?.value).toContain('30');
    expect(barB.hovers).toEqual([]);
    // Data replacement (new epoch): Q3 moves to slot 0 with value 300.
    barB.r.controller.handle.update({ data: [{ q: 'Q3', w: 300 }, { q: 'Q6', w: 600 }] });
    barB.r.frames();
    expect(barB.synced()).toBe(true);
    expect(barB.current()?.t).toEqual({ kind: 'x', x: 0 });
    expect(barB.handle[SYNC]!.drawn!.lookup.tooltip(barB.current()!.t).rows[0]?.value).toContain('300');
    expect(barB.hovers).toEqual([]);
    gBar.destroy(); barA.end(); barB.end();

    // Clipped zoom clears marker & overlay; reset restores cursor, with zero echo.
    const { a, b, group } = pair();
    group.destroy();
    const gNoZoom = createSyncGroup({ zoom: false });
    gNoZoom.attach(a.handle, { id: 'A' });
    gNoZoom.attach(b.handle, { id: 'B' });
    a.point(1);
    expect(b.synced()).toBe(true);
    expect(b.overlays.at(-1)).not.toBeNull();
    b.handle.zoom([2, 4]);
    b.r.frames();
    expect(b.synced()).toBe(false);
    expect(b.overlays.at(-1)).toBeNull();
    expect(b.hovers).toEqual([]);
    b.handle.zoom(null);
    b.r.frames();
    expect(b.synced()).toBe(true);
    expect(b.overlays.at(-1)).not.toBeNull();
    expect(b.hovers).toEqual([]);
    gNoZoom.destroy(); a.end(); b.end();
  });

  it('moving B\'s pointer onto the exact datum already shown remotely emits local hover and clears sync marker', () => {
    const { a, b, group } = pair();
    a.point(2);
    expect(b.synced()).toBe(true);
    expect(b.hovers).toEqual([]);
    // Pointer moves onto B at the exact same x (2) B is already showing remotely.
    b.point(2);
    expect(b.synced()).toBe(false);
    expect(b.hovers).toHaveLength(1);
    expect(b.hovers[0]).toMatchObject({ series: 'latency', x: 2, y: 5222 });
    group.destroy(); a.end(); b.end();
  });

  it('Escape while a control inside peer B has focus does not consume Escape or dismiss B\'s remote target', () => {
    const { doc, a, b, group } = pair();
    // Touch B once and leave so B's window Escape listener (#docListeners) is installed while B is back in S_NONE.
    b.point(0);
    b.leave();
    b.hovers.length = 0;
    a.point(2);
    expect(b.synced()).toBe(true);
    // Focus a control inside B's figure (not B's proxy) and ensure B has its window Escape listener installed.
    const btn = doc.createElement('button');
    b.figure.appendChild(btn);
    btn.focus();
    const esc = new TestEvent('keydown', { key: 'Escape', bubbles: true });
    for (const l of [...(doc.defaultView as unknown as { _listeners: { type: string; fn: (e: unknown) => void }[] })._listeners]) {
      if (l.type === 'keydown') l.fn(esc);
    }
    expect(esc.defaultPrevented).toBe(false);
    expect(b.synced()).toBe(true);
    // Moving B's pointer onto x = 2 afterwards must still emit local hover (not dismissed).
    b.point(2);
    expect(b.synced()).toBe(false);
    expect(b.hovers.at(-1)).toMatchObject({ series: 'latency', x: 2, y: 5222 });
    group.destroy(); a.end(); b.end();
  });

  it('owned null clear releases B\'s resolver even when B switched X kind before A left (old cursor never reappears)', () => {
    const { a, b, group } = pair();
    a.point(2);
    expect(b.synced()).toBe(true);
    // Update B to categorical data while A is still hovering numeric x = 2.
    b.r.controller.handle.update({ data: [{ c: 'Jan', latency: 10 }, { c: 'Feb', latency: 20 }], x: 'c', y: 'latency' });
    b.r.frames();
    expect(b.synced()).toBe(false);
    // Pointer leaves A while B is categorical.
    a.leave();
    // Restore B's numeric data: A's old cursor must NOT reappear!
    b.r.controller.handle.update({ data: rows('latency', [0, 1, 2, 3, 4], x => 5000 + 111 * x), x: 't', y: 'latency' });
    b.r.frames();
    expect(b.synced()).toBe(false);
    expect(b.overlays.at(-1)).toBeNull();
    expect(b.hovers).toEqual([]);
    group.destroy(); a.end(); b.end();
  });

  it('retains a compatible X arriving while B is zoomed past it and resolves on zoom reset with 0 echo', () => {
    const { a, b, group, peerPoints } = pair();
    group.destroy();
    const gNoZoom = createSyncGroup({ zoom: false });
    gNoZoom.attach(a.handle, { id: 'A' });
    gNoZoom.attach(b.handle, { id: 'B', onHoverSync: p => { peerPoints.push(p); } });

    // Zoom B away from existing datum x = 1 before A hovers 1.
    b.handle.zoom([3, 4]);
    b.r.frames();
    a.point(1);
    expect(b.synced()).toBe(false);
    expect(b.overlays.at(-1) ?? null).toBeNull();
    expect(peerPoints.at(-1)).toBeNull();
    expect(b.hovers).toEqual([]);

    // Reset B's zoom while A is still hovering 1 -> B resolves x = 1 with 0 echo.
    b.handle.zoom(null);
    b.r.frames();
    expect(b.synced()).toBe(true);
    expect(b.current()?.t).toEqual({ kind: 'x', x: 1 });
    expect(b.overlays.at(-1)).not.toBeNull();
    expect(b.hovers).toEqual([]);

    // Repeated commits keep the cursor with 0 echo.
    b.r.controller.handle.update({ title: 'Latency (updated)' });
    b.r.frames();
    b.r.container = { width: 420, height: 260 };
    b.r.controller.invalidate.resize();
    b.r.frames();
    expect(b.synced()).toBe(true);
    expect(b.current()?.t).toEqual({ kind: 'x', x: 1 });
    expect(b.hovers).toEqual([]);

    // Leaving A clears B cleanly.
    a.leave();
    expect(b.synced()).toBe(false);
    expect(b.overlays.at(-1)).toBeNull();
    expect(b.hovers).toEqual([]);
    gNoZoom.destroy(); a.end(); b.end();
  });

  it('under ignore policy, distinguishes viewport clipping of an existing datum from a genuinely unmatched X', () => {
    const doc = new TestDocument();
    const html = doc.documentElement as unknown as TestElement;
    html.clientWidth = 1200; html.clientHeight = 900;
    const a = live(doc, { title: 'A', data: rows('a', [0, 1, 2, 3, 4, 5, 6], x => x), x: 't', y: 'a' });
    const b = live(doc, { title: 'B', data: rows('b', [0, 2, 4, 6], x => 100 + x), x: 't', y: 'b' });
    const g = createSyncGroup({ unmatchedHover: 'ignore', zoom: false });
    g.attach(a.handle, { id: 'A' });
    g.attach(b.handle, { id: 'B' });

    b.handle.zoom([4, 6]);
    b.r.frames();
    a.point(4);
    expect(b.synced()).toBe(true);
    expect(b.current()?.t).toEqual({ kind: 'x', x: 4 });

    // x = 1 does NOT exist in B's data [0, 2, 4, 6] -> genuine unmatched X, so 'ignore' keeps x = 4!
    a.point(1);
    expect(b.synced()).toBe(true);
    expect(b.current()?.t).toEqual({ kind: 'x', x: 4 });
    b.handle.zoom(null);
    b.r.frames();
    expect(b.synced()).toBe(true);
    expect(b.current()?.t).toEqual({ kind: 'x', x: 4 });

    // Re-zoom B to [4, 6] and hover x = 2 (exists in B's data, clipped by zoom) -> retained and resolves on reset!
    b.handle.zoom([4, 6]);
    b.r.frames();
    a.point(2);
    expect(b.synced()).toBe(false);
    b.handle.zoom(null);
    b.r.frames();
    expect(b.synced()).toBe(true);
    expect(b.current()?.t).toEqual({ kind: 'x', x: 2 });
    expect(b.hovers).toEqual([]);
    g.destroy(); a.end(); b.end();
  });

  it('reentrant source teardown during peer rendering leaves no residual cursor on B or C', () => {
    const doc = new TestDocument();
    const html = doc.documentElement as unknown as TestElement;
    html.clientWidth = 1200; html.clientHeight = 900;
    const a = live(doc, { title: 'A', data: rows('a', [0, 1, 2], x => x), x: 't', y: 'a' });
    let destroySource = false;
    const b = live(doc, {
      title: 'B', data: rows('b', [0, 1, 2], x => 10 + x), x: 't',
      y: { field: 'b', format: (v: number) => { if (destroySource) { destroySource = false; a.handle.destroy!(); } return String(v); } },
    });
    const c = live(doc, { title: 'C', data: rows('c', [0, 1, 2], x => 20 + x), x: 't', y: 'c' });
    const g = createSyncGroup();
    g.attach(a.handle, { id: 'A' });
    g.attach(b.handle, { id: 'B' });
    g.attach(c.handle, { id: 'C' });

    destroySource = true;
    a.point(1);
    expect(destroySource).toBe(false);
    expect(b.synced()).toBe(false);
    expect(b.overlays.at(-1) ?? null).toBeNull();
    expect(c.synced()).toBe(false);
    expect(c.overlays.at(-1) ?? null).toBeNull();
    // Subsequent commits on B must not resurrect a cursor (no unowned installed resolver).
    b.r.controller.handle.update({ title: 'B2' });
    b.r.frames();
    expect(b.synced()).toBe(false);
    expect(b.hovers).toEqual([]);
    g.destroy(); a.end(); b.end(); c.end();

    // Detaching B itself from B's formatter leaves no unowned installed resolver on B while C still receives A's cursor.
    const a2 = live(doc, { title: 'A2', data: rows('a', [0, 1, 2], x => x), x: 't', y: 'a' });
    let detachSelf = false;
    let g2: ReturnType<typeof createSyncGroup>;
    const b2 = live(doc, {
      title: 'B2', data: rows('b', [0, 1, 2], x => 10 + x), x: 't',
      y: { field: 'b', format: (v: number) => { if (detachSelf) { detachSelf = false; g2.detach(b2.handle); } return String(v); } },
    });
    const c2 = live(doc, { title: 'C2', data: rows('c', [0, 1, 2], x => 20 + x), x: 't', y: 'c' });
    g2 = createSyncGroup();
    g2.attach(a2.handle, { id: 'A' });
    g2.attach(b2.handle, { id: 'B' });
    g2.attach(c2.handle, { id: 'C' });

    detachSelf = true;
    a2.point(1);
    expect(detachSelf).toBe(false);
    expect(b2.synced()).toBe(false);
    expect(b2.overlays.at(-1) ?? null).toBeNull();
    expect(c2.synced()).toBe(true);
    expect(c2.current()?.t).toEqual({ kind: 'x', x: 1 });
    b2.r.controller.handle.update({ title: 'B2-commit' });
    b2.r.frames();
    expect(b2.synced()).toBe(false);
    g2.destroy(); a2.end(); b2.end(); c2.end();
  });

  it('retained resolver suppresses numeric x=2 on a later categorical frame with label "2", even with declared xKind, then restores or clears cleanly', () => {
    const doc = new TestDocument();
    const html = doc.documentElement as unknown as TestElement;
    html.clientWidth = 1200; html.clientHeight = 900;
    const a = live(doc, { title: 'A', data: rows('a', [0, 1, 2, 3], x => x * 10), x: 't', y: 'a' });
    const b = live(doc, { title: 'B', data: rows('b', [0, 1, 2, 3], x => 100 + x), x: 't', y: 'b' });
    const g = createSyncGroup();
    g.attach(a.handle, { id: 'A' });
    // Even when B declares xKind: 'number', the resolver derives compatibility from B's authoritative frame.
    g.attach(b.handle, { id: 'B', xKind: 'number' });

    a.point(2);
    expect(b.synced()).toBe(true);
    expect(b.current()?.t).toEqual({ kind: 'x', x: 2 });
    expect(b.overlays.at(-1)).not.toBeNull();

    // B switches to a categorical axis containing the string label "2".
    b.r.controller.handle.update({
      data: [{ c: '1', b: 10 }, { c: '2', b: 20 }, { c: '3', b: 30 }],
      x: 'c', y: 'b',
    });
    b.r.frames();
    expect(b.synced()).toBe(false);
    expect(b.current()).toBeNull();
    expect(b.overlays.at(-1)).toBeNull();
    expect(b.hovers).toEqual([]);

    // Switching B back to numeric while A still hovers 2 restores B's numeric cursor with 0 echo.
    b.r.controller.handle.update({ data: rows('b', [0, 1, 2, 3], x => 200 + x), x: 't', y: 'b' });
    b.r.frames();
    expect(b.synced()).toBe(true);
    expect(b.current()?.t).toEqual({ kind: 'x', x: 2 });
    expect(b.overlays.at(-1)).not.toBeNull();
    expect(b.hovers).toEqual([]);

    // Switch back to categorical "2" again, then A leaves -> ownership is released so returning to numeric does NOT resurrect.
    b.r.controller.handle.update({ data: [{ c: '2', b: 20 }], x: 'c', y: 'b' });
    b.r.frames();
    expect(b.synced()).toBe(false);
    a.leave();
    b.r.controller.handle.update({ data: rows('b', [0, 1, 2, 3], x => 300 + x), x: 't', y: 'b' });
    b.r.frames();
    expect(b.synced()).toBe(false);
    expect(b.overlays.at(-1)).toBeNull();
    expect(b.hovers).toEqual([]);

    // Legitimate explicit resolveX mapping numeric -> category works while peer stays categorical.
    const cat = live(doc, { data: [{ m: 'Jan', v: 10 }, { m: 'Feb', v: 20 }, { m: 'Mar', v: 30 }], x: 'm', y: 'v' }, 'bar');
    const gMap = createSyncGroup();
    gMap.attach(a.handle, { id: 'A' });
    gMap.attach(cat.handle, { id: 'Cat', xKind: 'number', resolveX: x => ['Jan', 'Feb', 'Mar'][Number(x)] ?? null });
    a.point(1);
    expect(cat.synced()).toBe(true);
    expect(cat.current()?.t).toEqual({ kind: 'x', x: 1 });
    cat.r.controller.handle.update({ data: [{ t: 0, v: 1 }, { t: 1, v: 2 }], x: 't', y: 'v' });
    cat.r.frames();
    expect(cat.synced()).toBe(false);
    expect(cat.overlays.at(-1)).toBeNull();
    gMap.destroy(); g.destroy(); a.end(); b.end(); cat.end();
  });

  it('fresh hover rechecks committed X-kind authority against stale declared xKind, preserves mismatch reporting and explicit resolveX', () => {
    const doc = new TestDocument();
    const html = doc.documentElement as unknown as TestElement;
    html.clientWidth = 1200; html.clientHeight = 900;
    const a = live(doc, { title: 'A', data: rows('a', [0, 1, 2, 3], x => x * 10), x: 't', y: 'a' });
    const b = live(doc, { title: 'B', data: rows('b', [0, 1, 2, 3], x => 100 + x), x: 't', y: 'b' });
    const mismatches: string[] = [];
    const g = createSyncGroup({ onMismatch: m => { mismatches.push(`${m.sourceId}->${m.targetId}:${m.reason}:${m.sourceXKind}:${m.targetXKind}`); } });
    g.attach(a.handle, { id: 'A', xKind: 'number' });
    g.attach(b.handle, { id: 'B', xKind: 'number' });

    a.point(2);
    expect(b.synced()).toBe(true);
    expect(b.current()?.t).toEqual({ kind: 'x', x: 2 });

    // B switches to categories containing "3"; retained cursor clears silently on commit (no mismatch event).
    b.r.controller.handle.update({
      data: [{ c: '1', b: 10 }, { c: '2', b: 20 }, { c: '3', b: 30 }],
      x: 'c', y: 'b',
    });
    b.r.frames();
    expect(b.synced()).toBe(false);
    expect(b.current()).toBeNull();
    expect(mismatches).toEqual([]);

    // Fresh numeric hover at 3 must NOT coerce into category "3", and must report x-kind-mismatch.
    a.point(3);
    expect(b.synced()).toBe(false);
    expect(b.current()).toBeNull();
    expect(b.overlays.at(-1)).toBeNull();
    expect(b.hovers).toEqual([]);
    expect(mismatches).toEqual(['A->B:x-kind-mismatch:number:category']);

    // Explicit resolveX opt-in cross-kind mapping (without declaring xKind) still routes cleanly.
    const cat = live(doc, { data: [{ m: 'Jan', v: 10 }, { m: 'Feb', v: 20 }, { m: 'Mar', v: 30 }], x: 'm', y: 'v' }, 'bar');
    const optMismatches: string[] = [];
    const gOpt = createSyncGroup({ onMismatch: m => { optMismatches.push(m.reason); } });
    gOpt.attach(a.handle, { id: 'A' });
    gOpt.attach(cat.handle, { id: 'Cat', resolveX: x => ['Jan', 'Feb', 'Mar'][Number(x)] ?? null });
    a.point(2);
    expect(cat.synced()).toBe(true);
    expect(cat.current()?.t).toEqual({ kind: 'x', x: 2 });
    expect(optMismatches).toEqual([]);

    gOpt.destroy(); g.destroy(); a.end(); b.end(); cat.end();
  });

  it('scatter peer filters Y-clipped points before nearest X selection and tooltip count (including beyond row 8)', () => {
    const doc = new TestDocument();
    const html = doc.documentElement as unknown as TestElement;
    html.clientWidth = 1200; html.clientHeight = 900;
    const a = live(doc, { title: 'A', data: rows('a', [0, 1, 2, 3, 4], x => x * 10), x: 't', y: 'a' });

    // Review case 1: fixed Y domain [0, 10], (2, 90) is Y-clipped, (3, 3) is visible -> nearest(2) chooses (3, 3).
    const s1 = live(doc, {
      title: 'S1',
      data: [{ t: 2, y: 90 }, { t: 3, y: 3 }],
      x: { field: 't', domain: [0, 4] },
      y: { field: 'y', domain: [0, 10] },
    }, 'scatter');
    const got1: (Point<unknown> | null)[] = [];
    const g1 = createSyncGroup({ unmatchedHover: 'nearest' });
    g1.attach(a.handle, { id: 'A' });
    g1.attach(s1.handle, { id: 'S1', onHoverSync: p => { got1.push(p); } });

    a.point(2);
    expect(s1.synced()).toBe(true);
    expect(got1.at(-1)).toMatchObject({ series: 'y', x: 3, y: 3 });
    expect(s1.current()?.t).toMatchObject({ kind: 'point', count: 1 });
    expect(s1.hovers).toEqual([]);
    const ov1 = s1.overlays.at(-1)!;
    const rule1 = ov1.clipped.find(m => m.type === 'rule' && m.role === 'cursor');
    expect(rule1).toMatchObject({ x1: pixelOf(s1.handle[SYNC]!.drawn!.layout, 3) });

    // Review case 2: 8 visible matches + 4 Y-clipped points at x = 2 -> count is 8 (not 12).
    const s2Data = [
      ...Array.from({ length: 8 }, (_, i) => ({ t: 2, y: i + 1 })),
      { t: 2, y: 20 }, { t: 2, y: 30 }, { t: 2, y: 40 }, { t: 2, y: 50 },
    ];
    const s2 = live(doc, {
      title: 'S2',
      data: s2Data,
      x: { field: 't', domain: [0, 4] },
      y: { field: 'y', domain: [0, 10] },
    }, 'scatter');
    const g2 = createSyncGroup({ unmatchedHover: 'nearest' });
    g2.attach(a.handle, { id: 'A' });
    g2.attach(s2.handle, { id: 'S2' });

    a.leave();
    a.point(2);
    expect(s2.synced()).toBe(true);
    const target2 = s2.current()!.t;
    expect(target2.kind).toBe('point');
    if (target2.kind === 'point') {
      expect(target2.refs).toHaveLength(8);
      expect(target2.count).toBe(8);
    }
    const tip2 = s2.handle[SYNC]!.drawn!.lookup.tooltip(target2);
    expect(tip2.count).toBe(8);
    expect(tip2.rows).toHaveLength(8);
    expect(s2.hovers).toEqual([]);

    g1.destroy(); g2.destroy(); a.end(); s1.end(); s2.end();
  });

  it('real scatter peer draws passive X cursor rule + scatter highlight + peer-local tooltip with 0 echo, without altering local marks', () => {
    const doc = new TestDocument();
    const html = doc.documentElement as unknown as TestElement;
    html.clientWidth = 1200; html.clientHeight = 900;
    const a = live(doc, { title: 'Requests', data: rows('requests', [0, 1, 2, 3, 4], x => 10 * x), x: 't', y: 'requests' });
    const s = live(doc, { title: 'Latency', data: rows('latency', [0, 1, 2, 3, 4], x => 2000 + 100 * x), x: 't', y: 'latency' }, 'scatter');
    const peerPoints: (Point<unknown> | null)[] = [];
    const g = createSyncGroup();
    g.attach(a.handle, { id: 'A' });
    g.attach(s.handle, { id: 'S', onHoverSync: p => { peerPoints.push(p); } });

    const valueText = s.proxy.getAttribute('aria-valuetext');
    const active = doc.activeElement;
    s.overlays.length = 0;

    a.point(2);
    expect(peerPoints.at(-1)).toMatchObject({ series: 'latency', x: 2, y: 2200, index: 2 });
    expect(s.synced()).toBe(true);
    expect(s.hovers).toEqual([]);
    expect(doc.activeElement).toBe(active);
    expect(s.proxy.getAttribute('aria-valuetext')).toBe(valueText);

    const ov = s.overlays.at(-1)!;
    expect(ov).not.toBeNull();
    const ruleMark = ov.clipped.find(m => m.type === 'rule' && m.role === 'cursor');
    const pointMarks = ov.clipped.filter(m => m.type === 'points');
    const expectedX = pixelOf(s.handle[SYNC]!.drawn!.layout, 2);
    expect(ruleMark).toMatchObject({ type: 'rule', x1: expectedX, x2: expectedX, role: 'cursor' });
    expect(pointMarks.length).toBeGreaterThanOrEqual(2);

    const model = s.handle[SYNC]!.drawn!.lookup.tooltip(s.current()!.t);
    expect(JSON.stringify(model)).toMatch(/2,200/);
    expect(JSON.stringify(model)).not.toMatch(/requests/);

    // Local hover on scatter S takes over cleanly and draws ONLY scatter marks (no passive remote rule).
    s.point(3);
    expect(s.synced()).toBe(false);
    expect(s.hovers.at(-1)).toMatchObject({ series: 'latency', x: 3, y: 2300 });
    const localOv = s.overlays.at(-1)!;
    expect(localOv.clipped.some(m => m.type === 'rule' && m.role === 'cursor')).toBe(false);
    expect(localOv.clipped.some(m => m.type === 'points')).toBe(true);

    // Leave S, re-hover A, then leave A -> scatter overlay clears cleanly.
    s.leave();
    a.point(1);
    expect(s.synced()).toBe(true);
    a.leave();
    expect(s.synced()).toBe(false);
    expect(s.overlays.at(-1)).toBeNull();
    g.destroy(); a.end(); s.end();
  });

  it('resizing a synced peer to too-small and back restores the passive cursor with zero hover/echo, focus, or aria changes', () => {
    const { doc, a, b, group } = pair();
    const valueText = b.proxy.getAttribute('aria-valuetext');
    const announced = b.liveRegion();
    const active = doc.activeElement;

    a.point(2);
    expect(b.synced()).toBe(true);
    expect(b.overlays.at(-1)).not.toBeNull();
    expect(b.hovers).toEqual([]);
    expect(b.actionHovers).toEqual([]);

    // Resize B to 100×65 (too-small layout -> !plotReady(d)).
    b.r.container = { width: 100, height: 65 };
    b.r.controller.invalidate.resize();
    b.r.frames();
    expect(b.handle[SYNC]!.drawn!.layout.kind).toBe('too-small');
    expect(b.synced()).toBe(false);
    expect(b.overlays.at(-1)).toBeNull();
    expect(b.hovers).toEqual([]);
    expect(b.actionHovers).toEqual([]);
    expect(doc.activeElement).toBe(active);
    // A too-small frame updates the idle proxy to its empty/no-data text (never to the remote cursor's value).
    expect(b.proxy.getAttribute('aria-valuetext')).not.toMatch(/5,222/);
    expect(b.liveRegion()).toBe(announced);

    // Restore B to full size -> passive cursor re-resolves cleanly with zero hover/echo or a11y mutation.
    b.r.container = { width: 480, height: 300 };
    b.r.controller.invalidate.resize();
    b.r.frames();
    expect(b.handle[SYNC]!.drawn!.layout.kind).toBe('plot');
    expect(b.synced()).toBe(true);
    expect(b.current()?.t).toEqual({ kind: 'x', x: 2 });
    expect(b.overlays.at(-1)).not.toBeNull();
    expect(b.hovers).toEqual([]);
    expect(b.actionHovers).toEqual([]);
    expect(doc.activeElement).toBe(active);
    expect(b.proxy.getAttribute('aria-valuetext')).toBe(valueText);
    expect(b.liveRegion()).toBe(announced);

    // Clearing interaction while S_SYNC is active also never invokes actions.hover.
    b.interaction.clear();
    expect(b.synced()).toBe(false);
    expect(b.actionHovers).toEqual([]);
    expect(b.hovers).toEqual([]);

    group.destroy(); a.end(); b.end();
  });
});
