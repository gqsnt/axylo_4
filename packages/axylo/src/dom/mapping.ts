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
export function mappingOf(el: Element, rect = el.getBoundingClientRect(), style = el.ownerDocument.defaultView?.getComputedStyle?.(el)): Mapping {
  if (!style) return { left: rect.left, top: rect.top, kx: 1, ky: 1 };
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
 * ancestor's real clipping edge (its padding box less any scrollbar), on each axis it clips, across shadow
 * roots. Without `viewport`, only the ancestors cut it: content in the page's flow (the strip) can be
 * scrolled into view, a floating tooltip cannot.
 */
export function visibleRegion(from: Element, viewport = true, also?: Element): Rect {
  const doc = from.ownerDocument;
  const win = doc.defaultView;
  const root = doc.documentElement;
  // Far beyond any page, finite: x + width stays a number.
  const FAR = 1e9;
  let left = viewport ? 0 : -FAR;
  let top = viewport ? 0 : -FAR;
  let right = viewport ? root.clientWidth : FAR;
  let bottom = viewport ? root.clientHeight : FAR;
  // The composed chain: a slotted element's parent is its slot (whose shadow wrappers can clip it, review I5),
  // and past a shadow root comes its host, whose ancestors clip what is inside it too.
  const up = (el: Element): Element | null => el.assignedSlot ?? el.parentElement ?? ((el.getRootNode() as ShadowRoot).host ?? null);
  const clip = (el: Element): void => {
    const style = win!.getComputedStyle(el);
    const clipsX = style.overflowX !== 'visible';
    const clipsY = style.overflowY !== 'visible';
    if (!clipsX && !clipsY) return;
    const rect = el.getBoundingClientRect();
    const m = mappingOf(el, rect, style);
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
  };
  if (typeof win?.getComputedStyle === 'function') {
    // When a second chain is intersected, record visited ancestors so every shared ancestor is read once.
    const seen = also ? new Set<Element>() : null;
    const walk = (start: Element) => {
      for (let el = up(start); el && el !== root && !seen?.has(el); el = up(el)) {
        seen?.add(el);
        clip(el);
      }
    };
    walk(from);
    if (also) walk(also);
  }
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** Registrations that share a lifetime, including capture listeners on enclosing shadow roots. */
export class Listeners {
  private readonly entries: (EventTarget | string | EventListener | boolean | AddEventListenerOptions | undefined)[] = [];

  on<K extends keyof GlobalEventHandlersEventMap>(
    target: EventTarget | null, type: K, handler: (event: GlobalEventHandlersEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (!target) return;
    const listener = handler as EventListener;
    target.addEventListener(type, listener, options);
    this.entries.push(target, type, listener, options);
  }

  clear(): void {
    const { entries } = this;
    for (let i = 0; i < entries.length; i += 4) {
      (entries[i] as EventTarget).removeEventListener(
        entries[i + 1] as string, entries[i + 2] as EventListener, entries[i + 3] as boolean | EventListenerOptions | undefined,
      );
    }
    entries.length = 0;
  }
}

/** Capture outside the chart, even when closed shadow roots retarget the event to their host. */
export function listenOutside(
  doc: Document,
  roots: readonly ShadowRoot[],
  type: 'pointerup' | 'pointerdown',
  inside: readonly Element[],
  onOutside: (event: Event) => void,
  listeners: Listeners,
): void {
  const seen = new WeakSet<Event>();
  const check = (event: Event) => {
    if (seen.has(event)) return;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const target = event.target as Node | null;
    if (inside.some(el => path.includes(el) || (target !== null && el.contains(target)))) {
      seen.add(event);
      return;
    }
    // Inside a closed shadow root, an outer capture listener's composedPath stops at its host; wait for that root.
    if (roots.some(r => r !== event.currentTarget && !path.includes(r) && path.includes(r.host))) return;
    seen.add(event);
    onOutside(event);
  };
  const onHost = (event: Event) => {
    if (seen.has(event)) return;
    seen.add(event);
    onOutside(event);
  };
  listeners.on(doc, type, check, true);
  for (const root of roots) {
    listeners.on(root, type, check, true);
    // If the event targeted the closed host itself (e.g. host padding), root capture never ran; catch it here.
    listeners.on(root.host, type, onHost);
  }
}
