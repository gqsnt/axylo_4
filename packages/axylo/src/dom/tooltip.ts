/**
 * Renders a tooltip model as text (spec I1, DX8: textContent only), placed by decision 0004 revision 2:
 *
 * - The position is a function of the datum only: the box of its active marks, enlarged by the focus ring.
 *   The pointer never enters the computation, so an approaching pointer cannot push the tooltip away.
 * - Candidates above, below, right and left of that box (horizontal bars: right, left, above, below; a donut
 *   tries its hole first), each valid only wholly inside the plot, the viewport and every clipping ancestor,
 *   and overlapping neither the box nor any control.
 * - A hovered tooltip is text and takes no pointer events; a pinned one takes events and its rows are buttons
 *   of at least 24 × 24 CSS px.
 * - When nothing fits, rows are dropped into "+N more"; with one row left and still nothing valid, the
 *   candidate that overlaps the box least is used, inside the plot (rule 6).
 *
 * In readout mode (decided by layout, rule 5) the same content is written as running text into a strip of
 * two lines reserved under the plot; there is no floating tooltip then.
 *
 * Both elements are aria-hidden: the keyboard proxy carries the same text as its value text, so a screen
 * reader is not told twice and nothing here behaves as a live region (spec A7).
 */
import type { DatumText, Rect, TooltipModel } from '../core/contracts';
import { createSwatch, type SwatchSpec } from './swatch';

export interface TooltipContent {
  readonly model: TooltipModel;
  readonly swatch: (row: DatumText) => SwatchSpec | null;
  readonly moreRows: (count: number) => string;
  /** Label of the stack total row (the `total` message). */
  readonly totalLabel?: string;
  /** A row of a pinned tooltip was chosen (a click or a tap on it). */
  readonly select?: (row: DatumText) => void;
}

/** Where a floating tooltip may go, all in viewport pixels. */
export interface Placement {
  /** The datum's active marks, enlarged by the focus ring: never covered. */
  readonly box: Rect;
  /** The plot rectangle the tooltip must stay inside. */
  readonly plot: Rect;
  /** 'vertical': above, below, right, left. 'horizontal' (horizontal bars): right, left, above, below. */
  readonly order: 'vertical' | 'horizontal';
  /** A donut's hole, tried first when the tooltip fits inside it. */
  readonly hole?: Rect | null;
  /** Controls the tooltip must not cover. */
  readonly controls: readonly Rect[];
}

export interface TooltipView {
  /** Floating, by the placement above. `pinned`: the tooltip takes events and its rows are buttons. */
  show(content: TooltipContent, placement: Placement, pinned: boolean): void;
  /** Readout mode: the content as running text in the strip under the plot, at most two lines. */
  strip(content: TooltipContent, pinned: boolean): void;
  hide(): void;
  readonly visible: boolean;
  /** Where the content is shown now. */
  readonly where: 'floating' | 'readout' | null;
  /** The floating tooltip's rectangle in viewport pixels, or null when it is not shown. */
  rect(): Rect | null;
  destroy(): void;
}

const OFFSET = 8;

interface Bounds { left: number; top: number; right: number; bottom: number }

function overlap(a: Bounds, b: Bounds): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

const bounds = (r: Rect): Bounds => ({ left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height });

/**
 * Viewport pixels per layout pixel of `el`: 1 unless an ancestor scales it with a CSS transform. Bounding
 * rects are in viewport pixels, sizes and translations in layout pixels (part 1 item 12).
 */
export function cssScale(el: HTMLElement): { x: number; y: number } {
  const box = el.getBoundingClientRect();
  // offsetWidth is rounded to an integer: within 2% the ratio is that rounding, not a transform.
  const ratio = (rect: number, layout: number) => {
    const k = layout > 0 && rect > 0 ? rect / layout : 1;
    return Number.isFinite(k) && Math.abs(k - 1) >= 0.02 ? k : 1;
  };
  return { x: ratio(box.width, el.offsetWidth), y: ratio(box.height, el.offsetHeight) };
}

/** The viewport, cut down by every ancestor that clips its content. */
function clipBounds(from: Element): Bounds {
  const doc = from.ownerDocument;
  const win = doc.defaultView;
  const view = doc.documentElement;
  const out: Bounds = { left: 0, top: 0, right: view.clientWidth, bottom: view.clientHeight };
  for (let el: Element | null = from.parentElement; el && el !== view && win; el = el.parentElement) {
    const style = win.getComputedStyle(el);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const box = el.getBoundingClientRect();
    out.left = Math.max(out.left, box.left);
    out.top = Math.max(out.top, box.top);
    out.right = Math.min(out.right, box.right);
    out.bottom = Math.min(out.bottom, box.bottom);
  }
  return out;
}

