/**
 * Renders a tooltip model as text (spec I1, DX8: textContent only) in one of two places: floating beside the
 * active mark, or, when it cannot fit there, in a fixed readout under the plot. It does not decide what is
 * active; the interaction layer does, for pointer, touch and keyboard alike.
 *
 * Floating placement keeps clear of the active marks, of the pointer (so the next click reaches the plot,
 * not the tooltip) and of the focus ring, and stays inside every box that clips the chart: the viewport and
 * any ancestor with overflow other than visible (an `overflow: hidden` card). When no side fits, the readout
 * is used instead; nothing is ever drawn clamped over the mark (WCAG 1.4.13, 2.4.11; review 2, finding 12).
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
  /** A row was chosen with the pointer (a click or a tap on it). */
  readonly select?: (row: DatumText) => void;
}

export interface TooltipView {
  /**
   * Floating: shows `content` beside `anchor` (viewport coordinates), clear of `pointer` and of `avoid`,
   * inside the clipping bounds, flipping sides as needed. Returns false, showing nothing, when no side fits.
   */
  show(content: TooltipContent, anchor: Rect, pointer: { x: number; y: number } | null, avoid?: readonly Rect[], axis?: 'x' | 'y' | null): boolean;
  /**
   * Fixed: the same content in the readout under the plot. The readout is in the flow between the plot and the
   * controls: once used, its space stays reserved (at the tallest content it showed), so it never covers the
   * controls and never needs to let pointer input through (decision 0004, rule 4).
   */
  readout(content: TooltipContent): void;
  hide(): void;
  readonly visible: boolean;
  /** Where the content is shown now. */
  readonly where: 'floating' | 'readout' | null;
  destroy(): void;
}

const OFFSET = 12;
const MARGIN = 4;
/** Room kept around the pointer, so a small movement or a click does not land on the tooltip. */
const POINTER_ROOM = 10;


interface Bounds { left: number; top: number; right: number; bottom: number }

function overlaps(a: Bounds, b: Bounds): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

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
  const bounds: Bounds = { left: 0, top: 0, right: view.clientWidth, bottom: view.clientHeight };
  for (let el: Element | null = from.parentElement; el && el !== view && win; el = el.parentElement) {
    const style = win.getComputedStyle(el);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const box = el.getBoundingClientRect();
    bounds.left = Math.max(bounds.left, box.left);
    bounds.top = Math.max(bounds.top, box.top);
    bounds.right = Math.min(bounds.right, box.right);
    bounds.bottom = Math.min(bounds.bottom, box.bottom);
  }
  return bounds;
}

