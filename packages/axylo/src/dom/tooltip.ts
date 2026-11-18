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
  /** Readout mode: the content as running text in the strip under the plot, at most two lines. */
  strip(content: TooltipContent, pinned: boolean): void;
  hide(): void;
  readonly visible: boolean;
  /** Where the content is shown now. */
  readonly where: Presentation | null;
  /** The content's rectangle in viewport pixels (the floating tooltip or the strip), or null. */
  rect(): Rect | null;
  /** Whether a node belongs to the shown content. */
  contains(node: Node | null): boolean;
  destroy(): void;
}

interface RowEntry {
  readonly element: HTMLElement;
  readonly name: HTMLElement;
  readonly value: HTMLElement;
  /** The strip's "; " before the entry. */
  readonly separator: Text | null;
  row: DatumText;
  swatch: string;
  readonly listening: AbortController | null;
}

/** A row's identity across redraws: its series and its datum, not its place. */
function rowKey(r: DatumText, title: string): string {
  const ref = r.ref;
  switch (ref.kind) {
    case 'aligned': return `a\u0000${ref.seriesKey}\u0000${title}`;
    case 'point': return `p\u0000${ref.seriesKey}\u0000${ref.row}\u0000${ref.x}`;
    case 'slice': return `s\u0000${ref.sliceKey}`;
  }
}

/** Puts exactly `wanted`, in order, into `host`, moving a node only when it is out of place. */
function place(host: HTMLElement, wanted: readonly Node[]): void {
  let at: ChildNode | null = host.firstChild;
  for (const node of wanted) {
    if (at !== node) host.insertBefore(node, at);
    at = (node as ChildNode).nextSibling;
  }
  while (at) {
    const next: ChildNode | null = at.nextSibling;
    at.remove();
    at = next;
  }
}

