import type { XKind } from '../core/contracts';
import { positionReader } from '../view/references';
import type { XValue } from '../public';

export function readPosition(
  value: XValue, kind: XKind, zone: string | null, categories: readonly string[] | null = null,
): number {
  if (kind === 'category') {
    const i = value instanceof Date ? -1 : categories?.indexOf(String(value)) ?? -1;
    if (i >= 0) return i;
    return typeof value === 'number' && Number.isInteger(value) ? value : NaN;
  }
  if (typeof value === 'number') return value;

  return positionReader({ kind, timeZone: zone, categories }, undefined)(value);
}
