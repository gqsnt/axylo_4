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

type FloatTotal = { row: HTMLElement; name: HTMLElement; value: HTMLElement; label: string; lang: string | null; text: string };
const FLOAT_PINNED = 'axylo-tooltip-pinned', STRIP_PINNED = 'axylo-readout-pinned';
const buttonOf = (e: Event) => (e.target as Element | null)?.closest?.('button.axylo-tooltip-choice');

class DomTooltip implements TooltipView {
  private readonly doc: Document;
  private floatTitle: HTMLElement | null = null;
  private floatTitleNode: Text | null = null;
  private listening: Listeners | null = null;
  private pressRef: DatumRef | null = null;
  private pressPtr = 0;
  private pressListening: Listeners | null = null;
  private pressedRef: DatumRef | null = null;
  private pressedAt = 0;
  private pendingFocus: DatumRef | null = null;
  private where: 0 | 1 | 2 = 0; // Hidden, floating, or strip.
  private wasPinned = false;
  private current: TooltipContent | null = null;
  private displayed = 0;
  private carriedRef: DatumRef | null = null;
  private carriedPtr = 0;
  private hadFocus: DatumRef | null = null;
  private readonly entries: [RowEntry[]?, RowEntry[]?] = [];
  private nextRows: RowEntry[] | undefined;
  private children: Node[] | undefined;
  private mores: (MoreEntry | undefined)[] | undefined;
  private wrapped = false;
  private lastRect: Rect | null = null;
  private maxWidth = -1;
  private maxHeight = -1;
  private transformX = NaN;
  private transformY = NaN;
  private hoverSize: HoverSize | null = null;
  private expectedWidth = 0;
  private shapeWidths: Map<string, number> | undefined;
  private measurer: TextMeasurer | undefined;
  private sizeObserver: ResizeObserver | undefined;
  private observing = false;
  private floatTitleText = '';
  private floatTotal: FloatTotal | null = null;
  private stripParts: { title: HTMLElement; total: HTMLElement; moreSep: Text; totalSep: Text } | null = null;

  constructor(
    private readonly element: HTMLElement,
    private readonly readoutElement: HTMLElement,
    private readonly figure: HTMLElement,
    private readonly lost: () => void,
  ) {
    this.doc = element.ownerDocument;
  }

  get visible(): boolean { return this.where !== 0; }
  rect(): Rect | null { return this.lastRect; }
  contains(node: Node | null): boolean {
    return node !== null && (this.element.contains(node) || this.readoutElement.contains(node));
  }

  private txt(s = ''): Text { return this.doc.createTextNode(s); }
  private active(): Element | null { return activeElementOf(this.doc, this.figure); }

  private listenChoices(): void {
    if (this.listening) return;
    const l = this.listening = new Listeners(), choice = this.onChoice.bind(this);
    for (const host of [this.element, this.readoutElement]) {
      l.on(host, 'mousedown', choice);
      l.on(host, 'pointerdown', choice);
      l.on(host, 'pointerup', choice);
      l.on(host, 'pointercancel', choice);
      l.on(host, 'click', choice);
    }
  }

  private onChoice(event: MouseEvent): void {
    const rows = this.entries[event.currentTarget === this.readoutElement ? 1 : 0];
    if (event.type === 'mousedown') {
      if (buttonOf(event)) keepFocusOnPress(event);
    } else if (event.type === 'pointerdown') {
      const button = buttonOf(event), row = button && rows?.find(entry => entry.e === button);
      if (row) this.startPress(row.ref, (event as PointerEvent).pointerId); else this.clearPress();
    } else if (event.type === 'pointerup') {
      const ref = this.pressRef;
      if (ref === null || this.pressPtr !== (event as PointerEvent).pointerId) return;
      this.clearPress();
      this.pressedRef = ref; this.pressedAt = event.timeStamp;
      const row = rows?.find(entry => entry.button && sameRow(entry.ref, ref));
      if (row) this.current?.select?.(row.r);
    } else if (event.type === 'pointercancel') {
      this.cancelPointer(event);
    } else if (event.type === 'click') {
      const button = buttonOf(event);
      if (!button) return;
      const row = rows?.find(entry => entry.e === button);
      if (!row) this.current?.more?.(this.displayed);
      else if (!(event.detail > 0 && sameRow(row.ref, this.pressedRef) && event.timeStamp - this.pressedAt < 1000)) this.current?.select?.(row.r);
    }
  }

