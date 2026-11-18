import type { DiagnosticEffect, DiagnosticInput, DiagnosticSink } from '../core/contracts';
import { DiagnosticCollector, createDiagnostic, type DiagnosticCode } from '../diagnostics';
import { diagnosticContext } from '../diagnostics/registry';

export interface DiagnosticTrace extends DiagnosticSink {
  traceRow?(code: DiagnosticCode, field: string, effect: DiagnosticEffect, row: number): void;
  traceGaps?(field: string, effect: DiagnosticEffect, positions: Float64Array): void;
}

function keyOf(code: DiagnosticInput['code'], field: string | undefined, effect: DiagnosticEffect): string {
  return JSON.stringify([code, field, effect]);
}

interface Occurrences {
  readonly coordinates: Map<number, number>;
  readonly gaps: boolean;
  count: number;
}

export class StreamDiagnostics extends DiagnosticCollector implements DiagnosticTrace {
  private readonly occurrences = new Map<string, Occurrences>();

  private trace(key: string, coordinate: number, gaps: boolean, amount = 1): void {
    let entry = this.occurrences.get(key);
    if (!entry) this.occurrences.set(key, entry = { coordinates: new Map(), count: 0, gaps });
    entry.coordinates.set(coordinate, (entry.coordinates.get(coordinate) ?? 0) + amount);
    entry.count += amount;
  }

  traceRow(code: DiagnosticCode, field: string, effect: DiagnosticEffect, row: number): void {
    this.trace(keyOf(code, field, effect), row, false);
  }

  traceGaps(field: string, effect: DiagnosticEffect, positions: Float64Array): void {
    const key = keyOf('AX105', field, effect);
    for (const position of positions) this.trace(key, position, true);
  }

  merge(batch: StreamDiagnostics): void {
    for (const diagnostic of batch.inputs()) this.add(diagnostic);
    for (const [key, { coordinates, gaps }] of batch.occurrences) {
      for (const [coordinate, amount] of coordinates) this.trace(key, coordinate, gaps, amount);
    }
  }

  evict(coordinate: number, gaps: boolean): void {
    for (const occurrence of this.occurrences.values()) {
      if (occurrence.gaps !== gaps) continue;
      const amount = occurrence.coordinates.get(coordinate);
      if (amount === undefined) continue;
      occurrence.count -= amount;
      occurrence.coordinates.delete(coordinate);
    }
  }

  retained(): readonly DiagnosticInput[] {
    const result: DiagnosticInput[] = [];
    for (const diagnostic of this.inputs()) {
      const { code, field, effect } = diagnostic;
      const entry = this.occurrences.get(keyOf(code, field, effect));
      if (!entry || entry.count === diagnostic.count) {
        result.push(diagnostic);
        continue;
      }
      if (entry.count === 0) continue;
      const samples: number[] = [];
      for (const [coordinate, amount] of entry.coordinates) {
        for (let i = 0; i < amount && samples.length < 10; i++) samples.push(coordinate);
        if (samples.length === 10) break;
      }
      result.push(createDiagnostic(code as DiagnosticCode, effect, {
        ...diagnosticContext(diagnostic), field, count: entry.count,
        rows: entry.gaps ? undefined : samples, examples: entry.gaps ? samples.map(String) : undefined,
      }));
    }
    return result;
  }
}
