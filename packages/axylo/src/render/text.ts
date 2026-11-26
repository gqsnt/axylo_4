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
  baseX: number;
  sliding: boolean;
  rx: number;
  ry: number;
  transformEnd: string;
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

// Transforms apply right to left: align the text at the origin, rotate, then position it.
// A bottom tick sliding horizontally can reuse everything following its x coordinate.
function transformEnd(t: PlacedText, y: number, keepZeroShift = false): string {
  const rotate = t.rotate !== 0 ? ` rotate(${t.rotate}deg)` : '';
  const end = `px,${y}px)${rotate}`;
  return !keepZeroShift && t.anchor === 'start' && t.baseline === 'top'
    ? end : `${end} translate(${SHIFT_X[t.anchor]},${SHIFT_Y[t.baseline]})`;
}

export function labelStyle(t: PlacedText): string {
  return `${POSITION}text-align:${ALIGN[t.anchor]};transform:translate(${round(t.x)}${transformEnd(t, round(t.y), true)}`;
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
  return { el, role, placed: null, baseX: NaN, sliding: false, rx: NaN, ry: NaN, transformEnd: '', line0: null, text0: '', lines: null, text: null };
}

function takeLabel(doc: Document, role: PlacedText['role'], spare: SpareTicks): Label {
  if (role === 'tick-x' || role === 'tick-y') {
    const label = spare[role];
    if (label) {
      spare[role] = undefined;
      label.placed = null;
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

function renderLabel(doc: Document, label: Label, t: PlacedText, x = t.x): void {
  const previous = label.placed;
  if (previous === t && label.baseX === x) return;
  const rx = label.baseX === x ? label.rx : round(x);
  label.baseX = x;
  const ry = previous?.y === t.y ? label.ry : round(t.y);
  const anchorChanged = previous?.anchor !== t.anchor;
  if (anchorChanged) label.el.style.textAlign = ALIGN[t.anchor];
  const endChanged = anchorChanged || label.ry !== ry || previous?.rotate !== t.rotate || previous.baseline !== t.baseline;
  if (endChanged || label.rx !== rx) {
    if (endChanged) label.transformEnd = transformEnd(t, ry);
    label.rx = rx;
    label.ry = ry;
    label.el.style.transform = `translate(${rx}${label.transformEnd}`;
  }
  if (previous?.lines !== t.lines && !sameLines(label, t)) {
    renderLines(doc, label, t.lines);
  }
  label.placed = t;
}

function sameSingleLine(label: Label, t: PlacedText): boolean {
  return t.lines.length === 1 && label.line0 !== null && label.lines === null && t.lines[0] === label.text0;
}

function sameLines(label: Label, t: PlacedText): boolean {
  if (label.line0 === null) return t.lines.length === 0;
  if (label.text0 !== t.lines[0]) return false;
  const tail = label.text;
  if (tail === null) return t.lines.length === 1;
  if (tail.length !== t.lines.length - 1) return false;
  for (let j = 0; j < tail.length; j++) if (tail[j] !== t.lines[j + 1]) return false;
  return true;
}

function reconcileLabels(
  doc: Document, labels: Label[], texts: readonly PlacedText[], start: number,
  spare: SpareTicks,
): Set<Label> {
  // Match surviving text first so an entering tick cannot take a label needed farther along.
  const available: (Label | undefined)[] = labels.slice(start);
  labels.length = start;
  const matched: (Label | undefined)[] = [];
  const moving = new Set<Label>();
  let lastMatch = -1;
  // Reverse indexes form a FIFO for duplicate labels without shifting arrays.
  const roles = new Map<PlacedText['role'], { byText: Map<string, number>; cursor: number }>();
  const duplicates: (number | undefined)[] = [];
  for (let j = available.length - 1; j >= 0; j--) {
    const label = available[j]!;
    let role = roles.get(label.role);
    if (!role) roles.set(label.role, role = { byText: new Map(), cursor: 0 });
    if (label.placed?.lines.length === 1) {
      const next = role.byText.get(label.text0);
      if (next !== undefined) duplicates[j] = next;
      role.byText.set(label.text0, j);
    }
  }

  for (let i = start; i < texts.length; i++) {
    const t = texts[i]!;
    const matches = t.lines.length === 1 ? roles.get(t.role)?.byText : undefined;
    const key = t.lines[0]!;
    const match = matches?.get(key) ?? -1;
    if (match >= 0) {
      const nextMatch = duplicates[match];
      if (nextMatch === undefined) matches!.delete(key);
      else matches!.set(key, nextMatch);
      const label = available[match]!;
      matched[i - start] = label;
      if (match < lastMatch) moving.add(label);
      else lastMatch = match;
      available[match] = undefined;
    }
  }
  for (let i = start; i < texts.length; i++) {
    const t = texts[i]!;
    let label = matched[i - start];
    if (label === undefined) {
      const group = roles.get(t.role);
      while (group && group.cursor < available.length) {
        const j = group.cursor++;
        if (available[j]?.role !== t.role) continue;
        label = available[j];
        available[j] = undefined;
        break;
      }
      label ??= takeLabel(doc, t.role, spare);
      moving.add(label);
    }
    labels.push(label);
  }
  for (const label of available) if (label) releaseLabel(label, spare);
  return moving;
}

// Use unrounded bases for this comparison. The individual CSS translations were rounded independently.
function slideOffset(
  labels: Label[], texts: readonly PlacedText[], start: number, end: number, minimum: number,
): number | null {
  let dx = 0, survivors = 0;
  for (let i = start; i < end; i++) {
    const label = labels[i]!, t = texts[i]!, old = label.placed;
    label.sliding = false;
    if (!old) continue;
    if (old.lines !== t.lines && !sameSingleLine(label, t)) {
      if (old.lines.length !== t.lines.length || !old.lines.every((line, j) => line === t.lines[j])) continue;
    }
    const offset = t.x - label.baseX;
    if (!Number.isFinite(offset) || t.y !== old.y || t.rotate !== old.rotate ||
        t.anchor !== old.anchor || t.baseline !== old.baseline ||
        (survivors > 0 && Math.abs(offset - dx) > 0.005)) return null;
    if (survivors === 0) dx = offset;
    survivors++;
    label.sliding = true;
  }
  return survivors >= minimum ? dx : null;
}

function placeBefore(parent: HTMLDivElement, el: HTMLDivElement, next: ChildNode | null): void {
  if (el.parentNode !== parent || el.nextSibling !== next) parent.insertBefore(el, next);
}

function unchangedSlide(labels: Label[], texts: readonly PlacedText[], start: number, end: number): number | null {
  const dx = texts[start]!.x - labels[start]!.baseX;
  if (!Number.isFinite(dx)) return null;
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i]!, label = labels[i]!, old = label.placed!;
    if (i >= start && i < end) {
      // Compare to the original local positions so subpixel differences never accumulate.
      if (!(Math.abs((t.x - label.baseX) - dx) <= 0.005)) return null;
    } else if (t.x !== label.baseX) return null;
    if (old === t) continue;
    if (t.role !== label.role || t.y !== old.y || t.anchor !== old.anchor || t.rotate !== old.rotate ||
        t.baseline !== old.baseline || (t.lines !== old.lines && !sameLines(label, t))) return null;
    // Even on a later mismatch this prefix already has the correct text and local transforms.
    label.placed = t;
  }
  return round(dx);
}

export function createTextLayer(doc: Document = document): TextLayer {
  const element = doc.createElement('div');
  element.className = 'axylo-text';
  element.setAttribute('aria-hidden', 'true');
  const labels: Label[] = [];
  let tickGroup: HTMLDivElement | null = null;
  let groupDx = 0, tickStart = 0, tickEnd = -1;
  const spare: SpareTicks = { 'tick-x': undefined, 'tick-y': undefined };
  let previous: readonly PlacedText[] | null = null;

  return {
    element,
    render(texts: readonly PlacedText[]): void {
      if (texts === previous) return;
      const count = labels.length;
      if (tickGroup && count && count === texts.length) {
        const dx = unchangedSlide(labels, texts, tickStart, tickEnd);
        if (dx !== null) {
          if (dx !== groupDx) tickGroup.style.transform = dx ? `translate(${dx}px,0px)` : '';
          groupDx = dx;
          previous = texts;
          return;
        }
      }
      if (!count) {
        tickEnd = -1;
        if (texts.length) {
          const fresh = doc.createDocumentFragment();
          for (const t of texts) {
            const label = takeLabel(doc, t.role, spare);
            renderLabel(doc, label, t);
            labels.push(label);
            fresh.appendChild(label.el);
          }
          if (element.firstChild) element.insertBefore(fresh, element.firstChild);
          else element.appendChild(fresh);
        }
        previous = texts;
        return;
      }

      let reorder = count !== texts.length;
      let moving: Set<Label> | undefined;
      const common = Math.min(count, texts.length);
      for (let i = 0; i < common; i++) {
        const label = labels[i]!, t = texts[i]!;
        if (label.placed === t) continue;
        if (label.role !== t.role || (i + 1 < count || i + 1 < texts.length) &&
            (label.placed?.lines.length === 1 || t.lines.length === 1) && !sameSingleLine(label, t)) {
          moving = reconcileLabels(doc, labels, texts, i, spare);
          reorder = true;
          break;
        }
      }
      while (labels.length < texts.length) labels.push(takeLabel(doc, texts[labels.length]!.role, spare));
      while (labels.length > texts.length) releaseLabel(labels.pop()!, spare);

      if (reorder || tickEnd < 0) {
        tickStart = 0;
        while (tickStart < texts.length && texts[tickStart]!.role !== 'tick-x') tickStart++;
        tickEnd = tickStart;
        while (tickEnd < texts.length && texts[tickEnd]!.role === 'tick-x') tickEnd++;
        // A single wrapper can preserve paint order only for a contiguous run of ticks.
        for (let i = tickEnd; i < texts.length; i++) {
          if (texts[i]!.role === 'tick-x') { tickEnd = tickStart; break; }
        }
      }
      const groupable = tickEnd - tickStart >= 2;
      const slide = groupable ? slideOffset(labels, texts, tickStart, tickEnd, tickGroup ? 1 : 2) : null;
      const dx = round(slide ?? 0);
      if (!tickGroup && dx !== 0) {
        tickGroup = doc.createElement('div');
        tickGroup.className = 'axylo-tick-x-group';
        tickGroup.style.cssText = 'position:absolute;inset:0;pointer-events:none;contain:layout style';
        reorder = true;
      } else if (tickGroup && !groupable) {
        tickGroup.remove();
        tickGroup = null;
        reorder = true;
      }
      if (tickGroup && dx !== groupDx) tickGroup.style.transform = dx ? `translate(${dx}px,0px)` : '';
      groupDx = dx;
      for (let i = 0; i < texts.length; i++) {
        const label = labels[i]!, t = texts[i]!;
        if (tickGroup && i >= tickStart && i < tickEnd && slide !== null) {
          // A survivor's existing local transform already puts it at its base. Only an entering
          // label needs its position expressed in the group's coordinate system.
          if (label.sliding) label.placed = t;
          else renderLabel(doc, label, t, t.x - slide);
        } else renderLabel(doc, label, t);
      }
      if (reorder) {
        const tail = element.lastElementChild;
        let next: ChildNode | null = tail?.className === 'axylo-font-probe' ? tail : null;
        let nextTick: ChildNode | null = null;
        for (let i = labels.length - 1; i >= 0; i--) {
          const label = labels[i]!, el = label.el;
          if (tickGroup && i >= tickStart && i < tickEnd) {
            if (el.parentNode !== tickGroup || moving?.has(label)) placeBefore(tickGroup, el, nextTick);
            nextTick = el;
            if (i !== tickStart) continue;
            placeBefore(element, tickGroup, next);
            next = tickGroup;
          } else {
            if (el.parentNode !== element || moving?.has(label)) placeBefore(element, el, next);
            next = el;
          }
        }
      }
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