  private clearPress(): void { this.pressRef = null; this.pressListening?.clear(); this.pressListening = null; }

  private cancelPointer(e: Event): void { if (this.pressRef !== null && this.pressPtr === (e as PointerEvent).pointerId) this.clearPress(); }

  private startPress(ref: DatumRef, ptr: number): void {
    this.clearPress();
    this.pressRef = ref; this.pressPtr = ptr;
    const l = this.pressListening = new Listeners(), roots = shadowRootsOf(this.element);
    const cancel = this.cancelPointer.bind(this);
    listenOutside(this.doc, roots, 'pointerup', [this.element, this.readoutElement], cancel, l);
    for (const t of [this.doc, ...roots]) l.on(t, 'pointercancel', cancel, true);
  }

  private makeBox(cls: string, button: boolean, isStrip: boolean): HTMLElement {
    const el = this.doc.createElement(button ? 'button' : isStrip ? 'span' : 'div');
    el.className = button ? `${cls} axylo-tooltip-choice` : cls;
    if (button) { (el as HTMLButtonElement).type = 'button'; el.tabIndex = -1; }
    return el;
  }

  private syncRow(entry: RowEntry, content: TooltipContent, row: DatumText): void {
    entry.r = row;
    entry.ref = row.ref;
    const spec = content.swatch(row);
    if (entry.p !== spec) {
      entry.n.firstElementChild?.remove();
      if (spec) entry.n.insertBefore(createSwatch(this.doc, spec), entry.label);
      entry.p = spec;
    }
    if (entry.l !== row.seriesLabel) entry.label.textContent = entry.l = row.seriesLabel;
    const value = row.percent === null || row.percent === row.value ? row.value : `${row.value} (${row.percent})`;
    if (entry.value !== value) entry.t.textContent = entry.value = value;
    const lang = content.valueLang?.(row.value) ?? null;
    if (entry.g !== lang) { setAttr(entry.v, 'lang', lang); entry.g = lang; }
  }

  private rowEntries(idx: 0 | 1, content: TooltipContent, pinned: boolean): RowEntry[] {
    const previous = this.entries[idx], isStrip = idx === 1;
    const button = pinned && content.select !== undefined;
    if (!isStrip && !pinned && previous?.length === 1 && content.model.rows.length === 1) {
      const entry = previous[0]!, row = content.model.rows[0]!;
      if (!entry.button && sameRow(row.ref, entry.ref)) {
        this.syncRow(entry, content, row);
        return previous;
      }
    }
    const out = this.nextRows ?? [];
    for (const r of content.model.rows) {
      let entry: RowEntry | undefined = previous?.[out.length];
      if (!entry || entry.button !== button || !sameRow(r.ref, entry.ref)) {
        entry = previous?.find(e => e.button === button && sameRow(r.ref, e.ref));
      }
      if (!entry) {
        const e = this.makeBox(isStrip ? 'axylo-readout-entry' : 'axylo-tooltip-row', button, isStrip);
        const n = make(this.doc, 'span', 'axylo-tooltip-series'), v = make(this.doc, 'span', 'axylo-tooltip-value'), t = this.txt();
        const label = this.txt(r.seriesLabel);
        n.appendChild(label); v.appendChild(t);
        if (isStrip) e.append(n, this.txt(' '), v); else e.append(n, v);
        entry = { button, e, n, v, t, label, s: isStrip ? this.txt('; ') : null,
          r, ref: r.ref, p: null, l: r.seriesLabel, g: null, value: '' };
      }
      this.syncRow(entry, content, r);
      out.push(entry);
    }
    this.entries[idx] = out;
    this.nextRows = previous;
    if (previous) previous.length = 0;
    return out;
  }

  private focusedRef(idx: 0 | 1): DatumRef | null {
    const rows = this.entries[idx];
    if (!rows?.length) return null;
    const act = this.active();
    return rows.find(e => e.button && e.e === act)?.ref ?? null;
  }

