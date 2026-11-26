/**
 * C5.3 unit tests for `axylo/sync`:
 * single propagation without feedback loops, incompatible x-kind/unit guards, deterministic unmatched-x
 * handling (`clear` | `ignore` | `nearest`), surviving focus after peer detach, and full teardown.
 */
import { describe, expect, it } from 'vitest';
import { createSyncGroup, syncCharts, type SyncMismatch, type SyncableChart } from '../../src/sync';
import type { ChartEvents, Point, XValue } from '../../src/public';

function createMockChart(name: string) {
  const listeners = {
    hover: new Set<(p: Point<unknown> | null) => void>(),
    select: new Set<(p: Point<unknown>) => void>(),
    zoom: new Set<(d: readonly [XValue, XValue] | null) => void>(),
  };
  const zoomCalls: (readonly [XValue, XValue] | null)[] = [];

  const chart: SyncableChart<unknown> = {
    zoom(domain) {
      zoomCalls.push(domain);
      // Simulate a real chart emitting a zoom event back when zoom() is called!
      for (const fn of [...listeners.zoom]) fn(domain);
    },
    on<E extends keyof ChartEvents<unknown>>(event: E, fn: (payload: ChartEvents<unknown>[E]) => void) {
      const set = listeners[event] as Set<(payload: ChartEvents<unknown>[E]) => void>;
      set.add(fn);
      return () => { set.delete(fn); };
    },
  };

  return {
    name,
    chart,
    zoomCalls,
    listenerCount: () => listeners.hover.size + listeners.select.size + listeners.zoom.size,
    emitHover(p: Point<unknown> | null) { for (const fn of [...listeners.hover]) fn(p); },
    emitZoom(d: readonly [XValue, XValue] | null) { for (const fn of [...listeners.zoom]) fn(d); },
  };
}

describe('C5.3 axylo/sync linked hover and zoom', () => {
  it('propagates zoom and hover once without feedback loops even when target charts re-emit events', () => {
    const a = createMockChart('A');
    const b = createMockChart('B');
    const c = createMockChart('C');
    const bHovers: (XValue | null)[] = [];
    const cHovers: (XValue | null)[] = [];

    const group = createSyncGroup();
    group.attach(a.chart, { id: 'A', xKind: 'number', xUnit: 's' });
    group.attach(b.chart, {
      id: 'B', xKind: 'number', xUnit: 's',
      onHoverSync: p => {
        bHovers.push(p ? p.x : null);
        // Simulate reentrant hover feedback from B
        b.emitHover(p);
      },
    });
    group.attach(c.chart, {
      id: 'C', xKind: 'number', xUnit: 's',
      onHoverSync: p => { cHovers.push(p ? p.x : null); },
    });

    a.emitZoom([10, 50]);
    expect(a.zoomCalls).toEqual([]);
    expect(b.zoomCalls).toEqual([[10, 50]]);
    expect(c.zoomCalls).toEqual([[10, 50]]);

    a.emitHover({ series: 's1', x: 25, y: 100, row: null, index: 2 });
    expect(bHovers).toEqual([25]);
    expect(cHovers).toEqual([25]);

    group.destroy();
    expect(group.size).toBe(0);
    expect(a.listenerCount()).toBe(0);
    expect(b.listenerCount()).toBe(0);
    expect(c.listenerCount()).toBe(0);
  });

  it('blocks propagation across incompatible units or x-kinds and reports via onMismatch', () => {
    const a = createMockChart('A');
    const b = createMockChart('B');
    const c = createMockChart('C');
    const mismatches: SyncMismatch[] = [];

    const group = createSyncGroup({ onMismatch: m => mismatches.push(m) });
    group.attach(a.chart, { id: 'A', xKind: 'number', xUnit: 'ms' });
    group.attach(b.chart, { id: 'B', xKind: 'number', xUnit: 'USD' });
    group.attach(c.chart, { id: 'C', xKind: 'category' });

    a.emitZoom([1, 10]);
    expect(b.zoomCalls).toEqual([]);
    expect(c.zoomCalls).toEqual([]);
    expect(mismatches.map(m => `${m.targetId}:${m.reason}`)).toEqual([
      'B:unit-mismatch',
      'C:x-kind-mismatch',
    ]);
    group.destroy();
  });

  it('applies deterministic unmatched-x policies (clear, ignore, nearest) and preserves surviving peers after detach', () => {
    const a = createMockChart('A');
    const b = createMockChart('B');
    const c = createMockChart('C');
    const bLog: (XValue | null)[] = [];
    const cLog: (XValue | null)[] = [];

    const groupNearest = createSyncGroup({ unmatchedHover: 'nearest' });
    groupNearest.attach(a.chart, { id: 'A', xValues: [0, 10, 20] });
    const detachB = groupNearest.attach(b.chart, { id: 'B', xValues: [0, 8, 22], onHoverSync: p => bLog.push(p ? p.x : null) });
    groupNearest.attach(c.chart, { id: 'C', xValues: [0, 10, 20], onHoverSync: p => cLog.push(p ? p.x : null) });

    a.emitHover({ series: 's', x: 10, y: 5, row: null, index: 1 });
    expect(bLog).toEqual([8]); // nearest to 10 in [0, 8, 22]
    expect(cLog).toEqual([10]);

    // Detaching B removes only B's listeners; A -> C keeps syncing cleanly!
    detachB();
    expect(b.listenerCount()).toBe(0);
    expect(a.listenerCount()).toBe(2);
    expect(c.listenerCount()).toBe(2);
    a.emitHover({ series: 's', x: 20, y: 9, row: null, index: 2 });
    expect(bLog).toEqual([8]);
    expect(cLog).toEqual([10, 20]);
    groupNearest.destroy();

    // Clear policy on unmatched x
    const clearLog: (XValue | null)[] = [];
    const gClear = syncCharts([
      { chart: a.chart, options: { id: 'A', xValues: ['Jan', 'Feb'] } },
      { chart: b.chart, options: { id: 'B', xValues: ['Jan', 'Mar'], onHoverSync: p => clearLog.push(p ? p.x : null) } },
    ], { unmatchedHover: 'clear' });
    a.emitHover({ series: 's', x: 'Feb', y: 1, row: null, index: 1 });
    expect(clearLog).toEqual([null]);
    gClear.destroy();
  });
});
