/**
 * Opt-in statistical transforms for Axylo (`axylo/stats`, C5.1).
 *
 * Explicitly documented statistical conventions:
 * - Quantiles: Hyndman & Fan Type 7 (R-7 / NumPy / Excel PERCENTILE.INC default):
 *   for sorted finite values x[0..n-1] (n >= 1) and probability p in [0, 1],
 *   h = p * (n - 1), i = floor(h), f = h - i, Q(p) = x[i] + f * (x[min(i+1, n-1)] - x[i]).
 * - Box-plot whiskers (Tukey fence):
 *   Q1 = Q(0.25), median = Q(0.5), Q3 = Q(0.75), IQR = Q3 - Q1.
 *   Fences: lower = Q1 - k * IQR, upper = Q3 + k * IQR (default k = 1.5).
 *   whiskerLow = smallest observed finite value >= lower fence (clamped <= Q1).
 *   whiskerHigh = largest observed finite value <= upper fence (clamped >= Q3).
 *   outliers = sorted Float64Array of finite values strictly < whiskerLow or > whiskerHigh.
 * - Extreme finite inputs: the interpolation never overflows (see `between`), so every quantile of finite values
 *   is finite and ordered. IQR is reported as computed: two finite quartiles of opposite sign can be further
 *   apart than Number.MAX_VALUE, and then `iqr` is `Infinity` rather than a made-up finite number. Such fences
 *   are unbounded (no outliers) for k > 0; k = 0 puts the fences on Q1 and Q3 themselves (0 × ∞ is not read as NaN).
 *   The mean of values whose sum overflows is computed from the scaled values instead.
 *
 * - Kernel density (`kde`, `violinData`): see `kdeConvention()` for the frozen defaults and their documented edge rules.
 *
 * Zero DOM access, zero runtime dependencies, zero top-level side effects (0 B bare import).
 */
import type { Data, XValue } from './public.js';
import { densityOnGrid } from './stats/kde';

export const QUANTILE_CONVENTION = 'R-7' as const;
export const BOXPLOT_CONVENTION = {
  quantile: QUANTILE_CONVENTION,
  whisker: 'tukey-iqr',
  defaultWhiskerFactor: 1.5,
} as const;

export interface BoxPlotOptions {
  /** Multiplier `k` for Tukey fences `[Q1 - k * IQR, Q3 + k * IQR]`. Default `1.5`. Must be finite and `>= 0`. */
  readonly whiskerFactor?: number;
}

export interface BoxSummary {
  readonly count: number;
  readonly missing: number;
  readonly min: number;
  readonly whiskerLow: number;
  readonly q1: number;
  readonly median: number;
  readonly q3: number;
  readonly whiskerHigh: number;
  readonly max: number;
  readonly iqr: number;
  readonly mean: number;
  readonly outliers: Float64Array;
}

export interface BoxGroup {
  readonly x: XValue;
  readonly label: string;
  readonly summary: BoxSummary;
}

export interface BoxPlotColumns {
  readonly x: readonly XValue[];
  readonly min: Float64Array;
  readonly whiskerLow: Float64Array;
  readonly q1: Float64Array;
  readonly median: Float64Array;
  readonly q3: Float64Array;
  readonly whiskerHigh: Float64Array;
  readonly max: Float64Array;
  readonly mean: Float64Array;
  readonly count: Float64Array;
}

export interface BoxPlotOutlierColumns {
  readonly x: readonly XValue[];
  readonly y: Float64Array;
}

export interface BoxPlotResult {
  readonly convention: typeof BOXPLOT_CONVENTION;
  readonly whiskerFactor: number;
  readonly groups: readonly BoxGroup[];
  /**
   * Columnar dataset ready to pass as `data` to `axylo/cartesian`. A native `boxplot` layer reads it as
   * `{ type: 'boxplot', min: 'whiskerLow', q1: 'q1', median: 'median', q3: 'q3', max: 'whiskerHigh', outliers }`,
   * where `outliers` names a column of per-group arrays the caller adds, e.g.
   * `{ columns: { ...result.data.columns, outliers: result.groups.map(g => g.summary.outliers) } }`.
   */
  readonly data: { readonly columns: BoxPlotColumns };
  /** Columnar outlier coordinates `(x, y)` for optional scatter/point overlay. */
  readonly outliers: { readonly columns: BoxPlotOutlierColumns };
}

