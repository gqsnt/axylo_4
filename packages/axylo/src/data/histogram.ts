import { SLOT_INVALID } from '../core/contracts';
import { report } from '../diagnostics';
import type { AlignedFrame, DiagnosticSink, Frame } from '../core/contracts';
import { firstIndexAtOrAbove, lastIndexAtOrBelow, nextNiceStep, niceStepAtLeast, stepMultiple } from '../scale/nice';
import type { DataEnvironment, FrameVersion } from './normalize';
import { resolveOptions, type ResolvedOptions } from './options';
import { Reports } from './reports';
import { binIndex } from './search';
import type { StreamRows } from './store-rows';
import { Column } from './store-window';
import { dropOldSamples, SampleStore, type Result, type Storage } from './store-unaligned';
import { readValues } from './values';

type Samples = Float32Array | Float64Array;

function interpolate(lo: number, hi: number, fraction: number): number {
  const width = hi - lo;
  return Number.isFinite(width) ? lo + width * fraction : lo * (1 - fraction) + hi * fraction;
}

function below(a: number, b: number): boolean {
  // Typed-array sort places negative zero before positive zero.
  return a < b || (a === 0 && b === 0 && 1 / a < 1 / b);
}

function select(samples: Float64Array, rank: number, left: number, right: number): void {
  while (right > left) {
    if (right - left > 600) {
      // Floyd–Rivest narrows the pivot search on large partitions.
      const count = right - left + 1;
      const offset = rank - left + 1;
      const log = Math.log(count);
      const size = 0.5 * Math.exp(2 * log / 3);
      const shift = 0.5 * Math.sqrt(log * size * (count - size) / count) * Math.sign(offset - count / 2);
      select(samples, rank, Math.max(left, Math.floor(rank - offset * size / count + shift)),
        Math.min(right, Math.floor(rank + (count - offset) * size / count + shift)));
    }
    const pivot = samples[rank]!;
    let i = left;
    let j = right;
    samples[rank] = samples[left]!;
    samples[left] = pivot;
    if (below(pivot, samples[right]!)) {
      samples[left] = samples[right]!;
      samples[right] = pivot;
    }
    while (i < j) {
      const value = samples[i]!;
      samples[i++] = samples[j]!;
      samples[j--] = value;
      while (below(samples[i]!, pivot)) i++;
      while (below(pivot, samples[j]!)) j--;
    }
    if (Object.is(samples[left], pivot)) {
      samples[left] = samples[j]!;
      samples[j] = pivot;
    } else {
      j++;
      samples[right] = samples[j]!;
      samples[j] = pivot;
    }
    if (j <= rank) left = j + 1;
    if (j >= rank) right = j - 1;
  }
}

function quartile(samples: Float64Array, at: number, left: number): number {
  const first = Math.floor(at), last = Math.ceil(at), right = samples.length - 1;
  select(samples, first, left, right);
  if (last > first) select(samples, last, last, right);
  return interpolate(samples[first]!, samples[last]!, at % 1);
}

interface SampleExtent {
  readonly low: number;
  readonly high: number;
  readonly count: number;
}

function sampleExtent(samples: Samples, borrowed = false, zero = false): SampleExtent | undefined {
  let low = Infinity;
  let high = -Infinity;
  let count = 0;
  for (let i = 0, length = samples.length; i < length; i++) {
    const value = samples[i]!;
    if (value === value && value !== Infinity && value !== -Infinity) {
      count++;
      if (value < low) low = value;
      else if (value === 0 && low === 0) low = Math.min(low, value);
      if (value > high) high = value;
      else if (value === 0 && high === 0) high = Math.max(high, value);
    } else if (borrowed && (zero || value === value)) return;
  }
  return { low, high, count };
}

