import type { DiagnosticInput, DiagnosticSink } from '../core/contracts';
import type { Diagnostic } from '../public';
import { createDiagnostic, diagnosticContext, type DiagnosticCode } from './registry';

export class DiagnosticCollector implements DiagnosticSink {
  private readonly entries = new Map<string, DiagnosticInput>();

  add(diagnostic: DiagnosticInput): void {
    const { code, field, effect, rows, count } = diagnostic;
    const key = JSON.stringify([code, field, effect]);
    const first = this.entries.get(key);
    if (!first) {
      const copy = rows && rows.length > 10
        ? { ...diagnostic, rows: rows.slice(0, 10), count: count ?? rows.length }
        : diagnostic;
      this.entries.set(key, copy);
      return;
    }

    const mergedRows = first.rows || rows
      ? [...(first.rows ?? []), ...(rows?.slice(0, 10) ?? [])].slice(0, 10)
      : undefined;
    const mergedCount = (first.count ?? first.rows?.length ?? 1) + (count ?? rows?.length ?? 1);
    const origin = diagnostic.origin === 'call' ? 'call' : first.origin;
    const context = diagnosticContext(first);
    if (context) {
      const later = diagnosticContext(diagnostic);
      const examples = [...(context.examples ?? []), ...(later?.examples ?? [])].slice(0, 10);
      this.entries.set(key, createDiagnostic(code as DiagnosticCode, effect, {
        ...context, examples, field, rows: mergedRows, count: mergedCount,
      }, origin));
    } else {
      this.entries.set(key, { ...first, rows: mergedRows, count: mergedCount, origin });
    }
  }

  inputs(): readonly DiagnosticInput[] {
    return Array.from(this.entries.values());
  }

  list(chart: string): readonly Diagnostic[] {
    return this.inputs().map(({ effect: _effect, origin: _origin, ...diagnostic }) => ({ ...diagnostic, chart }));
  }
}

export function readerDisclosure(diagnostics: readonly DiagnosticInput[]): { omitted: number; changed: number } {
  const disclosure = { omitted: 0, changed: 0 };
  for (const { effect, count, rows } of diagnostics) {
    if (effect === 'omitted' || effect === 'changed') disclosure[effect] += count ?? rows?.length ?? 1;
  }
  return disclosure;
}
