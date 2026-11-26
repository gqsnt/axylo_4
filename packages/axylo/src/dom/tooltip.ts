/**
 * Renders a tooltip model as text (spec I1, DX8: textContent only), floating or in the strip under the plot.
 */
import { activeElementOf, focusQuiet, placeChildren, setAttr, setLanguageText, setText, make, keepFocusOnPress, shadowRootsOf } from './attributes';
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

interface ReadoutRow {
  readonly e: HTMLElement;
  readonly n: HTMLElement;
  readonly v: HTMLElement;
  p: SwatchSpec | null;
  l: string;
  g: string | null;
  value: string;
}

interface RowEntry extends ReadoutRow {
  readonly button: boolean;
  readonly t: Text;
  readonly label: Text;
  readonly s: Text | null;
  r: DatumText;
  ref: DatumRef;
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
  readonly label: string;
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

let canvasAvailable: WeakMap<Document, boolean> | undefined;
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
  const cache = canvasAvailable ??= new WeakMap();
  const cached = cache.get(doc);
  if (cached !== undefined) return cached;
  let available = false;
  try {
    // The shared measurer's length-based fallback assigns width to a zero-width space.
    available = measure.width('\u200b', { font: '12px sans-serif', lineHeight: 12, letterSpacing: 0, wordSpacing: 0 }) === 0;
  } catch { /* A document without Canvas2D uses exact DOM dimensions. */ }
  cache.set(doc, available);
  return available;
}

// Aligned rows follow their series across x positions. Scatter rows follow the source observation.
function sameRow(a: DatumRef, b: DatumRef | null): boolean {
  if (a.kind === 'aligned') return b?.kind === 'aligned' && a.seriesKey === b.seriesKey;
  if (a.kind === 'point') return b?.kind === 'point' && a.seriesKey === b.seriesKey && a.row === b.row;
  return b?.kind === 'slice' && a.sliceKey === b.sliceKey;
}

const PINNED_CLASS = ['axylo-tooltip-pinned', 'axylo-readout-pinned'] as const;
const CHOICE_EVENTS = ['mousedown', 'pointerdown', 'pointerup', 'pointercancel', 'click'] as const;
const FLOAT_WRAPPED = 1, FLOAT_OBSERVED = 2;
const buttonOf = (e: Event) => (e.target as Element | null)?.closest?.('button.axylo-tooltip-choice');

function tooltipText(doc: Document, part: 'title' | 'series' | 'value', tag: 'span' | 'div' = 'span'): HTMLElement {
  return make(doc, tag, `axylo-tooltip-${part}`);
}

function floatingTotal(doc: Document): ReadoutRow {
  const e = make(doc, 'div', 'axylo-tooltip-row axylo-tooltip-total');
  const n = tooltipText(doc, 'series'), v = tooltipText(doc, 'value');
  e.append(n, v);
  return { e, n, v, p: null, l: '', g: null, value: '' };
}

function withinStrip(el: Element | null, box: Rect): boolean {
  if (!el?.isConnected) return true;
  const rects = el.getClientRects();
  for (const r of rects) {
    if (r.left < box.x - 0.5 || r.top < box.y - 0.5 || r.right > box.x + box.width + 0.5 || r.bottom > box.y + box.height + 0.5) return false;
  }
  return rects.length > 0;
}

function columnGap(win: Window, node: Element): number {
  return parseFloat(win.getComputedStyle(node).columnGap) || 0;
}

class DomTooltip implements TooltipView {
  readonly #doc: Document;
  #floatTitle: HTMLElement | null = null;
  #floatTitleNode: Text | null = null;
  #listening: Listeners | null = null;
  #pressRef: DatumRef | null = null;
  #pressPtr = 0;
  #pressListening: Listeners | null = null;
  #pressedRef: DatumRef | null = null;
  #pressedAt = 0;
  #pendingFocus: DatumRef | null = null;
  #where: 0 | 1 | 2 = 0; // Hidden, floating, or strip.
  #wasPinned = false;
  #current: TooltipContent | null = null;
  #displayed = 0;
  #carriedRef: DatumRef | null = null;
  #carriedPtr = 0;
  #hadFocus: DatumRef | null = null;
  readonly #entries: [RowEntry[]?, RowEntry[]?] = [];
  #nextRows: RowEntry[] | undefined;
  #children: Node[] | undefined;
  #mores: (MoreEntry | undefined)[] | undefined;
  #floatFlags = 0;
  #lastRect: Rect | null = null;
  #maxWidth = -1;
  #maxHeight = -1;
  #transformX = NaN;
  #transformY = NaN;
  #hoverSize: HoverSize | null = null;
  #expectedWidth = 0;
  #shapeWidths: Map<string, number> | undefined;
  #measurer: TextMeasurer | undefined;
  #sizeObserver: ResizeObserver | undefined;
  #floatTitleText = '';
  #floatTotal: ReadoutRow | null = null;
  #stripParts: [title: HTMLElement, total: HTMLElement, moreSep: Text, totalSep: Text] | null = null;

