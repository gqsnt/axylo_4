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
  shifted: boolean;
  line0: HTMLDivElement | null;
  text0: string;
  lines: HTMLDivElement[] | null;
  text: string[] | null;
}

type TickRole = 'tick-x' | 'tick-y';
type SpareTicks = Record<TickRole, Label | undefined>;

const ALIGN = { start: 'left', middle: 'center', end: 'right' } as const;
const SHIFT_X = { start: '0%', middle: '-50%', end: '-100%' } as const;
const SHIFT_Y = { top: '0%', middle: '-50%', bottom: '-100%' } as const;
const POSITION = 'position:absolute;left:0;top:0;transform-origin:0 0;white-space:pre;';

const round = (v: number): number => Math.round(v * 100) / 100;

function transform(t: PlacedText, x: number, y: number, keepZeroShift = false, shifted = false): string {
  // Transforms apply right to left: move the anchor point of the text to the origin, rotate about it,
  // then move the origin to (x, y).
  const rotate = t.rotate !== 0 ? ` rotate(${t.rotate}deg)` : '';
  const horizontal = shifted ? `calc(${x}px + var(--axylo-tick-dx))` : `${x}px`;
  const position = `translate(${horizontal},${y}px)${rotate}`;
  return !keepZeroShift && t.anchor === 'start' && t.baseline === 'top'
    ? position : `${position} translate(${SHIFT_X[t.anchor]},${SHIFT_Y[t.baseline]})`;
}

export function labelStyle(t: PlacedText): string {
  return `${POSITION}text-align:${ALIGN[t.anchor]};transform:${transform(t, round(t.x), round(t.y), true)}`;
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
  return { el, role, placed: null, rx: NaN, ry: NaN, shifted: false, line0: null, text0: '', lines: null, text: null };
}

function takeLabel(doc: Document, role: PlacedText['role'], spare: SpareTicks): Label {
  if (role === 'tick-x' || role === 'tick-y') {
    const label = spare[role];
    if (label) {
      spare[role] = undefined;
      return label;
    }
  }
  return createLabel(doc, role);
}

function releaseLabel(label: Label, spare: SpareTicks): void {
  label.el.remove();
  // Tick counts can oscillate around a time boundary. One detached label per axis covers that change.
  if (label.role === 'tick-x' || label.role === 'tick-y') spare[label.role] ??= label;
}

// Keep base positions in hundredths of a pixel so independently rounded ticks stay exact.
function tickShift(labels: Label[], texts: readonly PlacedText[]): number | null {
  if (labels.length !== texts.length) return null;
  let shift = 0;
  let count = 0;
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i]!;
    if (t.role !== 'tick-x') continue;
    const label = labels[i]!;
    if (label.role !== t.role || t.lines.length !== 1 || label.text0 !== t.lines[0]) return null;
    const dx = Math.round(t.x * 100) - label.rx;
    if (!Number.isSafeInteger(dx)) return null;
    if (!count) shift = dx;
    // Rounding a shared displacement can put a tick a hundredth to either side.
    else if (Math.abs(dx - shift) > 1) return null;
    count++;
  }
  return count >= 3 && shift !== 0 ? shift : null;
}

function renderLabel(doc: Document, label: Label, t: PlacedText, shift: number | null): void {
  const previous = label.placed;
  const shifted = shift !== null && t.role === 'tick-x';
  if (previous === t && !shifted && !label.shifted) return;
  if (previous?.anchor !== t.anchor) label.el.style.textAlign = ALIGN[t.anchor];
  const rx = Math.round(t.x * 100) - (shifted ? shift : 0);
  const ry = previous?.y === t.y ? label.ry : round(t.y);
  if (previous === null || label.rx !== rx || label.ry !== ry || label.shifted !== shifted ||
      previous.rotate !== t.rotate || previous.anchor !== t.anchor || previous.baseline !== t.baseline) {
    label.rx = rx;
    label.ry = ry;
    label.shifted = shifted;
    label.el.style.transform = transform(t, rx / 100, ry, false, shifted);
  }
  if (previous?.lines !== t.lines && !(previous?.lines.length === 1 && t.lines.length === 1 && label.text0 === t.lines[0])) {
    renderLines(doc, label, t.lines);
  }
  label.placed = t;
}

