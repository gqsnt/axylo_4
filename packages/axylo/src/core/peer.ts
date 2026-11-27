/**
 * The seam between a chart and `axylo/sync` (N6). Each subpath is bundled on its own, so the chart a sync
 * group holds may come from another bundle: a module-local WeakMap or Symbol() would not be shared. The key
 * is the registry symbol, read the same in every bundle, and it lives only on the handle (the hops behind it,
 * controller to host to interaction layer, are inside one bundle).
 */
import type { DatumRef, Layout, Lookup, PickTarget, View } from './contracts';
import type { Point } from '../public.js';
import type { Drawn } from './controller-types';

export const SYNC: unique symbol = Symbol.for('axylo.sync') as never;

/** Resolves a synced x against a peer's committed view, lookup and layout (re-run on every committed frame). */
export type SyncResolve = (view: View, lookup: Lookup, layout?: Layout) => PickTarget | null;

/**
 * Encapsulated capability exposed on the handle under `SYNC` (plain property names, the same in every bundle).
 * `drawn` is the committed frame, view and lookup, null before the first frame and once destroyed; `sync`
 * forwards a peer cursor resolver to the interaction layer; `point` builds the public event payload for a
 * peer-local datum; `onDestroy` notifies attached groups if the chart is destroyed directly.
 */
export interface SyncSeam {
  readonly drawn: Drawn | null;
  sync(resolve: SyncResolve | null, origin: object): void;
  point?(ref: DatumRef): Point<unknown> | null;
  onDestroy?(fn: () => void): () => void;
}

export interface SyncCapable { readonly [SYNC]?: SyncSeam }

/** Puts the seam on a wrapper handle, not enumerable, so spreading or listing the handle does not show it. */
export function forwardSync(handle: object, inner: object): void {
  Object.defineProperty(handle, SYNC, { value: (inner as SyncCapable)[SYNC] });
}
