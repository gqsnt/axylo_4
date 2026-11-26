/**
 * The DOM text layer (plan 2.3): tick labels, titles and messages as real HTML text, so they inherit the
 * page font and color, honour the reader's text spacing (spec A6) and adapt to forced colors. The layer is
 * aria-hidden; readers get the same information from the summary and table.
 *
 * Each label is one absolutely positioned element with one block child per line. An unrotated top-left
 * anchor can use offsets directly. Other anchors need the element's own dimensions to align the text.
 * Elements are reused between renders. Text is only ever set through textContent (spec DX8), and render
 * writes without reading layout.
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
  line0: HTMLDivElement | null;
  text0: string;
  lines: HTMLDivElement[] | null;
  text: string[] | null;
}

type TickRole = 'tick-x' | 'tick-y';
type SpareTicks = Partial<Record<TickRole, Label>>;

const LABEL_CLASS = { start: 'axylo-label axylo-label-start', middle: 'axylo-label axylo-label-middle', end: 'axylo-label' } as const;
const SHIFT_X = { start: '0%', middle: '-50%', end: '-100%' } as const;
const SHIFT_Y = { top: '0%', middle: '-50%', bottom: '-100%' } as const;

const round = (v: number): number => Math.round(v * 100) / 100;

// Transforms apply right to left: align the text at the origin, rotate, then position it.
function transformEnd(t: PlacedText, y: number): string {
  const rotate = t.rotate !== 0 ? ` rotate(${t.rotate}deg)` : '';
  const end = `px,${y}px)${rotate}`;
  return t.anchor === 'start' && t.baseline === 'top'
    ? end : `${end} translate(${SHIFT_X[t.anchor]},${SHIFT_Y[t.baseline]})`;
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
  el.setAttribute('data-role', role);
  return { el, role, placed: null, baseX: NaN, sliding: false, rx: NaN, ry: NaN, line0: null, text0: '', lines: null, text: null };
}

function takeLabel(doc: Document, role: PlacedText['role'], spare?: SpareTicks): Label {
  if (spare && (role === 'tick-x' || role === 'tick-y')) {
    const label = spare[role];
    if (label) {
      spare[role] = undefined;
      // A recycled tick keeps its style history but cannot serve as a survivor for a group slide.
      label.baseX = NaN;
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

function usesOffsets(t: PlacedText): boolean {
  return t.rotate === 0 && t.anchor === 'start' && t.baseline === 'top';
}

function renderLabel(doc: Document, label: Label, t: PlacedText, x = t.x): void {
  const previous = label.placed;
  if (previous === t && label.baseX === x) return;
  const rx = label.baseX === x ? label.rx : round(x);
  label.baseX = x;
  const ry = previous?.y === t.y ? label.ry : round(t.y);
  const anchorChanged = previous?.anchor !== t.anchor;
  if (anchorChanged) label.el.className = LABEL_CLASS[t.anchor];
  const endChanged = anchorChanged || label.ry !== ry || previous?.rotate !== t.rotate || previous.baseline !== t.baseline;
  if (endChanged || label.rx !== rx) {
    const style = label.el.style, wasOffset = previous !== null && usesOffsets(previous);
    if (usesOffsets(t)) {
      if (previous && !wasOffset) style.transform = '';
      if (!wasOffset || label.rx !== rx) style.setProperty('left', `${rx}px`);
      if (!wasOffset || label.ry !== ry) style.setProperty('top', `${ry}px`);
    } else {
      if (wasOffset) {
        style.setProperty('left', '');
        style.setProperty('top', '');
      }
      style.transform = `translate(${rx}${transformEnd(t, ry)}`;
    }
    label.rx = rx;
    label.ry = ry;
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
    if (!old || Number.isNaN(label.baseX)) continue;
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
    // Even on a later mismatch this prefix already has the correct text and local positions.
    label.placed = t;
  }
  return round(dx);
}

class DomTextLayer implements TextLayer {
  readonly element: HTMLDivElement;
  readonly #labels: Label[] = [];
  #tickGroup: HTMLDivElement | null = null;
  #groupDx = 0;
  #tickStart = 0;
  #tickEnd = -1;
  #spare?: SpareTicks;
  #previous: readonly PlacedText[] | null = null;

  readonly #doc: Document;

  constructor(doc: Document) {
    this.#doc = doc;
    this.element = doc.createElement('div');
    this.element.className = 'axylo-text';
    this.element.setAttribute('aria-hidden', 'true');
  }

  render(texts: readonly PlacedText[]): void {
    const { element } = this, labels = this.#labels, doc = this.#doc;
    if (texts === this.#previous) return;
    const count = labels.length;
    if (this.#tickGroup && count && count === texts.length) {
      const dx = unchangedSlide(labels, texts, this.#tickStart, this.#tickEnd);
      if (dx !== null) {
        if (dx !== this.#groupDx) this.#tickGroup.style.transform = dx ? `translate(${dx}px,0px)` : '';
        this.#groupDx = dx;
        this.#previous = texts;
        return;
      }
    }
    if (!count) {
      this.#tickEnd = -1;
      if (texts.length) {
        const fresh = doc.createDocumentFragment();
        for (const t of texts) {
          const label = takeLabel(doc, t.role, this.#spare);
          renderLabel(doc, label, t);
          labels.push(label);
          fresh.appendChild(label.el);
        }
        if (element.firstChild) element.insertBefore(fresh, element.firstChild);
        else element.appendChild(fresh);
      }
      this.#previous = texts;
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
        moving = reconcileLabels(doc, labels, texts, i, this.#spare ??= {});
        reorder = true;
        break;
      }
    }
    while (labels.length < texts.length) labels.push(takeLabel(doc, texts[labels.length]!.role, this.#spare));
    while (labels.length > texts.length) releaseLabel(labels.pop()!, this.#spare ??= {});

    if (reorder || this.#tickEnd < 0) {
      this.#tickStart = 0;
      while (this.#tickStart < texts.length && texts[this.#tickStart]!.role !== 'tick-x') this.#tickStart++;
      this.#tickEnd = this.#tickStart;
      while (this.#tickEnd < texts.length && texts[this.#tickEnd]!.role === 'tick-x') this.#tickEnd++;
      // A single wrapper can preserve paint order only for a contiguous run of ticks.
      for (let i = this.#tickEnd; i < texts.length; i++) {
        if (texts[i]!.role === 'tick-x') { this.#tickEnd = this.#tickStart; break; }
      }
    }
    const groupable = this.#tickEnd - this.#tickStart >= 2;
    const slide = groupable ? slideOffset(labels, texts, this.#tickStart, this.#tickEnd, this.#tickGroup ? 1 : 2) : null;
    const dx = round(slide ?? 0);
    if (!this.#tickGroup && dx !== 0) {
      this.#tickGroup = doc.createElement('div');
      this.#tickGroup.className = 'axylo-tick-x-group';
      reorder = true;
    } else if (this.#tickGroup && !groupable) {
      this.#tickGroup.remove();
      this.#tickGroup = null;
      reorder = true;
    }
    if (this.#tickGroup && dx !== this.#groupDx) this.#tickGroup.style.transform = dx ? `translate(${dx}px,0px)` : '';
    this.#groupDx = dx;
    for (let i = 0; i < texts.length; i++) {
      const label = labels[i]!, t = texts[i]!;
      if (this.#tickGroup && i >= this.#tickStart && i < this.#tickEnd && slide !== null) {
        // A survivor's existing local position already puts it at its base. Only an entering
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
        if (this.#tickGroup && i >= this.#tickStart && i < this.#tickEnd) {
          if (el.parentNode !== this.#tickGroup || moving?.has(label)) placeBefore(this.#tickGroup, el, nextTick);
          nextTick = el;
          if (i !== this.#tickStart) continue;
          placeBefore(element, this.#tickGroup, next);
          next = this.#tickGroup;
        } else {
          if (el.parentNode !== element || moving?.has(label)) placeBefore(element, el, next);
          next = el;
        }
      }
    }
    this.#previous = texts;
  }

  destroy(): void {
    this.element.remove();
    this.#labels.length = 0;
    this.#spare = undefined;
    this.#previous = null;
  }
}

export function createTextLayer(doc: Document = document): TextLayer {
  return new DomTextLayer(doc);
}
