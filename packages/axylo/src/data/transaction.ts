import type { DiagnosticInput, Frame } from '../core/contracts';

export interface PreparedFrame<F extends Frame> {
  readonly frame: F;
  /** Findings for the resulting frame, including append ordering. */
  readonly diagnostics: readonly DiagnosticInput[];
  /** Findings for validation of this call, including incoming rows evicted by keep. */
  readonly callDiagnostics: readonly DiagnosticInput[];
  /** Idempotent after success. Throws if another data revision superseded this candidate. */
  commit(): void;
}

export interface StoreAppendOptions { keep?: number }

export function retention(options: StoreAppendOptions): number | undefined {
  const { keep } = options;
  return keep === undefined || !Number.isFinite(keep) ? undefined : Math.max(0, Math.floor(keep));
}

export function once(current: () => Frame, apply: () => void, base = current()): () => void {
  let pending: { base: Frame; current: () => Frame; apply: () => void } | undefined = { base, current, apply };
  return () => {
    if (!pending) return;
    if (pending.base !== pending.current()) throw new Error('Cannot commit a superseded data revision.');
    pending.apply();
    pending = undefined;
  };
}