export interface BoxPlotTransformOptions<Row> extends BoxPlotOptions {
  /** Grouping field (category, number, or date/time). */
  readonly x: Extract<keyof Row, string>;
  /** Numeric value field to summarize within each group. */
  readonly y: Extract<keyof Row, string>;
}

/** Collects finite numeric observations into a compact sorted Float64Array plus missing count. */
function extractSortedFinite(values: ArrayLike<number | null | undefined>): [sorted: Float64Array, missing: number, sum: number] {
  const len = values.length, all = new Float64Array(len);
  let k = 0, sum = 0;
  for (let i = 0; i < len; i++) {
    const v = values[i];
    if (typeof v === 'number' && Number.isFinite(v)) sum += all[k++] = v;
  }
  // One pass into a buffer of every value; the finite part is sorted in place and nothing keeps the rest.
  return [all.subarray(0, k).sort(), len - k, sum];
}

/** Evaluates Hyndman & Fan Type 7 (R-7) quantile on an already-sorted non-empty Float64Array. */
function sortedQuantileR7(sorted: Float64Array, p: number): number {
  const n = sorted.length;
  if (n === 0 || !Number.isFinite(p) || p < 0 || p > 1) return NaN;
  if (n === 1 || p === 0) return sorted[0]!;
  if (p === 1) return sorted[n - 1]!;
  const h = p * (n - 1);
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  const frac = h - lo;
  return between(sorted[lo]!, sorted[hi]!, frac);
}

/**
 * `a + t * (b - a)` for sorted finite `a <= b` and `t` in [0, 1], kept inside [a, b]. The difference of two
 * finite values of opposite sign can exceed Number.MAX_VALUE (`[-1e308, 1e308]`), so it is then weighted as
 * `(1 - t) * a + t * b`, whose terms are each at most one bound in magnitude. The usual form is kept otherwise
 * because it is exact at t = 0 and for equal bounds. Rounding can step one ulp outside the pair; the clamp keeps
 * every quantile between its neighbours, so the summary stays ordered.
 */
function between(a: number, b: number, t: number): number {
  if (a === b) return a;
  const d = b - a;
  const v = Number.isFinite(d) ? a + t * d : (1 - t) * a + t * b;
  return v < a ? a : v > b ? b : v;
}

/** Computes a single R-7 quantile `p in [0, 1]` over finite values (ignores `null`/`undefined`/`NaN`/`±Infinity`). */
export function quantile(values: ArrayLike<number | null | undefined>, p: number): number {
  if (!Number.isFinite(p) || p < 0 || p > 1) return NaN;
  const [sorted] = extractSortedFinite(values);
  return sortedQuantileR7(sorted, p);
}

/** Computes multiple R-7 quantiles in one sort pass, returning a `Float64Array` aligned to `probs`. */
export function quantiles(values: ArrayLike<number | null | undefined>, probs: readonly number[]): Float64Array {
  const out = new Float64Array(probs.length);
  const [sorted] = extractSortedFinite(values);
  for (let i = 0; i < probs.length; i++) {
    out[i] = sortedQuantileR7(sorted, probs[i]!);
  }
  return out;
}

