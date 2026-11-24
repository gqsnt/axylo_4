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
  align: string;
  rx: number;
  ry: number;
  rotate: number;
  anchor: PlacedText['anchor'] | '';
  baseline: PlacedText['baseline'] | '';
  role: string;
  line0: HTMLDivElement | null;
  text0: string;
  lines: HTMLDivElement[] | null;
  text: string[] | null;
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

function appendLine(doc: Document, label: HTMLDivElement): HTMLDivElement {
  const line = doc.createElement('div');
  // A blank line still takes one line height (in the reader's spacing), so anchors stay put.
  line.style.setProperty('min-height', '1lh');
  label.appendChild(line);
  return line;
}

function renderLines(doc: Document, label: Label, text: readonly string[]): void {
  if (text.length === 0) {
    label.line0?.remove();
    label.line0 = null;
    label.text0 = '';
  } else {
    const line0 = label.line0 ??= appendLine(doc, label.el);
    const text0 = text[0]!;
    if (label.text0 !== text0) {
      label.text0 = text0;
      line0.textContent = text0;
    }
  }
  if (text.length <= 1) {
    if (label.lines !== null) {
      for (const line of label.lines) line.remove();
      label.lines = null;
      label.text = null;
    }
    return;
  }
  const lines = label.lines ??= [];
  const previous = label.text ??= [];
  const count = text.length - 1;
  while (lines.length > count) { lines.pop()!.remove(); previous.pop(); }
  while (lines.length < count) {
    lines.push(appendLine(doc, label.el));
    previous.push('');
  }
  for (let i = 0; i < count; i++) {
    const value = text[i + 1]!;
    if (previous[i] !== value) { previous[i] = value; lines[i]!.textContent = value; }
  }
}

export function createTextLayer(doc: Document = document): TextLayer {
  const element = doc.createElement('div');
  element.className = 'axylo-text';
  element.setAttribute('aria-hidden', 'true');
  const labels: Label[] = [];

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
          // Invariant positioning styles are set once on creation rather than re-parsed via cssText on every frame.
          const st = el.style;
          st.position = 'absolute';
          st.left = '0';
          st.top = '0';
          st.transformOrigin = '0 0';
          st.whiteSpace = 'pre';
          label = {
            el, align: '', rx: NaN, ry: NaN, rotate: NaN, anchor: '', baseline: '', role: '',
            line0: null, text0: '', lines: null, text: null,
          };
          labels.push(label);
          (fresh ??= doc.createDocumentFragment()).appendChild(el);
        }
        const align = ALIGN[t.anchor];
        if (label.align !== align) { label.align = align; label.el.style.textAlign = align; }
        const rx = Math.round(t.x * 100) / 100;
        const ry = Math.round(t.y * 100) / 100;
        if (label.rx !== rx || label.ry !== ry || label.rotate !== t.rotate || label.anchor !== t.anchor || label.baseline !== t.baseline) {
          label.rx = rx;
          label.ry = ry;
          label.rotate = t.rotate;
          label.anchor = t.anchor;
          label.baseline = t.baseline;
          const rotate = t.rotate !== 0 ? ` rotate(${t.rotate}deg)` : '';
          label.el.style.transform = `translate(${rx}px,${ry}px)${rotate} translate(${SHIFT_X[t.anchor]},${SHIFT_Y[t.baseline]})`;
        }
        if (label.role !== t.role) { label.role = t.role; label.el.setAttribute('data-role', t.role); }
        renderLines(doc, label, t.lines);
      }
      for (let i = texts.length; i < labels.length; i++) labels[i]!.el.remove();
      if (labels.length > texts.length) labels.length = texts.length;
      if (fresh !== null) element.appendChild(fresh);
    },
    destroy(): void {
      element.remove();
      labels.length = 0;
    },
  };
}
