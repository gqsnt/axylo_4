/**
 * Regressions for cross-provider review sol-6.2-medium__20261127T174530Z, on the live controller (live.ts), whose
 * real figure, interaction layer and commit order are the shared ones:
 *
 * 1. At a fixed host size, a chart in the L8 fallback whose legend is then turned off or moved converges to the
 *    geometry of a fresh chart opened with that legend. The measure here is geometry-aware: a laid-out legend list
 *    takes 40 px of height in the top/bottom slots and 200 px of width in the side slot.
 * 2. Inside DomInteraction.commit (the focused cell's text formats the value), a formatter finds export and the
 *    painted ticks of the same commit, never one new and the other old.
 *
 * Expected values: layout.ts, a plot under 120 × 80 is too small; ticks are low, midpoint and high of the data.
 */
import { describe, expect, it } from 'vitest';
import type { ControllerCore } from '../../../src/core/controller-types';
import type { Committed } from '../../../src/dom/interaction-types';
import { heatmapInternals, type HeatmapInternals } from '../../../src/spatial/heatmap/chart';
import { TestEvent, type TestElement } from '../../core/n3-dom';
import { grid } from './fixtures';
import { openLive } from './live';

const BASE = { title: 'Load', x: 'c', y: 'r', value: 'v', table: false };
const ROOM = { height: 40, width: 200 };
type Live = ReturnType<typeof openLive>;
// The live controller is the real ChartController, which is also the controller core the handle reads.
const core = (live: Live) => live.controller as unknown as ControllerCore;
const tooSmall = (live: Live) => core(live).drawn?.layout.kind === 'too-small';
const plotSize = (live: Live) => core(live).host.measure();

describe('fixed host size: the fallback converges to what a fresh chart with the changed legend draws', () => {
  // layout.ts reserves its axes around the 80 px plot minimum: 140 px of host height is the least that fits.
  // 720 × 150: with a bottom legend 110 remain (too small); without it, 150 (fits).
  const open = (legend: unknown, size = { width: 720, height: 150 }) =>
    openLive({ ...BASE, legend, data: grid(3, 3, (r, c) => r * 3 + c) }, size, ROOM);

  it('a fresh chart: bottom legend falls back, no legend draws a plot (the reference geometry)', () => {
    const withLegend = open('bottom');
    expect(tooSmall(withLegend)).toBe(true);
    expect(withLegend.shown()).toBeNull();
    withLegend.handle.destroy();
    const without = open(false);
    expect(tooSmall(without)).toBe(false);
    expect(plotSize(without)).toEqual({ width: 720, height: 150 });
    without.handle.destroy();
  });

  it('legend turned off while in the fallback: leaves it, same plot as the fresh chart, and settles', () => {
    const live = open('bottom');
    expect(tooSmall(live)).toBe(true);
    // Too small, the bar keeps its room and is hidden to readers.
    expect(live.laidOut()).not.toBeNull();
    expect(live.shown()).toBeNull();
    expect(live.legend()!.getAttribute('aria-hidden')).toBe('true');
    live.handle.update({ legend: false });
    expect(live.settle()).toBeLessThan(20);
    expect(tooSmall(live)).toBe(false);
    expect(plotSize(live)).toEqual({ width: 720, height: 150 });
    expect(live.legend()).toBeNull();
    // No remeasure oscillation: the next frames change nothing.
    live.controller.invalidate.resize();
    expect(live.settle()).toBeLessThan(20);
    expect(tooSmall(live)).toBe(false);
    // And back on: the fallback again, bar hidden, as a fresh chart with the legend.
    live.handle.update({ legend: 'bottom' });
    live.settle();
    expect(tooSmall(live)).toBe(true);
    expect(live.shown()).toBeNull();
    live.handle.destroy();
  });

  it('legend moved to the side while in the fallback: same geometry as a fresh side-legend chart', () => {
    const fresh = open('right');
    const reference = { small: tooSmall(fresh), size: plotSize(fresh), ticks: fresh.ticks() };
    fresh.handle.destroy();
    // The side legend takes width, not height: 520 × 150 fits.
    expect(reference).toEqual({ small: false, size: { width: 520, height: 150 }, ticks: ['0', '4', '8'] });
    const live = open('bottom');
    expect(tooSmall(live)).toBe(true);
    live.handle.update({ legend: 'right' });
    live.settle();
    expect({ small: tooSmall(live), size: plotSize(live), ticks: live.ticks() }).toEqual(reference);
    live.handle.destroy();
  });

  it('for any legend change sequence at a fixed size, the end state equals a fresh chart with the last legend', () => {
    const placements = [false, 'bottom', 'top', 'right'] as const;
    for (const height of [130, 150, 170, 190]) {
      const fresh = new Map<unknown, unknown>();
      for (const p of placements) {
        const f = open(p, { width: 720, height });
        fresh.set(p, { small: tooSmall(f), size: plotSize(f), shown: f.shown() !== null });
        f.handle.destroy();
      }
      for (const first of placements) for (const last of placements) {
        const live = open(first, { width: 720, height });
        live.handle.update({ legend: last });
        live.settle();
        expect({ small: tooSmall(live), size: plotSize(live), shown: live.shown() !== null }, `${height}: ${String(first)} → ${String(last)}`)
          .toEqual(fresh.get(last));
        expect(live.settle()).toBe(0);
        live.handle.destroy();
      }
    }
  });
});

