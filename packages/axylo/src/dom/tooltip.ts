/**
 * Renders a tooltip model as text (spec I1, DX8: textContent only), in one of two presentations decided by
 * the controller's layout (decision 0004 revision 3, rule 5): floating, placed by `placement.ts`, or as
 * running text in the strip reserved under the plot.
 *
 * - A hovered tooltip is text, takes no pointer events and is hidden from assistive technology: the plot's
 *   keyboard proxy carries the same reading, so nothing is said twice and nothing here is a live region (A7).
 * - A pinned tooltip or strip takes events and is exposed (rule 9): its rows are buttons named by their text,
 *   at least 24 × 24 CSS px, outside the tab order (the closed chart keeps its two tab stops; the keyboard
 *   reaches the same series through the plot's own Up and Down). Its "+N more" is a button too, showing the
 *   next rows, so every row can be chosen by pointer.
 * - Rows keep their element across redraws while their identity (series, datum) is unchanged, and nodes
 *   are only moved when their order changes, so a press that spans a data update still completes.
 * - Floating: rows are dropped from the end into "+N more" until a candidate is valid (rule 6); the tooltip
 *   is never larger than the visible part of the plot; with one row and still nothing valid, the last resort
 *   of rule 6 is used, and when even that would cover a control or a focus ring nothing floats.
 * - Strip: at least the x and one row are always shown.
 */
import { activeElementOf, placeChildren, setAttr, setText, make, keepFocusOnPress, shadowRootsOf } from './attributes';
import type { DatumText, Rect, TooltipModel } from '../core/contracts';
import { createSwatch, type SwatchSpec } from './swatch';
import { fallbackPlacement, placeTooltip, type PlacementInput } from './placement';
import { sameKey } from '../core/axes';
import { Listeners, listenOutside, mappingOf, type Mapping } from './mapping';

export interface TooltipContent {
  readonly model: TooltipModel;
  readonly swatch: (row: DatumText) => SwatchSpec | null;
  readonly moreRows: (count: number) => string;
  /** Label of the stack total row (the `total` message). */
  readonly totalLabel?: string;
  /** `lang` for the built-in "+N more" and total label, or null. */
  readonly moreLang?: string | null;
  readonly totalLang?: string | null;
  /** A row of a pinned tooltip was chosen (a click or a tap on it). */
  readonly select?: (row: DatumText) => void;
  /** `lang` of a row's value text (a built-in "No data" on a page in another language), or null. */
  readonly valueLang?: (text: string) => string | null;
  /** The pinned "+N more" was chosen: show the rows after the `shown` ones on show now. */
  readonly more?: (shown: number) => void;
}

export type Presentation = 'floating' | 'strip';

export interface TooltipView {
  /**
   * Floating, placed by rules 2 and 6 against `placement` (viewport pixels). `pinned`: it takes events and
   * its rows are buttons. Returns false when nothing could be placed (nothing is shown then).
   */
  show(content: TooltipContent, placement: PlacementInput, pinned: boolean, figureMapping?: Mapping): boolean;
  /**
   * Readout mode: the content as running text in the strip under the plot, at most two lines. Returns false
   * when nothing of the strip can be seen (`visible`, viewport pixels: what its clipping ancestors leave).
   */
  strip(content: TooltipContent, pinned: boolean, visible: Rect): boolean;
  hide(): void;
  readonly visible: boolean;
  /** The content's rectangle in viewport pixels (the floating tooltip or the strip), or null. */
  rect(): Rect | null;
  /** Whether a node belongs to the shown content. */
  contains(node: Node | null): boolean;
  destroy(): void;
}

interface RowEntry {
  readonly key: string;
  readonly element: HTMLElement;
  readonly name: HTMLElement;
  readonly value: HTMLElement;
  readonly valueNode: Text;
  /** The strip's "; " before the entry. */
  readonly separator: Text | null;
  row: DatumText;
  spec: SwatchSpec | null;
  label: string | null;
  valueLang: string | null;
}

/**
 * A row's identity across redraws, from its datum, never its formatted text (review: a reformatted x title
 * replaced a pressed button): an aligned row by its series (every row of one tooltip shares its x), a point by
 * its series and source row, a slice by its key.
 */
function rowKey(r: DatumText): string {
  const ref = r.ref;
  switch (ref.kind) {
    case 'aligned': return `a\u0000${ref.seriesKey}`;
    case 'point': return `p\u0000${ref.seriesKey}\u0000${ref.row}`;
    case 'slice': return `s\u0000${ref.sliceKey}`;
  }
}

