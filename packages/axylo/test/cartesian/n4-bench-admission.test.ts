/**
 * The benchmark runner's admission path for the `axylo/cartesian` workloads (RFC C4.1 §8), in Node.
 *
 * The chart is the real Cartesian pipeline (n4-pipeline.ts: options → frame → view → layout → scene) at the
 * harness's 800 × 400 px chart, fed the options the benchmark adapter builds (bench/src/cartesian.js
 * cartesianOptions). Its SVG output is what render/svg.ts would write: the line's `d` (pathData) and the bars'
 * rectangles rounded to two decimals. That readback goes through the adapter's own cartesianReadback and the
 * runner's own admit() (bench/lib/driver.mjs), with the fixture checksum the page would report. Expected facts are
 * the fixture's, never this chart's output: admit derives them from the generator.
 *
 * Covered: first, zoom (the runner's final zoom window) and hover for the dual-axis line + bar workload, and the
 * one-line workload; acceptance of the real geometry; refusal of synthetic kept indexes, of a missing or moved
 * line stroke, of missing, shifted, rescaled or wrongly based bars, and of series matched by position.
 */
import { describe, expect, it } from 'vitest';
import { SLOT_VALUE, type PathMark, type RectMark } from '../../src/core/contracts';
import { pathData } from '../../src/render/svg';
import { run } from './n4-pipeline';

interface Admission { admitted: boolean; reasons: string[] }
interface Fixture { x: Float64Array; ys: Float64Array[]; names: string[]; title?: string; cartesian?: { layout: string } }
type Seen = Record<string, unknown> & { series: unknown[]; cartesian?: Record<string, unknown> };

const bench = '../../../../bench';
const driver = await import(/* @vite-ignore */ `${bench}/lib/driver.mjs`) as {
  admit(spec: unknown, result: unknown, floor: boolean, opts: { requireDrawn: boolean }): Admission;
  expectedFor(workload: string, params: unknown): { checksum: string };
};
const fixtures = await import(/* @vite-ignore */ `${bench}/src/fixtures.js`) as {
  workloadData(workload: string, params: unknown): Fixture[];
  zoomSteps(fix: Fixture): [number, number][];
};
const cartesianModule = await import(/* @vite-ignore */ `${bench}/src/cartesian.js`) as {
  cartesianOptions(fix: Fixture, lineOptions: Record<string, unknown>): Record<string, unknown>;
  cartesianReadback(chart: unknown, el: unknown, fix: Fixture, seen: unknown, args: { probe?: string | null }): Seen;
};
const common = await import(/* @vite-ignore */ `${bench}/src/adapters/axylo-common.js`) as {
  parsePolylines(d: string): number[][];
};

const round = (v: number) => Math.round(v * 100) / 100;

