/**
 * Renders a tooltip model as text (spec I1, DX8: textContent only), floating or in the strip under the plot.
 */
import { activeElementOf, placeChildren, setAttr, setText, make, keepFocusOnPress, shadowRootsOf } from './attributes';
import type { DatumRef, DatumText, Rect, TextMeasurer, TextStyle, TooltipModel } from '../core/contracts';
import { createMeasurer, readTextStyle } from '../core/environment';
import { createSwatch, type SwatchSpec } from './swatch';
import { fallbackPlacement, intersect, placeTooltip, type PlacementInput, type Spot } from './placement';
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
  invalidateSize(): void;
  destroy(): void;
}

interface RowEntry {
  readonly button: boolean;
  readonly e: HTMLElement;
  readonly n: HTMLElement;
  readonly v: HTMLElement;
  readonly t: Text;
  readonly label: Text;
  readonly s: Text | null;
  r: DatumText;
  ref: DatumRef;
  p: SwatchSpec | null;
  l: string | null;
  g: string | null;
  value: string;
}

interface MoreEntry {
  readonly el: HTMLElement;
  text: string;
  lang: string | null;
}

interface HoverText {
  readonly style: TextStyle;
  readonly key: string;
  text: string;
  width: number;
}

interface HoverRow extends HoverText {
  readonly element: HTMLElement;
  readonly label: string | null;
  readonly swatch: SwatchSpec | null;
  readonly lang: string | null;
  readonly fixed: number;
}

interface HoverSize {
  readonly title: HoverText;
  readonly rows: readonly HoverRow[];
  readonly more: string | null;
  readonly moreLang: string | null;
  readonly moreWidth: number;
  readonly total: HoverRow | null;
  readonly correction: number;
  readonly width: number;
  readonly height: number;
}

const canvasAvailable = new WeakMap<Document, boolean>();
const digit = (code: number) => code >= 48 && code <= 57;

function sameShape(text: string, previous: string): boolean {
  if (text === previous) return true;
  if (text.length !== previous.length) return false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i), before = previous.charCodeAt(i);
    if (code !== before && !(digit(code) && digit(before))) return false;
  }
  return true;
}

// Every digit other than 0 becomes 0, in one native pass: a new heading or value on each move would
// otherwise build its shape from a string per digit.
const NONZERO_DIGIT = /[1-9]/g;
const digitShape = (text: string): string => text.replace(NONZERO_DIGIT, '0');

function hasCanvas(doc: Document, measure: TextMeasurer): boolean {
  const cached = canvasAvailable.get(doc);
  if (cached !== undefined) return cached;
  let available = false;
  try {
    // The shared measurer's length-based fallback assigns width to a zero-width space.
    available = measure.width('\u200b', { font: '12px sans-serif', lineHeight: 12, letterSpacing: 0, wordSpacing: 0 }) === 0;
  } catch { /* A document without Canvas2D uses exact DOM dimensions. */ }
  canvasAvailable.set(doc, available);
  return available;
}

// Aligned rows follow their series across x positions. Scatter rows follow the source observation.
function sameRow(a: DatumRef, b: DatumRef | null): boolean {
  if (a.kind === 'aligned') return b?.kind === 'aligned' && a.seriesKey === b.seriesKey;
  if (a.kind === 'point') return b?.kind === 'point' && a.seriesKey === b.seriesKey && a.row === b.row;
  return b?.kind === 'slice' && a.sliceKey === b.sliceKey;
}

