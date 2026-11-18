/**
 * The DOM text layer (plan 2.3): tick labels, titles and messages as real HTML text, so they inherit the
 * page font and color, honour the reader's text spacing (spec A6) and adapt to forced colors. The layer is
 * aria-hidden; readers get the same information from the summary and table.
 *
 * Each label is one absolutely positioned element with one block child per line. Its transform puts the
 * anchor point of the text on (x, y) and rotates about that point. Elements are reused between renders,
 * text is only ever set through textContent (spec DX8), and render writes without reading layout.
 */
import type { PlacedText } from '../core/contracts';

export interface TextLayer {
  readonly element: HTMLDivElement;
  render(texts: readonly PlacedText[]): void;
  destroy(): void;
}

interface Label {
  readonly el: HTMLDivElement;
  css: string;
  role: string;
  readonly lines: HTMLDivElement[];
  readonly text: string[];
}

const ALIGN = { start: 'left', middle: 'center', end: 'right' } as const;
const SHIFT_X = { start: '0%', middle: '-50%', end: '-100%' } as const;
const SHIFT_Y = { top: '0%', middle: '-50%', bottom: '-100%' } as const;

/** Rounded to 1/100 px so that equal positions produce equal strings and skip the write. */
const px = (v: number): string => `${Math.round(v * 100) / 100}px`;

export function labelStyle(t: PlacedText): string {
  // Transforms apply right to left: move the anchor point of the text to the origin, rotate about it,
  // then move the origin to (x, y).
  const rotate = t.rotate !== 0 ? ` rotate(${t.rotate}deg)` : '';
  return `position:absolute;left:0;top:0;transform-origin:0 0;white-space:pre;text-align:${ALIGN[t.anchor]};` +
    `transform:translate(${px(t.x)},${px(t.y)})${rotate} translate(${SHIFT_X[t.anchor]},${SHIFT_Y[t.baseline]})`;
}

export function createTextLayer(doc: Document = document): TextLayer {
  const element = doc.createElement('div');
  element.className = 'axylo-text';
  element.setAttribute('aria-hidden', 'true');
  let labels: Label[] = [];

  return {
    element,
    render(texts: readonly PlacedText[]): void {
      let fresh: DocumentFragment | null = null;
      for (let i = 0; i < texts.length; i++) {
        const t = texts[i]!;
        let label = labels[i];
        if (label === undefined) {
          const el = doc.createElement('div');
          el.className = 'axylo-label';
          label = { el, css: '', role: '', lines: [], text: [] };
          labels.push(label);
          (fresh ??= doc.createDocumentFragment()).appendChild(el);
        }
        const css = labelStyle(t);
        if (label.css !== css) { label.css = css; label.el.style.cssText = css; }
        if (label.role !== t.role) { label.role = t.role; label.el.setAttribute('data-role', t.role); }
        const lines = label.lines;
        while (lines.length > t.lines.length) { lines.pop()!.remove(); label.text.pop(); }
        while (lines.length < t.lines.length) {
          const line = doc.createElement('div');
          label.el.appendChild(line);
          lines.push(line);
          label.text.push('');
        }
        for (let k = 0; k < lines.length; k++) {
          const s = t.lines[k]!;
          if (label.text[k] !== s) { label.text[k] = s; lines[k]!.textContent = s; }
        }
      }
      for (let i = texts.length; i < labels.length; i++) labels[i]!.el.remove();
      if (labels.length > texts.length) labels = labels.slice(0, texts.length);
      if (fresh !== null) element.appendChild(fresh);
    },
    destroy(): void {
      element.remove();
      labels = [];
    },
  };
}
