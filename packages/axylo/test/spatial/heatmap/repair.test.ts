/**
 * Regressions for the two blockers of cross-provider review sol-6.2-medium__20261127T172920Z, on a controller that
 * drives the real figure and interaction layer (live.ts):
 *
 * 1. With `table: false` the interaction layer's control cache does not call the slice list when only readiness or
 *    size change; the color bar must still be seen exactly when the chart is ready, fits and has the legend on.
 * 2. One legend model per commit, shared by the page and export: export never formats, inside a formatter it is
 *    the previous commit's, and superseded or rejected attempts never reach the page or export.
 *
 * Expected values come from the fixtures and the rules in legend.ts / chart.ts (ticks: low, midpoint, high of the
 * data range), not from a run.
 */
import { describe, expect, it } from 'vitest';
import { StrictError } from '../../../src/core/delivery';
import { heatmapInternals, type HeatmapInternals } from '../../../src/spatial/heatmap/chart';
import { grid } from './fixtures';
import { openLive } from './live';

const BASE = { title: 'Load', x: 'c', y: 'r', value: 'v', table: false };
const labels = (x: HeatmapInternals) => x.legend()?.ticks.map(t => t.label) ?? null;

describe('blocker 1: the color bar is seen exactly when the chart is ready and fits (table: false)', () => {
  it('initially loading, then ready: the bar appears with the committed ticks', () => {
    const live = openLive({ ...BASE, state: 'loading', data: grid(2, 2, (r, c) => r * 2 + c) });
    const x = heatmapInternals(live.handle)!;
    expect(live.shown()).toBeNull();
    expect(x.legend()).toBeNull();
    // Hidden, the slot takes no room: neither the list nor a slot holding only it is displayed.
    const list = live.legend();
    if (list) {
      expect(list.hidden).toBe(true);
      expect(list.style['display']).toBe('none');
      expect(list.parentElement?.hidden ?? true).toBe(true);
    }
    live.handle.update({ state: undefined });
    live.settle();
    expect(live.ticks()).toEqual(['0', '1.5', '3']);
    expect(live.ticks()).toEqual(labels(x));
    expect(live.shown()!.style['display']).toBe('flex');
    live.handle.destroy();
  });

  it('ready, loading and ready again: hidden while loading, back with the same ticks', () => {
    const live = openLive({ ...BASE, data: grid(2, 2, (r, c) => r * 2 + c) });
    const x = heatmapInternals(live.handle)!;
    expect(live.ticks()).toEqual(['0', '1.5', '3']);
    live.handle.update({ state: 'loading' });
    live.settle();
    expect(live.shown()).toBeNull();
    expect(x.legend()).toBeNull();
    live.handle.update({ state: undefined });
    live.settle();
    expect(live.ticks()).toEqual(['0', '1.5', '3']);
    expect(live.ticks()).toEqual(labels(x));
    // An error state hides it too.
    live.handle.update({ state: { error: 'Broken' } });
    live.settle();
    expect(live.shown()).toBeNull();
    live.handle.update({ state: undefined, data: grid(1, 2, (_r, c) => c * 10) });
    live.settle();
    expect(live.ticks()).toEqual(['0', '5', '10']);
    live.handle.destroy();
  });

  it('resized below the plot minimum and back: hidden in the fallback, seen again, and the frames settle', () => {
    const live = openLive({ ...BASE, data: grid(3, 3, (r, c) => r * 3 + c) });
    const x = heatmapInternals(live.handle)!;
    expect(live.ticks()).toEqual(['0', '4', '8']);
    // layout.ts: a plot under 120 × 80 is too small (L8).
    expect(live.resize(100, 60)).toBeLessThan(20);
    expect(live.shown()).toBeNull();
    // Too small, it keeps its room (repair.test 'fixed host size') but no reader finds it.
    expect(live.legend()?.getAttribute('aria-hidden') ?? 'true').toBe('true');
    // Too small for the bar: export still has the scale (chart.ts policy).
    expect(labels(x)).toEqual(['0', '4', '8']);
    expect(live.settle()).toBe(0);
    expect(live.resize(720, 420)).toBeLessThan(20);
    expect(live.ticks()).toEqual(['0', '4', '8']);
    expect(live.settle()).toBe(0);
    live.handle.destroy();
  });

  it('legend: false and back, in every placement: released, then mounted where asked, with the committed ticks', () => {
    const live = openLive({ ...BASE, data: grid(2, 2, (r, c) => r * 2 + c) });
    const x = heatmapInternals(live.handle)!;
    for (const placement of ['top', 'right', 'bottom', 'auto'] as const) {
      live.handle.update({ legend: false });
      live.settle();
      expect(live.legend()).toBeNull();
      expect(x.legend()).toBeNull();
      live.handle.update({ legend: placement });
      live.settle();
      expect(live.ticks()).toEqual(['0', '1.5', '3']);
      expect(live.ticks()).toEqual(labels(x));
      const slot = live.shown()!.parentElement!;
      if (placement === 'top') expect(slot.className).toContain('controls-top');
      if (placement === 'right') expect(slot.className).toContain('controls-side');
    }
    // Off while loading, on again once ready.
    live.handle.update({ legend: false, state: 'loading' });
    live.settle();
    live.handle.update({ legend: 'bottom' });
    live.settle();
    expect(live.shown()).toBeNull();
    live.handle.update({ state: undefined });
    live.settle();
    expect(live.ticks()).toEqual(['0', '1.5', '3']);
    live.handle.destroy();
    expect(live.legend()).toBeNull();
    expect(x.legend()).toBeNull();
  });
});

/** A formatter whose output changes with every call (a unit toggled elsewhere, a counter, a clock). */
function stateful() {
  const state = { calls: 0, unit: 'C' };
  const format = (v: number): string => {
    state.calls++;
    return `${v} ${state.unit}`;
  };
  return { state, format };
}

