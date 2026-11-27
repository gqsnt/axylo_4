/**
 * N6 `axylo/sync` with real chart controllers (recording host, no DOM): a peer resolves a synced x against its
 * own committed frame and lookup, so what it shows and reports is its own datum (series, x, y, row), never the
 * source's; unmatched x follows 'clear' | 'ignore' | 'nearest'; instants match across zones; overlapping
 * groups, stale clears, stale handles and teardown leave the newer cursor alone.
 *
 * Expected values come from the fixture rows (spec 3.6: line tooltips read every visible series at that x).
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { record, type Recording } from '../core/host';
import { createSyncGroup, syncCharts, type SyncableChart, type SyncGroupOptions, type SyncMemberOptions } from '../../src/sync';
import { SYNC, forwardSync, type SyncCapable, type SyncResolve } from '../../src/core/peer';
import type { PickTarget } from '../../src/core/contracts';
import type { Point, XValue } from '../../src/public';

type Row = Record<string, unknown>;
type Shown = { t: PickTarget | null; o: object };

interface Peer {
  readonly r: Recording;
  readonly handle: SyncableChart<Row> & SyncCapable;
  /** Every call the group made on the chart's interaction layer. */
  readonly shown: Shown[];
  /** The chart's own hover events (anything here caused by a peer would be an echo). */
  readonly hovers: (Point<Row> | null)[];
  /** The cursor the chart would show now: the last show not cleared by the same origin. */
  current(): Shown | null;
  /** The origin token currently owning the retained resolver (even when suppressed or clipped). */
  origin(): object | null;
  /** Points the chart's own lookup at x (a position) and raises hover as the interaction layer does. */
  hoverAt(position: number | null): void;
}

function peer(kind: 'line' | 'bar' | 'scatter', options: Record<string, unknown>, settings: Parameters<typeof record>[2] = {}): Peer {
  const r = record(kind, options, settings);
  r.frames();
  const shown: Shown[] = [];
  let active: { f: SyncResolve; o: object } | null = null;
  const handle = r.controller.handle as unknown as SyncableChart<Row> & SyncCapable;
  // The recording host's interaction layer gains what the DOM layer has (dom/interaction.ts sync()).
  (r.host.interaction as { sync?: (f: SyncResolve | null, o: object) => void }).sync = (f, o) => {
    const d = handle[SYNC]!.drawn;
    const t = f && d ? f(d.accepted.view, d.lookup, d.layout) : null;
    shown.push({ t, o });
    if (f) active = { f, o };
    else if (active?.o === o) active = null;
  };
  const hovers: (Point<Row> | null)[] = [];
  handle.on('hover', p => { hovers.push(p); });
  return {
    r, handle, shown, hovers,
    current: () => {
      if (!active) return null;
      const d = handle[SYNC]!.drawn;
      const t = d ? active.f(d.accepted.view, d.lookup, d.layout) : null;
      return t ? { t, o: active.o } : null;
    },
    origin: () => active?.o ?? null,
    hoverAt(position) {
      const d = handle[SYNC]!.drawn!;
      r.controller.actions.hover(position === null ? null : d.lookup.primary({ kind: 'x', x: position }));
    },
  };
}

const rowsOf = (xs: readonly number[], field: string, value: (x: number, i: number) => number) =>
  xs.map((x, i) => ({ t: x, [field]: value(x, i) }));

