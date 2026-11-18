/**
 * Comparing pick targets, and the identity a dismissal is remembered by. Pointer, touch and drag input are
 * handled by the interaction layer (dom/interaction.ts); this only says whether two targets name the same
 * thing.
 */
import type { DatumRef, PickTarget } from '../core/contracts';
import { sameRef } from '../core/focus';

/** Two pick results name the same thing, so the tooltip need not be rebuilt. */
export function sameTarget(a: PickTarget | null, b: PickTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'x' && b.kind === 'x') return a.x === b.x;
  if (a.kind === 'slice' && b.kind === 'slice') return a.sliceKey === b.sliceKey;
  if (a.kind === 'point' && b.kind === 'point') {
    return a.count === b.count && a.refs.length === b.refs.length && a.refs.every((r, i) => sameRef(r, b.refs[i]!));
  }
  return false;
}

/**
 * The datum a dismissal belongs to (decision 0004 rule 8): the x of an aligned target, the slice, or the
 * first point of a scatter group. Points that come to share that point's position do not make it another
 * datum, and the dismissal ends only when the datum shown no longer includes it.
 */
export type Identity =
  | { readonly kind: 'x'; readonly x: number }
  | { readonly kind: 'point'; readonly ref: DatumRef }
  | { readonly kind: 'slice'; readonly sliceKey: string };

/** The identity of what `target` shows; for a point, the datum the reader chose (`chosen`), else the first. */
export function identityOf(target: PickTarget, chosen: DatumRef | null = null): Identity {
  switch (target.kind) {
    case 'x': return { kind: 'x', x: target.x };
    case 'slice': return { kind: 'slice', sliceKey: target.sliceKey };
    case 'point': {
      const ref = chosen?.kind === 'point' ? chosen : target.refs[0];
      return ref ? { kind: 'point', ref } : { kind: 'x', x: NaN };
    }
  }
}

export function matchesIdentity(id: Identity, target: PickTarget): boolean {
  if (id.kind === 'x') return target.kind === 'x' && target.x === id.x;
  if (id.kind === 'slice') return target.kind === 'slice' && target.sliceKey === id.sliceKey;
  return target.kind === 'point' && target.refs.some(r => sameRef(r, id.ref));
}