/** What the page reads from a chart drawn by the real pipeline, through the adapter's readback. */
function readback(fix: Fixture, zoom: readonly [number, number] | null) {
  const columns: Record<string, Float64Array> = { t: fix.x };
  fix.names.forEach((name, i) => { columns[name] = fix.ys[i]!; });
  const lineOptions = { title: fix.title ?? 'Benchmark', data: { columns }, x: { field: 't', type: 'time', timeZone: 'UTC' }, y: fix.names };
  const res = run(cartesianModule.cartesianOptions(fix, lineOptions), { width: 800, height: 400, dpr: 1, zoom });
  if (res.layout.kind !== 'plot' || res.layout.projection.kind !== 'xy') throw new Error('expected an xy plot');
  const { plot, projection } = res.layout;
  const frame = res.view.frame;
  // The shared root hook's describe(): series in frame order, the left axis's domain, the plot.
  const hook = {
    xDomain: projection.x.type === 'band' ? null : projection.x.domain, yDomain: projection.y.domain, plot: { ...plot }, renderer: 'svg',
    // The Cartesian hook's addition (src/cartesian.ts): the y axes the scene was drawn on.
    yAxes: (projection.yAxes ?? [projection.y]).map(a => ({ type: a.type, domain: a.domain, range: a.range })),
    series: frame.series.map(s => {
      let missing = 0;
      for (let i = 0; i < frame.length; i++) if (s.slot[i] !== SLOT_VALUE) missing++;
      return { key: s.key, points: frame.length, oldestX: frame.x.values[0], newestX: frame.x.values[frame.length - 1], missing };
    }),
  };
  const lineIndex = frame.series.findIndex(s => s.key === fix.names[0]);
  const path = res.scene.marks.find((m): m is PathMark => m.type === 'path' && (m as PathMark).series === lineIndex)!;
  const rects = res.scene.marks.filter((m): m is RectMark => m.type === 'rects');
  const rectElements = rects.flatMap(m => Array.from({ length: m.xywh.length / 4 }, (_, k) => {
    const [x, y, width, height] = Array.from(m.xywh.subarray(4 * k, 4 * k + 4), round);
    return { style: { fill: '' }, x: { baseVal: { value: x } }, y: { baseVal: { value: y } }, width: { baseVal: { value: width } }, height: { baseVal: { value: height } } };
  }));
  const el = { querySelectorAll: () => rectElements };
  // The root adapter's generic readback (the part cartesianReadback keeps): domains, renderer, captured strokes.
  const generic = {
    reads: 'test', renderer: { kind: 'svg', dom: 'svg', canvases: 0, svgs: 1 }, x: hook.xDomain, y: hook.yDomain,
    series: hook.series.map(s => ({ ...s, drawn: { kind: 'kept', kept: [0] } })),
    drawnPixels: { plot: hook.plot, strokes: [{ color: 'x', polylines: common.parsePolylines(pathData(path.xy)) }] },
  };
  const g = globalThis as { getComputedStyle?: unknown };
  const saved = g.getComputedStyle;
  g.getComputedStyle = () => ({ fill: 'rgb(0, 0, 0)' });
  try {
    return cartesianModule.cartesianReadback({ __bench: { describe: () => hook } }, el, fix, generic, { probe: 'geometry' });
  } finally {
    g.getComputedStyle = saved;
  }
}

const workloads = [
  ['first', { kind: 'cartesian', size: '1x100000' }],
  ['zoom', { kind: 'cartesian', size: '1x100000' }],
  ['hover', { kind: 'cartesian', size: '1x100000', moves: 20 }],
  ['first', { kind: undefined, size: '1x100000' }],
] as const;

function admitted(workload: string, params: unknown, seen: Seen | null) {
  const exp = driver.expectedFor(workload, params);
  return driver.admit({ workload, params }, { checksum: exp.checksum, describe: [seen], adapter: { library: 'Axylo' } }, false, { requireDrawn: true });
}

