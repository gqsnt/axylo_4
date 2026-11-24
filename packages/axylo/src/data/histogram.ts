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

function quartile(sorted: Samples, fraction: number): number {
  const at = (sorted.length - 1) * fraction;
  return interpolate(sorted[Math.floor(at)]!, sorted[Math.ceil(at)]!, at % 1);
}

function edgesFor(samples: Samples, bins: ResolvedOptions['bins']): Float64Array {
  if (bins !== undefined && typeof bins !== 'number') return Float64Array.from(bins);
  let low = Infinity;
  let high = -Infinity;
  let n = 0;
  for (const value of samples) if (Number.isFinite(value)) {
    n++;
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  if (low > high) return new Float64Array();
  if (low === high) {
    const half = Math.max(0.5, Math.abs(low) * 0.05);
    return Float64Array.of(Math.max(-Number.MAX_VALUE, low - half), Math.min(Number.MAX_VALUE, high + half));
  }
  if (bins === undefined) {
    // Sort a private double column so borrowed samples and their source indexes stay in order.
    const finite = Float64Array.from(samples).sort().subarray(0, n);
    const width = 2 * (quartile(finite, 0.75) - quartile(finite, 0.25)) / Math.cbrt(n);
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

function histogramFrame(options: ResolvedOptions, samples: Samples, sink: DiagnosticSink, version: FrameVersion): AlignedFrame {
  const { x, table, normalize } = options;
  let edges = edgesFor(samples, options.bins);
  let y = new Float64Array(Math.max(0, edges.length - 1));
  let total = 0;
  const reports = new Reports(x.field, sink);
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i]!;
    if (!Number.isFinite(value)) continue;
    const bin = binIndex(edges, value);
    if (bin < 0) reports.add('AX106', 'omitted', table.rowIndex(i), value);
    else { y[bin]!++; total++; }
  }
  reports.flush(sink);
  if (!total) { edges = new Float64Array(); y = new Float64Array(); }
  const values = new Float64Array(y.length);
  const slot = new Uint8Array(y.length);
  const probability = normalize === 'probability';
  const density = normalize === 'density';
  const label = probability ? 'Probability' : density ? 'Density' : 'Count';
  for (let i = 0; i < y.length; i++) {
    const lo = edges[i]!, hi = edges[i + 1]!;
    values[i] = interpolate(lo, hi, 0.5);
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
  return histogramFrame(options, samplesOf(options, sink), sink, version);
}

class SampleWindow implements Storage<AlignedFrame> {
  constructor(
    private readonly values: Column<Float64Array>, private readonly options: ResolvedOptions,
    private readonly combined?: AlignedFrame,
  ) {}

  extend(next: Result<AlignedFrame>, rows: StreamRows, _first: number, keep?: number): SampleWindow {
    const values = this.values.fork();
    values.append(next.positions);
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
  }, (result, options) => !options.valid || options.normalize === 'density' ? null : new SampleWindow(new Column(n => new Float64Array(n), result.positions), options), source, env, frame, undefined, resolveOptions);
}
