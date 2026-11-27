/**
 * N7a hardening: reference marks owned and clipped by the price pane (x and y, lines and bands, including
 * the stroke of a line on a pane edge and a redraw that reuses SVG slots), finite price domains and volume
 * scales at the edges of the double range, explicit volume-sum overflow, and a volume lane that settles and
 * fits (or discloses) its labels at any width.
 *
 * Expected values come from the fixtures, the stated rules (8% padding, at most a quarter of the width for
 * the volume lane) and the platform's own Intl formatting, never from a previous run of this code.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { controllerFor } from '../../src/core/controller';
import type { BandMark, Layout, PathMark, PlacedText, Rect, Scene } from '../../src/core/contracts';
import { aggregateOhlcv } from '../../src/finance/aggregate';
import { openFinanceChart } from '../../src/finance/chart';
import { fitPriceDomain } from '../../src/finance/core';
import { financeLayout } from '../../src/finance/layout';
import { financeSvgMarks, paneOf, VOLUME_PAINT } from '../../src/finance/render';
import { svgRendererWith } from '../../src/render/svg';
import {
  BASE_ROWS, baseOptions, bottomOf, FakeElement, fakeDocument, overlaps, pathsOf, rectBoxes, rectsOf, stage, textsOf, yDomain, ys,
} from './fixtures';
import { record } from './host';

const dashed = (scene: Scene): PathMark[] => pathsOf(scene).filter(m => m.dash.normal !== null);
const bands = (scene: Scene): BandMark[] => scene.marks.filter((m): m is BandMark => m.type === 'band');
const xsOf = (mark: PathMark): number[] => Array.from(mark.xy).filter((_, i) => i % 2 === 0);
const referenceTexts = (layout: Layout): readonly PlacedText[] => textsOf(layout).filter(t => t.role === 'reference');
const yScale = (layout: Layout) => {
  if (layout.kind !== 'plot' || layout.projection.kind !== 'xy') throw new Error('expected an xy plot');
  return layout.projection;
};
const inside = (box: Rect, pane: Rect) => box.y >= pane.y - 1e-6 && box.y + box.height <= bottomOf(pane) + 1e-6;

describe('N7a references belong to the price pane', () => {
  it('draws a y line on the explicit top edge, omits off-domain lines, and clamps a band to the pane', () => {
    const { scene, panes, layout } = stage(baseOptions({
      yAxis: { domain: [100, 120] },
      reference: [{ y: 120, label: 'Top' }, { y: 130, label: 'Above' }, { y: 50, label: 'Below' }, { y: [115, 140], label: 'Band' }],
    }));
    const price = panes.price;
    const lines = dashed(scene);
    // 130 and 50 are outside [100, 120]: not drawn (and not pinned to an edge). 120 is the pane's top edge.
    expect(lines).toHaveLength(1);
    expect(ys(lines[0]!)).toEqual([price.y, price.y].map(v => expect.closeTo(v, 4)));
    expect(xsOf(lines[0]!)).toEqual([price.x, price.x + price.width].map(v => expect.closeTo(v, 4)));
    expect(lines[0]!.strokeWidth).toBe(1.5);
    expect(paneOf(lines[0]!)).toEqual({ kind: 'price', rect: price });
    // The band [115, 140] is cut at the top of the pane: from y(120) = pane top down to y(115).
    const [band] = bands(scene);
    const { y } = yScale(layout);
    expect(band!.box.y).toBeCloseTo(price.y, 6);
    expect(band!.box.y + band!.box.height).toBeCloseTo(y.map(115), 6);
    expect(paneOf(band!)?.kind).toBe('price');
    // Labels: drawn ones only, inside the price pane like their marks.
    const labels = referenceTexts(layout).map(t => t.full).sort();
    expect(labels).toEqual(['Band', 'Top']);
    for (const t of referenceTexts(layout)) expect(inside(t.box, price), t.full).toBe(true);
  });

  it('keeps x lines and bands inside the price pane, never in the volume pane', () => {
    // x references widen the x domain (shared convention), so the off-domain line comes from a zoom: [Jan 1, Jan 4].
    const { scene, panes, layout } = stage(baseOptions({
      reference: [{ x: '2026-01-03', label: 'Event' }, { x: ['2026-01-02', '2026-01-04'], label: 'Window' }, { x: '2026-01-05', label: 'Later' }],
    }), undefined, [Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 4)]);
    const price = panes.price;
    expect(panes.volume).not.toBeNull();
    const { x } = yScale(layout);
    const lines = dashed(scene);
    expect(lines).toHaveLength(1); // 2026-01-05 is outside the zoomed x domain
    expect(xsOf(lines[0]!)).toEqual([x.map(Date.UTC(2026, 0, 3)), x.map(Date.UTC(2026, 0, 3))].map(v => expect.closeTo(v, 3)));
    expect(ys(lines[0]!)).toEqual([price.y, bottomOf(price)].map(v => expect.closeTo(v, 4)));
    const [band] = bands(scene);
    expect(band!.box).toEqual({
      x: expect.closeTo(x.map(Date.UTC(2026, 0, 2)), 3), y: price.y,
      width: expect.closeTo(x.map(Date.UTC(2026, 0, 4)) - x.map(Date.UTC(2026, 0, 2)), 3), height: price.height,
    });
    for (const m of [...lines, band!]) expect(paneOf(m)?.kind).toBe('price');
    expect(bottomOf(price)).toBeLessThan(panes.volume!.y);
    const labels = referenceTexts(layout);
    expect(labels.map(t => t.full).sort()).toEqual(['Event', 'Window']);
    for (const t of labels) expect(inside(t.box, price), t.full).toBe(true);
  });

  it('gives references the price clip in the SVG, also when a redraw reuses the slots', () => {
    const renderer = svgRendererWith(financeSvgMarks, fakeDocument());
    const bindings = { tokens: { axis: 'A', grid: 'G', reference: 'R', muted: 'M', focus: 'F', background: 'B', text: 'T' }, series: ['s1', 's2', 's3', 's4', 's5'] };
    const theme = { scheme: 'light', forcedColors: false, moreContrast: false, paints: bindings } as const;
    const root = renderer.element as unknown as FakeElement;
    const clipOf = (kind: string) => {
      const clip = root.all().find(n => n.tagName === 'clipPath' && (n.getAttribute('id') ?? '').startsWith(`axylo-finance-${kind}-`));
      if (!clip) return null;
      const r = clip.kids[0]!;
      return { url: `url(#${clip.getAttribute('id')})`, rect: ['x', 'y', 'width', 'height'].map(k => Number(r.getAttribute(k))) };
    };
    const scenes = [
      stage(baseOptions({ yAxis: { domain: [100, 120] }, reference: [{ y: 120, label: 'Top' }, { x: ['2026-01-02', '2026-01-03'], label: 'W' }] })),
      // Volume hidden: the price pane is the whole plot; the same slots now hold other marks.
      stage(baseOptions({ reference: [{ x: '2026-01-04', label: 'Event' }, { y: [99, 101], label: 'Zone' }] }), undefined, null, new Set(['v'])),
      stage(baseOptions({ reference: [{ y: 104, label: 'Mid' }] }), { width: 480, height: 300 }),
    ];
    for (const staged of scenes) {
      renderer.draw(staged.scene, bindings, theme, 1);
      const price = clipOf('price')!;
      const p = staged.panes.price;
      expect(price.rect).toEqual([p.x, p.y, p.width, p.height]);
      const group = root.kids.find(k => k.getAttribute('class') === 'axylo-scene')!;
      const drawn = group.kids;
      const refNodes = drawn.filter(n => n.style.getPropertyValue('stroke-dasharray') !== '');
      const bandNodes = drawn.filter(n => n.tagName === 'rect');
      expect(refNodes).toHaveLength(dashed(staged.scene).length);
      expect(bandNodes).toHaveLength(bands(staged.scene).length);
      for (const n of [...refNodes, ...bandNodes]) expect(n.getAttribute('clip-path')).toBe(price.url);
      // Every candle mark has the price clip, volume bars the volume clip; nothing keeps a stale pane clip.
      const volumeClip = clipOf('volume');
      for (const n of drawn) {
        const paint = n.style.getPropertyValue('color');
        if (paint.includes('--axylo-volume')) expect(n.getAttribute('clip-path')).toBe(staged.panes.volume ? volumeClip!.url : 'unexpected');
        else if (paint.includes('--axylo-up') || paint.includes('--axylo-down') || n.tagName === 'path' && n.getAttribute('stroke-width') === '1.25') {
          expect(n.getAttribute('clip-path')).toBe(price.url);
        }
      }
    }
  });
});

describe('N7a finite price domains', () => {
  const ref: { axis: 'x' | 'y'; from: number; to: number }[] = [];
  const fit = (lo: number, hi: number) => fitPriceDomain(new Float64Array([lo]), new Float64Array([hi]), new Uint8Array(1), 0, 1, ref);

  it('keeps finite ends enclosing the data at the edges of the double range', () => {
    for (const [lo, hi] of [[-1e308, 1e308], [1e308, Number.MAX_VALUE], [-Number.MAX_VALUE, -1e308], [-Number.MAX_VALUE, Number.MAX_VALUE], [Number.MAX_VALUE, Number.MAX_VALUE]] as const) {
      const [d0, d1] = fit(lo, hi);
      expect(Number.isFinite(d0) && Number.isFinite(d1), `${lo}..${hi}`).toBe(true);
      expect(d0).toBeLessThanOrEqual(lo);
      expect(d1).toBeGreaterThanOrEqual(hi);
      expect(d0).toBeLessThan(d1);
    }
    // [-1e308, 1e308]: 8% of the span 2e308 is 1.6e307, so the padded ends are -1.16e308 and 1.16e308.
    const [a, b] = fit(-1e308, 1e308);
    expect(a / 1e308).toBeCloseTo(-1.16, 12);
    expect(b / 1e308).toBeCloseTo(1.16, 12);
  });

  it('encloses any finite data with finite ends (property)', () => {
    const finite = fc.double({ noNaN: true, noDefaultInfinity: true });
    fc.assert(fc.property(finite, finite, (a, b) => {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const [d0, d1] = fit(lo, hi);
      return Number.isFinite(d0) && Number.isFinite(d1) && d0 <= lo && d1 >= hi && d0 < d1 && (lo < 0 || d0 >= 0);
    }), { numRuns: 400 });
  });

  it('draws extreme but valid candles with finite geometry inside the price pane', () => {
    const rows = [
      { day: '2026-01-01', o: -1e308, h: 1e308, l: -1e308, c: 1e308, v: 1 },
      { day: '2026-01-02', o: 1e308, h: Number.MAX_VALUE, l: -Number.MAX_VALUE, c: 0, v: 2 },
    ];
    const { scene, panes, layout } = stage(baseOptions({ data: rows }));
    const [d0, d1] = yDomain(layout);
    expect(Number.isFinite(d0) && Number.isFinite(d1)).toBe(true);
    expect(d0).toBeLessThanOrEqual(-Number.MAX_VALUE);
    expect(d1).toBeGreaterThanOrEqual(Number.MAX_VALUE);
    expect(layout.kind === 'plot' ? layout.yTicks.length : 0).toBeGreaterThan(0);
    for (const t of layout.kind === 'plot' ? layout.yTicks : []) expect(Number.isFinite(t.value)).toBe(true);
    const candles = pathsOf(scene).filter(m => paneOf(m)?.kind === 'price' && m.dash.normal === null);
    expect(candles.length).toBeGreaterThan(0);
    for (const m of candles) for (const y of ys(m)) {
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeGreaterThanOrEqual(panes.price.y - 1e-3);
      expect(y).toBeLessThanOrEqual(bottomOf(panes.price) + 1e-3);
    }
  });
});

describe('N7a volume sums that overflow', () => {
  it('holds an overflowing bin at Number.MAX_VALUE, counts it, and keeps ordinary sums exact', () => {
    const n = 6;
    const v = [1e308, 1e308, 1e308, 3, 4, 5];
    const ones = Array.from({ length: n }, () => 1);
    // 2 px columns over 6 px: slots 0-1 | 2-3 | 4-5.
    const bins = aggregateOhlcv({
      open: ones, high: ones, low: ones, close: ones, volume: v, candle: () => true, drawableVolume: () => true, x: i => i,
    }, 0, n, 0, 6);
    expect(bins.count).toBe(3);
    expect(bins.volume[0]).toBe(Number.MAX_VALUE); // 2e308 is not a double
    expect(bins.volume[1]).toBe(1e308 + 3);
    expect(bins.volume[2]).toBe(9);
    expect(bins.saturated).toBe(1);
    expect(bins.maxVolume).toBe(Number.MAX_VALUE);
    expect(Number.isFinite(bins.maxVolume)).toBe(true);
  });

  it('reports AX181 for saturated columns and still draws usable volume bars, ticks and raw readouts', () => {
    const count = 4000;
    const rows = Array.from({ length: count }, (_, i) => ({
      day: new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), o: 10, h: 12, l: 9, c: 11, v: 1e308,
    }));
    const staged = stage(baseOptions({ data: rows }));
    const { panes, scene, layout, view, ctx } = staged;
    expect(panes.bins).not.toBeNull();
    expect(panes.bins!.saturated).toBeGreaterThan(0);
    expect(panes.volumeMax).toBe(Number.MAX_VALUE);
    expect(panes.volumeTicks.length).toBeGreaterThan(0);
    for (const t of panes.volumeTicks) {
      expect(Number.isFinite(t.value)).toBe(true);
      expect(t.label).not.toMatch(/∞|NaN/u);
    }
    const bars = rectsOf(scene, VOLUME_PAINT)!;
    expect(bars).toBeDefined();
    for (const b of rectBoxes(bars)) {
      expect(b.height).toBeGreaterThan(0);
      expect(inside(b, panes.volume!)).toBe(true);
    }
    const diagnostics = financeLayout(staged.stateRef).layoutDiagnostics!(view, ctx, layout);
    const ax181 = diagnostics.find(d => d.code === 'AX181');
    expect(ax181).toMatchObject({ code: 'AX181', effect: 'changed', field: 'v', count: panes.bins!.saturated, origin: 'presentation' });
    // The sink of the data stage has no AX181: every raw volume is a valid finite number.
    expect(staged.sink.inputs().some(d => d.code === 'AX181')).toBe(false);
  });
});

describe('N7a volume lane', () => {
  const long = (v: number) => `${v} shares traded on all venues`;

  it('fits or discloses oversized volume labels and keeps both panes, for any width (property)', () => {
    fc.assert(fc.property(fc.integer({ min: 240, max: 1920 }), fc.integer({ min: 220, max: 700 }), (width, height) => {
      const options = baseOptions({ volumeAxis: { format: long, label: 'Shares traded across every venue today' } });
      const { layout, panes } = stage(options, { width, height });
      const alone = stage(options, { width, height }, null, new Set(['v'])).layout;
      expect(layout.kind).toBe('plot');
      if (layout.kind !== 'plot') return;
      // Price geometry stays usable; volume keeps its pane whenever the height allows (it does from 220 px).
      expect(panes.price.width).toBeGreaterThanOrEqual(width * 0.5);
      expect(panes.volume).not.toBeNull();
      const lane = width - (panes.price.x + panes.price.width);
      // The lane is at most a quarter of the width, beside the right padding the plot has without volume.
      expect(lane).toBeLessThanOrEqual(Math.floor(width * 0.25) + rightPadding(alone) + 1e-6);
      const texts = textsOf(layout);
      for (const t of texts) {
        expect(t.box.x + t.box.width, t.full).toBeLessThanOrEqual(width + 0.5);
        expect(t.box.x, t.full).toBeGreaterThanOrEqual(-0.5);
      }
      for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
        expect(overlaps(texts[i]!.box, texts[j]!.box), `${width}: ${texts[i]!.full} / ${texts[j]!.full}`).toBe(false);
      }
      // Every volume label that is not shown in full is counted for the reader's note (AX143).
      const shownTicks = texts.filter(t => t.role === 'tick-y' && t.box.x > panes.price.x + panes.price.width);
      const fullTicks = shownTicks.filter(t => t.lines[0] === t.full).length;
      const title = texts.some(t => t.role === 'title-y' && t.full.startsWith('Shares traded'));
      const notFull = panes.volumeTicks.length - fullTicks + (title ? 0 : 1);
      expect(panes.volumeLabelsHidden).toBeLessThanOrEqual(notFull);
      expect(layout.fit.y.hidden).toBeGreaterThanOrEqual(panes.volumeLabelsHidden);
      if (panes.volumeLabelsHidden === 0) expect(title).toBe(true);
    }), { numRuns: 60 });
  });

  it('shows the full labels when they fit, and shortens or hides them on a narrow resize', () => {
    const options = baseOptions({ volumeAxis: { format: long, label: 'Shares' } });
    const wide = stage(options, { width: 1600, height: 400 });
    const narrow = stage(options, { width: 300, height: 400 });
    const volumeTexts = (s: ReturnType<typeof stage>) => textsOf(s.layout).filter(t => t.role === 'tick-y' && t.box.x > s.panes.price.x + s.panes.price.width);
    expect(volumeTexts(wide).map(t => t.lines[0])).toEqual(wide.panes.volumeTicks.map(t => long(t.value)));
    expect(wide.panes.volumeLabelsHidden).toBe(0);
    expect(narrow.layout.kind).toBe('plot');
    expect(narrow.panes.volume).not.toBeNull();
    const shown = volumeTexts(narrow);
    // At 300 px the lane is at most 75 px: no full label fits, so each is shortened (distinct) or hidden and counted.
    for (const t of shown) expect(t.lines[0]).not.toBe(t.full);
    expect(new Set(shown.map(t => t.lines[0])).size).toBe(shown.length);
    expect(narrow.panes.volumeLabelsHidden).toBeGreaterThan(0);
    expect(narrow.layout.kind === 'plot' ? narrow.layout.fit.y.hidden : 0).toBeGreaterThanOrEqual(narrow.panes.volumeLabelsHidden);
  });
});

/** What the shared layout leaves right of the plot when no volume lane is reserved. */
function rightPadding(layout: Layout): number {
  return layout.kind === 'plot' ? layout.width - layout.plot.x - layout.plot.width : 0;
}

