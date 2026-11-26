/**
 * View stage for `axylo/cartesian` (C4.3, RFC §2.2, §4.4, §5.1).
 * Computes per-axis domains independently from `visibleSlots` on zoom, resolves y-references with `axisId`,
 * and marks all-nonpositive `'log'` series `drawable: false` when `AX172` occurs so `controller-helpers.ts:521`
 * enters the error state cleanly.
 */
import {
  SLOT_VALUE, type AlignedFrame, type AlignedView, type DiagnosticSink, type ResolvedReference,
} from '../core/contracts';
import { buildPlainAlignedView, type AlignedViewState } from '../view';
import { computeAxisDomain } from './axes';
import type { CartesianStateRef } from './meta';

function resolveCartesianReferences(
  baseRefs: readonly ResolvedReference[],
  stateRef: CartesianStateRef,
): readonly ResolvedReference[] {
  const { meta } = stateRef;
  if (!baseRefs.length || !meta.references.length) return baseRefs;
  // Match each surviving resolved y-reference by identity (label, from, to) so dropped invalid
  // references never shift a later band onto an earlier reference's axis!
  const ySpecs = meta.references.filter(r => r.axis === 'y');
  const used = new Uint8Array(ySpecs.length);
  return baseRefs.map(ref => {
    if (ref.axis !== 'y') return ref;
    let matchedAxisId: string | undefined;
    for (let i = 0; i < ySpecs.length; i++) {
      if (used[i]) continue;
      const s = ySpecs[i]!;
      if (typeof s.from !== 'number' || !Number.isFinite(s.from) || typeof s.to !== 'number' || !Number.isFinite(s.to)) {
        continue;
      }
      const lo = Math.min(s.from, s.to);
      const hi = Math.max(s.from, s.to);
      if (s.label === ref.label && Object.is(lo, ref.from) && Object.is(hi, ref.to)) {
        used[i] = 1;
        matchedAxisId = s.axisId;
        break;
      }
    }
    return { ...ref, axisId: matchedAxisId ?? meta.leftAxisId };
  });
}

export function buildCartesianView(
  stateRef: CartesianStateRef,
  frame: AlignedFrame,
  state: AlignedViewState,
  sink: DiagnosticSink,
): AlignedView {
  const { meta } = stateRef;
  const base = buildPlainAlignedView(frame, { ...state, valueDomain: null }, sink);
  const references = resolveCartesianReferences(base.references, stateRef);

  const yDomains: [number, number][] = [];
  const yAxisIds: string[] = [];
  const erroredAxes = new Set<string>();

  for (const axis of meta.axes) {
    const res = computeAxisDomain(frame, base.visible, base.visibleSlots, axis, references, meta, sink);
    yDomains.push([res.domain[0], res.domain[1]]);
    yAxisIds.push(axis.id);
    if (res.error) erroredAxes.add(axis.id);
  }

  let nextFrame = frame;
  if (erroredAxes.size > 0 || meta.invalid) {
    // Mark affected series non-drawable so controller-helpers.ts:521 shows the error state cleanly.
    const series = frame.series.map(s => {
      if (meta.invalid || (s.axisId && erroredAxes.has(s.axisId))) {
        return { ...s, drawable: false };
      }
      if (s.axisId && meta.axisById.get(s.axisId)?.scale === 'log') {
        let anyPos = false;
        for (let i = 0; i < frame.length; i++) {
          if (s.slot[i] === SLOT_VALUE && s.y[i]! > 0) { anyPos = true; break; }
        }
        if (!anyPos) return { ...s, drawable: false };
      }
      return s;
    });
    nextFrame = { ...frame, series };
  }

  return {
    ...base,
    frame: nextFrame,
    yDomain: yDomains[0] ?? base.yDomain,
    yDomains,
    yAxisIds,
    references,
  };
}
