/**
 * Renders a tooltip model as text (spec I1, DX8: textContent only), floating or in the strip under the plot.
 */
import { activeElementOf, placeChildren, setAttr, make, keepFocusOnPress, shadowRootsOf } from './attributes';
import type { DatumText, Rect, TooltipModel } from '../core/contracts';
import { createSwatch, type SwatchSpec } from './swatch';
import { fallbackPlacement, intersect, placeTooltip, type PlacementInput } from './placement';
import { sameKey } from '../core/axes';
import { Listeners, listenOutside, mappingOf, type Mapping } from './mapping';

export interface TooltipContent {
  readonly model: TooltipModel;
  readonly swatch: (row: DatumText) => SwatchSpec | null;
  readonly moreRows: (count: number) => string;
  readonly totalLabel?: string;
  readonly moreLang?: string | null;
  readonly totalLang?: string | null;
  readonly select?: (row: DatumText) => void;
  readonly valueLang?: (text: string) => string | null;
  readonly more?: (shown: number) => void;
}

export type Presentation = 'floating' | 'strip';

export interface TooltipView {
  show(content: TooltipContent, placement: PlacementInput, pinned: boolean, figureMapping?: Mapping): boolean;
  strip(content: TooltipContent, pinned: boolean, visible: Rect): boolean;
  hide(): void;
  readonly visible: boolean;
  rect(): Rect | null;
  contains(node: Node | null): boolean;
  destroy(): void;
}

interface RowEntry {
  readonly k: string;
  readonly e: HTMLElement;
  readonly n: HTMLElement;
  readonly v: HTMLElement;
  readonly t: Text;
  readonly s: Text | null;
  r: DatumText;
  p: SwatchSpec | null;
  l: string | null;
  g: string | null;
}

const rowKey = ({ ref }: DatumText): string =>
  ref.kind === 'aligned' ? `a\0${ref.seriesKey}` : ref.kind === 'point' ? `p\0${ref.seriesKey}\0${ref.row}` : `s\0${ref.sliceKey}`;

