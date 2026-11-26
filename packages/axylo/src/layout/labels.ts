import type { LabelRemedy, PlacedText, Tick, TickCandidates, XScale } from '../core/contracts';

type Role = PlacedText['role'];
type Side = 'bottom' | 'left';

export interface Metrics {
  readonly lineHeight: number;
  width(text: string): number;
}

interface Label {
  readonly tick: Tick;
  readonly text: PlacedText;
}

export interface FittedLabels {
  readonly ticks: readonly Tick[];
  readonly texts: readonly PlacedText[];
  readonly depth: number;
  readonly remedies: readonly LabelRemedy[];
  /** No candidate set fitted whole: labels were dropped from the sparsest one (value axes, continuous x). */
  readonly partial?: boolean;
}

const EPSILON = 1e-7;
const OVERLAP_TOLERANCE = 0.9999999; // 1 - EPSILON, written out: no work at import time
const DIAGONAL = Math.SQRT1_2;
const ELLIPSIS = '…';
const NON_WHITESPACE = /\S/u;
const THINNED: readonly LabelRemedy[] = ['thinned'];
const NO_REMEDIES: readonly LabelRemedy[] = [];
/** Created on first use, not at import. */
let segmenter: Intl.Segmenter | null = null;

export function placeText(
  lines: readonly string[], full: string, x: number, y: number,
  anchor: PlacedText['anchor'], baseline: PlacedText['baseline'], rotate: 0 | -45 | -90,
  role: Role, metrics: Metrics, width = widest(lines, metrics),
): PlacedText {
  const height = lines.length * metrics.lineHeight;
  const left = anchor === 'start' ? 0 : anchor === 'middle' ? -width / 2 : -width;
  const top = baseline === 'top' ? 0 : baseline === 'middle' ? -height / 2 : -height;
  const sine = rotate === -45 ? DIAGONAL : rotate ? 1 : 0;
  const cosine = rotate === -45 ? DIAGONAL : rotate ? 0 : 1;
  return {
    lines, full, x, y, anchor, baseline, rotate, role,
    box: {
      x: x + left * cosine + top * sine,
      y: y - (left + width) * sine + top * cosine,
      width: width * cosine + height * sine,
      height: width * sine + height * cosine,
    },
  };
}

function widest(lines: readonly string[], metrics: Metrics): number {
  if (lines.length === 1) return Math.max(0, metrics.width(lines[0]!));
  let width = 0;
  for (const line of lines) width = Math.max(width, metrics.width(line));
  return width;
}

function graphemes(text: string): string[] {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Printable ASCII stands alone; even ASCII controls can cluster (CR followed by LF).
    if (code < 0x20 || code > 0x7e) {
      segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      return Array.from(segmenter.segment(text), part => part.segment);
    }
  }
  return text.split('');
}

export function wrapText(text: string, limit: number, metrics: Metrics, lineLimit = Infinity): string[] {
  if (metrics.width(text) <= limit && !text.includes('\n')) return [text];
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/u)) {
      const joined = line ? line + ' ' + word : word;
      if (metrics.width(joined) <= limit) {
        line = joined;
        continue;
      }
      if (line && lines.push(line) === lineLimit) return lines;
      if (metrics.width(word) <= limit) {
        line = word;
        continue;
      }
      line = '';
      for (const glyph of graphemes(word)) {
        if (line && metrics.width(line + glyph) > limit) {
          if (lines.push(line) === lineLimit) return lines;
          line = '';
        }
        line += glyph;
      }
    }
    if ((line || !paragraph.trim()) && lines.push(line) === lineLimit) return lines;
  }
  return lines;
}

function hasLabel(text: string): boolean {
  const first = text.charCodeAt(0);
  return (first > 0x20 && first <= 0x7e) || NON_WHITESPACE.test(text);
}