const place = placeChildren;
const setLang = (el: HTMLElement, lang: string | null | undefined): void => setAttr(el, 'lang', lang || null);

/**
 * `lost`: a row that had focus went with a redraw and has no counterpart in the new presentation; the caller
 * puts focus back in the chart.
 */
export function createTooltip(element: HTMLElement, readoutElement: HTMLElement, figure: HTMLElement, lost: () => void): TooltipView {
  const doc = element.ownerDocument;
  /**
   * A press on a row, by the row's identity: it completes against that row in whatever presentation shows it
   * at release, wherever a redraw moved or replaced its element meanwhile (review R1, final check 3).
   */
  let press: { key: string; pointer: number } | null = null;
  /** Document/shadow listeners watching for release/cancel outside the tooltip while a press is active. */
  let pressListening: Listeners | null = null;
  /** The pointer click that follows a completed press, on that row, is not a second choice. */
  let pressed: { key: string; at: number } | null = null;
  /** A row that had focus when its presentation was hidden: the next presentation focuses it again. */
  let pendingFocus: string | null = null;
  let where: Presentation | null = null;
  /** The content on show: row buttons read it when chosen, so a redraw never strands a pressed button. */
  let current: TooltipContent | null = null;
  /** How many rows the content on show lists (the rest are in "+N more"). */
  let displayed = 0;

  function clearPress(): void {
    press = null;
    pressListening?.clear();
    pressListening = null;
  }

  function cancelPointer(event: Event): void {
    if (press && press.pointer === (event as PointerEvent).pointerId) clearPress();
  }

  function startPress(key: string, pointer: number): void {
    clearPress();
    press = { key, pointer };
    const listeners = pressListening = new Listeners();
    const roots = shadowRootsOf(element);
    listenOutside(doc, roots, 'pointerup', [element, readoutElement], cancelPointer, listeners);
    for (const target of [doc, ...roots]) listeners.on(target, 'pointercancel', cancelPointer, true);
  }

  /** One set of row elements per presentation, keyed by row identity and by being buttons or text. */
  const entries = { floating: new Map<string, RowEntry>(), strip: new Map<string, RowEntry>() };
  const listening = new Listeners();
  const mores = new Map<string, HTMLElement>();
  let wrapped = false;
  let lastSize: { width: number; height: number } | null = null;
  let constraints: readonly unknown[] | null = null;
  let lastRect: Rect | null = null;
  let lastFloatOrder: readonly Node[] | null = null;

  // Delegate to the persistent hosts so a removed row or page button has no listeners to release.
  const choices = new WeakMap<Element, RowEntry>();
  for (const host of [element, readoutElement]) {
    const buttonOf = (event: Event) => (event.target as Element | null)?.closest?.('button.axylo-tooltip-choice');
    listening.on(host, 'mousedown', event => { if (buttonOf(event)) keepFocusOnPress(event); });
    listening.on(host, 'pointerdown', event => {
      const button = buttonOf(event);
      const row = button && choices.get(button);
      if (row) startPress(row.key, event.pointerId);
      else clearPress();
    });
    listening.on(host, 'pointerup', releasing);
    listening.on(host, 'pointercancel', cancelPointer);
    listening.on(host, 'click', event => {
      const button = buttonOf(event);
      if (!button) return;
      const row = choices.get(button);
      if (!row) current?.more?.(displayed);
      else if (!(event.detail > 0 && pressed?.key === row.key && event.timeStamp - pressed.at < 1000)) current?.select?.(row.row);
    });
  }

  function choice(button: HTMLButtonElement): void {
    button.type = 'button';
    button.tabIndex = -1;
    button.classList.add('axylo-tooltip-choice');
  }

  const floatTitle = make(doc, 'div', 'axylo-tooltip-title');
  const floatTitleNode = doc.createTextNode('');
  floatTitle.appendChild(floatTitleNode);
  const floatTotal = make(doc, 'div', 'axylo-tooltip-row axylo-tooltip-total');
  const floatTotalName = make(doc, 'span', 'axylo-tooltip-series');
  const floatTotalValue = make(doc, 'span', 'axylo-tooltip-value');
  floatTotal.append(floatTotalName, floatTotalValue);

  const stripTitle = make(doc, 'span', 'axylo-tooltip-title');
  const stripTotal = make(doc, 'span', 'axylo-readout-total');
  const moreSeparator = doc.createTextNode('; ');
  const totalSeparator = doc.createTextNode('; ');

  function makeEntry(r: DatumText, pinned: boolean, strip: boolean, key: string): RowEntry {
    const button = pinned && current?.select !== undefined;
    const element = doc.createElement(button ? 'button' : strip ? 'span' : 'div');
    element.className = strip ? 'axylo-readout-entry' : 'axylo-tooltip-row';
    const value = doc.createElement('span');
    const valueNode = doc.createTextNode('');
    value.appendChild(valueNode);
    const entry: RowEntry = {
      key, element, name: doc.createElement('span'), value, valueNode,
      separator: strip ? doc.createTextNode('; ') : null, row: r, spec: null, label: null, valueLang: null,
    };
    if (button) {
      choice(element as HTMLButtonElement);
      choices.set(element, entry);
    }
    entry.name.className = 'axylo-tooltip-series';
    entry.value.className = 'axylo-tooltip-value';
    // As running text in the strip, the name and the value are words of one sentence.
    if (strip) element.append(entry.name, doc.createTextNode(' '), entry.value);
    else element.append(entry.name, entry.value);
    return entry;
  }

  function updateEntry(entry: RowEntry, r: DatumText, content: TooltipContent): void {
    entry.row = r;
    const spec = content.swatch(r);
    if (entry.label !== r.seriesLabel || entry.spec !== spec) {
      entry.name.replaceChildren(...(spec ? [createSwatch(doc, spec)] : []), doc.createTextNode(r.seriesLabel));
      entry.label = r.seriesLabel;
      lastSize = null;
      entry.spec = spec;
    }
    const text = r.percent === null || r.percent === r.value ? r.value : `${r.value} (${r.percent})`;
    updateText(entry.valueNode, text);
    const lang = content.valueLang?.(r.value) ?? null;
    if (entry.valueLang !== lang) {
      setLang(entry.value, lang);
      entry.valueLang = lang;
      lastSize = null;
    }
  }

  /** The row entries for `rows`, reused by identity; entries of rows no longer in the model are dropped. */
  function rowEntries(presentation: Presentation, content: TooltipContent, pinned: boolean): RowEntry[] {
    const map = entries[presentation];
    const strip = presentation === 'strip';
    const keep = new Set<string>();
    const out: RowEntry[] = [];
    for (const r of content.model.rows) {
      const key = `${pinned && content.select ? 'b' : 't'}\u0000${rowKey(r)}`;
      keep.add(key);
      let entry = map.get(key);
      if (!entry) {
        entry = makeEntry(r, pinned, strip, key);
        map.set(key, entry);
        lastSize = null;
      }
      updateEntry(entry, r, content);
      out.push(entry);
    }
    for (const key of map.keys()) {
      if (keep.has(key)) continue;
      map.delete(key);
      lastSize = null;
    }
    return out;
  }

  /** The key of the row that has focus in `presentation`, if one has. */
  function focusedKey(presentation: Presentation): string | null {
    const map = entries[presentation];
    if (!map.size) return null;
    const active = activeElementOf(doc, figure);
    for (const [key, entry] of map) if (entry.element === active) return key;
    return null;
  }

  /** Focus that was on a row of the presentation just left goes to the same row in the new one (review finding 9). */
  function carryFocus(key: string | null, to: Presentation): void {
    if (key === null) return;
    const entry = entries[to].get(key);
    if (entry?.element.isConnected) entry.element.focus({ preventScroll: true });
    else lost();
  }

  // Completes a press on the row it began on, wherever the pointer is released inside the content.
  function releasing(event: PointerEvent): void {
    if (!press || press.pointer !== event.pointerId) return;
    const was = press;
    clearPress();
    pressed = { key: was.key, at: event.timeStamp };
    // The row as it is now, in the presentation on show: the same series' row of what is pinned now (its x
    // remapped with a sliding category window); a row no longer shown chooses nothing.
    const now = entries.floating.get(was.key) ?? entries.strip.get(was.key);
    if (now) current?.select?.(now.row);
  }

  /** "+N more": text while hovered, a button that shows the next rows while pinned. */
  function moreElement(presentation: Presentation, pinned: boolean, content: TooltipContent, count: number): HTMLElement {
    const button = pinned && current?.more !== undefined;
    const key = `${presentation}\u0000${button}`;
    let el = mores.get(key);
    if (!el) {
      el = doc.createElement(button ? 'button' : presentation === 'strip' ? 'span' : 'div');
      el.className = 'axylo-tooltip-more';
      if (button) choice(el as HTMLButtonElement);
      mores.set(key, el);
    }
    updateText(el, content.moreRows(count));
    updateLang(el, content.moreLang);
    return el;
  }

  function expose(host: HTMLElement, pinned: boolean): void {
    // Pinned content is real (rule 9); hovered content is the proxy's reading again, so it stays hidden.
    setAttr(host, 'aria-hidden', pinned ? null : 'true');
  }

  function updateLang(el: HTMLElement, lang: string | null | undefined): void {
    if (el.getAttribute('lang') === (lang || null)) return;
    setLang(el, lang);
    lastSize = null;
  }

  function updateText(node: Node, text: string): void {
    if (node.textContent === text) return;
    node.textContent = text;
    lastSize = null;
  }

  /** The floating tooltip's content with the first `shown` rows; the rest are counted in "+N more". */
  function fillFloating(content: TooltipContent, rows: readonly RowEntry[], pinned: boolean, shown: number): void {
    const { model } = content;
    updateText(floatTitleNode, model.title);
    const children: Node[] = [floatTitle];
    for (let i = 0; i < shown; i++) children.push(rows[i]!.element);
    displayed = shown;
    const more = model.count - shown;
    if (more > 0) {
      children.push(moreElement('floating', pinned, content, more));
    }
    if (model.total !== null) {
      const label = content.totalLabel ?? '';
      updateText(floatTotalName, label);
      updateLang(floatTotalName, content.totalLang);
      updateText(floatTotalValue, model.total);
      children.push(floatTotal);
    }
    if (!sameKey(lastFloatOrder, children)) {
      place(element, children);
      lastFloatOrder = children;
      lastSize = null;
    }
  }

  /** Remembers a focused row of `presentation` before it goes, for the next show or strip to restore. */
  function keepFocus(presentation: Presentation): void {
    const key = focusedKey(presentation);
    if (key === null) return;
    pendingFocus = key;
    // When nothing is shown again in this task, focus goes back to the chart rather than the page.
    queueMicrotask(() => {
      if (pendingFocus === null) return;
      pendingFocus = null;
      const active = activeElementOf(doc, figure);
      if (!element.contains(active) && !readoutElement.contains(active)) lost();
    });
  }

  const hosts = { floating: element, strip: readoutElement };
  const pinnedClasses = { floating: 'axylo-tooltip-pinned', strip: 'axylo-readout-pinned' };

  function hidePresentation(mode: Presentation): void {
    const host = hosts[mode];
    if (mode === 'floating') {
      lastSize = null;
      lastFloatOrder = null;
    }
    if (where === mode) lastRect = null;
    if (host.hidden && !host.firstChild) return;
    keepFocus(mode);
    clearPress();
    host.hidden = true;
    host.classList.remove(pinnedClasses[mode]);
    expose(host, false);
    place(host, []);
    entries[mode].clear();
  }

  function begin(mode: Presentation, content: TooltipContent, pinned: boolean) {
    current = content;
    const carried = pinned ? press : null;
    if (!pinned) clearPress();
    const other = mode === 'strip' ? 'floating' : 'strip';
    const had = focusedKey(other) ?? focusedKey(mode) ?? pendingFocus;
    pendingFocus = null;
    hidePresentation(other);
    const host = hosts[mode];
    if (host.hidden) host.hidden = false;
    host.classList.toggle(pinnedClasses[mode], pinned);
    expose(host, pinned);

    return (visible: boolean) => {
      if (visible) {
        where = mode;
        if (carried && !press) startPress(carried.key, carried.pointer);
        carryFocus(had, mode);
      } else {
        hidePresentation(mode);
        where = null;
        lastRect = null;
        if (had !== null) lost();
      }
      return visible;
    };
  }

  function hide(): void {
    clearPress();
    hidePresentation('floating');
    hidePresentation('strip');
    where = null;
    lastRect = null;
    current = null;
  }

  return {
    get visible() {
      return where !== null;
    },
    rect: () => lastRect,
    contains(node) {
      return node !== null && (element.contains(node) || readoutElement.contains(node));
    },
    show(content, p, pinned, figMapping) {
      const wasHidden = where !== 'floating' || element.hidden;
      const finish = begin('floating', content, pinned);
      // The tooltip lives in the figure's layout pixels; placement is in viewport pixels.
      const m = figMapping ?? mappingOf(figure);
      // Never larger than the visible part of the plot (rule 6): it wraps within that.
      const maxWidth = `${Math.max(0, Math.min(320, p.visible.width / m.kx))}px`;
      const maxHeight = `${Math.max(0, p.visible.height / m.ky)}px`;
      const inputs = [pinned, maxWidth, maxHeight, figMapping, m.kx, m.ky];
      if (wasHidden || !sameKey(constraints, inputs)) {
        if (element.style.maxWidth !== maxWidth) element.style.maxWidth = maxWidth;
        if (element.style.maxHeight !== maxHeight) element.style.maxHeight = maxHeight;
        constraints = inputs;
        lastSize = null;
      }
      const rows = rowEntries('floating', content, pinned);
      const total = content.model.rows.length;
      // Fast path when content, constraints and scale are unchanged: reuse the last measured size without
      // forcing a synchronous layout read.
      if (wrapped) {
        element.classList.remove('axylo-tooltip-wrap');
        wrapped = false;
      }
      const overflows = () => element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1;
      for (let shown = total; shown >= Math.min(1, total); shown--) {
        fillFloating(content, rows, pinned, shown);
        let size = lastSize;
        if (!size) {
          let over = overflows();
          if (over && !wrapped) {
            element.classList.add('axylo-tooltip-wrap');
            wrapped = true;
            over = overflows();
          }
          if (over && shown > 1) continue;
          size = element.getBoundingClientRect();
          if (shown === total && !wrapped) lastSize = size;
        }
        const { width, height } = size;
        let spot = placeTooltip(p, width, height);
        if (!spot && shown <= 1 && width > 0) spot = fallbackPlacement(p, width, height);
        if (spot) {
          const { x, y } = spot;
          const transform = `translate(${(x - m.left) / m.kx}px, ${(y - m.top) / m.ky}px)`;
          if (element.style.transform !== transform) element.style.transform = transform;
          lastRect = { x, y, width, height };
          return finish(true);
        }
      }
      // Nowhere clear of the controls and focus rings, or not even one row visible: nothing floats (rule 6).
      return finish(false);
    },
    strip(content, pinned, visible) {
      const finish = begin('strip', content, pinned);
      const { model } = content;
      const rows = rowEntries('strip', content, pinned);
      setText(stripTitle, `${model.title}: `);
      // Running text: "x: series value; series value; +N more", within the strip's two lines; at least the
      // x and one row are always shown (rule 5).
      const build = (shown: number): void => {
        const parts: Node[] = [stripTitle];
        displayed = shown;
        rows.slice(0, shown).forEach((entry, i) => {
          if (i > 0 && entry.separator) parts.push(entry.separator);
          parts.push(entry.element);
        });
        if (model.total !== null) {
          setText(stripTotal, `${content.totalLabel ?? ''} ${model.total}`);
          setLang(stripTotal, content.totalLang);
          parts.push(totalSeparator, stripTotal);
        }
        const more = model.count - shown;
        if (more > 0) {
          if (shown > 0) parts.push(moreSeparator);
          parts.push(moreElement('strip', pinned, content, more));
        }
        place(readoutElement, parts);
      };
      // Judged as the floating tooltip is: the title, every row shown and any paging control lie wholly inside
      // the strip's own box and inside what its ancestors leave visible; rows are dropped until they do, or
      // the strip is not shown (review I4, final check 1).
      const r = readoutElement.getBoundingClientRect();
      const box = { x: Math.max(r.x, visible.x), y: Math.max(r.y, visible.y), right: Math.min(r.x + r.width, visible.x + visible.width), bottom: Math.min(r.y + r.height, visible.y + visible.height) };
      const within = (el: Element | undefined) => {
        if (!el?.isConnected) return true;
        const rects = el.getClientRects();
        for (const part of rects) {
          if (part.left < box.x - 0.5 || part.top < box.y - 0.5 || part.right > box.right + 0.5 || part.bottom > box.bottom + 0.5) return false;
        }
        return rects.length > 0;
      };
      let seen = false;
      // Passes: as written; with long values wrapping; then one row cut to one line with an ellipsis. The
      // "+N more" (a control when pinned) is shown whole or the strip is not shown.
      readoutElement.classList.remove('axylo-readout-wrap', 'axylo-readout-cut');
      for (let pass = 0; pass < 3 && !seen; pass++) {
        if (pass === 1) readoutElement.classList.add('axylo-readout-wrap');
        if (pass === 2) readoutElement.classList.replace('axylo-readout-wrap', 'axylo-readout-cut');
        for (let shown = pass === 2 ? Math.min(1, rows.length) : rows.length; shown >= Math.min(1, rows.length) && !seen; shown--) {
          build(shown);
          const pager = mores.get(`strip\u0000${pinned && current?.more !== undefined}`);
          seen = within(stripTitle) && rows.slice(0, shown).every(e => within(e.element)) && (!pager?.isConnected || within(pager));
        }
      }
      if (seen) lastRect = r;
      return finish(seen);
    },
    hide,
    destroy() {
      hide();
      pendingFocus = null;
      listening.clear();
      mores.clear();
    },
  };
}