/** Summarizes a numeric sample into a deterministic R-7 + Tukey IQR box summary. */
export function summarizeBox(values: ArrayLike<number | null | undefined>, options: BoxPlotOptions = {}): BoxSummary {
  const k = options.whiskerFactor ?? BOXPLOT_CONVENTION.defaultWhiskerFactor;
  if (!Number.isFinite(k) || k < 0) {
    throw new RangeError(`axylo/stats: whiskerFactor must be finite and >= 0 (received ${String(k)})`);
  }
  const [sorted, missing, sum] = extractSortedFinite(values);
  const n = sorted.length;
  if (n === 0) {
    return {
      count: 0,
      missing,
      min: NaN,
      whiskerLow: NaN,
      q1: NaN,
      median: NaN,
      q3: NaN,
      whiskerHigh: NaN,
      max: NaN,
      iqr: NaN,
      mean: NaN,
      outliers: new Float64Array(0),
    };
  }
  const min = sorted[0]!;
  const max = sorted[n - 1]!;
  const q1 = sortedQuantileR7(sorted, 0.25);
  const median = sortedQuantileR7(sorted, 0.5);
  const q3 = sortedQuantileR7(sorted, 0.75);
  const iqr = q3 - q1;
  // k = 0 means the fences are the quartiles, also when the IQR itself overflowed (0 * Infinity is NaN). When
  // k * iqr overflows (either an infinite IQR or finite IQR * k past Number.MAX_VALUE), evaluate at half scale
  // so finite fences such as q1 - 1.5 * iqr in [-MAX, MAX] still cancel back into range; ordinary inputs keep
  // q1 - spread and q3 + spread unchanged.
  const spread = k === 0 ? 0 : k * iqr;
  const finiteSpread = Number.isFinite(spread);
  const half = finiteSpread ? 0 : k * (Number.isFinite(iqr) ? iqr / 2 : q3 / 2 - q1 / 2);
  const lowerFence = k === 0 ? q1 : finiteSpread ? q1 - spread : 2 * (q1 / 2 - half);
  const upperFence = k === 0 ? q3 : finiteSpread ? q3 + spread : 2 * (q3 / 2 + half);

  // Smallest observed value >= lowerFence (and <= q1), largest observed value <= upperFence (and >= q3).
  let lowIdx = 0;
  while (lowIdx < n - 1 && sorted[lowIdx]! < lowerFence) lowIdx++;
  let highIdx = n - 1;
  while (highIdx > 0 && sorted[highIdx]! > upperFence) highIdx--;

  const whiskerLow = Math.min(q1, sorted[lowIdx]!);
  const whiskerHigh = Math.max(q3, sorted[highIdx]!);

  const outliers = sorted.filter(v => v < whiskerLow || v > whiskerHigh);

  return {
    count: n,
    missing,
    min,
    whiskerLow,
    q1,
    median,
    q3,
    whiskerHigh,
    max,
    iqr,
    mean: meanOf(sorted, sum),
    outliers,
  };
}

/**
 * The mean of sorted finite values. When their sum overflowed, it is the running mean, stepped by halves so no
 * difference exceeds Number.MAX_VALUE, and kept inside [min, max] where rounding would step past a bound.
 */
function meanOf(sorted: Float64Array, sum: number): number {
  const n = sorted.length;
  if (Number.isFinite(sum)) return sum / n;
  const lo = sorted[0]!, hi = sorted[n - 1]!;
  let mean = lo;
  for (let i = 1; i < n; i++) {
    mean += ((sorted[i]! / 2 - mean / 2) / (i + 1)) * 2;
    mean = mean < lo ? lo : mean > hi ? hi : mean;
  }
  return mean;
}

function groupKeyOf(x: XValue): string {
  if (x instanceof Date) return `d:${x.getTime()}`;
  return `${typeof x}:${String(x)}`;
}

function groupLabelOf(x: XValue): string {
  return x instanceof Date ? x.toISOString() : String(x);
}

/**
 * Splits row or columnar data by group (category, number or date/time; a missing or invalid group drops the row)
 * into each group's finite values and its count of values that are not finite numbers, in first-seen group order.
 */
function groupFinite<Row>(data: Data<Row>, xKey: string, yKey: string): [readonly XValue[], Float64Array[], Int32Array] {
  const isColumnar = !Array.isArray(data) && data !== null && typeof data === 'object' && 'columns' in data;
  const columns = isColumnar ? (data as { columns: Record<string, ArrayLike<unknown> | undefined> }).columns : null;
  const xCol = columns?.[xKey], yCol = columns?.[yKey];
  const rows = Array.isArray(data) ? data : null;
  const totalLen = isColumnar ? Math.min(xCol?.length ?? 0, yCol?.length ?? 0) : (rows?.length ?? 0);

  // First pass: assign group ids and count values per group (zero per-point wrapper objects).
  const groupIndexByKey = new Map<string, number>();
  const groupX: XValue[] = [];
  const groupCounts: number[] = [];
  const rowGroup = new Int32Array(totalLen);

  for (let i = 0; i < totalLen; i++) {
    const rawX = isColumnar ? xCol![i] : (rows![i] as Record<string, unknown> | null | undefined)?.[xKey];
    if (rawX === null || rawX === undefined || (typeof rawX === 'number' && !Number.isFinite(rawX)) || (rawX instanceof Date && !Number.isFinite(rawX.getTime()))) {
      rowGroup[i] = -1;
      continue;
    }
    const xv = rawX as XValue;
    const key = groupKeyOf(xv);
    let g = groupIndexByKey.get(key);
    if (g === undefined) {
      g = groupX.length;
      groupIndexByKey.set(key, g);
      groupX.push(xv);
      groupCounts.push(0);
    }
    rowGroup[i] = g;
    groupCounts[g] = groupCounts[g]! + 1;
  }

  const gCount = groupX.length;
  const buckets: Float64Array[] = new Array(gCount);
  const bucketMissing = new Int32Array(gCount);
  const bucketPos = new Int32Array(gCount);
  for (let g = 0; g < gCount; g++) buckets[g] = new Float64Array(groupCounts[g]!);

  for (let i = 0; i < totalLen; i++) {
    const g = rowGroup[i]!;
    if (g < 0) continue;
    const rawY = isColumnar ? yCol![i] : (rows![i] as Record<string, unknown> | null | undefined)?.[yKey];
    if (typeof rawY === 'number' && Number.isFinite(rawY)) {
      buckets[g]![bucketPos[g]!] = rawY;
      bucketPos[g] = bucketPos[g]! + 1;
    } else {
      bucketMissing[g] = bucketMissing[g]! + 1;
    }
  }
  for (let g = 0; g < gCount; g++) buckets[g] = buckets[g]!.subarray(0, bucketPos[g]!);
  return [groupX, buckets, bucketMissing];
}

