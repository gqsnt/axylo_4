/**
 * Interactive focus/hover overlay marks for `axylo/cartesian` (C4.3).
 * Uses `axisScaleOf(projection, s.axisIndex)` and filters nonpositive values on `'log'` scales so
 * hover dots and keyboard focus rings match the exact drawn marks on both left and right axes.
 */
import {
  SLOT_VALUE, type Mark, type PointMark, type Rect,
} from '../core/contracts';
import type { OverlayInput } from '../core/focus';
import { position, rule, seriesPaint, token } from '../scene/geometry';
import { axisScaleOf } from './scale-ref';
import type { CartesianStateRef } from './meta';

export function createCartesianOverlay(stateRef: CartesianStateRef) {
  return (input: OverlayInput, plot: Rect, clipped: Mark[], _unclipped: Mark[]): void => {
    const { view, layout, target, ring, only } = input;
    if (view.kind === 'donut' || view.kind === 'scatter' || layout.kind !== 'plot' || layout.projection.kind === 'ring') return;
    const xVal = target?.kind === 'x' ? target.x : ring?.kind === 'aligned' ? ring.x : null;
    if (xVal === null) return;

    const vals = view.frame.x.values;
    const { start, end } = view.visibleSlots;
    let slot = -1;
    for (let i = start; i < end; i++) {
      if (vals[i] === xVal) { slot = i; break; }
    }
    if (slot < 0) return;

    const xScale = layout.projection.kind === 'xy' ? layout.projection.x : layout.projection.band;
    const px = xScale.type === 'band' ? xScale.center(slot) : position(xScale, xVal);
    if (!Number.isFinite(px)) return;

    clipped.push(rule('cursor', token('axis'), px, plot.y, px, plot.y + plot.height));

    const onlyKey = only?.kind === 'aligned' ? only.seriesKey : null;
    for (let sIdx = 0; sIdx < view.frame.series.length; sIdx++) {
      const s = view.frame.series[sIdx]!;
      if (!view.visible[sIdx] || !s.drawable) continue;
      if (onlyKey !== null && s.key !== onlyKey) continue;
      if (s.slot[slot] !== SLOT_VALUE) continue;
      const v = s.y[slot]!;
      const scale = axisScaleOf(layout.projection, s.axisIndex ?? 0);
      if (scale.type === 'log' && !(v > 0)) continue;
      const py = position(scale, v);
      if (!Number.isFinite(py)) continue;
      const mark: PointMark = {
        type: 'points',
        series: sIdx,
        xy: Float32Array.from([px, py]),
        shape: view.cues[sIdx]?.marker ?? 'circle',
        size: ring?.kind === 'aligned' && ring.seriesKey === s.key ? 7 : 5,
        fill: seriesPaint(sIdx),
      };
      clipped.push(mark);
    }
    void stateRef;
  };
}