describe('N6 peer-local resolution through the chart seam', () => {
  it('the seam is a non-enumerable registry-symbol property holding the drawn state, and it is null-drawn once destroyed', () => {
    const a = peer('line', { data: rowsOf([1, 2, 3], 'a', x => x), x: 't', y: 'a' });
    expect(Object.keys(a.handle)).not.toContain(String(SYNC));
    expect(Object.getOwnPropertySymbols(a.handle)).toContain(Symbol.for('axylo.sync'));
    expect(Object.getOwnPropertyDescriptor(a.handle, SYNC)?.enumerable).toBe(false);
    expect({ ...a.handle }[SYNC as never]).toBeUndefined();
    expect(a.handle[SYNC]!.drawn!.accepted.frame.shape).toBe('aligned');
    // Encapsulated capability: exposes only drawn + sync, never the mutable controller or host.
    expect('host' in a.handle[SYNC]!).toBe(false);
    expect('destroy' in a.handle[SYNC]!).toBe(false);
    a.handle.destroy!();
    expect(a.handle[SYNC]!.drawn).toBeNull();
  });

  it('a wrapper handle (axylo/cartesian, axylo/finance) forwards the same seam, not enumerable', () => {
    const a = peer('line', { data: rowsOf([1, 2, 3], 'a', x => x), x: 't', y: 'a' });
    const wrapper = { zoom: a.handle.zoom, on: a.handle.on };
    forwardSync(wrapper, a.handle);
    expect((wrapper as SyncCapable)[SYNC]).toBe(a.handle[SYNC]);
    expect(Object.keys(wrapper)).toEqual(['zoom', 'on']);
    expect(Object.getOwnPropertyDescriptor(wrapper, SYNC)).toMatchObject({ enumerable: false, writable: false });
    a.handle.destroy!();
  });

  it('a peer reports and shows its own series, x and y at the source x, never the source y or series', () => {
    const a = peer('line', { data: rowsOf([0, 1, 2, 3, 4, 5], 'temperature', x => x * 10), x: { field: 't', unit: 's' }, y: { field: 'temperature', unit: '°C' } });
    const b = peer('line', { data: rowsOf([0, 2, 4], 'pressure', x => 1000 + x), x: { field: 't', unit: 's' }, y: { field: 'pressure', unit: 'hPa' } });
    const got: (Point<unknown> | null)[] = [];
    const group = createSyncGroup();
    group.attach(a.handle, { id: 'A' });
    group.attach(b.handle, { id: 'B', onHoverSync: p => { got.push(p); } });

    a.hoverAt(4);
    expect(a.hovers.at(-1)).toMatchObject({ series: 'temperature', x: 4, y: 40 });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ series: 'pressure', x: 4, y: 1004, index: 2 });
    expect(got[0]!.row).toEqual({ t: 4, pressure: 1004 });
    expect(b.current()?.t).toEqual({ kind: 'x', x: 4 });
    // Showing the peer cursor raised no hover of B's own.
    expect(b.hovers).toEqual([]);

    a.hoverAt(null);
    expect(got.at(-1)).toBeNull();
    expect(b.current()).toBeNull();
    expect(b.hovers).toEqual([]);
    group.destroy();
  });

  it('unmatched x: clear clears, ignore keeps the last cursor, nearest takes the closest slot (ties to the earlier)', () => {
    for (const policy of ['clear', 'ignore', 'nearest'] as const) {
      const a = peer('line', { data: rowsOf([0, 1, 2, 3, 4], 'a', x => x), x: 't', y: 'a' });
      const b = peer('line', { data: rowsOf([0, 2, 4], 'b', x => 100 + x), x: 't', y: 'b' });
      const got: (Point<unknown> | null)[] = [];
      const group = createSyncGroup({ unmatchedHover: policy });
      group.attach(a.handle, { id: 'A' });
      group.attach(b.handle, { id: 'B', onHoverSync: p => { got.push(p); } });
      a.hoverAt(2);
      a.hoverAt(3);
      if (policy === 'clear') {
        expect(got.map(p => p?.y ?? null)).toEqual([102, null]);
        expect(b.current()).toBeNull();
      } else if (policy === 'ignore') {
        expect(got.map(p => p?.y ?? null)).toEqual([102]);
        expect(b.current()?.t).toEqual({ kind: 'x', x: 2 });
      } else {
        // 3 is as far from 2 as from 4: the earlier slot.
        expect(got.map(p => p?.y ?? null)).toEqual([102, 102]);
        expect(b.current()?.t).toEqual({ kind: 'x', x: 2 });
      }
      group.destroy();
    }
  });

  it('a hidden series is not read: the peer reports its visible series at that x, or nothing when all are hidden', () => {
    const a = peer('line', { data: rowsOf([0, 1, 2], 'a', x => x), x: 't', y: 'a' });
    const b = peer('line', { data: [0, 1, 2].map(t => ({ t, p: 10 + t, q: 20 + t })), x: 't', y: ['p', 'q'] });
    const got: (Point<unknown> | null)[] = [];
    const group = createSyncGroup();
    group.attach(a.handle, { id: 'A' });
    group.attach(b.handle, { id: 'B', onHoverSync: p => { got.push(p); } });
    // The legend toggle (spec I2) hides p.
    b.r.controller.actions.toggle('p');
    b.r.frames();
    a.hoverAt(1);
    expect(got.at(-1)).toMatchObject({ series: 'q', x: 1, y: 21 });
    b.r.controller.actions.toggle('q');
    b.r.frames();
    a.hoverAt(2);
    expect(got.at(-1)).toBeNull();
    group.destroy();
  });

  it('a position outside the peer\'s zoom window is not shown, even under nearest', () => {
    const a = peer('line', { data: rowsOf([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'a', x => x), x: 't', y: 'a' });
    const b = peer('line', { data: rowsOf([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'b', x => 50 + x), x: 't', y: 'b' });
    const got: (Point<unknown> | null)[] = [];
    const group = createSyncGroup({ unmatchedHover: 'nearest', zoom: false });
    group.attach(a.handle, { id: 'A' });
    group.attach(b.handle, { id: 'B', onHoverSync: p => { got.push(p); } });
    b.handle.zoom([5, 9]);
    b.r.frames();
    a.hoverAt(2);
    expect(got.at(-1)).toBeNull();
    a.hoverAt(6);
    expect(got.at(-1)).toMatchObject({ series: 'b', x: 6, y: 56 });
    group.destroy();
  });

  it('category peers match by name, not by position', () => {
    const a = peer('bar', { data: [{ m: 'Jan', v: 1 }, { m: 'Feb', v: 2 }, { m: 'Mar', v: 3 }], x: 'm', y: 'v' });
    const b = peer('bar', { data: [{ m: 'Mar', w: 30 }, { m: 'Jan', w: 10 }], x: 'm', y: 'w' });
    const got: (Point<unknown> | null)[] = [];
    const group = createSyncGroup();
    group.attach(a.handle, { id: 'A' });
    group.attach(b.handle, { id: 'B', onHoverSync: p => { got.push(p); } });
    a.hoverAt(2); // Mar in A is position 2; in B it is position 0.
    expect(got.at(-1)).toMatchObject({ series: 'w', x: 'Mar', y: 30 });
    a.hoverAt(1); // Feb: B has no Feb.
    expect(got.at(-1)).toBeNull();
    group.destroy();
  });

  it('instants match across time zones and ISO offsets; a date peer is a kind mismatch, reported', () => {
    const instants = ['2026-03-01T12:00:00Z', '2026-03-02T12:00:00Z', '2026-03-03T12:00:00Z'];
    const a = peer('line', { data: instants.map((t, i) => ({ t: new Date(t), a: i })), x: { field: 't', type: 'time', timeZone: 'America/New_York' }, y: 'a' }, { timeZone: 'America/New_York' });
    // The same instants written with a +02:00 offset, shown in Tokyo time.
    const b = peer('line', {
      data: ['2026-03-01T14:00:00+02:00', '2026-03-02T14:00:00+02:00', '2026-03-03T14:00:00+02:00'].map((t, i) => ({ t, b: 100 + i })),
      x: { field: 't', type: 'time', timeZone: 'Asia/Tokyo' }, y: 'b',
    }, { timeZone: 'Asia/Tokyo' });
    const c = peer('line', { data: [{ t: '2026-03-02', c: 7 }], x: { field: 't', type: 'date' }, y: 'c' });
    const got: (Point<unknown> | null)[] = [];
    const reasons: string[] = [];
    const group = createSyncGroup({ onMismatch: m => { reasons.push(`${m.targetId}:${m.reason}:${m.sourceXKind}:${m.targetXKind}`); } });
    group.attach(a.handle, { id: 'A' });
    group.attach(b.handle, { id: 'B', onHoverSync: p => { got.push(p); } });
    group.attach(c.handle, { id: 'C', onHoverSync: () => { throw new Error('a date chart must not follow an instant'); } });
    a.hoverAt(Date.parse(instants[1]!));
    expect(got).toHaveLength(1);
    expect((got[0]!.x as Date).getTime()).toBe(Date.parse(instants[1]!));
    expect(got[0]).toMatchObject({ series: 'b', y: 101 });
    expect(reasons).toEqual(['C:x-kind-mismatch:time:date']);
    group.destroy();
  });

  it('for any rows and any source x, the peer reports exactly its own row at that x (clear) or the nearest (nearest)', () => {
    const xs = fc.uniqueArray(fc.integer({ min: 0, max: 60 }), { minLength: 1, maxLength: 14 }).map(a => [...a].sort((p, q) => p - q));
    fc.assert(fc.property(xs, xs, fc.boolean(), fc.integer({ min: 0, max: 13 }), (ax, bx, nearest, pick) => {
      const a = peer('line', { data: rowsOf(ax, 'a', x => -x), x: 't', y: 'a' });
      const b = peer('line', { data: rowsOf(bx, 'b', (x, i) => 1000 + x * 3 + i), x: 't', y: 'b' });
      const got: (Point<unknown> | null)[] = [];
      const group = createSyncGroup({ unmatchedHover: nearest ? 'nearest' : 'clear' });
      group.attach(a.handle, { id: 'A' });
      group.attach(b.handle, { id: 'B', onHoverSync: p => { got.push(p); } });
      const x = ax[pick % ax.length]!;
      a.hoverAt(x);
      // B's slots: its rows' x, plus the gap slots a line chart keeps for missing regular steps (spec I1: such
      // a slot reads "No observation", so B's own datum there has no y).
      const slots = Array.from(b.handle[SYNC]!.drawn!.accepted.frame.shape === 'aligned' ? (b.handle[SYNC]!.drawn!.accepted.frame as { x: { values: Float64Array } }).x.values : []);
      let expected: number | null = slots.includes(x) ? x : null;
      if (expected === null && nearest && x >= slots[0]! && x <= slots.at(-1)!) {
        // Within B's domain only: the closest of B's slots, the earlier on a tie.
        expected = slots.reduce((best, v) => Math.abs(v - x) < Math.abs(best - x) ? v : best, slots[0]!);
      }
      expect(got).toHaveLength(1);
      if (expected === null) expect(got[0]).toBeNull();
      else {
        const i = bx.indexOf(expected);
        expect(got[0]).toMatchObject({ series: 'b', x: expected, y: i >= 0 ? 1000 + expected * 3 + i : null });
      }
      expect(b.hovers).toEqual([]);
      expect(a.hovers).toHaveLength(1);
      group.destroy();
    }), { numRuns: 60 });
  });
});