/**
 * Transforms row or columnar data into grouped R-7 / Tukey box-plot summaries + typed columnar output
 * ready for the `boxplot` layer of `axylo/cartesian` (see `BoxPlotResult.data`).
 */
export function boxplot<Row>(data: Data<Row>, options: BoxPlotTransformOptions<Row>): BoxPlotResult {
  // Checks the factor once (the same RangeError as summarizeBox), also when there is no group.
  summarizeBox([], options);
  const k = options.whiskerFactor ?? BOXPLOT_CONVENTION.defaultWhiskerFactor;
  const [groupX, samples, bucketMissing] = groupFinite(data, options.x, options.y);
  const gCount = groupX.length;
  const groups: BoxGroup[] = new Array(gCount);
  const keys = ['min', 'whiskerLow', 'q1', 'median', 'q3', 'whiskerHigh', 'max', 'mean', 'count'] as const;
  const columns = Object.fromEntries(keys.map(key => [key, new Float64Array(gCount)])) as Record<(typeof keys)[number], Float64Array>;
  const outlierXs: XValue[] = [];
  const outlierYs: number[] = [];

  for (let g = 0; g < gCount; g++) {
    const baseSummary = summarizeBox(samples[g]!, { whiskerFactor: k });
    const summary: BoxSummary = { ...baseSummary, missing: bucketMissing[g]! };
    const xv = groupX[g]!;
    groups[g] = { x: xv, label: groupLabelOf(xv), summary };
    for (const key of keys) columns[key][g] = summary[key];
    for (let o = 0; o < summary.outliers.length; o++) {
      outlierXs.push(xv);
      outlierYs.push(summary.outliers[o]!);
    }
  }

  return {
    convention: BOXPLOT_CONVENTION,
    whiskerFactor: k,
    groups,
    data: { columns: { x: groupX, ...columns } },
    outliers: {
      columns: {
        x: outlierXs,
        y: Float64Array.from(outlierYs),
      },
    },
  };
}

