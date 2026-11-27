/**
 * Geometry and navigation over a committed state: where the plot is, which datum the keyboard starts on, the
 * box a target is drawn in, and whether a pinned tooltip survives an update. Pure functions of their arguments.
 */
import type { AlignedView, DatumRef, PickTarget, Rect, TooltipModel, View } from '../core/contracts';
import { alignedRows, sameRef, stepAcross, targetBox, targetOf } from '../core/focus';
import type { Identity } from './pointer';
import type { Committed, Span } from './interaction-types';

export const PAGE_ROWS = 8;
export const isAligned = (v: View): v is AlignedView => v.kind !== 'scatter' && v.kind !== 'donut';
export const plotReady = (d: Committed | null): d is Committed & { readonly ready: true } => d !== null && d.ready && d.layout.kind === 'plot';
export const readable = (d: Committed) => d.view.kind === 'donut' || d.view.visible.some(Boolean);
export const plotBox = (d: Committed): Rect => d.layout.kind === 'plot' ? d.layout.plot : { x: 0, y: 0, width: d.layout.width, height: d.layout.height };
export const horizontalBars = (d: Committed) => d.layout.kind === 'plot' && d.layout.projection.kind === 'bands' && d.layout.projection.horizontal;
export const categoriesOf = (v: View) => isAligned(v) && v.frame.x.kind === 'category' ? v.frame.x.categories : null;
export const xKindOf = (v: View) => v.kind === 'donut' ? 'category' : v.kind === 'scatter' ? v.frame.xKind : v.frame.x.kind;

export function posScale(d: Committed) {
  const p = d.layout.kind === 'plot' ? d.layout.projection : null;
  return p?.kind === 'xy' ? p.x : p?.kind === 'bands' ? p.band : null;
}

export function firstDatum(d: Committed): DatumRef | null {
  if (!isAligned(d.view)) return d.lookup.step(null, 'first');
  const x = stepAcross(d.view, null, 'first');
  return x === null ? null : d.lookup.primary({ kind: 'x', x });
}

export function pointGroup(d: Committed, ref: DatumRef, b: Rect): PickTarget {
  const picked = d.lookup.pick(b.x + b.width / 2, b.y + b.height / 2);
  return picked?.kind === 'point' && d.lookup.has(picked, ref) ? picked : targetOf(ref);
}

export function keyboardTarget(d: Committed, ref: DatumRef): PickTarget {
  if (ref.kind === 'point' && d.view.kind === 'scatter') { const b = d.lookup.anchor(ref); if (b) return pointGroup(d, ref, b); }
  return targetOf(ref);
}

export function zoomBounds(d: Committed): Span {
  if (d.view.kind === 'donut') return [0, 0];
  if (!d.zoomed) { const s = posScale(d); if (s && s.type !== 'band') return [Math.min(...s.domain), Math.max(...s.domain)]; }
  return d.view.xFull;
}

export function markBox(d: Committed, target: PickTarget, soleRef?: DatumRef): Rect | null {
  const box = soleRef ? d.lookup.anchor(soleRef) : targetBox(d.view, d.lookup, target, null);
  if (box || target.kind !== 'x' || d.layout.kind !== 'plot') return box;
  const s = posScale(d), at = s ? (s.type === 'band' ? s.center(target.x) : s.map(target.x)) : NaN;
  if (!Number.isFinite(at)) return null;
  const pr = d.layout.plot;
  return horizontalBars(d) ? { x: pr.x + pr.width / 2, y: at, width: 0, height: 0 } : { x: at, y: pr.y + pr.height / 2, width: 0, height: 0 };
}

/**
 * The box the pointer's own tooltip is placed against. A lookup whose x pick names the mark that won it
 * (cartesian/lookup.ts, the one with `pointValue`) places it at that mark (`lead`: the anchor of the target's
 * primary), so moving between layered marks at one x moves it; otherwise, and for a peer's or the keyboard's
 * target, it is every mark at the target (`marks`).
 */
export const placementBox = (d: Committed, lead: Rect | null, marks: Rect | null, pointer: boolean): Rect | null =>
  pointer && lead && 'pointValue' in d.lookup ? lead : marks;

export function pinnedModel(d: Committed, target: PickTarget, offset: number): TooltipModel {
  const { lookup, view, formatters } = d, m = lookup.tooltip(target);
  if (offset <= 0 || offset >= m.count) return m;
  if (target.kind === 'x' && isAligned(view)) return { ...m, rows: alignedRows(view, formatters, target.x, m, lookup).slice(offset, offset + PAGE_ROWS) };
  if (target.kind === 'point') {
    const refs = lookup.members(target, offset, PAGE_ROWS);
    if (refs.length) return { ...lookup.tooltip({ kind: 'point', refs, count: target.count }), title: m.title, count: m.count };
  }
  return m;
}

export function remapTarget<T extends PickTarget | Identity>(t: T | null, map: (r: DatumRef | null, exact?: boolean) => DatumRef | null): T | null {
  if (t?.kind !== 'x') return t;
  const m = map({ kind: 'aligned', seriesKey: '', x: t.x }, true);
  return m?.kind === 'aligned' ? { kind: 'x', x: m.x } as T : null;
}

export function stillPinned(next: Committed, ref: DatumRef, target: PickTarget): { r: DatumRef; t: PickTarget } | null {
  if (!plotReady(next) || !readable(next)) return null;
  const { lookup } = next;
  if (target.kind === 'point') {
    if (ref.kind !== 'point' || lookup.ordinal(ref) < 0) return null;
    const b = lookup.anchor(ref);
    return b ? { r: ref, t: pointGroup(next, ref, b) } : null;
  }
  if (target.kind === 'slice') return ref.kind === 'slice' && lookup.ordinal(ref) >= 0 ? { r: ref, t: target } : null;
  return sameRef(lookup.resolve(ref), ref) && lookup.tooltip(target).rows.length ? { r: ref, t: target } : null;
}

// A category axis whose categories changed: maps a datum's x index from the old list to the new, or null when
// nothing moved.
export function categoryRemapper(before: View, after: View): ((ref: DatumRef | null, exact?: boolean) => DatumRef | null) | null {
  const from = categoriesOf(before), to = categoriesOf(after);
  if (!from || !to || (from.length === to.length && from.every((n, i) => to[i] === n))) return null;
  const index = new Map(to.map((n, i) => [n, i]));
  return (ref, exact) => {
    if (ref?.kind !== 'aligned') return ref;
    for (let i = ref.x; i < from.length; i++) { const at = index.get(from[i]!); if (at !== undefined) return { ...ref, x: at }; if (exact) return null; }
    return null;
  };
}
