import { SLOT_VALUE, type DiagnosticSink, type DonutFrame, type DonutSlice, type DonutView } from '../core/contracts';
import { report } from '../diagnostics';

const TURN = 6.283185307179586; // 2π, a literal so the module does no work at import time
const OTHER = '__other__';

export function buildDonut(
  frame: DonutFrame, otherLabel: (count: number) => string, previous: DonutView | undefined, sink: DiagnosticSink,
): DonutView {
  const result = { kind: 'donut' as const, frame, revision: frame.revision };
  // Normalization has already reported chart errors. No partial ring should be drawn for either.
  if (new Set(frame.labels).size !== frame.labels.length) return { ...result, slices: [], total: 0 };

  let total = 0;
  let max = 0;
  let positive = 0;
  const largest: number[] = [];
  for (let i = 0; i < frame.labels.length; i++) {
    if (frame.slot[i] !== SLOT_VALUE) continue;
    const value = frame.values[i]!;
    if (value < 0) return { ...result, slices: [], total: 0 };
    if (value === 0) continue;
    positive++;
    total += value;
    max = Math.max(max, value);
    // Only the first seven ranks can affect grouping, even for a very large input.
    const rank = largest.findIndex(index => frame.values[index]! < value);
    if (rank >= 0) largest.splice(rank, 0, i);
    else if (largest.length < 7) largest.push(i);
    if (largest.length > 7) largest.pop();
  }

  const grouped = positive > 8;
  const label = grouped ? otherLabel(positive - 7) : '';
  if (grouped) report(sink, 'AX121', 'changed', { field: frame.valueLabel, count: positive - 7 });
  const scaled = !Number.isFinite(total);
  let denominator = total;
  if (scaled) {
    report(sink, 'AX103', 'changed', { field: frame.valueLabel });
    denominator = 0;
    for (let i = 0; i < frame.values.length; i++) {
      if (frame.slot[i] === SLOT_VALUE) denominator += frame.values[i]! / max;
    }
  }
  if (previous?.frame === frame && (!grouped || previous.slices.at(-1)?.label === label)) return previous;

  const slices: DonutSlice[] = [];
  let angle = 0;
  let drawn = 0;
  const drawnCount = grouped ? 8 : positive;
  let arcless = grouped ? 7 : positive;
  function add(key: string, label: string, members: readonly number[], value: number | null, weight: number): void {
    const ratio = value === null ? null : weight === 0 ? 0 : weight / denominator;
    let angles: DonutSlice['angles'] = null;
    if (value !== null && value > 0) {
      const end = ++drawn === drawnCount ? TURN : Math.min(TURN, angle + ratio! * TURN);
      angles = [angle, end];
      angle = end;
    }
    // Reserve the first palette slots for arcs so arcless entries cannot force the ring to wrap.
    const colorIndex = key === OTHER ? null : angles ? drawn - 1 : arcless++;
    slices.push({ key, label, members, value, ratio, angles, colorIndex });
  }

  const kept = grouped ? new Set(largest) : null;
  const others: number[] = [];
  let otherValue = 0;
  let otherWeight = 0;
  for (let i = 0; i < frame.labels.length; i++) {
    const name = frame.labels[i]!;
    const value = frame.slot[i] === SLOT_VALUE ? frame.values[i]! : null;
    const weight = scaled ? (value ?? 0) / max : value ?? 0;
    if (kept && value !== null && value > 0 && !kept.has(i)) {
      others.push(i);
      otherValue += value;
      otherWeight += weight;
    } else {
      const key = name.startsWith(OTHER) ? OTHER + name : name;
      add(key, name, [i], value, weight);
    }
  }
  if (grouped) add(OTHER, label, others, otherValue, otherWeight);
  return { ...result, slices, total };
}
