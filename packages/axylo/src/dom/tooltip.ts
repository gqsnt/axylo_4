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
import { activeElementOf, listenOutside, placeChildren, setAttr, setText, make, keepFocusOnPress, shadowRootsOf } from './attributes';
import type { DatumText, Rect, TooltipModel } from '../core/contracts';
import { createSwatch, type SwatchSpec } from './swatch';
import { fallbackPlacement, placeTooltip, type PlacementInput } from './placement';
import { mappingOf } from './mapping';

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
  show(content: TooltipContent, placement: PlacementInput, pinned: boolean): boolean;
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
  /** The strip's "; " before the entry. */
  readonly separator: Text | null;
  row: DatumText;
  swatch: string;
  readonly listening: AbortController | null;
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
  let pressListening: AbortController | null = null;
  /** The pointerdown event that started a row press, so the host listener does not clear it as it bubbles. */
  let pressEvent: Event | null = null;
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
    pressListening?.abort();
    pressListening = null;
  }

  function startPress(key: string, pointer: number): void {
    clearPress();
    press = { key, pointer };
    pressListening = new AbortController();
    const signal = pressListening.signal;
    const roots = shadowRootsOf(element);
    listenOutside(doc, roots, 'pointerup', [element, readoutElement], event => {
      if (press && press.pointer === (event as PointerEvent).pointerId) clearPress();
    }, signal);
    const onDocCancel = (event: Event) => {
      if (press && press.pointer === (event as PointerEvent).pointerId) clearPress();
    };
    doc.addEventListener('pointercancel', onDocCancel, { capture: true, signal });
    for (const root of roots) root.addEventListener('pointercancel', onDocCancel, { capture: true, signal });
  }

  /** One set of row elements per presentation, keyed by row identity and by being buttons or text. */
  const entries = { floating: new Map<string, RowEntry>(), strip: new Map<string, RowEntry>() };

  function makeEntry(r: DatumText, pinned: boolean, strip: boolean, key: string): RowEntry {
    const button = pinned && current?.select !== undefined;
    const element = doc.createElement(button ? 'button' : strip ? 'span' : 'div');
    element.className = strip ? 'axylo-readout-entry' : 'axylo-tooltip-row';
    const listening = button ? new AbortController() : null;
    const entry: RowEntry = {
      key, element, name: doc.createElement('span'), value: doc.createElement('span'),
      separator: strip ? doc.createTextNode('; ') : null, row: r, swatch: '', listening,
    };
    if (button && listening) {
      const btn = element as HTMLButtonElement;
      btn.type = 'button';
      btn.tabIndex = -1;
      btn.classList.add('axylo-tooltip-choice');
      // A press does not take focus from the plot, whose keyboard reading goes on from the chosen datum.
      btn.addEventListener('mousedown', keepFocusOnPress, { signal: listening.signal });
      btn.addEventListener('pointerdown', event => {
        pressEvent = event;
        startPress(key, event.pointerId);
      }, { signal: listening.signal });
      // A click without a press of its own (Enter, Space, an assistive action: detail 0) chooses this row; the
      // pointer click that follows a completed press does not choose again (review R1).
      btn.addEventListener('click', event => {
        if (event.detail > 0 && pressed?.key === key && event.timeStamp - pressed.at < 1000) return;
        current?.select?.(entry.row);
      }, { signal: listening.signal });
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
    const signature = JSON.stringify(spec);
    if (signature !== entry.swatch || entry.name.lastChild?.textContent !== r.seriesLabel) {
      entry.name.replaceChildren(...(spec ? [createSwatch(doc, spec)] : []), doc.createTextNode(r.seriesLabel));
      entry.swatch = signature;
    }
    setText(entry.value, r.percent === null || r.percent === r.value ? r.value : `${r.value} (${r.percent})`);
    setLang(entry.value, content.valueLang?.(r.value));
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
      }
      updateEntry(entry, r, content);
      out.push(entry);
    }
    for (const [key, entry] of map) {
      if (keep.has(key)) continue;
      entry.listening?.abort();
      map.delete(key);
    }
    return out;
  }

  /** The key of the row that has focus in `presentation`, if one has. */
  function focusedKey(presentation: Presentation): string | null {
    const active = activeElementOf(doc, figure);
    for (const [key, entry] of entries[presentation]) if (entry.element === active) return key;
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
  const releasing = (event: PointerEvent) => {
    if (!press || press.pointer !== event.pointerId) return;
    const was = press;
    clearPress();
    pressed = { key: was.key, at: event.timeStamp };
    // The row as it is now, in the presentation on show: the same series' row of what is pinned now (its x
    // remapped with a sliding category window); a row no longer shown chooses nothing.
    const now = entries.floating.get(was.key) ?? entries.strip.get(was.key);
    if (now) current?.select?.(now.row);
  };

  function dropEntries(presentation: Presentation): void {
    for (const entry of entries[presentation].values()) entry.listening?.abort();
    entries[presentation].clear();
  }

  // The fixed parts of each presentation, made once.
  const floatTitle = make(doc, 'div', 'axylo-tooltip-title');
  const floatTotal = make(doc, 'div', 'axylo-tooltip-row axylo-tooltip-total');
  const floatTotalName = make(doc, 'span', 'axylo-tooltip-series');
  const floatTotalValue = make(doc, 'span', 'axylo-tooltip-value');
  floatTotal.append(floatTotalName, floatTotalValue);
  const stripTitle = make(doc, 'span', 'axylo-tooltip-title');
  const stripTotal = make(doc, 'span', 'axylo-readout-total');
  const listening = new AbortController();
  for (const host of [element, readoutElement]) {
    host.addEventListener('pointerdown', event => {
      if (pressEvent === event) { pressEvent = null; return; }
      pressEvent = null;
      clearPress();
    }, { signal: listening.signal });
    host.addEventListener('pointerup', releasing, { signal: listening.signal });
    host.addEventListener('pointercancel', event => {
      if (press && press.pointer === event.pointerId) clearPress();
    }, { signal: listening.signal });
  }
  /** "+N more": text while hovered, a button that shows the next rows while pinned. */
  function moreElement(presentation: Presentation, pinned: boolean): HTMLElement {
    const button = pinned && current?.more !== undefined;
    const key = `${presentation}\u0000${button}`;
    let el = mores.get(key);
    if (!el) {
      el = doc.createElement(button ? 'button' : presentation === 'strip' ? 'span' : 'div');
      el.className = 'axylo-tooltip-more';
      if (button) {
        const btn = el as HTMLButtonElement;
        btn.type = 'button';
        btn.tabIndex = -1;
        btn.classList.add('axylo-tooltip-choice');
        btn.addEventListener('mousedown', keepFocusOnPress, { signal: listening.signal });
        btn.addEventListener('click', () => current?.more?.(displayed), { signal: listening.signal });
      }
      mores.set(key, el);
    }
    return el;
  }
  const mores = new Map<string, HTMLElement>();
  const moreSeparator = doc.createTextNode('; ');
  const totalSeparator = doc.createTextNode('; ');

  function expose(host: HTMLElement, pinned: boolean): void {
    // Pinned content is real (rule 9); hovered content is the proxy's reading again, so it stays hidden.
    if (pinned) host.removeAttribute('aria-hidden');
    else if (host.getAttribute('aria-hidden') !== 'true') host.setAttribute('aria-hidden', 'true');
  }

  /** The floating tooltip's content with the first `shown` rows; the rest are counted in "+N more". */
  function fillFloating(content: TooltipContent, rows: readonly RowEntry[], pinned: boolean, shown: number): void {
    const { model } = content;
    setText(floatTitle, model.title);
    const children: Node[] = [floatTitle, ...rows.slice(0, shown).map(e => e.element)];
    displayed = Math.min(shown, rows.length);
    const more = model.count - Math.min(shown, model.rows.length);
    if (more > 0) {
      const el = moreElement('floating', pinned);
      setText(el, content.moreRows(more));
      setLang(el, content.moreLang);
      children.push(el);
    }
    if (model.total !== null) {
      setText(floatTotalName, content.totalLabel ?? '');
      setLang(floatTotalName, content.totalLang);
      setText(floatTotalValue, model.total);
      children.push(floatTotal);
    }
    place(element, children);
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

  function hideFloating(): void {
    if (element.hidden && !element.firstChild) return;
    keepFocus('floating');
    clearPress();
    element.hidden = true;
    element.classList.remove('axylo-tooltip-pinned');
    expose(element, false);
    place(element, []);
    dropEntries('floating');
  }

  function hideStrip(): void {
    if (readoutElement.hidden && !readoutElement.firstChild) return;
    keepFocus('strip');
    clearPress();
    readoutElement.hidden = true;
    readoutElement.classList.remove('axylo-readout-pinned');
    expose(readoutElement, false);
    place(readoutElement, []);
    dropEntries('strip');
  }

  return {
    get visible() {
      return where !== null;
    },
    rect() {
      if (where === 'floating') return element.getBoundingClientRect();
      if (where === 'strip') return readoutElement.getBoundingClientRect();
      return null;
    },
    contains(node) {
      return node !== null && (element.contains(node) || readoutElement.contains(node));
    },
    show(content, p, pinned) {
      current = content;
      const carried = pinned ? press : null;
      if (!pinned) clearPress();
      const had = focusedKey('strip') ?? focusedKey('floating') ?? pendingFocus;
      pendingFocus = null;
      hideStrip();
      element.hidden = false;
      element.classList.toggle('axylo-tooltip-pinned', pinned);
      expose(element, pinned);
      // The tooltip lives in the figure's layout pixels; placement is in viewport pixels.
      const m = mappingOf(figure);
      // Never larger than the visible part of the plot (rule 6): it wraps within that.
      const maxWidth = `${Math.max(0, Math.min(320, p.visible.width / m.kx))}px`;
      const maxHeight = `${Math.max(0, p.visible.height / m.ky)}px`;
      if (element.style.maxWidth !== maxWidth) element.style.maxWidth = maxWidth;
      if (element.style.maxHeight !== maxHeight) element.style.maxHeight = maxHeight;
      const rows = rowEntries('floating', content, pinned);
      const position = (x: number, y: number) => {
        const transform = `translate(${(x - m.left) / m.kx}px, ${(y - m.top) / m.ky}px)`;
        if (element.style.transform !== transform) element.style.transform = transform;
        where = 'floating';
      };
      // Measured where it cannot be squeezed by the figure's edge.
      element.style.transform = 'translate(0px, 0px)';
      const total = content.model.rows.length;
      let size = { width: 0, height: 0 };
      // A value keeps its number and unit on one line while it fits; one that does not fit wraps (rule 6).
      element.classList.remove('axylo-tooltip-wrap');
      const overflows = () => element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1;
      for (let shown = total; shown >= Math.min(1, total); shown--) {
        fillFloating(content, rows, pinned, shown);
        if (overflows() && !element.classList.contains('axylo-tooltip-wrap')) element.classList.add('axylo-tooltip-wrap');
        // Fit is judged on what can be seen: content cut by the size limit does not fit (review finding 4),
        // except one row, which is shown, cut if it must be, title and row first (spec I1, rule 6).
        if (overflows() && shown > 1) continue;
        const b = element.getBoundingClientRect();
        size = { width: b.width, height: b.height };
        const spot = placeTooltip(p, size.width, size.height);
        if (spot) {
          position(spot.x, spot.y);
          if (carried && !press) startPress(carried.key, carried.pointer);
          carryFocus(had, 'floating');
          return true;
        }
      }
      const last = size.width > 0 ? fallbackPlacement(p, size.width, size.height) : null;
      if (last) {
        position(last.x, last.y);
        if (carried && !press) startPress(carried.key, carried.pointer);
        carryFocus(had, 'floating');
        return true;
      }
      // Nowhere clear of the controls and focus rings, or not even one row visible: nothing floats (rule 6).
      hideFloating();
      where = null;
      if (had !== null) lost();
      return false;
    },
    strip(content, pinned, visible) {
      current = content;
      const carried = pinned ? press : null;
      if (!pinned) clearPress();
      const had = focusedKey('floating') ?? focusedKey('strip') ?? pendingFocus;
      pendingFocus = null;
      hideFloating();
      readoutElement.hidden = false;
      readoutElement.classList.toggle('axylo-readout-pinned', pinned);
      expose(readoutElement, pinned);
      const { model } = content;
      const rows = rowEntries('strip', content, pinned);
      setText(stripTitle, `${model.title}: `);
      // Running text: "x: series value; series value; +N more", within the strip's two lines; at least the
      // x and one row are always shown (rule 5).
      const build = (shown: number): void => {
        const parts: Node[] = [stripTitle];
        displayed = Math.min(shown, rows.length);
        rows.slice(0, shown).forEach((entry, i) => {
          if (i > 0 && entry.separator) parts.push(entry.separator);
          parts.push(entry.element);
        });
        if (model.total !== null) {
          setText(stripTotal, `${content.totalLabel ?? ''} ${model.total}`);
          setLang(stripTotal, content.totalLang);
          parts.push(totalSeparator, stripTotal);
        }
        const more = model.count - Math.min(shown, model.rows.length);
        if (more > 0) {
          const el = moreElement('strip', pinned);
          setText(el, content.moreRows(more));
          setLang(el, content.moreLang);
          if (shown > 0) parts.push(moreSeparator);
          parts.push(el);
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
        for (const part of el.getClientRects()) {
          if (part.left < box.x - 0.5 || part.top < box.y - 0.5 || part.right > box.right + 0.5 || part.bottom > box.bottom + 0.5) return false;
        }
        return el.getClientRects().length > 0;
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
      if (!seen) {
        hideStrip();
        where = null;
        if (had !== null) lost();
        return false;
      }
      where = 'strip';
      if (carried && !press) startPress(carried.key, carried.pointer);
      carryFocus(had, 'strip');
      return true;
    },
    hide() {
      clearPress();
      hideFloating();
      hideStrip();
      where = null;
      current = null;
    },
    destroy() {
      clearPress();
      hideFloating();
      hideStrip();
      listening.abort();
      mores.clear();
      where = null;
      current = null;
    },
  };
}
