/**
 * The default palette (spec A5, L2; decision 0003). Constraints 1–6 of the decision, measured here with code
 * of this file's own (WCAG 2 contrast; OKLab; Machado et al. 2009 color-vision simulation at severity 1.0 in
 * linear RGB, clamped, as research/harness/palette.mjs scored the ten libraries), each in two forms: analytic, on
 * unrounded values, and quantised, on the bytes an 8-bit image holds (simulated colors rounded to bytes; fills
 * through an 8-bit raster model, at the worst case within one byte per channel, and as Chrome drew them).
 * Then the record the research scorer wrote (research/palette/palette.json) is compared field by field at the
 * precision it was written in, and its browser-measured parts (strokes, Chrome fill pixels) are validated against
 * the shipped colors.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { contrastRatio, parseColor, type Rgba } from '../../src/theme/color';
import { DARK, LIGHT } from '../../src/theme/palette';
import { AXYLO_CSS } from '../../src/theme/css';

type Vec3 = readonly [number, number, number];
type Vision = 'normal' | 'protan' | 'deutan' | 'tritan';

const c = (s: string): Rgba => parseColor(s)!;
const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const enc = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const srgb = (hex: string): Vec3 => { const p = c(hex); return [p.r, p.g, p.b]; };
const bytesOf = (hex: string): Vec3 => srgb(hex).map(v => Math.round(v * 255)) as unknown as Vec3;
const vec = (f: (i: 0 | 1 | 2) => number): Vec3 => [f(0), f(1), f(2)];

function oklab([r, g, b]: Vec3): Vec3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

const MACHADO: Record<Vision, readonly Vec3[]> = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const VISIONS = Object.keys(MACHADO) as Vision[];

/** Linear RGB of a gamma-encoded sRGB color as seen with `vision`, clamped. */
const simulated = (rgb: Vec3, vision: Vision): Vec3 => {
  const l = vec(i => lin(rgb[i]));
  return vec(i => clamp01(MACHADO[vision][i]![0] * l[0] + MACHADO[vision][i]![1] * l[1] + MACHADO[vision][i]![2] * l[2]));
};
/** OKLab of a color as seen with `vision`, unrounded. */
const seen = (rgb: Vec3, vision: Vision): Vec3 => oklab(simulated(rgb, vision));
/** OKLab of a byte color. */
const labOfBytes = (b: Vec3): Vec3 => oklab(vec(i => lin(b[i] / 255)));
/** OKLab of the simulated color after encoding and rounding to bytes, as a simulated 8-bit image holds it. */
const seenBytes = (hex: string, vision: Vision): Vec3 => labOfBytes(vec(i => Math.round(255 * enc(simulated(srgb(hex), vision)[i]))));
const delta = (p: Vec3, q: Vec3): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const oklch = (hex: string): Vec3 => { const [L, a, b] = seen(srgb(hex), 'normal'); return [L, Math.hypot(a, b), (Math.atan2(b, a) * 180 / Math.PI + 360) % 360]; };
const hueDifference = (a: number, b: number): number => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
/** Source-over at `alpha` in gamma-encoded sRGB, as the browser composites a translucent fill, unrounded. */
const over = (hex: string, alpha: number, bg: string): Vec3 => { const f = srgb(hex), b = srgb(bg); return vec(i => f[i] * alpha + b[i] * (1 - alpha)); };
/** The same fill on an 8-bit raster: alpha quantised to round(alpha × 255) (or floor, as another rasterizer did), channels rounded. */
const raster = (hex: string, alpha: number, bg: string, quantise: (x: number) => number = Math.round): Vec3 => {
  const k = quantise(alpha * 255), f = bytesOf(hex), b = bytesOf(bg);
  return vec(i => Math.round((f[i] * k + b[i] * (255 - k)) / 255));
};
/** Smallest difference between any byte colors within one byte per channel of `a` and of `b`. */
function worstWithinOneByte(a: Vec3, b: Vec3): number {
  const box = (p: Vec3): Vec3[] => {
    const out: Vec3[] = [];
    for (const i of [-1, 0, 1]) for (const j of [-1, 0, 1]) for (const k of [-1, 0, 1]) out.push(labOfBytes(vec(n => Math.min(255, Math.max(0, p[n] + [i, j, k][n]!)))));
    return out;
  };
  const pa = box(a), pb = box(b);
  let m = Infinity;
  for (const p of pa) for (const q of pb) m = Math.min(m, delta(p, q));
  return m;
}
const hexBytes = (hex: string): Vec3 => bytesOf(hex);

