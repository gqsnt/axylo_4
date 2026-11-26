/**
 * N7a repair of cross-provider review sol-6.2-medium__20261126T183943Z, blockers 1–4, on the real controller
 * (recording host) and the pure stages:
 *  1. revision coherence across author callbacks (tick formatters that update the chart, a strict rejection
 *     whose onDiagnostic makes a valid update);
 *  2. explicit-domain candle geometry (raw extent tested before minimum sizing, directional wicks) and a hollow
 *     interior at any body width;
 *  3. a volume pane kept on short plots where it reads, and disclosed when it cannot be drawn;
 *  4. distinct, nonblank volume tick labels and AX160 only for a drawn fallback.
 *
 * Expected values come from the review's fixtures and the stated rules (an explicit domain is drawn exactly;
 * the hollow stroke is a third of the body between 0.5 and 1.75 px; the price pane keeps 80 px and the volume
 * pane needs 16 px), never from a previous run of this code.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { controllerFor, type Controller } from '../../src/core/controller';
import type { Layout, PathMark, RectMark, Scene } from '../../src/core/contracts';
import type { Committed } from '../../src/dom/interaction';
import { BIN_WIDTH } from '../../src/finance/aggregate';
import { openFinanceChart, type FinanceHandle } from '../../src/finance/chart';
import { financePanes, volumeTicks, type FinancePanes } from '../../src/finance/layout';
import { DOWN_PAINT, hollowStroke, paneOf, UP_PAINT, VOLUME_PAINT } from '../../src/finance/render';
import { createNumberTickLabeler } from '../../src/format';
import { bottomOf, pathsOf, rectBoxes, rectsOf, stage, textsOf } from './fixtures';
import { record, type Recording } from './host';

const THREE = [
  { day: '2026-01-01', o: 100, h: 112, l: 98, c: 110, v: 5000 },
  { day: '2026-01-02', o: 110, h: 111, l: 100, c: 102, v: 4200 },
  { day: '2026-01-03', o: 102, h: 106, l: 99, c: 105, v: 3100 },
];
const day = (n: number) => Date.UTC(2026, 0, n);

function open(options: Record<string, unknown>, size = { width: 720, height: 420 }): {
  rec: Recording; chart: FinanceHandle; controller: () => Controller;
} {
  const rec = record(size);
  let controller: Controller | null = null;
  const chart = openFinanceChart(options, (composition, translated) => {
    controller = controllerFor(composition, translated, rec.host);
    return controller.handle;
  });
  return { rec, chart, controller: () => controller! };
}

const panesOf = (layout: Layout): FinancePanes => {
  const panes = financePanes(layout);
  if (!panes) throw new Error(`no finance panes on a ${layout.kind} layout`);
  return panes;
};
const volumeRects = (scene: Scene | undefined) => (scene ? rectsOf(scene, VOLUME_PAINT) : undefined);
const labelsOf = (committed: Committed) => committed.lookup.tooltip({ kind: 'x', x: day(2) }).rows.map(r => r.seriesLabel);
const titleY = (layout: Layout) => textsOf(layout).filter(t => t.role === 'title-y').map(t => t.full);

/** A frame is coherent when its marks, panes, readouts and table all have volume or all do not. */
function coherent(entry: Recording['commits'][number]): boolean {
  const { committed, scene } = entry;
  const pane = panesOf(committed.layout).volume !== null;
  const bars = volumeRects(scene) !== undefined;
  const readout = labelsOf(committed).includes('Volume');
  const table = committed.reader.table?.headers.includes('Volume') ?? false;
  return pane === bars && bars === readout && readout === table;
}

