/**
 * Comparing pick targets. Pointer, touch and drag input are handled by the interaction layer
 * (dom/interaction.ts); this only says whether two targets name the same thing.
 */
import type { PickTarget } from '../core/contracts';

/** Two pick results name the same thing, so the tooltip need not be rebuilt. */
export function sameTarget(a: PickTarget | null, b: PickTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'x' && b.kind === 'x') return a.x === b.x;
  if (a.kind === 'slice' && b.kind === 'slice') return a.sliceKey === b.sliceKey;
  if (a.kind === 'point' && b.kind === 'point') {
    return a.count === b.count && a.refs.length === b.refs.length && a.refs.every((r, i) => {
      const o = b.refs[i]!;
      return r.kind === 'point' && o.kind === 'point' && r.seriesKey === o.seriesKey && r.row === o.row && r.x === o.x;
    });
  }
  return false;
}