describe('N6 origins: overlapping groups, stale clears, stale handles, teardown', () => {
  const make = (field: string) => peer('line', { data: rowsOf([0, 1, 2, 3], field, x => x), x: 't', y: field });

  it('a late clear from A cannot remove the newer cursor C put on B through another group', () => {
    const a = make('a'), b = make('b'), c = make('c');
    const g1 = createSyncGroup(), g2 = createSyncGroup();
    g1.attach(a.handle, { id: 'A' }); g1.attach(b.handle, { id: 'B' });
    g2.attach(c.handle, { id: 'C' }); g2.attach(b.handle, { id: 'B' });
    a.hoverAt(1);
    const fromA = b.current()!;
    c.hoverAt(3);
    expect(b.current()!.t).toEqual({ kind: 'x', x: 3 });
    expect(b.current()!.o).not.toBe(fromA.o);
    a.hoverAt(null);
    expect(b.current()!.t).toEqual({ kind: 'x', x: 3 });
    c.hoverAt(null);
    expect(b.current()).toBeNull();
    expect(b.hovers).toEqual([]);
    g1.destroy(); g2.destroy();
  });

  it('within one group, a clear from a member that no longer leads is not passed on', () => {
    const a = make('a'), b = make('b'), c = make('c');
    const group = createSyncGroup();
    for (const [id, p] of [['A', a], ['B', b], ['C', c]] as const) group.attach(p.handle, { id });
    a.hoverAt(1);
    c.hoverAt(2);
    a.hoverAt(null); // A's late leave
    expect(b.current()!.t).toEqual({ kind: 'x', x: 2 });
    expect(a.current()!.t).toEqual({ kind: 'x', x: 2 });
    group.destroy();
  });

  it('for any interleaving of hovers and clears across two overlapping groups, B shows the newest origin\'s cursor or none', () => {
    const step = fc.record({ who: fc.constantFrom('A', 'C'), x: fc.option(fc.integer({ min: 0, max: 3 }), { nil: null }) });
    fc.assert(fc.property(fc.array(step, { maxLength: 25 }), steps => {
      const a = make('a'), b = make('b'), c = make('c');
      const g1 = createSyncGroup(), g2 = createSyncGroup();
      g1.attach(a.handle, { id: 'A' }); g1.attach(b.handle, { id: 'B' });
      g2.attach(c.handle, { id: 'C' }); g2.attach(b.handle, { id: 'B' });
      // Model: each source's own hover, and which source showed last.
      const at: Record<'A' | 'C', number | null> = { A: null, C: null };
      let lead: 'A' | 'C' | null = null;
      for (const s of steps) {
        if (s.x === null && at[s.who] === null) continue; // nothing to leave: the chart raises no event
        (s.who === 'A' ? a : c).hoverAt(s.x);
        at[s.who] = s.x;
        if (s.x !== null) lead = s.who;
        else if (lead === s.who) lead = null;
      }
      const expected = lead === null ? null : at[lead];
      expect(b.current()?.t ?? null).toEqual(expected === null ? null : { kind: 'x', x: expected });
      expect(b.hovers).toEqual([]);
      g1.destroy(); g2.destroy();
    }), { numRuns: 80 });
  });

  it('detaching a member clears the cursor it led and the one it showed; a stale detach handle is inert', () => {
    const a = make('a'), b = make('b');
    const group = createSyncGroup();
    const oldDetachA = group.attach(a.handle, { id: 'A' });
    group.attach(a.handle, { id: 'A' }); // re-attach: the old handle is stale
    group.attach(b.handle, { id: 'B' });
    a.hoverAt(2);
    expect(b.current()).not.toBeNull();
    oldDetachA();
    expect(group.size).toBe(2);
    expect(b.current()).not.toBeNull();
    group.detach(a.handle);
    expect(b.current()).toBeNull();
    // B leading, then B detached: its own cursor on A is gone too (A is re-attached first).
    group.attach(a.handle, { id: 'A' });
    b.hoverAt(1);
    expect(a.current()).not.toBeNull();
    group.detach(b.handle);
    expect(a.current()).toBeNull();
    group.destroy();
  });

  it('a destroyed chart is inert: no cursor, no callback, no throw; destroy clears the cursors and every listener', () => {
    const a = make('a'), b = make('b'), c = make('c');
    const calls: string[] = [];
    const group = createSyncGroup();
    group.attach(a.handle, { id: 'A' });
    group.attach(b.handle, { id: 'B', onHoverSync: () => { calls.push('B'); } });
    group.attach(c.handle, { id: 'C', onHoverSync: () => { calls.push('C'); } });
    b.handle.destroy!();
    a.hoverAt(1);
    expect(calls).toEqual(['C']);
    expect(b.shown).toEqual([]);
    expect(c.current()).not.toBeNull();
    group.destroy();
    expect(c.current()).toBeNull();
    expect(group.size).toBe(0);
    expect(a.r.controller.handle).toBeDefined();
    a.hoverAt(2);
    expect(calls).toEqual(['C']);
  });

  it('reentrant callbacks: a target that detaches, destroys the group or hovers from inside its callback is safe', () => {
    const a = make('a'), b = make('b'), c = make('c'), d = make('d');
    const calls: string[] = [];
    const group = createSyncGroup();
    group.attach(a.handle, { id: 'A' });
    group.attach(b.handle, { id: 'B', onHoverSync: p => { calls.push(`B:${p?.x ?? null}`); group.detach(c.handle); b.hoverAt(0); } });
    group.attach(c.handle, { id: 'C', onHoverSync: () => { calls.push('C'); } });
    group.attach(d.handle, { id: 'D', onHoverSync: () => { calls.push('D'); group.destroy(); } });
    a.hoverAt(1);
    expect(calls).toEqual(['B:1', 'D']);
    expect(group.size).toBe(0);
    // B's own hover from inside the callback reached nobody (single propagation).
    expect(a.current()).toBeNull();
  });

  it('linked zoom stays synchronous and single: the peer applies the window and the group does not bounce it back', () => {
    const a = make('a'), b = make('b');
    const zooms: string[] = [];
    a.handle.on('zoom', d => { zooms.push(`A:${JSON.stringify(d)}`); });
    b.handle.on('zoom', d => { zooms.push(`B:${JSON.stringify(d)}`); });
    const group = createSyncGroup();
    group.attach(a.handle, { id: 'A' });
    group.attach(b.handle, { id: 'B' });
    a.handle.zoom([1, 2]);
    expect(zooms).toEqual(['A:[1,2]', 'B:[1,2]']);
    a.handle.zoom(null);
    expect(zooms.slice(2)).toEqual(['A:null', 'B:null']);
    group.destroy();
  });
});

describe('N6 structural handles keep the C5 behaviour', () => {
  it('a handle without the seam still gets the C5 payload at its matched x through onHoverSync', () => {
    const a = peer('line', { data: rowsOf([0, 1, 2], 'a', x => x * 2), x: 't', y: 'a' });
    const listeners = new Set<(p: Point<unknown> | null) => void>();
    const structural: SyncableChart<unknown> = {
      zoom() {},
      on(event, fn) { if (event !== 'hover') return () => {}; listeners.add(fn as never); return () => { listeners.delete(fn as never); }; },
    };
    const got: (Point<unknown> | null)[] = [];
    const options: SyncGroupOptions = {};
    const group = createSyncGroup(options);
    group.attach(a.handle, { id: 'A' });
    group.attach(structural, { id: 'S', xValues: [0, 1, 2] as XValue[], onHoverSync: p => { got.push(p); } });
    a.hoverAt(1);
    expect(got).toEqual([{ series: 'a', x: 1, y: 2, row: null, index: -1 }]);
    group.destroy();
    expect(listeners.size).toBe(0);
  });

  it('a real numeric scatter peer resolves its own series, y, row and visual target, never the source payload', () => {
    const a = peer('line', { data: rowsOf([0, 1, 2, 3], 'a', x => x * 10), x: 't', y: 'a' });
    const s = peer('scatter', { data: rowsOf([0, 1, 2, 3], 's', x => x * 100), x: 't', y: 's' });
    const got: (Point<unknown> | null)[] = [];
    const group = createSyncGroup();
    group.attach(a.handle, { id: 'A' });
    group.attach(s.handle, { id: 'S', onHoverSync: p => { got.push(p); } });
    a.hoverAt(2);
    expect(got).toEqual([{ series: 's', x: 2, y: 200, row: { t: 2, s: 200 }, index: 2 }]);
    expect(s.current()?.t).toEqual({ kind: 'point', refs: [{ kind: 'point', seriesKey: 's', row: 2, x: 2 }], count: 1 });
    expect(s.hovers).toEqual([]);
    a.hoverAt(null);
    expect(got).toEqual([{ series: 's', x: 2, y: 200, row: { t: 2, s: 200 }, index: 2 }, null]);
    expect(s.current()).toBeNull();
    expect(s.hovers).toEqual([]);
    group.destroy();
  });
});

