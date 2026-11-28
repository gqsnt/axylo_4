/**
 * The nested-circle size legend: three reference sizes drawn at exactly the radius a bubble of that size gets
 * (radiusOf with the chart's own maximum), as an aria-hidden SVG beside a text list of the same values. It is
 * not a control: plain list items, no tab stop (spec A2 keeps the toolbar the only one). CSP-safe: elements and
 * attributes only, no style text.
 */
import type { Messages } from '../../public';
import { radiusOf, scaleFor, writeNum, writeRadius, ZERO_RADIUS, type SizeChannel } from './geometry';
import type { BubbleMeta } from './options';
import { sizeText } from './text';

export interface LegendEntry {
  readonly value: number;
  readonly radius: number;
  readonly text: string;
}

export interface LegendModel {
  readonly title: string;
  /** Largest first; empty when no bubble has a size. */
  readonly entries: readonly LegendEntry[];
  /** Equal signatures render the same. */
  readonly signature: string;
}

const STEPS = [1, 2, 2.5, 5];

/**
 * s · 10^k as a double. Below 1e-307 the power itself is subnormal or zero (10 ** -324 is 0), so the product
 * would lose the value; the decimal literal is parsed instead, which rounds it once, correctly and monotonically.
 * Above, the product is kept as it always was.
 */
const decimal = (s: number, k: number): number => (k <= -308 ? Number(`${s}e${k}`) : s * 10 ** k);

/** The largest of 1, 2, 2.5 and 5 × 10^k at or below v (v > 0 and finite); positive, and never above v. */
export function niceFloor(v: number): number {
  let k = Math.floor(Math.log10(v));
  let power = decimal(1, k);
  // log10 can be off by one ulp at exact powers of ten.
  if (power > v) power = decimal(1, --k);
  else if ((k <= -309 ? decimal(1, k + 1) : power * 10) <= v) power = decimal(1, ++k);
  let best = power;
  for (const s of STEPS) {
    const candidate = k <= -308 ? decimal(s, k) : s * power;
    if (candidate <= v && candidate > best) best = candidate;
  }
  // Only 1e-324 rounds to 0, and 2.5e-324 then rounds to MIN_VALUE ≤ v; v itself is the last resort.
  return best > 0 && best <= v ? best : v;
}

/**
 * Up to three reference sizes: the nice value at or below the largest size, then near a quarter and a sixteenth
 * of it. A share that underflows to 0 adds no entry, so a positive maximum gives positive, strictly decreasing
 * references only.
 */
export function referenceSizes(max: number): number[] {
  if (!(max > 0) || !Number.isFinite(max)) return max === 0 ? [0] : [];
  const top = niceFloor(max);
  const out = [top];
  for (const share of [4, 16]) {
    const part = top / share;
    if (!(part > 0)) continue;
    const v = niceFloor(part);
    if (v > 0 && v < out[out.length - 1]!) out.push(v);
  }
  return out;
}

export function legendModel(meta: BubbleMeta, channel: SizeChannel, locale: string, messages: Pick<Messages, 'noData'>): LegendModel {
  const title = meta.unit ? `${meta.label} (${meta.unit})` : meta.label;
  const entries = referenceSizes(channel.max).map(value => ({
    value, radius: value === 0 ? 0 : radiusOf(value, channel.max, meta.minRadius, meta.maxRadius),
    text: sizeText(meta, locale, value, messages),
  }));
  return { title, entries, signature: JSON.stringify([title, entries.map(e => [e.radius, e.text])]) };
}

const SVG = 'http://www.w3.org/2000/svg';

export function renderLegend(doc: Document, list: HTMLUListElement, model: LegendModel): void {
  if (list.className !== 'axylo-legend-list axylo-bubble-legend') list.className = 'axylo-legend-list axylo-bubble-legend';
  // Family chrome for a whole-figure export (export/contract.ts CHROME): the nested circles and their values.
  list.setAttribute('data-axylo-export', 'size-legend');
  if (list.dataset.signature === model.signature) return;
  list.dataset.signature = model.signature;
  const item = doc.createElement('li');
  item.className = 'axylo-bubble-legend-entry';
  const largest = Math.max(ZERO_RADIUS, ...model.entries.map(e => e.radius));
  const size = Math.ceil(2 * largest + 2);
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  for (const entry of model.entries) {
    const r = entry.radius === 0 ? ZERO_RADIUS : entry.radius;
    const circle = doc.createElementNS(SVG, 'circle');
    // Nested at a shared bottom, as size legends are read: every circle touches the baseline.
    circle.setAttribute('cx', String(size / 2));
    // Written at the plot's precision for that radius, so a sub-pixel reference matches the bubbles it explains.
    circle.setAttribute('cy', writeNum(size - 1 - r, scaleFor(r)));
    circle.setAttribute('r', writeRadius(r));
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'currentColor');
    circle.setAttribute('stroke-width', '1');
    circle.setAttribute('data-value', String(entry.value));
    svg.append(circle);
  }
  const title = doc.createElement('span');
  title.className = 'axylo-legend-name';
  title.textContent = model.title;
  item.append(svg, title);
  // One item per reference size: a list of "1,000" and "250" cannot be misread as one grouped number.
  const values = model.entries.map(entry => {
    const li = doc.createElement('li');
    li.className = 'axylo-legend-value axylo-bubble-legend-value';
    li.dataset.value = String(entry.value);
    li.textContent = entry.text;
    return li;
  });
  list.replaceChildren(item, ...values);
}