describe('N7a volume format, unit and title reach the axis and the readouts', () => {
  it('uses volumeAxis.format for ticks and readouts, the unit in the title and readouts, and the label as title', () => {
    const format = (v: number) => `${v / 1000}k`;
    const rec = record({ width: 720, height: 420 });
    const chart = openFinanceChart(baseOptions({ volumeAxis: { format, unit: 'shares', label: 'Traded' } }),
      (composition, translated) => controllerFor(composition, translated, rec.host).handle);
    rec.frames();
    const committed = rec.committed!;
    const layout = committed.layout;
    if (layout.kind !== 'plot') throw new Error('plot');
    const texts = layout.texts;
    expect(texts.filter(t => t.role === 'title-y').map(t => t.full).sort()).toEqual(['Traded (shares)', 'Value (USD)']);
    const price = layout.plot.x + layout.plot.width;
    const volumeTicks = texts.filter(t => t.role === 'tick-y' && t.box.x >= price).map(t => t.full);
    expect(volumeTicks.length).toBeGreaterThan(0);
    for (const label of volumeTicks) expect(label).toMatch(/^\d+(\.\d+)?k$/u);
    // Readouts: the author's format with the unit, as for prices ('110 USD'). Row 1 has volume 4,200.
    const tip = committed.lookup.tooltip({ kind: 'x', x: Date.UTC(2026, 0, 2) });
    expect(tip.rows.find(r => r.seriesLabel === 'Volume')?.value).toBe(`${format(BASE_ROWS[1]!.v)} shares`);
    const table = committed.reader.table!;
    expect(table.row(1)!.at(-1)).toBe(`${format(BASE_ROWS[1]!.v)} shares`);
    expect(table.row(4)!.at(-1)).toBe(`${format(BASE_ROWS[4]!.v)} shares (invalid volume)`);
    chart.destroy();
  });
});