describe('N6 round-3 review regressions: scatter resolution, attach reentrancy, and stale disposers', () => {
  it('scatter peer honors exact/nearest/tie rules, multi-series, hidden series, clipped zoom reset, and frame replacement', () => {
    const a = peer('line', { data: rowsOf([0, 1, 2, 3, 4, 5], 'a', x => x * 10), x: 't', y: 'a' });
    const s = peer('scatter', {
      data: [
        { t: 0, grp: 'p', y: 100 }, { t: 2, grp: 'p', y: 200 }, { t: 4, grp: 'p', y: 400 },
        { t: 2, grp: 'q', y: 250 }, { t: 5, grp: 'q', y: 550 },
      ],
      x: 't', y: 'y', series: 'grp',
    });
    const got: (Point<unknown> | null)[] = [];
    const group = createSyncGroup({ unmatchedHover: 'nearest', zoom: false });
    group.attach(a.handle, { id: 'A' });
    group.attach(s.handle, { id: 'S', onHoverSync: p => { got.push(p); } });

    // Exact match at x=2 hits both p and q in the visual target, primary is first series 'p'.
    a.hoverAt(2);
    expect(got.at(-1)).toMatchObject({ series: 'p', x: 2, y: 200 });
    expect(s.current()?.t).toEqual({
      kind: 'point',
      refs: [
        { kind: 'point', seriesKey: 'p', row: 1, x: 2 },
        { kind: 'point', seriesKey: 'q', row: 3, x: 2 },
      ],
      count: 2,
    });

    // Nearest tie at x=3 (equidistant between 2 and 4): earlier x (2) wins.
    a.hoverAt(3);
    expect(got.at(-1)).toMatchObject({ series: 'p', x: 2, y: 200 });

    // Hide series 'p': x=2 resolves only 'q'; x=4 has no 'q' so nearest takes 5 (dist 1 < dist 2).
    s.r.controller.actions.toggle('p');
    s.r.frames();
    a.hoverAt(2);
    expect(got.at(-1)).toMatchObject({ series: 'q', x: 2, y: 250 });
    expect(s.current()?.t).toEqual({ kind: 'point', refs: [{ kind: 'point', seriesKey: 'q', row: 3, x: 2 }], count: 1 });
    a.hoverAt(4);
    expect(got.at(-1)).toMatchObject({ series: 'q', x: 5, y: 550 });

    // Hide 'q' too -> all hidden -> null.
    s.r.controller.actions.toggle('q');
    s.r.frames();
    a.hoverAt(2);
    expect(got.at(-1)).toBeNull();
    expect(s.current()).toBeNull();

    // Restore both series, zoom past x=0, hover 0 (clipped -> null), then reset zoom -> resolves x=0!
    s.r.controller.actions.toggle('p');
    s.r.controller.actions.toggle('q');
    s.handle.zoom([2, 5]);
    s.r.frames();
    a.hoverAt(0);
    expect(got.at(-1)).toBeNull();
    expect(s.current()).toBeNull();
    s.handle.zoom(null);
    s.r.frames();
    expect(s.current()?.t).toEqual({ kind: 'point', refs: [{ kind: 'point', seriesKey: 'p', row: 0, x: 0 }], count: 1 });

    // Frame replacement updates the scatter data -> resolver re-resolves to new point at x=0.
    s.r.controller.handle.update({ data: [{ t: 0, grp: 'r', y: 999 }, { t: 5, grp: 'r', y: 111 }], x: 't', y: 'y', series: 'grp' });
    s.r.frames();
    expect(s.current()?.t).toEqual({ kind: 'point', refs: [{ kind: 'point', seriesKey: 'r', row: 0, x: 0 }], count: 1 });
    expect(s.hovers).toEqual([]);
    group.destroy();
  });

  it('createSyncGroup.attach rolls back and publishes nothing if a subscription callback destroys the group', () => {
    const a = peer('line', { data: rowsOf([0, 1, 2], 'a', x => x), x: 't', y: 'a' });
    const hoverListeners = new Set<(p: Point<unknown> | null) => void>();
    const zoomListeners = new Set<(d: readonly [XValue, XValue] | null) => void>();
    const group = createSyncGroup();
    group.attach(a.handle, { id: 'A' });
    const reentrant: SyncableChart<unknown> = {
      zoom() {},
      on(event, fn) {
        if (event === 'hover') {
          hoverListeners.add(fn as never);
          return () => { hoverListeners.delete(fn as never); };
        }
        if (event === 'zoom') {
          zoomListeners.add(fn as never);
          group.destroy();
          return () => { zoomListeners.delete(fn as never); };
        }
        return () => {};
      },
    };
    const detach = group.attach(reentrant, { id: 'R' });
    expect(group.size).toBe(0);
    expect(hoverListeners.size).toBe(0);
    expect(zoomListeners.size).toBe(0);
    detach();
    a.hoverAt(1);
    expect(a.current()).toBeNull();
  });

  it('stale controller onDestroy callback cannot detach a newer attachment of the same chart', () => {
    const disposers: (() => void)[] = [];
    const chart: SyncableChart<unknown> & SyncCapable = {
      zoom() {},
      on() { return () => {}; },
      [SYNC]: {
        drawn: null,
        sync() {},
        onDestroy(fn) { disposers.push(fn); return () => {}; },
      },
    };
    const group = createSyncGroup();
    group.attach(chart, { id: 'C1' });
    group.detach(chart);
    group.attach(chart, { id: 'C2' });
    expect(group.size).toBe(1);
    // Fire the stale disposer from C1: must NOT detach C2!
    disposers[0]!();
    expect(group.size).toBe(1);
    // Fire C2's disposer: detaches C2.
    disposers[1]!();
    expect(group.size).toBe(0);
    group.destroy();
  });
});

describe('N6 review regressions: per-recipient ownership, manual IDs, direct destroy, stale snapshots, and rollback', () => {
  const make = (field: string, xs: readonly number[] = [0, 1, 2, 3]) =>
    peer('line', { data: rowsOf(xs, field, x => x), x: 't', y: field });

  it('unmatched clear clears a prior origin on B so no cursor survives leaving or destroy', () => {
    const a = make('a', [0, 1, 2, 3]);
    const b = make('b', [0, 1, 2]);
    const c = make('c', [0, 1, 2, 3]);
    const group = createSyncGroup({ unmatchedHover: 'clear' });
    group.attach(a.handle, { id: 'A' });
    group.attach(b.handle, { id: 'B' });
    group.attach(c.handle, { id: 'C' });
    a.hoverAt(1);
    expect(b.current()?.t).toEqual({ kind: 'x', x: 1 });
    c.hoverAt(3); // unmatched on B -> clears A's cursor on B
    expect(b.current()).toBeNull();
    c.hoverAt(null);
    a.hoverAt(null);
    expect(b.current()).toBeNull();
    group.destroy();
    expect(b.current()).toBeNull();
  });

  it('unmatched ignore preserves A\'s ownership on B until A clears (or group destroys)', () => {
    const a = make('a', [0, 1, 2, 3]);
    const b = make('b', [0, 1, 2]);
    const c = make('c', [0, 1, 2, 3]);
    const group = createSyncGroup({ unmatchedHover: 'ignore' });
    group.attach(a.handle, { id: 'A' });
    group.attach(b.handle, { id: 'B' });
    group.attach(c.handle, { id: 'C' });
    a.hoverAt(1);
    expect(b.current()?.t).toEqual({ kind: 'x', x: 1 });
    c.hoverAt(3); // unmatched on B -> ignored, A still owns B
    expect(b.current()?.t).toEqual({ kind: 'x', x: 1 });
    c.hoverAt(null); // C leaving does not clear A's cursor on B
    expect(b.current()?.t).toEqual({ kind: 'x', x: 1 });
    a.hoverAt(null); // A leaving clears B
    expect(b.current()).toBeNull();
    // Also verify group.destroy() clears B if A is still active after C's unmatched hover.
    a.hoverAt(2);
    c.hoverAt(3);
    expect(b.current()?.t).toEqual({ kind: 'x', x: 2 });
    group.destroy();
    expect(b.current()).toBeNull();
  });

  it('distinct explicit manual sourceIds get distinct tokens so an older caller cannot clear a newer one', () => {
    const b = make('b');
    const group = createSyncGroup();
    group.attach(b.handle, { id: 'B' });
    group.syncHover(1, 'manual-A');
    expect(b.current()?.t).toEqual({ kind: 'x', x: 1 });
    group.syncHover(2, 'manual-B');
    expect(b.current()?.t).toEqual({ kind: 'x', x: 2 });
    group.syncHover(null, 'manual-A'); // stale manual caller
    expect(b.current()?.t).toEqual({ kind: 'x', x: 2 });
    group.syncHover(null, 'manual-B');
    expect(b.current()).toBeNull();
    group.destroy();
  });

  it('directly destroying a source chart clears its cursor on peers without explicit detach', () => {
    const a = make('a');
    const b = make('b');
    const group = createSyncGroup();
    group.attach(a.handle, { id: 'A' });
    group.attach(b.handle, { id: 'B' });
    a.hoverAt(2);
    expect(b.current()?.t).toEqual({ kind: 'x', x: 2 });
    a.handle.destroy!();
    expect(b.current()).toBeNull();
    expect(b.hovers).toEqual([]);
    group.destroy();
  });

  it('rejects a stale snapshotted hover event when an earlier listener detaches the source', () => {
    const a = make('a');
    const b = make('b');
    const group = createSyncGroup();
    let detachA: (() => void) | null = null;
    // Registered before group.attach so the controller's event snapshot runs it first.
    a.handle.on('hover', () => { detachA?.(); });
    detachA = group.attach(a.handle, { id: 'A' });
    group.attach(b.handle, { id: 'B' });
    a.hoverAt(1);
    expect(b.current()).toBeNull();
    expect(b.shown).toEqual([]);
    group.destroy();
  });

  it('rolls back hover subscription when zoom subscription throws so the failed member cannot broadcast', () => {
    const b = make('b');
    const hoverListeners = new Set<(p: Point<unknown> | null) => void>();
    const flaky: SyncableChart<unknown> = {
      zoom() {},
      on(event, fn) {
        if (event === 'hover') {
          hoverListeners.add(fn as never);
          return () => { hoverListeners.delete(fn as never); };
        }
        throw new Error('zoom subscribe failed');
      },
    };
    const group = createSyncGroup();
    group.attach(b.handle, { id: 'B' });
    expect(() => group.attach(flaky, { id: 'F' })).toThrow('zoom subscribe failed');
    expect(hoverListeners.size).toBe(0);
    expect(group.size).toBe(1);
    for (const fn of hoverListeners) fn({ series: 's', x: 1, y: 1, row: null, index: 0 });
    expect(b.current()).toBeNull();
    group.destroy();
  });
});

