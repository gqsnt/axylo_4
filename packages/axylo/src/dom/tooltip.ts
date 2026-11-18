/**
 * Renders a tooltip model as text (spec I1, DX8: textContent only). It does not decide what is active; the
 * pointer module and, later, the keyboard decide, and both hand a model and an anchor point to `show`.
 */
import type { TooltipModel } from '../core/contracts';

export interface TooltipView {
  /** Shows `model` near (x, y), in CSS px relative to the figure, kept inside the figure where it fits. */
  show(model: TooltipModel, x: number, y: number, moreRows: (count: number) => string): void;
  hide(): void;
  readonly visible: boolean;
}

const OFFSET = 12;

export function createTooltip(element: HTMLElement, container: HTMLElement): TooltipView {
  const doc = element.ownerDocument;
  let visible = false;
  return {
    get visible() {
      return visible;
    },
    show(model, x, y, moreRows) {
      const heading = doc.createElement('div');
      heading.className = 'axylo-tooltip-title';
      heading.textContent = model.title;
      const rows: HTMLElement[] = [heading];
      for (const row of model.rows) {
        const line = doc.createElement('div');
        line.className = 'axylo-tooltip-row';
        const name = doc.createElement('span');
        name.className = 'axylo-tooltip-series';
        name.textContent = row.seriesLabel;
        const value = doc.createElement('span');
        value.className = 'axylo-tooltip-value';
        value.textContent = row.percent === null ? row.value : `${row.value} (${row.percent})`;
        line.append(name, value);
        rows.push(line);
      }
      if (model.count > model.rows.length) {
        const more = doc.createElement('div');
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
      element.hidden = false;
      visible = true;
      // Right of and below the pointer, flipped to the other side when it would leave the figure.
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const room = container.clientWidth;
      const left = x + OFFSET + width <= room ? x + OFFSET : Math.max(0, x - OFFSET - width);
      const top = Math.max(0, y + OFFSET + height <= container.clientHeight ? y + OFFSET : y - OFFSET - height);
      element.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    },
    hide() {
      if (!visible) return;
      visible = false;
      element.hidden = true;
      element.replaceChildren();
    },
  };
}
