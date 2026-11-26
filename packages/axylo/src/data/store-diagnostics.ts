import type { DiagnosticEffect, DiagnosticInput, DiagnosticSink, XColumn } from '../core/contracts';
import { DiagnosticCollector, createDiagnostic, report, type DiagnosticCode, type DiagnosticDetails } from '../diagnostics';
import { diagnosticContext } from '../diagnostics/registry';
import { StoreMap } from './store-map';
import { positionName } from './x';

export interface DiagnosticTrace extends DiagnosticSink {
  traceRow?(code: DiagnosticCode, field: string, effect: DiagnosticEffect, row: number, amount?: number, example?: string, series?: string): void;
  traceGaps?(field: string, effect: DiagnosticEffect, positions: Float64Array, details?: DiagnosticDetails, axis?: XColumn): void;
  traceSparseGaps?(details: DiagnosticDetails, seriesKey?: string): void;
}

export function recordDiagnostics(sink: DiagnosticTrace, record: StreamDiagnostics): DiagnosticTrace {
  return {
    add(diagnostic) {
      record.add(diagnostic);
      sink.add(diagnostic);
    },
    traceRow(...args) {
      record.traceRow(...args);
      sink.traceRow?.(...args);
    },
    traceGaps(...args) {
      record.traceGaps(...args);
      sink.traceGaps?.(...args);
    },
    traceSparseGaps(details, seriesKey) {
      record.traceSparseGaps(details, seriesKey);
      if (sink.traceSparseGaps) sink.traceSparseGaps(details, seriesKey);
      else report(sink, 'AX105', 'none', details);
    },
  };
}

function keyOf(code: DiagnosticInput['code'], field: string | undefined, effect: DiagnosticEffect): string {
  return JSON.stringify([code, field, effect]);
}

interface Sample {
  count: number;
  readonly examples: Set<string>;
  readonly series: Set<string>;
}

interface Occurrences {
  readonly coordinates: StoreMap<number, Sample>;
  readonly gaps: boolean;
  readonly axis?: XColumn;
  count: number;
}

function addSamples(target: Set<string>, samples: Iterable<string>): void {
  for (const sample of samples) {
    if (target.size === 10) break;
    target.add(sample);
  }
}

export class StreamDiagnostics extends DiagnosticCollector implements DiagnosticTrace {
  readonly #occurrences = new Map<string, Occurrences>();
  readonly #sparse = new Map<string, DiagnosticInput>();

  fork(): StreamDiagnostics {
    const draft = new StreamDiagnostics();
    for (const [key, occurrence] of this.#occurrences) {
      draft.#occurrences.set(key, { ...occurrence, coordinates: occurrence.coordinates.fork() });
    }
    for (const [key, diagnostic] of this.entries) draft.entries.set(key, diagnostic);
    for (const [key, diagnostic] of this.#sparse) draft.#sparse.set(key, diagnostic);
    return draft;
  }

  copy(): StreamDiagnostics {
    const copy = new StreamDiagnostics();
    copy.merge(this);
    return copy;
  }

  commit(): void {
    for (const occurrence of this.#occurrences.values()) occurrence.coordinates.commit();
  }

  #trace(key: string, coordinate: number, gaps: boolean, amount: number,
    examples: Iterable<string>, series: Iterable<string>, axis?: XColumn): void {
    let entry = this.#occurrences.get(key);
    if (!entry) this.#occurrences.set(key, entry = { coordinates: new StoreMap(), count: 0, gaps, axis });
    const previous = entry.coordinates.get(coordinate);
    const sample = { count: previous?.count ?? 0, examples: new Set(previous?.examples), series: new Set(previous?.series) };
    entry.coordinates.set(coordinate, sample);
    sample.count += amount;
    addSamples(sample.examples, examples);
    addSamples(sample.series, series);
    entry.count += amount;
  }

  traceRow(code: DiagnosticCode, field: string, effect: DiagnosticEffect, row: number, amount = 1, example?: string, series?: string): void {
    this.#trace(keyOf(code, field, effect), row, false, amount, example === undefined ? [] : [example], series === undefined ? [] : [series]);
  }

  traceGaps(field: string, effect: DiagnosticEffect, positions: Float64Array, details?: DiagnosticDetails, axis?: XColumn): void {
    const key = keyOf('AX105', field, effect);
    for (const position of positions) this.#trace(key, position, true, 1, [], details?.series ?? [], axis);
  }

  traceSparseGaps(details: DiagnosticDetails, seriesKey?: string): void {
    this.#sparse.set(seriesKey ?? details.sparseSeries?.[0] ?? '', createDiagnostic('AX105', 'none', details));
  }

  merge(batch: StreamDiagnostics): void {
    for (const [name, diagnostic] of batch.#sparse) this.#sparse.set(name, diagnostic);
    for (const diagnostic of batch.entries.values()) this.add(diagnostic);
    for (const [key, { coordinates, gaps, axis }] of batch.#occurrences) {
      for (const [coordinate, sample] of coordinates) this.#trace(key, coordinate, gaps, sample.count, sample.examples, sample.series, axis);
    }
  }

  evict(coordinate: number, gaps: boolean): void {
    for (const [key, occurrence] of this.#occurrences) {
      if (occurrence.gaps !== gaps) continue;
      const sample = occurrence.coordinates.get(coordinate);
      if (!sample) continue;
      occurrence.count -= sample.count;
      occurrence.coordinates.delete(coordinate);
      if (occurrence.count === 0) {
        this.entries.delete(key);
        this.#occurrences.delete(key);
      }
    }
  }

  evictSeries(key: string): void {
    this.#sparse.delete(key);
  }

  override inputs(): readonly DiagnosticInput[] {
    return this.retained();
  }

  retained(): readonly DiagnosticInput[] {
    const result = new DiagnosticCollector();
    for (const diagnostic of this.entries.values()) {
      const { code, field, effect, origin } = diagnostic;
      const entry = this.#occurrences.get(keyOf(code, field, effect));
      if (!entry) {
        result.add(diagnostic);
        continue;
      }
      const rows: number[] = [];
      const examples = new Set<string>();
      const series = new Set<string>();
      for (const [coordinate, sample] of entry.coordinates) {
        if (entry.gaps) {
          examples.add(entry.axis ? positionName(entry.axis, coordinate) : String(coordinate));
        } else {
          rows.push(coordinate);
          addSamples(examples, sample.examples);
        }
        addSamples(series, sample.series);
        if (rows.length === 10 || entry.gaps && examples.size === 10) break;
      }
      result.add(createDiagnostic(code as DiagnosticCode, effect, {
        ...diagnosticContext(diagnostic), field, count: entry.count,
        rows: entry.gaps ? undefined : rows, examples: [...examples], series: [...series],
      }, origin));
    }
    for (const diagnostic of this.#sparse.values()) result.add(diagnostic);
    return result.inputs();
  }
}