describe('blocker 1: one revision per frame across author callbacks', () => {
  it('draws frames when yAxis.tickFormat updates the title on every call, and keeps the tick labels memoized', () => {
    let calls = 0;
    let chart: FinanceHandle | null = null;
    const tickFormat = (v: number) => {
      calls++;
      chart?.update({ title: `Title ${calls}` });
      return `$${v}`;
    };
    const opened = open({ title: 'Start', data: THREE, x: 'day', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v', yAxis: { tickFormat } });
    chart = opened.chart;
    const { rec } = opened;
    rec.frames(6);
    // Settled: something was committed and nothing is left queued.
    expect(rec.commits.length).toBeGreaterThan(0);
    expect(rec.frames(6)).toBe(0);
    const committed = rec.committed!;
    expect(committed.layout.kind).toBe('plot');
    // The price ticks are the author's labels; exact readouts and table.
    const priceTicks = committed.layout.kind === 'plot' ? committed.layout.yTicks : [];
    expect(priceTicks.length).toBeGreaterThan(1);
    for (const t of priceTicks) expect(t.label).toBe(`$${t.value}`);
    expect(committed.lookup.tooltip({ kind: 'x', x: day(2) }).rows.map(r => r.value).slice(0, 4)).toEqual(['110', '111', '100', '102']);
    expect(committed.reader.table!.row(2)!.slice(1, 5)).toEqual(['102', '106', '99', '105']);
    expect(rec.commits.every(coherent)).toBe(true);
    // A later valid update still lands, and a true axis-label-only update is drawn.
    const before = calls;
    chart.update({ volumeAxis: { label: 'Shares' } });
    rec.frames(6);
    expect(titleY(rec.committed!.layout)).toContain('Shares');
    chart.update({ yAxis: { tickFormat, label: 'Price per share' } });
    rec.frames(6);
    expect(rec.frames(6)).toBe(0);
    expect(titleY(rec.committed!.layout)).toContain('Price per share');
    expect(calls).toBeGreaterThan(before);
    chart.destroy();
  });

  it('never mixes revisions when volumeAxis.format removes the volume field while formatting 0', () => {
    let chart: FinanceHandle | null = null;
    let removed = false;
    const format = (v: number) => {
      if (v === 0 && !removed) {
        removed = true;
        chart?.update({ volume: undefined, title: 'No volume' });
      }
      return `${v} sh`;
    };
    const opened = open({ title: 'With volume', data: THREE, x: 'day', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v', volumeAxis: { format } });
    chart = opened.chart;
    const { rec } = opened;
    rec.frames(10);
    expect(removed).toBe(true);
    expect(rec.commits.length).toBeGreaterThan(0);
    // Every committed frame is one revision: bars, pane, readout and table agree.
    for (const entry of rec.commits) expect(coherent(entry)).toBe(true);
    const last = rec.commits[rec.commits.length - 1]!;
    expect(panesOf(last.committed.layout).volume).toBeNull();
    expect(volumeRects(last.scene)).toBeUndefined();
    expect(titleY(last.committed.layout)).not.toContain('v');
    expect(last.committed.lookup.count).toBe(3);
    expect(last.committed.reader.table!.headers).not.toContain('Volume');
    // Later valid updates: volume back, drawn with its pane and bars.
    chart.update({ volume: 'v' });
    rec.frames(10);
    const back = rec.commits[rec.commits.length - 1]!;
    expect(panesOf(back.committed.layout).volume).not.toBeNull();
    expect(rectBoxes(volumeRects(back.scene)!)).toHaveLength(3);
    expect(coherent(back)).toBe(true);
    chart.destroy();
  });

  it('keeps a valid update made by onDiagnostic during a strict rejection, over the last accepted options', () => {
    let chart: FinanceHandle | null = null;
    let nested = 0;
    const onDiagnostic = (d: { code: string }) => {
      if (d.code === 'AX180' && nested === 0) {
        nested++;
        chart?.update({ yAxis: { label: 'Nested price' } });
      }
    };
    const opened = open({
      title: 'Strict', strict: true, onDiagnostic, data: THREE, x: 'day', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v',
    });
    chart = opened.chart;
    const { rec } = opened;
    rec.frames();
    const invalid = [...THREE, { day: '2026-01-04', o: 105, h: 100, l: 95, c: 104, v: 2000 }];
    // The rejected call carries a new title too: neither it nor its data may leak into the nested update.
    expect(() => chart!.update({ data: invalid, volumeAxis: { label: 'Rejected' } })).toThrow();
    expect(nested).toBe(1);
    rec.frames();
    const committed = rec.committed!;
    expect(titleY(committed.layout)).toContain('Nested price');
    expect(titleY(committed.layout)).not.toContain('Rejected');
    expect(committed.lookup.count).toBe(3);
    expect(chart.diagnostics.some(d => d.code === 'AX180')).toBe(false);
    // A later valid update keeps the nested one's label (its base) and the accepted data.
    chart.update({ volumeAxis: { label: 'Shares' } });
    rec.frames();
    expect(titleY(rec.committed!.layout)).toEqual(expect.arrayContaining(['Nested price', 'Shares']));
    expect(rec.committed!.lookup.count).toBe(3);
    expect(rec.commits.every(coherent)).toBe(true);
    chart.destroy();
  });

  it('bases an update made by onDiagnostic of an accepted update on that update', () => {
    let chart: FinanceHandle | null = null;
    let nested = 0;
    const onDiagnostic = (d: { code: string }) => {
      if (d.code === 'AX180' && nested === 0) {
        nested++;
        chart?.update({ yAxis: { label: 'After' } });
      }
    };
    const opened = open({ title: 'Loose', onDiagnostic, data: THREE, x: 'day', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v' });
    chart = opened.chart;
    const { rec } = opened;
    rec.frames();
    const invalid = [...THREE, { day: '2026-01-04', o: 105, h: 100, l: 95, c: 104, v: 2000 }];
    chart.update({ data: invalid, volumeAxis: { label: 'Accepted' } });
    expect(nested).toBe(1);
    rec.frames();
    expect(titleY(rec.committed!.layout)).toEqual(expect.arrayContaining(['After', 'Accepted']));
    expect(rec.committed!.lookup.count).toBe(4);
    expect(chart.diagnostics.filter(d => d.code === 'AX180').map(d => d.rows)).toEqual([[3]]);
    chart.destroy();
  });

  it('reads renamed labels from the renamed frame (a label-only update that keeps the columns)', () => {
    const { rec, chart } = open({ title: 'Names', data: THREE, x: 'day', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v' });
    rec.frames();
    chart.update({ open: { field: 'o', label: 'Opening' }, volume: { field: 'v', label: 'Shares traded' } });
    rec.frames();
    const committed = rec.committed!;
    expect(labelsOf(committed)).toEqual(expect.arrayContaining(['Opening', 'Shares traded']));
    expect(committed.reader.table!.headers).toEqual(expect.arrayContaining(['Opening', 'Shares traded']));
    expect(titleY(committed.layout)).toContain('Shares traded');
    expect(committed.lookup.tooltip({ kind: 'x', x: day(2) }).rows.map(r => r.value).slice(0, 4)).toEqual(['110', '111', '100', '102']);
    chart.destroy();
  });

  it('restores both panes after a strict rejection with no nested update', () => {
    const { rec, chart } = open({ title: 'Strict', strict: true, data: THREE, x: 'day', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v' });
    rec.frames();
    const before = panesOf(rec.committed!.layout);
    expect(() => chart.update({ volume: 'missing', yAxis: { domain: [0, 1e6] } })).toThrow();
    rec.frames();
    const after = panesOf(rec.committed!.layout);
    expect(after.price).toEqual(before.price);
    expect(after.volume).toEqual(before.volume);
    chart.update({ yAxis: { label: 'Still live' } });
    rec.frames();
    expect(titleY(rec.committed!.layout)).toContain('Still live');
    chart.destroy();
  });
});

// ───────────────────────────── blocker 2 ─────────────────────────────

/** Segments of a path mark: runs of points between NaN breaks. */
function runs(mark: PathMark): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  for (let i = 0; i < mark.xy.length; i += 2) {
    const x = mark.xy[i]!, y = mark.xy[i + 1]!;
    if (Number.isNaN(x)) { if (cur.length) out.push(cur); cur = []; } else cur.push({ x, y });
  }
  if (cur.length) out.push(cur);
  return out;
}
const wickPath = (scene: Scene) => pathsOf(scene).find(m => m.strokeWidth === 1.25);
const hollowPath = (scene: Scene) => pathsOf(scene).find(m => m.series === UP_PAINT && m.strokeWidth !== 1.25 && m.dash.normal === null && m !== wickPath(scene));

describe('blocker 2: explicit-domain geometry and hollow bodies', () => {
  const rows = [
    { day: '2026-02-02', o: 105, h: 110, l: 101, c: 108, v: 10 },          // inside: two wicks and a body
    { day: '2026-02-03', o: 120.001, h: 120.002, l: 120.001, c: 120.002, v: 10 }, // up, just above 120
    { day: '2026-02-04', o: 120.002, h: 120.002, l: 120.001, c: 120.001, v: 10 }, // down, just above 120
    { day: '2026-02-05', o: 99.998, h: 99.999, l: 99.998, c: 99.999, v: 10 },     // up, just below 100
    { day: '2026-02-06', o: 99.999, h: 99.999, l: 99.998, c: 99.998, v: 10 },     // down, just below 100
  ];
  const options = { data: rows, x: 'day', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v', yAxis: { domain: [100, 120] } };

  it('draws nothing for candles wholly outside [100, 120], however close, and keeps the inside candle whole', () => {
    const { scene, layout, panes } = stage(options);
    if (layout.kind !== 'plot' || layout.projection.kind !== 'xy') throw new Error('plot');
    expect(layout.projection.y.domain).toEqual([100, 120]);
    const xs = (n: number) => layout.projection.kind === 'xy' ? layout.projection.x.map(Date.UTC(2026, 1, n)) : NaN;
    const wicks = runs(wickPath(scene)!);
    // The inside up candle: an upper wick 110 → 108 and a lower wick 105 → 101, nothing else.
    expect(wicks).toHaveLength(2);
    for (const w of wicks) expect(w[0]!.x).toBeCloseTo(xs(2), 6);
    const y = layout.projection.y;
    expect(wicks.map(w => [w[0]!.y, w[1]!.y])).toEqual([
      [expect.closeTo(y.map(110), 4), expect.closeTo(y.map(108), 4)],
      [expect.closeTo(y.map(105), 4), expect.closeTo(y.map(101), 4)],
    ]);
    const bodies = runs(hollowPath(scene)!);
    expect(bodies).toHaveLength(1);
    expect(rectsOf(scene, DOWN_PAINT)).toBeUndefined();
    for (const p of [...wicks.flat(), ...bodies.flat()]) {
      expect(p.y).toBeGreaterThanOrEqual(panes.price.y - 1e-6);
      expect(p.y).toBeLessThanOrEqual(bottomOf(panes.price) + 1e-6);
    }
  });

  it('keeps genuine wicks of candles that cross an explicit edge, directional and cut to the pane', () => {
    const crossing = [
      { day: '2026-02-02', o: 118, h: 125, l: 117, c: 119, v: 10 }, // body inside, upper wick crosses 120
      { day: '2026-02-03', o: 121, h: 124, l: 119, c: 123, v: 10 }, // body above 120, lower wick reaches 119
      { day: '2026-02-04', o: 102, h: 103, l: 95, c: 101, v: 10 },  // down, lower wick crosses 100
    ];
    const { scene, layout, panes } = stage({ ...options, data: crossing });
    if (layout.kind !== 'plot' || layout.projection.kind !== 'xy') throw new Error('plot');
    const y = layout.projection.y;
    const segs = runs(wickPath(scene)!).map(w => [w[0]!.y, w[1]!.y]);
    expect(segs).toEqual([
      [expect.closeTo(panes.price.y, 4), expect.closeTo(y.map(119), 4)], // 125 → 119, cut at the top
      [expect.closeTo(y.map(118), 4), expect.closeTo(y.map(117), 4)],
      [expect.closeTo(panes.price.y, 4), expect.closeTo(y.map(119), 4)], // 121 → 119 only, never reversed
      [expect.closeTo(y.map(103), 4), expect.closeTo(bottomOf(panes.price), 4)], // 103 → 95, cut at the bottom
    ]);
    for (const [a, b] of segs) expect(a!).toBeLessThan(b!);
    // One hollow body (the first candle); the second's body is above the domain.
    expect(runs(hollowPath(scene)!)).toHaveLength(1);
    expect(rectBoxes(rectsOf(scene, DOWN_PAINT)!)).toHaveLength(1);
    for (const m of scene.marks) if (m.type === 'path' && m.dash.normal === null && m.series === UP_PAINT) expect(paneOf(m)?.kind).toBe('price');
  });

  it('for any valid candle and [100, 120]: nothing drawn when wholly outside, directional segments inside the pane (property)', () => {
    const candle = fc.tuple(fc.double({ min: 90, max: 130, noNaN: true }), fc.double({ min: 90, max: 130, noNaN: true }),
      fc.double({ min: 0, max: 5, noNaN: true }), fc.double({ min: 0, max: 5, noNaN: true }))
      .map(([o, c, up, down]) => ({ o, c, h: Math.max(o, c) + up, l: Math.min(o, c) - down }));
    fc.assert(fc.property(candle, ({ o, h, l, c }) => {
      const data = [{ day: '2026-02-02', o, h, l, c, v: 1 }];
      const { scene, panes } = stage({ ...options, data });
      const priceMarks = scene.marks.filter((m): m is PathMark | RectMark =>
        (m.type === 'path' && m.dash.normal === null) || (m.type === 'rects' && m.series !== VOLUME_PAINT));
      if (l > 120 || h < 100) {
        expect(priceMarks).toEqual([]);
        return;
      }
      for (const m of priceMarks) {
        if (m.type === 'path') {
          for (const r of runs(m)) for (const p of r) {
            expect(p.y).toBeGreaterThanOrEqual(panes.price.y - 1e-4);
            expect(p.y).toBeLessThanOrEqual(bottomOf(panes.price) + 1e-4);
          }
        } else {
          for (const b of rectBoxes(m)) {
            expect(b.height).toBeGreaterThan(0);
            expect(b.y).toBeGreaterThanOrEqual(panes.price.y - 1e-4);
            expect(b.y + b.height).toBeLessThanOrEqual(bottomOf(panes.price) + 1e-4);
          }
        }
      }
      const wick = wickPath(scene);
      if (wick) for (const r of runs(wick)) if (r[0]!.x === r[1]!.x) expect(r[0]!.y).toBeLessThan(r[1]!.y);
    }), { numRuns: 80 });
  });

  it('leaves an open interior in dense hollow bodies within their 2 px column', () => {
    const n = 10_000;
    const data = Array.from({ length: n }, (_, i) => ({ t: i, o: 100, h: 102 + (i % 7), l: 98 - (i % 5), c: 100 + 1 + (i % 3), v: 1 }));
    const { scene, panes } = stage({ data, x: 't', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v' });
    expect(panes.bins).not.toBeNull();
    const hollow = hollowPath(scene)!;
    expect(hollow.strokeWidth).toBe(hollowStroke(BIN_WIDTH * 0.75));
    const closed = runs(hollow).filter(r => r.length === 5);
    expect(closed.length).toBeGreaterThan(0);
    for (const r of closed) {
      const width = Math.abs(r[1]!.x - r[0]!.x);
      // Inner width after both half strokes, and the outer extent against the column.
      expect(width - hollow.strokeWidth).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(width + hollow.strokeWidth).toBeLessThanOrEqual(BIN_WIDTH + 1e-6);
    }
    // Up, down and doji keep distinct shapes: outline, filled rect, horizontal tick.
    expect(rectsOf(scene, DOWN_PAINT)).toBeUndefined();
    for (const width of [1.5, 2, 3, 6, 24]) expect(width - hollowStroke(width)).toBeGreaterThanOrEqual(1);
  });
});

// ───────────────────────────── blocker 3 ─────────────────────────────

describe('blocker 3: volume on short plots', () => {
  const short = { title: 'Short', data: THREE, x: 'day', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v' };

  it('keeps a readable volume pane in a measured 720 × 145 plot container', () => {
    const { rec, chart } = open(short, { width: 720, height: 145 });
    rec.frames();
    const { committed, scene } = rec.commits[rec.commits.length - 1]!;
    const panes = panesOf(committed.layout);
    expect(panes.volume).not.toBeNull();
    expect(panes.price.height).toBeGreaterThanOrEqual(80);
    expect(panes.volume!.height).toBeGreaterThanOrEqual(16);
    expect(bottomOf(panes.price)).toBeLessThan(panes.volume!.y);
    expect(rectBoxes(volumeRects(scene)!)).toHaveLength(3);
    expect(panes.volumeTicks.length).toBeGreaterThan(0);
    expect(chart.diagnostics.some(d => d.code === 'AX142')).toBe(false);
    chart.destroy();
  });

  it('discloses a price-only plot and restores the volume pane on resize', () => {
    const size = { width: 720, height: 125 };
    const { rec, chart, controller } = open(short, size);
    rec.frames();
    const omitted = rec.commits[rec.commits.length - 1]!;
    const panes = panesOf(omitted.committed.layout);
    expect(omitted.committed.layout.kind).toBe('plot');
    expect(panes.volume).toBeNull();
    expect(panes.volumeOmitted).toBe(true);
    expect(volumeRects(omitted.scene)).toBeUndefined();
    // Told: a presentation AX142 about the volume field, and the reader's hidden-labels note (fit.y.hidden).
    const ax142 = chart.diagnostics.filter(d => d.code === 'AX142');
    expect(ax142).toHaveLength(1);
    expect(ax142[0]!.field).toBe('v');
    expect(ax142[0]!.message).toContain('volume pane');
    expect(omitted.committed.layout.kind === 'plot' ? omitted.committed.layout.fit.y.hidden : 0).toBeGreaterThanOrEqual(1);
    // Volumes still read exactly.
    expect(omitted.committed.lookup.tooltip({ kind: 'x', x: day(2) }).rows.at(-1)!.value).toBe('4,200');
    size.height = 200;
    controller().invalidate.resize();
    rec.frames();
    const back = rec.commits[rec.commits.length - 1]!;
    expect(panesOf(back.committed.layout).volume).not.toBeNull();
    expect(panesOf(back.committed.layout).volumeOmitted).toBe(false);
    expect(rectBoxes(volumeRects(back.scene)!)).toHaveLength(3);
    expect(chart.diagnostics.some(d => d.code === 'AX142')).toBe(false);
    chart.destroy();
  });
});

// ───────────────────────────── blocker 4 ─────────────────────────────

describe('blocker 4: volume tick labels', () => {
  const ticksOf = (vols: readonly number[], volumeAxis: Record<string, unknown>, size = { width: 720, height: 400 }) => {
    const data = vols.map((v, i) => ({ day: `2026-03-0${i + 2}`, o: 100, h: 104, l: 99, c: 103, v }));
    return stage({ data, x: 'day', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v', volumeAxis }, size);
  };
  const drawnVolumeLabels = (s: ReturnType<typeof stage>) =>
    textsOf(s.layout).filter(t => t.role === 'tick-y' && t.box.x > s.panes.price.x + s.panes.price.width).map(t => t.lines[0]);

  it('never draws alike labels: [0.01, 0.03, 0.05] with maximumFractionDigits 0', () => {
    const s = ticksOf([0.01, 0.03, 0.05], { format: { maximumFractionDigits: 0 } });
    const labels = drawnVolumeLabels(s);
    expect(labels.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) expect(l!.trim()).not.toBe('');
    // Every drawn label must be the format's text for its own value: "0" only at 0.
    for (const t of s.panes.volumeTicks) {
      if (t.label === '0') expect(t.value).toBe(0);
    }
    expect(s.panes.volumeFormatFailed).toBe(false);
  });

  it('reports AX160 only when a drawn tick used the fallback', () => {
    // Throws on 500 only: 500 is not a drawn tick in a pane of three at most.
    const unused = ticksOf([1000, 2000, 3000], { format: (v: number) => { if (v === 500) throw new Error('500'); return `${v / 1000}k`; } });
    expect(unused.panes.volumeTicks.map(t => t.value)).not.toContain(500);
    expect(unused.panes.volumeFormatFailed).toBe(false);
    const stageLayout = unused.layout;
    expect(stageLayout.kind).toBe('plot');
    // Throws on 0, which is drawn: AX160.
    const used = ticksOf([1000, 2000, 3000], { format: (v: number) => { if (v === 0) throw new Error('0'); return `${v / 1000}k`; } });
    expect(used.panes.volumeTicks.map(t => t.value)).toContain(0);
    expect(used.panes.volumeFormatFailed).toBe(true);
  });

  it('rejects blank and duplicate labels even with room to spare, and thins or discloses', () => {
    const blank = ticksOf([1000, 2000, 3000], { format: (v: number) => (v === 0 ? ' ' : `${v}`) }, { width: 1600, height: 600 });
    for (const l of drawnVolumeLabels(blank)) expect(l!.trim()).not.toBe('');
    const same = ticksOf([1000, 2000, 3000], { format: () => 'many' }, { width: 1600, height: 600 });
    const labels = drawnVolumeLabels(same);
    expect(labels.length).toBeLessThanOrEqual(1);
    // Nothing reads as a value: no label at all is drawn, and that is disclosed.
    const none = ticksOf([1000, 2000, 3000], { format: () => '   ' }, { width: 1600, height: 600 });
    expect(drawnVolumeLabels(none)).toEqual([]);
    expect(none.panes.volumeLabelsHidden).toBeGreaterThanOrEqual(1);
    expect(none.layout.kind === 'plot' ? none.layout.fit.y.hidden : 0).toBeGreaterThanOrEqual(1);
  });

  it('chooses lazily: a set is labelled only when considered, and thins a short pane to one tick', () => {
    const seen: number[] = [];
    const label = createNumberTickLabeler({ locale: 'en-US', tickFormat: (v: number) => { seen.push(v); return `${v}`; } });
    const ticks = volumeTicks(3000, 120, 15, label);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (const v of seen) expect(seen.filter(x => x === v)).toHaveLength(1);
    // A 16 px pane cannot hold two 15 px labels: the top tick alone (it differs from the baseline's label).
    const one = volumeTicks(3000, 16, 15, createNumberTickLabeler({ locale: 'en-US' }));
    expect(one).toHaveLength(1);
    expect(one[0]!.value).toBeGreaterThan(0);
  });

  it('for any maximum, pane and formatter: drawn volume tick labels are nonblank and distinct (property)', () => {
    const texts = fc.array(fc.constantFrom('0', '1', ' ', '', 'k', '1k'), { minLength: 1, maxLength: 6 });
    fc.assert(fc.property(fc.double({ min: 1e-6, max: 1e12, noNaN: true }), fc.integer({ min: 16, max: 300 }), texts, (max, pane, pool) => {
      let i = 0;
      const label = createNumberTickLabeler({ locale: 'en-US', tickFormat: () => pool[i++ % pool.length]! });
      const ticks = volumeTicks(max, pane, 15, label);
      const shown = ticks.map(t => t.label.trim());
      expect(shown.every(Boolean)).toBe(true);
      expect(new Set(shown).size).toBe(shown.length);
      expect(ticks.length).toBeLessThanOrEqual(3);
      for (const t of ticks) expect(t.value >= 0 && t.value <= max).toBe(true);
    }), { numRuns: 200 });
  });

  it('keeps exact readout formatting', () => {
    const { rec, chart } = open({
      title: 'Readout', data: THREE, x: 'day', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v',
      volumeAxis: { format: { maximumFractionDigits: 0 }, unit: 'shares' },
    });
    rec.frames();
    const format = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format;
    expect(rec.committed!.lookup.tooltip({ kind: 'x', x: day(2) }).rows.at(-1)!.value).toBe(`${format(4200)} shares`);
    chart.destroy();
  });
});