describe('N7a volume off and on through the public update path', () => {
  it('gives the price pane the whole plot without volume and restores both panes when it comes back', () => {
    const rec = record({ width: 720, height: 420 });
    const chart = openFinanceChart(baseOptions({ volumeAxis: { label: 'Shares' } }),
      (composition, translated) => controllerFor(composition, translated, rec.host).handle);
    rec.frames();
    const panesNow = () => {
      const layout = rec.committed!.layout;
      if (layout.kind !== 'plot') throw new Error('plot');
      return { plot: layout.plot, panes: (layout as unknown as { finance: { price: Rect; volume: Rect | null } }).finance };
    };
    const shown = panesNow();
    expect(shown.panes.volume).not.toBeNull();
    chart.update({ volume: undefined });
    rec.frames();
    const alone = panesNow();
    expect(alone.panes.volume).toBeNull();
    expect(alone.panes.price).toEqual(alone.plot);
    // ~72% of the plot before, all of it now.
    expect(alone.panes.price.height).toBeGreaterThan(shown.panes.price.height * 1.25);
    expect(bottomOf(alone.panes.price)).toBeCloseTo(bottomOf(shown.panes.volume!), 6);
    // Readouts drop the volume row with the field.
    expect(rec.committed!.lookup.tooltip({ kind: 'x', x: Date.UTC(2026, 0, 2) }).rows.map(r => r.seriesLabel)).not.toContain('Volume');
    chart.update({ volume: 'v' });
    rec.frames();
    expect(panesNow().panes.price).toEqual(shown.panes.price);
    expect(panesNow().panes.volume).toEqual(shown.panes.volume);
    chart.destroy();
  });
});

