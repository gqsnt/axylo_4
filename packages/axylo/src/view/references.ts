import type { DiagnosticSink, ResolvedReference, XColumn, XKind } from '../core/contracts';
import type { ResolvedXField } from '../data';
import { Reports } from '../data/reports';
import { nameOf, XParser } from '../data/x';
import { report } from '../diagnostics';
import type { Reference, XValue } from '../public';

export type Span<T = number> = readonly [T, T];

export function positionReader(
  x: Pick<XColumn, 'kind' | 'categories' | 'timeZone'>,
  field: ResolvedXField | undefined,
): (value: XValue) => number {
  if (x.kind === 'category') return value => {
    const name = nameOf(value);
    const index = name === null ? -1 : x.categories?.indexOf(name) ?? -1;
    return index < 0 ? NaN : index;
  };
  const resolved: ResolvedXField = field ?? {
    field: 'x', label: 'x', unit: null, type: x.kind === 'wall' ? null : x.kind,
    timeZone: x.timeZone ?? 'UTC', ordered: false, format: null, tickFormat: null, domain: null,
  };
  const parser = new XParser(resolved, x.kind, { timeZone: x.timeZone ?? 'UTC' });
  // Option positions have no source row. Their diagnostics are reported with the option's name.
  const reports = new Reports(resolved.field);
  return value => parser.read(value, -1, reports);
}

export function readSpan(
  input: Span<XValue> | null | undefined, read: (x: XValue) => number, field: string, sink: DiagnosticSink,
): Span | null {
  if (!input) return null;
  const a = read(input[0]);
  const b = read(input[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    report(sink, 'AX107', 'none', { field, detail: 'Supply two bounds in the x axis format.' });
    return null;
  }
  return [Math.min(a, b), Math.max(a, b)];
}

function isPair<T>(value: T | Span<T>): value is Span<T> {
  return Array.isArray(value);
}

export function resolveReferences(
  input: readonly Reference[], readX: (value: XValue) => number, xKind: XKind, sink: DiagnosticSink,
): ResolvedReference[] {
  const references: ResolvedReference[] = [];
  for (let i = 0; i < input.length; i++) {
    const { x, y, label } = input[i]!;
    if (x !== undefined) {
      const from = readX(isPair(x) ? x[0] : x);
      const to = isPair(x) ? readX(x[1]) : from;
      if (Number.isFinite(from) && Number.isFinite(to)) {
        references.push({ axis: 'x', from: Math.min(from, to), to: Math.max(from, to), label });
      } else {
        report(sink, 'AX107', 'none', {
          field: 'reference[' + i + '].x',
          detail: xKind === 'category' ? 'Use an existing category for each bound.' : 'Supply a reference in the x axis format.',
        });
      }
    }
    if (y !== undefined) {
      const from = isPair(y) ? y[0] : y;
      const to = isPair(y) ? y[1] : from;
      if (Number.isFinite(from) && Number.isFinite(to)) {
        references.push({ axis: 'y', from: Math.min(from, to), to: Math.max(from, to), label });
      } else {
        report(sink, 'AX103', 'none', { field: 'reference[' + i + '].y' });
      }
    }
  }
  return references;
}