/**
 * Defaults of `kde()` and `violinData()`, frozen (see `kdeConvention()`):
 * - kernel: Gaussian.
 * - bandwidth: Silverman's rule of thumb h = 0.9 · min(sd, IQR / 1.34) · n^(-1/5) (sd with n − 1, IQR from R-7
 *   quartiles), computed per sample (per group in `violinData`). When min(sd, IQR / 1.34) is 0 the scale falls back
 *   to sd, then to |x| of a constant sample, then to 1 (R's bw.nrd0 chain), so h is always finite and > 0. The sd,
 *   IQR and their minimum are taken at 2^-64 of their size when the sample reaches 2^960, so a rule value that is
 *   representable is returned even when sd or IQR alone is not; a rule value past Number.MAX_VALUE or below
 *   Number.MIN_VALUE is held there. An explicit `bandwidth` (a finite number > 0) is used exactly as given.
 * - mean: compensated (Neumaier) sum at the same scale, with values below 2^-900 summed unscaled apart, so
 *   [-1e16, 1, 1e16] has mean 1/3 and [-MAX, 1e-307, MAX] mean 1e-307 / 3; sd: two-pass about the
 *   rounded mean with its correction term, relative to the largest deviation, so it neither overflows nor loses
 *   the deviations of values near 1e16.
 * - grid: `points` (128) evenly spaced values from min − cut · h to max + cut · h (cut = 3), cut to `clamp` and to
 *   ±Number.MAX_VALUE (each end computed without overflow). A grid narrower than 2^12 ulps a step at its own
 *   magnitude (or than 2^-960 a step) is widened to that width around its centre, inside `clamp`, so it stays
 *   strictly increasing and evenly spaced within 0.05 %; the bandwidth is not changed. A finite `clamp` narrower
 *   than that width is the grid: it is accepted when its `points` values are strictly increasing and its density is
 *   finite, and rejected (RangeError) otherwise. Two values 8 ulps apart, [1, 1 + 2^-44] (128 values ~2 ulps apart)
 *   and [0, 1e-306] (area density 1e306) are estimated; [1, 1 + 2^-52] at 3 points (no third value) is not, nor is
 *   [0, 1e-320] by area (1e320 is past Number.MAX_VALUE), which `normalize: 'width'` estimates. A cell whose half
 *   steps round onto its grid value (steps of one ulp) has no width and takes the point value there.
 * - density: each value is the estimate's mean over its grid cell (half steps around it), computed from the normal
 *   CDF (relative accuracy ~1e-6), so a bandwidth narrower than a step is not missed. `normalize: 'area'` scales it to
 *   unit trapezoid area over the returned grid (the < 0.3 % of mass past cut · h is given back to the grid);
 *   `'width'` scales its largest value to 1.
 * - clamp [a, b] (a < b; −Infinity / Infinity for an open side): samples outside it are dropped and counted as
 *   `outside`; the summary and bandwidth describe the retained samples only. The kernels are reflected in each
 *   finite bound (every image that reaches the support, or the equivalent cosine series when h > b − a is wide),
 *   so no mass is placed past a bound and none is lost there.
 * - empty sample (no finite value inside `clamp`): empty grid and density, NaN summary values (n 0) and, unless
 *   given, a NaN bandwidth: nothing can be estimated, and nothing is thrown.
 */
export interface KdeConvention {
  readonly kernel: 'gaussian';
  readonly bandwidth: 'silverman';
  readonly normalize: 'area';
  readonly points: 128;
  readonly cut: 3;
  readonly quantile: typeof QUANTILE_CONVENTION;
}

let convention: KdeConvention | undefined;

/** The frozen defaults of `kde()` and `violinData()` (one object; the estimates never read it). */
export function kdeConvention(): KdeConvention {
  return convention ??= Object.freeze({ kernel: 'gaussian', bandwidth: 'silverman', normalize: 'area', points: 128, cut: 3, quantile: QUANTILE_CONVENTION });
}

export interface KdeOptions {
  /** Kernel standard deviation, a finite number > 0. Default: Silverman's rule per sample. */
  readonly bandwidth?: number;
  /** `'area'` (default): unit integral. `'width'`: largest value 1, to compare shapes side by side. */
  readonly normalize?: 'area' | 'width';
  /** Support `[min, max]`, two numbers: samples outside are dropped, kernels are reflected in each finite bound. */
  readonly clamp?: readonly [number, number];
  /** Grid size, an integer from 2 to 4096. Default 128. */
  readonly points?: number;
}

/** Exact R-7 summary of the retained samples (the finite values inside `clamp`). */
export interface KdeSummary {
  readonly n: number;
  /** Values that are not finite numbers. */
  readonly missing: number;
  /** Finite values outside `clamp`, left out of the estimate and the summary. */
  readonly outside: number;
  readonly min: number;
  readonly q1: number;
  readonly median: number;
  readonly q3: number;
  readonly max: number;
  readonly mean: number;
}

export interface KdeResult {
  /** Strictly increasing evaluation positions. */
  readonly grid: Float64Array;
  /** Density at each grid position (>= 0), aligned to `grid`. */
  readonly density: Float64Array;
  readonly bandwidth: number;
  readonly normalize: 'area' | 'width';
  readonly summary: KdeSummary;
}

/** [bandwidth or undefined for the rule, normalize, clamp low, clamp high, points] */
type KdeSettings = readonly [h: number | undefined, normalize: 'area' | 'width', a: number, b: number, points: number];

const fail = (): never => {
  throw new RangeError('axylo/stats');
};
// Number.MAX_VALUE as a literal: a property read at the top level would keep `import 'axylo/stats'` from being empty.
const MAX = 1.7976931348623157e308;