export function createTooltip(element: HTMLElement, readoutElement: HTMLElement, figure: HTMLElement, lost: () => void): TooltipView {
  const doc = element.ownerDocument;
  const txt = (s = '') => doc.createTextNode(s);
  const active = () => activeElementOf(doc, figure);

  let pressRef: DatumRef | null = null, pressPtr = 0, pressListening: Listeners | null = null;
  let pressedRef: DatumRef | null = null, pressedAt = 0, pendingFocus: DatumRef | null = null;
  // 0 = hidden, 1 = floating, 2 = strip
  let where: 0 | 1 | 2 = 0, wasPinned = false, current: TooltipContent | null = null, displayed = 0;
  let carriedRef: DatumRef | null = null, carriedPtr = 0, hadFocus: DatumRef | null = null;

  const entries: [RowEntry[], RowEntry[]] = [[], []];
  let nextRows: RowEntry[] = [];
  const children: Node[] = [];
  const hosts = [element, readoutElement] as const;
  const pinCls = ['axylo-tooltip-pinned', 'axylo-readout-pinned'] as const;
  const listening = new Listeners(), mores: (MoreEntry | undefined)[] = [];
  let wrapped = false, lastRect: Rect | null = null;
  let maxWidth = -1, maxHeight = -1;
  let transformX = NaN, transformY = NaN;
  let hoverSize: HoverSize | null = null, expectedWidth = 0;
  let shapeWidths: Map<string, number> | undefined;
  let measurer: TextMeasurer | undefined;
  let sizeObserver: ResizeObserver | undefined, observing = false;

  function clearPress(): void { pressRef = null; pressListening?.clear(); pressListening = null; }
  function cancelPointer(e: Event): void { if (pressRef !== null && pressPtr === (e as PointerEvent).pointerId) clearPress(); }

  function startPress(ref: DatumRef, ptr: number): void {
    clearPress();
    pressRef = ref; pressPtr = ptr;
    const l = pressListening = new Listeners(), roots = shadowRootsOf(element);
    listenOutside(doc, roots, 'pointerup', hosts, cancelPointer, l);
    for (const t of [doc, ...roots]) l.on(t, 'pointercancel', cancelPointer, true);
  }

  const buttonOf = (e: Event) => (e.target as Element | null)?.closest?.('button.axylo-tooltip-choice');
  hosts.forEach((host, idx) => {
    const rows = () => entries[idx as 0 | 1];
    listening.on(host, 'mousedown', e => { if (buttonOf(e)) keepFocusOnPress(e); });
    listening.on(host, 'pointerdown', e => {
      const b = buttonOf(e), row = b && rows().find(entry => entry.e === b);
      if (row) startPress(row.ref, e.pointerId); else clearPress();
    });
    listening.on(host, 'pointerup', e => {
      if (pressRef === null || pressPtr !== e.pointerId) return;
      const ref = pressRef;
      clearPress();
      pressedRef = ref; pressedAt = e.timeStamp;
      const now = rows().find(entry => entry.button && sameRow(entry.ref, ref));
      if (now) current?.select?.(now.r);
    });
    listening.on(host, 'pointercancel', cancelPointer);
    listening.on(host, 'click', e => {
      const b = buttonOf(e);
      if (!b) return;
      const row = rows().find(entry => entry.e === b);
      if (!row) current?.more?.(displayed);
      else if (!(e.detail > 0 && sameRow(row.ref, pressedRef) && e.timeStamp - pressedAt < 1000)) current?.select?.(row.r);
    });
  });

  function makeBox(cls: string, button: boolean, isStrip: boolean): HTMLElement {
    const el = doc.createElement(button ? 'button' : isStrip ? 'span' : 'div');
    el.className = button ? `${cls} axylo-tooltip-choice` : cls;
    if (button) { (el as HTMLButtonElement).type = 'button'; el.tabIndex = -1; }
    return el;
  }

  const floatTitle = make(doc, 'div', 'axylo-tooltip-title'), floatTitleNode = txt();
  // Width prediction uses the same digit shape for successive headings, as it does for values.
  floatTitle.style.fontVariantNumeric = 'tabular-nums';
  floatTitle.appendChild(floatTitleNode);
  let floatTitleText = '';
  let floatTotal: {
    row: HTMLElement; name: HTMLElement; value: HTMLElement; label: string; lang: string | null; text: string;
  } | null = null;
  let stripParts: { title: HTMLElement; total: HTMLElement; moreSep: Text; totalSep: Text } | null = null;

  const setL = (el: HTMLElement, l: string | null | undefined) => {
    setAttr(el, 'lang', l || null);
  };

  function syncRow(entry: RowEntry, content: TooltipContent, row: DatumText): void {
    entry.r = row;
    entry.ref = row.ref;
    const spec = content.swatch(row);
    if (entry.p !== spec) {
      entry.n.firstElementChild?.remove();
      if (spec) entry.n.insertBefore(createSwatch(doc, spec), entry.label);
      entry.p = spec;
    }
    if (entry.l !== row.seriesLabel) entry.label.textContent = entry.l = row.seriesLabel;
    const value = row.percent === null || row.percent === row.value ? row.value : `${row.value} (${row.percent})`;
    if (entry.value !== value) entry.t.textContent = entry.value = value;
    const lang = content.valueLang?.(row.value) ?? null;
    if (entry.g !== lang) { setAttr(entry.v, 'lang', lang); entry.g = lang; }
  }

  function rowEntries(idx: 0 | 1, content: TooltipContent, pinned: boolean): RowEntry[] {
    const previous = entries[idx], isStrip = idx === 1, out = nextRows;
    const button = pinned && content.select !== undefined;
    if (!isStrip && !pinned && previous.length === 1 && content.model.rows.length === 1) {
      const entry = previous[0]!, row = content.model.rows[0]!;
      if (!entry.button && sameRow(row.ref, entry.ref)) {
        syncRow(entry, content, row);
        return previous;
      }
    }
    for (const r of content.model.rows) {
      let entry: RowEntry | undefined = previous[out.length];
      if (!entry || entry.button !== button || !sameRow(r.ref, entry.ref)) {
        entry = previous.find(e => e.button === button && sameRow(r.ref, e.ref));
      }
      if (!entry) {
        const e = makeBox(isStrip ? 'axylo-readout-entry' : 'axylo-tooltip-row', button, isStrip);
        const n = make(doc, 'span', 'axylo-tooltip-series'), v = make(doc, 'span', 'axylo-tooltip-value'), t = txt();
        const label = txt(r.seriesLabel);
        n.appendChild(label); v.appendChild(t);
        if (isStrip) e.append(n, txt(' '), v); else e.append(n, v);
        entry = { button, e, n, v, t, label, s: isStrip ? txt('; ') : null,
          r, ref: r.ref, p: null, l: r.seriesLabel, g: null, value: '' };
      }
      syncRow(entry, content, r);
      out.push(entry);
    }
    entries[idx] = out;
    nextRows = previous;
    nextRows.length = 0;
    return out;
  }

  function focusedRef(idx: 0 | 1): DatumRef | null {
    const rows = entries[idx];
    if (!rows.length) return null;
    const act = active();
    return rows.find(e => e.button && e.e === act)?.ref ?? null;
  }

  function moreEntry(isStrip: boolean, pinned: boolean, content: TooltipContent, count: number): MoreEntry {
    const btn = pinned && content.more !== undefined, index = (isStrip ? 2 : 0) + (btn ? 1 : 0);
    const entry = mores[index] ??= { el: makeBox('axylo-tooltip-more', btn, isStrip), text: '', lang: null };
    const text = content.moreRows(count), lang = content.moreLang || null;
    if (entry.text !== text) setText(entry.el, entry.text = text);
    if (entry.lang !== lang) setAttr(entry.el, 'lang', entry.lang = lang);
    return entry;
  }

  function observeSize(): void {
    if (observing) return;
    const Observer = (doc.defaultView as (Window & typeof globalThis) | null)?.ResizeObserver;
    if (!Observer) return;
    sizeObserver ??= new Observer(records => {
      const size = records[0]?.borderBoxSize?.[0];
      if (hoverSize && (!size || Math.abs(size.inlineSize - expectedWidth) > 1 ||
          Math.abs(size.blockSize - hoverSize.height) > 1)) hoverSize = null;
    });
    sizeObserver.observe(element, { box: 'border-box' });
    observing = true;
  }

  function shapeWidth(text: string, entry: HoverText): number {
    if (sameShape(text, entry.text)) return entry.width;
    const widths = shapeWidths ??= new Map();
    const shape = digitShape(text), key = entry.key + shape;
    let width = widths.get(key);
    if (width === undefined) {
      width = measurer!.width(shape, entry.style);
      if (widths.size >= 128) widths.clear();
      widths.set(key, width);
    }
    entry.text = text;
    return entry.width = width;
  }

  function hoverText(element: HTMLElement, key: string, text: string): HoverText {
    const entry = { style: readTextStyle(element), key, text: '', width: 0 };
    shapeWidth(text, entry);
    return entry;
  }

  // Measure shrink-to-fit content in layout pixels. The exact first box supplies the outer chrome
  // and corrects for differences between Canvas and DOM text metrics.
  function calibrate(rows: readonly RowEntry[], more: MoreEntry | null, total: typeof floatTotal, width: number, height: number): HoverSize | null {
    const win = doc.defaultView;
    if (typeof win?.getComputedStyle !== 'function') return null;
    const measure = measurer ??= createMeasurer(doc);
    if (!hasCanvas(doc, measure)) return null;
    shapeWidths?.clear();
    const title = hoverText(floatTitle, 't:', floatTitleText);
    const moreWidth = more ? measure.width(more.text, readTextStyle(more.el)) : 0;
    const rowGap = (node: Element) => parseFloat(win.getComputedStyle(node).columnGap) || 0;
    let natural = Math.max(moreWidth, title.width);
    const measured = rows.map((entry, index) => {
      const swatch = entry.n.firstElementChild;
      const swatchWidth = swatch ? (parseFloat(win.getComputedStyle(swatch).width) || 20) + rowGap(entry.n) : 0;
      const fixed = measure.width(entry.l ?? '', readTextStyle(entry.n)) + swatchWidth + rowGap(entry.e);
      const text = hoverText(entry.v, `${index}:`, entry.value);
      natural = Math.max(natural, fixed + text.width);
      return { ...text, element: entry.e, label: entry.l, swatch: entry.p, lang: entry.g, fixed };
    });
    let measuredTotal: HoverRow | null = null;
    if (total) {
      const text = hoverText(total.value, 's:', total.text);
      const fixed = measure.width(total.label, readTextStyle(total.name)) + rowGap(total.row);
      natural = Math.max(natural, fixed + text.width);
      measuredTotal = { ...text, element: total.row, label: total.label, swatch: null, lang: total.lang, fixed };
    }
    return { title, rows: measured, more: more?.text ?? null, moreLang: more?.lang ?? null, moreWidth,
      total: measuredTotal, correction: width - natural, width, height };
  }

  function predictedWidth(size: HoverSize, rows: readonly RowEntry[], more: MoreEntry | null, total: typeof floatTotal): number {
    if (size.rows.length !== rows.length || size.more !== (more?.text ?? null) || size.moreLang !== (more?.lang ?? null) ||
        size.total?.label !== total?.label || size.total?.lang !== total?.lang) return NaN;
    let natural = Math.max(size.moreWidth, shapeWidth(floatTitleText, size.title));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!, calibrated = size.rows[i]!;
      if (row.e !== calibrated.element || row.l !== calibrated.label || row.p !== calibrated.swatch || row.g !== calibrated.lang) return NaN;
      natural = Math.max(natural, calibrated.fixed + shapeWidth(row.value, calibrated));
    }
    if (total && size.total) natural = Math.max(natural, size.total.fixed + shapeWidth(total.text, size.total));
    return natural + size.correction;
  }

  function hideIdx(idx: 0 | 1): void {
    const host = hosts[idx];
    if (idx === 0) {
      hoverSize = null;
      if (observing) { sizeObserver!.unobserve(element); observing = false; }
    }
    if (where === idx + 1) lastRect = null;
    if (host.hidden && !host.firstChild) return;
    const ref = focusedRef(idx);
    if (ref !== null) {
      pendingFocus = ref;
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
    host.replaceChildren();
    entries[idx].length = 0;
    mores[idx * 2] = mores[idx * 2 + 1] = undefined;
    if (idx === 0) floatTotal = null;
  }

  function begin(idx: 0 | 1, content: TooltipContent, pinned: boolean): void {
    current = content;
    carriedRef = pinned ? pressRef : null; carriedPtr = pressPtr;
    if (!pinned) clearPress();
    hadFocus = (wasPinned && where ? focusedRef((where - 1) as 0 | 1) : null) ?? pendingFocus;
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
      if (carriedRef !== null && pressRef === null) startPress(carriedRef, carriedPtr);
      if (hadFocus !== null) {
        const entry = entries[idx].find(e => e.button && sameRow(e.ref, hadFocus));
        if (!entry?.e.isConnected) lost();
        else if (active() !== entry.e) entry.e.focus({ preventScroll: true });
      }
    } else {
      hideIdx(idx);
      where = 0; lastRect = null;
      if (hadFocus !== null) lost();
    }
    carriedRef = hadFocus = null;
    return visible;
  }

  function positionFloat(spot: Spot, width: number, height: number, m: Mapping): void {
    const x = (spot.x - m.left) / m.kx, y = (spot.y - m.top) / m.ky;
    if (x !== transformX || y !== transformY) {
      element.style.transform = `translate(${x}px, ${y}px)`;
      transformX = x; transformY = y;
    }
    if (!lastRect || lastRect.x !== spot.x || lastRect.y !== spot.y || lastRect.width !== width || lastRect.height !== height) {
      lastRect = { x: spot.x, y: spot.y, width, height };
    }
  }

  function hide(): void {
    clearPress(); hideIdx(0); hideIdx(1);
    where = displayed = 0;
    children.length = nextRows.length = 0;
    pressedRef = carriedRef = hadFocus = current = lastRect = null;
  }

  return {
    get visible() { return where !== 0; },
    rect: () => lastRect,
    contains: node => node !== null && (element.contains(node) || readoutElement.contains(node)),
    invalidateSize() { hoverSize = null; },
    show(content, p, pinned, figMapping) {
      const m = figMapping ?? mappingOf(figure);
      const maxW = Math.max(0, Math.min(320, p.visible.width / m.kx)), maxH = Math.max(0, p.visible.height / m.ky);
      const steady = where === 1 && !pinned && !wasPinned && !element.hidden;
      if (steady) current = content; else begin(0, content, pinned);
      if (maxWidth !== maxW || maxHeight !== maxH || pinned || wrapped || where !== 1) hoverSize = null;
      if (maxWidth !== maxW) { maxWidth = maxW; element.style.maxWidth = `${maxW}px`; }
      if (maxHeight !== maxH) { maxHeight = maxH; element.style.maxHeight = `${maxH}px`; }
      const rows = rowEntries(0, content, pinned), { model } = content, total = rows.length;
      if (wrapped) { element.classList.remove('axylo-tooltip-wrap'); wrapped = false; }
      if (floatTitleText !== model.title) floatTitleNode.textContent = floatTitleText = model.title;
      if (model.total !== null) {
        if (!floatTotal) {
          const row = make(doc, 'div', 'axylo-tooltip-row axylo-tooltip-total');
          const name = make(doc, 'span', 'axylo-tooltip-series'), value = make(doc, 'span', 'axylo-tooltip-value');
          row.append(name, value);
          floatTotal = { row, name, value, label: '', lang: null, text: '' };
        }
        const label = content.totalLabel ?? '', lang = content.totalLang || null;
        if (floatTotal.label !== label) setText(floatTotal.name, floatTotal.label = label);
        if (floatTotal.lang !== lang) setAttr(floatTotal.name, 'lang', floatTotal.lang = lang);
        if (floatTotal.text !== model.total) setText(floatTotal.value, floatTotal.text = model.total);
      }
      const totalRow = model.total === null ? null : floatTotal;
      if (hoverSize) {
        const more = model.count > total ? moreEntry(false, pinned, content, model.count - total) : null;
        const size = hoverSize;
        const width = predictedWidth(size, rows, more, totalRow), { height } = size;
        if (width > 0 && width < maxW - 8 && height < maxH - 8) {
          // Allow for fractional DOM rounding when an estimated box meets an obstacle or edge.
          const pad = Math.abs(width - size.width) > 0.01 ? 1 : 0;
          const spot = placeTooltip(p, (width + pad) * m.kx, height * m.ky);
          if (spot) {
            expectedWidth = width;
            positionFloat(spot, width * m.kx, height * m.ky, m);
            return steady || finish(0, true);
          }
        }
        hoverSize = null;
      }
      const overflows = () => element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1;
      for (let shown = total; shown >= Math.min(1, total); shown--) {
        children.push(floatTitle);
        for (let i = 0; i < shown; i++) children.push(rows[i]!.e);
        displayed = shown;
        const more = model.count > shown ? moreEntry(false, pinned, content, model.count - shown) : null;
        if (more) children.push(more.el);
        if (totalRow) children.push(totalRow.row);
        placeChildren(element, children);
        children.length = 0;
        let size = element.getBoundingClientRect();
        if (size.width >= (maxW - 2) * m.kx || size.height >= (maxH - 2) * m.ky) {
          let over = overflows();
          if (over && !wrapped) {
            element.classList.add('axylo-tooltip-wrap'); wrapped = true;
            over = overflows();
            // Wrapping changes the rendered box and must be measured before placement.
            if (!over || shown <= 1) size = element.getBoundingClientRect();
          }
          if (over && shown > 1) continue;
        }
        const { width, height } = size;
        let spot = placeTooltip(p, width, height);
        if (!spot && shown <= 1 && width > 0) spot = fallbackPlacement(p, width, height);
        if (spot) {
          const localW = width / m.kx, localH = height / m.ky;
          if (!pinned && !wrapped && shown === total && localW > 0 && localW < maxW - 8 && localH < maxH - 8) {
            hoverSize = calibrate(rows, more, totalRow, localW, localH);
            expectedWidth = localW;
          }
          positionFloat(spot, width, height, m);
          observeSize();
          return finish(0, true);
        }
      }
      return finish(0, false);
    },
    strip(content, pinned, visible) {
      begin(1, content, pinned);
      const { title: stripTitle, total: stripTotal, moreSep, totalSep } = stripParts ??= {
        title: make(doc, 'span', 'axylo-tooltip-title'), total: make(doc, 'span', 'axylo-readout-total'),
        moreSep: txt('; '), totalSep: txt('; '),
      };
      const { model } = content, rows = rowEntries(1, content, pinned);
      setText(stripTitle, `${model.title}: `);
      if (model.total !== null) { setText(stripTotal, `${content.totalLabel ?? ''} ${model.total}`); setL(stripTotal, content.totalLang); }
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
          if (model.count > shown) { if (shown) parts.push(moreSep); parts.push(pager = moreEntry(true, pinned, content, model.count - shown).el); }
          placeChildren(readoutElement, parts);
          seen = within(stripTitle) && within(pager);
          for (let i = 0; seen && i < shown; i++) seen = within(rows[i]!.e);
        }
      }
      if (seen) lastRect = r;
      return finish(1, seen);
    },
    hide,
    destroy() {
      hide(); sizeObserver?.disconnect(); sizeObserver = undefined;
      pendingFocus = stripParts = null; listening.clear(); mores.length = 0;
    },
  };
}