/** Smallest pairwise difference among `colors` under `vision`, with the slots (1-based) of the pair. */
function closest(colors: readonly string[], vision: Vision, labOf: (hex: string, v: Vision) => Vec3 = (h, v) => seen(srgb(h), v)): { d: number; pair: [number, number] } {
  const labs = colors.map(h => labOf(h, vision));
  let d = Infinity, pair: [number, number] = [0, 0];
  for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) {
    const x = delta(labs[i]!, labs[j]!);
    if (x < d) { d = x; pair = [i + 1, j + 1]; }
  }
  return { d, pair };
}

/** Equal at the precision the record was written in (rounded to `digits` decimals). */
const atPrecision = (measured: number, recorded: number, digits: number): boolean => Math.abs(measured - recorded) <= 0.5 * 10 ** -digits + 1e-9;

interface PairRecord { min: number; pair: number[] }
interface StrokeStats { columns: number; columnsWithoutFullCoverage: number; core: { p10: number; median: number }; weighted: { p10: number; median: number } }
interface RecordScheme {
  background: string;
  tokens: Record<'axis' | 'grid' | 'muted' | 'reference' | 'focus', string>;
  lightness: { min: number; max: number; firstThreeSpread: number; maxChroma: number };
  previewImage: Record<string, { pixels: string[]; min: number; pair: number[] }>;
  series: { slot: number; hex: string; oklch: number[]; contrast: number; hueDiffToOtherScheme: number }[];
  minDelta: Record<Vision, PairRecord>;
  prefixes: Record<string, Record<Vision, PairRecord>>;
  minDeltaBytes: Record<Vision, PairRecord>;
  prefixesBytes: Record<string, Record<Vision, PairRecord>>;
  tokenDistance: Record<string, { min: number; slot: number }>;
  composites: Record<string, Record<Vision, { minNeighbour: number; pair: number[]; neighbours: number[]; ringClosures: { slots: number[]; d: number }[] }>>;
  raster: Record<string, { model: string[]; modelFloor: string[]; neighboursModel: number[]; neighboursWorstWithinOneByte: number[] }>;
  chromeRaster: Record<string, Record<string, { pixels: string[]; neighbours: number[]; min: number }>>;
}
interface StrokeRecord { schemes: Record<'light' | 'dark', { background: string; rows: ({ color: string; swatch: number } & Record<string, StrokeStats | string | number>)[] }> }
const SCHEMES = [['light', LIGHT, DARK], ['dark', DARK, LIGHT]] as const;
const ALPHAS = [0.25, 0.8] as const;
const research = (file: string): string => path.resolve(import.meta.dirname, '../../../../research/palette', file);
const record = JSON.parse(fs.readFileSync(research('palette.json'), 'utf8')) as
  { schemes: Record<'light' | 'dark', RecordScheme>; strokes: StrokeRecord; refused: string[]; oneByteEdits: Record<'light' | 'dark', { edits: number; stillMeetEveryCheck: number }> };
/** The raw stroke measurement (strokes.mjs): per renderer, base64 of [count, channel bytes…] per pixel column. */
const strokesRaw = JSON.parse(gunzipSync(fs.readFileSync(research('strokes-raw.json.gz'))).toString('utf8')) as
  { schemes: Record<'light' | 'dark', { background: string; rows: ({ color: string; channel: number } & Record<string, string | number>)[] }> };
const RENDERERS = ['canvas@1', 'svg@1', 'canvas@2', 'svg@2'] as const;

