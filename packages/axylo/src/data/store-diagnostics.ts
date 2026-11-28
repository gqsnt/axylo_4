import type { DiagnosticInput } from '../core/contracts';
import { DiagnosticCollector, createDiagnostic, type DiagnosticCode } from '../diagnostics';
import { diagnosticContext } from '../diagnostics/registry';
import { addSamples, DiagnosticHistory, keyOf, type Coordinates, type Sample } from './diagnostic-history';
import { StoreMap } from './store-map';
import { positionName } from './x';

export class StreamDiagnostics extends DiagnosticHistory<StoreMap<number, Sample>> {
  constructor() { super(StoreMap); }

  fork(): StreamDiagnostics {
    const draft = new StreamDiagnostics();
    if (this.occurrences) {
      draft.occurrences = new Map();
      for (const [key, entry] of this.occurrences) draft.occurrences.set(key, { ...entry, coordinates: entry.coordinates.fork() });
    }
    if (this.entries.size) for (const [key, diagnostic] of this.entries) draft.entries.set(key, diagnostic);
    if (this.sparse) draft.sparse = new Map(this.sparse);
    return draft;
  }

  commit(): void {
    if (this.occurrences) for (const occurrence of this.occurrences.values()) occurrence.coordinates = occurrence.coordinates.commit();
  }

  merge(batch: DiagnosticHistory<Coordinates>): void {
    if (batch.sparse) for (const [name, diagnostic] of batch.sparse) (this.sparse ??= new Map()).set(name, diagnostic);
    for (const diagnostic of batch.diagnostics) this.add(diagnostic);
    if (batch.occurrences) for (const [key, { coordinates, gaps, axis }] of batch.occurrences) {
      for (const [coordinate, sample] of coordinates) this.trace(key, coordinate, gaps, sample, axis);
    }
  }

  evict(coordinate: number, gaps: boolean): void {
    if (!this.occurrences) return;
    for (const [key, occurrence] of this.occurrences) {
      if (occurrence.gaps !== gaps) continue;
      const sample = occurrence.coordinates.get(coordinate);
      if (!sample) continue;
      occurrence.count -= sample.count;
      occurrence.coordinates.delete(coordinate);
      if (occurrence.count === 0) {
        this.entries.delete(key);
        this.occurrences.delete(key);
      }
    }
  }

  evictSeries(key: string): void {
    this.sparse?.delete(key);
  }

  override inputs(): readonly DiagnosticInput[] {
    if (!this.occurrences?.size && !this.sparse?.size) return super.inputs();
    const result = new DiagnosticCollector();
    for (const diagnostic of this.entries.values()) {
      const { code, field, effect, origin } = diagnostic;
      const entry = this.occurrences?.get(keyOf(code, field, effect));
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
    if (this.sparse) for (const diagnostic of this.sparse.values()) result.add(diagnostic);
    return result.inputs();
  }
}
