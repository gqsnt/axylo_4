/**
 * One mapping between an element's layout pixels and viewport pixels (decision 0004 revision 3, rule 10),
 * used for picking, anchors, clipping and placement alike. It is taken from fractional sizes: the bounding
 * rectangle (viewport, after transforms) against the computed size (layout, before transforms), so a
 * translated or scaled ancestor, uniform or not and at any positive scale, maps exactly.
 *
 * Limit (1.0): a rotated, skewed or mirrored ancestor is not supported. Its bounding rectangle is the
 * rotated box's envelope and always has positive size, so no ratio of two sizes can undo it; picking and
 * placement are then wrong. The spec's limits section says so.
 *
 * Every function here touches the DOM only when called.
 */
import type { Rect } from '../core/contracts';

export interface Point { readonly x: number; readonly y: number }

/** viewport = origin + layout × scale, per axis. The origin is the element's padding box corner. */
export interface Mapping {
  readonly left: number;
  readonly top: number;
  readonly kx: number;
  readonly ky: number;
}

const px = (v: string): number => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** The border box's layout size, fractional, from the computed style. */
function layoutSize(el: Element, style: CSSStyleDeclaration): { width: number; height: number } {
  let width = parseFloat(style.width);
  let height = parseFloat(style.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    // An element without a computed size (display: inline, contents): its integer layout size is all there is.
    const h = el as HTMLElement;
    return { width: h.offsetWidth ?? 0, height: h.offsetHeight ?? 0 };
  }
  if (style.boxSizing !== 'border-box') {
    width += px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth);
    height += px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth);
  }
  return { width, height };
}

/** The mapping of `el`'s own layout pixels (origin at its padding box) to viewport pixels. */
export function mappingOf(el: Element): Mapping {
  const win = el.ownerDocument.defaultView;
  const rect = el.getBoundingClientRect();
  if (!win) return { left: rect.left, top: rect.top, kx: 1, ky: 1 };
  const style = win.getComputedStyle(el);
  const size = layoutSize(el, style);
  // A computed size is serialized to six significant digits ("341.531px" for 341.53125): a ratio that close
  // to 1 is that rounding, not a transform (a scale that small moves nothing by a hundredth of a pixel), and
  // taking it as a scale would put a datum drawn exactly on the plot's edge just outside it.
  const ratio = (visual: number, layout: number) => {
    const k = layout > 0 && visual > 0 ? visual / layout : 1;
    return Math.abs(k - 1) < 1e-5 ? 1 : k;
  };
  const kx = ratio(rect.width, size.width);
  const ky = ratio(rect.height, size.height);
  return { left: rect.left + px(style.borderLeftWidth) * kx, top: rect.top + px(style.borderTopWidth) * ky, kx, ky };
}

export function toViewport(m: Mapping, p: Point): Point {
  return { x: m.left + p.x * m.kx, y: m.top + p.y * m.ky };
}

export function toLocal(m: Mapping, p: Point): Point {
  return { x: (p.x - m.left) / m.kx, y: (p.y - m.top) / m.ky };
}

export function rectToViewport(m: Mapping, r: Rect): Rect {
  return { x: m.left + r.x * m.kx, y: m.top + r.y * m.ky, width: r.width * m.kx, height: r.height * m.ky };
}

/**
 * The part of the viewport that content inside `from`'s parent can be seen in: the viewport cut by each
 * ancestor's real clipping edge (its padding box less any scrollbar), on each axis it clips.
 */
export function visibleRegion(from: Element): Rect {
  const doc = from.ownerDocument;
  const win = doc.defaultView;
  const root = doc.documentElement;
  let left = 0;
  let top = 0;
  let right = root.clientWidth;
  let bottom = root.clientHeight;
  for (let el: Element | null = from.parentElement; el && el !== root && win; el = el.parentElement) {
    const style = win.getComputedStyle(el);
    const clipsX = style.overflowX !== 'visible';
    const clipsY = style.overflowY !== 'visible';
    if (!clipsX && !clipsY) continue;
    const m = mappingOf(el);
    const rect = el.getBoundingClientRect();
    const h = el as HTMLElement;
    const bl = px(style.borderLeftWidth);
    const br = px(style.borderRightWidth);
    const bt = px(style.borderTopWidth);
    const bb = px(style.borderBottomWidth);
    // Scrollbars take room inside the border: what is left of the integer sizes after the borders.
    const scrollX = Math.max(0, (h.offsetWidth ?? 0) - (h.clientWidth ?? 0) - Math.round(bl + br));
    const scrollY = Math.max(0, (h.offsetHeight ?? 0) - (h.clientHeight ?? 0) - Math.round(bt + bb));
    if (clipsX) {
      left = Math.max(left, m.left);
      right = Math.min(right, rect.right - (br + scrollX) * m.kx);
    }
    if (clipsY) {
      top = Math.max(top, m.top);
      bottom = Math.min(bottom, rect.bottom - (bb + scrollY) * m.ky);
    }
  }
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
