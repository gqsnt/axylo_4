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
  readonly role: PlacedText['role'];
  placed: PlacedText | null;
  rx: number;
  ry: number;
  line0: HTMLDivElement | null;
  text0: string;
  lines: HTMLDivElement[] | null;
  text: string[] | null;
}

const ALIGN = { start: 'left', middle: 'center', end: 'right' } as const;
const SHIFT_X = { start: '0%', middle: '-50%', end: '-100%' } as const;
const SHIFT_Y = { top: '0%', middle: '-50%', bottom: '-100%' } as const;
const POSITION = 'position:absolute;left:0;top:0;transform-origin:0 0;white-space:pre;';

const round = (v: number): number => Math.round(v * 100) / 100;

function transform(t: PlacedText, x: number, y: number): string {
  // Transforms apply right to left: move the anchor point of the text to the origin, rotate about it,
  // then move the origin to (x, y).
  const rotate = t.rotate !== 0 ? ` rotate(${t.rotate}deg)` : '';
  return `translate(${x}px,${y}px)${rotate} translate(${SHIFT_X[t.anchor]},${SHIFT_Y[t.baseline]})`;
}

export function labelStyle(t: PlacedText): string {
  return `${POSITION}text-align:${ALIGN[t.anchor]};transform:${transform(t, round(t.x), round(t.y))}`;
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

function createLabel(doc: Document, role: PlacedText['role']): Label {
  const el = doc.createElement('div');
  el.className = 'axylo-label';
  el.setAttribute('data-role', role);
  el.style.cssText = POSITION;
  return { el, role, placed: null, rx: NaN, ry: NaN, line0: null, text0: '', lines: null, text: null };
}

function renderLabel(doc: Document, label: Label, t: PlacedText): void {
  const previous = label.placed;
  if (previous === t) return;
  if (previous?.anchor !== t.anchor) label.el.style.textAlign = ALIGN[t.anchor];
  const rx = previous?.x === t.x ? label.rx : round(t.x);
  const ry = previous?.y === t.y ? label.ry : round(t.y);
  if (previous === null || label.rx !== rx || label.ry !== ry || previous.rotate !== t.rotate ||
      previous.anchor !== t.anchor || previous.baseline !== t.baseline) {
    label.rx = rx;
    label.ry = ry;
    label.el.style.transform = transform(t, rx, ry);
  }
  if (previous?.lines !== t.lines) renderLines(doc, label, t.lines);
  label.placed = t;
}

function reconcileRoles(doc: Document, element: HTMLDivElement, labels: Label[], texts: readonly PlacedText[], start: number): void {
  // Match in role order so an inserted tick cannot displace the labels of the other axis.
  const before = labels[start]!.el.previousSibling;
  const byRole = new Map<PlacedText['role'], Label[]>();
  for (let i = labels.length - 1; i >= start; i--) {
    const label = labels[i]!;
    const group = byRole.get(label.role);
    if (group) group.push(label);
    else byRole.set(label.role, [label]);
  }
  labels.length = texts.length;
  for (let i = start; i < texts.length; i++) {
    const t = texts[i]!;
    const label = byRole.get(t.role)?.pop() ?? createLabel(doc, t.role);
    labels[i] = label;
    renderLabel(doc, label, t);
  }
  for (const group of byRole.values()) for (const label of group) label.el.remove();

  // The text layer can also contain the chart's font probe. Start where the managed labels started.
  let next = before ? before.nextSibling : element.firstChild;
  for (let i = start; i < labels.length; i++) {
    const { el } = labels[i]!;
    if (el === next) next = el.nextSibling;
    else element.insertBefore(el, next);
  }
}

export function createTextLayer(doc: Document = document): TextLayer {
  const element = doc.createElement('div');
  element.className = 'axylo-text';
  element.setAttribute('aria-hidden', 'true');
  const labels: Label[] = [];
  let previous: readonly PlacedText[] | null = null;

  return {
    element,
    render(texts: readonly PlacedText[]): void {
      if (texts === previous) return;
      const common = Math.min(labels.length, texts.length);
      for (let i = 0; i < common; i++) {
        const label = labels[i]!;
        const t = texts[i]!;
        if (label.role !== t.role) {
          reconcileRoles(doc, element, labels, texts, i);
          previous = texts;
          return;
        }
        renderLabel(doc, label, t);
      }
      if (labels.length < texts.length) {
        const fresh = doc.createDocumentFragment();
        for (let i = labels.length; i < texts.length; i++) {
          const t = texts[i]!;
          const label = createLabel(doc, t.role);
          renderLabel(doc, label, t);
          labels.push(label);
          fresh.appendChild(label.el);
        }
        element.appendChild(fresh);
      }
      while (labels.length > texts.length) labels.pop()!.el.remove();
      previous = texts;
    },
    destroy(): void {
      element.remove();
      labels.length = 0;
      previous = null;
    },
  };
}