describe('blocker 2: one legend model per commit, shared by the page and export', () => {
  it('a stateful formatter: export is the exact object the page shows, and export never formats', () => {
    const f = stateful();
    const live = openLive({ ...BASE, data: grid(1, 2, (_r, c) => c * 10), value: { field: 'v', format: f.format } });
    const x = heatmapInternals(live.handle)!;
    // From now on every call would say Fahrenheit: only what was formatted for the commit may be shown or exported.
    f.state.unit = 'F';
    const calls = f.state.calls;
    const model = x.legend()!;
    expect(model.ticks.map(t => t.label)).toEqual(['0 C', '5 C', '10 C']);
    expect(live.ticks()).toEqual(['0 C', '5 C', '10 C']);
    for (let i = 0; i < 5; i++) expect(x.legend()).toBe(model);
    expect(f.state.calls).toBe(calls);
    // Visibility toggles that keep view and formatters reuse the committed model (same object); reading export
    // in any of these states formats nothing (other readings, such as the fallback summary, may format).
    const read = () => { const n = f.state.calls; const m = x.legend(); expect(f.state.calls).toBe(n); return m; };
    live.handle.update({ state: 'loading' });
    live.settle();
    expect(read()).toBeNull();
    live.handle.update({ state: undefined });
    live.settle();
    expect(read()).toBe(model);
    live.resize(100, 60);
    expect(read()).toBe(model);
    live.handle.update({ legend: false });
    live.settle();
    expect(read()).toBeNull();
    live.handle.update({ legend: 'bottom' });
    live.resize(720, 420);
    expect(read()).toBe(model);
    expect(live.ticks()).toEqual(['0 C', '5 C', '10 C']);
    live.handle.destroy();
  });

  it('a formatter that reads export while it formats gets the previous commit, without recursion', () => {
    let x: HeatmapInternals | undefined;
    const seen: (string[] | null)[] = [];
    let depth = 0;
    const format = (v: number): string => {
      depth++;
      expect(depth).toBe(1);
      // 50 is the new bar's midpoint and no cell's value: only the color bar formats it, before it commits.
      if (x && v === 50) seen.push(labels(x));
      depth--;
      return `${v}%`;
    };
    const live = openLive({ ...BASE, data: grid(1, 2, (_r, c) => c * 10), value: { field: 'v', format } });
    x = heatmapInternals(live.handle)!;
    const first = x.legend()!;
    expect(first.ticks.map(t => t.label)).toEqual(['0%', '5%', '10%']);
    seen.length = 0;
    live.handle.update({ data: grid(1, 2, (_r, c) => c * 100) });
    live.settle();
    expect(seen.length).toBeGreaterThan(0);
    // Every read inside the bar's formatting for this redraw saw the committed (previous) revision.
    for (const s of seen) expect(s).toEqual(['0%', '5%', '10%']);
    expect(labels(x)).toEqual(['0%', '50%', '100%']);
    expect(live.ticks()).toEqual(['0%', '50%', '100%']);
    live.handle.destroy();
  });

  it('a rejected strict update publishes nothing and changes no visible tick', () => {
    const f = stateful();
    const live = openLive({ ...BASE, strict: true, data: grid(1, 2, (_r, c) => c * 10), value: { field: 'v', format: f.format } });
    const x = heatmapInternals(live.handle)!;
    const model = x.legend()!;
    f.state.unit = 'F';
    expect(() => live.handle.update({ data: grid(1, 2, () => Infinity) })).toThrow(StrictError);
    expect(() => live.handle.update({ color: { domain: [5, 1] } })).toThrow(StrictError);
    live.settle();
    expect(x.legend()).toBe(model);
    expect(live.ticks()).toEqual(['0 C', '5 C', '10 C']);
    live.handle.destroy();
  });

  it('a formatter that replaces the data while it formats the bar: after every frame the page and export agree, on the last data', () => {
    let replaced = false;
    let handle: ReturnType<typeof openLive>['handle'] | null = null;
    const format = (v: number): string => {
      if (handle && !replaced && v === 50) {
        replaced = true;
        handle.update({ data: grid(1, 2, (_r, c) => c * 1000) });
      }
      return `${v} u`;
    };
    const live = openLive({ ...BASE, data: grid(1, 2, (_r, c) => c * 10), value: { field: 'v', format } });
    handle = live.handle;
    const x = heatmapInternals(live.handle)!;
    live.handle.update({ data: grid(1, 2, (_r, c) => c * 100) });
    for (let round = 0; round < 20; round++) {
      const ran = live.rec.frames(1);
      live.root.ownerDocument.defaultView.flushFrames();
      // Whatever revision a frame commits, the page shows what export returns.
      expect(live.ticks()).toEqual(labels(x));
      if (!ran) break;
    }
    expect(replaced).toBe(true);
    expect(live.ticks()).toEqual(['0 u', '500 u', '1000 u']);
    live.handle.destroy();
  });

  it('a formatter that destroys the chart while formatting the bar leaves nothing behind', () => {
    let handle: ReturnType<typeof openLive>['handle'] | null = null;
    const format = (v: number): string => {
      if (handle && v === 50) handle.destroy();
      return `${v}`;
    };
    const live = openLive({ ...BASE, data: grid(1, 2, (_r, c) => c * 10), value: { field: 'v', format } });
    handle = live.handle;
    const x = heatmapInternals(live.handle)!;
    live.handle.update({ data: grid(1, 2, (_r, c) => c * 100) });
    live.settle();
    expect(x.legend()).toBeNull();
    expect(x.table()).toBeNull();
    expect(live.legend()).toBeNull();
  });
});