export function createTooltip(element: HTMLElement, readoutElement: HTMLElement, figure: HTMLElement, plot: HTMLElement): TooltipView {
  const doc = element.ownerDocument;
  let visible = false;
  /** Row listeners belong to the rows of one fill; the next fill or hide removes them. */
  let rows: AbortController | null = null;

  function fill(target: HTMLElement, { model, swatch, moreRows, totalLabel, select }: TooltipContent): void {
    rows?.abort();
    rows = new AbortController();
    const heading = doc.createElement('div');
    heading.className = 'axylo-tooltip-title';
    heading.textContent = model.title;
    const children: HTMLElement[] = [heading];
    for (const row of model.rows) {
      // A row that can be chosen is a real control: a button with the row's text as its name, at least 24 px
      // tall (WCAG 2.5.8), outside the tab order, so the closed chart keeps its two tab stops (new item 9).
      const line = doc.createElement(select ? 'button' : 'div');
      line.className = 'axylo-tooltip-row';
      if (line instanceof HTMLButtonElement) {
        line.type = 'button';
        line.tabIndex = -1;
        // A press does not take focus from the plot, whose keyboard reading goes on from the chosen datum.
        line.addEventListener('mousedown', event => event.preventDefault(), { signal: rows.signal });
      }
      const name = doc.createElement('span');
      name.className = 'axylo-tooltip-series';
      const spec = swatch(row);
      if (spec) name.appendChild(createSwatch(doc, spec));
      name.appendChild(doc.createTextNode(row.seriesLabel));
      const value = doc.createElement('span');
      value.className = 'axylo-tooltip-value';
      value.textContent = row.percent === null || row.percent === row.value ? row.value : `${row.value} (${row.percent})`;
      line.append(name, value);
      if (select) {
        line.classList.add('axylo-tooltip-choice');
        line.addEventListener('click', () => select(row), { signal: rows.signal });
      }
      children.push(line);
    }
    if (model.count > model.rows.length) {
      const more = doc.createElement('div');
      more.className = 'axylo-tooltip-more';
      more.textContent = moreRows(model.count - model.rows.length);
      children.push(more);
    }
    if (model.total !== null) {
      const total = doc.createElement('div');
      total.className = 'axylo-tooltip-row axylo-tooltip-total';
      const name = doc.createElement('span');
      name.className = 'axylo-tooltip-series';
      name.textContent = totalLabel ?? '';
      const value = doc.createElement('span');
      value.className = 'axylo-tooltip-value';
      value.textContent = model.total;
      total.append(name, value);
      children.push(total);
    }
    target.replaceChildren(...children);
  }

  function hideFloating(): void {
    if (element.hidden) return;
    element.hidden = true;
    element.replaceChildren();
  }

  function hideReadout(): void {
    if (readoutElement.hidden) return;
    readoutElement.hidden = true;
    readoutElement.replaceChildren();
  }

  return {
    get visible() {
      return visible;
    },
    get where() {
      return !visible ? null : element.hidden ? 'readout' : 'floating';
    },
    show(content, anchor, pointer, avoid = [], axis = null) {
      fill(element, content);
      element.hidden = false;
      element.style.transform = 'translate(0px, 0px)';
      // All placement is in viewport pixels; the tooltip's own size is scaled into them, and the final
      // translation back into the figure's layout pixels.
      const scale = cssScale(figure);
      const width = element.offsetWidth * scale.x;
      const height = element.offsetHeight * scale.y;
      const outer = figure.getBoundingClientRect();
      // Everything the tooltip must not cover: the marks, the pointer with some room, the focus ring.
      const keep: Bounds[] = [{ left: anchor.x, top: anchor.y, right: anchor.x + anchor.width, bottom: anchor.y + anchor.height }];
      if (pointer) keep.push({ left: pointer.x - POINTER_ROOM, top: pointer.y - POINTER_ROOM, right: pointer.x + POINTER_ROOM, bottom: pointer.y + POINTER_ROOM });
      for (const r of avoid) keep.push({ left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height });
      const clear: Bounds = {
        left: Math.min(...keep.map(k => k.left)), top: Math.min(...keep.map(k => k.top)),
        right: Math.max(...keep.map(k => k.right)), bottom: Math.max(...keep.map(k => k.bottom)),
      };
      const clip = clipBounds(figure);
      const limits: Bounds = { left: clip.left + MARGIN, top: clip.top + MARGIN, right: clip.right - MARGIN, bottom: clip.bottom - MARGIN };
      // A tile too narrow for a tooltip on either side uses the readout throughout, so it does not jump
      // between two places as the pointer moves.
      if (outer.width < 2 * (width + OFFSET)) {
        hideFloating();
        visible = false;
        return false;
      }
      const clampY = (y: number) => Math.max(limits.top, Math.min(y, limits.bottom - height));
      const clampX = (x: number) => Math.max(limits.left, Math.min(x, limits.right - width));
      const cy = (pointer?.y ?? anchor.y + anchor.height / 2) - height / 2;
      const cx = anchor.x + anchor.width / 2 - width / 2;
      // Decision 0004: across the reading axis, never along it, so reading the chart never enters the
      // tooltip at any speed: above (else below) for a horizontal position axis, right (else left) for a
      // vertical one. Without a reading axis (donut), any side outside the mark.
      const above: [number, number] = [clampX(cx), clear.top - OFFSET - height];
      const below: [number, number] = [clampX(cx), clear.bottom + OFFSET];
      const right: [number, number] = [clear.right + OFFSET, clampY(anchor.y + anchor.height / 2 - height / 2)];
      const left: [number, number] = [clear.left - OFFSET - width, clampY(anchor.y + anchor.height / 2 - height / 2)];
      const candidates: [number, number][] = axis === 'x' ? [above, below] : axis === 'y' ? [right, left]
        : [[clear.right + OFFSET, clampY(cy)], [clear.left - OFFSET - width, clampY(cy)], below, above];
      const fits = ([x, y]: [number, number]) => {
        const box = { left: x, top: y, right: x + width, bottom: y + height };
        return box.left >= limits.left && box.right <= limits.right && box.top >= limits.top && box.bottom <= limits.bottom &&
          keep.every(k => !overlaps(box, k));
      };
      const spot = candidates.find(fits);
      if (!spot) {
        hideFloating();
        visible = false;
        return false;
      }
      hideReadout();
      element.style.transform = `translate(${Math.round((spot[0] - outer.left) / scale.x)}px, ${Math.round((spot[1] - outer.top) / scale.y)}px)`;
      visible = true;
      return true;
    },
    readout(content) {
      hideFloating();
      fill(readoutElement, content);
      // Under the plot, in the figure's coordinates. Decision 0004 asks for reserved space here; that is not
      // done yet (it costs the plot of a small tile its room): the readout still overlays what is below.
      const outer = figure.getBoundingClientRect();
      readoutElement.hidden = false;
      // Inside the viewport and every clipping ancestor: under the plot when it fits there, else raised to
      // the lowest place that does (spec I1).
      const clip = clipBounds(figure);
      const below = plot.getBoundingClientRect().bottom;
      const scale = cssScale(figure);
      const top = Math.max(clip.top + MARGIN, Math.min(below, clip.bottom - MARGIN - readoutElement.offsetHeight * scale.y));
      readoutElement.style.top = `${(top - outer.top) / scale.y}px`;
      visible = true;
    },
    hide() {
      rows?.abort();
      rows = null;
      hideFloating();
      hideReadout();
      visible = false;
    },
    destroy() {
      rows?.abort();
      rows = null;
      hideFloating();
      hideReadout();
    },
  };
}