describe('N6 round-2 review regressions: source/recipient lifetime, owned clear across kind change, and zoom reentrancy', () => {
  const make = (field: string, xs: readonly number[] = [0, 1, 2, 3]) =>
    peer('line', { data: rowsOf(xs, field, x => x), x: 't', y: field });

  it('destroying source A from B\'s onHoverSync clears already-visited D and B and stops delivery to C', () => {
    const a = make('a'), d = make('d'), b = make('b'), c = make('c');
    const cCalls: unknown[] = [];
    const group = createSyncGroup();
    group.attach(a.handle, { id: 'A' });
    group.attach(d.handle, { id: 'D' });
    group.attach(b.handle, { id: 'B', onHoverSync: () => { a.handle.destroy!(); } });
    group.attach(c.handle, { id: 'C', onHoverSync: p => { cCalls.push(p); } });

    a.hoverAt(2);
    expect(d.current()).toBeNull();
    expect(b.current()).toBeNull();
    expect(c.current()).toBeNull();
    expect(c.shown).toEqual([]);
    expect(cCalls).toEqual([]);
    group.destroy();
  });

  it('detaching and immediately re-attaching source A during broadcastHover stops the old broadcast', () => {
    const a = make('a'), b = make('b'), c = make('c');
    const cCalls: unknown[] = [];
    const group = createSyncGroup();
    group.attach(a.handle, { id: 'A' });
    group.attach(b.handle, {
      id: 'B',
      onHoverSync: () => {
        group.detach(a.handle);
        group.attach(a.handle, { id: 'A' });
      },
    });
    group.attach(c.handle, { id: 'C', onHoverSync: p => { cCalls.push(p); } });

    a.hoverAt(1);
    expect(b.current()).toBeNull();
    expect(c.current()).toBeNull();
    expect(cCalls).toEqual([]);
    // Re-attached A still broadcasts on subsequent hovers.
    a.hoverAt(2);
    expect(cCalls).toHaveLength(0); // B re-detached+re-attached again, stopping the second broadcast too
    group.destroy();
  });

  it('source teardown from onMismatch or resolveX stops later delivery with no residual cursor', () => {
    // Teardown from onMismatch
    const a1 = make('a'), d1 = make('d'), mismatchPeer = peer('bar', { data: [{ m: 'Jan', v: 1 }], x: 'm', y: 'v' }), c1 = make('c');
    const g1 = createSyncGroup({ onMismatch: () => { a1.handle.destroy!(); } });
    g1.attach(a1.handle, { id: 'A' });
    g1.attach(d1.handle, { id: 'D' });
    g1.attach(mismatchPeer.handle, { id: 'M' });
    g1.attach(c1.handle, { id: 'C' });
    a1.hoverAt(1);
    expect(d1.current()).toBeNull();
    expect(c1.current()).toBeNull();
    expect(c1.shown).toEqual([]);
    g1.destroy();

    // Teardown from resolveX (destroying source A)
    const a2 = make('a'), d2 = make('d'), b2 = make('b'), c2 = make('c');
    const g2 = createSyncGroup();
    g2.attach(a2.handle, { id: 'A' });
    g2.attach(d2.handle, { id: 'D' });
    g2.attach(b2.handle, { id: 'B', resolveX: x => { a2.handle.destroy!(); return x; } });
    g2.attach(c2.handle, { id: 'C' });
    a2.hoverAt(1);
    expect(d2.current()).toBeNull();
    expect(b2.current()).toBeNull();
    expect(b2.shown).toEqual([]);
    expect(c2.current()).toBeNull();
    expect(c2.shown).toEqual([]);
    g2.destroy();

    // Detaching recipient B from B's own resolveX skips B and still delivers to C
    const a3 = make('a'), b3 = make('b'), c3 = make('c');
    const g3 = createSyncGroup();
    g3.attach(a3.handle, { id: 'A' });
    g3.attach(b3.handle, { id: 'B', resolveX: x => { g3.detach(b3.handle); return x; } });
    g3.attach(c3.handle, { id: 'C' });
    a3.hoverAt(2);
    expect(b3.current()).toBeNull();
    expect(b3.shown).toEqual([]);
    expect(c3.current()?.t).toEqual({ kind: 'x', x: 2 });
    g3.destroy();
  });

  it('reentrant zoom teardown from target zoom listener, onZoomSync, or onMismatch stops later delivery', () => {
    const a = make('a'), b = make('b'), c = make('c');
    const cZooms: unknown[] = [];
    const bOnZoomSync: unknown[] = [];
    const group = createSyncGroup();
    group.attach(a.handle, { id: 'A' });
    group.attach(b.handle, { id: 'B', onZoomSync: d => { bOnZoomSync.push(d); } });
    group.attach(c.handle, { id: 'C', onZoomSync: d => { cZooms.push(d); } });
    b.handle.on('zoom', () => { a.handle.destroy!(); });

    a.handle.zoom([1, 2]);
    expect(bOnZoomSync).toEqual([]);
    expect(cZooms).toEqual([]);
    group.destroy();

    // Detach + re-attach source during B's onZoomSync stops delivery to C
    const a2 = make('a'), b2 = make('b'), c2 = make('c');
    const c2Zooms: unknown[] = [];
    const g2 = createSyncGroup();
    g2.attach(a2.handle, { id: 'A' });
    g2.attach(b2.handle, { id: 'B', onZoomSync: () => { g2.detach(a2.handle); g2.attach(a2.handle, { id: 'A' }); } });
    g2.attach(c2.handle, { id: 'C', onZoomSync: d => { c2Zooms.push(d); } });
    a2.handle.zoom([1, 2]);
    expect(c2Zooms).toEqual([]);
    g2.destroy();

    // onMismatch destroying source stops zoom delivery to C
    const a3 = make('a'), m3 = peer('bar', { data: [{ m: 'Jan', v: 1 }], x: 'm', y: 'v' }), c3 = make('c');
    const c3Zooms: unknown[] = [];
    const g3 = createSyncGroup({ onMismatch: () => { a3.handle.destroy!(); } });
    g3.attach(a3.handle, { id: 'A' });
    g3.attach(m3.handle, { id: 'M' });
    g3.attach(c3.handle, { id: 'C', onZoomSync: d => { c3Zooms.push(d); } });
    a3.handle.zoom([1, 2]);
    expect(c3Zooms).toEqual([]);
    g3.destroy();
  });

  it('owned null clear releases cursor even after peer switches X kind, while preserving cross-group token checks', () => {
    const a = make('a'), b = make('b'), c = make('c');
    const bGot: (Point<unknown> | null)[] = [];
    const g1 = createSyncGroup(), g2 = createSyncGroup();
    g1.attach(a.handle, { id: 'A' });
    g1.attach(b.handle, { id: 'B', onHoverSync: p => { bGot.push(p); } });
    g2.attach(c.handle, { id: 'C' });
    g2.attach(b.handle, { id: 'B' });

    // A shows on B, then C takes over B in g2, then B changes to categorical.
    a.hoverAt(1);
    c.hoverAt(2);
    const cOrigin = b.current()!.o;
    b.r.controller.handle.update({ data: [{ k: 'Jan', b: 10 }, { k: 'Feb', b: 20 }], x: 'k', y: 'b' });
    b.r.frames();
    // A's clear is owned in g1 (so g1 calls sync(null, tokenA)), but B's seam holds cOrigin -> C's ownership stays!
    a.hoverAt(null);
    expect(bGot.at(-1)).toBeNull();
    expect(b.current()).toBeNull();
    expect(b.origin()).toBe(cOrigin);
    // C's clear releases B even while B is categorical!
    c.hoverAt(null);
    expect(b.origin()).toBeNull();
    expect(b.current()).toBeNull();
    g1.destroy(); g2.destroy();
  });

  it('scatter peer breaks equidistant visible ties deterministically (earlier X), counts >8 visible excluding clipped, and retains X-clipped hover across zoom reset', () => {
    const a = make('a', [0, 1, 2, 3, 4, 5]);
    const s = peer('scatter', {
      data: [
        { t: 1, y: 5 },
        { t: 2, y: 90 }, // Y-clipped
        { t: 3, y: 5 },
        ...Array.from({ length: 10 }, (_, i) => ({ t: 4, y: i * 0.5 + 1 })), // 10 visible at x=4
        { t: 4, y: 50 }, { t: 4, y: 60 }, // 2 clipped at x=4
      ],
      x: { field: 't', domain: [0, 5] },
      y: { field: 'y', domain: [0, 10] },
    });
    const got: (Point<unknown> | null)[] = [];
    const g = createSyncGroup({ unmatchedHover: 'nearest' });
    g.attach(a.handle, { id: 'A' });
    g.attach(s.handle, { id: 'S', onHoverSync: p => { got.push(p); } });

    // Equidistant visible tie around clipped (2, 90): earlier X (1, 5) wins over (3, 5).
    a.hoverAt(2);
    expect(got.at(-1)).toMatchObject({ x: 1, y: 5 });

    // 10 visible + 2 clipped at x=4 -> refs capped at 8, count is 10.
    a.hoverAt(4);
    const t4 = s.current()!.t!;
    expect(t4.kind).toBe('point');
    if (t4.kind === 'point') {
      expect(t4.refs).toHaveLength(8);
      expect(t4.count).toBe(10);
    }

    // X-zoom clips x=4, then reset restores it with 0 echo.
    s.handle.zoom([0, 2]);
    s.r.frames();
    expect(s.current()).toBeNull();
    s.handle.zoom(null);
    s.r.frames();
    expect(s.current()?.t).toMatchObject({ kind: 'point', count: 10 });
    expect(s.hovers).toEqual([]);
    g.destroy();
  });
});