function setText(node: Node, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function setLang(el: HTMLElement, lang: string | null | undefined): void {
  if (lang) {
    if (el.getAttribute('lang') !== lang) el.setAttribute('lang', lang);
  } else if (el.hasAttribute('lang')) el.removeAttribute('lang');
}

export function createTooltip(element: HTMLElement, readoutElement: HTMLElement, figure: HTMLElement): TooltipView {
  const doc = element.ownerDocument;
  let where: Presentation | null = null;
  /** The content on show: row buttons read it when chosen, so a redraw never strands a pressed button. */
  let current: TooltipContent | null = null;
  /** How many rows the content on show lists (the rest are in "+N more"). */
  let displayed = 0;

  /** One set of row elements per presentation, keyed by row identity and by being buttons or text. */
  const entries = { floating: new Map<string, RowEntry>(), strip: new Map<string, RowEntry>() };

  function makeEntry(r: DatumText, pinned: boolean, strip: boolean): RowEntry {
    const button = pinned && current?.select !== undefined;
    const element = doc.createElement(button ? 'button' : strip ? 'span' : 'div');
    element.className = strip ? 'axylo-readout-entry' : 'axylo-tooltip-row';
    const listening = button ? new AbortController() : null;
    const entry: RowEntry = {
      element, name: doc.createElement('span'), value: doc.createElement('span'),
      separator: strip ? doc.createTextNode('; ') : null, row: r, swatch: '', listening,
    };
    if (element instanceof HTMLButtonElement && listening) {
      element.type = 'button';
      element.tabIndex = -1;
      element.classList.add('axylo-tooltip-choice');
      // A press does not take focus from the plot, whose keyboard reading goes on from the chosen datum.
      element.addEventListener('mousedown', event => event.preventDefault(), { signal: listening.signal });
      element.addEventListener('click', () => current?.select?.(entry.row), { signal: listening.signal });
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
  }

  /** The row entries for `rows`, reused by identity; entries of rows no longer in the model are dropped. */
  function rowEntries(presentation: Presentation, content: TooltipContent, pinned: boolean): RowEntry[] {
    const map = entries[presentation];
    const strip = presentation === 'strip';
    const keep = new Set<string>();
    const out: RowEntry[] = [];
    for (const r of content.model.rows) {
      const key = `${pinned && content.select ? 'b' : 't'}\u0000${rowKey(r, content.model.title)}`;
      keep.add(key);
      let entry = map.get(key);
      if (!entry) {
        entry = makeEntry(r, pinned, strip);
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

  function dropEntries(presentation: Presentation): void {
    for (const entry of entries[presentation].values()) entry.listening?.abort();
    entries[presentation].clear();
  }

  // The fixed parts of each presentation, made once.
  const floatTitle = doc.createElement('div');
  floatTitle.className = 'axylo-tooltip-title';
  const floatTotal = doc.createElement('div');
  floatTotal.className = 'axylo-tooltip-row axylo-tooltip-total';
  const floatTotalName = doc.createElement('span');
  floatTotalName.className = 'axylo-tooltip-series';
  const floatTotalValue = doc.createElement('span');
  floatTotalValue.className = 'axylo-tooltip-value';
  floatTotal.append(floatTotalName, floatTotalValue);
  const stripTitle = doc.createElement('span');
  stripTitle.className = 'axylo-tooltip-title';
  const stripTotal = doc.createElement('span');
  stripTotal.className = 'axylo-readout-total';
  const listening = new AbortController();
  /** "+N more": text while hovered, a button that shows the next rows while pinned. */
  function moreElement(presentation: Presentation, pinned: boolean): HTMLElement {
    const button = pinned && current?.more !== undefined;
    const key = `${presentation}\u0000${button}`;
    let el = mores.get(key);
    if (!el) {
      el = doc.createElement(button ? 'button' : presentation === 'strip' ? 'span' : 'div');
      el.className = 'axylo-tooltip-more';
      if (el instanceof HTMLButtonElement) {
        el.type = 'button';
        el.tabIndex = -1;
        el.classList.add('axylo-tooltip-choice');
        el.addEventListener('mousedown', event => event.preventDefault(), { signal: listening.signal });
        el.addEventListener('click', () => current?.more?.(displayed), { signal: listening.signal });
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

  function hideFloating(): void {
    if (element.hidden && !element.firstChild) return;
    element.hidden = true;
    element.classList.remove('axylo-tooltip-pinned');
    expose(element, false);
    place(element, []);
    dropEntries('floating');
  }

  function hideStrip(): void {
    if (readoutElement.hidden && !readoutElement.firstChild) return;
    readoutElement.hidden = true;
    readoutElement.classList.remove('axylo-readout-pinned');
    expose(readoutElement, false);
    place(readoutElement, []);
    dropEntries('strip');
  }

  function rectOf(el: HTMLElement): Rect {
    const b = el.getBoundingClientRect();
    return { x: b.left, y: b.top, width: b.width, height: b.height };
  }

  return {
    get visible() {
      return where !== null;
    },
    get where() {
      return where;
    },
    rect() {
      if (where === 'floating') return rectOf(element);
      if (where === 'strip') return rectOf(readoutElement);
      return null;
    },
    contains(node) {
      return node !== null && (element.contains(node) || readoutElement.contains(node));
    },
    show(content, p, pinned) {
      current = content;
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
      for (let shown = total; shown >= Math.min(1, total); shown--) {
        fillFloating(content, rows, pinned, shown);
        const b = element.getBoundingClientRect();
        size = { width: b.width, height: b.height };
        const spot = placeTooltip(p, size.width, size.height);
        if (spot) { position(spot.x, spot.y); return true; }
      }
      const last = fallbackPlacement(p, size.width, size.height);
      if (last) { position(last.x, last.y); return true; }
      // Nowhere clear of the controls and focus rings: nothing floats (rule 6).
      hideFloating();
      where = null;
      return false;
    },
    strip(content, pinned) {
      current = content;
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
      for (let shown = rows.length; shown >= Math.min(1, rows.length); shown--) {
        build(shown);
        if (readoutElement.scrollHeight <= readoutElement.clientHeight + 1) break;
      }
      where = 'strip';
    },
    hide() {
      hideFloating();
      hideStrip();
      where = null;
      current = null;
    },
    destroy() {
      hideFloating();
      hideStrip();
      listening.abort();
      mores.clear();
      where = null;
      current = null;
    },
  };
}
