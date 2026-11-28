/**
 * One mapping between an element's layout pixels and viewport pixels (decision 0004 revision 3, rule 10),
 * used for picking, anchors, clipping and placement alike.
 */
import type { Rect } from '../core/contracts';

export interface Point { readonly x: number; readonly y: number }
export interface Mapping { readonly left: number; readonly top: number; readonly kx: number; readonly ky: number }

const px = (v: string): number => parseFloat(v) || 0;
const ratio = (visual: number, layout: number) => {
  const k = layout > 0 && visual > 0 ? visual / layout : 1;
  return Math.abs(k - 1) < 1e-5 ? 1 : k;
};

/** The mapping of `el`'s own layout pixels (origin at its padding box) to viewport pixels. */
export function mappingOf(el: Element, rect = el.getBoundingClientRect(), style = el.ownerDocument.defaultView?.getComputedStyle?.(el)): Mapping {
  if (!style) return { left: rect.left, top: rect.top, kx: 1, ky: 1 };
  let w = parseFloat(style.width), h = parseFloat(style.height);
  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    const he = el as HTMLElement;
    w = he.offsetWidth ?? 0; h = he.offsetHeight ?? 0;
  } else if (style.boxSizing !== 'border-box') {
    w += px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth);
    h += px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth);
  }
  const kx = ratio(rect.width, w), ky = ratio(rect.height, h);
  return { left: rect.left + px(style.borderLeftWidth) * kx, top: rect.top + px(style.borderTopWidth) * ky, kx, ky };
}

export const toViewport = (m: Mapping, p: Point): Point => ({ x: m.left + p.x * m.kx, y: m.top + p.y * m.ky });
export const toLocal = (m: Mapping, p: Point): Point => ({ x: (p.x - m.left) / m.kx, y: (p.y - m.top) / m.ky });
export const rectToViewport = (m: Mapping, r: Rect): Rect => ({ x: m.left + r.x * m.kx, y: m.top + r.y * m.ky, width: r.width * m.kx, height: r.height * m.ky });

/** The part of the viewport that content inside `from`'s parent can be seen in. */
export function visibleRegion(from: Element, viewport = true, also?: Element): Rect {
  const doc = from.ownerDocument, win = doc.defaultView, root = doc.documentElement, FAR = 1e9;
  let left = viewport ? 0 : -FAR, top = viewport ? 0 : -FAR;
  let right = viewport ? root.clientWidth : FAR, bottom = viewport ? root.clientHeight : FAR;
  if (typeof win?.getComputedStyle === 'function') {
    const seen = also ? new Set<Element>() : null;
    const up = (el: Element): Element | null => el.assignedSlot ?? el.parentElement ?? (el.getRootNode() as ShadowRoot).host ?? null;
    const walk = (start: Element) => {
      for (let el = up(start); el && el !== root && !seen?.has(el); el = up(el)) {
        seen?.add(el);
        const st = win.getComputedStyle(el), cx = st.overflowX !== 'visible', cy = st.overflowY !== 'visible';
        if (!cx && !cy) continue;
        const rect = el.getBoundingClientRect(), m = mappingOf(el, rect, st), h = el as HTMLElement;
        const bl = px(st.borderLeftWidth), br = px(st.borderRightWidth), bt = px(st.borderTopWidth), bb = px(st.borderBottomWidth);
        if (cx) {
          left = Math.max(left, m.left);
          right = Math.min(right, rect.right - (br + Math.max(0, (h.offsetWidth ?? 0) - (h.clientWidth ?? 0) - Math.round(bl + br))) * m.kx);
        }
        if (cy) {
          top = Math.max(top, m.top);
          bottom = Math.min(bottom, rect.bottom - (bb + Math.max(0, (h.offsetHeight ?? 0) - (h.clientHeight ?? 0) - Math.round(bt + bb))) * m.ky);
        }
      }
    };
    walk(from);
    if (also) walk(also);
  }
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** Registrations that share a lifetime, including capture listeners on enclosing shadow roots. */
export class Listeners {
  private readonly e: (EventTarget | string | EventListener | boolean | AddEventListenerOptions | undefined)[] = [];

  on<K extends keyof GlobalEventHandlersEventMap>(
    target: EventTarget | null, type: K, handler: (event: GlobalEventHandlersEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (!target) return;
    target.addEventListener(type, handler as EventListener, options);
    this.e.push(target, type, handler as EventListener, options);
  }

  clear(): void {
    const { e } = this;
    for (let i = 0; i < e.length; i += 4) {
      (e[i] as EventTarget).removeEventListener(e[i + 1] as string, e[i + 2] as EventListener, e[i + 3] as boolean | EventListenerOptions | undefined);
    }
    e.length = 0;
  }
}

/** Capture outside the chart, even when closed shadow roots retarget the event to their host. */
export function listenOutside(
  doc: Document, roots: readonly ShadowRoot[], type: 'pointerup' | 'pointerdown',
  inside: readonly Element[], onOutside: (event: Event) => void, listeners: Listeners,
): void {
  const seen = new WeakSet<Event>();
  const fire = (e: Event) => { if (!seen.has(e)) { seen.add(e); onOutside(e); } };
  const check = (e: Event) => {
    if (seen.has(e)) return;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [], target = e.target as Node | null;
    if (inside.some(el => path.includes(el) || (target !== null && el.contains(target)))) { seen.add(e); return; }
    if (roots.some(r => r !== e.currentTarget && !path.includes(r) && path.includes(r.host))) return;
    fire(e);
  };
  listeners.on(doc, type, check, true);
  for (const r of roots) { listeners.on(r, type, check, true); listeners.on(r.host, type, fire); }
}
