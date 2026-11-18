/**
 * Pointer input over the plot, as plot-container coordinates. Deciding what is under the pointer and
 * showing it are the caller's; this only reports where the pointer is and when it left.
 */
import type { PickTarget } from '../core/contracts';

export interface PointerHandlers {
  move(x: number, y: number): void;
  leave(): void;
}

export function watchPointer(plot: HTMLElement, handlers: PointerHandlers): () => void {
  const onMove = (event: PointerEvent): void => {
    const box = plot.getBoundingClientRect();
    handlers.move(event.clientX - box.left, event.clientY - box.top);
  };
  const onLeave = (): void => handlers.leave();
  plot.addEventListener('pointermove', onMove);
  plot.addEventListener('pointerleave', onLeave);
  plot.addEventListener('pointercancel', onLeave);
  return () => {
    plot.removeEventListener('pointermove', onMove);
    plot.removeEventListener('pointerleave', onLeave);
    plot.removeEventListener('pointercancel', onLeave);
  };
}

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