export function createTooltip(element: HTMLElement, readoutElement: HTMLElement, figure: HTMLElement, lost: () => void): TooltipView {
  const doc = element.ownerDocument;
  const txt = (s = '') => doc.createTextNode(s);
  const active = () => activeElementOf(doc, figure);

  let pressKey: string | null = null, pressPtr = 0, pressListening: Listeners | null = null;
  let pressedKey: string | null = null, pressedAt = 0, pendingFocus: string | null = null;
  // 0 = hidden, 1 = floating, 2 = strip
  let where: 0 | 1 | 2 = 0, wasPinned = false, current: TooltipContent | null = null, displayed = 0;
  let carriedKey: string | null = null, carriedPtr = 0, hadFocus: string | null = null;

  const entries = [new Map<string, RowEntry>(), new Map<string, RowEntry>()] as const;
  const hosts = [element, readoutElement] as const;
  const pinCls = ['axylo-tooltip-pinned', 'axylo-readout-pinned'] as const;
  const listening = new Listeners(), mores = new Map<string, HTMLElement>();
  let wrapped = false, lastSize: { width: number; height: number } | null = null;
  let constraints: readonly unknown[] | null = null, lastRect: Rect | null = null, lastFloatOrder: readonly Node[] | null = null;

  function clearPress(): void { pressKey = null; pressListening?.clear(); pressListening = null; }
  function cancelPointer(e: Event): void { if (pressKey !== null && pressPtr === (e as PointerEvent).pointerId) clearPress(); }

  function startPress(key: string, ptr: number): void {
    clearPress();
    pressKey = key; pressPtr = ptr;
    const l = pressListening = new Listeners(), roots = shadowRootsOf(element);
    listenOutside(doc, roots, 'pointerup', hosts, cancelPointer, l);
    for (const t of [doc, ...roots]) l.on(t, 'pointercancel', cancelPointer, true);
  }

  const choices = new WeakMap<Element, RowEntry>();
  const buttonOf = (e: Event) => (e.target as Element | null)?.closest?.('button.axylo-tooltip-choice');
  for (const host of hosts) {
    listening.on(host, 'mousedown', e => { if (buttonOf(e)) keepFocusOnPress(e); });
    listening.on(host, 'pointerdown', e => {
      const b = buttonOf(e), row = b && choices.get(b);
      if (row) startPress(row.k, e.pointerId); else clearPress();
    });
    listening.on(host, 'pointerup', e => {
      if (pressKey === null || pressPtr !== e.pointerId) return;
      const key = pressKey;
      clearPress();
      pressedKey = key; pressedAt = e.timeStamp;
      const now = entries[0].get(key) ?? entries[1].get(key);
      if (now) current?.select?.(now.r);
    });
    listening.on(host, 'pointercancel', cancelPointer);
    listening.on(host, 'click', e => {
      const b = buttonOf(e);
      if (!b) return;
      const row = choices.get(b);
      if (!row) current?.more?.(displayed);
      else if (!(e.detail > 0 && pressedKey === row.k && e.timeStamp - pressedAt < 1000)) current?.select?.(row.r);
    });
  }

  function makeBox(cls: string, button: boolean, isStrip: boolean): HTMLElement {
    const el = doc.createElement(button ? 'button' : isStrip ? 'span' : 'div');
    el.className = button ? `${cls} axylo-tooltip-choice` : cls;
    if (button) { (el as HTMLButtonElement).type = 'button'; el.tabIndex = -1; }
    return el;
  }

  const floatTitle = make(doc, 'div', 'axylo-tooltip-title'), floatTitleNode = txt();
  floatTitle.appendChild(floatTitleNode);
  const floatTotal = make(doc, 'div', 'axylo-tooltip-row axylo-tooltip-total');
  const floatTotalName = make(doc, 'span', 'axylo-tooltip-series'), floatTotalValue = make(doc, 'span', 'axylo-tooltip-value');
  floatTotal.append(floatTotalName, floatTotalValue);
  const stripTitle = make(doc, 'span', 'axylo-tooltip-title'), stripTotal = make(doc, 'span', 'axylo-readout-total');
  const moreSep = txt('; '), totalSep = txt('; ');

  const setT = (n: Node, s: string) => { if (n.textContent !== s) { n.textContent = s; lastSize = null; } };
  const setL = (el: HTMLElement, l: string | null | undefined) => {
    const v = l || null;
    if (el.getAttribute('lang') !== v) { setAttr(el, 'lang', v); lastSize = null; }
  };

  function rowEntries(idx: 0 | 1, content: TooltipContent, pinned: boolean): RowEntry[] {
    const map = entries[idx], isStrip = idx === 1, keep = new Set<string>(), out: RowEntry[] = [];
    const asBtn = pinned && content.select !== undefined;
    for (const r of content.model.rows) {
      const k = `${asBtn ? 'b' : 't'}\0${rowKey(r)}`;
      keep.add(k);
      let entry = map.get(k);
      if (!entry) {
        const e = makeBox(isStrip ? 'axylo-readout-entry' : 'axylo-tooltip-row', asBtn, isStrip);
        const n = make(doc, 'span', 'axylo-tooltip-series'), v = make(doc, 'span', 'axylo-tooltip-value'), t = txt();
        v.appendChild(t);
        if (isStrip) e.append(n, txt(' '), v); else e.append(n, v);
        entry = { k, e, n, v, t, s: isStrip ? txt('; ') : null, r, p: null, l: null, g: null };
        if (asBtn) choices.set(e, entry);
        map.set(k, entry);
        lastSize = null;
      }
      entry.r = r;
      const spec = content.swatch(r);
      if (entry.l !== r.seriesLabel || entry.p !== spec) {
        entry.n.replaceChildren(...(spec ? [createSwatch(doc, spec)] : []), txt(r.seriesLabel));
        entry.l = r.seriesLabel; entry.p = spec; lastSize = null;
      }
      setT(entry.t, r.percent === null || r.percent === r.value ? r.value : `${r.value} (${r.percent})`);
      const lang = content.valueLang?.(r.value) ?? null;
      if (entry.g !== lang) { setAttr(entry.v, 'lang', lang); entry.g = lang; lastSize = null; }
      out.push(entry);
    }
    for (const k of map.keys()) if (!keep.has(k)) { map.delete(k); lastSize = null; }
    return out;
  }

  function focusedKey(idx: 0 | 1): string | null {
    const map = entries[idx];
    if (!map.size) return null;
    const act = active();
    for (const [k, e] of map) if (e.e === act) return k;
    return null;
  }

  function moreElement(isStrip: boolean, pinned: boolean, content: TooltipContent, count: number): HTMLElement {
    const btn = pinned && current?.more !== undefined, k = `${isStrip ? 1 : 0}${btn ? 1 : 0}`;
    let el = mores.get(k);
    if (!el) mores.set(k, el = makeBox('axylo-tooltip-more', btn, isStrip));
    setT(el, content.moreRows(count));
    setL(el, content.moreLang);
    return el;
  }

  function hideIdx(idx: 0 | 1): void {
    const host = hosts[idx];
    if (!idx) lastSize = lastFloatOrder = null;
    if (where === idx + 1) lastRect = null;
    if (host.hidden && !host.firstChild) return;
    const key = focusedKey(idx);
    if (key !== null) {
      pendingFocus = key;
      queueMicrotask(() => {
        if (pendingFocus === null) return;
        pendingFocus = null;
        const act = active();
        if (!element.contains(act) && !readoutElement.contains(act)) lost();
      });
    }
    clearPress();
    host.hidden = true;
    host.classList.remove(pinCls[idx]);
    setAttr(host, 'aria-hidden', 'true');
    placeChildren(host, []);
    entries[idx].clear();
  }

  function begin(idx: 0 | 1, content: TooltipContent, pinned: boolean): void {
    current = content;
    carriedKey = pinned ? pressKey : null; carriedPtr = pressPtr;
    if (!pinned) clearPress();
    hadFocus = (wasPinned && where ? focusedKey((where - 1) as 0 | 1) : null) ?? pendingFocus;
    pendingFocus = null;
    hideIdx(idx ? 0 : 1);
    const host = hosts[idx];
    if (where !== idx + 1 || pinned !== wasPinned || host.hidden) {
      if (host.hidden) host.hidden = false;
      if (pinned || (where === idx + 1 && wasPinned)) host.classList.toggle(pinCls[idx], pinned);
      setAttr(host, 'aria-hidden', pinned ? null : 'true');
    }
    wasPinned = pinned;
  }

  function finish(idx: 0 | 1, visible: boolean): boolean {
    if (visible) {
      where = (idx + 1) as 1 | 2;
      if (carriedKey !== null && pressKey === null) startPress(carriedKey, carriedPtr);
      if (hadFocus !== null) {
        const entry = entries[idx].get(hadFocus);
        if (!entry?.e.isConnected) lost();
        else if (active() !== entry.e) entry.e.focus({ preventScroll: true });
      }
    } else {
      hideIdx(idx);
      where = 0; lastRect = null;
      if (hadFocus !== null) lost();
    }
    carriedKey = hadFocus = null;
    return visible;
  }

  function hide(): void { clearPress(); hideIdx(0); hideIdx(1); where = 0; lastRect = current = null; }

  return {
    get visible() { return where !== 0; },
    rect: () => lastRect,
    contains: node => node !== null && (element.contains(node) || readoutElement.contains(node)),
    show(content, p, pinned, figMapping) {
      const wasHidden = where !== 1 || element.hidden;
      begin(0, content, pinned);
      const m = figMapping ?? mappingOf(figure);
      const maxW = Math.max(0, Math.min(320, p.visible.width / m.kx)), maxH = Math.max(0, p.visible.height / m.ky);
      const inputs = [pinned, maxW, maxH, figMapping, m.kx, m.ky];
      if (wasHidden || !sameKey(constraints, inputs)) {
        const w = `${maxW}px`, h = `${maxH}px`;
        if (element.style.maxWidth !== w) element.style.maxWidth = w;
        if (element.style.maxHeight !== h) element.style.maxHeight = h;
        constraints = inputs; lastSize = null;
      }
      const rows = rowEntries(0, content, pinned), { model } = content, total = rows.length;
      if (wrapped) { element.classList.remove('axylo-tooltip-wrap'); wrapped = false; }
      setT(floatTitleNode, model.title);
      if (model.total !== null) {
        setT(floatTotalName, content.totalLabel ?? '');
        setL(floatTotalName, content.totalLang);
        setT(floatTotalValue, model.total);
      }
      const overflows = () => element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1;
      for (let shown = total; shown >= Math.min(1, total); shown--) {
        const children: Node[] = [floatTitle];
        for (let i = 0; i < shown; i++) children.push(rows[i]!.e);
        displayed = shown;
        if (model.count > shown) children.push(moreElement(false, pinned, content, model.count - shown));
        if (model.total !== null) children.push(floatTotal);
        if (!sameKey(lastFloatOrder, children)) { placeChildren(element, children); lastFloatOrder = children; lastSize = null; }
        let size = lastSize;
        if (!size) {
          size = element.getBoundingClientRect();
          if (size.width >= (maxW - 2) * m.kx || size.height >= (maxH - 2) * m.ky) {
            let over = overflows();
            if (over && !wrapped) {
              element.classList.add('axylo-tooltip-wrap'); wrapped = true;
              over = overflows();
              if (!over || shown <= 1) size = element.getBoundingClientRect();
            }
            if (over && shown > 1) continue;
          }
          if (shown === total && !wrapped) lastSize = size;
        }
        const { width, height } = size;
        let spot = placeTooltip(p, width, height);
        if (!spot && shown <= 1 && width > 0) spot = fallbackPlacement(p, width, height);
        if (spot) {
          const tf = `translate(${(spot.x - m.left) / m.kx}px, ${(spot.y - m.top) / m.ky}px)`;
          if (element.style.transform !== tf) element.style.transform = tf;
          lastRect = { x: spot.x, y: spot.y, width, height };
          return finish(0, true);
        }
      }
      return finish(0, false);
    },
    strip(content, pinned, visible) {
      begin(1, content, pinned);
      const { model } = content, rows = rowEntries(1, content, pinned);
      setT(stripTitle, `${model.title}: `);
      if (model.total !== null) { setT(stripTotal, `${content.totalLabel ?? ''} ${model.total}`); setL(stripTotal, content.totalLang); }
      const r = readoutElement.getBoundingClientRect(), box = intersect(r, visible), bx2 = box.x + box.width, by2 = box.y + box.height;
      const within = (el: Element | null) => {
        if (!el?.isConnected) return true;
        const rects = el.getClientRects();
        for (const q of rects) if (q.left < box.x - 0.5 || q.top < box.y - 0.5 || q.right > bx2 + 0.5 || q.bottom > by2 + 0.5) return false;
        return rects.length > 0;
      };
      const cl = readoutElement.classList, minS = Math.min(1, rows.length);
      cl.remove('axylo-readout-wrap', 'axylo-readout-cut');
      let seen = false;
      for (let pass = 0; pass < 3 && !seen; pass++) {
        if (pass === 1) cl.add('axylo-readout-wrap');
        if (pass === 2) cl.replace('axylo-readout-wrap', 'axylo-readout-cut');
        for (let shown = pass === 2 ? minS : rows.length; shown >= minS && !seen; shown--) {
          const parts: Node[] = [stripTitle];
          displayed = shown;
          for (let i = 0; i < shown; i++) { if (i && rows[i]!.s) parts.push(rows[i]!.s!); parts.push(rows[i]!.e); }
          if (model.total !== null) parts.push(totalSep, stripTotal);
          let pager: HTMLElement | null = null;
          if (model.count > shown) { if (shown) parts.push(moreSep); parts.push(pager = moreElement(true, pinned, content, model.count - shown)); }
          placeChildren(readoutElement, parts);
          seen = within(stripTitle) && within(pager);
          for (let i = 0; seen && i < shown; i++) seen = within(rows[i]!.e);
        }
      }
      if (seen) lastRect = r;
      return finish(1, seen);
    },
    hide,
    destroy() { hide(); pendingFocus = null; listening.clear(); mores.clear(); },
  };
}
