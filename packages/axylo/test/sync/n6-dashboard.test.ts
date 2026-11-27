/**
 * N6 `createDashboard` in Node on the minimal DOM of n3-dom.ts, with structural charts that count what they
 * hold: a strict-CSP grid (no <style>, style set through the element's style object) that stacks below two
 * columns, shared zoom / brush / reset through the group, dynamic add and remove, and reverse-order rollback
 * and disposal that leave 0 listeners, 0 charts and 0 owned nodes, a disconnected panel included.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createDashboard, type DashboardPanel, type SyncableChart } from '../../src/sync';
import type { ChartEvents, XValue } from '../../src/public';
import { TestDocument, type TestElement } from '../core/n3-dom';

interface Fake {
  readonly name: string;
  readonly chart: SyncableChart<unknown>;
  readonly zooms: (readonly [XValue, XValue] | null)[];
  listeners(): number;
  destroyed: boolean;
  brush(domain: readonly [XValue, XValue] | null): void;
}

function fakes(log: string[]) {
  const made: Fake[] = [];
  const make = (name: string) => (element: HTMLElement): SyncableChart<unknown> => {
    const sets = { hover: new Set<(p: never) => void>(), select: new Set<(p: never) => void>(), zoom: new Set<(p: never) => void>() };
    const child = (element as unknown as TestElement).ownerDocument.createElement('figure');
    (element as unknown as TestElement).appendChild(child);
    const fake: Fake = {
      name, zooms: [], destroyed: false,
      listeners: () => sets.hover.size + sets.select.size + sets.zoom.size,
      brush(domain) { for (const fn of [...sets.zoom]) fn(domain as never); },
      chart: {
        zoom(domain) { fake.zooms.push(domain); for (const fn of [...sets.zoom]) fn(domain as never); },
        on<E extends keyof ChartEvents<unknown>>(event: E, fn: (p: ChartEvents<unknown>[E]) => void) {
          const set = sets[event] as Set<(p: never) => void>;
          set.add(fn as never);
          return () => { set.delete(fn as never); };
        },
        destroy() { fake.destroyed = true; log.push(`destroy:${name}`); child.remove(); },
      },
    };
    made.push(fake);
    log.push(`create:${name}`);
    return fake.chart;
  };
  return { made, make };
}

function page() {
  const doc = new TestDocument();
  const target = doc.createElement('section');
  doc.body.appendChild(target);
  return { doc, target };
}

const all = (el: TestElement): TestElement[] => [el, ...el.children.flatMap(all)];

describe('N6 createDashboard', () => {
  it('mounts a labelled CSP-safe grid that stacks below two columns, one panel per factory, in order', () => {
    const { doc, target } = page();
    const log: string[] = [];
    const { make } = fakes(log);
    const d = createDashboard(target as unknown as HTMLElement, [
      { id: 'a', create: make('a') }, { create: make('b') }, { id: 'c', create: make('c') },
    ], { label: 'Service health', minPanelWidth: 320, gap: 12 });
    const root = d.element as unknown as TestElement;
    expect(target.children).toEqual([root]);
    expect(root.getAttribute('role')).toBe('group');
    expect(root.getAttribute('aria-label')).toBe('Service health');
    // One 320 px column fits a 320 px viewport; two need 652 px (two columns and the gap).
    expect(root.style.cssText).toBe('display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));align-items:start');
    expect(all(root).some(e => e.tagName === 'STYLE')).toBe(false);
    expect(d.ids).toEqual(['a', 'panel-1', 'c']);
    expect(root.children.map(e => e.dataset.panel)).toEqual(['a', 'panel-1', 'c']);
    expect(d.group.size).toBe(3);
    expect(log).toEqual(['create:a', 'create:b', 'create:c']);
    d.destroy();
    expect(doc.body.children).toEqual([target]);
  });

  it('shares the x window: zoom and reset reach every panel, a brush on one reaches the others once', () => {
    const { target } = page();
    const { made, make } = fakes([]);
    const d = createDashboard(target as unknown as HTMLElement, ['a', 'b', 'c'].map(id => ({ id, create: make(id), sync: { xKind: 'number' as const } })));
    d.zoom([2, 8]);
    expect(made.map(f => f.zooms)).toEqual([[[2, 8]], [[2, 8]], [[2, 8]]]);
    made[1]!.brush([3, 4]);
    expect(made.map(f => f.zooms.length)).toEqual([2, 1, 2]);
    expect(made[0]!.zooms.at(-1)).toEqual([3, 4]);
    d.reset();
    expect(made.map(f => f.zooms.at(-1))).toEqual([null, null, null]);
    d.destroy();
  });

  it('adds and removes panels; a removed panel leaves no listener, chart or node behind', () => {
    const { target } = page();
    const log: string[] = [];
    const { made, make } = fakes(log);
    const d = createDashboard(target as unknown as HTMLElement, [{ id: 'a', create: make('a') }]);
    expect(d.add({ id: 'b', create: make('b') })).toBe('b');
    expect(d.add({ create: make('c') })).toBe('panel-1');
    expect(d.ids).toEqual(['a', 'b', 'panel-1']);
    expect(d.chart('b')).toBe(made[1]!.chart);
    expect(d.remove('b')).toBe(true);
    expect(d.remove('b')).toBe(false);
    expect(made[1]!.destroyed).toBe(true);
    expect(made[1]!.listeners()).toBe(0);
    expect(d.ids).toEqual(['a', 'panel-1']);
    expect((d.element as unknown as TestElement).children.map(e => e.dataset.panel)).toEqual(['a', 'panel-1']);
    expect(() => d.add({ id: 'a', create: make('dup') })).toThrow(/duplicate dashboard panel "a"/);
    expect(log).not.toContain('create:dup');
    expect(d.group.size).toBe(2);
    d.destroy();
    expect(made.every(f => f.listeners() === 0 && f.destroyed)).toBe(true);
    expect(() => d.add({ create: make('late') })).toThrow(/destroyed/);
    d.destroy();
  });

  it('rolls back in reverse order when a factory throws part-way, leaving the target as it was', () => {
    const { target } = page();
    const before = target.childNodes.length;
    const log: string[] = [];
    const { made, make } = fakes(log);
    const boom = new Error('factory failed');
    expect(() => createDashboard(target as unknown as HTMLElement, [
      { id: 'a', create: make('a') }, { id: 'b', create: make('b') },
      { id: 'c', create: () => { throw boom; } }, { id: 'd', create: make('d') },
    ])).toThrow(boom);
    expect(log).toEqual(['create:a', 'create:b', 'destroy:b', 'destroy:a']);
    expect(made.every(f => f.listeners() === 0)).toBe(true);
    expect(target.childNodes.length).toBe(before);
  });

  it('a chart whose membership fails is destroyed with its panel; the first error is the one thrown', () => {
    const { target } = page();
    const log: string[] = [];
    const { make } = fakes(log);
    const bad = (element: HTMLElement): SyncableChart<unknown> => {
      const chart = make('bad')(element);
      return { ...chart, on() { throw new Error('no events'); } };
    };
    expect(() => createDashboard(target as unknown as HTMLElement, [{ id: 'a', create: make('a') }, { id: 'x', create: bad }])).toThrow('no events');
    expect(log).toEqual(['create:a', 'create:bad', 'destroy:bad', 'destroy:a']);
    expect(target.childNodes.length).toBe(0);
  });

  it('a chart whose second subscription fails rolls back its first subscription even without destroy()', () => {
    const { target } = page();
    const log: string[] = [];
    const { made, make } = fakes(log);
    const hoverListeners = new Set<(p: never) => void>();
    const bad = (): SyncableChart<unknown> => ({
      zoom() {},
      on(event, fn) {
        if (event === 'hover') {
          hoverListeners.add(fn as never);
          return () => { hoverListeners.delete(fn as never); };
        }
        throw new Error('zoom failed');
      },
    });
    expect(() => createDashboard(target as unknown as HTMLElement, [{ id: 'a', create: make('a') }, { id: 'x', create: bad }])).toThrow('zoom failed');
    expect(hoverListeners.size).toBe(0);
    expect(made.every(f => f.destroyed && f.listeners() === 0)).toBe(true);
    expect(target.childNodes.length).toBe(0);
  });

  it('destroy unwinds in reverse order, also when the page disconnected a panel (and its chart) meanwhile', () => {
    const { target } = page();
    const log: string[] = [];
    const { made, make } = fakes(log);
    const d = createDashboard(target as unknown as HTMLElement, ['a', 'b', 'c'].map(id => ({ id, create: make(id) })));
    const panelB = (d.element as unknown as TestElement).children[1]!;
    panelB.remove();
    expect(panelB.isConnected).toBe(false);
    // The whole grid out of the document too.
    (d.element as unknown as TestElement).remove();
    log.length = 0;
    d.destroy();
    expect(log).toEqual(['destroy:c', 'destroy:b', 'destroy:a']);
    expect(made.every(f => f.listeners() === 0)).toBe(true);
    expect(panelB.children).toEqual([]);
    expect(target.childNodes.length).toBe(0);
    expect(d.group.size).toBe(0);
  });

  it('for any sequence of adds, removes and a failing factory, destroy leaves 0/0/0 listeners, charts and owned nodes', () => {
    const op = fc.oneof(
      fc.record({ k: fc.constant('add' as const), fail: fc.boolean() }),
      fc.record({ k: fc.constant('remove' as const), at: fc.nat(6) }),
    );
    fc.assert(fc.property(fc.array(op, { maxLength: 16 }), fc.nat(4), (ops, initial) => {
      const { doc, target } = page();
      const log: string[] = [];
      const { made, make } = fakes(log);
      let n = 0;
      const panel = (fail = false): DashboardPanel<unknown> => {
        const name = `p${n++}`;
        return { id: name, create: fail ? () => { throw new Error(name); } : make(name) };
      };
      const d = createDashboard(target as unknown as HTMLElement, Array.from({ length: initial }, () => panel()));
      const model = d.ids.slice();
      for (const o of ops) {
        if (o.k === 'add') {
          const p = panel(o.fail);
          if (o.fail) expect(() => d.add(p)).toThrow(p.id);
          else { d.add(p); model.push(p.id!); }
        } else if (model.length) {
          const id = model[o.at % model.length]!;
          expect(d.remove(id)).toBe(true);
          model.splice(model.indexOf(id), 1);
        }
        expect(d.ids).toEqual(model);
        expect((d.element as unknown as TestElement).children.length).toBe(model.length);
        expect(d.group.size).toBe(model.length);
      }
      d.destroy();
      expect(made.every(f => f.destroyed && f.listeners() === 0)).toBe(true);
      expect(target.childNodes.length).toBe(0);
      expect(doc.body.children).toEqual([target]);
    }), { numRuns: 80 });
  });

  it('unwinds pending chart and element once in reverse order when add() factory destroys the dashboard', () => {
    const { target } = page();
    const log: string[] = [];
    const { made, make } = fakes(log);
    const d = createDashboard(target as unknown as HTMLElement, [{ id: 'a', create: make('a') }]);
    let pendingEl: TestElement | null = null;
    expect(() => d.add({
      id: 'b',
      create(el) {
        pendingEl = el as unknown as TestElement;
        const chart = make('b')(el);
        d.destroy();
        return chart;
      },
    })).toThrow(/destroyed/);
    expect(log).toEqual(['create:a', 'create:b', 'destroy:a', 'destroy:b']);
    expect(d.ids).toEqual([]);
    expect(d.chart('b')).toBeUndefined();
    expect(d.group.size).toBe(0);
    expect(made.every(f => f.destroyed && f.listeners() === 0)).toBe(true);
    expect((d.element as unknown as TestElement).children).toEqual([]);
    expect(pendingEl!.parentNode).toBeNull();
    expect(target.childNodes.length).toBe(0);
  });

  it('unwinds pending membership, chart and element once in reverse order when attach subscription destroys the dashboard', () => {
    const { target } = page();
    const log: string[] = [];
    const { made, make } = fakes(log);
    const d = createDashboard(target as unknown as HTMLElement, [{ id: 'a', create: make('a') }]);
    const order: string[] = [];
    let pendingEl: TestElement | null = null;
    expect(() => d.add({
      id: 'b',
      create(el) {
        pendingEl = el as unknown as TestElement;
        return {
          zoom() {},
          on(event) {
            if (event === 'hover') return () => { order.push('unsub:hover'); };
            if (event === 'zoom') {
              d.destroy();
              return () => { order.push('unsub:zoom'); };
            }
            return () => {};
          },
          destroy() { order.push('destroy:b'); },
        };
      },
    })).toThrow(/destroyed/);
    // Reverse order: pending zoom unsub, hover unsub, then chart destroy; element removed.
    expect(order).toEqual(['unsub:zoom', 'unsub:hover', 'destroy:b']);
    expect(d.ids).toEqual([]);
    expect(d.chart('b')).toBeUndefined();
    expect(d.group.size).toBe(0);
    expect(made.every(f => f.destroyed && f.listeners() === 0)).toBe(true);
    expect((d.element as unknown as TestElement).children).toEqual([]);
    expect(pendingEl!.parentNode).toBeNull();
    expect(target.childNodes.length).toBe(0);
  });

  it('reserves panel IDs during pending mounts so nested add() of the same ID is rejected and rollback releases the ID', () => {
    const { target } = page();
    const log: string[] = [];
    const { made, make } = fakes(log);
    const d = createDashboard(target as unknown as HTMLElement, [{ id: 'a', create: make('a') }]);

    // Case 1: outer factory reenters add() with the same ID and lets the error propagate -> rolled back & ID released.
    expect(() => d.add({
      id: 'x',
      create() {
        d.add({ id: 'x', create: make('inner') });
        return make('outer')(target as unknown as HTMLElement);
      },
    })).toThrow(/duplicate dashboard panel "x"/);
    expect(log).toEqual(['create:a']);
    expect(d.ids).toEqual(['a']);
    expect((d.element as unknown as TestElement).children.map(e => e.dataset.panel)).toEqual(['a']);
    expect(d.group.size).toBe(1);

    // Case 2: outer factory catches the nested duplicate error and completes -> single 'x' mounted, then remove + re-add works.
    let innerErr: unknown = null;
    expect(d.add({
      id: 'x',
      create(el) {
        try { d.add({ id: 'x', create: make('inner-caught') }); } catch (e) { innerErr = e; }
        return make('x1')(el);
      },
    })).toBe('x');
    expect(innerErr).toBeInstanceOf(Error);
    expect((innerErr as Error).message).toMatch(/duplicate dashboard panel "x"/);
    expect(d.ids).toEqual(['a', 'x']);
    expect(d.chart('x')).toBe(made[1]!.chart);

    expect(d.remove('x')).toBe(true);
    expect(d.ids).toEqual(['a']);
    expect(d.add({ id: 'x', create: make('x2') })).toBe('x');
    expect(d.ids).toEqual(['a', 'x']);
    expect(d.chart('x')).toBe(made[2]!.chart);

    d.destroy();
    expect(made.every(f => f.destroyed && f.listeners() === 0)).toBe(true);
    expect(target.childNodes.length).toBe(0);
  });

  it('a pending panel whose on("hover") emits synchronously before on("zoom") throws leaves existing peer hover state and callback unchanged', () => {
    const { target } = page();
    const log: string[] = [];
    const { made, make } = fakes(log);
    const peerHoverSyncs: (XValue | null)[] = [];
    const d = createDashboard(target as unknown as HTMLElement, [{
      id: 'a',
      create: make('a'),
      sync: { xKind: 'number', onHoverSync: p => { peerHoverSyncs.push(p ? p.x : null); } },
    }]);

    // Establish an existing hover on panel 'a' via manual syncHover at x = 2.
    d.group.syncHover(2, 'seed');
    expect(peerHoverSyncs).toEqual([2]);

    // Review repro: new panel emits hover at x = 1 inside on('hover'), then throws inside on('zoom').
    let badHoverUnsubbed = false;
    let badDestroyed = false;
    expect(() => d.add({
      id: 'b',
      create() {
        return {
          zoom() {},
          on(event, fn) {
            if (event === 'hover') {
              (fn as (p: { series: string; x: XValue; y: number; row: null; index: number }) => void)({
                series: 's', x: 1, y: 10, row: null, index: 0,
              });
              return () => { badHoverUnsubbed = true; };
            }
            throw new Error('zoom subscribe failed');
          },
          destroy() { badDestroyed = true; },
        };
      },
    })).toThrow('zoom subscribe failed');

    expect(badHoverUnsubbed).toBe(true);
    expect(badDestroyed).toBe(true);
    expect(d.ids).toEqual(['a']);
    expect(d.group.size).toBe(1);
    // Existing peer hover callback/state must be untouched (no x = 1 broadcast from the failed mount).
    expect(peerHoverSyncs).toEqual([2]);

    // Even a successful mount whose on('hover') emits synchronously must not cause implicit hover delivery.
    let emitAfterMount: ((p: { series: string; x: XValue; y: number; row: null; index: number } | null) => void) | null = null;
    expect(d.add({
      id: 'c',
      create() {
        return {
          zoom() {},
          on(event, fn) {
            if (event === 'hover') {
              emitAfterMount = fn as typeof emitAfterMount;
              emitAfterMount!({ series: 's', x: 3, y: 30, row: null, index: 0 });
            }
            return () => {};
          },
          destroy() {},
        };
      },
    })).toBe('c');
    expect(peerHoverSyncs).toEqual([2]);
    // Subsequent real hover from 'c' after mount completes broadcasts normally.
    emitAfterMount!({ series: 's', x: 4, y: 40, row: null, index: 1 });
    expect(peerHoverSyncs).toEqual([2, 4]);

    d.destroy();
    expect(made.every(f => f.destroyed && f.listeners() === 0)).toBe(true);
    expect(target.childNodes.length).toBe(0);
  });
});