  readonly #element: HTMLElement;
  readonly #readoutElement: HTMLElement;
  readonly #figure: HTMLElement;
  readonly #lost: () => void;

  constructor(
    element: HTMLElement,
    readoutElement: HTMLElement,
    figure: HTMLElement,
    lost: () => void,
  ) {
    this.#element = element;
    this.#readoutElement = readoutElement;
    this.#figure = figure;
    this.#lost = lost;
    this.#doc = element.ownerDocument;
  }

  get visible(): boolean { return this.#where !== 0; }
  rect(): Rect | null { return this.#lastRect; }
  contains(node: Node | null): boolean {
    return node !== null && (this.#element.contains(node) || this.#readoutElement.contains(node));
  }

  #txt(s = ''): Text { return this.#doc.createTextNode(s); }
  #active(): Element | null { return activeElementOf(this.#doc, this.#figure); }

  #listenChoices(): void {
    if (this.#listening) return;
    const l = this.#listening = new Listeners(), choice = this.#onChoice.bind(this);
    for (const host of [this.#element, this.#readoutElement]) {
      for (const type of CHOICE_EVENTS) l.on(host, type, choice);
    }
  }

  #onChoice(event: MouseEvent): void {
    const rows = this.#entries[event.currentTarget === this.#readoutElement ? 1 : 0];
    const { type } = event;
    if (type === 'pointercancel') { this.#cancelPointer(event); return; }
    if (type === 'pointerup') {
      const ref = this.#pressRef;
      if (ref === null || this.#pressPtr !== (event as PointerEvent).pointerId) return;
      this.#clearPress();
      this.#pressedRef = ref; this.#pressedAt = event.timeStamp;
      const row = rows?.find(entry => entry.button && sameRow(entry.ref, ref));
      if (row) this.#current?.select?.(row.r);
      return;
    }
    const button = buttonOf(event);
    if (type === 'mousedown') {
      if (button) keepFocusOnPress(event);
      return;
    }
    const row = button && rows?.find(entry => entry.e === button);
    if (type === 'pointerdown') {
      if (row) this.#startPress(row.ref, (event as PointerEvent).pointerId); else this.#clearPress();
    } else if (button) {
      if (!row) this.#current?.more?.(this.#displayed);
      else if (!(event.detail > 0 && sameRow(row.ref, this.#pressedRef) && event.timeStamp - this.#pressedAt < 1000)) this.#current?.select?.(row.r);
    }
  }

  #clearPress(): void { this.#pressRef = null; this.#pressListening?.clear(); this.#pressListening = null; }

  #cancelPointer(e: Event): void { if (this.#pressRef !== null && this.#pressPtr === (e as PointerEvent).pointerId) this.#clearPress(); }

  #startPress(ref: DatumRef, ptr: number): void {
    this.#clearPress();
    this.#pressRef = ref; this.#pressPtr = ptr;
    const l = this.#pressListening = new Listeners(), roots = shadowRootsOf(this.#element);
    const cancel = this.#cancelPointer.bind(this);
    listenOutside(this.#doc, roots, 'pointerup', [this.#element, this.#readoutElement], cancel, l);
    for (const t of [this.#doc, ...roots]) l.on(t, 'pointercancel', cancel, true);
  }

  #makeBox(cls: string, button: boolean, isStrip: boolean): HTMLElement {
    const el = this.#doc.createElement(button ? 'button' : isStrip ? 'span' : 'div');
    el.className = button ? `${cls} axylo-tooltip-choice` : cls;
    if (button) { (el as HTMLButtonElement).type = 'button'; el.tabIndex = -1; }
    return el;
  }

  #syncRow(entry: RowEntry, content: TooltipContent, row: DatumText): void {
    entry.r = row;
    entry.ref = row.ref;
    const spec = content.swatch(row);
    if (entry.p !== spec) {
      entry.n.firstElementChild?.remove();
      if (spec) entry.n.insertBefore(createSwatch(this.#doc, spec), entry.label);
      entry.p = spec;
    }
    if (entry.l !== row.seriesLabel) entry.label.textContent = entry.l = row.seriesLabel;
    const value = row.percent === null || row.percent === row.value ? row.value : `${row.value} (${row.percent})`;
    if (entry.value !== value) entry.t.textContent = entry.value = value;
    const lang = content.valueLang?.(row.value) ?? null;
    if (entry.g !== lang) { setAttr(entry.v, 'lang', lang); entry.g = lang; }
  }

  #rowEntries(idx: 0 | 1, content: TooltipContent, pinned: boolean): RowEntry[] {
    const previous = this.#entries[idx], isStrip = idx === 1;
    const button = pinned && content.select !== undefined;
    if (!isStrip && !pinned && previous?.length === 1 && content.model.rows.length === 1) {
      const entry = previous[0]!, row = content.model.rows[0]!;
      if (!entry.button && sameRow(row.ref, entry.ref)) {
        this.#syncRow(entry, content, row);
        return previous;
      }
    }
    const out = this.#nextRows ?? [];
    for (const r of content.model.rows) {
      let entry: RowEntry | undefined = previous?.[out.length];
      if (!entry || entry.button !== button || !sameRow(r.ref, entry.ref)) {
        entry = previous?.find(e => e.button === button && sameRow(r.ref, e.ref));
      }
      if (!entry) {
        const e = this.#makeBox(isStrip ? 'axylo-readout-entry' : 'axylo-tooltip-row', button, isStrip);
        const n = tooltipText(this.#doc, 'series'), v = tooltipText(this.#doc, 'value'), t = this.#txt();
        const label = this.#txt(r.seriesLabel);
        n.appendChild(label); v.appendChild(t);
        if (isStrip) e.append(n, this.#txt(' '), v); else e.append(n, v);
        entry = { button, e, n, v, t, label, s: isStrip ? this.#txt('; ') : null,
          r, ref: r.ref, p: null, l: r.seriesLabel, g: null, value: '' };
      }
      this.#syncRow(entry, content, r);
      out.push(entry);
    }
    this.#entries[idx] = out;
    this.#nextRows = previous;
    if (previous) previous.length = 0;
    return out;
  }

  #focusedRef(idx: 0 | 1): DatumRef | null {
    const rows = this.#entries[idx];
    if (!rows?.length) return null;
    const act = this.#active();
    return rows.find(e => e.button && e.e === act)?.ref ?? null;
  }

  #moreEntry(isStrip: boolean, pinned: boolean, content: TooltipContent, count: number): MoreEntry {
    const btn = pinned && content.more !== undefined, index = (isStrip ? 2 : 0) + (btn ? 1 : 0);
    const mores = this.#mores ??= [];
    const entry = mores[index] ??= { el: this.#makeBox('axylo-tooltip-more', btn, isStrip), text: '', lang: null };
    const text = content.moreRows(count), lang = content.moreLang || null;
    if (entry.text !== text) setText(entry.el, entry.text = text);
    if (entry.lang !== lang) setAttr(entry.el, 'lang', entry.lang = lang);
    return entry;
  }

  #mountRows(
    title: HTMLElement, rows: readonly RowEntry[], shown: number, content: TooltipContent, pinned: boolean, total: HTMLElement | null,
    strip?: readonly [HTMLElement, HTMLElement, Text, Text],
  ): MoreEntry | null {
    const parts = this.#children ??= [];
    parts.push(title);
    for (let i = 0; i < shown; i++) {
      const row = rows[i]!;
      if (strip && i) parts.push(row.s!);
      parts.push(row.e);
    }
    this.#displayed = shown;
    if (strip && total) parts.push(strip[3], total);
    const count = content.model.count;
    const more = count > shown ? this.#moreEntry(strip !== undefined, pinned, content, count - shown) : null;
    if (more) {
      if (strip && shown) parts.push(strip[2]);
      parts.push(more.el);
    }
    if (!strip && total) parts.push(total);
    placeChildren(strip ? this.#readoutElement : this.#element, parts);
    parts.length = 0;
    return more;
  }

  #observeSize(): void {
    if (this.#floatFlags & FLOAT_OBSERVED) return;
    const Observer = (this.#doc.defaultView as (Window & typeof globalThis) | null)?.ResizeObserver;
    if (!Observer) return;
    this.#sizeObserver ??= new Observer(records => {
      const size = records[0]?.borderBoxSize?.[0];
      if (this.#hoverSize && (!size || Math.abs(size.inlineSize - this.#expectedWidth) > 1 ||
          Math.abs(size.blockSize - this.#hoverSize.height) > 1)) this.#hoverSize = null;
    });
    this.#sizeObserver.observe(this.#element, { box: 'border-box' });
    this.#floatFlags |= FLOAT_OBSERVED;
  }

  #shapeWidth(text: string, entry: HoverText): number {
    if (sameShape(text, entry.text)) return entry.width;
    const widths = this.#shapeWidths ??= new Map();
    const shape = digitShape(text), key = entry.key + shape;
    let width = widths.get(key);
    if (width === undefined) {
      width = this.#measurer!.width(shape, entry.style);
      if (widths.size >= 128) widths.clear();
      widths.set(key, width);
    }
    entry.text = text;
    return entry.width = width;
  }

  #hoverText(element: HTMLElement, key: string, text: string): HoverText {
    const entry = { style: readTextStyle(element), key, text: '', width: 0 };
    this.#shapeWidth(text, entry);
    return entry;
  }

  #measureRow(win: Window, measure: TextMeasurer, entry: ReadoutRow, key: string): HoverRow {
    const swatch = entry.p ? entry.n.firstElementChild : null;
    const swatchWidth = swatch ? (parseFloat(win.getComputedStyle(swatch).width) || 20) + columnGap(win, entry.n) : 0;
    const fixed = measure.width(entry.l, readTextStyle(entry.n)) + swatchWidth + columnGap(win, entry.e);
    return { ...this.#hoverText(entry.v, key, entry.value), element: entry.e, label: entry.l, swatch: entry.p, lang: entry.g, fixed };
  }

  // The first DOM measurement calibrates the canvas estimate for the same tooltip chrome.
  #calibrate(rows: readonly RowEntry[], more: MoreEntry | null, total: ReadoutRow | null, width: number, height: number): HoverSize | null {
    const win = this.#doc.defaultView;
    if (typeof win?.getComputedStyle !== 'function') return null;
    const measure = this.#measurer ??= createMeasurer(this.#doc);
    if (!hasCanvas(this.#doc, measure)) return null;
    this.#shapeWidths?.clear();
    const title = this.#hoverText(this.#floatTitle!, 't:', this.#floatTitleText);
    const moreWidth = more ? measure.width(more.text, readTextStyle(more.el)) : 0;
    let natural = Math.max(moreWidth, title.width);
    const measured = rows.map((entry, index) => {
      const row = this.#measureRow(win, measure, entry, `${index}:`);
      natural = Math.max(natural, row.fixed + row.width);
      return row;
    });
    const measuredTotal = total ? this.#measureRow(win, measure, total, 's:') : null;
    if (measuredTotal) natural = Math.max(natural, measuredTotal.fixed + measuredTotal.width);
    return { title, rows: measured, more: more?.text ?? null, moreLang: more?.lang ?? null, moreWidth,
      total: measuredTotal, correction: width - natural, width, height };
  }

  #predictedWidth(size: HoverSize, rows: readonly RowEntry[], more: MoreEntry | null, total: ReadoutRow | null): number {
    if (size.rows.length !== rows.length || size.more !== (more?.text ?? null) || size.moreLang !== (more?.lang ?? null) ||
        size.total?.label !== total?.l || size.total?.lang !== total?.g) return NaN;
    let natural = Math.max(size.moreWidth, this.#shapeWidth(this.#floatTitleText, size.title));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!, calibrated = size.rows[i]!;
      if (row.e !== calibrated.element || row.l !== calibrated.label || row.p !== calibrated.swatch || row.g !== calibrated.lang) return NaN;
      natural = Math.max(natural, calibrated.fixed + this.#shapeWidth(row.value, calibrated));
    }
    if (total && size.total) natural = Math.max(natural, size.total.fixed + this.#shapeWidth(total.value, size.total));
    return natural + size.correction;
  }

  #hideIdx(idx: 0 | 1): void {
    const host = idx === 0 ? this.#element : this.#readoutElement;
    if (idx === 0) {
      this.#hoverSize = null;
      if (this.#floatFlags & FLOAT_OBSERVED) {
        this.#sizeObserver!.unobserve(this.#element);
        this.#floatFlags &= ~FLOAT_OBSERVED;
      }
    }
    if (this.#where === idx + 1) this.#lastRect = null;
    if (host.hidden && !host.firstChild) return;
    const ref = this.#focusedRef(idx);
    if (ref !== null) {
      this.#pendingFocus = ref;
      queueMicrotask(() => {
        if (this.#pendingFocus === null) return;
        this.#pendingFocus = null;
        const act = this.#active();
        if (!this.#element.contains(act) && !this.#readoutElement.contains(act)) this.#lost();
      });
    }
    this.#clearPress();
    host.hidden = true;
    host.classList.remove(PINNED_CLASS[idx]);
    setAttr(host, 'aria-hidden', 'true');
    host.replaceChildren();
    const rows = this.#entries[idx];
    if (rows) rows.length = 0;
    if (this.#mores) this.#mores[idx * 2] = this.#mores[idx * 2 + 1] = undefined;
    if (idx === 0) this.#floatTotal = null;
  }

  #begin(idx: 0 | 1, content: TooltipContent, pinned: boolean): void {
    this.#current = content;
    this.#carriedRef = pinned ? this.#pressRef : null; this.#carriedPtr = this.#pressPtr;
    if (pinned) this.#listenChoices(); else this.#clearPress();
    this.#hadFocus = (this.#wasPinned && this.#where ? this.#focusedRef((this.#where - 1) as 0 | 1) : null) ?? this.#pendingFocus;
    this.#pendingFocus = null;
    this.#hideIdx(idx ? 0 : 1);
    const host = idx === 0 ? this.#element : this.#readoutElement;
    if (this.#where !== idx + 1 || pinned !== this.#wasPinned || host.hidden) {
      if (host.hidden) host.hidden = false;
      if (pinned || (this.#where === idx + 1 && this.#wasPinned)) host.classList.toggle(PINNED_CLASS[idx], pinned);
      setAttr(host, 'aria-hidden', pinned ? null : 'true');
    }
    this.#wasPinned = pinned;
  }

  #finish(idx: 0 | 1, visible: boolean): boolean {
    if (visible) {
      this.#where = (idx + 1) as 1 | 2;
      if (this.#carriedRef !== null && this.#pressRef === null) this.#startPress(this.#carriedRef, this.#carriedPtr);
      if (this.#hadFocus !== null) {
        const entry = this.#entries[idx]?.find(e => e.button && sameRow(e.ref, this.#hadFocus));
        if (!entry?.e.isConnected) this.#lost();
        else if (this.#active() !== entry.e) focusQuiet(entry.e);
      }
    } else {
      this.#hideIdx(idx);
      this.#where = 0; this.#lastRect = null;
      if (this.#hadFocus !== null) this.#lost();
    }
    this.#carriedRef = this.#hadFocus = null;
    return visible;
  }

  #positionFloat(spot: Spot, width: number, height: number, m: Mapping): void {
    const x = (spot.x - m.left) / m.kx, y = (spot.y - m.top) / m.ky;
    if (x !== this.#transformX || y !== this.#transformY) {
      this.#element.style.transform = `translate(${x}px, ${y}px)`;
      this.#transformX = x; this.#transformY = y;
    }
    if (!this.#lastRect || this.#lastRect.x !== spot.x || this.#lastRect.y !== spot.y || this.#lastRect.width !== width || this.#lastRect.height !== height) {
      this.#lastRect = { x: spot.x, y: spot.y, width, height };
    }
  }

  hide(): void {
    this.#clearPress(); this.#hideIdx(0); this.#hideIdx(1);
    this.#where = this.#displayed = 0;
    if (this.#children) this.#children.length = 0;
    if (this.#nextRows) this.#nextRows.length = 0;
    this.#pressedRef = this.#carriedRef = this.#hadFocus = this.#current = this.#lastRect = null;
  }

  invalidateSize(): void { this.#hoverSize = null; }

  #overflows(): boolean {
    const el = this.#element;
    return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
  }

  show(content: TooltipContent, p: PlacementInput, pinned: boolean, figMapping?: Mapping): boolean {
    const m = figMapping ?? mappingOf(this.#figure);
    let maxW = Math.max(0, Math.min(320, p.visible.width / m.kx)), maxH = Math.max(0, p.visible.height / m.ky);
    const steady = this.#where === 1 && !pinned && !this.#wasPinned && !this.#element.hidden;
    if (steady) this.#current = content; else this.#begin(0, content, pinned);
    if (this.#maxWidth !== maxW || this.#maxHeight !== maxH || pinned || (this.#floatFlags & FLOAT_WRAPPED) || this.#where !== 1) this.#hoverSize = null;
    if (this.#maxWidth !== maxW) { this.#maxWidth = maxW; this.#element.style.maxWidth = `${maxW}px`; }
    if (this.#maxHeight !== maxH) { this.#maxHeight = maxH; this.#element.style.maxHeight = `${maxH}px`; }
    const rows = this.#rowEntries(0, content, pinned), { model } = content, total = rows.length;
    if (this.#floatFlags & FLOAT_WRAPPED) {
      this.#element.classList.remove('axylo-tooltip-wrap');
      this.#floatFlags &= ~FLOAT_WRAPPED;
    }
    const title = this.#floatTitle ??= tooltipText(this.#doc, 'title', 'div');
    if (!title.firstChild) title.append(this.#floatTitleNode = this.#txt());
    if (this.#floatTitleText !== model.title) this.#floatTitleNode!.textContent = this.#floatTitleText = model.title;
    let totalRow: ReadoutRow | null = null;
    if (model.total !== null) {
      totalRow = this.#floatTotal ??= floatingTotal(this.#doc);
      const label = content.totalLabel ?? '', lang = content.totalLang || null;
      if (totalRow.l !== label) setText(totalRow.n, totalRow.l = label);
      if (totalRow.g !== lang) setAttr(totalRow.n, 'lang', totalRow.g = lang);
      if (totalRow.value !== model.total) setText(totalRow.v, totalRow.value = model.total);
    }
    if (this.#hoverSize) {
      const more = model.count > total ? this.#moreEntry(false, pinned, content, model.count - total) : null;
      const size = this.#hoverSize;
      const width = this.#predictedWidth(size, rows, more, totalRow), { height } = size;
      if (width > 0 && width < maxW - 8 && height < maxH - 8) {
        // Allow for fractional DOM rounding when an estimated box meets an obstacle or edge.
        const pad = Math.abs(width - size.width) > 0.01 ? 1 : 0;
        const spot = placeTooltip(p, (width + pad) * m.kx, height * m.ky);
        if (spot) {
          this.#expectedWidth = width;
          this.#positionFloat(spot, width * m.kx, height * m.ky, m);
          return steady || this.#finish(0, true);
        }
      }
      this.#hoverSize = null;
    }
    const firstMax = maxW;
    let holeTry = 0;
    for (let shown = total; shown >= Math.min(1, total); shown--) {
      const more = this.#mountRows(title, rows, shown, content, pinned, totalRow?.e ?? null);
      let size = this.#element.getBoundingClientRect(), clipped = false;
      if (size.width >= (maxW - 2) * m.kx || size.height >= (maxH - 2) * m.ky) {
        let over = this.#overflows();
        if (over && !(this.#floatFlags & FLOAT_WRAPPED)) {
          this.#element.classList.add('axylo-tooltip-wrap');
          this.#floatFlags |= FLOAT_WRAPPED;
          over = this.#overflows();
          // Wrapping changes the rendered box and must be measured before placement.
          if (!over) size = this.#element.getBoundingClientRect();
        }
        // Fewer rows first. One row that still overflows once wrapped would be placed cut by the tooltip's
        // maxima (L1): it is not shown, and the datum keeps its highlight, keyboard reading and table row (I1).
        // The last row still reaches the narrower retries below: a wrapped row too tall for one width may fit another.
        if (over && shown > 1) continue;
        clipped = over;
      }
      const { width, height } = size;
      let spot = clipped ? null : placeTooltip(p, width, height);
      if (!spot && !clipped && shown <= 1 && width > 0) spot = fallbackPlacement(p, width, height);
      if (spot) {
        const localW = width / m.kx, localH = height / m.ky;
        if (!pinned && !(this.#floatFlags & FLOAT_WRAPPED) && shown === total && localW > 0 && localW < maxW - 8 && localH < maxH - 8) {
          this.#hoverSize = this.#calibrate(rows, more, totalRow, localW, localH);
          this.#expectedWidth = localW;
        }
        this.#positionFloat(spot, width, height, m);
        this.#observeSize();
        return this.#finish(0, true);
      }
      // A keyboard ring around a large slice can span most of a small plot, so one row fits neither the hole nor
      // any side of it. It is tried once more, no wider than the wider free column beside the ring and wrapped if
      // it must, under the same rules, which never cover the ring or the controls (decision 0004 rules 2, 6). The
      // changed maximum also makes the next show restore the usual one.
      // No column beside the ring either (a dominant slice), or a pointer with no ring at all: the hole may still
      // hold the row once it is narrower and wrapped. Two widths are tried, the inscribed square's and a wider,
      // shorter one (1.6 r, still inside the hole's chord for two wrapped lines), since wrapping makes the row taller; the hole's own test still decides, so the ring and the controls stay clear.
      const ring = shown === 1 ? p.rings[0] : null, v = p.visible, h = p.hole;
      let w = ring ? Math.max(ring.x - v.x, v.x + v.width - ring.x - ring.width) / m.kx | 0 : 0;
      if (!(w > 48 && w < maxW)) w = shown === 1 && h && holeTry < 2 ? (holeTry++ ? 1.6 : 1.41) * h.rx / m.kx | 0 : 0;
      // A width already tried (or the current one) would only repeat the same measurement.
      if (w > 48 && w < firstMax && w !== maxW) { this.#element.style.maxWidth = `${this.#maxWidth = maxW = w}px`; shown++; }
    }
    return this.#finish(0, false);
  }

  strip(content: TooltipContent, pinned: boolean, visible: Rect): boolean {
    this.#begin(1, content, pinned);
    const parts = this.#stripParts ??= [
      tooltipText(this.#doc, 'title'), make(this.#doc, 'span', 'axylo-readout-total'), this.#txt('; '), this.#txt('; '),
    ];
    // The total's label and number are apart, so a cut strip can ellipsize a long localized label and keep the number.
    if (!parts[1].firstChild) parts[1].append(make(this.#doc, 'span', ''), this.#txt());
    const [stripTitle, stripTotal] = parts;
    const { model } = content, rows = this.#rowEntries(1, content, pinned);
    setText(stripTitle, `${model.title}: `);
    if (model.total !== null) {
      setLanguageText(stripTotal.firstChild as Element, `${content.totalLabel ?? ''} `, content.totalLang || null);
      (stripTotal.lastChild as Text).data = model.total;
    }
    const r = this.#readoutElement.getBoundingClientRect(), box = intersect(r, visible);
    const cl = this.#readoutElement.classList, minS = Math.min(1, rows.length);
    cl.remove('axylo-readout-wrap', 'axylo-readout-cut');
    let seen = false;
    for (let pass = 0; pass < 3 && !seen; pass++) {
      if (pass === 1) cl.add('axylo-readout-wrap');
      if (pass === 2) cl.replace('axylo-readout-wrap', 'axylo-readout-cut');
      for (let shown = pass === 2 ? minS : rows.length; shown >= minS && !seen; shown--) {
        const pager = this.#mountRows(stripTitle, rows, shown, content, pinned, model.total === null ? null : stripTotal, parts);
        seen = withinStrip(stripTitle, box) && withinStrip(pager?.el ?? null, box) && (model.total === null || withinStrip(stripTotal, box));
        for (let i = 0; seen && i < shown; i++) seen = withinStrip(rows[i]!.e, box);
      }
    }
    if (seen) this.#lastRect = r;
    return this.#finish(1, seen);
  }

  destroy(): void {
    this.hide(); this.#sizeObserver?.disconnect(); this.#sizeObserver = undefined;
    this.#pendingFocus = this.#stripParts = this.#floatTitle = this.#floatTitleNode = null;
    this.#floatTitleText = '';
    this.#listening?.clear(); this.#listening = null;
    this.#mores = this.#children = this.#nextRows = this.#shapeWidths = this.#measurer = undefined;
  }
}

export function createTooltip(element: HTMLElement, readoutElement: HTMLElement, figure: HTMLElement, lost: () => void): TooltipView {
  return new DomTooltip(element, readoutElement, figure, lost);
}