describe('N6 round-5 review regressions: wall-clock manual dispatch & pending-attach isolation', () => {
  it('manual syncHover and syncZoom classify offset-free ISO date-times as wall (committed kind wins over declared xKind) while preserving Date/offset instants, calendar dates, wall normalization, and mismatch reporting', () => {
    const wallRows = [
      { t: '2026-11-27T09:00', v: 10 },
      { t: '2026-11-27T10:00', v: 20 },
      { t: '2026-11-27T11:00', v: 30 },
      { t: '2026-11-27T12:00', v: 40 },
    ];
    const wallPeer = peer('line', { data: wallRows, x: 't', y: 'v' });
    const wallGot: (Point<unknown> | null)[] = [];
    const wallZooms: (readonly [XValue, XValue] | null)[] = [];
    wallPeer.handle.on('zoom', d => { wallZooms.push(d); });

    const mismatches: string[] = [];
    const group = createSyncGroup({
      unmatchedHover: 'nearest',
      onMismatch: m => { mismatches.push(`${m.kind}:${m.targetId}:${m.reason}:${m.sourceXKind}->${m.targetXKind}`); },
    });
    // Real wall-clock peer declared with xKind: 'time' -> committed 'wall' kind wins.
    group.attach(wallPeer.handle, { id: 'W', xKind: 'time', onHoverSync: p => { wallGot.push(p); } });

    // Manual hover & zoom with offset-free ISO date-times succeed with zero mismatches.
    group.syncHover('2026-11-27T10:00');
    expect(mismatches).toEqual([]);
    expect(wallGot.at(-1)).toMatchObject({ series: 'v', y: 20, index: 1 });
    expect(wallPeer.current()?.t).toEqual({ kind: 'x', x: Date.parse('2026-11-27T10:00:00Z') });

    // Equivalent wall timestamp formatting (space separator / explicit seconds) matches the same slot.
    group.syncHover('2026-11-27 11:00:00');
    expect(mismatches).toEqual([]);
    expect(wallGot.at(-1)).toMatchObject({ series: 'v', y: 30, index: 2 });

    group.syncZoom(['2026-11-27T10:00', '2026-11-27T11:00']);
    wallPeer.r.frames();
    expect(mismatches).toEqual([]);
    expect(wallZooms).toHaveLength(1);
    expect(wallPeer.handle[SYNC]!.drawn!.accepted.view.kind).toBe('line');
    const view = wallPeer.handle[SYNC]!.drawn!.accepted.view;
    if (view.kind === 'line') {
      expect(view.xDomain).toEqual([Date.parse('2026-11-27T10:00:00Z'), Date.parse('2026-11-27T11:00:00Z')]);
    }
    group.syncZoom(null);
    wallPeer.r.frames();

    // Date instance, offset ISO string, and calendar date must still report x-kind-mismatch against wall peer.
    group.syncHover(new Date('2026-11-27T10:00:00Z'));
    group.syncHover('2026-11-27T10:00:00Z');
    group.syncHover('2026-11-27');
    group.syncZoom(['2026-11-27T10:00:00Z', '2026-11-27T11:00:00Z']);
    expect(mismatches).toEqual([
      'hover:W:x-kind-mismatch:time->wall',
      'hover:W:x-kind-mismatch:time->wall',
      'hover:W:x-kind-mismatch:date->wall',
      'zoom:W:x-kind-mismatch:time->wall',
    ]);

    // Structural peer with wall-clock xValues normalizes equivalent wall timestamps (seconds/spacing) and nearest.
    const structGot: (XValue | null)[] = [];
    const structural: SyncableChart<unknown> = { zoom() {}, on() { return () => {}; } };
    group.attach(structural, {
      id: 'S',
      xValues: ['2026-11-27T09:00', '2026-11-27T10:00:00', '2026-11-27 12:00'],
      onHoverSync: p => { structGot.push(p ? p.x : null); },
    });
    group.syncHover('2026-11-27 10:00');
    group.syncHover('2026-11-27T11:45:00');
    expect(structGot).toEqual(['2026-11-27T10:00:00', '2026-11-27 12:00']);

    // Explicit incompatible units on wall-clock peers still report unit-mismatch.
    const wallPeerB = peer('line', { data: wallRows, x: 't', y: 'v' });
    const unitMismatches: string[] = [];
    const gUnits = createSyncGroup({ onMismatch: m => { unitMismatches.push(`${m.targetId}:${m.reason}`); } });
    gUnits.attach(wallPeer.handle, { id: 'W1', xUnit: 'CET' });
    gUnits.attach(wallPeerB.handle, { id: 'W2', xUnit: 'EST' });
    wallPeer.hoverAt(Date.parse('2026-11-27T10:00:00Z'));
    expect(unitMismatches).toEqual(['W2:unit-mismatch']);
    gUnits.destroy();
    group.destroy();
  });

  it('pending attach callbacks (sync emit on hover/zoom, sync onDestroy, membership replacement, detach reentrancy) stay inert until exact record is published', () => {
    const existing = peer('line', { data: rowsOf([0, 1, 2, 3], 'v', x => x * 10), x: 't', y: 'v' });
    const existingGot: (Point<unknown> | null)[] = [];
    const group = createSyncGroup();
    group.attach(existing.handle, { id: 'E', onHoverSync: p => { existingGot.push(p); } });

    // 1. Successful synchronous emission during on('hover') and on('zoom') must NOT implicitly broadcast before commit.
    let emitHoverNow: ((p: Point<unknown> | null) => void) | null = null;
    const syncSuccess: SyncableChart<unknown> = {
      zoom() {},
      on(event, fn) {
        if (event === 'hover') {
          emitHoverNow = fn as (p: Point<unknown> | null) => void;
          emitHoverNow({ series: 's', x: 1, y: 1, row: null, index: 0 });
        } else if (event === 'zoom') {
          (fn as (d: readonly [XValue, XValue] | null) => void)([0, 2]);
        }
        return () => {};
      },
    };
    const detachSuccess = group.attach(syncSuccess, { id: 'S' });
    expect(existing.current()).toBeNull();
    expect(existingGot).toEqual([]);
    // After commit, real emissions DO broadcast.
    emitHoverNow!({ series: 's', x: 2, y: 2, row: null, index: 1 });
    expect(existing.current()?.t).toEqual({ kind: 'x', x: 2 });
    expect(existingGot).toHaveLength(1);
    detachSuccess();
    expect(existing.current()).toBeNull();

    // 2. Pending onDestroy invoked synchronously during attach rolls back cleanly and never publishes the member.
    const unsubLog: string[] = [];
    const preDestroyed: SyncableChart<unknown> & SyncCapable = {
      zoom() {},
      on(event) {
        return () => { unsubLog.push(`unsub:${event}`); };
      },
      [SYNC]: {
        drawn: null,
        sync() {},
        onDestroy(fn) {
          fn();
          fn(); // idempotent repeat
          return () => { unsubLog.push('unsub:destroy'); };
        },
      },
    };
    const detachPre = group.attach(preDestroyed, { id: 'D' });
    expect(group.size).toBe(1); // only existing
    expect(unsubLog).toEqual(['unsub:destroy', 'unsub:zoom', 'unsub:hover']);
    detachPre(); // no-op

    // 3. Reentrant membership replacement + detach reentrancy by exact record + stale handle inertness.
    let reentered = false;
    let staleHandle: (() => void) | null = null;
    const unsubEvents: string[] = [];
    const replaceable: SyncableChart<unknown> = {
      zoom() {},
      on(event) {
        if (event === 'hover' && !reentered) {
          reentered = true;
          staleHandle = group.attach(replaceable, { id: 'R-inner' });
        }
        const tag = `${reentered ? 'inner' : 'outer'}:${event}`;
        return () => {
          unsubEvents.push(tag);
          // Reentrant detach from inside unsubscribe must be idempotent.
          group.detach(replaceable);
        };
      },
    };
    const outerHandle = group.attach(replaceable, { id: 'R-outer' });
    expect(group.size).toBe(2);
    // Calling staleHandle from the replaced inner attachment must NOT detach outerHandle.
    staleHandle!();
    expect(group.size).toBe(2);
    outerHandle();
    expect(group.size).toBe(1);
    group.destroy();
  });
});