function wrapLabel(text: string, current: readonly string[], count: 2 | 3, metrics: Metrics): readonly string[] {
  let best = current;
  let width = widest(current, metrics);
  // Replace exactly one space at each break so the lines still identify the source.
  const search = (sliceFrom: number, searchFrom: number, parts: number, maxPrior: number, prior: string | null): void => {
    let end = searchFrom;
    for (let start = text.indexOf(' ', searchFrom); start >= 0; start = text.indexOf(' ', end)) {
      end = start + 1;
      while (text.charCodeAt(end) === 32) end++;
      const split = start + Math.floor((end - start - 1) / 2);
      const part = text.slice(sliceFrom, split);
      if (!hasLabel(part)) continue;
      const partWidth = metrics.width(part);
      if (partWidth >= width) break;
      const prefixWidth = Math.max(maxPrior, partWidth);
      if (parts > 2) {
        search(split + 1, end, parts - 1, prefixWidth, part);
        continue;
      }
      const last = text.slice(split + 1);
      const next = Math.max(prefixWidth, metrics.width(last));
      if (hasLabel(last) && next < width) {
        best = prior === null ? [part, last] : [prior, part, last];
        width = next;
      }
    }
  };
  search(0, 0, count, 0, null);
  return best;
}

export interface PreparedLabels {
  readonly sets: readonly (readonly Tick[])[];
  competingLabel(full: string, prefix: string, suffix: string): boolean;
}

const SMALL_SET = 12;

function findLabel(ticks: readonly Tick[], label: string, end = ticks.length): Tick | undefined {
  for (let i = 0; i < end; i++) {
    const tick = ticks[i]!;
    if (tick.label === label) return tick;
  }
}

export function prepareLabels(candidates: TickCandidates, count = candidates.length): PreparedLabels {
  const sets: (readonly Tick[])[] = [];
  const first = (candidates[0]?.length ?? 0) > SMALL_SET ? new Map<string, number>() : undefined;
  for (let index = 0; index < count; index++) {
    const ticks = candidates[index]!;
    const seen = index === 0 ? first : ticks.length > SMALL_SET ? new Map<string, number>() : undefined;
    let shown: Tick[] | undefined;
    for (let i = 0; i < ticks.length; i++) {
      const tick = ticks[i]!;
      const { label, value } = tick;
      // Sparser sets cannot reuse a label for a different value than the densest set.
      const original = index === 0 ? undefined : first ? first.get(label) : findLabel(sets[0]!, label)?.value;
      if (!hasLabel(label) || (seen ? seen.has(label) : findLabel(shown ?? ticks, label, shown?.length ?? i)) ||
          (original !== undefined && original !== value)) {
        shown ??= ticks.slice(0, i);
        continue;
      }
      seen?.set(label, value);
      shown?.push(tick);
    }
    sets.push(shown ?? ticks);
  }

  let originals: Set<string> | undefined;
  let byEnding: Map<string, string[]> | undefined;
  return {
    sets,
    competingLabel(full, prefix, suffix) {
      if (!originals) {
        originals = new Set();
        for (const ticks of sets) for (const tick of ticks) originals.add(tick.label);
        if (originals.size > 128) {
          byEnding = new Map();
          for (const original of originals) {
            const key = original.slice(-2);
            const bucket = byEnding.get(key);
            if (bucket) bucket.push(original);
            else byEnding.set(key, [original]);
          }
        }
      }
      for (const other of byEnding ? byEnding.get(suffix.slice(-2)) ?? [] : originals) {
        if (other !== full && other.endsWith(suffix) && other.startsWith(prefix)) return true;
      }
      return false;
    },
  };
}

