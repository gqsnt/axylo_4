/**
 * Findings 7, 9 and 20 of the interaction review (reviews/2026-11-18/impl/wp/core2.review.md) in the pure
 * parts: keyboard order and value text against the lookup, zoom limits, and the layout key's axis titles.
 * Views come from the real controller (test/core/host.ts), so they are the views a chart draws.
 */
import { describe, expect, it } from 'vitest';
import type { AlignedView, DatumRef, ScatterView } from '../../src/core/contracts';
import fc from 'fast-check';
import { canZoomIn, minimumWidth, stepAcross, stepInSeries, valueText, zoomApplies, zoomStep } from '../../src/core/focus';
import { layoutKey, type AxisContext } from '../../src/core/axes';
import { resolveOptions } from '../../src/data';
import { DiagnosticCollector } from '../../src/diagnostics';
import { defaultMessages } from '../../src/messages';
import { record } from './host';

function drawn(kind: Parameters<typeof record>[0], options: Record<string, unknown>) {
  const r = record(kind, { title: 'T', ...options });
  r.frames();
  const c = r.committed!;
  return { r, view: c.view, lookup: c.lookup, formatters: c.formatters };
}

describe('finding 7: the keyboard reaches what the pointer reaches, and reads what the tooltip reads', () => {
  it('an x observed only by a hidden series is a place of its own, read "No observation", as the lookup counts it', () => {
    const data = [{ x: 0, s: 'A', y: 1 }, { x: 1, s: 'B', y: 5 }, { x: 2, s: 'A', y: 3 }];
    const { r } = drawn('line', { data, x: 'x', y: 'y', series: 's' });
    r.controller.actions.toggle('B');
    r.frames();
    const { view, lookup, formatters } = r.committed!;
    expect(lookup.count).toBe(3);
    expect(stepAcross(view as AlignedView, 0, 'next')).toBe(1);
    const at1 = valueText(view, lookup, { kind: 'aligned', seriesKey: 'A', x: 1 }, 'all', formatters, defaultMessages);
    expect(at1).toBe('1. A No observation. Point 2 of 3');
  });

  it('a stacked area reads its total; an incomplete stack says "incomplete" once, with the total', () => {
    const complete = drawn('area', { stacked: true, data: [{ x: 0, s: 'a', y: 2 }, { x: 0, s: 'b', y: 3 }, { x: 1, s: 'a', y: 1 }, { x: 1, s: 'b', y: 1 }], x: 'x', y: 'y', series: 's' });
    const ref: DatumRef = { kind: 'aligned', seriesKey: 'a', x: 0 };
    expect(valueText(complete.view, complete.lookup, ref, 'all', complete.formatters, defaultMessages))
      .toBe('0. a 2; b 3; Total 5. Point 1 of 2');
    const gap = drawn('area', { stacked: true, data: [{ x: 0, s: 'a', y: 2 }, { x: 0, s: 'b', y: null }, { x: 1, s: 'a', y: 1 }, { x: 1, s: 'b', y: 1 }], x: 'x', y: 'y', series: 's' });
    const text = valueText(gap.view, gap.lookup, ref, 'all', gap.formatters, defaultMessages)!;
    expect(text.match(/incomplete/g)?.length).toBe(1);
    expect(text).toContain('Total 2 (incomplete)');
  });

  it('on scatter, after switching series, Right stays in that series', () => {
    const data = [{ x: 0, s: 'A', y: 0 }, { x: 1, s: 'B', y: 1 }, { x: 2, s: 'A', y: 2 }, { x: 3, s: 'B', y: 3 }, { x: 4, s: 'A', y: 4 }];
    const { view, lookup } = drawn('scatter', { data, x: 'x', y: 'y', series: 's' });
    const b1: DatumRef = { kind: 'point', seriesKey: 'B', row: 1, x: 1 };
    expect(lookup.datum(b1)?.seriesLabel).toBe('B');
    const next = stepInSeries(view as ScatterView, b1, 'next');
    expect(next).toEqual({ kind: 'point', seriesKey: 'B', row: 3, x: 3 });
    expect(stepInSeries(view as ScatterView, next!, 'next')).toBeNull();
    expect(stepInSeries(view as ScatterView, b1, 'previous')).toBeNull();
  });
});

