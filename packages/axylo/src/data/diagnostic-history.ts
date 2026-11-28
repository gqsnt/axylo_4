import type { DiagnosticEffect, DiagnosticInput, DiagnosticSink, XColumn } from "../core/contracts";
import {
  DiagnosticCollector,
  createDiagnostic,
  report,
  type DiagnosticCode,
  type DiagnosticDetails,
} from "../diagnostics";

export interface DiagnosticTrace extends DiagnosticSink {
  traceRow?(
    code: DiagnosticCode,
    field: string,
    effect: DiagnosticEffect,
    row: number,
    amount?: number,
    example?: string,
    series?: string,
  ): void;
  traceGaps?(
    field: string,
    effect: DiagnosticEffect,
    positions: Float64Array,
    details?: DiagnosticDetails,
    axis?: XColumn,
  ): void;
  traceSparseGaps?(details: DiagnosticDetails, seriesKey?: string): void;
}

export function keyOf(
  code: DiagnosticInput["code"],
  field: string | undefined,
  effect: DiagnosticEffect,
): string {
  return JSON.stringify([code, field, effect]);
}

export interface Sample {
  readonly count: number;
  readonly examples: readonly string[];
  readonly series: readonly string[];
}

interface Occurrences<M> {
  coordinates: M;
  readonly gaps: boolean;
  readonly axis?: XColumn;
  count: number;
}

export function addSamples(target: Set<string>, samples: Iterable<string>): void {
  for (const sample of samples) {
    if (target.size === 10) break;
    target.add(sample);
  }
}

const noNames: readonly string[] = [];
function combined(before: readonly string[], after: readonly string[]): readonly string[] {
  if (!before.length) return after;
  if (!after.length || before.length === 10) return before;
  return [...new Set([...before, ...after])].slice(0, 10);
}

export type Coordinates = Iterable<[number, Sample]> & {
  get(key: number): Sample | undefined;
  set(key: number, sample: Sample): void;
};

// Normalizing a frame records each diagnostic coordinate once. Only an opened store needs
// transactional indexes, eviction and a retained-window view over these observations.
export class DiagnosticHistory<M extends Coordinates = Map<number, Sample>>
  extends DiagnosticCollector
  implements DiagnosticTrace
{
  occurrences?: Map<string, Occurrences<M>>;
  sparse?: Map<string, DiagnosticInput>;

  constructor(
    private readonly coordinates: new () => M,
    public sink?: DiagnosticTrace,
  ) {
    super();
  }

  override add(diagnostic: DiagnosticInput): void {
    super.add(diagnostic);
    this.sink?.add(diagnostic);
  }

  get diagnostics(): Iterable<DiagnosticInput> {
    return this.entries.values();
  }
  protected trace(
    key: string,
    coordinate: number,
    gaps: boolean,
    sample: Sample,
    axis?: XColumn,
  ): void {
    const occurrences = (this.occurrences ??= new Map<string, Occurrences<M>>());
    let entry = occurrences.get(key);
    if (!entry)
      occurrences.set(key, (entry = { coordinates: new this.coordinates(), count: 0, gaps, axis }));
    const previous = entry.coordinates.get(coordinate);
    entry.coordinates.set(
      coordinate,
      previous
        ? {
            count: previous.count + sample.count,
            examples: combined(previous.examples, sample.examples),
            series: combined(previous.series, sample.series),
          }
        : sample,
    );
    entry.count += sample.count;
  }

  traceRow(
    code: DiagnosticCode,
    field: string,
    effect: DiagnosticEffect,
    row: number,
    amount = 1,
    example?: string,
    series?: string,
  ): void {
    this.trace(keyOf(code, field, effect), row, false, {
      count: amount,
      examples: example === undefined ? noNames : [example],
      series: series === undefined ? noNames : [series],
    });
    this.sink?.traceRow?.(code, field, effect, row, amount, example, series);
  }

  traceGaps(
    field: string,
    effect: DiagnosticEffect,
    positions: Float64Array,
    details?: DiagnosticDetails,
    axis?: XColumn,
  ): void {
    const key = keyOf("AX105", field, effect);
    const sample = {
      count: 1,
      examples: noNames,
      series: details?.series ? [...new Set(details.series)].slice(0, 10) : noNames,
    };
    for (const position of positions) this.trace(key, position, true, sample, axis);
    this.sink?.traceGaps?.(field, effect, positions, details, axis);
  }

  traceSparseGaps(details: DiagnosticDetails, seriesKey?: string): void {
    (this.sparse ??= new Map()).set(
      seriesKey ?? details.sparseSeries?.[0] ?? "",
      createDiagnostic("AX105", "none", details),
    );
    if (this.sink?.traceSparseGaps) this.sink.traceSparseGaps(details, seriesKey);
    else if (this.sink) report(this.sink, "AX105", "none", details);
  }
}
