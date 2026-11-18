import { SLOT_VALUE, type AlignedFrame, type DiagnosticInput, type DiagnosticSink, type StackView } from '../core/contracts';
import { createDiagnostic } from '../diagnostics';

const overflow = new WeakMap<StackView, readonly DiagnosticInput[]>();

export function reportStack(stack: StackView, sink: DiagnosticSink): void {
  for (const diagnostic of overflow.get(stack) ?? []) sink.add(diagnostic);
}

export function buildStack(frame: AlignedFrame, visible: readonly boolean[]): StackView {
  const order: number[] = [];
  const positive: Float64Array[] = [];
  const negative: Float64Array[] = [];
  const diagnostics: DiagnosticInput[] = [];
  let incomplete: Uint8Array | null = null;

  for (let i = 0; i < frame.series.length; i++) {
    if (!visible[i]) continue;
    const series = frame.series[i]!;
    const prevPositive = positive.at(-1);
    const prevNegative = negative.at(-1);
    const pos = new Float64Array(frame.length);
    const neg = new Float64Array(frame.length);
    let count = 0;
    const rows: number[] = [];

    for (let slot = 0; slot < frame.length; slot++) {
      let above = prevPositive?.[slot] ?? 0;
      let below = prevNegative?.[slot] ?? 0;
      if (series.slot[slot] === SLOT_VALUE) {
        const value = series.y[slot]!;
        if (value >= 0) above += value;
        else below += value;
        if (!Number.isFinite(above) || !Number.isFinite(below)) {
          above = Math.min(above, Number.MAX_VALUE);
          below = Math.max(below, -Number.MAX_VALUE);
          count++;
          const row = series.row?.[slot] ?? slot;
          if (row >= 0 && rows.length < 10) rows.push(row);
        }
      } else {
        incomplete ??= new Uint8Array(frame.length);
        incomplete[slot] = 1;
      }
      pos[slot] = above;
      neg[slot] = below;
    }

    if (count) diagnostics.push(createDiagnostic('AX103', 'changed', { field: series.field, count, rows }));
    order.push(i);
    positive.push(pos);
    negative.push(neg);
  }

  const stack = { order, positive, negative, incomplete };
  if (diagnostics.length) overflow.set(stack, diagnostics);
  return stack;
}