function edgesFor(samples: Samples, bins: ResolvedOptions['bins'], extent: SampleExtent | undefined): Float64Array {
  if (bins !== undefined && typeof bins !== 'number') return Float64Array.from(bins);
  const { low, high, count: n } = extent ?? sampleExtent(samples)!;
  if (low > high) return new Float64Array();
  if (low === high) {
    const half = Math.max(0.5, Math.abs(low) * 0.05);
    return Float64Array.of(Math.max(-Number.MAX_VALUE, low - half), Math.min(Number.MAX_VALUE, high + half));
  }
  if (bins === undefined) {
    // Partition a private, finite-only column so source rows stay in order.
    let finite: Float64Array;
    if (n === samples.length) {
      finite = samples instanceof Float64Array ? samples.slice() : Float64Array.from(samples);
    } else {
      finite = new Float64Array(n);
      let next = 0;
      for (let i = 0; i < samples.length; i++) {
        const value = samples[i]!;
        if (Number.isFinite(value)) finite[next++] = value;
      }
    }
    const first = (n - 1) * 0.25;
    const q1 = quartile(finite, first, 0);
    const q3 = quartile(finite, (n - 1) * 0.75, Math.ceil(first));
    const width = 2 * (q3 - q1) / Math.cbrt(n);
    const wanted = width > 0 && Number.isFinite(width) ? (high - low) / width : Math.log2(n) + 1;
    bins = Math.min(100, Math.max(1, Math.ceil(wanted)));
    let step = niceStepAtLeast(high / bins - low / bins);
    while (Number.isFinite(step.value) && step.value > 0) {
      const start = lastIndexAtOrBelow(low, step);
      const end = firstIndexAtOrAbove(high, step);
      if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && end > start && end - start <= 100) {
        const edges = Float64Array.from({ length: end - start + 1 }, (_, i) =>
          Math.max(-Number.MAX_VALUE, Math.min(Number.MAX_VALUE, stepMultiple(start + i, step))));
        if (edges.every((e, i) => !i || e > edges[i - 1]!)) return edges;
      }
      step = nextNiceStep(step);
    }
  }
  const edges = new Float64Array(bins + 1);
  edges[0] = low;
  let end = 1;
  // Near the limits of double precision, only distinct representable boundaries make a bin.
  for (let i = 1; i < bins; i++) {
    const edge = interpolate(low, high, i / bins);
    if (edge > edges[end - 1]! && edge < high) edges[end++] = edge;
  }
  edges[end++] = high;
  return edges.subarray(0, end);
}

function histogramFrame(options: ResolvedOptions, samples: Samples, sink: DiagnosticSink, version: FrameVersion, extent?: SampleExtent): AlignedFrame {
  const { x, table, normalize, bins } = options;
  const derived = bins === undefined || typeof bins === 'number';
  if (derived) extent ??= sampleExtent(samples);
  let edges = edgesFor(samples, bins, extent);
  let y = new Float64Array(Math.max(0, edges.length - 1));
  let total = 0;
  const lo = edges[0]!, hi = edges[edges.length - 1]!;
  const span = hi - lo;
  const count = edges.length - 1;
  const scale = count * (1 / span);
  if (extent && extent.low >= lo && extent.high <= hi && scale > 0 && Number.isFinite(scale)) {
    // The outer edges come from these samples. Check the actual inner edges to repair rounding.
    const last = count - 1;
    const finite = extent.count === samples.length;
    for (let i = 0, length = samples.length; i < length; i++) {
      const value = samples[i]!;
      if (!finite && !(value === value && value !== Infinity && value !== -Infinity)) continue;
      let bin = Math.min(last, Math.floor((value - lo) * scale));
      if (value < edges[bin]!) {
        bin = value >= edges[bin - 1]! ? bin - 1 : binIndex(edges, value);
      } else if (bin < last && value >= edges[bin + 1]!) {
        // Repeated rounded boundaries can be dropped, so the estimate may miss by several bins.
        bin = bin + 1 === last || value < edges[bin + 2]! ? bin + 1 : binIndex(edges, value);
      }
      y[bin]!++;
    }
    total = extent.count;
  } else {
    const reports = new Reports(x.field, sink);
    for (let i = 0; i < samples.length; i++) {
      const value = samples[i]!;
      if (!Number.isFinite(value)) continue;
      const bin = binIndex(edges, value);
      if (bin < 0) reports.add('AX106', 'omitted', table.rowIndex(i), value);
      else { y[bin]!++; total++; }
    }
    reports.flush(sink);
  }
  if (!total) { edges = new Float64Array(); y = new Float64Array(); }
  const values = new Float64Array(y.length);
  const slot = new Uint8Array(y.length);
  const probability = normalize === 'probability';
  const density = normalize === 'density';
  const label = probability ? 'Probability' : density ? 'Density' : 'Count';
  for (let i = 0; i < y.length; i++) {
    const lo = edges[i]!, hi = edges[i + 1]!;
    const sum = lo + hi;
    values[i] = Number.isFinite(sum) ? sum / 2 : lo / 2 + hi / 2;
    if (i && values[i] === values[i - 1]) values[i] = hi;
    if (probability || density) y[i]! /= total;
    if (density) {
      const width = hi - lo;
      y[i] = Number.isFinite(width) ? y[i]! / width : (y[i]! / 2) / (hi / 2 - lo / 2);
      if (!Number.isFinite(y[i])) {
        report(sink, 'AX103', 'omitted', { field: label, count: 1, outcome: 'The density exceeds the numeric range.' });
        slot[i] = SLOT_INVALID;
        y[i] = NaN;
      }
    }
  }
  return {
    epoch: version.epoch, revision: version.revision, source: table, shape: 'aligned', length: y.length, xLabel: x.label, yLabel: label, binEdges: edges,
    x: { kind: 'number', values, categories: null, timeZone: null, dateUnit: null, ordered: false },
    series: [{ key: label, label, field: label, unit: null, valueScale: probability ? 'ratio' : null,
      drawable: true, y, slot, row: new Int32Array(y.length).fill(-1) }],
  };
}