describe('N7a flagged rows through the controller (the Chrome suite\'s #flagged fixture, in Node)', () => {
  it('diagnoses, summarises, qualifies and omits AX180 / AX181 rows from the right marks only', () => {
    const data = [
      { day: '2026-03-02', open: 100, high: 106, low: 99, close: 104, vol: 1000 },
      { day: '2026-03-03', open: 104, high: 103, low: 100, close: 102, vol: 2000 },
      { day: '2026-03-04', open: 104, high: 105, low: 98, close: 100, vol: 3000 },
      { day: '2026-03-05', open: 100, high: 108, low: 99, close: 106, vol: -500 },
      { day: '2026-03-06', open: 106, high: 107, low: 101, close: 102, vol: 4000 },
      { day: '2026-03-07', open: 102, high: 110, low: 101, close: 109, vol: 5000 },
    ];
    const rec = record({ width: 640, height: 380 });
    const chart = openFinanceChart({
      title: 'Flagged rows', data, x: 'day', open: 'open', high: 'high', low: 'low', close: 'close', volume: 'vol', yAxis: { unit: 'USD' },
    }, (composition, translated) => controllerFor(composition, translated, rec.host).handle);
    rec.frames();
    const finance = chart.diagnostics.filter(d => d.code === 'AX180' || d.code === 'AX181')
      .map(d => ({ code: d.code, count: d.count, rows: d.rows })).sort((a, b) => a.code.localeCompare(b.code));
    expect(finance).toEqual([{ code: 'AX180', count: 1, rows: [1] }, { code: 'AX181', count: 1, rows: [3] }]);
    const committed = rec.committed!;
    expect(committed.lookup.count).toBe(6);
    expect(committed.reader.summary).toContain('Values not shown');
    const values = (day: number) => committed.lookup.tooltip({ kind: 'x', x: Date.UTC(2026, 2, day) }).rows.map(r => r.value);
    expect(values(3)).toEqual(['104 USD (invalid OHLC)', '103 USD (invalid OHLC)', '100 USD (invalid OHLC)', '102 USD (invalid OHLC)', '2,000']);
    expect(values(5)).toEqual(['100 USD', '108 USD', '99 USD', '106 USD', '+6 USD (up)', '-500 (invalid volume)']);
    const table = committed.reader.table!;
    expect(table.row(1)!.slice(1, 5)).toEqual(['104 USD (invalid OHLC)', '103 USD (invalid OHLC)', '100 USD (invalid OHLC)', '102 USD (invalid OHLC)']);
    expect(table.row(1)![6]).toBe('omitted');
    expect(table.row(1)![7]).toBe('2,000');
    expect(table.row(3)!.slice(1)).toEqual(['100 USD', '108 USD', '99 USD', '106 USD', '+6 USD', 'up', '-500 (invalid volume)']);
    const scene = rec.draws[rec.draws.length - 1]!;
    expect(rectBoxes(rectsOf(scene, VOLUME_PAINT)!)).toHaveLength(4); // rows 0, 2, 4, 5
    expect(rectBoxes(rectsOf(scene, 1)!)).toHaveLength(2); // down bodies: rows 2 and 4
    chart.destroy();
  });
});
