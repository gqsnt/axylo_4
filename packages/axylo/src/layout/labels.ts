import type { AxisLabelFit, LabelRemedy, PlacedText, Tick, TickCandidates, XScale } from '../core/contracts';

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
  readonly fit: AxisLabelFit;
}

const EPSILON = 1e-7;
const OVERLAP_TOLERANCE = 1 - EPSILON;
const DIAGONAL = Math.SQRT1_2;
const ELLIPSIS = '…';
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function placeText(
  lines: readonly string[], full: string, x: number, y: number,
  anchor: PlacedText['anchor'], baseline: PlacedText['baseline'], rotate: 0 | -45 | -90,
  role: Role, metrics: Metrics,
): PlacedText {
  const width = widest(lines, metrics);
  const height = lines.length * metrics.lineHeight;
  const left = anchor === 'start' ? 0 : anchor === 'middle' ? -width / 2 : -width;
  const top = baseline === 'top' ? 0 : baseline === 'middle' ? -height / 2 : -height;
  const sine = rotate === 0 ? 0 : rotate === -45 ? DIAGONAL : 1;
  const cosine = rotate === 0 ? 1 : rotate === -45 ? DIAGONAL : 0;
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
  let width = 0;
  for (const line of lines) width = Math.max(width, metrics.width(line));
  return width;
}

function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), part => part.segment);
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
      line = '';
      if (metrics.width(word) <= limit) {
        line = word;
        continue;
      }
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

function wrapLabel(text: string, metrics: Metrics): readonly string[] {
  let best: readonly string[] = [text];
  let width = metrics.width(text);
  for (const space of text.matchAll(/ +/gu)) {
    // Use the line break for one space so that the two lines still identify the source.
    const split = space.index + Math.floor((space[0].length - 1) / 2);
    const first = text.slice(0, split);
    const last = text.slice(split + 1);
    if (!first.trim() || !last.trim()) continue;
    const next = Math.max(metrics.width(first), metrics.width(last));
    if (next < width) {
      best = [first, last];
      width = next;
    }
  }
  return best;
}

export interface PreparedLabels {
  readonly sets: readonly { readonly ticks: readonly Tick[]; readonly hidden: number }[];
  competingLabel(full: string, prefix: string, suffix: string): boolean;
}