  private moreEntry(isStrip: boolean, pinned: boolean, content: TooltipContent, count: number): MoreEntry {
    const btn = pinned && content.more !== undefined, index = (isStrip ? 2 : 0) + (btn ? 1 : 0);
    const mores = this.mores ??= [];
    const entry = mores[index] ??= { el: this.makeBox('axylo-tooltip-more', btn, isStrip), text: '', lang: null };
    const text = content.moreRows(count), lang = content.moreLang || null;
    if (entry.text !== text) setText(entry.el, entry.text = text);
    if (entry.lang !== lang) setAttr(entry.el, 'lang', entry.lang = lang);
    return entry;
  }

  private observeSize(): void {
    if (this.observing) return;
    const Observer = (this.doc.defaultView as (Window & typeof globalThis) | null)?.ResizeObserver;
    if (!Observer) return;
    this.sizeObserver ??= new Observer(records => {
      const size = records[0]?.borderBoxSize?.[0];
      if (this.hoverSize && (!size || Math.abs(size.inlineSize - this.expectedWidth) > 1 ||
          Math.abs(size.blockSize - this.hoverSize.height) > 1)) this.hoverSize = null;
    });
    this.sizeObserver.observe(this.element, { box: 'border-box' });
    this.observing = true;
  }

  private shapeWidth(text: string, entry: HoverText): number {
    if (sameShape(text, entry.text)) return entry.width;
    const widths = this.shapeWidths ??= new Map();
    const shape = digitShape(text), key = entry.key + shape;
    let width = widths.get(key);
    if (width === undefined) {
      width = this.measurer!.width(shape, entry.style);
      if (widths.size >= 128) widths.clear();
      widths.set(key, width);
    }
    entry.text = text;
    return entry.width = width;
  }

  private hoverText(element: HTMLElement, key: string, text: string): HoverText {
    const entry = { style: readTextStyle(element), key, text: '', width: 0 };
    this.shapeWidth(text, entry);
    return entry;
  }

  // The first DOM measurement calibrates the canvas estimate for the same tooltip chrome.
  private calibrate(rows: readonly RowEntry[], more: MoreEntry | null, total: FloatTotal | null, width: number, height: number): HoverSize | null {
    const win = this.doc.defaultView;
    if (typeof win?.getComputedStyle !== 'function') return null;
    const measure = this.measurer ??= createMeasurer(this.doc);
    if (!hasCanvas(this.doc, measure)) return null;
    this.shapeWidths?.clear();
    const title = this.hoverText(this.floatTitle!, 't:', this.floatTitleText);
    const moreWidth = more ? measure.width(more.text, readTextStyle(more.el)) : 0;
    const rowGap = (node: Element) => parseFloat(win.getComputedStyle(node).columnGap) || 0;
    let natural = Math.max(moreWidth, title.width);
    const measured = rows.map((entry, index) => {
      const swatch = entry.n.firstElementChild;
      const swatchWidth = swatch ? (parseFloat(win.getComputedStyle(swatch).width) || 20) + rowGap(entry.n) : 0;
      const fixed = measure.width(entry.l ?? '', readTextStyle(entry.n)) + swatchWidth + rowGap(entry.e);
      const text = this.hoverText(entry.v, `${index}:`, entry.value);
      natural = Math.max(natural, fixed + text.width);
      return { ...text, element: entry.e, label: entry.l, swatch: entry.p, lang: entry.g, fixed };
    });
    let measuredTotal: HoverRow | null = null;
    if (total) {
      const text = this.hoverText(total.value, 's:', total.text);
      const fixed = measure.width(total.label, readTextStyle(total.name)) + rowGap(total.row);
      natural = Math.max(natural, fixed + text.width);
      measuredTotal = { ...text, element: total.row, label: total.label, swatch: null, lang: total.lang, fixed };
    }
    return { title, rows: measured, more: more?.text ?? null, moreLang: more?.lang ?? null, moreWidth,
      total: measuredTotal, correction: width - natural, width, height };
  }

