/**
 * Renders a tooltip model as text (spec I1, DX8: textContent only) in one of two places: floating beside the
 * active mark, or, when it cannot fit beside it (a narrow tile), in a fixed readout under the plot. It does
 * not decide what is active; the interaction layer does, for pointer, touch and keyboard alike.
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
}

export interface TooltipView {
  /**
   * Floating: shows `content` beside `anchor` (viewport coordinates) without covering it, inside the
   * viewport, flipping sides as needed; `focusY` is where along the anchor it should sit (the pointer).
   * Returns false, showing nothing, when it cannot fit beside the anchor within the figure's width.
   */
  show(content: TooltipContent, anchor: Rect, focusY: number | null): boolean;
  /** Fixed: the same content in the readout under the plot. */
  readout(content: TooltipContent): void;
  hide(): void;
  readonly visible: boolean;
}

const OFFSET = 12;
const MARGIN = 4;

function fill(element: HTMLElement, { model, swatch, moreRows }: TooltipContent): void {
  const doc = element.ownerDocument;
  const heading = doc.createElement('div');
  heading.className = 'axylo-tooltip-title';
  heading.textContent = model.title;
  const rows: HTMLElement[] = [heading];
  for (const row of model.rows) {
    const line = doc.createElement('div');
    line.className = 'axylo-tooltip-row';
    const name = doc.createElement('span');
    name.className = 'axylo-tooltip-series';
    const spec = swatch(row);
    if (spec) name.appendChild(createSwatch(doc, spec));
    name.appendChild(doc.createTextNode(row.seriesLabel));
    const value = doc.createElement('span');
    value.className = 'axylo-tooltip-value';
    value.textContent = row.percent === null || row.percent === row.value ? row.value : `${row.value} (${row.percent})`;
    line.append(name, value);
    rows.push(line);
  }
  if (model.count > model.rows.length) {
    const more = doc.createElement('div');
    more.className = 'axylo-tooltip-more';
    more.textContent = moreRows(model.count - model.rows.length);
    rows.push(more);
  }
  if (model.total !== null) {
    const total = doc.createElement('div');
    total.className = 'axylo-tooltip-total';
    total.textContent = model.total;
    rows.push(total);
  }
  element.replaceChildren(...rows);
}

export function createTooltip(element: HTMLElement, readoutElement: HTMLElement, figure: HTMLElement, plot: HTMLElement): TooltipView {
  const doc = element.ownerDocument;
  let visible = false;

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
    show(content, anchor, focusY) {
      fill(element, content);
      element.hidden = false;
      element.style.transform = 'translate(0px, 0px)';
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const outer = figure.getBoundingClientRect();
      // Beside the mark means within the figure's own width. A tile too narrow for that at every position
      // uses the readout throughout, so the tooltip does not jump between two places as the pointer moves.
      const roomRight = outer.right - (anchor.x + anchor.width + OFFSET);
      const roomLeft = anchor.x - OFFSET - outer.left;
      if (outer.width < 2 * (width + OFFSET) || (roomRight < width && roomLeft < width)) {
        hideFloating();
        visible = false;
        return false;
      }
      hideReadout();
      const view = doc.documentElement;
      const vw = view.clientWidth;
      const vh = view.clientHeight;
      const clampY = (y: number) => Math.max(MARGIN, Math.min(y, vh - MARGIN - height));
      const clampX = (x: number) => Math.max(MARGIN, Math.min(x, vw - MARGIN - width));
      const cy = focusY ?? anchor.y + anchor.height / 2;
      const cx = anchor.x + anchor.width / 2;
      const candidates: [number, number][] = [
        [anchor.x + anchor.width + OFFSET, clampY(cy - height / 2)],
        [anchor.x - OFFSET - width, clampY(cy - height / 2)],
        [clampX(cx - width / 2), anchor.y + anchor.height + OFFSET],
        [clampX(cx - width / 2), anchor.y - OFFSET - height],
      ];
      const fits = ([x, y]: [number, number]) => x >= MARGIN && x + width <= vw - MARGIN && y >= MARGIN && y + height <= vh - MARGIN;
      const [x, y] = candidates.find(fits) ?? [clampX(candidates[0]![0]), clampY(candidates[0]![1])];
      element.style.transform = `translate(${Math.round(x - outer.left)}px, ${Math.round(y - outer.top)}px)`;
      visible = true;
      return true;
    },
    readout(content) {
      hideFloating();
      fill(readoutElement, content);
      readoutElement.style.top = `${plot.offsetTop + plot.offsetHeight}px`;
      readoutElement.hidden = false;
      visible = true;
    },
    hide() {
      hideFloating();
      hideReadout();
      visible = false;
    },
  };
}
