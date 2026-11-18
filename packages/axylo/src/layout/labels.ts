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
const DIAGONAL = Math.SQRT1_2;
const ellipsis = '…';
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

export function wrapText(text: string, limit: number, metrics: Metrics): string[] {
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
      if (line) lines.push(line);
      line = '';
      if (metrics.width(word) <= limit) {
        line = word;
        continue;
      }
      for (const glyph of graphemes(word)) {
        if (line && metrics.width(line + glyph) > limit) {
          lines.push(line);
          line = '';
        }
        line += glyph;
      }
    }
    if (line || !paragraph.trim()) lines.push(line);
  }
  return lines;
}

function wrapLabel(text: string, metrics: Metrics): readonly string[] {
  let best: readonly string[] = [text];
  let width = metrics.width(text);
  for (const space of text.matchAll(/\s+/gu)) {
    const first = text.slice(0, space.index);
    const last = text.slice(space.index + space[0].length);
    if (!first || !last) continue;
    const next = Math.max(metrics.width(first), metrics.width(last));
    if (next < width) {
      best = [first, last];
      width = next;
    }
  }
  return best;
}

function middleText(
  full: string, limit: number, originals: ReadonlySet<string>, used: ReadonlySet<string>, metrics: Metrics,
): string | undefined {
  if (!used.has(full) && metrics.width(full) <= limit + EPSILON) return full;
  if (metrics.width(ellipsis) > limit + EPSILON) return undefined;
  const letters = graphemes(full);
  const ends = [0];
  for (const letter of letters) ends.push(ends[ends.length - 1]! + letter.length);
  // Try fewer removals first. At a given length, prefer to preserve both ends equally.
  for (let kept = letters.length - 1; kept >= 0; kept--) {
    const minimum = kept >= 2 ? 1 : 0;
    const maximum = kept - minimum;
    for (let attempt = 0; attempt <= maximum - minimum; attempt++) {
      const prefix = Math.ceil(kept / 2) + (attempt % 2 ? -Math.ceil(attempt / 2) : attempt / 2);
      const suffix = kept - prefix;
      const label = full.slice(0, ends[prefix]) + ellipsis + full.slice(ends[letters.length - suffix]);
      if (!originals.has(label) && !used.has(label) && metrics.width(label) <= limit + EPSILON) return label;
    }
  }
  return undefined;
}

