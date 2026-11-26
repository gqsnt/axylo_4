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
 *
 * Zero DOM access, zero runtime dependencies, zero top-level side effects (0 B bare import).
 */
import type { Data, XValue } from './public.js';

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
  /** Columnar dataset ready to pass directly as `{ columns }` to `axylo/cartesian` (`errorBar` + `range` + `line`). */
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
function extractSortedFinite(values: ArrayLike<number | null | undefined>): { sorted: Float64Array; missing: number; sum: number } {
  const len = values.length;
  let finiteCount = 0;
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const v = values[i];
    if (typeof v === 'number' && Number.isFinite(v)) {
      finiteCount++;
      sum += v;
    }
  }
  const sorted = new Float64Array(finiteCount);
  let k = 0;
  for (let i = 0; i < len; i++) {
    const v = values[i];
    if (typeof v === 'number' && Number.isFinite(v)) sorted[k++] = v;
  }
  sorted.sort();
  return { sorted, missing: len - finiteCount, sum };
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
  return sorted[lo]! + frac * (sorted[hi]! - sorted[lo]!);
}

/** Computes a single R-7 quantile `p in [0, 1]` over finite values (ignores `null`/`undefined`/`NaN`/`±Infinity`). */
export function quantile(values: ArrayLike<number | null | undefined>, p: number): number {
  if (!Number.isFinite(p) || p < 0 || p > 1) return NaN;
  const { sorted } = extractSortedFinite(values);
  return sortedQuantileR7(sorted, p);
}

/** Computes multiple R-7 quantiles in one sort pass, returning a `Float64Array` aligned to `probs`. */
export function quantiles(values: ArrayLike<number | null | undefined>, probs: readonly number[]): Float64Array {
  const out = new Float64Array(probs.length);
  const { sorted } = extractSortedFinite(values);
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
  const { sorted, missing, sum } = extractSortedFinite(values);
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
  const lowerFence = q1 - k * iqr;
  const upperFence = q3 + k * iqr;

  // Smallest observed value >= lowerFence (and <= q1), largest observed value <= upperFence (and >= q3).
  let lowIdx = 0;
  while (lowIdx < n - 1 && sorted[lowIdx]! < lowerFence) lowIdx++;
  let highIdx = n - 1;
  while (highIdx > 0 && sorted[highIdx]! > upperFence) highIdx--;

  const whiskerLow = Math.min(q1, sorted[lowIdx]!);
  const whiskerHigh = Math.max(q3, sorted[highIdx]!);

  let outlierCount = 0;
  for (let i = 0; i < n; i++) {
    const v = sorted[i]!;
    if (v < whiskerLow || v > whiskerHigh) outlierCount++;
  }
  const outliers = new Float64Array(outlierCount);
  let oi = 0;
  for (let i = 0; i < n; i++) {
    const v = sorted[i]!;
    if (v < whiskerLow || v > whiskerHigh) outliers[oi++] = v;
  }

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
    mean: sum / n,
    outliers,
  };
}

function groupKeyOf(x: XValue): string {
  if (x instanceof Date) return `d:${x.getTime()}`;
  return `${typeof x}:${String(x)}`;
}

function groupLabelOf(x: XValue): string {
  return x instanceof Date ? x.toISOString() : String(x);
}

/**
 * Transforms row or columnar data into grouped R-7 / Tukey box-plot summaries + typed columnar output
 * ready for `axylo/cartesian` (`errorBar` whiskers + `range` IQR band + `line` median).
 */
export function boxplot<Row>(data: Data<Row>, options: BoxPlotTransformOptions<Row>): BoxPlotResult {
  const k = options.whiskerFactor ?? BOXPLOT_CONVENTION.defaultWhiskerFactor;
  if (!Number.isFinite(k) || k < 0) {
    throw new RangeError(`axylo/stats: whiskerFactor must be finite and >= 0 (received ${String(k)})`);
  }

  const xKey = options.x;
  const yKey = options.y;
  const isColumnar = !Array.isArray(data) && data !== null && typeof data === 'object' && 'columns' in data;
  const xCol = isColumnar ? (data.columns[xKey] as ArrayLike<unknown> | undefined) : undefined;
  const yCol = isColumnar ? (data.columns[yKey] as ArrayLike<unknown> | undefined) : undefined;
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

  const groups: BoxGroup[] = new Array(gCount);
  const minArr = new Float64Array(gCount);
  const wLowArr = new Float64Array(gCount);
  const q1Arr = new Float64Array(gCount);
  const medArr = new Float64Array(gCount);
  const q3Arr = new Float64Array(gCount);
  const wHighArr = new Float64Array(gCount);
  const maxArr = new Float64Array(gCount);
  const meanArr = new Float64Array(gCount);
  const countArr = new Float64Array(gCount);
  const outlierXs: XValue[] = [];
  const outlierYs: number[] = [];

  for (let g = 0; g < gCount; g++) {
    const validSlice = buckets[g]!.subarray(0, bucketPos[g]!);
    const baseSummary = summarizeBox(validSlice, { whiskerFactor: k });
    const summary: BoxSummary = { ...baseSummary, missing: bucketMissing[g]! };
    const xv = groupX[g]!;
    groups[g] = { x: xv, label: groupLabelOf(xv), summary };
    minArr[g] = summary.min;
    wLowArr[g] = summary.whiskerLow;
    q1Arr[g] = summary.q1;
    medArr[g] = summary.median;
    q3Arr[g] = summary.q3;
    wHighArr[g] = summary.whiskerHigh;
    maxArr[g] = summary.max;
    meanArr[g] = summary.mean;
    countArr[g] = summary.count;
    for (let o = 0; o < summary.outliers.length; o++) {
      outlierXs.push(xv);
      outlierYs.push(summary.outliers[o]!);
    }
  }

  return {
    convention: BOXPLOT_CONVENTION,
    whiskerFactor: k,
    groups,
    data: {
      columns: {
        x: groupX,
        min: minArr,
        whiskerLow: wLowArr,
        q1: q1Arr,
        median: medArr,
        q3: q3Arr,
        whiskerHigh: wHighArr,
        max: maxArr,
        mean: meanArr,
        count: countArr,
      },
    },
    outliers: {
      columns: {
        x: outlierXs,
        y: Float64Array.from(outlierYs),
      },
    },
  };
}

export type { Data, XValue } from './public.js';