export function createTooltip(element: HTMLElement, readoutElement: HTMLElement, figure: HTMLElement): TooltipView {
  const doc = element.ownerDocument;
  let where: 'floating' | 'readout' | null = null;
  /** Row listeners belong to the rows of one fill; the next fill or hide removes them. */
  let rows: AbortController | null = null;

  function row(r: DatumText, content: TooltipContent, pinned: boolean, className: string): HTMLElement {
    // A pinned row is a real control: a button named by its text, 24 px, outside the tab order (the closed
    // chart keeps its two tab stops). A hovered row is text.
    const select = pinned ? content.select : undefined;
    const line = doc.createElement(select ? 'button' : 'div');
    line.className = className;
    if (line instanceof HTMLButtonElement && select) {
      line.type = 'button';
      line.tabIndex = -1;
      line.classList.add('axylo-tooltip-choice');
      // A press does not take focus from the plot, whose keyboard reading goes on from the chosen datum.
      line.addEventListener('mousedown', event => event.preventDefault(), { signal: rows!.signal });
      line.addEventListener('click', () => select(r), { signal: rows!.signal });
    }
    const name = doc.createElement('span');
    name.className = 'axylo-tooltip-series';
    const spec = content.swatch(r);
    if (spec) name.appendChild(createSwatch(doc, spec));
    name.appendChild(doc.createTextNode(r.seriesLabel));
    const value = doc.createElement('span');
    value.className = 'axylo-tooltip-value';
    value.textContent = r.percent === null || r.percent === r.value ? r.value : `${r.value} (${r.percent})`;
    // As running text in the strip, the name and the value are words of one sentence.
    if (className === 'axylo-readout-entry') line.append(name, doc.createTextNode(' '), value);
    else line.append(name, value);
    return line;
  }

  /** The floating tooltip's content with the first `shown` rows; the rest are counted in "+N more". */
  function fill(content: TooltipContent, pinned: boolean, shown: number): void {
    rows?.abort();
    rows = new AbortController();
    const { model } = content;
    const heading = doc.createElement('div');
    heading.className = 'axylo-tooltip-title';
    heading.textContent = model.title;
    const children: HTMLElement[] = [heading];
    for (const r of model.rows.slice(0, shown)) children.push(row(r, content, pinned, 'axylo-tooltip-row'));
    const more = model.count - Math.min(shown, model.rows.length);
    if (more > 0) {
      const el = doc.createElement('div');
      el.className = 'axylo-tooltip-more';
      el.textContent = content.moreRows(more);
      children.push(el);
    }
    if (model.total !== null) {
      const total = doc.createElement('div');
      total.className = 'axylo-tooltip-row axylo-tooltip-total';
      const name = doc.createElement('span');
      name.className = 'axylo-tooltip-series';
      name.textContent = content.totalLabel ?? '';
      const value = doc.createElement('span');
      value.className = 'axylo-tooltip-value';
      value.textContent = model.total;
      total.append(name, value);
      children.push(total);
    }
    element.replaceChildren(...children);
  }

  function hideFloating(): void {
    if (element.hidden) return;
    element.hidden = true;
    element.classList.remove('axylo-tooltip-pinned');
    element.replaceChildren();
  }

  function hideStrip(): void {
    if (readoutElement.hidden) return;
    readoutElement.hidden = true;
    readoutElement.replaceChildren();
  }

  /** The candidates of rule 2 for a tooltip of this size, in order. */
  function candidates(p: Placement, width: number, height: number): [number, number][] {
    const box = bounds(p.box);
    const cx = (box.left + box.right) / 2 - width / 2;
    const cy = (box.top + box.bottom) / 2 - height / 2;
    const plot = bounds(p.plot);
    // Along the other axis: centred on the box, shifted only as far as the plot needs.
    const alongX = Math.max(plot.left, Math.min(cx, plot.right - width));
    const alongY = Math.max(plot.top, Math.min(cy, plot.bottom - height));
    const above: [number, number] = [alongX, box.top - OFFSET - height];
    const below: [number, number] = [alongX, box.bottom + OFFSET];
    const right: [number, number] = [box.right + OFFSET, alongY];
    const left: [number, number] = [box.left - OFFSET - width, alongY];
    const list: [number, number][] = p.order === 'horizontal' ? [right, left, above, below] : [above, below, right, left];
    if (p.hole) {
      const hole = bounds(p.hole);
      list.unshift([(hole.left + hole.right) / 2 - width / 2, (hole.top + hole.bottom) / 2 - height / 2]);
    }
    return list;
  }

  return {
    get visible() {
      return where !== null;
    },
    get where() {
      return where;
    },
    rect() {
      if (where !== 'floating') return null;
      const b = element.getBoundingClientRect();
      return { x: b.left, y: b.top, width: b.width, height: b.height };
    },
    show(content, p, pinned) {
      hideStrip();
      element.hidden = false;
      element.classList.toggle('axylo-tooltip-pinned', pinned);
      const scale = cssScale(figure);
      const outer = figure.getBoundingClientRect();
      const clip = clipBounds(figure);
      const plot = bounds(p.plot);
      const limits: Bounds = {
        left: Math.max(plot.left, clip.left), top: Math.max(plot.top, clip.top),
        right: Math.min(plot.right, clip.right), bottom: Math.min(plot.bottom, clip.bottom),
      };
      const box = bounds(p.box);
      const controls = p.controls.map(bounds);
      const valid = ([x, y]: [number, number], width: number, height: number): boolean => {
        const b = { left: x, top: y, right: x + width, bottom: y + height };
        return b.left >= limits.left - 0.5 && b.right <= limits.right + 0.5 && b.top >= limits.top - 0.5 && b.bottom <= limits.bottom + 0.5 &&
          overlap(b, box) === 0 && controls.every(c => overlap(b, c) === 0);
      };
      const place = ([x, y]: [number, number]) => {
        element.style.transform = `translate(${Math.round((x - outer.left) / scale.x)}px, ${Math.round((y - outer.top) / scale.y)}px)`;
        where = 'floating';
      };
      // Rule 6: rows are dropped from the end, into "+N more", until a candidate is valid.
      const rowsShown = content.model.rows.length;
      let last: { width: number; height: number } | null = null;
      for (let shown = rowsShown; shown >= Math.min(1, rowsShown); shown--) {
        element.style.transform = 'translate(0px, 0px)';
        fill(content, pinned, shown);
        const width = element.offsetWidth * scale.x;
        const height = element.offsetHeight * scale.y;
        last = { width, height };
        const spot = candidates(p, width, height).find(c => valid(c, width, height));
        if (spot) { place(spot); return; }
      }
      // With one row and still nothing valid: inside the plot, at the candidate that covers the box least.
      const { width, height } = last!;
      const inside = ([x, y]: [number, number]): [number, number] => [
        Math.max(limits.left, Math.min(x, limits.right - width)), Math.max(limits.top, Math.min(y, limits.bottom - height)),
      ];
      const ranked = candidates(p, width, height).map(inside)
        .map(c => ({ c, cost: overlap({ left: c[0], top: c[1], right: c[0] + width, bottom: c[1] + height }, box) }))
        .sort((a, b) => a.cost - b.cost);
      place(ranked[0]!.c);
    },
    strip(content, pinned) {
      hideFloating();
      rows?.abort();
      rows = new AbortController();
      readoutElement.hidden = false;
      const { model } = content;
      // Running text: "x: series value; series value; +N more", within the strip's two lines.
      const build = (shown: number): void => {
        const parts: Node[] = [];
        const title = doc.createElement('span');
        title.className = 'axylo-tooltip-title';
        title.textContent = `${model.title}: `;
        parts.push(title);
        model.rows.slice(0, shown).forEach((r, i) => {
          if (i > 0) parts.push(doc.createTextNode('; '));
          parts.push(row(r, content, pinned, 'axylo-readout-entry'));
        });
        if (model.total !== null) parts.push(doc.createTextNode(`; ${content.totalLabel ?? ''} ${model.total}`));
        const more = model.count - Math.min(shown, model.rows.length);
        if (more > 0) parts.push(doc.createTextNode(`${shown > 0 ? '; ' : ''}${content.moreRows(more)}`));
        readoutElement.replaceChildren(...parts);
      };
      for (let shown = model.rows.length; shown >= 0; shown--) {
        build(shown);
        if (readoutElement.scrollHeight <= readoutElement.clientHeight + 1) break;
      }
      where = 'readout';
    },
    hide() {
      rows?.abort();
      rows = null;
      hideFloating();
      hideStrip();
      where = null;
    },
    destroy() {
      rows?.abort();
      rows = null;
      hideFloating();
      hideStrip();
      where = null;
    },
  };
}
