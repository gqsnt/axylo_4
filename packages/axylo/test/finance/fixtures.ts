/**
 * Shared fixtures of the finance tests: the five-row OHLCV fixture (one candle per case: up, down, doji,
 * AX180, AX181), the pure stages run in Node, small geometry readers, and just enough of an SVG document for
 * the real renderer with the finance handlers.
 */
import type { AxisContext } from '../../src/core/axes';
import type { Layout, PathMark, PlacedText, Rect, RectMark, Scene, TextMeasurer, TextStyle } from '../../src/core/contracts';
import { resolveOptions } from '../../src/data/options';
import { DiagnosticCollector } from '../../src/diagnostics/collector';
import { buildFinanceView, normalizeFinance, parseFinanceInput, type FinanceStateRef } from '../../src/finance/core';
import { financeLayout, financePanes, type FinancePanes } from '../../src/finance/layout';
import { buildFinanceScene } from '../../src/finance/render';

export const measurer: TextMeasurer = { width: text => text.length * 7 };
export const style: TextStyle = { font: '12px sans-serif', letterSpacing: 0, wordSpacing: 0, lineHeight: 16 };

export const BASE_ROWS = [
  { day: '2026-01-01', o: 100, h: 112, l: 98, c: 110, v: 5000 },  // up
  { day: '2026-01-02', o: 110, h: 111, l: 100, c: 102, v: 4200 }, // down
  { day: '2026-01-03', o: 102, h: 105, l: 99, c: 102, v: 3100 },  // doji
  { day: '2026-01-04', o: 105, h: 100, l: 95, c: 104, v: 2000 },  // AX180
  { day: '2026-01-05', o: 104, h: 109, l: 101, c: 108, v: -100 }, // AX181
];

export function baseOptions(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'ACME', data: BASE_ROWS, x: 'day', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v',
    yAxis: { unit: 'USD' }, ...extra,
  };
}

export interface Staged {
  readonly sink: DiagnosticCollector;
  readonly stateRef: FinanceStateRef;
  readonly view: ReturnType<typeof buildFinanceView>;
  readonly layout: Layout;
  readonly scene: Scene;
  readonly panes: FinancePanes;
  readonly ctx: AxisContext;
}

export function stage(options: Record<string, unknown>, size = { width: 720, height: 400 }, zoom: readonly [number, number] | null = null,
  hidden: ReadonlySet<string> = new Set()): Staged {
  const parsed = parseFinanceInput(options);
  const stateRef: FinanceStateRef = { meta: parsed.meta };
  const sink = new DiagnosticCollector();
  const resolved = resolveOptions('line', parsed.translated, sink);
  const frame = normalizeFinance(stateRef, 'line', resolved, { timeZone: 'UTC' }, sink, { epoch: 1, revision: 1 });
  const view = buildFinanceView(stateRef, frame, {
    kind: 'line', hidden, zoom, xField: resolved.x, xDomain: resolved.x.domain,
    // As the controller's viewStateFor: the explicit domain reaches the view through the resolved options.
    valueDomain: resolved.values[0]?.domain ?? null, valueField: resolved.values[0]?.field,
    references: Array.isArray(parsed.translated.reference) ? parsed.translated.reference as never : [],
    previous: null, stacked: false, horizontal: false, compact: false,
  }, sink);
  const ctx: AxisContext = { resolved, locale: 'en-US', compact: false, xLabelGiven: false, valueTitle: 'Value' };
  const stageLayout = financeLayout(stateRef);
  stageLayout.prepareTicks?.(view, ctx);
  const layout = stageLayout.compute(view, size, { measurer, style }, ctx);
  const scene = buildFinanceScene(stateRef, view, layout, 1);
  const panes = financePanes(layout);
  if (!panes) throw new Error(`no finance panes on a ${layout.kind} layout`);
  return { sink, stateRef, view, layout, scene, panes, ctx };
}

export const plotOf = (layout: Layout): Rect => {
  if (layout.kind !== 'plot') throw new Error(`expected a plot layout, got ${layout.kind}`);
  return layout.plot;
};
export const yRange = (layout: Layout): readonly [number, number] => {
  if (layout.kind !== 'plot' || layout.projection.kind !== 'xy') throw new Error('expected an xy plot');
  return layout.projection.y.range;
};
export const yDomain = (layout: Layout): readonly [number, number] => {
  if (layout.kind !== 'plot' || layout.projection.kind !== 'xy') throw new Error('expected an xy plot');
  return layout.projection.y.domain;
};
export const textsOf = (layout: Layout): readonly PlacedText[] => (layout.kind === 'plot' ? layout.texts : []);
export const rectsOf = (scene: Scene, series: number): RectMark | undefined =>
  scene.marks.find((m): m is RectMark => m.type === 'rects' && m.series === series);
export const pathsOf = (scene: Scene): PathMark[] => scene.marks.filter((m): m is PathMark => m.type === 'path');
export const bottomOf = (r: Rect) => r.y + r.height;
export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export function ys(mark: PathMark): number[] {
  const out: number[] = [];
  for (let i = 1; i < mark.xy.length; i += 2) if (!Number.isNaN(mark.xy[i]!)) out.push(mark.xy[i]!);
  return out;
}

export function rectBoxes(mark: RectMark): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i < mark.xywh.length; i += 4) out.push({ x: mark.xywh[i]!, y: mark.xywh[i + 1]!, width: mark.xywh[i + 2]!, height: mark.xywh[i + 3]! });
  return out;
}

// ───────────────────────────── SVG handlers on a minimal document ─────────────────────────────

/** Just enough of an SVG document for the renderer: attributes, inline style, children. */
export class FakeStyle {
  readonly props = new Map<string, string>();
  setProperty(name: string, value: string) { this.props.set(name, value); }
  removeProperty(name: string) { this.props.delete(name); }
  getPropertyValue(name: string) { return this.props.get(name) ?? ''; }
}
export class FakeElement {
  readonly attrs = new Map<string, string>();
  readonly style = new FakeStyle();
  readonly kids: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  constructor(readonly tagName: string) {}
  get children() { return this.kids; }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  removeAttribute(k: string) { this.attrs.delete(k); }
  appendChild(c: FakeElement) {
    if (c.tagName === '#fragment') { for (const k of [...c.kids]) this.appendChild(k); c.kids.length = 0; return c; }
    c.remove(); c.parentNode = this; this.kids.push(c); return c;
  }
  append(...cs: FakeElement[]) { for (const c of cs) this.appendChild(c); }
  replaceChild(next: FakeElement, old: FakeElement) {
    const i = this.kids.indexOf(old);
    next.remove(); next.parentNode = this; this.kids[i] = next; old.parentNode = null; return old;
  }
  replaceChildren() { for (const k of this.kids) k.parentNode = null; this.kids.length = 0; }
  remove() { const p = this.parentNode; if (p) { p.kids.splice(p.kids.indexOf(this), 1); this.parentNode = null; } }
  all(): FakeElement[] { return [this, ...this.kids.flatMap(k => k.all())]; }
}
export const fakeDocument = () => ({
  createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
  createDocumentFragment: () => new FakeElement('#fragment'),
}) as unknown as Document;

