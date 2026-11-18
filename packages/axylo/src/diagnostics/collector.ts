import type { DiagnosticInput, DiagnosticSink } from '../core/contracts';
import type { Diagnostic } from '../public';
import { createDiagnostic, diagnosticContext, type DiagnosticCode } from './registry';

function samples(a?: readonly string[], b?: readonly string[]): readonly string[] {
  return [...new Set([...(a ?? []), ...(b ?? [])])].slice(0, 10);
}

export class DiagnosticCollector implements DiagnosticSink {
  protected readonly entries = new Map<string, DiagnosticInput>();

  add(diagnostic: DiagnosticInput): void {
    const { code, field, effect, rows, count } = diagnostic;
    const key = JSON.stringify([code, field, effect]);
    const first = this.entries.get(key);
    if (!first) {
      const context = diagnosticContext(diagnostic);
      const unique = rows === undefined ? undefined : [...new Set(rows)].slice(0, 10);
      const copy = unique?.length !== rows?.length && context
        ? createDiagnostic(code as DiagnosticCode, effect, { ...context, field, rows: unique, count: count ?? rows?.length }, diagnostic.origin)
        : unique?.length !== rows?.length ? { ...diagnostic, rows: unique, count: count ?? rows?.length } : diagnostic;
      this.entries.set(key, copy);
      return;
    }

    const mergedRows = first.rows || rows
      ? [...new Set([...(first.rows ?? []), ...(rows ?? [])])].slice(0, 10)
      : undefined;
    const mergedCount = (first.count ?? first.rows?.length ?? 1) + (count ?? rows?.length ?? 1);
    const origin = diagnostic.origin === 'call' ? 'call' : first.origin;
    const context = diagnosticContext(first);
    if (context) {
      const later = diagnosticContext(diagnostic);
      const examples = samples(context.examples, later?.examples);
      const series = samples(context.series, later?.series);
      const sparseSeries = samples(context.sparseSeries, later?.sparseSeries);
      const zeroSeries = context.zeroSeries || later?.zeroSeries ? samples(context.zeroSeries, later?.zeroSeries) : undefined;
      this.entries.set(key, createDiagnostic(code as DiagnosticCode, effect, {
        ...context, examples, series, sparseSeries, zeroSeries, field, rows: mergedRows, count: mergedCount,
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
  for (const { level, effect, count, rows } of diagnostics) {
    if (level !== 'warning') continue;
    if (effect === 'omitted' || effect === 'changed') disclosure[effect] += count ?? rows?.length ?? 1;
  }
  return disclosure;
}
