/**
 * N7a: split price/volume panes, exact explicit price domain, wired axis labels, pane clipping, semantic
 * paints, dense OHLCV pixel-bin aggregation, and strict rollback through the real controller.
 *
 * Expected values come from the fixtures and the stated layout rules (8% price padding, ~72/5/23 split,
 * nice volume ticks of at most three), never from a previous run.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { controllerFor } from '../../src/core/controller';
import type { Mark, RuleMark, Scene } from '../../src/core/contracts';
import { createFormatters } from '../../src/format';
import { defaultMessages } from '../../src/messages';
import { aggregateOhlcv, BIN_WIDTH, denseThreshold } from '../../src/finance/aggregate';
import { openFinanceChart, type FinanceHandle } from '../../src/finance/chart';
import { NEUTRAL_PRICE_DOMAIN } from '../../src/finance/core';
import { financeLayout, financePanes, volumeTicks, type FinancePanes } from '../../src/finance/layout';
import { svgRendererWith } from '../../src/render/svg';
import {
  createFinanceLookup, createFinanceOverlay, DOWN_PAINT, financeBindings, financeSvgMarks, paneOf, UP_PAINT, VOLUME_PAINT,
} from '../../src/finance/render';
import {
  BASE_ROWS, baseOptions, bottomOf, FakeElement, fakeDocument, measurer, overlaps, pathsOf, plotOf, rectBoxes, rectsOf, stage, style,
  textsOf, yDomain, yRange, ys, type Staged,
} from './fixtures';
import { record, type Recording } from './host';

describe('N7a price pane', () => {
  it('fits the automatic domain to drawable visible candles only, with 8% padding and no volume stretch', () => {
    const { view, layout, panes } = stage(baseOptions());
    // Drawable candles: rows 0, 1, 2, 4 (row 3 is AX180). Lows 98..101, highs 105..112: [98, 112], pad 1.12.
    expect(view.yDomain[0]).toBeCloseTo(96.88, 9);
    expect(view.yDomain[1]).toBeCloseTo(113.12, 9);
    expect(yDomain(layout)).toEqual(view.yDomain);
    // The price scale maps the domain onto the price pane, not the whole plot.
    expect(yRange(layout)).toEqual([bottomOf(panes.price), panes.price.y]);
    for (const tick of layout.kind === 'plot' ? layout.yTicks : []) {
      expect(tick.value).toBeGreaterThanOrEqual(view.yDomain[0]);
      expect(tick.value).toBeLessThanOrEqual(view.yDomain[1]);
    }
  });

  it('keeps an explicit yAxis.domain exactly, also on a zoomed view', () => {
    const opts = baseOptions({ yAxis: { unit: 'USD', domain: [100, 120] } });
    const full = stage(opts);
    expect(full.view.yDomain).toEqual([100, 120]);
    expect(yDomain(full.layout)).toEqual([100, 120]);
    const t0 = Date.UTC(2026, 0, 2);
    const t1 = Date.UTC(2026, 0, 3);
    const zoomed = stage(opts, { width: 720, height: 400 }, [t0, t1]);
    expect(zoomed.view.yDomain).toEqual([100, 120]);
    expect(yDomain(zoomed.layout)).toEqual([100, 120]);
    // Ticks of [100, 120] only: never a stretched lower bound such as 92.8.
    const ticks = full.layout.kind === 'plot' ? full.layout.yTicks.map(t => t.value) : [];
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...ticks)).toBeGreaterThanOrEqual(100);
    expect(Math.max(...ticks)).toBeLessThanOrEqual(120);
  });

  it('never pads below zero for non-negative prices and has no negative ticks', () => {
    const rows = [
      { x: 1, o: 1, h: 100, l: 0.5, c: 90, v: 10 },
      { x: 2, o: 90, h: 95, l: 2, c: 3, v: 20 },
    ];
    const { view, layout } = stage({ data: rows, x: 'x', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v' });
    // Span 99.5, pad 7.96: 0.5 - 7.96 would be negative, so the lower end stops at 0.
    expect(view.yDomain[0]).toBe(0);
    expect(view.yDomain[1]).toBeCloseTo(107.96, 9);
    for (const tick of layout.kind === 'plot' ? layout.yTicks : []) expect(tick.value).toBeGreaterThanOrEqual(0);
  });

  it('uses a finite neutral domain when nothing is drawable (all invalid, or a zoom into a gap)', () => {
    const invalid = BASE_ROWS.map(r => ({ ...r, h: r.l - 1 }));
    const all = stage(baseOptions({ data: invalid }));
    expect(all.view.yDomain).toEqual(NEUTRAL_PRICE_DOMAIN);
    expect(pathsOf(all.scene)).toHaveLength(0);
    expect(rectsOf(all.scene, DOWN_PAINT)).toBeUndefined();
    const gap = stage(baseOptions(), { width: 720, height: 400 }, [Date.UTC(2026, 0, 1, 6), Date.UTC(2026, 0, 1, 12)]);
    expect(gap.view.visibleSlots.end - gap.view.visibleSlots.start).toBe(0);
    expect(gap.view.yDomain).toEqual(NEUTRAL_PRICE_DOMAIN);
  });

  it('includes y references in the automatic fit', () => {
    const { view } = stage(baseOptions({ reference: [{ y: 130, label: 'Target' }] }));
    // [98, 130]: span 32, pad 2.56.
    expect(view.yDomain[0]).toBeCloseTo(95.44, 9);
    expect(view.yDomain[1]).toBeCloseTo(132.56, 9);
  });
});

describe('N7a split panes', () => {
  it('splits the plot ~72/5/23 with disjoint panes, a hairline between them and the x axis below both', () => {
    const { layout, panes, scene } = stage(baseOptions());
    const plot = plotOf(layout);
    const volume = panes.volume!;
    expect(volume).not.toBeNull();
    expect(panes.price.y).toBe(plot.y);
    expect(bottomOf(volume)).toBeCloseTo(bottomOf(plot), 9);
    expect(bottomOf(panes.price)).toBeLessThan(volume.y);
    expect(panes.price.height / plot.height).toBeGreaterThan(0.69);
    expect(panes.price.height / plot.height).toBeLessThan(0.75);
    expect(volume.height / plot.height).toBeGreaterThanOrEqual(0.21);
    expect(volume.height / plot.height).toBeLessThanOrEqual(0.25);
    expect(panes.divider).toBeGreaterThan(bottomOf(panes.price));
    expect(panes.divider).toBeLessThan(volume.y);
    const divider = scene.marks.find((m): m is RuleMark => m.type === 'rule' && m.y1 === panes.divider && m.y2 === panes.divider);
    expect(divider?.x1).toBe(plot.x);
    expect(divider?.x2).toBe(plot.x + plot.width);
    // x tick labels sit below the volume pane.
    const xTicks = textsOf(layout).filter(t => t.role === 'tick-x');
    expect(xTicks.length).toBeGreaterThan(0);
    for (const t of xTicks) expect(t.box.y).toBeGreaterThanOrEqual(bottomOf(plot));
    // Price tick labels sit beside the price pane (a half line of clearance at its ends), never beside volume.
    const lefts = textsOf(layout).filter(t => t.role === 'tick-y' && t.box.x < plot.x);
    expect(lefts.length).toBeGreaterThan(0);
    for (const t of lefts) {
      expect(t.y).toBeGreaterThanOrEqual(panes.price.y - 1e-9);
      expect(t.y).toBeLessThanOrEqual(bottomOf(panes.price) + 1e-9);
    }
  });

  it('gives volume its own [0, max] scale and at most three nice ticks on the right', () => {
    const { panes, layout } = stage(baseOptions());
    const plot = plotOf(layout);
    const volume = panes.volume!;
    // Drawable volumes: rows 0..2 (5000, 4200, 3100); row 3's candle is invalid, row 4's volume is negative.
    expect(panes.volumeMax).toBe(5000);
    expect(panes.volumeScale!.domain).toEqual([0, 5000]);
    expect(panes.volumeScale!.range).toEqual([bottomOf(volume), volume.y]);
    expect(panes.volumeTicks.map(t => t.value)).toEqual([0, 2000, 4000]);
    expect(panes.volumeTicks.map(t => t.label)).toEqual(['0', '2,000', '4,000']);
    const right = textsOf(layout).filter(t => t.role === 'tick-y' && t.box.x > plot.x + plot.width);
    expect(right.map(t => t.full)).toEqual(['0', '2,000', '4,000']);
    for (const t of right) {
      expect(t.y).toBeGreaterThanOrEqual(volume.y - 1e-9);
      expect(t.y).toBeLessThanOrEqual(bottomOf(volume) + 1e-9);
      expect(t.box.x + t.box.width).toBeLessThanOrEqual(720);
    }
  });

  it('draws volume bars proportional to their own scale, only for drawable volume, clipped to the volume pane', () => {
    const { panes, scene } = stage(baseOptions());
    const volume = panes.volume!;
    const bars = rectBoxes(rectsOf(scene, VOLUME_PAINT)!);
    expect(bars.map(b => b.height / volume.height)).toEqual([1, 0.84, 0.62].map(v => expect.closeTo(v, 5)));
    for (const b of bars) {
      expect(b.y).toBeGreaterThanOrEqual(volume.y - 1e-6);
      expect(b.y + b.height).toBeCloseTo(bottomOf(volume), 4);
    }
    expect(paneOf(rectsOf(scene, VOLUME_PAINT)!)).toEqual({ kind: 'volume', rect: volume });
  });

  it('wires yAxis.label and volumeAxis.label (with units) into placed, non-overlapping titles', () => {
    const { layout, panes } = stage(baseOptions({
      yAxis: { label: 'Price', unit: 'USD' }, volumeAxis: { label: 'Shares', unit: 'k' },
    }));
    const plot = plotOf(layout);
    const titles = textsOf(layout).filter(t => t.role === 'title-y');
    expect(titles.map(t => t.full).sort()).toEqual(['Price (USD)', 'Shares (k)']);
    const price = titles.find(t => t.full === 'Price (USD)')!;
    const shares = titles.find(t => t.full === 'Shares (k)')!;
    expect(price.box.x + price.box.width).toBeLessThanOrEqual(plot.x);
    expect(shares.box.x).toBeGreaterThanOrEqual(plot.x + plot.width);
    expect(shares.box.x + shares.box.width).toBeLessThanOrEqual(720);
    // The price title is centered on the price pane.
    expect(price.y).toBeCloseTo(panes.price.y + panes.price.height / 2, 6);
    const all = textsOf(layout);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      expect(overlaps(all[i]!.box, all[j]!.box), `${all[i]!.full} / ${all[j]!.full}`).toBe(false);
    }
  });

  it('formats volume ticks with volumeAxis.format and reports a throwing formatter (AX160)', () => {
    const big = BASE_ROWS.map((r, i) => ({ ...r, v: (i + 1) * 1_000_000 }));
    const intl = stage(baseOptions({ data: big, volumeAxis: { format: { notation: 'compact' } } }));
    // Drawable volumes: rows 0, 1, 2 and 4 (1M, 2M, 3M, 5M; row 3's candle is AX180). Max 5M: a 1M step has
    // six ticks, so the densest set of at most three is the 2M step.
    expect(intl.panes.volumeTicks.map(t => t.label)).toEqual(['0', '2M', '4M']);
    const throwing = stage(baseOptions({ volumeAxis: { format: () => { throw new Error('boom'); } } }));
    expect(throwing.panes.volumeFormatFailed).toBe(true);
    const diags = financeLayout(throwing.stateRef).layoutDiagnostics!(throwing.view, throwing.ctx, throwing.layout);
    expect(diags.some(d => d.code === 'AX160' && d.field === 'v')).toBe(true);
  });

  it('expands the price pane to the whole plot without volume, with volume hidden, and on short plots', () => {
    const none = stage({ data: BASE_ROWS, x: 'day', open: 'o', high: 'h', low: 'l', close: 'c' });
    expect(none.panes.volume).toBeNull();
    expect(none.panes.price).toEqual(plotOf(none.layout));
    const hidden = stage(baseOptions(), { width: 720, height: 400 }, null, new Set(['v']));
    expect(hidden.panes.volume).toBeNull();
    expect(hidden.panes.price).toEqual(plotOf(hidden.layout));
    expect(rectsOf(hidden.scene, VOLUME_PAINT)).toBeUndefined();
    // Short plots (review sol-6.2-medium blocker 3): both panes while an 80 px price pane and a 16 px volume pane
    // fit; below that, price only, disclosed (volumeOmitted, a hidden label in the y fit), never silently.
    for (let height = 100; height <= 200; height += 5) {
      const short = stage(baseOptions(), { width: 400, height });
      if (short.layout.kind !== 'plot') continue;
      if (short.panes.volume) {
        expect(short.panes.price.height, `${height}`).toBeGreaterThanOrEqual(80 - 1e-9);
        expect(short.panes.volume.height, `${height}`).toBeGreaterThanOrEqual(16);
        expect(bottomOf(short.panes.price)).toBeLessThan(short.panes.volume.y);
      } else {
        expect(short.panes.volumeOmitted, `${height}`).toBe(true);
        expect(short.panes.price).toEqual(short.layout.plot);
        expect(short.layout.fit.y.hidden).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('keeps a degenerate zero-volume axis: a lone 0 tick, no bars and no baseline stubs', () => {
    const zero = stage(baseOptions({ data: BASE_ROWS.map(r => ({ ...r, v: 0 })) }));
    expect(zero.panes.volume).not.toBeNull();
    expect(zero.panes.volumeMax).toBe(0);
    expect(zero.panes.volumeScale!.domain).toEqual([0, 1]);
    expect(zero.panes.volumeTicks.map(t => t.label)).toEqual(['0']);
    expect(rectsOf(zero.scene, VOLUME_PAINT)).toBeUndefined();
    const missing = stage(baseOptions({ data: BASE_ROWS.map(r => ({ ...r, v: null })) }));
    expect(missing.panes.volumeMax).toBe(0);
    expect(rectsOf(missing.scene, VOLUME_PAINT)).toBeUndefined();
    const some = stage(baseOptions({ data: BASE_ROWS.map((r, i) => ({ ...r, v: i === 0 ? 0 : i === 1 ? null : r.v })) }));
    // Only row 2 (3100) is drawable and positive: one bar, full height.
    const bars = rectBoxes(rectsOf(some.scene, VOLUME_PAINT)!);
    expect(bars).toHaveLength(1);
    expect(bars[0]!.height).toBeCloseTo(some.panes.volume!.height, 6);
  });

  it('chooses volume ticks that do not touch in a short pane', () => {
    const label = (v: number) => String(v);
    expect(volumeTicks(5000, 80, 16, label).map(t => t.value)).toEqual([0, 2000, 4000]);
    // 2000 of 5000 over 30 px is 12 px apart, under a 16 px line: the sparser 5000 step is used.
    expect(volumeTicks(5000, 30, 16, label).map(t => t.value)).toEqual([0, 5000]);
    expect(volumeTicks(0, 30, 16, label).map(t => t.value)).toEqual([0]);
  });

  it('recomputes the layout key for visibility, zoom, volume extent, labels and formatting', () => {
    const a = stage(baseOptions());
    const stageA = financeLayout(a.stateRef);
    const key = (s: Staged, st = stageA) => st.layoutKey(s.view, { width: 720, height: 400 }, style, 0, s.ctx);
    const same = (k1: readonly unknown[], k2: readonly unknown[]) => k1.length === k2.length && k1.every((v, i) => Object.is(v, k2[i]));
    const base = key(a);
    expect(same(base, key(a))).toBe(true);
    const variants: Staged[] = [
      stage(baseOptions(), { width: 720, height: 400 }, null, new Set(['v'])),
      stage(baseOptions(), { width: 720, height: 400 }, [Date.UTC(2026, 0, 2), Date.UTC(2026, 0, 4)]),
      stage(baseOptions({ data: BASE_ROWS.map(r => ({ ...r, v: r.v * 2 })) })),
      stage(baseOptions({ volumeAxis: { label: 'Shares' } })),
      stage(baseOptions({ yAxis: { unit: 'USD', label: 'Price' } })),
      stage(baseOptions({ volumeAxis: { format: { notation: 'compact' } } })),
    ];
    for (const v of variants) expect(same(base, financeLayout(v.stateRef).layoutKey(v.view, { width: 720, height: 400 }, style, 0, v.ctx))).toBe(false);
  });
});

describe('N7a pane clipping', () => {
  it('cuts candles, wicks and references to the price pane at explicit bounds', () => {
    const { scene, panes, layout } = stage(baseOptions({
      yAxis: { domain: [101, 106] },
      reference: [{ y: 90, label: 'Below' }, { y: 103, label: 'Inside' }],
    }));
    const price = panes.price;
    for (const path of pathsOf(scene)) {
      expect(paneOf(path)?.kind).toBe('price');
      for (const y of ys(path)) {
        expect(y).toBeGreaterThanOrEqual(price.y - 1e-4);
        expect(y).toBeLessThanOrEqual(bottomOf(price) + 1e-4);
      }
    }
    const down = rectsOf(scene, DOWN_PAINT)!;
    expect(paneOf(down)?.kind).toBe('price');
    for (const b of rectBoxes(down)) {
      expect(b.y).toBeGreaterThanOrEqual(price.y - 1e-4);
      expect(b.y + b.height).toBeLessThanOrEqual(bottomOf(price) + 1e-4);
    }
    // The down candle (row 1: 110 -> 102) is cut at 106: its body runs from the pane top to 102.
    if (layout.kind === 'plot' && layout.projection.kind === 'xy') {
      const y = layout.projection.y;
      expect(rectBoxes(down)[0]!.y).toBeCloseTo(y.map(106), 4);
      expect(rectBoxes(down)[0]!.y + rectBoxes(down)[0]!.height).toBeCloseTo(y.map(102), 4);
      // References are dashed paths with the price pane's clip. 90 is below the pane and is not drawn; 103 is.
      const refs = pathsOf(scene).filter(m => m.dash.normal !== null);
      expect(refs.map(r => r.xy[1])).toEqual([expect.closeTo(y.map(103), 4)]);
      expect(refs.map(r => paneOf(r)?.kind)).toEqual(['price']);
    }
  });

  it('applies the pane clip and the semantic paints in the SVG handlers', () => {
    const bindings = { tokens: { axis: 'A', grid: 'G', reference: 'R', muted: 'M', focus: 'F', background: 'B', text: 'T' }, series: ['s1', 's2', 's3', 's4', 's5'] };
    const fin = financeBindings(bindings);
    expect(fin.series[UP_PAINT]).toBe('var(--axylo-forced-series, var(--axylo-up, s1))');
    expect(fin.series[DOWN_PAINT]).toBe('var(--axylo-forced-series, var(--axylo-down, s2))');
    expect(fin.series[VOLUME_PAINT]).toBe('var(--axylo-forced-series, var(--axylo-volume, s3))');
    expect(fin.series[3]).toBe('s4');
    expect(financeBindings(bindings)).toBe(fin);
    expect(financeSvgMarks.path).toBeTypeOf('function');
    expect(financeSvgMarks.rects).toBeTypeOf('function');
  });
});

describe('N7a dense OHLCV aggregation', () => {
  const drawableColumns = (o: number[], h: number[], l: number[], c: number[], v: (number | null)[], x: number[], valid: boolean[]) => ({
    open: o, high: h, low: l, close: c, volume: v.map(n => (n === null ? NaN : n)),
    candle: (i: number) => valid[i]!,
    drawableVolume: (i: number) => valid[i]! && v[i] !== null && v[i]! >= 0,
    x: (i: number) => x[i]!,
  });

  it('preserves first open, max high, min low, last close and summed volume per contiguous bin (property)', () => {
    const candle = fc.record({
      a: fc.double({ min: 1, max: 1000, noNaN: true }), b: fc.double({ min: 1, max: 1000, noNaN: true }),
      up: fc.double({ min: 0, max: 50, noNaN: true }), down: fc.double({ min: 0, max: 50, noNaN: true }),
      v: fc.option(fc.integer({ min: 0, max: 1_000_000 }), { nil: null }), valid: fc.boolean(), dx: fc.double({ min: 0.01, max: 3, noNaN: true }),
    });
    fc.assert(fc.property(fc.array(candle, { minLength: 1, maxLength: 400 }), fc.integer({ min: 20, max: 300 }), (list, width) => {
      const left = 10;
      const o = list.map(k => k.a), c = list.map(k => k.b);
      const h = list.map(k => Math.max(k.a, k.b) + k.up), l = list.map(k => Math.min(k.a, k.b) - k.down);
      let px = left;
      const span = list.reduce((s, k) => s + k.dx, 0);
      const x = list.map(k => { const at = px; px += (k.dx / span) * width; return at; });
      x[x.length - 1] = left + width; // the last slot exactly on the right edge
      const valid = list.map(k => k.valid);
      const bins = aggregateOhlcv(drawableColumns(o, h, l, c, list.map(k => k.v), x, valid), 0, list.length, left, width);
      expect(bins.count).toBeLessThanOrEqual(Math.ceil(width / BIN_WIDTH));
      let maxVolume = 0;
      let previousLast = -1;
      for (let b = 0; b < bins.count; b++) {
        const first = bins.first[b]!, last = bins.last[b]!;
        expect(first).toBeGreaterThan(previousLast);
        previousLast = last;
        expect(bins.center[b]).toBeLessThanOrEqual(left + width);
        expect(bins.center[b]).toBeGreaterThanOrEqual(left);
        const members = [];
        for (let i = first; i <= last; i++) if (valid[i]) members.push(i);
        expect(bins.candles[b]).toBe(members.length);
        if (members.length) {
          expect(bins.open[b]).toBe(o[members[0]!]);
          expect(bins.close[b]).toBe(c[members[members.length - 1]!]);
          expect(bins.high[b]).toBe(Math.max(...members.map(i => h[i]!)));
          expect(bins.low[b]).toBe(Math.min(...members.map(i => l[i]!)));
          for (const i of members) {
            expect(bins.high[b]).toBeGreaterThanOrEqual(h[i]!);
            expect(bins.low[b]).toBeLessThanOrEqual(l[i]!);
          }
          const vols = members.filter(i => list[i]!.v !== null).map(i => list[i]!.v!);
          if (vols.length) {
            const sum = vols.reduce((s, v) => s + v, 0);
            expect(bins.volume[b]).toBe(sum);
            maxVolume = Math.max(maxVolume, sum);
          } else expect(Number.isNaN(bins.volume[b]!)).toBe(true);
        }
      }
      // Every drawable slot lands in exactly one bin.
      const covered = new Set<number>();
      for (let b = 0; b < bins.count; b++) for (let i = bins.first[b]!; i <= bins.last[b]!; i++) if (valid[i]) covered.add(i);
      expect(covered.size).toBe(valid.filter(Boolean).length);
      expect(bins.maxVolume).toBe(maxVolume);
    }), { numRuns: 150 });
  });

  it('bounds the marks of 10,000 candles by the plot width and keeps exact readouts', () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => {
      const o = 100 + Math.sin(i / 50) * 10;
      const c = o + ((i % 7) - 3) * 0.5;
      return { x: i, o, h: Math.max(o, c) + 1 + (i % 5) * 0.1, l: Math.min(o, c) - 1 - (i % 3) * 0.1, c, v: 1000 + (i % 13) * 10 };
    });
    const opts = { data: rows, x: 'x', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v' };
    const dense = stage(opts);
    const plot = plotOf(dense.layout);
    expect(10_000).toBeGreaterThan(denseThreshold(plot.width));
    const bins = dense.panes.bins!;
    expect(bins).not.toBeNull();
    const columns = Math.ceil(plot.width / BIN_WIDTH);
    expect(bins.count).toBeLessThanOrEqual(columns);
    const down = rectsOf(dense.scene, DOWN_PAINT)?.xywh.length ?? 0;
    const vol = rectsOf(dense.scene, VOLUME_PAINT)!.xywh.length;
    expect(down / 4 + vol / 4).toBeLessThanOrEqual(2 * columns);
    // Bins sum the volume; the tallest summed bar fills the pane and the scale's maximum is that sum.
    let maxSum = 0;
    for (let b = 0; b < bins.count; b++) maxSum = Math.max(maxSum, bins.volume[b]!);
    expect(dense.panes.volumeMax).toBe(maxSum);
    expect(maxSum).toBeGreaterThan(1120); // more than any single candle (max 1120)
    const heights = rectBoxes(rectsOf(dense.scene, VOLUME_PAINT)!).map(b => b.height);
    expect(Math.max(...heights)).toBeCloseTo(dense.panes.volume!.height, 4);
    // The summed volume of every bin equals the raw sum of its slots.
    for (let b = 0; b < bins.count; b += 97) {
      let sum = 0;
      for (let i = bins.first[b]!; i <= bins.last[b]!; i++) sum += rows[i]!.v;
      expect(bins.volume[b]).toBe(sum);
    }
    // Zoomed in to 40 candles: no bins, one body per candle, and the lookup reads the raw row.
    const zoomed = stage(opts, { width: 720, height: 400 }, [5000, 5039]);
    expect(zoomed.panes.bins).toBeNull();
    expect(zoomed.view.visibleSlots.end - zoomed.view.visibleSlots.start).toBe(40);
    expect(rectBoxes(rectsOf(zoomed.scene, VOLUME_PAINT)!)).toHaveLength(40);
    const frame = zoomed.view.frame;
    const formatters = createFormatters({
      series: frame.series.map(s => ({ field: s.field, unit: s.unit, scale: s.valueScale, format: null })),
      x: { field: 'x', kind: frame.x.kind, unit: null, scale: null, format: null, timeZone: frame.x.timeZone, dateUnit: frame.x.dateUnit, categories: frame.x.categories },
      locale: 'en-US', messages: { noData: defaultMessages.noData, noObservation: defaultMessages.noObservation },
    }, { locale: 'en-US', timeZone: 'UTC' });
    const lookup = createFinanceLookup(zoomed.stateRef, zoomed.view, zoomed.layout, formatters, defaultMessages, 'en-US');
    const tip = lookup.tooltip({ kind: 'x', x: 5010 });
    const raw = rows[5010]!;
    expect(tip.rows.find(r => r.seriesLabel === 'Volume')?.value).toBe(formatters.value(4, raw.v));
    expect(tip.rows.find(r => r.seriesLabel === 'Open')?.value).toBe(formatters.value(0, raw.o));
  });

  it('does not open an extra bin for a slot on the right edge', () => {
    const x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10];
    const n = x.length;
    const ones = Array.from({ length: n }, () => 1);
    const bins = aggregateOhlcv({
      open: ones, high: ones, low: ones, close: ones, volume: ones,
      candle: () => true, drawableVolume: () => true, x: i => x[i]!,
    }, 0, n, 0, 10);
    // Columns of 2 px over 10 px: 5 columns; x = 10 joins column 4 (x 8..10) with x = 8.
    expect(bins.count).toBe(5);
    expect(bins.last[4]).toBe(n - 1);
    expect(bins.volume[4]).toBe(2);
    expect(bins.center[4]).toBe(9);
  });
});

describe('N7a lookup and cursor across panes', () => {
  it('picks from the volume pane and spans the cursor over the whole plot', () => {
    const { stateRef, view, layout, panes } = stage(baseOptions());
    const frame = view.frame;
    const formatters = createFormatters({
      series: frame.series.map(s => ({ field: s.field, unit: s.unit, scale: s.valueScale, format: null })),
      x: { field: 'day', kind: frame.x.kind, unit: null, scale: null, format: null, timeZone: frame.x.timeZone, dateUnit: frame.x.dateUnit, categories: frame.x.categories },
      locale: 'en-US', messages: { noData: defaultMessages.noData, noObservation: defaultMessages.noObservation },
    }, { locale: 'en-US', timeZone: 'UTC' });
    const lookup = createFinanceLookup(stateRef, view, layout, formatters, defaultMessages, 'en-US');
    const plot = plotOf(layout);
    if (layout.kind !== 'plot' || layout.projection.kind !== 'xy') throw new Error('xy');
    const x0 = layout.projection.x.map(frame.x.values[0]!);
    const volumeY = panes.volume!.y + panes.volume!.height / 2;
    expect(lookup.pick(x0, volumeY)).toEqual({ kind: 'x', x: frame.x.values[0] });
    expect(lookup.pick(x0, panes.price.y + 5)).toEqual({ kind: 'x', x: frame.x.values[0] });
    expect(lookup.tooltip({ kind: 'x', x: frame.x.values[4]! }).rows.map(r => `${r.seriesLabel}=${r.value}`)).toEqual([
      'Open=104 USD', 'High=109 USD', 'Low=101 USD', 'Close=108 USD', 'Change=+4 USD (up)', 'Volume=-100 (invalid volume)',
    ]);
    expect(lookup.tooltip({ kind: 'x', x: frame.x.values[3]! }).rows.map(r => r.value)).toEqual([
      '105 USD (invalid OHLC)', '100 USD (invalid OHLC)', '95 USD (invalid OHLC)', '104 USD (invalid OHLC)', '2,000',
    ]);
    expect(bottomOf(plot)).toBeCloseTo(bottomOf(panes.volume!), 9);
  });
});

// ───────────────────────────── through the real controller ─────────────────────────────

interface Opened {
  readonly rec: Recording;
  readonly chart: FinanceHandle;
}

function openChart(options: Record<string, unknown>): Opened {
  const rec = record({ width: 720, height: 420 });
  const chart = openFinanceChart(options, (composition, translated) => controllerFor(composition, translated, rec.host).handle);
  rec.frames();
  return { rec, chart };
}

function committedPanes(rec: Recording): FinancePanes {
  const layout = rec.committed?.layout;
  const panes = layout ? financePanes(layout) : null;
  if (!panes) throw new Error('no committed finance layout');
  return panes;
}

const lastScene = (rec: Recording): Scene => rec.draws[rec.draws.length - 1]!;
const geometry = (scene: Scene) => scene.marks.filter((m: Mark) => m.type === 'rects' || m.type === 'path').map(m =>
  m.type === 'rects' ? [m.series, ...m.xywh] : m.type === 'path' ? [m.series, ...Array.from(m.xy, v => (Number.isNaN(v) ? -1 : v))] : []);

describe('N7a strict rollback through the controller', () => {
  it('restores both panes, diagnostics, lookup and data after a rejected strict update, and accepts the next one', () => {
    const { rec, chart } = openChart(baseOptions({ volumeAxis: { label: 'Shares' } }));
    const panes = committedPanes(rec);
    expect(panes.volume).not.toBeNull();
    const before = {
      price: panes.price, volume: panes.volume, ticks: panes.volumeTicks.map(t => t.label),
      codes: chart.diagnostics.map(d => d.code).sort(),
      geometry: geometry(lastScene(rec)),
      titles: (rec.committed!.layout.kind === 'plot' ? rec.committed!.layout.texts : []).filter(t => t.role === 'title-y').map(t => t.full).sort(),
      tip: rec.committed!.lookup.tooltip({ kind: 'x', x: Date.UTC(2026, 0, 2) }).rows.map(r => r.value),
    };
    expect(before.codes).toEqual(['AX180', 'AX181']);
    expect(before.titles).toEqual(['Shares', 'Value (USD)']);
    expect(before.tip).toEqual(['110 USD', '111 USD', '100 USD', '102 USD', '-8 USD (down)', '4,200']);

    const draws = rec.draws.length;
    expect(() => chart.update({ strict: true, open: 'c', volumeAxis: { label: 'Rejected' }, data: BASE_ROWS.slice(0, 2) })).toThrow();
    rec.frames();
    const after = committedPanes(rec);
    expect(after.price).toEqual(before.price);
    expect(after.volume).toEqual(before.volume);
    expect(after.volumeTicks.map(t => t.label)).toEqual(before.ticks);
    expect(chart.diagnostics.map(d => d.code).sort()).toEqual(before.codes);
    expect(geometry(lastScene(rec))).toEqual(before.geometry);
    expect(rec.committed!.lookup.tooltip({ kind: 'x', x: Date.UTC(2026, 0, 2) }).rows.map(r => r.value)).toEqual(before.tip);
    expect(rec.draws.length).toBeGreaterThanOrEqual(draws);

    // The next valid update is applied on top of the committed state (not the rejected one).
    chart.update({ volumeAxis: { label: 'Volume (lots)' }, yAxis: { unit: 'USD', label: 'Price' } });
    rec.frames();
    const layout = rec.committed!.layout;
    expect((layout.kind === 'plot' ? layout.texts : []).filter(t => t.role === 'title-y').map(t => t.full).sort())
      .toEqual(['Price (USD)', 'Volume (lots)']);
    expect(committedPanes(rec).volumeTicks.map(t => t.label)).toEqual(before.ticks);
    expect(rec.committed!.lookup.tooltip({ kind: 'x', x: Date.UTC(2026, 0, 2) }).rows.map(r => r.value)).toEqual(before.tip);
    chart.destroy();
  });

  it('keeps the explicit domain through controller zoom and reset', () => {
    const { rec, chart } = openChart(baseOptions({ yAxis: { unit: 'USD', domain: [100, 120] } }));
    expect(yDomain(rec.committed!.layout)).toEqual([100, 120]);
    chart.zoom([Date.UTC(2026, 0, 2), Date.UTC(2026, 0, 4)] as never);
    rec.frames();
    expect(yDomain(rec.committed!.layout)).toEqual([100, 120]);
    chart.zoom(null as never);
    rec.frames();
    expect(yDomain(rec.committed!.layout)).toEqual([100, 120]);
    chart.destroy();
  });
});

describe('N7a SVG pane clips and semantic paints (renderer with the finance handlers)', () => {
  it('clips each data mark to its pane and paints through --axylo-up / --axylo-down / --axylo-volume', () => {
    const { scene, panes } = stage(baseOptions());
    const renderer = svgRendererWith(financeSvgMarks, fakeDocument());
    const bindings = { tokens: { axis: 'var(--axylo-axis)', grid: 'var(--axylo-grid)', reference: 'R', muted: 'M', focus: 'F', background: 'B', text: 'T' },
      series: ['var(--axylo-series-color-1)', 'var(--axylo-series-color-2)', 'var(--axylo-series-color-3)', 'var(--axylo-series-color-4)', 'var(--axylo-series-color-5)'] };
    const theme = { scheme: 'light', forcedColors: false, moreContrast: false, paints: bindings } as const;
    renderer.draw(scene, bindings, theme, 1);
    renderer.draw(scene, bindings, theme, 1); // a second draw keeps the pane clips (renderer cache unchanged)
    const root = renderer.element as unknown as FakeElement;
    const nodes = root.all();
    const clipRect = (kind: string) => {
      const clip = nodes.find(n => n.tagName === 'clipPath' && (n.getAttribute('id') ?? '').startsWith(`axylo-finance-${kind}-`))!;
      const r = clip.kids[0]!;
      return { id: clip.getAttribute('id'), rect: ['x', 'y', 'width', 'height'].map(k => Number(r.getAttribute(k))) };
    };
    const price = clipRect('price');
    const volume = clipRect('volume');
    expect(price.rect).toEqual([panes.price.x, panes.price.y, panes.price.width, panes.price.height]);
    expect(volume.rect).toEqual([panes.volume!.x, panes.volume!.y, panes.volume!.width, panes.volume!.height]);
    const painted = (name: string) => nodes.filter(n => (n.style.getPropertyValue('color')).includes(name));
    const up = painted('--axylo-up');
    const down = painted('--axylo-down');
    const vol = painted('--axylo-volume');
    expect(up).toHaveLength(1);
    expect(up[0]!.tagName).toBe('path');
    expect(up[0]!.style.getPropertyValue('fill')).toBe('none');
    expect(up[0]!.style.getPropertyValue('stroke')).toBe('currentColor');
    expect(up[0]!.style.getPropertyValue('color')).toBe('var(--axylo-forced-series, var(--axylo-up, var(--axylo-series-color-1)))');
    expect(up[0]!.getAttribute('clip-path')).toBe(`url(#${price.id})`);
    expect(down[0]!.style.getPropertyValue('fill')).toBe('currentColor');
    expect(down[0]!.getAttribute('clip-path')).toBe(`url(#${price.id})`);
    expect(down[0]!.kids).toHaveLength(1); // one down candle (row 1)
    expect(vol[0]!.getAttribute('clip-path')).toBe(`url(#${volume.id})`);
    expect(vol[0]!.kids).toHaveLength(3);
    // Wicks are axis-painted but still clipped to the price pane.
    const wick = nodes.find(n => n.tagName === 'path' && n.getAttribute('stroke-width') === '1.25')!;
    expect(wick.getAttribute('clip-path')).toBe(`url(#${price.id})`);
  });
});

describe('N7a overlay', () => {
  it('draws the cursor across both panes', () => {
    const { stateRef, view, layout, panes } = stage(baseOptions());
    const plot = plotOf(layout);
    const clipped: Mark[] = [];
    createFinanceOverlay(stateRef)({ view, layout, target: { kind: 'x', x: view.frame.x.values[2]! }, ring: null } as never, plot, clipped);
    const cursor = clipped[0] as RuleMark;
    expect(cursor.role).toBe('cursor');
    expect(cursor.y1).toBe(plot.y);
    expect(cursor.y2).toBe(bottomOf(panes.volume!));
  });
});

describe('N7a layout over container sizes (property)', () => {
  it('keeps panes disjoint and ordered, and text inside the container without overlaps, for any size', () => {
    fc.assert(fc.property(fc.integer({ min: 240, max: 1920 }), fc.integer({ min: 160, max: 900 }), fc.boolean(), (width, height, labelled) => {
      const opts = baseOptions(labelled ? { yAxis: { label: 'Price', unit: 'USD' }, volumeAxis: { label: 'Shares traded', unit: 'k' } } : {});
      const parsed = stage(opts, { width, height });
      const { layout, panes } = parsed;
      if (layout.kind !== 'plot') return;
      const plot = layout.plot;
      expect(panes.price.y).toBe(plot.y);
      if (panes.volume) {
        expect(bottomOf(panes.price)).toBeLessThan(panes.volume.y);
        expect(bottomOf(panes.volume)).toBeCloseTo(bottomOf(plot), 9);
        expect(panes.volume.height).toBeGreaterThanOrEqual(24);
        expect(panes.price.height).toBeGreaterThanOrEqual(80 - 1e-7);
      } else expect(panes.price).toEqual(plot);
      const texts = textsOf(layout);
      for (const t of texts) {
        expect(t.box.x).toBeGreaterThanOrEqual(-0.5);
        expect(t.box.y).toBeGreaterThanOrEqual(-0.5);
        expect(t.box.x + t.box.width).toBeLessThanOrEqual(width + 0.5);
        expect(t.box.y + t.box.height).toBeLessThanOrEqual(height + 0.5);
      }
      for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
        expect(overlaps(texts[i]!.box, texts[j]!.box), `${width}x${height}: ${texts[i]!.full} / ${texts[j]!.full}`).toBe(false);
      }
    }), { numRuns: 80 });
  });
});