function kdeSettings(options: KdeOptions): KdeSettings {
  if (!options || typeof options !== 'object') fail();
  const { bandwidth: h, normalize = 'area', clamp, points = 128 } = options;
  if (
    (h !== undefined && !(typeof h === 'number' && h > 0 && h < Infinity))
    || (normalize !== 'area' && normalize !== 'width')
    || !Number.isInteger(points) || points < 2 || points > 4096
  ) fail();
  const [a, b] = clamp === undefined ? [-Infinity, Infinity]
    : Array.isArray(clamp) && clamp.length === 2 && typeof clamp[0] === 'number' && typeof clamp[1] === 'number' ? clamp : fail();
  // min < max. Whether a finite pair can hold the grid is checked on the grid itself (see `estimate`).
  if (!(a < b)) fail();
  return [h, normalize, a, b, points];
}

/**
 * [mean, Silverman bandwidth] of the sorted finite sample (n >= 1), with the bw.nrd0 fallbacks. Every sum runs at
 * scale p (a power of two, exact) so that n values near Number.MAX_VALUE cannot overflow it.
 */
function moments(sorted: Float64Array, q1: number, q3: number, given: number | undefined): [mean: number, h: number] {
  const n = sorted.length;
  const top = Math.max(-sorted[0]!, sorted[n - 1]!), p = top > 2 ** 960 ? 2 ** -64 : 1;
  // Deviations are taken relative to the largest magnitude, so their squares cannot overflow; the deviations that
  // matter to the sd are not far below it, so they do not underflow either.
  // Values below 2^-900 would lose bits at scale p: they are summed unscaled in a bucket of their own (each bucket
  // compensated), so [-MAX, 1e-307, MAX] keeps its mean 1e-307 / 3.
  // [sum, compensation] of the scaled values, then of the small ones: one Neumaier step serves both buckets.
  const acc = new Float64Array(4);
  let e = 0, f = 0;
  const d = top * p || 1;
  for (let i = 0; i < n; i++) {
    const x = sorted[i]!, j = Math.abs(x) < 2 ** -900 ? 2 : 0, v = j ? x : x * p, s = acc[j]!, w = s + v;
    acc[j + 1]! += Math.abs(s) >= Math.abs(v) ? s - w + v : v - w + s;
    acc[j] = w;
  }
  const big = (acc[0]! + acc[1]!) / n, small = (acc[2]! + acc[3]!) / n, m = big + small * p;
  // Deviations from the rounded mean, with the correction term for its rounding (corrected two-pass).
  for (let i = 0; i < n; i++) {
    const r = (sorted[i]! * p - m) / d;
    e += r;
    f += r * r;
  }
  // NaN for one value, which the fallback below reads as no spread.
  const sd = d * Math.sqrt(Math.max(0, f - (e * e) / n) / (n - 1));
  let scale = Math.min(sd, (q3 * p - q1 * p) / 1.34);
  if (!(scale > 0)) scale = sd || d;
  return [big / p + small, given ?? Math.min(MAX, (0.9 * scale * n ** -0.2) / p || 5e-324)];
}