/** Stroke statistics from raw channel bytes, independently of research/palette/color.mjs (same definition). */
function strokeStats(ink: string, bg: string, ch: 0 | 1 | 2, encoded: string): StrokeStats {
  const raw = Buffer.from(encoded, 'base64'), columns: number[][] = [];
  for (let i = 0; i < raw.length;) { const n = raw[i]!; columns.push([...raw.subarray(i + 1, i + 1 + n)]); i += 1 + n; }
  const inkB = hexBytes(ink)[ch], bgB = hexBytes(bg)[ch], f = srgb(ink), b = srgb(bg);
  const at = (k: number): number => {
    const px = vec(i => Math.round(255 * (b[i] + k * (f[i] - b[i]))));
    return contrastRatio({ r: px[0] / 255, g: px[1] / 255, b: px[2] / 255, a: 1 }, c(bg));
  };
  const used = columns.filter(vs => vs.length);
  const cov = (vs: number[]): number[] => vs.map(v => Math.min(1, (v - bgB) / (inkB - bgB)));
  const pct = (xs: number[]): { p10: number; median: number } => { xs.sort((x, y) => x - y); return { p10: xs[Math.floor(xs.length * 0.1)]!, median: xs[Math.floor(xs.length / 2)]! }; };
  return {
    columns: used.length,
    columnsWithoutFullCoverage: used.filter(vs => !vs.includes(inkB)).length,
    core: pct(used.map(vs => at(Math.max(...cov(vs))))),
    weighted: pct(used.map(vs => { const k = cov(vs); return at(k.reduce((x, y) => x + y * y, 0) / k.reduce((x, y) => x + y, 0)); })),
  };
}

/**
 * Every required check of the decision for one scheme, as score.mjs applies them: contrast; pairwise and prefix
 * minima analytic and in bytes; hue match against the other scheme; token distances; fills ideal and on both
 * 8-bit raster models. Used to recount the one-byte-edit record.
 */
function meetsEveryCheck(series: readonly string[], scheme: typeof LIGHT, otherSeries: readonly string[]): boolean {
  const bg = c(scheme.background);
  if (series.some(color => contrastRatio(c(color), bg) < 3)) return false;
  for (const v of VISIONS) for (const labOf of [undefined, seenBytes]) {
    if (closest(series, v, labOf).d < 0.10) return false;
    for (const n of [3, 4, 5, 6]) if (closest(series.slice(0, n), v, labOf).d < (n === 4 ? 0.14 : 0.10)) return false;
  }
  if (series.some((color, k) => hueDifference(oklch(color)[2], oklch(otherSeries[k]!)[2]) > 30)) return false;
  for (const token of ['focus', 'reference', 'muted'] as const) {
    const t = seen(srgb(scheme[token]), 'normal');
    if (series.some(color => delta(seen(srgb(color), 'normal'), t) < 0.10)) return false;
  }
  for (const alpha of ALPHAS) {
    const labs = series.map(color => seen(over(color, alpha, scheme.background), 'normal'));
    for (const quantise of [Math.round, Math.floor]) {
      const px = series.map(color => labOfBytes(raster(color, alpha, scheme.background, quantise)));
      for (let k = 0; k + 1 < 8; k++) if (delta(labs[k]!, labs[k + 1]!) < 0.06 || delta(px[k]!, px[k + 1]!) < 0.06) return false;
    }
  }
  return true;
}


describe('scoring code used below', () => {
  it('reproduces known OKLab values and leaves grays alone under every simulation', () => {
    const white = seen([1, 1, 1], 'normal');
    expect(white[0]).toBeCloseTo(1, 4);
    expect(Math.hypot(white[1], white[2])).toBeLessThan(1e-4);
    // Ottosson's reference value for sRGB red.
    const red = seen([1, 0, 0], 'normal');
    expect(red[0]).toBeCloseTo(0.6279554, 4);
    expect(red[1]).toBeCloseTo(0.2248631, 4);
    expect(red[2]).toBeCloseTo(0.1258463, 4);
    for (const v of VISIONS) {
      expect(delta(seen(srgb('#777777'), v), seen(srgb('#777777'), 'normal')), v).toBeLessThan(0.002);
      // A gray survives simulation and byte rounding within one byte.
      expect(delta(seenBytes('#777777', v), labOfBytes(hexBytes('#777777'))), v).toBeLessThan(0.004);
    }
    // Deuteranopia collapses red and green toward the same hue: the classic confusion pair gets much closer.
    expect(delta(seen(srgb('#d62728'), 'deutan'), seen(srgb('#2ca02c'), 'deutan'))).toBeLessThan(0.5 * delta(seen(srgb('#d62728'), 'normal'), seen(srgb('#2ca02c'), 'normal')));
  });

  it('models an 8-bit fill within one byte of the pixels two rasterizers produced', () => {
    // A CPU Skia raster of the review of 51e1be5 drew #5f2083 and #ba5f50 at 25% over white as #d7c8e0 and #eed7d4.
    for (const [color, drawn] of [['#5f2083', '#d7c8e0'], ['#ba5f50', '#eed7d4']] as const) {
      const m = raster(color, 0.25, '#ffffff'), d = hexBytes(drawn);
      for (const i of [0, 1, 2] as const) expect(Math.abs(m[i] - d[i]), `${color} channel ${i}`).toBeLessThanOrEqual(1);
    }
    expect(worstWithinOneByte([10, 20, 30], [10, 20, 30])).toBe(0);
    expect(worstWithinOneByte([10, 20, 30], [10, 20, 33])).toBeGreaterThan(0);
  });
});