function reconcileLabels(
  doc: Document, element: HTMLDivElement, labels: Label[], texts: readonly PlacedText[], start: number,
  available: (Label | undefined)[], stationary: (boolean | undefined)[], spare: SpareTicks, shift: number | null,
): void {
  // Match surviving text first so an entering tick cannot take a label needed farther along.
  let next = labels[labels.length - 1]!.el.nextSibling;
  for (let i = start; i < labels.length; i++) available.push(labels[i]);
  labels.length = texts.length;
  let lastMatch = -1;
  for (let i = start; i < texts.length; i++) {
    const t = texts[i]!;
    let match = -1;
    if (t.lines.length === 1) {
      for (let j = 0; j < available.length; j++) {
        const label = available[j];
        if (label?.role === t.role && label.placed?.lines.length === 1 && label.text0 === t.lines[0]) {
          match = j;
          break;
        }
      }
    }
    stationary[i] = undefined;
    if (match >= 0) {
      labels[i] = available[match]!;
      available[match] = undefined;
      stationary[i] = match > lastMatch;
      if (stationary[i]) lastMatch = match;
    }
  }
  for (let i = start; i < texts.length; i++) {
    const t = texts[i]!;
    let label = stationary[i] === undefined ? undefined : labels[i];
    if (label === undefined) {
      for (let j = 0; j < available.length; j++) {
        if (available[j]?.role !== t.role) continue;
        label = available[j];
        available[j] = undefined;
        break;
      }
      label ??= takeLabel(doc, t.role, spare);
    }
    labels[i] = label;
    renderLabel(doc, label, t, shift);
  }
  for (const label of available) if (label) releaseLabel(label, spare);
  available.length = 0;

  // Leave surviving ticks that are already in order mounted, even when the window slides.
  // The last managed label's former successor can be the chart's font probe.
  for (let i = labels.length - 1; i >= start; i--) {
    const { el } = labels[i]!;
    if (!stationary[i] && (el.parentNode !== element || el.nextSibling !== next)) element.insertBefore(el, next);
    next = el;
  }
  stationary.length = 0;
}

export function createTextLayer(doc: Document = document): TextLayer {
  const element = doc.createElement('div');
  element.className = 'axylo-text';
  element.setAttribute('aria-hidden', 'true');
  const labels: Label[] = [];
  const available: (Label | undefined)[] = [];
  const stationary: (boolean | undefined)[] = [];
  const spare: SpareTicks = { 'tick-x': undefined, 'tick-y': undefined };
  let previous: readonly PlacedText[] | null = null;
  let writtenShift: number | undefined;

  return {
    element,
    render(texts: readonly PlacedText[]): void {
      if (texts === previous) return;
      const shift = tickShift(labels, texts);
      if (shift !== null && shift !== writtenShift) {
        element.style.setProperty('--axylo-tick-dx', `${shift / 100}px`);
        writtenShift = shift;
      }
      const common = Math.min(labels.length, texts.length);
      for (let i = 0; i < common; i++) {
        const label = labels[i]!;
        const t = texts[i]!;
        const wasSingle = label.placed?.lines.length === 1;
        const isSingle = t.lines.length === 1;
        const canMatchElsewhere = i + 1 < labels.length || i + 1 < texts.length;
        if (label.role !== t.role || canMatchElsewhere && (wasSingle || isSingle) &&
            (!wasSingle || !isSingle || label.text0 !== t.lines[0])) {
          reconcileLabels(doc, element, labels, texts, i, available, stationary, spare, shift);
          previous = texts;
          return;
        }
        renderLabel(doc, label, t, shift);
      }
      if (labels.length < texts.length) {
        const fresh = doc.createDocumentFragment();
        for (let i = labels.length; i < texts.length; i++) {
          const t = texts[i]!;
          const label = takeLabel(doc, t.role, spare);
          renderLabel(doc, label, t, shift);
          labels.push(label);
          fresh.appendChild(label.el);
        }
        element.appendChild(fresh);
      }
      while (labels.length > texts.length) releaseLabel(labels.pop()!, spare);
      previous = texts;
    },
    destroy(): void {
      element.remove();
      labels.length = 0;
      spare['tick-x'] = spare['tick-y'] = undefined;
      previous = null;
    },
  };
}