function samplesOf(options: ResolvedOptions, sink: DiagnosticSink): Samples {
  const sample = options.sample!;
  return options.valid ? readValues(options.table, sample, sink, true, 0, sample.parse ? 'parsed' : undefined, undefined, 'The affected samples are omitted.').y
    : new Float64Array();
}

export function normalizeHistogram(_kind: string, options: ResolvedOptions, _env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): AlignedFrame {
  if (options.valid && (options.bins === undefined || typeof options.bins === 'number')) {
    const sample = options.sample!;
    const column = options.table.columns?.[sample.field];
    if (column instanceof Float64Array || column instanceof Float32Array) {
      // Collect bounds while checking for values that need diagnostics or zero imputation.
      const extent = sampleExtent(column, true, sample.missing === 'zero');
      if (extent) return histogramFrame(options, column, sink, version, extent);
    }
  }
  return histogramFrame(options, samplesOf(options, sink), sink, version);
}

class SampleWindow implements Storage<AlignedFrame> {
  constructor(
    private readonly values: Column<Float64Array>, private readonly options: ResolvedOptions,
    private readonly combined?: AlignedFrame,
  ) {}

  extend(next: Result<AlignedFrame>, rows: StreamRows, _first: number, keep?: number): SampleWindow {
    const values = this.values.extend(next.positions);
    if (keep !== undefined) values.drop(dropOldSamples(rows, keep));
    // The store has validated both partitions before taking this path.
    const combined = histogramFrame(this.options, values.view(), { add() {} }, next.frame);
    return new SampleWindow(values, this.options, combined);
  }

  frame(frame: AlignedFrame): AlignedFrame { return this.combined ?? frame; }
}

export function openHistogramStore(frame: Frame, source: ResolvedOptions, _data: unknown, env: DataEnvironment) {
  return new SampleStore('histogram', (options, _env, sink, version) => {
    const samples = samplesOf(options, sink);
    return { frame: histogramFrame(options, samples, sink, version),
      positions: samples instanceof Float64Array ? samples : Float64Array.from(samples), order: null };
  }, (result, options) => !options.valid || options.normalize === 'density' ? null : new SampleWindow(new Column(result.positions), options), source, env, frame, undefined, resolveOptions);
}
