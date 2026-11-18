import type { DiagnosticSink, ResolvedReference, XColumn, XKind } from '../core/contracts';
import type { ResolvedXField } from '../data';
import { Reports } from '../data/reports';
import { nameOf, XParser } from '../data/x';
import { report } from '../diagnostics';
import { diagnosticContext, type DiagnosticCode } from '../diagnostics/registry';
import type { Reference, XValue } from '../public';

export type Span<T = number> = readonly [T, T];

interface Option {
  readonly field: string;
  readonly sink: DiagnosticSink;
  readonly axisPosition?: boolean;
  readonly detail?: string;
}

type PositionReader = (value: XValue, option?: Option) => number;

export function positionReader(
  x: Pick<XColumn, 'kind' | 'categories' | 'timeZone'>,
  field: ResolvedXField | undefined,
): PositionReader {
  if (x.kind === 'category') return (value, option) => {
    const name = nameOf(value);
    const index = name === null ? -1 : x.categories?.indexOf(name) ?? -1;
    if (index >= 0) return index;
    if (option) report(option.sink, 'AX107', 'none', {
      field: option.field, detail: option.detail, outcome: 'The option is ignored.',
    });
    return NaN;
  };
  const resolved: ResolvedXField = field ?? {
    field: 'x', label: 'x', unit: null, type: x.kind === 'wall' || x.kind === 'number' ? null : x.kind,
    timeZone: x.timeZone ?? 'UTC', ordered: false, format: null, tickFormat: null, domain: null,
  };
  const parser = new XParser(resolved, x.kind, { timeZone: x.timeZone ?? 'UTC' });
  return (value, option) => {
    if (option?.axisPosition && x.kind !== 'number' && typeof value === 'number' && Number.isFinite(value)) return value;
    const reports = new Reports(option?.field ?? resolved.field);
    const position = parser.read(value, -1, reports);
    // The parser's diagnostics still apply, but an option has no source row or omitted data values.
    if (option) reports.flush({
      add(diagnostic) {
        const context = diagnosticContext(diagnostic);
        report(option.sink, diagnostic.code as DiagnosticCode, 'none', {
          ...context, field: diagnostic.field, count: diagnostic.count,
          detail: diagnostic.effect === 'omitted' ? option.detail : context?.detail,
          outcome: diagnostic.effect === 'omitted' ? 'The option is ignored.' : context?.outcome,
        });
      },
    });
    return position;
  };
}

export function readSpan(
  input: Span<XValue> | null | undefined, read: PositionReader, field: string, sink: DiagnosticSink,
  ordered = false,
): Span | null {
  if (!input) return null;
  const option = { field, sink, axisPosition: true, detail: 'Supply two bounds in the x axis format.' };
  const a = read(input[0], option);
  const b = read(input[1], option);
  if (!Number.isFinite(a) || !Number.isFinite(b) || ordered && a >= b) return null;
  return [Math.min(a, b), Math.max(a, b)];
}

function isPair<T>(value: T | Span<T>): value is Span<T> {
  return Array.isArray(value);
}

export function resolveReferences(
  input: readonly Reference[], readX: PositionReader, xKind: XKind, sink: DiagnosticSink,
): ResolvedReference[] {
  const references: ResolvedReference[] = [];
  for (let i = 0; i < input.length; i++) {
    const { x, y, label } = input[i]!;
    const add = (axis: 'x' | 'y', from: number, to: number) => {
      references.push({ axis, from: Math.min(from, to), to: Math.max(from, to), label });
    };
    if (x !== undefined) {
      const pair = isPair(x);
      const option = {
        field: 'reference[' + i + '].x', sink,
        detail: xKind === 'category' ? 'Use an existing category for each bound.' : 'Supply a reference in the x axis format.',
      };
      const from = readX(pair ? x[0] : x, option);
      const to = pair ? readX(x[1], option) : from;
      if (Number.isFinite(from) && Number.isFinite(to)) add('x', from, to);
    }
    if (y !== undefined) {
      const pair = isPair(y);
      const from = pair ? y[0] : y;
      const to = pair ? y[1] : from;
      if (Number.isFinite(from) && Number.isFinite(to)) {
        add('y', from, to);
      } else {
        report(sink, 'AX103', 'none', { field: 'reference[' + i + '].y' });
      }
    }
  }
  return references;
}