function longestFit(low: number, high: number, limit: number, make: (kept: number) => string, metrics: Metrics): number {
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (metrics.width(make(middle)) <= limit) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function middleText(full: string, limit: number, labels: PreparedLabels, metrics: Metrics): string | undefined {
  limit += EPSILON;
  if (metrics.width(full) <= limit) return full;
  if (limit < metrics.width(ELLIPSIS) || full.length < 5) return undefined;
  const letters = graphemes(full);
  if (letters.length < 5) return undefined;
  const ends = [0];
  for (const letter of letters) ends.push(ends[ends.length - 1]! + letter.length);
  const prefix = (count: number) => full.slice(0, ends[count]);
  const suffix = (count: number) => full.slice(ends[letters.length - count]);
  const make = (front: number, back: number) => prefix(front) + ELLIPSIS + suffix(back);
  const distinct = (front: number, back: number) => !labels.competingLabel(full, prefix(front), suffix(back));
  if (metrics.width(make(2, 2)) > limit) return undefined;

  const maxKept = letters.length - 1;
  let maxFront = maxKept - 2;
  let maxBack = maxKept - 2;
  if (full.includes(ELLIPSIS)) {
    // Keep the inserted separator identifiable even if the source already has ellipses.
    while (maxFront >= 2 && prefix(maxFront).includes(ELLIPSIS)) maxFront--;
    while (maxBack >= 2 && suffix(maxBack).includes(ELLIPSIS)) maxBack--;
    if (maxFront < 2 || maxBack < 2) return undefined;
  }

  // A longer prefix or suffix can only eliminate competitors. Check the longest form
  // that fits, first balanced, then keeping more of either end for differences near the edge.
  const balanced = longestFit(4, Math.min(maxKept, 2 * maxFront, 2 * maxBack + 1), limit,
    kept => make(Math.ceil(kept / 2), Math.floor(kept / 2)), metrics);
  let front = Math.ceil(balanced / 2);
  let back = balanced - front;
  if (distinct(front, back)) return make(front, back);
  front = longestFit(2, maxFront, limit, kept => make(kept, 2), metrics);
  if (distinct(front, 2)) return make(front, 2);
  back = longestFit(2, maxBack, limit, kept => make(2, kept), metrics);
  if (distinct(2, back)) return make(2, back);

  // Some labels share a common prefix with one neighbour and a suffix with another.
  // As the prefix grows, the longest usable suffix only shrinks.
  let best: string | undefined;
  let bestKept = 0;
  let end = back;
  for (let start = 3; start <= front; start++) {
    end = Math.min(end, maxKept - start);
    while (end > 2 && metrics.width(make(start, end)) > limit) end--;
    if (end === 2) break;
    if (start + end > bestKept && distinct(start, end)) {
      best = make(start, end);
      bestKept = start + end;
    }
  }
  return best;
}

export function messageLines(message: string, width: number, maxLines: number, metrics: Metrics): string[] {
  if (maxLines < 1 || width <= 0 || !message.trim()) return [];
  const wrapped = wrapText(message, width, metrics, maxLines + 1);
  const oversized = wrapped.findIndex(line => metrics.width(line) > width);
  if (oversized < 0 && wrapped.length <= maxLines) return wrapped;
  if (metrics.width(ELLIPSIS) > width) return [];
  const last = Math.min(maxLines - 1, oversized < 0 ? maxLines - 1 : oversized);
  const letters = graphemes(wrapped[last]!);
  const make = (kept: number) => letters.slice(0, kept).join('').trimEnd() + ELLIPSIS;
  return [...wrapped.slice(0, last), make(longestFit(0, letters.length, width, make, metrics))];
}

function rotatedAnchor(pixel: number, width: number, height: number): number {
  return Math.min(pixel, width - DIAGONAL * height);
}

function bottomAnchor(pixel: number, span: number, width: number): number {
  const half = width / 2;
  return half * 2 <= span ? Math.max(half, Math.min(span - half, pixel)) : pixel;
}

function tickLabel(
  tick: Tick, pixel: number, side: Side, span: number, lines: readonly string[], rotate: 0 | -45,
  role: Role, metrics: Metrics,
): Label {
  if (side === 'left') return { tick, text: placeText(lines, tick.label, 0, pixel, 'end', 'middle', 0, role, metrics) };
  if (rotate) {
    const x = rotatedAnchor(pixel, span, lines.length * metrics.lineHeight);
    return { tick, text: placeText(lines, tick.label, x, 0, 'end', 'top', rotate, role, metrics) };
  }
  const width = widest(lines, metrics);
  const x = bottomAnchor(pixel, span, width);
  return { tick, text: placeText(lines, tick.label, x, 0, 'middle', 'top', 0, role, metrics, width) };
}

function position(scale: XScale, tick: Tick): number {
  return scale.type === 'band' ? scale.center(tick.value) : scale.map(tick.value);
}

function singleLineFits(
  ticks: readonly Tick[], scale: XScale, side: Side, span: number, room: number, gap: number, metrics: Metrics, measured: number[],
): boolean {
  if (ticks.length === 0) return true;
  const bottom = side === 'bottom', height = metrics.lineHeight;
  if (bottom && !(height <= room + EPSILON)) return false;
  const lastIndex = ticks.length - 1;
  const startPixel = position(scale, ticks[0]!);
  const endPixel = lastIndex ? position(scale, ticks[lastIndex]!) : startPixel;
  const forward = startPixel <= endPixel;
  let previousStart = -Infinity, end = -Infinity, unordered = false;
  for (let i = 0; i < ticks.length; i++) {
    const index = forward ? i : lastIndex - i;
    const tick = ticks[index]!;
    const width = Math.max(0, metrics.width(tick.label));
    const pixel = index === 0 ? startPixel : index === lastIndex ? endPixel : position(scale, tick);
    const anchor = bottom ? bottomAnchor(pixel, span, width) : pixel;
    const size = bottom ? width : height;
    measured[2 * index] = anchor;
    measured[2 * index + 1] = width;
    const first = anchor - size / 2, last = first + size;
    if (!(first >= -EPSILON && last <= span + EPSILON && (bottom || width <= room + EPSILON))) return false;
    if (first > previousStart || (forward && first === previousStart)) {
      if (first < end + gap - EPSILON) return false;
    } else {
      if (previousStart < last + gap - EPSILON) return false;
      unordered = true;
    }
    previousStart = first;
    end = last;
  }
  if (!unordered) return true;

  // Clamping or an unordered candidate can reverse interval starts. Check those pairs in either order.
  for (let i = 1; i < ticks.length; i++) {
    const size = bottom ? measured[2 * i + 1]! : height;
    const first = measured[2 * i]! - size / 2, last = first + size;
    for (let j = 0; j < i; j++) {
      const otherSize = bottom ? measured[2 * j + 1]! : height;
      const start = measured[2 * j]! - otherSize / 2, stop = start + otherSize;
      if (start <= first ? first < stop + gap - EPSILON : start < last + gap - EPSILON) return false;
    }
  }
  return true;
}

function singleLineResult(
  ticks: readonly Tick[], side: Side, role: Role, metrics: Metrics, measured: number[], remedies: readonly LabelRemedy[],
  bottomY = 0,
): FittedLabels {
  const bottom = side === 'bottom';
  const texts: PlacedText[] = [];
  let depth = bottom && ticks.length ? Math.max(0, metrics.lineHeight) : 0;
  for (let i = 0; i < ticks.length; i++) {
    const { label } = ticks[i]!;
    const anchor = measured[2 * i]!, width = measured[2 * i + 1]!;
    texts.push(placeText([label], label, bottom ? anchor : 0, bottom ? bottomY : anchor,
      bottom ? 'middle' : 'end', bottom ? 'top' : 'middle', 0, role, metrics, width));
    if (!bottom) depth = Math.max(depth, width);
  }
  return { ticks, texts, depth, remedies };
}

/** The winning horizontal set, with its anchors and widths left in the caller's scratch array. */
export function fitBottomLines(
  prepared: PreparedLabels, mayThin: boolean, scale: XScale, span: number, room: number, metrics: Metrics, measured: number[],
): number {
  const gap = mayThin ? 8 : 0;
  for (let i = 0; i < prepared.sets.length; i++) {
    if (singleLineFits(prepared.sets[i]!, scale, 'bottom', span, room, gap, metrics, measured)) return i;
  }
  return -1;
}

export function placeBottomLines(
  ticks: readonly Tick[], thinned: boolean, y: number, role: Role, metrics: Metrics, measured: number[],
): FittedLabels {
  return singleLineResult(ticks, 'bottom', role, metrics, measured, thinned ? THINNED : NO_REMEDIES, y);
}

function start(label: Label, side: Side): number {
  return side === 'bottom' ? label.text.box.x : label.text.box.y;
}

function extent(label: Label, side: Side): number {
  return side === 'bottom' ? label.text.box.width : label.text.box.height;
}

function depth(label: Label, side: Side): number {
  return side === 'bottom' ? label.text.box.height : label.text.box.width;
}

function fits(label: Label, side: Side, span: number, room: number): boolean {
  const first = start(label, side);
  return first >= -EPSILON && first + extent(label, side) <= span + EPSILON && depth(label, side) <= room + EPSILON;
}

function conflicts(labels: readonly Label[], side: Side, span: number, room: number, gap = 0): Set<Label> {
  const bad = new Set<Label>();
  const sorted = [...labels].sort((a, b) => start(a, side) - start(b, side));
  let farthest: Label | undefined;
  let end = -Infinity;
  for (const label of sorted) {
    const first = start(label, side);
    const last = first + extent(label, side);
    if (!fits(label, side, span, room)) bad.add(label);
    if (farthest && first < end + gap - EPSILON) {
      bad.add(farthest);
      bad.add(label);
    }
    if (last > end) {
      farthest = label;
      end = last;
    }
  }
  return bad;
}

function result(labels: readonly Label[], side: Side, remedies: readonly LabelRemedy[]): FittedLabels {
  let used = 0;
  for (const label of labels) used = Math.max(used, depth(label, side));
  return { ticks: labels.map(label => label.tick), texts: labels.map(label => label.text), depth: used, remedies };
}

function truncatedResult(ticks: readonly Tick[], kept: Map<Tick, Label>, side: Side, remedies: LabelRemedy[]): FittedLabels {
  const labels: Label[] = [];
  let truncated = false;
  for (const tick of ticks) {
    const label = kept.get(tick);
    if (!label) continue;
    labels.push(label);
    truncated ||= label.text.lines[0] !== tick.label;
  }
  if (truncated) remedies.push('truncated');
  return result(labels, side, remedies);
}

function byPosition(ticks: readonly Tick[], scale: XScale) {
  return ticks.map(tick => ({ tick, pixel: position(scale, tick) })).sort((a, b) => a.pixel - b.pixel);
}

function spread(ticks: readonly Tick[], span: number, footprint: number): readonly Tick[] {
  const capacity = Math.max(1, Math.floor(span / Math.max(1, footprint)));
  // Dense band positions are evenly spaced. Start at the centre of each group to
  // distribute the candidates without trying fitting remedies for every tick.
  if (ticks.length <= 4 * capacity) return ticks;
  return Array.from({ length: capacity }, (_, i) => ticks[Math.floor((i + 0.5) * ticks.length / capacity)]!);
}

function truncate(
  ticks: readonly Tick[], prepared: PreparedLabels, scale: XScale, side: Side, span: number, room: number,
  role: Role, metrics: Metrics, remedies: LabelRemedy[],
): FittedLabels {
  const bottom = side === 'bottom';
  const { lineHeight } = metrics;
  const kept = new Map<Tick, Label>();
  let edge = bottom ? -Infinity : 0;
  for (const { tick, pixel } of byPosition(ticks, scale)) {
    // An earlier edge leaves more room for the next label.
    const anchor = bottom ? rotatedAnchor(pixel, span, lineHeight) : pixel - lineHeight / 2;
    const next = anchor + (bottom ? DIAGONAL * lineHeight : lineHeight);
    if (!bottom && (anchor < edge - EPSILON || next > span + EPSILON)) continue;
    const limit = bottom
      ? Math.min((anchor - Math.max(0, edge - OVERLAP_TOLERANCE)) / DIAGONAL, room / DIAGONAL - lineHeight)
      : room;
    if (bottom && limit < 0) continue;
    const shown = middleText(tick.label, limit, prepared, metrics);
    if (shown === undefined) continue;
    kept.set(tick, tickLabel(tick, pixel, side, span, [shown], bottom ? -45 : 0, role, metrics));
    edge = next;
  }
  const fitted = truncatedResult(ticks, kept, side, remedies);
  // A continuous axis that drops ticks may need a wider domain to end at drawn ticks.
  return bottom && scale.type !== 'band' && kept.size < ticks.length ? { ...fitted, partial: true } : fitted;
}

export function fitBottom(
  candidates: TickCandidates, mayThin: boolean, scale: XScale, width: number, room: number,
  role: Role, metrics: Metrics, prepared = prepareLabels(mayThin ? candidates : candidates.slice(0, 1)),
  rotatedRoom = room, measured: number[] = [], tryHorizontal = true,
): FittedLabels {
  const remedies: LabelRemedy[] = [];
  let ticks = prepared.sets[0] ?? [];

  if (!mayThin && scale.type === 'band') {
    const span = Math.abs(scale.range[1] - scale.range[0]);
    const footprint = DIAGONAL * (metrics.lineHeight + metrics.width('ii…ii'));
    const sampled = spread(ticks, span, footprint);
    if (sampled !== ticks) {
      return truncate(sampled, prepared, scale, 'bottom', width, rotatedRoom, role, metrics, ['rotated']);
    }
  }

  const fitted = tryHorizontal ? fitBottomLines(prepared, mayThin, scale, width, room, metrics, measured) : -1;
  if (fitted >= 0) return placeBottomLines(prepared.sets[fitted]!, fitted > 0, 0, role, metrics, measured);
  ticks = prepared.sets.at(-1) ?? ticks;
  if (prepared.sets.length > 1) remedies.push('thinned');

  let labels = ticks.map(tick => tickLabel(tick, position(scale, tick), 'bottom', width, [tick.label], 0, role, metrics));
  let bad = conflicts(labels, 'bottom', width, room);
  if (bad.size === 0) return result(labels, 'bottom', remedies);
  const oneLine = labels;
  let twoLines = labels;
  for (const count of [2, 3] as const) {
    if (count * metrics.lineHeight > room + EPSILON) break;
    labels = labels.map(label => {
      if (!bad.has(label)) return label;
      const lines = wrapLabel(label.tick.label, label.text.lines, count, metrics);
      return lines === label.text.lines ? label : tickLabel(label.tick, position(scale, label.tick), 'bottom', width, lines, 0, role, metrics);
    });
    if (count === 2) twoLines = labels;
    bad = conflicts(labels, 'bottom', width, room);
    if (bad.size === 0) {
      // Once the long labels fit, some neighbours can go back to fewer lines.
      for (const [i, label] of labels.entries()) {
        for (const shorter of [oneLine[i]!, twoLines[i]!]) {
          if (shorter.text.lines.length >= label.text.lines.length) break;
          const { x, width: span } = shorter.text.box;
          if (fits(shorter, 'bottom', width, room) && !labels.some((other, j) =>
            j !== i && x < other.text.box.x + other.text.box.width - EPSILON &&
            other.text.box.x < x + span - EPSILON)) {
            labels[i] = shorter;
            break;
          }
        }
      }
      return result(labels, 'bottom', [...remedies, 'wrapped']);
    }
  }
  if (labels.some(label => label.text.lines.length > 1)) remedies.push('wrapped');

  labels = labels.map(({ tick, text }) => tickLabel(tick, position(scale, tick), 'bottom', width, text.lines, -45, role, metrics));
  remedies.push('rotated');
  if (conflicts(labels, 'bottom', width, rotatedRoom).size === 0) return result(labels, 'bottom', remedies);
  return truncate(ticks, prepared, scale, 'bottom', width, rotatedRoom, role, metrics, remedies);
}

export function fitLeftCategories(
  ticks: readonly Tick[], scale: XScale, width: number, height: number, role: Role, metrics: Metrics,
  room = Infinity, prepared = prepareLabels([ticks]),
): FittedLabels {
  const unique = prepared.sets[0] ?? [];
  const sampled = spread(unique, Math.abs(scale.range[1] - scale.range[0]), metrics.lineHeight);
  return truncate(sampled, prepared, scale, 'left', height, Math.min(width * 0.4, room), role, metrics, []);
}

export function fitValue(
  candidates: TickCandidates, scale: XScale, side: Side, span: number, room: number, role: Role, metrics: Metrics,
  prepared = prepareLabels(candidates), measured: number[] = [],
): FittedLabels {
  const gap = metrics.lineHeight / 2;
  let ticks: readonly Tick[] = [];
  for (let i = 0; i < prepared.sets.length; i++) {
    ticks = prepared.sets[i]!;
    if (singleLineFits(ticks, scale, side, span, room, gap, metrics, measured)) {
      return singleLineResult(ticks, side, role, metrics, measured, i ? THINNED : NO_REMEDIES);
    }
  }

  const labels = ticks.map(tick => tickLabel(tick, position(scale, tick), side, span, [tick.label], 0, role, metrics));
  const sorted = [...labels].sort((a, b) => start(a, side) + extent(a, side) - start(b, side) - extent(b, side));
  const kept = new Set<Label>();
  let edge = -Infinity;
  for (const label of sorted) {
    const first = start(label, side);
    if (first < edge + gap || !fits(label, side, span, room)) continue;
    kept.add(label);
    edge = first + extent(label, side);
  }
  return { ...result(labels.filter(label => kept.has(label)), side, candidates.length > 1 ? ['thinned'] : []), partial: true };
}
