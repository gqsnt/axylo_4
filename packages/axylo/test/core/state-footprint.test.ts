/**
 * Targeted tests for per-chart state overhead reductions:
 * - core/controller.ts: compact charts skip the lookup stage until promoted to full; lazy collections
 *   (listeners, diagnostics, streaming metadata) work across create, stream, events, and destroy.
 * - core/environment.ts: createMeasurer caches one shared TextMeasurer per Document; watchEnvironment
 *   shares window listeners without extra wrapper closures and tears down cleanly when subscribers reach zero.
 * - theme/watch.ts: watchTheme rolls back media listeners if tree observation throws and stays idempotent on stop.
 */
import { describe, expect, it, vi } from 'vitest';
import { createMeasurer, watchEnvironment } from '../../src/core/environment';
import { watchTheme } from '../../src/theme/watch';
import { record } from './host';

describe('core/controller.ts: compact lookup skip and lazy collections', () => {
  it('skips the lookup stage on compact charts and builds real lookup immediately when promoted to compact: false', () => {
    const r = record('line', {
      title: 'Spark',
      compact: true,
      data: [{ x: 0, y: 10 }, { x: 1, y: 20 }, { x: 2, y: 15 }],
      x: 'x',
      y: 'y',
    });
    r.frames();
    expect(r.controller.handle.__dev!.stages().lookup ?? 0).toBe(0);

    // Updating data while staying compact still never runs the lookup stage.
    r.controller.handle.update({ data: [{ x: 0, y: 5 }, { x: 1, y: 12 }, { x: 2, y: 8 }] });
    r.frames();
    expect(r.controller.handle.__dev!.stages().lookup ?? 0).toBe(0);

    // Promoting compact: true -> false immediately runs lookup and exposes working datum resolution.
    r.controller.handle.update({ compact: false });
    r.frames();
    expect(r.controller.handle.__dev!.stages().lookup).toBe(1);
    const first = r.committed!.lookup.step(null, 'first');
    expect(first).not.toBeNull();
    expect(r.committed!.lookup.datum(first!)?.value).toBe('5');

    // Downgrading back to compact skips lookup on subsequent updates.
    r.controller.handle.update({ compact: true });
    r.frames();
    expect(r.controller.handle.__dev!.stages().lookup).toBe(1);
    r.controller.handle.update({ data: [{ x: 0, y: 1 }, { x: 1, y: 2 }] });
    r.frames();
    expect(r.controller.handle.__dev!.stages().lookup).toBe(1);

    r.controller.handle.destroy();
  });

  it('handles clean streaming, lazy event listeners, unsubscribe after destroy, and clean diagnostics', () => {
    const r = record('line', {
      title: 'Stream',
      data: [{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 3 }],
      x: 'x',
      y: 'y',
    });
    r.frames();
    expect(r.controller.handle.diagnostics).toEqual([]);

    // Stream with keep window; no listeners attached yet.
    for (let i = 3; i < 12; i++) {
      r.controller.handle.append([{ x: i, y: i * 2 }], { keep: 5 });
      r.frames();
    }
    expect(r.controller.handle.diagnostics).toEqual([]);
    expect(r.committed!.view.kind).toBe('line');
    if (r.committed!.view.kind === 'line') {
      expect(r.committed!.view.frame.length).toBe(5);
    }

    // Lazily subscribe to select, fire it, then destroy and call unsubscribe safely.
    const selected: number[] = [];
    const off = r.controller.handle.on('select', point => selected.push(Number(point.x)));
    const first = r.committed!.lookup.step(null, 'first')!;
    r.controller.actions.select(first);
    expect(selected).toEqual([7]);

    r.controller.handle.destroy();
    expect(() => off()).not.toThrow();
    expect(r.controller.handle.diagnostics).toEqual([]);
  });
});