describe('DomInteraction.commit: a formatter finds export and the painted ticks of one commit', () => {
  it('the focused cell formats during commit: export and the mounted ticks are both old or both new', () => {
    let x: HeatmapInternals | undefined;
    let live: Live | undefined;
    let inCommit = false;
    const observed: { exported: string[] | null; painted: string[] | null; seen: string[] | null }[] = [];
    const format = (v: number): string => {
      if (inCommit && x && live) {
        const list = live.legend();
        observed.push({
          exported: x.legend()?.ticks.map(t => t.label) ?? null,
          painted: list ? list.querySelectorAll('.axylo-heatmap-tick').map(t => t.textContent) : null,
          seen: live.ticks(),
        });
      }
      return `${v}`;
    };
    live = openLive({ ...BASE, data: grid(2, 2, (r, c) => r * 2 + c), value: { field: 'v', format } });
    x = heatmapInternals(live.handle)!;
    expect(live.ticks()).toEqual(['0', '1.5', '3']);
    // Focus a cell so that the interaction layer's commit writes its text (a formatter call) before its controls.
    const proxy = (live.fig.plot as unknown as TestElement).children.find(c => c.id === 'hm-proxy')!;
    expect(proxy).toBeTruthy();
    proxy.focus();
    proxy.dispatchEvent(new TestEvent('focus', { bubbles: false }));
    live.doc.defaultView.flushFrames();
    proxy.dispatchEvent(new TestEvent('keydown', { key: 'End' }));
    live.doc.defaultView.flushFrames();
    expect(proxy.getAttribute('aria-valuetext')).toContain('column 2 of 2');
    const interaction = live.interaction;
    const commit = interaction.commit;
    interaction.commit = (state: Committed | null) => {
      inCommit = true;
      try { commit.call(interaction, state); } finally { inCommit = false; }
    };
    live.handle.update({ data: grid(2, 2, (r, c) => 10 * (r * 2 + c)) });
    live.settle();
    expect(observed.length).toBeGreaterThan(0);
    for (const o of observed) {
      expect(o.painted).toEqual(o.exported);
      if (o.seen) expect(o.seen).toEqual(o.exported);
    }
    expect(live.ticks()).toEqual(['0', '15', '30']);
    live.handle.destroy();
  });

  it('any formatter call, across data, mount, unmount, placement and fallback changes: a seen bar is export\'s', () => {
    let x: HeatmapInternals | undefined;
    let live: Live | undefined;
    let inCommit = false;
    let calls = 0;
    const bad: string[] = [];
    const format = (v: number): string => {
      calls++;
      if (x && live) {
        const exported = x.legend()?.ticks.map(t => t.label) ?? null;
        const seen = live.ticks();
        if (seen !== null && JSON.stringify(seen) !== JSON.stringify(exported)) bad.push(`seen ${String(seen)} / export ${String(exported)}`);
        const list = live.legend();
        if (inCommit && exported !== null && list) {
          const painted = list.querySelectorAll('.axylo-heatmap-tick').map(t => t.textContent);
          if (JSON.stringify(painted) !== JSON.stringify(exported)) bad.push(`in commit: painted ${String(painted)} / export ${String(exported)}`);
        }
      }
      return `${v}`;
    };
    live = openLive({ ...BASE, data: grid(2, 2, (r, c) => r * 2 + c), value: { field: 'v', format } });
    x = heatmapInternals(live.handle)!;
    const interaction = live.interaction;
    const commit = interaction.commit;
    interaction.commit = (state: Committed | null) => {
      inCommit = true;
      try { commit.call(interaction, state); } finally { inCommit = false; }
    };
    const proxy = (live.fig.plot as unknown as TestElement).children.find(c => c.id === 'hm-proxy')!;
    proxy.focus();
    proxy.dispatchEvent(new TestEvent('focus', { bubbles: false }));
    live.doc.defaultView.flushFrames();
    const steps: (() => void)[] = [
      () => live!.handle.update({ data: grid(2, 2, (r, c) => 10 * (r * 2 + c)) }),
      () => live!.handle.update({ legend: false }),
      () => live!.handle.update({ legend: 'bottom', data: grid(2, 2, (r, c) => 100 * (r * 2 + c)) }),
      () => live!.handle.update({ legend: 'right', data: grid(2, 2, (r, c) => r * 2 + c) }),
      () => live!.handle.update({ legend: 'top' }),
      () => { live!.size.width = 100; live!.size.height = 60; live!.controller.invalidate.resize(); },
      () => live!.handle.update({ data: grid(2, 2, (r, c) => 2 * (r * 2 + c)) }),
      () => { live!.size.width = 720; live!.size.height = 420; live!.controller.invalidate.resize(); },
    ];
    for (const step of steps) {
      step();
      live.settle();
    }
    expect(calls).toBeGreaterThan(0);
    expect(bad).toEqual([]);
    expect(live.ticks()).toEqual(['0', '3', '6']);
    live.handle.destroy();
  });

  it('a formatter that destroys the chart inside commit: nothing is repainted or left behind', () => {
    let live: Live | undefined;
    let armed = false;
    const format = (v: number): string => {
      if (armed) { armed = false; live!.handle.destroy(); }
      return `${v}`;
    };
    live = openLive({ ...BASE, data: grid(2, 2, (r, c) => r * 2 + c), value: { field: 'v', format } });
    const x = heatmapInternals(live.handle)!;
    const proxy = (live.fig.plot as unknown as TestElement).children.find(c => c.id === 'hm-proxy')!;
    proxy.focus();
    proxy.dispatchEvent(new TestEvent('focus', { bubbles: false }));
    live.doc.defaultView.flushFrames();
    const interaction = live.interaction;
    const commit = interaction.commit;
    interaction.commit = (state: Committed | null) => { armed = true; try { commit.call(interaction, state); } finally { armed = false; } };
    live.handle.update({ data: grid(2, 2, (r, c) => 10 * (r * 2 + c)) });
    live.settle();
    expect(core(live).destroyed).toBe(true);
    expect(live.legend()).toBeNull();
    expect(x.legend()).toBeNull();
  });
});