function bottomLabel(
  tick: Tick, pixel: number, width: number, lines: readonly string[], rotate: 0 | -45,
  role: Role, metrics: Metrics,
): Label {
  const half = widest(lines, metrics) / 2;
  const x = rotate === 0 && half * 2 <= width ? Math.max(half, Math.min(width - half, pixel)) : pixel;
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
  const names = new Map<string, Label>();
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
    const name = label.text.lines.join(' ');
    const previous = names.get(name);
    if (previous) {
      bad.add(previous);
      bad.add(label);
    }
    names.set(name, label);
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

export function fitBottom(
  candidates: TickCandidates, mayThin: boolean, scale: XScale, width: number, room: number,
  role: Role, metrics: Metrics,
): FittedLabels {
  const remedies: LabelRemedy[] = [];
  let ticks = candidates[0] ?? [];
  let labels: Label[] = [];
  const count = mayThin ? candidates.length : Math.min(candidates.length, 1);

  for (let i = 0; i < count; i++) {
    ticks = candidates[i]!;
    labels = ticks.map(tick => bottomLabel(tick, position(scale, tick), width, [tick.label], 0, role, metrics));
    if (i === 1) remedies.push('thinned');
    if (conflicts(labels, 'bottom', width, room, mayThin ? 8 : 0).size === 0) {
      return result(labels, 'bottom', remedies);
    }
  }

  const bad = conflicts(labels, 'bottom', width, room);
  if (bad.size === 0) return result(labels, 'bottom', remedies);
  labels = labels.map(label => {
    if (!bad.has(label)) return label;
    const lines = wrapLabel(label.tick.label, metrics);
    return lines.length === 1 ? label : bottomLabel(label.tick, position(scale, label.tick), width, lines, 0, role, metrics);
  });
  if (labels.some(label => label.text.lines.length > 1)) remedies.push('wrapped');
  if (conflicts(labels, 'bottom', width, room).size === 0) return result(labels, 'bottom', remedies);

  labels = labels.map(({ tick, text }) => bottomLabel(tick, position(scale, tick), width, text.lines, -45, role, metrics));
  remedies.push('rotated');
  if (conflicts(labels, 'bottom', width, room).size === 0) return result(labels, 'bottom', remedies);

  const originals = new Set(ticks.map(tick => tick.label));
  const used = new Set<string>();
  const kept = new Map<Tick, Label>();
  let edge = 0;
  for (const { tick, pixel } of byPosition(ticks, scale)) {
    // The rotated right edge depends only on line height. Keeping the earliest right edge
    // leaves the most room for following labels, even when some anchors must be skipped.
    const right = pixel + DIAGONAL * metrics.lineHeight;
    if (right > width + EPSILON) continue;
    const limit = Math.min((pixel - edge) / DIAGONAL, room / DIAGONAL - metrics.lineHeight);
    const text = middleText(tick.label, limit, originals, used, metrics);
    if (text === undefined) continue;
    const label = bottomLabel(tick, pixel, width, [text], -45, role, metrics);
    used.add(text);
    kept.set(tick, label);
    edge = right;
  }
  if ([...kept.values()].some(label => label.text.lines[0] !== label.tick.label)) remedies.push('truncated');
  return result(inSourceOrder(ticks, kept), 'bottom', remedies, ticks.length - kept.size);
}

export function fitLeftCategories(
  ticks: readonly Tick[], scale: XScale, width: number, height: number, role: Role, metrics: Metrics,
): FittedLabels {
  const originals = new Set(ticks.map(tick => tick.label));
  const used = new Set<string>();
  const kept = new Map<Tick, Label>();
  let edge = 0;
  for (const { tick, pixel } of byPosition(ticks, scale)) {
    const top = pixel - metrics.lineHeight / 2;
    if (top < edge - EPSILON || top + metrics.lineHeight > height + EPSILON) continue;
    const text = middleText(tick.label, width * 0.4, originals, used, metrics);
    if (text === undefined) continue;
    const label = leftLabel(tick, pixel, text, role, metrics);
    kept.set(tick, label);
    used.add(text);
    edge = top + metrics.lineHeight;
  }
  const remedies: LabelRemedy[] = [...kept.values()].some(label => label.text.lines[0] !== label.tick.label) ? ['truncated'] : [];
  return result(inSourceOrder(ticks, kept), 'left', remedies, ticks.length - kept.size);
}

export function fitValue(
  candidates: TickCandidates, scale: XScale, side: Side, span: number, room: number, role: Role, metrics: Metrics,
): FittedLabels {
  const gap = metrics.lineHeight / 2;
  let labels: Label[] = [];
  for (const [i, ticks] of candidates.entries()) {
    labels = ticks.map(tick => {
      const pixel = position(scale, tick);
      return side === 'left'
        ? leftLabel(tick, pixel, tick.label, role, metrics)
        : bottomLabel(tick, pixel, span, [tick.label], 0, role, metrics);
    });
    if (conflicts(labels, side, span, room, gap).size === 0) return result(labels, side, i ? ['thinned'] : []);
  }

  const sorted = [...labels].sort((a, b) => start(a, side) + extent(a, side) - start(b, side) - extent(b, side));
  const kept = new Set<Label>();
  const used = new Set<string>();
  let edge = -Infinity;
  for (const label of sorted) {
    const first = start(label, side);
    if (first < edge + gap || used.has(label.tick.label) || !fits(label, side, span, room)) continue;
    kept.add(label);
    used.add(label.tick.label);
    edge = first + extent(label, side);
  }
  return result(labels.filter(label => kept.has(label)), side, candidates.length > 1 ? ['thinned'] : [], labels.length - kept.size);
}