export function prepareLabels(candidates: TickCandidates): PreparedLabels {
  const originals = new Set<string>();
  const first = new Map<string, number>();
  const hiddenAtFullDensity = new Map<string, Set<number>>();
  let denseHidden = 0;
  const sets = candidates.map((ticks, index) => {
    const shown: Tick[] = [];
    let hidden = denseHidden;
    const seen = index === 0 ? first : new Map<string, number>();
    for (const tick of ticks) {
      const { label, value } = tick;
      if (!label.trim() || seen.has(label) || (first.has(label) && first.get(label) !== value)) {
        if (index === 0) {
          const rejected = hiddenAtFullDensity.get(label);
          if (rejected) rejected.add(value);
          else hiddenAtFullDensity.set(label, new Set([value]));
          hidden++;
        } else if (!hiddenAtFullDensity.get(label)?.has(value)) {
          hidden++;
        }
        continue;
      }
      originals.add(label);
      seen.set(label, value);
      shown.push(tick);
    }
    if (index === 0) denseHidden = hidden;
    return { ticks: shown, hidden };
  });

  let byEnding: Map<string, string[]> | undefined;
  return {
    sets,
    competingLabel(full, prefix, suffix) {
      if (!byEnding && originals.size > 128) {
        byEnding = new Map();
        for (const original of originals) {
          const key = original.slice(-2);
          const bucket = byEnding.get(key);
          if (bucket) bucket.push(original);
          else byEnding.set(key, [original]);
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

function middleText(full: string, limit: number, labels: PreparedLabels, metrics: Metrics): string | undefined {
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
  const front = Math.ceil(balanced / 2);
  const back = Math.floor(balanced / 2);
  if (distinct(front, back)) return make(front, back);
  const longestFront = longestFit(2, maxFront, limit, kept => make(kept, 2), metrics);
  if (distinct(longestFront, 2)) return make(longestFront, 2);
  const longestBack = longestFit(2, maxBack, limit, kept => make(2, kept), metrics);
  if (distinct(2, longestBack)) return make(2, longestBack);

  // Some labels share a common prefix with one neighbour and a suffix with another.
  // As the prefix grows, the longest usable suffix only shrinks.
  let best: string | undefined;
  let bestKept = 0;
  let end = longestBack;
  for (let start = 3; start <= longestFront; start++) {
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

function bottomLabel(
  tick: Tick, pixel: number, width: number, lines: readonly string[], rotate: 0 | -45,
  role: Role, metrics: Metrics,
): Label {
  const half = widest(lines, metrics) / 2;
  const x = rotate === -45 ? rotatedAnchor(pixel, width, lines.length * metrics.lineHeight)
    : half * 2 <= width ? Math.max(half, Math.min(width - half, pixel)) : pixel;
  const anchor = rotate === 0 ? 'middle' : 'end';
  return { tick, text: placeText(lines, tick.label, x, 0, anchor, 'top', rotate, role, metrics) };
}

function leftLabel(tick: Tick, pixel: number, shown: string, role: Role, metrics: Metrics): Label {
  return { tick, text: placeText([shown], tick.label, 0, pixel, 'end', 'middle', 0, role, metrics) };
}

function position(scale: XScale, tick: Tick): number {
  return scale.type === 'band' ? scale.center(tick.value) : scale.map(tick.value);
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
    if (!fits(label, side, span, room)) bad.add(label);
    if (farthest && first < end + gap - EPSILON) {
      bad.add(farthest);
      bad.add(label);
    }
    if (first + extent(label, side) > end) {
      farthest = label;
      end = first + extent(label, side);
    }
  }
  return bad;
}

function result(labels: readonly Label[], side: Side, remedies: readonly LabelRemedy[], hidden = 0): FittedLabels {
  let used = 0;
  for (const label of labels) used = Math.max(used, depth(label, side));
  return { ticks: labels.map(label => label.tick), texts: labels.map(label => label.text), depth: used, fit: { remedies, hidden } };
}

function inSourceOrder(ticks: readonly Tick[], labels: Map<Tick, Label>): Label[] {
  return ticks.flatMap(tick => {
    const label = labels.get(tick);
    return label ? [label] : [];
  });
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

function truncateBottom(
  ticks: readonly Tick[], prepared: PreparedLabels, scale: XScale, width: number, room: number,
  role: Role, metrics: Metrics, remedies: LabelRemedy[], total: number,
): FittedLabels {
  const kept = new Map<Tick, Label>();
  let edge = -Infinity;
  for (const { tick, pixel } of byPosition(ticks, scale)) {
    // With one line, the right edge depends only on the anchor. Keeping the earliest
    // feasible edge leaves the most room for the labels that follow it.
    const anchor = rotatedAnchor(pixel, width, metrics.lineHeight);
    const limit = Math.min((anchor - Math.max(0, edge - OVERLAP_TOLERANCE)) / DIAGONAL,
      room / DIAGONAL - metrics.lineHeight);
    if (limit < 0) continue;
    const shown = middleText(tick.label, limit, prepared, metrics);
    if (shown === undefined) continue;
    kept.set(tick, bottomLabel(tick, pixel, width, [shown], -45, role, metrics));
    edge = anchor + DIAGONAL * metrics.lineHeight;
  }
  if ([...kept.values()].some(label => label.text.lines[0] !== label.tick.label)) remedies.push('truncated');
  return result(inSourceOrder(ticks, kept), 'bottom', remedies, total - kept.size);
}

export function fitBottom(
  candidates: TickCandidates, mayThin: boolean, scale: XScale, width: number, room: number,
  role: Role, metrics: Metrics, prepared = prepareLabels(mayThin ? candidates : candidates.slice(0, 1)),
): FittedLabels {
  const remedies: LabelRemedy[] = [];
  let { ticks, hidden } = prepared.sets[0] ?? { ticks: [], hidden: 0 };
  let labels: Label[] = [];

  if (!mayThin && scale.type === 'band') {
    const span = Math.abs(scale.range[1] - scale.range[0]);
    const footprint = DIAGONAL * (metrics.lineHeight + metrics.width('ii…ii'));
    const sampled = spread(ticks, span, footprint);
    if (sampled !== ticks) {
      return truncateBottom(sampled, prepared, scale, width, room, role, metrics, ['rotated'], ticks.length + hidden);
    }
  }

  for (const [i, set] of prepared.sets.entries()) {
    ({ ticks, hidden } = set);
    labels = ticks.map(tick => bottomLabel(tick, position(scale, tick), width, [tick.label], 0, role, metrics));
    if (i === 1) remedies.push('thinned');
    if (conflicts(labels, 'bottom', width, room, mayThin ? 8 : 0).size === 0) {
      return result(labels, 'bottom', remedies, hidden);
    }
  }

  const bad = conflicts(labels, 'bottom', width, room);
  if (bad.size === 0) return result(labels, 'bottom', remedies, hidden);
  labels = labels.map(label => {
    if (!bad.has(label)) return label;
    const lines = wrapLabel(label.tick.label, metrics);
    return lines.length === 1 ? label : bottomLabel(label.tick, position(scale, label.tick), width, lines, 0, role, metrics);
  });
  if (labels.some(label => label.text.lines.length > 1)) remedies.push('wrapped');
  if (conflicts(labels, 'bottom', width, room).size === 0) return result(labels, 'bottom', remedies, hidden);

  labels = labels.map(({ tick, text }) => bottomLabel(tick, position(scale, tick), width, text.lines, -45, role, metrics));
  remedies.push('rotated');
  if (conflicts(labels, 'bottom', width, room).size === 0) return result(labels, 'bottom', remedies, hidden);
  return truncateBottom(ticks, prepared, scale, width, room, role, metrics, remedies, ticks.length + hidden);
}

export function fitLeftCategories(
  ticks: readonly Tick[], scale: XScale, width: number, height: number, role: Role, metrics: Metrics,
  room = Infinity, prepared = prepareLabels([ticks]),
): FittedLabels {
  const unique = prepared.sets[0]?.ticks ?? [];
  const sampled = spread(unique, Math.abs(scale.range[1] - scale.range[0]), metrics.lineHeight);
  const limit = Math.min(width * 0.4, room);
  const kept = new Map<Tick, Label>();
  let edge = 0;
  for (const { tick, pixel } of byPosition(sampled, scale)) {
    const top = pixel - metrics.lineHeight / 2;
    if (top < edge - EPSILON || top + metrics.lineHeight > height + EPSILON) continue;
    const text = middleText(tick.label, limit, prepared, metrics);
    if (text === undefined) continue;
    const label = leftLabel(tick, pixel, text, role, metrics);
    kept.set(tick, label);
    edge = top + metrics.lineHeight;
  }
  const remedies: LabelRemedy[] = [...kept.values()].some(label => label.text.lines[0] !== label.tick.label) ? ['truncated'] : [];
  return result(inSourceOrder(sampled, kept), 'left', remedies, ticks.length - kept.size);
}

export function fitValue(
  candidates: TickCandidates, scale: XScale, side: Side, span: number, room: number, role: Role, metrics: Metrics,
  prepared = prepareLabels(candidates),
): FittedLabels {
  const gap = metrics.lineHeight / 2;
  let labels: Label[] = [];
  let hidden = 0;
  for (const [i, set] of prepared.sets.entries()) {
    const { ticks } = set;
    hidden = set.hidden;
    labels = ticks.map(tick => {
      const pixel = position(scale, tick);
      return side === 'left'
        ? leftLabel(tick, pixel, tick.label, role, metrics)
        : bottomLabel(tick, pixel, span, [tick.label], 0, role, metrics);
    });
    if (conflicts(labels, side, span, room, gap).size === 0) return result(labels, side, i ? ['thinned'] : [], hidden);
  }

  const sorted = [...labels].sort((a, b) => start(a, side) + extent(a, side) - start(b, side) - extent(b, side));
  const kept = new Set<Label>();
  let edge = -Infinity;
  for (const label of sorted) {
    const first = start(label, side);
    if (first < edge + gap || !fits(label, side, span, room)) continue;
    kept.add(label);
    edge = first + extent(label, side);
  }
  return result(labels.filter(label => kept.has(label)), side, candidates.length > 1 ? ['thinned'] : [], hidden + labels.length - kept.size);
}