function estimate(values: ArrayLike<number | null | undefined>, settings: KdeSettings): KdeResult {
  const [given, normalize, a, b, points] = settings;
  const [sorted, missing] = extractSortedFinite(values);
  let from = 0, to = sorted.length;
  while (from < to && sorted[from]! < a) from++;
  while (to > from && sorted[to - 1]! > b) to--;
  const sample = sorted.subarray(from, to);
  const n = sample.length;
  const q1 = sortedQuantileR7(sample, 0.25), q3 = sortedQuantileR7(sample, 0.75);
  const [mean, h] = n ? moments(sample, q1, q3, given) : [NaN, given ?? NaN];
  const summary: KdeSummary = {
    n, missing, outside: sorted.length - n, min: sortedQuantileR7(sample, 0), q1, median: sortedQuantileR7(sample, 0.5), q3,
    max: sortedQuantileR7(sample, 1), mean,
  };
  let grid: Float64Array, density: Float64Array;
  if (n) {
    // Three steps of h: each partial end lies between the sample and the true end, so none overflows unless it does,
    // where 3 · h alone could.
    let lo = Math.max(a, -MAX, summary.min - h - h - h);
    let hi = Math.min(b, MAX, summary.max + h + h + h);
    // The width a data-driven grid is widened to: 2^12 ulps a step at its magnitude, and never below 2^-960 a step
    // (2^-920 · 2^-40). A finite clamp narrower than that is the grid itself (accepted by `kdeSettings`).
    const least = Math.max(-lo, hi, 2 ** -920) * 2 ** -40 * points;
    if (!(hi - lo >= least)) {
      // Too narrow to hold the grid at this magnitude (a constant sample with a tiny bandwidth): widen it.
      hi = Math.min(b, MAX, lo / 2 + hi / 2 + least / 2);
      lo = Math.max(a, -MAX, hi - least);
      hi = Math.min(b, MAX, lo + least);
    }
    [grid, density] = densityOnGrid(sample, h, lo, hi, a, b, points, normalize === 'width');
    // Only a finite clamp can be too tight for the grid (a data-driven grid is widened above): its values must be
    // distinct and its density finite. A peak-normalized density is at most 1; an area density past Number.MAX_VALUE
    // (a support far below 2^-1022 a step) cannot be represented.
    if (grid.some((g, k) => g <= grid[k - 1]! || !(density[k]! <= MAX))) fail();
  } else {
    grid = new Float64Array(0);
    density = new Float64Array(0);
  }
  return { grid, density, bandwidth: h, normalize, summary };
}

/** Gaussian kernel density estimate of the finite values (see `kdeConvention()`). Throws RangeError on invalid options. */
export function kde(values: ArrayLike<number | null | undefined>, options: KdeOptions = {}): KdeResult {
  return estimate(values, kdeSettings(options));
}

export interface ViolinTransformOptions<Row> extends KdeOptions {
  /** Grouping field (category, number, or date/time). */
  readonly group: Extract<keyof Row, string>;
  /** Numeric value field to estimate within each group. */
  readonly value: Extract<keyof Row, string>;
}

/**
 * One row per group, ready as `data` for the `violin` layer of `axylo/cartesian`, whose field names default to
 * these column names: `{ type: 'violin', yAxis }` with `x: 'x'`. `grid` and `density` hold each group's own arrays.
 */
export interface ViolinColumns {
  readonly x: readonly XValue[];
  readonly n: Float64Array;
  readonly min: Float64Array;
  readonly q1: Float64Array;
  readonly median: Float64Array;
  readonly q3: Float64Array;
  readonly max: Float64Array;
  readonly mean: Float64Array;
  readonly bandwidth: Float64Array;
  readonly grid: readonly Float64Array[];
  readonly density: readonly Float64Array[];
}

export interface ViolinGroup {
  readonly x: XValue;
  readonly label: string;
  readonly kde: KdeResult;
}

export interface ViolinResult {
  readonly convention: KdeConvention;
  readonly normalize: 'area' | 'width';
  readonly groups: readonly ViolinGroup[];
  readonly data: { readonly columns: ViolinColumns };
}

/**
 * Groups row or columnar data and estimates each group's density and R-7 summary (see `kdeConvention()`). Data
 * with no valid group (as for `boxplot()`) gives empty columns; a group with no finite value has n 0, NaN summary
 * and empty grid and density. Throws RangeError on invalid options.
 */
export function violinData<Row>(data: Data<Row>, options: ViolinTransformOptions<Row>): ViolinResult {
  const settings = kdeSettings(options);
  const [x, samples, missing] = groupFinite(data, options.group, options.value);
  const count = x.length;
  const keys = ['n', 'min', 'q1', 'median', 'q3', 'max', 'mean'] as const;
  const columns = Object.fromEntries(keys.map(key => [key, new Float64Array(count)])) as Record<(typeof keys)[number], Float64Array>;
  const bandwidth = new Float64Array(count), grid = new Array<Float64Array>(count), density = new Array<Float64Array>(count);
  const groups = x.map((xv, g): ViolinGroup => {
    const result = estimate(samples[g]!, settings);
    const summary = { ...result.summary, missing: missing[g]! };
    for (const key of keys) columns[key][g] = summary[key];
    bandwidth[g] = result.bandwidth;
    grid[g] = result.grid;
    density[g] = result.density;
    return { x: xv, label: groupLabelOf(xv), kde: { ...result, summary } };
  });
  return { convention: kdeConvention(), normalize: settings[1], groups, data: { columns: { x, ...columns, bandwidth, grid, density } } };
}

export type { Data, XValue } from './public.js';