describe('finding 9: one minimum window for every gesture, and no exhausted control that does nothing', () => {
  it('two or three aligned positions cannot be zoomed in, so Zoom in is not offered as working', () => {
    for (const xs of [[0, 100], [0, 50, 100]]) {
      const { view } = drawn('line', { data: xs.map(x => ({ x, y: x })), x: 'x', y: 'y' });
      expect(canZoomIn(view, view.kind === 'donut' ? [0, 0] : view.xDomain), String(xs)).toBe(false);
    }
    const { view } = drawn('line', { data: [0, 25, 50, 75, 100].map(x => ({ x, y: x })), x: 'x', y: 'y' });
    expect(canZoomIn(view, [0, 100])).toBe(true);
  });

  it('a window is always strictly ordered and finite, even where doubles are coarse', () => {
    // Doubles near 1e16 are 2 apart and the smallest window is 64 ulps-scale wide (about 142): a range of 4096
    // narrows a few times, then stops.
    const { view } = drawn('scatter', { data: [0, 1024, 2048, 3072, 4096].map(i => ({ x: 1e16 + i, y: i })), x: 'x', y: 'y' });
    if (view.kind !== 'scatter') throw new Error('scatter');
    let window: readonly [number, number] = view.xDomain;
    // Interaction review part 3: the first step is a known representable narrowing, so the loop cannot end
    // before its first assertion.
    const first = zoomStep(view.xFull, window, 0.5, (window[0] + window[1]) / 2, minimumWidth(view));
    expect(first).not.toBeUndefined();
    expect(first).not.toBeNull();
    let steps = 0;
    for (let next = first; next; next = zoomStep(view.xFull, window, 0.5, (window[0] + window[1]) / 2, minimumWidth(view))) {
      expect(Number.isFinite(next[0]) && Number.isFinite(next[1])).toBe(true);
      expect(next[1]).toBeGreaterThan(next[0]);
      expect(next[1] - next[0]).toBeLessThan(window[1] - window[0]);
      window = next;
      steps += 1;
      if (steps > 64) throw new Error('zoom in did not reach its minimum');
    }
    // Exhausted: no narrower window, and the control says so.
    expect(canZoomIn(view, window)).toBe(false);
  });

  it('a zoom-in step never widens and a zoom-out step never narrows (interaction review, new item 7)', () => {
    const { view } = drawn('line', { data: Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: i })), x: 'x', y: 'y' });
    if (view.kind === 'donut') throw new Error('line');
    // The reviewer's case: a public window [40, 45] below the gesture minimum (20).
    expect(minimumWidth(view)).toBe(20);
    expect(zoomStep(view.xFull, [40, 45], 0.5, 42.5, minimumWidth(view))).toBeUndefined();
    expect(canZoomIn(view, [40, 45])).toBe(false);
    fc.assert(fc.property(fc.double({ min: 0, max: 99, noNaN: true }), fc.double({ min: 0.001, max: 100, noNaN: true }),
      fc.double({ min: 0.25, max: 4, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (a, w, factor, share) => {
        fc.pre(a + w <= 100 && factor !== 1);
        const current: [number, number] = [a, a + w];
        const next = zoomStep(view.xFull, current, factor, a + share * w, minimumWidth(view));
        if (next === undefined) return;
        if (factor < 1) {
          expect(next).not.toBeNull();
          expect(next![1] - next![0]).toBeLessThan(w);
        } else if (next !== null) {
          expect(next[1] - next[0]).toBeGreaterThan(w);
        }
      }));
  });

  it('category bars do not zoom (spec 3.6)', () => {
    const rows = ['a', 'b', 'c', 'd'].map((k, i) => ({ k, v: i }));
    expect(zoomApplies(drawn('bar', { data: rows, x: 'k', y: 'v' }).view, undefined)).toBe(false);
  });
});

describe('finding 20: the layout key holds the axis titles it draws', () => {
  it('changing only the second series unit changes the shared unit, so the key changes', () => {
    const data = [{ d: 1, a: 1, b: 2 }, { d: 2, a: 3, b: 4 }];
    const key = (units: [string, string]) => {
      const options = { data, x: 'd', y: [{ field: 'a', unit: units[0] }, { field: 'b', unit: units[1] }] };
      const { view } = drawn('line', options);
      const ctx: AxisContext = {
        resolved: resolveOptions('line', options, new DiagnosticCollector()), locale: 'en-US', compact: false,
        onFormatterError: () => {}, xLabelGiven: false, valueTitle: 'Value',
      };
      return layoutKey(view, { width: 600, height: 300 }, { font: '12px a', letterSpacing: 0, wordSpacing: 0, lineHeight: 15 }, 0, ctx);
    };
    const before = key(['ms', 'ms']);
    const after = key(['ms', 's']);
    expect(before.includes('Value (ms)')).toBe(true);
    expect(after.includes('Value')).toBe(true);
    expect(after.includes('Value (ms)')).toBe(false);
  });
});