describe('N4 bench admission of axylo/cartesian through the runner\'s admit()', () => {
  for (const [workload, params] of workloads) {
    const label = `${workload} ${JSON.stringify(params)}`;
    const fix = fixtures.workloadData(workload, params)[0]!;
    const zoom = workload === 'zoom' ? fixtures.zoomSteps(fix).at(-1)! : null;
    const seen = readback(fix, zoom);

    it(`admits the real drawing (${label})`, () => {
      const result = admitted(workload, params, seen);
      expect(result.reasons).toEqual([]);
      expect(result.admitted).toBe(true);
      // The geometry is the chart's own: a bounded F5 stroke (four per device-pixel column of an 800 px chart)
      // and, for the dual-axis layout, one rectangle per bar value in the window (plus clipped neighbours).
      const strokes = (seen.drawnPixels as { strokes: { polylines: number[][] }[] }).strokes;
      const vertices = strokes[0]!.polylines.reduce((n, p) => n + p.length / 2, 0);
      expect(vertices).toBeGreaterThan(100);
      expect(vertices).toBeLessThanOrEqual(4 * 800 + 8);
      if (params.kind === 'cartesian') {
        const n = ((seen.cartesian!.bars as { xywh: number[] }).xywh.length) / 4;
        const xs = fix.x;
        const inWindow = zoom ? xs.filter(v => v >= zoom[0] && v <= zoom[1]).length : xs.length;
        expect(n).toBeGreaterThanOrEqual(inWindow);
        expect(n).toBeLessThanOrEqual(inWindow + 2);
        expect(inWindow).toBeGreaterThan(zoom ? 10 : 99_999);
      }
    });

    it(`refuses kept indexes, and a missing or moved line stroke (${label})`, () => {
      const series = seen.series as Record<string, unknown>[];
      const kept = { ...seen, series: [{ ...series[0], drawn: { kind: 'kept', kept: [0, 1] } }, ...series.slice(1)] };
      expect(admitted(workload, params, kept).admitted).toBe(false);
      const pixels = seen.drawnPixels as { plot: unknown; strokes: { polylines: number[][] }[] };
      expect(admitted(workload, params, { ...seen, drawnPixels: { ...pixels, strokes: [] } }).admitted).toBe(false);
      const moved = pixels.strokes.map(s => ({ ...s, polylines: s.polylines.map(p => p.map((v, j) => (j % 2 ? v + 25 : v))) }));
      expect(admitted(workload, params, { ...seen, drawnPixels: { ...pixels, strokes: moved } }).admitted).toBe(false);
    });

    if (params.kind === 'cartesian') {
      it(`refuses missing, shifted, rescaled or wrongly based bars, and series by position (${label})`, () => {
        const c = seen.cartesian!;
        const xywh = (c.bars as { xywh: number[] }).xywh;
        const withBars = (next: number[] | null) => ({ ...seen, cartesian: { ...c, bars: next ? { kind: 'rectangles', xywh: next } : { kind: 'not-captured', reason: 'test' } } });
        expect(admitted(workload, params, withBars(null)).admitted).toBe(false);
        expect(admitted(workload, params, withBars(xywh.slice(0, xywh.length - 40))).admitted).toBe(false);
        expect(admitted(workload, params, withBars(xywh.map((v, j) => (j % 4 === 0 ? v + 20 : v)))).admitted).toBe(false);
        // Every bar 30 % shorter, on the same baseline: heights no longer show the values in proportion,
        // except the tallest is kept, so the factor is the true one.
        let tallest = 0;
        for (let k = 1; k < xywh.length / 4; k++) if (xywh[4 * k + 3]! > xywh[4 * tallest + 3]!) tallest = k;
        const shorter = xywh.slice();
        for (let k = 0; k < xywh.length / 4; k++) {
          if (k === tallest) continue;
          const h = shorter[4 * k + 3]!;
          shorter[4 * k + 1] = shorter[4 * k + 1]! + 0.3 * h;
          shorter[4 * k + 3] = 0.7 * h;
        }
        expect(admitted(workload, params, withBars(shorter)).admitted).toBe(false);
        const floating = xywh.map((v, j) => (j % 4 === 1 ? v - 10 : v));
        expect(admitted(workload, params, withBars(floating.map((v, j) => (j % 4 === 1 && Math.floor(j / 4) === tallest ? xywh[j]! : v)))).admitted).toBe(false);
        // Proportion-preserving fakes that only the committed right-axis mapping exposes.
        const zeroWidth = xywh.map((v, j) => (j % 4 === 2 ? 0 : v));
        expect(admitted(workload, params, withBars(zeroWidth)).admitted).toBe(false);
        const halved = xywh.slice();
        for (let k = 0; k < xywh.length / 4; k++) {
          const h = halved[4 * k + 3]!;
          // Every bar half as tall on its own baseline (the fixture's bars are positive): proportions still hold.
          halved[4 * k + 1] = halved[4 * k + 1]! + h / 2;
          halved[4 * k + 3] = h / 2;
        }
        const halvedResult = admitted(workload, params, withBars(halved));
        expect(halvedResult.admitted).toBe(false);
        expect(halvedResult.reasons.some(r => r.includes('committed right-axis mapping'))).toBe(true);
        const withDomain = (rightDomain: unknown) => ({ ...seen, cartesian: { ...c, rightDomain } });
        expect(admitted(workload, params, withDomain(null)).admitted).toBe(false);
        expect(admitted(workload, params, withDomain([5, 1])).admitted).toBe(false);
        expect(admitted(workload, params, withDomain([Number.NaN, 10])).admitted).toBe(false);
        expect(admitted(workload, params, withDomain(['0', '10'])).admitted).toBe(false);
        expect(admitted(workload, params, withDomain([1, 2])).admitted).toBe(false);
        // The real readback carries the right axis's committed domain, containing zero.
        const rd = c.rightDomain as number[];
        expect(rd).toHaveLength(2);
        expect(rd[0]!).toBeLessThanOrEqual(0);
        expect(rd[1]!).toBeGreaterThan(rd[0]!);
        const series = seen.series;
        expect(admitted(workload, params, { ...seen, series: [series[1], series[0]] }).admitted).toBe(false);
        // A root readback (no Cartesian section) is never admitted for the dual-axis workload.
        expect(admitted(workload, params, { ...seen, cartesian: undefined }).admitted).toBe(false);
      });
    }
  }
});
