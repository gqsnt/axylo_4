/**
 * Shared drawing helpers of the two hierarchy charts: SVG elements, late-resolved paints and label fitting.
 * Paints are CSS expressions set through CSSOM (never a style attribute), so they follow the page's live theme,
 * forced colors included, and work under a strict Content-Security-Policy.
 */
import type { HierarchyModel } from './tree';

export const SVG_NS = 'http://www.w3.org/2000/svg';

export interface Box { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** Measures text in CSS px for one font. */
export type Measure = (text: string) => number;

export interface RenderContext {
  readonly doc: Document;
  readonly model: HierarchyModel;
  readonly root: number;
  readonly width: number;
  readonly height: number;
  readonly marks: SVGGElement;
  readonly labels: SVGGElement;
  readonly measure: Measure;
  readonly lineHeight: number;
}

export interface Rendered {
  pick(px: number, py: number): number;
  /** Where a node is drawn, for the tooltip; null when it has no visible geometry. */
  anchor(node: number): Box | null;
  /** Draws an outline of `node` into `group` (focus or hover). */
  outline(group: SVGGElement, node: number, kind: 'focus' | 'hover'): void;
  /** How many nodes carry a visible label, for tests and the reader's note. */
  readonly labelled: number;
}

export interface Driver {
  readonly type: 'treemap' | 'sunburst';
  render(ctx: RenderContext): Rendered;
}

export function svg<K extends keyof SVGElementTagNameMap>(doc: Document, name: K, attrs: Readonly<Record<string, string | number>> = {}): SVGElementTagNameMap[K] {
  const e = doc.createElementNS(SVG_NS, name) as SVGElementTagNameMap[K];
  for (const key of Object.keys(attrs)) e.setAttribute(key, String(attrs[key]));
  return e;
}

export function paint(e: Element, property: string, value: string): void {
  (e as SVGElement).style.setProperty(property, value);
}

/** Paints as CSS expressions: the author's public property first, then the hierarchy stylesheet's default (styles.ts). */
export const TOKENS = {
  background: 'var(--axylo-background, var(--axylo-h-bg))',
  text: 'var(--axylo-text, var(--axylo-h-text))',
  muted: 'var(--axylo-muted, var(--axylo-h-muted))',
  axis: 'var(--axylo-axis, var(--axylo-h-axis))',
  focus: 'var(--axylo-focus, var(--axylo-h-focus))',
} as const;

/** Palette slot k (0-based) of the eight; forced colors replace every slot with one system color. */
export const seriesPaint = (k: number): string => {
  const slot = (k % 8) + 1;
  return `var(--axylo-forced-series, var(--axylo-series-${slot}, var(--axylo-h-series-${slot})))`;
};

/** Color of a node: its top-level ancestor's palette slot. */
export function nodeFill(m: HierarchyModel, node: number): string {
  if (node <= 0 || m.parent[node]! < 0) return TOKENS.background;
  let top = node;
  while (m.parent[top]! > 0) top = m.parent[top]!;
  return seriesPaint(m.sibling[top]!);
}

/** Label text with a halo of the background, so it reads on any fill in every scheme and under forced colors. */
export function label(ctx: RenderContext, text: string, x: number, y: number, anchor: 'start' | 'middle', weight?: number): SVGTextElement {
  const t = svg(ctx.doc, 'text', { x: round(x), y: round(y), 'text-anchor': anchor, 'dominant-baseline': 'central' });
  t.textContent = text;
  paint(t, 'fill', TOKENS.text);
  paint(t, 'stroke', TOKENS.background);
  paint(t, 'stroke-width', '3px');
  paint(t, 'paint-order', 'stroke');
  paint(t, 'stroke-linejoin', 'round');
  paint(t, 'font-size', '12px');
  if (weight) paint(t, 'font-weight', String(weight));
  ctx.labels.appendChild(t);
  return t;
}

export const round = (v: number): number => Math.round(v * 100) / 100;

const ELLIPSIS = '…';

/**
 * The longest prefix of `text` (with an ellipsis when cut) for which `fits(width)` holds, or null when not even
 * one character fits. Binary search over the prefix length: measuring is the cost.
 */
export function fitLabel(text: string, measure: Measure, fits: (width: number) => boolean): string | null {
  if (!text) return null;
  if (fits(measure(text))) return text;
  const chars = Array.from(text);
  let lo = 1, hi = chars.length - 1, best: string | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate = chars.slice(0, mid).join('').trimEnd() + ELLIPSIS;
    if (fits(measure(candidate))) { best = candidate; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}