describe('default palette (spec A5, decision 0003)', () => {
  for (const [name, scheme, other] of SCHEMES) {
    const series = scheme.series;
    const r = record.schemes[name];

    it(`${name}: eight distinct series colors`, () => {
      expect(series).toHaveLength(8);
      expect(new Set(series).size).toBe(8);
      for (const color of series) expect(color).toMatch(/^#[0-9a-f]{6}$/);
    });

    it(`${name}: 1. every series color reaches 3:1 on the default background`, () => {
      const bg = c(scheme.background);
      for (const color of series) expect(contrastRatio(c(color), bg), color).toBeGreaterThanOrEqual(3);
    });

    it(`${name}: 2. the eight are at least 0.10 apart in OKLab under normal vision and simulated protanopia, deuteranopia, tritanopia`, () => {
      for (const v of VISIONS) {
        const { d, pair } = closest(series, v);
        expect(d, `${v}: slots ${pair.join(' and ')}`).toBeGreaterThanOrEqual(0.10);
      }
    });

    it(`${name}: 2. the same after the simulated colors are rounded to bytes`, () => {
      for (const v of VISIONS) {
        const { d, pair } = closest(series, v, seenBytes);
        expect(d, `${v}: slots ${pair.join(' and ')}`).toBeGreaterThanOrEqual(0.10);
      }
    });

    it(`${name}: 3. the first three, four, five and six are at least 0.10 apart, the first four at least 0.14 (analytic and in bytes)`, () => {
      for (const n of [3, 4, 5, 6]) for (const v of VISIONS) for (const labOf of [undefined, seenBytes]) {
        const { d, pair } = closest(series.slice(0, n), v, labOf);
        expect(d, `first ${n}, ${v}${labOf ? ', bytes' : ''}: slots ${pair.join(' and ')}`).toBeGreaterThanOrEqual(n === 4 ? 0.14 : 0.10);
      }
    });

    it(`${name}: 4. slot k is the same hue family in both schemes (OKLCH hue within 30°)`, () => {
      series.forEach((color, k) => {
        expect(hueDifference(oklch(color)[2], oklch(other.series[k]!)[2]), `slot ${k + 1}: ${color} / ${other.series[k]}`).toBeLessThanOrEqual(30);
      });
    });

    it(`${name}: 5. no series color is within 0.10 of the focus or reference token (nor muted, the donut's "Other" slice)`, () => {
      for (const token of ['focus', 'reference', 'muted'] as const) {
        const t = seen(srgb(scheme[token]), 'normal');
        for (const color of series) expect(delta(seen(srgb(color), 'normal'), t), `${color} vs ${token} ${scheme[token]}`).toBeGreaterThanOrEqual(0.10);
      }
    });

    it(`${name}: 6. neighbours k and k+1 stay 0.06 apart as fills at 25% and 80% over the background`, () => {
      for (const alpha of ALPHAS) {
        const labs = series.map(color => seen(over(color, alpha, scheme.background), 'normal'));
        for (let k = 0; k + 1 < labs.length; k++) {
          expect(delta(labs[k]!, labs[k + 1]!), `${alpha * 100}%: slots ${k + 1} and ${k + 2}`).toBeGreaterThanOrEqual(0.06);
        }
      }
    });

    it(`${name}: 6. the same on an 8-bit raster, with alpha quantised by rounding and by flooring`, () => {
      for (const alpha of ALPHAS) for (const quantise of [Math.round, Math.floor]) {
        const px = series.map(color => raster(color, alpha, scheme.background, quantise));
        for (let k = 0; k + 1 < px.length; k++) {
          expect(delta(labOfBytes(px[k]!), labOfBytes(px[k + 1]!)), `${alpha * 100}%, ${quantise.name}: slots ${k + 1} and ${k + 2}`).toBeGreaterThanOrEqual(0.06);
        }
      }
    });

    it(`${name}: 6. the same on the pixels Chrome drew (research/palette/raster.json, canvas and SVG)`, () => {
      expect(record.refused).toEqual([]);
      expect(Object.keys(r.chromeRaster).sort()).toEqual(['canvas', 'svg']);
      for (const [via, byAlpha] of Object.entries(r.chromeRaster)) {
        expect(Object.keys(byAlpha).map(Number).sort()).toEqual([...ALPHAS]);
        for (const alpha of ALPHAS) {
          const drawn = byAlpha[String(alpha)]!.pixels;
          expect(drawn).toHaveLength(8);
          drawn.forEach((hex, k) => {
            // The recorded pixel is a fill of this slot's color: within one byte of the model.
            const m = raster(series[k]!, alpha, scheme.background), d = hexBytes(hex);
            for (const i of [0, 1, 2] as const) expect(Math.abs(m[i] - d[i]), `${via} ${alpha} slot ${k + 1}`).toBeLessThanOrEqual(1);
          });
          for (let k = 0; k + 1 < drawn.length; k++) {
            expect(delta(labOfBytes(hexBytes(drawn[k]!)), labOfBytes(hexBytes(drawn[k + 1]!))), `${via} ${alpha * 100}%: slots ${k + 1} and ${k + 2}`).toBeGreaterThanOrEqual(0.06);
          }
        }
      }
    });

    it(`${name}: the research record holds these colors, its tokens, and the measured fields listed in research/palette/README.md at their written precision`, () => {
      expect(r.background).toBe(scheme.background);
      expect(r.tokens).toEqual({ axis: scheme.axis, grid: scheme.grid, muted: scheme.muted, reference: scheme.reference, focus: scheme.focus });
      const Ls = series.map(color => oklch(color)[0]), Cs = series.map(color => oklch(color)[1]);
      expect(atPrecision(Math.min(...Ls), r.lightness.min, 3) && atPrecision(Math.max(...Ls), r.lightness.max, 3), 'lightness range').toBe(true);
      expect(atPrecision(Math.max(...Ls.slice(0, 3)) - Math.min(...Ls.slice(0, 3)), r.lightness.firstThreeSpread, 3), 'first-three spread').toBe(true);
      expect(atPrecision(Math.max(...Cs), r.lightness.maxChroma, 3), 'largest chroma').toBe(true);
      expect(r.series.map(s => s.hex)).toEqual([...series]);
      series.forEach((color, k) => {
        const s = r.series[k]!, [L, C, h] = oklch(color);
        expect(s.slot).toBe(k + 1);
        expect(atPrecision(L, s.oklch[0]!, 3) && atPrecision(C, s.oklch[1]!, 3) && atPrecision(h, s.oklch[2]!, 1), `${color} OKLCH ${s.oklch.join(' ')}`).toBe(true);
        expect(atPrecision(contrastRatio(c(color), c(scheme.background)), s.contrast, 2), `${color} contrast ${s.contrast}`).toBe(true);
        expect(atPrecision(hueDifference(h, oklch(other.series[k]!)[2]), s.hueDiffToOtherScheme, 1), `slot ${k + 1} hue shift`).toBe(true);
      });
      const pairs = (measured: { d: number; pair: number[] }, rec: PairRecord, label: string): void => {
        expect(atPrecision(measured.d, rec.min, 3), `${label}: ${measured.d} vs ${rec.min}`).toBe(true);
        expect(rec.pair, label).toEqual(measured.pair);
      };
      for (const v of VISIONS) {
        pairs(closest(series, v), r.minDelta[v], `all 8, ${v}`);
        pairs(closest(series, v, seenBytes), r.minDeltaBytes[v], `all 8, ${v}, bytes`);
        for (const n of [3, 4, 5, 6]) {
          pairs(closest(series.slice(0, n), v), r.prefixes[n]![v], `first ${n}, ${v}`);
          pairs(closest(series.slice(0, n), v, seenBytes), r.prefixesBytes[n]![v], `first ${n}, ${v}, bytes`);
        }
      }
      for (const token of ['focus', 'reference', 'muted'] as const) {
        const t = seen(srgb(scheme[token]), 'normal'), ds = series.map(color => delta(seen(srgb(color), 'normal'), t));
        const min = Math.min(...ds);
        expect(atPrecision(min, r.tokenDistance[token]!.min, 3), token).toBe(true);
        expect(r.tokenDistance[token]!.slot, token).toBe(ds.indexOf(min) + 1);
      }
      for (const alpha of ALPHAS) {
        const key = String(alpha);
        for (const v of VISIONS) {
          // Fills under every vision, neighbours and the closing pairs of a donut ring (recorded, not required).
          const labs = series.map(color => oklab(simulated(over(color, alpha, scheme.background), v)));
          const nb = labs.slice(1).map((l, k) => delta(labs[k]!, l));
          const rec = r.composites[key]![v];
          nb.forEach((d, k) => expect(atPrecision(d, rec.neighbours[k]!, 3), `${alpha} ${v} neighbours ${k + 1}`).toBe(true));
          expect(atPrecision(Math.min(...nb), rec.minNeighbour, 3), `${alpha} ${v}`).toBe(true);
          expect(rec.pair).toEqual([nb.indexOf(Math.min(...nb)) + 1, nb.indexOf(Math.min(...nb)) + 2]);
          const ring = [3, 4, 5, 6, 7, 8].map(n => ({ slots: [n, 1], d: delta(labs[n - 1]!, labs[0]!) }));
          expect(rec.ringClosures.map(x => x.slots)).toEqual(ring.map(x => x.slots));
          ring.forEach((x, k) => expect(atPrecision(x.d, rec.ringClosures[k]!.d, 3), `${alpha} ${v} ring ${x.slots.join('-')}`).toBe(true));
        }
        const px = series.map(color => raster(color, alpha, scheme.background));
        const hex = (p: Vec3): string => '#' + p.map(v => v.toString(16).padStart(2, '0')).join('');
        expect(r.raster[key]!.model).toEqual(px.map(hex));
        expect(r.raster[key]!.modelFloor).toEqual(series.map(color => hex(raster(color, alpha, scheme.background, Math.floor))));
        px.slice(1).forEach((p, k) => {
          expect(atPrecision(delta(labOfBytes(px[k]!), labOfBytes(p)), r.raster[key]!.neighboursModel[k]!, 3), `${alpha} model ${k + 1}`).toBe(true);
          expect(atPrecision(worstWithinOneByte(px[k]!, p), r.raster[key]!.neighboursWorstWithinOneByte[k]!, 3), `${alpha} worst ${k + 1}`).toBe(true);
        });
        for (const via of ['canvas', 'svg']) {
          const x = r.chromeRaster[via]![key]!;
          const d = x.pixels.slice(1).map((p, k) => delta(labOfBytes(hexBytes(x.pixels[k]!)), labOfBytes(hexBytes(p))));
          d.forEach((v, k) => expect(atPrecision(v, x.neighbours[k]!, 3), `${via} ${alpha} ${k + 1}`).toBe(true));
          expect(atPrecision(Math.min(...d), x.min, 3)).toBe(true);
        }
      }
    });

    it(`${name}: the 2 px stroke record is these colors, and every statistic in it follows from the raw pixel record`, () => {
      const s = record.strokes.schemes[name], raw = strokesRaw.schemes[name];
      expect(s.background).toBe(scheme.background);
      expect(raw.background).toBe(scheme.background);
      expect(s.rows.map(row => row.color)).toEqual([...series]);
      expect(raw.rows.map(row => row.color)).toEqual([...series]);
      s.rows.forEach((row, k) => {
        const rawRow = raw.rows[k]!, ch = rawRow.channel as 0 | 1 | 2;
        expect(atPrecision(contrastRatio(c(row.color), c(scheme.background)), row.swatch, 2), `${row.color} swatch`).toBe(true);
        // The deciding channel is the one where ink and background differ most.
        const ink = hexBytes(row.color), back = hexBytes(scheme.background);
        expect(Math.abs(ink[ch] - back[ch])).toBe(Math.max(...[0, 1, 2].map(i => Math.abs(ink[i as 0] - back[i as 0]))));
        for (const key of RENDERERS) {
          const st = row[key] as StrokeStats, again = strokeStats(row.color, scheme.background, ch, rawRow[key] as string);
          expect(st.columns, `${row.color} ${key}`).toBe(again.columns);
          expect(st.columnsWithoutFullCoverage, `${row.color} ${key}`).toBe(again.columnsWithoutFullCoverage);
          for (const stat of ['core', 'weighted'] as const) for (const q of ['p10', 'median'] as const) {
            expect(atPrecision(again[stat][q], st[stat][q], 2), `${row.color} ${key} ${stat} ${q}: ${again[stat][q]} vs ${st[stat][q]}`).toBe(true);
          }
        }
      });
    });

    it(`${name}: the preview PNG itself (donut slices read back from each row) matches the palette and keeps 0.10 apart`, () => {
      const img = r.previewImage, rows = { normal: 'normal', protanopia: 'protan', deuteranopia: 'deutan', tritanopia: 'tritan' } as const;
      expect(img.normal!.pixels).toEqual([...series]);
      for (const [row, v] of Object.entries(rows)) {
        const px = img[row]!.pixels;
        px.forEach((hex, k) => {
          // The image is the byte-rounding model within one byte per channel (Chrome's filter rounds differently).
          const model = vec(i => Math.round(255 * enc(simulated(srgb(series[k]!), v)[i]))), d = hexBytes(hex);
          for (const i of [0, 1, 2] as const) expect(Math.abs(model[i] - d[i]), `${row} slot ${k + 1}`).toBeLessThanOrEqual(1);
        });
        const labs = px.map(hex => labOfBytes(hexBytes(hex)));
        let min = Infinity, pair = [0, 0];
        for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) { const d = delta(labs[i]!, labs[j]!); if (d < min) { min = d; pair = [i + 1, j + 1]; } }
        expect(min, `${row}: slots ${pair.join(' and ')}`).toBeGreaterThanOrEqual(0.10);
        expect(atPrecision(min, img[row]!.min, 3)).toBe(true);
        expect(img[row]!.pair).toEqual(pair);
      }
    });

    it(`${name}: the one-byte-edit count in the record is what every check gives for every one-byte edit`, () => {
      let edits = 0, pass = 0;
      series.forEach((hex, k) => {
        for (const ch of [0, 1, 2] as const) for (const d of [-1, 1]) {
          const b = [...hexBytes(hex)]; b[ch] = b[ch]! + d;
          if (b[ch]! < 0 || b[ch]! > 255) continue;
          const edited = series.slice(); edited[k] = '#' + b.map(v => v.toString(16).padStart(2, '0')).join('');
          edits++;
          if (meetsEveryCheck(edited, scheme, other.series)) pass++;
        }
      });
      expect(meetsEveryCheck(series, scheme, other.series)).toBe(true);
      expect(record.oneByteEdits[name]).toEqual({ edits, stillMeetEveryCheck: pass });
    });

    it(`${name}: token colors meet spec L2 (axis and focus 3:1; muted and reference 4.5:1, they label text)`, () => {
      const bg = c(scheme.background);
      expect(contrastRatio(c(scheme.axis), bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c(scheme.focus), bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c(scheme.muted), bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c(scheme.reference), bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('candidate B (decision 0003, awaiting the owner\'s choice; not what ships)', () => {
  // The candidate is scored on the shipped backgrounds and tokens: it changes series colors only.
  const candidate = JSON.parse(fs.readFileSync(research('candidates/candidate-b.json'), 'utf8')) as { light: string[]; dark: string[] };
  const drawn = JSON.parse(fs.readFileSync(research('raster-b.json'), 'utf8')) as
    { schemes: Record<'light' | 'dark', { background: string; series: string[]; pixels: Record<'canvas' | 'svg', Record<string, string[]>> }> };
  const shot = JSON.parse(fs.readFileSync(research('preview-b-pixels.json'), 'utf8')) as
    { schemes: Record<'light' | 'dark', { background: string; series: string[] } & Record<string, string[] | string>> };
  for (const [name, scheme, otherName] of [['light', LIGHT, 'dark'], ['dark', DARK, 'light']] as const) {
    const series = candidate[name], other = candidate[otherName];

    it(`${name}: meets every required check of constraints 1–6, analytic and in bytes, against the shipped tokens`, () => {
      expect(series).toHaveLength(8);
      expect(new Set(series).size).toBe(8);
      expect(meetsEveryCheck(series, scheme, other)).toBe(true);
    });

    it(`${name}: the fills Chrome drew for it (research/palette/raster-b.json) are its colors and stay 0.06 apart`, () => {
      const rec = drawn.schemes[name];
      expect(rec.background).toBe(scheme.background);
      expect(rec.series).toEqual(series);
      expect(Object.keys(rec.pixels).sort()).toEqual(['canvas', 'svg']);
      for (const [via, byAlpha] of Object.entries(rec.pixels)) for (const alpha of ALPHAS) {
        const px = byAlpha[String(alpha)]!;
        expect(px).toHaveLength(8);
        px.forEach((hex, k) => {
          const m = raster(series[k]!, alpha, scheme.background), d = hexBytes(hex);
          for (const i of [0, 1, 2] as const) expect(Math.abs(m[i] - d[i]), `${via} ${alpha} slot ${k + 1}`).toBeLessThanOrEqual(1);
        });
        for (let k = 0; k + 1 < px.length; k++) {
          expect(delta(labOfBytes(hexBytes(px[k]!)), labOfBytes(hexBytes(px[k + 1]!))), `${via} ${alpha * 100}%: slots ${k + 1} and ${k + 2}`).toBeGreaterThanOrEqual(0.06);
        }
      }
    });

    it(`${name}: its preview PNG (research/palette/preview-b-${name}.png, donut slices read back) keeps 0.10 apart in every row`, () => {
      const rec = shot.schemes[name], rows = { normal: 'normal', protanopia: 'protan', deuteranopia: 'deutan', tritanopia: 'tritan' } as const;
      expect(rec.background).toBe(scheme.background);
      expect(rec.series).toEqual(series);
      expect(rec.normal).toEqual(series);
      for (const [row, v] of Object.entries(rows)) {
        const px = rec[row] as string[];
        px.forEach((hex, k) => {
          const model = vec(i => Math.round(255 * enc(simulated(srgb(series[k]!), v)[i]))), d = hexBytes(hex);
          for (const i of [0, 1, 2] as const) expect(Math.abs(model[i] - d[i]), `${row} slot ${k + 1}`).toBeLessThanOrEqual(1);
        });
        const labs = px.map(hex => labOfBytes(hexBytes(hex)));
        for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
          expect(delta(labs[i]!, labs[j]!), `${row}: slots ${i + 1} and ${j + 1}`).toBeGreaterThanOrEqual(0.10);
        }
      }
    });
  }
});

describe('default stylesheet', () => {
  it('defines the light and dark token sets, forced colors and the dash switch', () => {
    for (let i = 1; i <= 8; i++) {
      // Public names today, private defaults (--axylo-default-series-N) once the review's stylesheet change lands.
      expect(AXYLO_CSS).toMatch(new RegExp(`--axylo-(default-)?series-${i}: ${LIGHT.series[i - 1]};`));
      expect(AXYLO_CSS).toMatch(new RegExp(`--axylo-(default-)?series-${i}: ${DARK.series[i - 1]};`));
      expect(AXYLO_CSS).toContain(`--axylo-series-${i}: CanvasText !important;`);
    }
    expect(AXYLO_CSS).toContain('.axylo[data-axylo-scheme="dark"]');
    expect(AXYLO_CSS).toContain('@media (forced-colors: active)');
    expect(AXYLO_CSS).toMatch(/@media \(prefers-contrast: more\), \(forced-colors: active\) \{\s*(\.axylo )?\.axylo-svg \.axylo-dashed \{ stroke-dasharray: var\(--axylo-dash-contrast/);
    expect(AXYLO_CSS).toContain('--axylo-stylesheet: loaded');
  });

  it('never sets what scheme detection reads (color-scheme, color, --axylo-background) outside forced colors', () => {
    const outsideForced = AXYLO_CSS.replace(/@media \(forced-colors: active\) \{[\s\S]*?\n {2}\}\n/, '');
    expect(outsideForced).not.toMatch(/color-scheme\s*:/);
    expect(outsideForced).not.toMatch(/--axylo-background\s*:/);
    expect(outsideForced).not.toMatch(/\.axylo\s*\{[^}]*[^-]color\s*:/);
  });

  it('keeps the marker that separates the figure module\'s structure rules from the token and mark part', () => {
    const marker = AXYLO_CSS.indexOf('/* structure: added by the figure module');
    expect(marker).toBeGreaterThan(AXYLO_CSS.indexOf('.axylo-text'));
  });

  it('balances its braces', () => {
    expect(AXYLO_CSS.split('{').length).toBe(AXYLO_CSS.split('}').length);
  });
});