describe('core/environment.ts: cached TextMeasurer and lean watchEnvironment', () => {
  it('returns one shared TextMeasurer per Document and distinct instances across Documents', () => {
    const makeDoc = () => ({ createElement: () => ({ getContext: () => null }) }) as unknown as Document;
    const docA = makeDoc();
    const docB = makeDoc();
    const m1 = createMeasurer(docA);
    const m2 = createMeasurer(docA);
    const m3 = createMeasurer(docB);
    expect(m1).toBe(m2);
    expect(m1).not.toBe(m3);
  });

  it('stores handlers without wrapper closures, handles duplicate handler objects, and tears down matchMedia on last stop', () => {
    const listeners = new Map<string, Set<(e: Event) => void>>();
    let matchMediaCalls = 0;
    const makeMql = (q: string) => {
      const set = new Set<(e: Event) => void>();
      listeners.set(q, set);
      return {
        addEventListener: (_: string, fn: (e: Event) => void) => set.add(fn),
        removeEventListener: (_: string, fn: (e: Event) => void) => set.delete(fn),
      };
    };
    const fontListeners = new Set<(e: Event) => void>();
    const win = {
      devicePixelRatio: 1,
      matchMedia: (q: string) => { matchMediaCalls++; return makeMql(q); },
      document: {
        fonts: {
          addEventListener: (_: string, fn: (e: Event) => void) => fontListeners.add(fn),
          removeEventListener: (_: string, fn: (e: Event) => void) => fontListeners.delete(fn),
        },
      },
    } as unknown as Window;

    const h1 = { pixelRatio: vi.fn(), motion: vi.fn(), fonts: vi.fn() };
    const stop1 = watchEnvironment(win, h1);
    const stop2 = watchEnvironment(win, h1); // duplicate object reference must still be independent
    expect(matchMediaCalls).toBe(2);

    // Fire motion change -> both subscriptions receive it.
    for (const fn of listeners.get('(prefers-reduced-motion: reduce)')!) fn(new Event('change'));
    expect(h1.motion).toHaveBeenCalledTimes(2);

    // Stopping first leaves second active and does not tear down window listeners yet.
    stop1();
    stop1(); // idempotent
    for (const fn of listeners.get('(prefers-reduced-motion: reduce)')!) fn(new Event('change'));
    expect(h1.motion).toHaveBeenCalledTimes(3);

    // Stopping second tears down all window listeners; re-attaching calls matchMedia anew.
    stop2();
    expect(listeners.get('(prefers-reduced-motion: reduce)')!.size).toBe(0);
    expect(fontListeners.size).toBe(0);

    const stop3 = watchEnvironment(win, { pixelRatio: vi.fn(), motion: vi.fn(), fonts: vi.fn() });
    expect(matchMediaCalls).toBe(4);
    stop3();
  });
});

describe('theme/watch.ts: rollback and idempotent teardown', () => {
  it('releases media listeners when MutationObserver.observe throws and stays idempotent on stop', () => {
    const activeMedia = new Set<unknown>();
    let shouldThrow = true;
    const win = {
      matchMedia: () => ({
        addEventListener: (_: string, fn: unknown) => activeMedia.add(fn),
        removeEventListener: (_: string, fn: unknown) => activeMedia.delete(fn),
      }),
      MutationObserver: class {
        observe() {
          if (shouldThrow) throw new Error('observe failed');
        }
        disconnect() {}
      },
    };
    const doc = { defaultView: win, documentElement: { nodeType: 1 } };
    const el = {
      ownerDocument: doc,
      parentNode: null,
      parentElement: null,
      assignedSlot: null,
      getAttribute: () => null,
    } as unknown as Element;

    expect(() => watchTheme(el, () => {})).toThrow('observe failed');
    expect(activeMedia.size).toBe(0);

    shouldThrow = false;
    const onChange = vi.fn();
    const stop = watchTheme(el, onChange);
    expect(activeMedia.size).toBe(1);
    stop();
    stop(); // idempotent
    expect(activeMedia.size).toBe(0);
  });
});