  private predictedWidth(size: HoverSize, rows: readonly RowEntry[], more: MoreEntry | null, total: FloatTotal | null): number {
    if (size.rows.length !== rows.length || size.more !== (more?.text ?? null) || size.moreLang !== (more?.lang ?? null) ||
        size.total?.label !== total?.label || size.total?.lang !== total?.lang) return NaN;
    let natural = Math.max(size.moreWidth, this.shapeWidth(this.floatTitleText, size.title));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!, calibrated = size.rows[i]!;
      if (row.e !== calibrated.element || row.l !== calibrated.label || row.p !== calibrated.swatch || row.g !== calibrated.lang) return NaN;
      natural = Math.max(natural, calibrated.fixed + this.shapeWidth(row.value, calibrated));
    }
    if (total && size.total) natural = Math.max(natural, size.total.fixed + this.shapeWidth(total.text, size.total));
    return natural + size.correction;
  }

  private hideIdx(idx: 0 | 1): void {
    const host = idx === 0 ? this.element : this.readoutElement;
    if (idx === 0) {
      this.hoverSize = null;
      if (this.observing) { this.sizeObserver!.unobserve(this.element); this.observing = false; }
    }
    if (this.where === idx + 1) this.lastRect = null;
    if (host.hidden && !host.firstChild) return;
    const ref = this.focusedRef(idx);
    if (ref !== null) {
      this.pendingFocus = ref;
      queueMicrotask(() => {
        if (this.pendingFocus === null) return;
        this.pendingFocus = null;
        const act = this.active();
        if (!this.element.contains(act) && !this.readoutElement.contains(act)) this.lost();
      });
    }
    this.clearPress();
    host.hidden = true;
    host.classList.remove(idx === 0 ? FLOAT_PINNED : STRIP_PINNED);
    setAttr(host, 'aria-hidden', 'true');
    host.replaceChildren();
    const rows = this.entries[idx];
    if (rows) rows.length = 0;
    if (this.mores) this.mores[idx * 2] = this.mores[idx * 2 + 1] = undefined;
    if (idx === 0) this.floatTotal = null;
  }

  private begin(idx: 0 | 1, content: TooltipContent, pinned: boolean): void {
    this.current = content;
    this.carriedRef = pinned ? this.pressRef : null; this.carriedPtr = this.pressPtr;
    if (pinned) this.listenChoices(); else this.clearPress();
    this.hadFocus = (this.wasPinned && this.where ? this.focusedRef((this.where - 1) as 0 | 1) : null) ?? this.pendingFocus;
    this.pendingFocus = null;
    this.hideIdx(idx ? 0 : 1);
    const host = idx === 0 ? this.element : this.readoutElement;
    if (this.where !== idx + 1 || pinned !== this.wasPinned || host.hidden) {
      if (host.hidden) host.hidden = false;
      if (pinned || (this.where === idx + 1 && this.wasPinned)) host.classList.toggle(idx === 0 ? FLOAT_PINNED : STRIP_PINNED, pinned);
      setAttr(host, 'aria-hidden', pinned ? null : 'true');
    }
    this.wasPinned = pinned;
  }

  private finish(idx: 0 | 1, visible: boolean): boolean {
    if (visible) {
      this.where = (idx + 1) as 1 | 2;
      if (this.carriedRef !== null && this.pressRef === null) this.startPress(this.carriedRef, this.carriedPtr);
      if (this.hadFocus !== null) {
        const entry = this.entries[idx]?.find(e => e.button && sameRow(e.ref, this.hadFocus));
        if (!entry?.e.isConnected) this.lost();
        else if (this.active() !== entry.e) entry.e.focus({ preventScroll: true });
      }
    } else {
      this.hideIdx(idx);
      this.where = 0; this.lastRect = null;
      if (this.hadFocus !== null) this.lost();
    }
    this.carriedRef = this.hadFocus = null;
    return visible;
  }

  private positionFloat(spot: Spot, width: number, height: number, m: Mapping): void {
    const x = (spot.x - m.left) / m.kx, y = (spot.y - m.top) / m.ky;
    if (x !== this.transformX || y !== this.transformY) {
      this.element.style.transform = `translate(${x}px, ${y}px)`;
      this.transformX = x; this.transformY = y;
    }
    if (!this.lastRect || this.lastRect.x !== spot.x || this.lastRect.y !== spot.y || this.lastRect.width !== width || this.lastRect.height !== height) {
      this.lastRect = { x: spot.x, y: spot.y, width, height };
    }
  }

  hide(): void {
    this.clearPress(); this.hideIdx(0); this.hideIdx(1);
    this.where = this.displayed = 0;
    if (this.children) this.children.length = 0;
    if (this.nextRows) this.nextRows.length = 0;
    this.pressedRef = this.carriedRef = this.hadFocus = this.current = this.lastRect = null;
  }

  invalidateSize(): void { this.hoverSize = null; }

  private floatingTitle(): HTMLElement {
    const title = make(this.doc, 'div', 'axylo-tooltip-title');
    // Width prediction assumes the same width for every digit in the heading.
    title.style.fontVariantNumeric = 'tabular-nums';
    title.appendChild(this.floatTitleNode = this.txt());
    return title;
  }

  private overflows(): boolean {
    const el = this.element;
    return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
  }

  show(content: TooltipContent, p: PlacementInput, pinned: boolean, figMapping?: Mapping): boolean {
    const m = figMapping ?? mappingOf(this.figure);
    const maxW = Math.max(0, Math.min(320, p.visible.width / m.kx)), maxH = Math.max(0, p.visible.height / m.ky);
    const steady = this.where === 1 && !pinned && !this.wasPinned && !this.element.hidden;
    if (steady) this.current = content; else this.begin(0, content, pinned);
    if (this.maxWidth !== maxW || this.maxHeight !== maxH || pinned || this.wrapped || this.where !== 1) this.hoverSize = null;
    if (this.maxWidth !== maxW) { this.maxWidth = maxW; this.element.style.maxWidth = `${maxW}px`; }
    if (this.maxHeight !== maxH) { this.maxHeight = maxH; this.element.style.maxHeight = `${maxH}px`; }
    const rows = this.rowEntries(0, content, pinned), { model } = content, total = rows.length;
    if (this.wrapped) { this.element.classList.remove('axylo-tooltip-wrap'); this.wrapped = false; }
    const title = this.floatTitle ??= this.floatingTitle();
    if (this.floatTitleText !== model.title) this.floatTitleNode!.textContent = this.floatTitleText = model.title;
    if (model.total !== null) {
      if (!this.floatTotal) {
        const row = make(this.doc, 'div', 'axylo-tooltip-row axylo-tooltip-total');
        const name = make(this.doc, 'span', 'axylo-tooltip-series'), value = make(this.doc, 'span', 'axylo-tooltip-value');
        row.append(name, value);
        this.floatTotal = { row, name, value, label: '', lang: null, text: '' };
      }
      const label = content.totalLabel ?? '', lang = content.totalLang || null;
      if (this.floatTotal.label !== label) setText(this.floatTotal.name, this.floatTotal.label = label);
      if (this.floatTotal.lang !== lang) setAttr(this.floatTotal.name, 'lang', this.floatTotal.lang = lang);
      if (this.floatTotal.text !== model.total) setText(this.floatTotal.value, this.floatTotal.text = model.total);
    }
    const totalRow = model.total === null ? null : this.floatTotal;
    if (this.hoverSize) {
      const more = model.count > total ? this.moreEntry(false, pinned, content, model.count - total) : null;
      const size = this.hoverSize;
      const width = this.predictedWidth(size, rows, more, totalRow), { height } = size;
      if (width > 0 && width < maxW - 8 && height < maxH - 8) {
        // Allow for fractional DOM rounding when an estimated box meets an obstacle or edge.
        const pad = Math.abs(width - size.width) > 0.01 ? 1 : 0;
        const spot = placeTooltip(p, (width + pad) * m.kx, height * m.ky);
        if (spot) {
          this.expectedWidth = width;
          this.positionFloat(spot, width * m.kx, height * m.ky, m);
          return steady || this.finish(0, true);
        }
      }
      this.hoverSize = null;
    }
    const children = this.children ??= [];
    for (let shown = total; shown >= Math.min(1, total); shown--) {
      children.push(title);
      for (let i = 0; i < shown; i++) children.push(rows[i]!.e);
      this.displayed = shown;
      const more = model.count > shown ? this.moreEntry(false, pinned, content, model.count - shown) : null;
      if (more) children.push(more.el);
      if (totalRow) children.push(totalRow.row);
      placeChildren(this.element, children);
      children.length = 0;
      let size = this.element.getBoundingClientRect();
      if (size.width >= (maxW - 2) * m.kx || size.height >= (maxH - 2) * m.ky) {
        let over = this.overflows();
        if (over && !this.wrapped) {
          this.element.classList.add('axylo-tooltip-wrap'); this.wrapped = true;
          over = this.overflows();
          // Wrapping changes the rendered box and must be measured before placement.
          if (!over || shown <= 1) size = this.element.getBoundingClientRect();
        }
        if (over && shown > 1) continue;
      }
      const { width, height } = size;
      let spot = placeTooltip(p, width, height);
      if (!spot && shown <= 1 && width > 0) spot = fallbackPlacement(p, width, height);
      if (spot) {
        const localW = width / m.kx, localH = height / m.ky;
        if (!pinned && !this.wrapped && shown === total && localW > 0 && localW < maxW - 8 && localH < maxH - 8) {
          this.hoverSize = this.calibrate(rows, more, totalRow, localW, localH);
          this.expectedWidth = localW;
        }
        this.positionFloat(spot, width, height, m);
        this.observeSize();
        return this.finish(0, true);
      }
    }
    return this.finish(0, false);
  }

  strip(content: TooltipContent, pinned: boolean, visible: Rect): boolean {
    this.begin(1, content, pinned);
    const { title: stripTitle, total: stripTotal, moreSep, totalSep } = this.stripParts ??= {
      title: make(this.doc, 'span', 'axylo-tooltip-title'), total: make(this.doc, 'span', 'axylo-readout-total'),
      moreSep: this.txt('; '), totalSep: this.txt('; '),
    };
    const { model } = content, rows = this.rowEntries(1, content, pinned);
    setText(stripTitle, `${model.title}: `);
    if (model.total !== null) { setText(stripTotal, `${content.totalLabel ?? ''} ${model.total}`); setAttr(stripTotal, 'lang', content.totalLang || null); }
    const r = this.readoutElement.getBoundingClientRect(), box = intersect(r, visible), bx2 = box.x + box.width, by2 = box.y + box.height;
    const within = (el: Element | null) => {
      if (!el?.isConnected) return true;
      const rects = el.getClientRects();
      for (const q of rects) if (q.left < box.x - 0.5 || q.top < box.y - 0.5 || q.right > bx2 + 0.5 || q.bottom > by2 + 0.5) return false;
      return rects.length > 0;
    };
    const cl = this.readoutElement.classList, minS = Math.min(1, rows.length);
    const parts = this.children ??= [];
    cl.remove('axylo-readout-wrap', 'axylo-readout-cut');
    let seen = false;
    for (let pass = 0; pass < 3 && !seen; pass++) {
      if (pass === 1) cl.add('axylo-readout-wrap');
      if (pass === 2) cl.replace('axylo-readout-wrap', 'axylo-readout-cut');
      for (let shown = pass === 2 ? minS : rows.length; shown >= minS && !seen; shown--) {
        parts.push(stripTitle);
        this.displayed = shown;
        for (let i = 0; i < shown; i++) { if (i && rows[i]!.s) parts.push(rows[i]!.s!); parts.push(rows[i]!.e); }
        if (model.total !== null) parts.push(totalSep, stripTotal);
        let pager: HTMLElement | null = null;
        if (model.count > shown) { if (shown) parts.push(moreSep); parts.push(pager = this.moreEntry(true, pinned, content, model.count - shown).el); }
        placeChildren(this.readoutElement, parts);
        parts.length = 0;
        seen = within(stripTitle) && within(pager);
        for (let i = 0; seen && i < shown; i++) seen = within(rows[i]!.e);
      }
    }
    if (seen) this.lastRect = r;
    return this.finish(1, seen);
  }

  destroy(): void {
    this.hide(); this.sizeObserver?.disconnect(); this.sizeObserver = undefined;
    this.pendingFocus = this.stripParts = this.floatTitle = this.floatTitleNode = null;
    this.floatTitleText = '';
    this.listening?.clear(); this.listening = null;
    this.mores = this.children = this.nextRows = this.shapeWidths = this.measurer = undefined;
  }
}

export function createTooltip(element: HTMLElement, readoutElement: HTMLElement, figure: HTMLElement, lost: () => void): TooltipView {
  return new DomTooltip(element, readoutElement, figure, lost);
}