describe('N6 round-6 review regressions: reentrant unsubscribe replacement & year-only calendar dates', () => {
  it('reentrant attach during replacement unsubscribe wins with exact live listener balance, callback ownership, and clean detach/destroy', () => {
    const runScenario = (teardown: 'detach' | 'destroy') => {
      const peerB = peer('line', { data: rowsOf([0, 1, 2], 'b', x => x * 10), x: 't', y: 'b' });
      const bOrigins: string[] = [];
      const group = createSyncGroup();
      group.attach(peerB.handle, { id: 'B', onHoverSync: (p, origin) => { if (p) bOrigins.push(origin.sourceId); } });

      type Sub = { tag: string; event: string; fn: (payload: unknown) => void };
      const live = new Set<Sub>();
      let phase = 0;
      let innerHandle: (() => void) | null = null;
      let replacementHandle: (() => void) | null = null;

      const structural: SyncableChart<unknown> = {
        zoom() {},
        on(event, fn) {
          let tag: string;
          if (event === 'hover' && phase === 0) {
            phase = 1;
            innerHandle = group.attach(structural, { id: 'R-inner' });
            tag = 'outer:hover';
          } else if (phase === 1) {
            tag = `inner:${event}`;
          } else if (phase === 2) {
            tag = `replacement:${event}`;
          } else {
            tag = `outer:${event}`;
          }
          const sub: Sub = { tag, event, fn: fn as (payload: unknown) => void };
          live.add(sub);
          return () => {
            live.delete(sub);
            if (tag === 'inner:hover') {
              phase = 2;
              replacementHandle = group.attach(structural, { id: 'R-replacement' });
            }
          };
        },
      };

      const outerHandle = group.attach(structural, { id: 'R-outer' });
      expect(group.size).toBe(2); // B + R-replacement
      expect([...live].map(s => s.tag).sort()).toEqual(['replacement:hover', 'replacement:zoom']);

      // Stale handles from outer and inner must be completely inert.
      outerHandle();
      innerHandle!();
      expect(group.size).toBe(2);
      expect(live.size).toBe(2);

      // Callback ownership: emitting through the live replacement listener broadcasts with R-replacement.
      const hoverSub = [...live].find(s => s.event === 'hover')!;
      hoverSub.fn({ series: 's', x: 1, y: 1, row: null, index: 0 });
      expect(bOrigins).toEqual(['R-replacement']);
      expect(peerB.current()?.t).toEqual({ kind: 'x', x: 1 });

      if (teardown === 'detach') {
        replacementHandle!();
        expect(group.size).toBe(1);
        expect(live.size).toBe(0);
        expect(peerB.current()).toBeNull();
        group.destroy();
      } else {
        group.destroy();
        expect(group.size).toBe(0);
        expect(live.size).toBe(0);
        expect(peerB.current()).toBeNull();
      }
    };
    runScenario('detach');
    runScenario('destroy');
  });

  it('initial replacement boundary lets a reentrant attach from teardown win without subscribing the contender or clobbering new cursors', () => {
    const peerA = peer('line', { data: rowsOf([0, 1, 2], 'a', x => x), x: 't', y: 'a' });
    const group = createSyncGroup();
    group.attach(peerA.handle, { id: 'A' });

    const live = new Set<string>();
    let seq = 0;
    let reattached = false;
    let winnerHandle: (() => void) | null = null;
    const synced: { t: PickTarget | null; o: object }[] = [];
    let currentOrigin: object | null = null;

    const chart: SyncableChart<unknown> & SyncCapable = {
      zoom() {},
      on(event) {
        const tag = `s${++seq}:${event}`;
        live.add(tag);
        return () => {
          live.delete(tag);
          if (!reattached && event === 'hover') {
            reattached = true;
            winnerHandle = group.attach(chart, { id: 'R-winner' });
            // Peer A hovers right after R-winner publishes; R0's teardown must not clobber R-winner's new cursor.
            peerA.hoverAt(1);
          }
        };
      },
      [SYNC]: {
        drawn: peerA.handle[SYNC]!.drawn,
        sync(f, o) {
          const d = peerA.handle[SYNC]!.drawn;
          const t = f && d ? f(d.accepted.view, d.lookup, d.layout) : null;
          synced.push({ t, o });
          if (f) currentOrigin = o;
          else if (currentOrigin === o) currentOrigin = null;
        },
      },
    };

    group.attach(chart, { id: 'R0' });
    peerA.hoverAt(2);
    expect(currentOrigin).not.toBeNull();

    // Contender R1 detaches R0; R0's hover unsubscribe installs R-winner and triggers peerA hover.
    const contenderHandle = group.attach(chart, { id: 'R1' });
    expect(group.size).toBe(2);
    expect(live.size).toBe(2); // only R-winner's hover + zoom; contender never subscribed
    expect(currentOrigin).not.toBeNull();
    expect(synced.at(-1)?.t).toEqual({ kind: 'x', x: 1 });

    contenderHandle();
    expect(live.size).toBe(2);
    winnerHandle!();
    expect(live.size).toBe(0);
    expect(currentOrigin).toBeNull();
    group.destroy();
  });

  it('recognizes year-only YYYY, YYYY-MM, and YYYY-MM-DD calendar dates in manual hover/zoom with Jan-1 normalization, invalid-date rejection, and declared-category preservation', () => {
    const yearChart = peer('line', {
      data: [{ t: '2023', v: 10 }, { t: '2024', v: 20 }, { t: '2025', v: 30 }, { t: '2026', v: 40 }],
      x: 't', y: 'v',
    });
    const monthChart = peer('line', {
      data: [{ t: '2024-01', v: 100 }, { t: '2024-06', v: 200 }, { t: '2025-01', v: 300 }],
      x: 't', y: 'v',
    });
    const dayChart = peer('line', {
      data: [{ t: '2024-01-01', v: 1 }, { t: '2024-02-29', v: 2 }, { t: '2024-03-01', v: 3 }],
      x: 't', y: 'v',
    });
    const yearGot: (Point<unknown> | null)[] = [];
    const monthGot: (Point<unknown> | null)[] = [];
    const dayGot: (Point<unknown> | null)[] = [];
    const mismatches: string[] = [];

    const group = createSyncGroup({
      onMismatch: m => { mismatches.push(`${m.kind}:${m.targetId}:${m.reason}:${m.sourceXKind}->${m.targetXKind}`); },
    });
    group.attach(yearChart.handle, { id: 'Y', onHoverSync: p => { yearGot.push(p); } });
    group.attach(monthChart.handle, { id: 'M', onHoverSync: p => { monthGot.push(p); } });
    group.attach(dayChart.handle, { id: 'D', onHoverSync: p => { dayGot.push(p); } });

    // Year-only manual hover resolves to Jan 1 UTC across year, month, and day charts with 0 mismatches.
    group.syncHover('2024');
    expect(mismatches).toEqual([]);
    const jan1_2024 = Date.parse('2024-01-01T00:00:00Z');
    expect(yearGot.at(-1)).toMatchObject({ series: 'v', y: 20, index: 1 });
    expect(yearChart.current()?.t).toEqual({ kind: 'x', x: jan1_2024 });
    expect(monthGot.at(-1)).toMatchObject({ series: 'v', y: 100, index: 0 });
    expect(dayGot.at(-1)).toMatchObject({ series: 'v', y: 1, index: 0 });

    // Equivalent YYYY-MM and YYYY-MM-DD Jan-1 values match the year-only chart.
    group.syncHover('2024-01');
    expect(yearGot.at(-1)).toMatchObject({ y: 20 });
    group.syncHover('2024-01-01');
    expect(yearGot.at(-1)).toMatchObject({ y: 20 });

    // Valid leap day matches dayChart; invalid calendar dates (no rollover!) do NOT match 2024-03-01.
    group.syncHover('2024-02-29');
    expect(dayGot.at(-1)).toMatchObject({ y: 2 });
    group.syncHover('2024-02-30');
    expect(dayGot.at(-1)).toBeNull();
    expect(dayChart.current()).toBeNull();
    group.syncHover('2023-02-29');
    expect(dayGot.at(-1)).toBeNull();
    group.syncHover('2024-13');
    expect(yearGot.at(-1)).toBeNull();
    expect(mismatches).toEqual([]);

    // Year-only manual zoom applies window to the year-only chart cleanly.
    group.syncZoom(['2024', '2025']);
    yearChart.r.frames();
    expect(mismatches).toEqual([]);
    const yv = yearChart.handle[SYNC]!.drawn!.accepted.view;
    if (yv.kind === 'line') {
      expect(yv.xDomain).toEqual([Date.parse('2024-01-01T00:00:00Z'), Date.parse('2025-01-01T00:00:00Z')]);
    }
    group.syncZoom(null);
    yearChart.r.frames();

    // Declared category charts with 4-digit year labels reject manual date hover/zoom as mismatch,
    // while syncing cleanly with another declared category chart.
    const catA = peer('bar', { data: [{ k: '2023', v: 1 }, { k: '2024', v: 2 }], x: { field: 'k', type: 'category' }, y: 'v' });
    const catB = peer('bar', { data: [{ k: '2023', w: 10 }, { k: '2024', w: 20 }], x: { field: 'k', type: 'category' }, y: 'w' });
    const catGot: (Point<unknown> | null)[] = [];
    group.attach(catA.handle, { id: 'CA' });
    group.attach(catB.handle, { id: 'CB', onHoverSync: p => { catGot.push(p); } });
    group.syncHover('2024');
    expect(mismatches).toEqual([
      'hover:CA:x-kind-mismatch:date->category',
      'hover:CB:x-kind-mismatch:date->category',
    ]);
    expect(catGot).toEqual([]);
    // Source category chart A hovering '2024' syncs to category chart B cleanly.
    catA.hoverAt(1);
    expect(catGot.at(-1)).toMatchObject({ series: 'w', x: '2024', y: 20 });
    expect(yearChart.hovers).toEqual([]);
    group.destroy();
  });
});

