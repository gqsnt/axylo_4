import type { XKind } from '../core/contracts';
import { normalizeAligned } from '../data/normalize';
import { resolveOptions } from '../data/options';
import type { XValue } from '../public';

const ignoreDiagnostics = { add() {} };
const version = { epoch: 0, revision: 0 };

export function readPosition(
  value: XValue, kind: XKind, zone: string | null, categories: readonly string[] | null = null,
): number {
  if (kind === 'category') {
    const i = value instanceof Date ? -1 : categories?.indexOf(String(value)) ?? -1;
    if (i >= 0) return i;
    return typeof value === 'number' && Number.isInteger(value) ? value : NaN;
  }
  if (typeof value === 'number') return value;

  // Use the data entry point on a single row until it exports a standalone x parser.
  const timeZone = zone ?? 'UTC';
  const options = resolveOptions('line', {
    data: [{ x: value, y: 0 }], x: { field: 'x', type: kind === 'wall' ? undefined : kind, timeZone }, y: 'y',
  }, ignoreDiagnostics);
  const frame = normalizeAligned('line', options, { timeZone }, ignoreDiagnostics, version);
  return frame.shape === 'aligned' && frame.x.kind === kind ? frame.x.values[0] ?? NaN : NaN;
}