describe('N6 round-7 review regressions: throwing unsubscribe draining & syncCharts adapter detection', () => {
  it('drains all installed unsubscribes and rolls back pending attach when replacement teardown throws, preserving first error and exact-record semantics', () => {
    // 1. Exact reproduced scenario: inner zoom unsubscribe removes itself and throws; inner hover and pending outer must all drain.
    const peerB = peer('line', { data: rowsOf([0, 1, 2], 'b', x => x * 10), x: 't', y: 'b' });
    const group = createSyncGroup();
    group.attach(peerB.handle, { id: 'B' });

    const live = new Set<string>();
    const zoomErr = new Error('inner zoom unsub failed');
    const hoverErr = new Error('inner hover unsub failed');
    let phase = 0;
    let innerHoverFn: ((p: Point<unknown> | null) => void) | null = null;
    const chart: SyncableChart<unknown> = {
      zoom() {},
      on(event, fn) {
        let tag: string;
        if (event === 'hover' && phase === 0) {
          phase = 1;
          group.attach(chart, { id: 'R-inner' });
          // Show a cursor on peerB from R-inner so visual ownership cleanup is also verified.
          innerHoverFn!({ series: 's', x: 1, y: 1, row: null, index: 0 });
          tag = 'outer:hover';
        } else if (phase === 1) {
          tag = `inner:${event}`;
          if (event === 'hover') innerHoverFn = fn as (p: Point<unknown> | null) => void;
        } else {
          tag = `outer:${event}`;
        }
        live.add(tag);
        return () => {
          live.delete(tag);
          if (tag === 'inner:zoom') throw zoomErr;
          if (tag === 'inner:hover') throw hoverErr;
        };
      },
    };

    expect(() => group.attach(chart, { id: 'R-outer' })).toThrow(zoomErr);
    expect(group.size).toBe(1); // only peerB
    expect(live.size).toBe(0); // inner:zoom, inner:hover, outer:zoom, outer:hover all drained
    expect(peerB.current()).toBeNull(); // visual ownership cleared
    group.detach(chart);
    group.destroy();
    expect(group.size).toBe(0);
    expect(live.size).toBe(0);

    // 2. Variant: inner zoom throws, inner hover still drains and installs R-replacement; outer rolls back without disturbing R-replacement.
    for (const mode of ['detach', 'destroy'] as const) {
      const p2 = peer('line', { data: rowsOf([0, 1, 2], 'b', x => x * 10), x: 't', y: 'b' });
      const g2 = createSyncGroup();
      g2.attach(p2.handle, { id: 'B' });
      const live2 = new Set<string>();
      let ph = 0;
      let innerHandle: (() => void) | null = null;
      let replHandle: (() => void) | null = null;
      const err = new Error('replacement zoom unsub failed');
      const ch2: SyncableChart<unknown> = {
        zoom() {},
        on(event) {
          let tag: string;
          if (event === 'hover' && ph === 0) {
            ph = 1;
            innerHandle = g2.attach(ch2, { id: 'R-inner' });
            tag = 'outer:hover';
          } else if (ph === 1) {
            tag = `inner:${event}`;
          } else if (ph === 2) {
            tag = `repl:${event}`;
          } else {
            tag = `outer:${event}`;
          }
          live2.add(tag);
          return () => {
            live2.delete(tag);
            if (tag === 'inner:zoom') throw err;
            if (tag === 'inner:hover') {
              ph = 2;
              replHandle = g2.attach(ch2, { id: 'R-repl' });
            }
          };
        },
      };

      expect(() => g2.attach(ch2, { id: 'R-outer' })).toThrow(err);
      expect(g2.size).toBe(2); // B + R-repl
      expect([...live2].sort()).toEqual(['repl:hover', 'repl:zoom']);
      // Stale inner handle is inert (exact-record semantics).
      innerHandle!();
      expect(g2.size).toBe(2);
      expect(live2.size).toBe(2);
      if (mode === 'detach') {
        replHandle!();
        expect(g2.size).toBe(1);
        expect(live2.size).toBe(0);
        g2.destroy();
      } else {
        g2.destroy();
        expect(g2.size).toBe(0);
        expect(live2.size).toBe(0);
      }
    }
  });

  it('group.destroy continues draining remaining members and visual cursors after a thrown unsubscribe, rethrowing the first error', () => {
    const peerB = peer('line', { data: rowsOf([0, 1, 2], 'b', x => x * 10), x: 't', y: 'b' });
    const group = createSyncGroup();
    const liveA = new Set<string>();
    const liveC = new Set<string>();
    const errA1 = new Error('A zoom unsub failed');
    const errA2 = new Error('A hover unsub failed');
    const errC = new Error('C zoom unsub failed');
    let emitA: ((p: Point<unknown> | null) => void) | null = null;

    const chartA: SyncableChart<unknown> = {
      zoom() {},
      on(event, fn) {
        if (event === 'hover') emitA = fn as (p: Point<unknown> | null) => void;
        liveA.add(event);
        return () => {
          liveA.delete(event);
          if (event === 'zoom') throw errA1;
          if (event === 'hover') throw errA2;
        };
      },
    };
    const chartC: SyncableChart<unknown> = {
      zoom() {},
      on(event) {
        liveC.add(event);
        return () => {
          liveC.delete(event);
          if (event === 'zoom') throw errC;
        };
      },
    };

    group.attach(chartA, { id: 'A' });
    group.attach(peerB.handle, { id: 'B' });
    group.attach(chartC, { id: 'C' });
    emitA!({ series: 's', x: 1, y: 1, row: null, index: 0 });
    expect(peerB.current()?.t).toEqual({ kind: 'x', x: 1 });

    expect(() => group.destroy()).toThrow(errA1);
    expect(group.size).toBe(0);
    expect(liveA.size).toBe(0);
    expect(liveC.size).toBe(0);
    expect(peerB.current()).toBeNull();
  });

  it('syncCharts attaches a valid structural chart adapter with a nested non-function chart.on property', () => {
    const hoverListeners = new Set<(p: Point<unknown> | null) => void>();
    const zoomCalls: (readonly [XValue, XValue] | null)[] = [];
    const peerGot: (Point<unknown> | null)[] = [];
    const peerB = peer('line', { data: rowsOf([0, 1, 2], 'b', x => x * 10), x: 't', y: 'b' });

    const adapter: SyncableChart<unknown> & { readonly chart: { readonly on: Record<string, boolean> } } = {
      chart: { on: { hover: true, zoom: true } },
      zoom(domain) { zoomCalls.push(domain); },
      on(event, fn) {
        if (event === 'hover') {
          const cb = fn as (p: Point<unknown> | null) => void;
          hoverListeners.add(cb);
          return () => { hoverListeners.delete(cb); };
        }
        return () => {};
      },
    };

    const group = syncCharts([
      adapter,
      { chart: peerB.handle, options: { id: 'B', onHoverSync: p => { peerGot.push(p); } } },
    ]);
    expect(group.size).toBe(2);
    expect(hoverListeners.size).toBe(1);

    for (const fn of hoverListeners) fn({ series: 's', x: 2, y: 20, row: null, index: 2 });
    expect(peerB.current()?.t).toEqual({ kind: 'x', x: 2 });
    expect(peerGot.at(-1)).toMatchObject({ series: 'b', x: 2, y: 20 });

    peerB.handle.zoom([0, 1]);
    expect(zoomCalls).toEqual([[0, 1]]);

    group.destroy();
    expect(group.size).toBe(0);
    expect(hoverListeners.size).toBe(0);
  });

  it('preserves method receiver when SyncMemberOptions.resolveX reads this.xValues', () => {
    const peerB = peer('line', { data: rowsOf([0, 1, 2], 'b', x => x * 10), x: 't', y: 'b' });
    const got: (Point<unknown> | null)[] = [];
    const group = createSyncGroup();
    const memberOpts: SyncMemberOptions<unknown> = {
      id: 'B',
      xValues: [0, 2],
      resolveX(this: SyncMemberOptions<unknown>, x: XValue) {
        return this.xValues!.includes(x) ? x : null;
      },
      onHoverSync: p => { got.push(p); },
    };
    group.attach(peerB.handle, memberOpts);

    group.syncHover(2);
    expect(peerB.current()?.t).toEqual({ kind: 'x', x: 2 });
    expect(got.at(-1)).toMatchObject({ series: 'b', x: 2, y: 20 });

    group.syncHover(1);
    expect(peerB.current()).toBeNull();
    expect(got.at(-1)).toBeNull();

    group.destroy();
  });
});
