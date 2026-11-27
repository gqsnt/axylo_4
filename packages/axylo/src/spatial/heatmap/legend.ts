/**
 * The heatmap's color bar: one continuous gradient over the whole color scale (low end to high end), ticks at the
 * low end, the midpoint and the high end, and swatches for missing (hatched) and invalid (crossed) cells. Mounted
 * through the interaction layer's slice list slot; styled through CSSOM properties only (no <style>, no inline
 * style attribute strings: CSP-safe).
 *
 * The bar does not follow the plot's bin count: the plot quantizes so it can batch cells into one path per color,
 * but the scale itself is continuous, and a bar of a few wide bands would read as a categorical key. Its stops are
 * the same live CSS expressions as the bins (`colorAt`), so a page that restyles the anchors restyles the bar too.
 * SVG gradients interpolate in sRGB, not OKLab, so the bar carries enough stops (each an OKLab mix of the anchors)
 * that the difference between neighbouring stops is far below what a reader can tell.
 *
 * One model per committed revision is shown and exported (`HeatmapLegend`): formatted inside the frame, adopted
 * when the interaction layer commits, never formatted again for export.
 */
import type { Formatters, View } from '../../core/contracts';
import type { Committed, ControlsState, SliceList } from '../../dom/interaction-types';
import type { Messages } from '../../public';
import { binColor, binOf, colorAt, type ColorScheme } from '../color-scale';
import { matrixOf, type MatrixFrame } from './core';
import { INVALID_PAINT, INVALID_TEXT, MISSING_PAINT } from './render';

export interface LegendTick {
  readonly value: number;
  readonly label: string;
  /** Position along the bar, 0 (low end) to 1 (high end). */
  readonly at: number;
}

/** One gradient stop: its offset along the bar (0 to 1) and its live CSS color. */
export interface LegendStop {
  readonly offset: number;
  readonly color: string;
}

/** What the color bar shows: plain data, for the DOM here and for export. */
export interface LegendModel {
  readonly title: string;
  readonly scheme: ColorScheme;
  /** The plot's quantized bin count (the bar itself is continuous); 0 when no cell has a value. */
  readonly bins: number;
  /** The bar's gradient, low to high; empty when no cell has a value (no bar, swatches only). */
  readonly stops: readonly LegendStop[];
  readonly ticks: readonly LegendTick[];
  /** Swatch texts, present when the matrix has such cells. */
  readonly missing: string | null;
  readonly invalid: string | null;
}

/** Stops of the continuous bar: every 1/16 of the scale, so each segment between two anchors has four. */
export const LEGEND_STOPS = 17;

export function legendModel(m: MatrixFrame, formatters: Formatters, messages: Pick<Messages, 'noData'>): LegendModel | null {
  const d = m.domain;
  if (!d && m.missingCount === 0 && m.invalidCount === 0) return null;
  const stops: LegendStop[] = [];
  const ticks: LegendTick[] = [];
  if (d) {
    if (d.degenerate) {
      // One distinct value: every cell takes the same bin, so the bar is that one color rather than a scale
      // the cells do not use.
      const color = binColor(d.scheme, binOf(d, d.lo), d.bins);
      stops.push({ offset: 0, color }, { offset: 1, color });
      ticks.push({ value: d.lo, label: formatters.value(0, d.lo), at: 0.5 });
    } else {
      for (let i = 0; i < LEGEND_STOPS; i++) {
        const t = i / (LEGEND_STOPS - 1);
        stops.push({ offset: t, color: colorAt(d.scheme, t) });
      }
      const mid = d.scheme === 'diverging' ? d.mid : d.lo / 2 + d.hi / 2;
      ticks.push(
        { value: d.lo, label: formatters.value(0, d.lo), at: 0 },
        { value: mid, label: formatters.value(0, mid), at: 0.5 },
        { value: d.hi, label: formatters.value(0, d.hi), at: 1 },
      );
    }
  }
  return {
    title: m.meta.valueLabel, scheme: m.meta.scheme, bins: d?.bins ?? 0, stops, ticks,
    missing: m.missingCount > 0 ? messages.noData : null,
    invalid: m.invalidCount > 0 ? INVALID_TEXT : null,
  };
}

const SVG = 'http://www.w3.org/2000/svg';
const BAR_WIDTH = 192;
const BAR_HEIGHT = 12;

function css(el: HTMLElement | SVGElement, props: readonly string[]): void {
  for (let i = 0; i < props.length; i += 2) el.style.setProperty(props[i]!, props[i + 1]!);
}

function svgOf(doc: Document, width: number, height: number): SVGSVGElement {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  css(svg, ['display', 'block', 'overflow', 'visible']);
  return svg;
}

function swatch(doc: Document, crossed: boolean): SVGSVGElement {
  const svg = svgOf(doc, 14, 12);
  const path = doc.createElementNS(SVG, 'path');
  path.setAttribute('d', crossed ? 'M0.5 0.5h13v11h-13zM0.5 11.5l13 -11M0.5 0.5l13 11' : 'M0.5 0.5h13v11h-13zM0.5 11.5l13 -11');
  path.setAttribute('stroke-width', '1');
  css(path, ['color', crossed ? INVALID_PAINT : MISSING_PAINT, 'fill', 'none', 'stroke', 'currentColor']);
  svg.appendChild(path);
  return svg;
}

function entry(doc: Document, className: string): HTMLLIElement {
  const li = doc.createElement('li');
  li.className = className;
  css(li, ['display', 'flex', 'align-items', 'center', 'gap', '6px', 'margin', '0', 'padding', '0']);
  return li;
}

function text(doc: Document, className: string, value: string): HTMLSpanElement {
  const span = doc.createElement('span');
  span.className = className;
  span.textContent = value;
  return span;
}

let gradients = 0;

/** A gradient id no other chart on the page uses (each chart keeps its own across repaints). */
export function nextGradientId(): string {
  return `axylo-heatmap-scale-${++gradients}`;
}

/** Writes a model into the list (replacing what it showed). `gradientId` names this chart's bar gradient. */
export function renderLegend(doc: Document, list: HTMLUListElement, model: LegendModel, gradientId: string): void {
  const items: HTMLLIElement[] = [];
  if (model.stops.length) {
    const li = entry(doc, 'axylo-heatmap-scale');
    li.appendChild(text(doc, 'axylo-heatmap-scale-title', model.title));
    const bar = doc.createElement('span');
    bar.className = 'axylo-heatmap-bar';
    css(bar, ['position', 'relative', 'display', 'inline-block', 'width', `${BAR_WIDTH}px`, 'padding-bottom', '1.4em']);
    const svg = svgOf(doc, BAR_WIDTH, BAR_HEIGHT);
    const defs = doc.createElementNS(SVG, 'defs');
    const gradient = doc.createElementNS(SVG, 'linearGradient');
    gradient.setAttribute('id', gradientId);
    gradient.setAttribute('x1', '0');
    gradient.setAttribute('y1', '0');
    gradient.setAttribute('x2', '1');
    gradient.setAttribute('y2', '0');
    for (const s of model.stops) {
      const stop = doc.createElementNS(SVG, 'stop');
      stop.setAttribute('offset', String(s.offset));
      stop.setAttribute('class', 'axylo-heatmap-stop');
      // A CSS property, not the stop-color attribute: only CSS resolves var() and color-mix().
      css(stop, ['stop-color', s.color]);
      gradient.appendChild(stop);
    }
    defs.appendChild(gradient);
    svg.appendChild(defs);
    const fill = doc.createElementNS(SVG, 'rect');
    fill.setAttribute('x', '0');
    fill.setAttribute('y', '0');
    fill.setAttribute('width', String(BAR_WIDTH));
    fill.setAttribute('height', String(BAR_HEIGHT));
    fill.setAttribute('class', 'axylo-heatmap-bar-fill');
    css(fill, ['fill', `url("#${gradientId}")`]);
    svg.appendChild(fill);
    // An outline keeps the bar's extent visible in forced colors, where every stop takes the text color.
    const frame = doc.createElementNS(SVG, 'rect');
    frame.setAttribute('x', '0.5');
    frame.setAttribute('y', '0.5');
    frame.setAttribute('width', String(BAR_WIDTH - 1));
    frame.setAttribute('height', String(BAR_HEIGHT - 1));
    frame.setAttribute('class', 'axylo-heatmap-bar-outline');
    css(frame, ['fill', 'none', 'stroke', 'var(--axylo-axis, var(--axylo-default-axis, currentColor))', 'stroke-width', '1']);
    svg.appendChild(frame);
    bar.appendChild(svg);
    for (const tick of model.ticks) {
      const t = text(doc, 'axylo-heatmap-tick', tick.label);
      const shift = tick.at <= 0 ? '0' : tick.at >= 1 ? '-100%' : '-50%';
      css(t, ['position', 'absolute', 'top', `${BAR_HEIGHT + 2}px`, 'left', `${tick.at * 100}%`, 'transform', `translateX(${shift})`, 'white-space', 'nowrap']);
      bar.appendChild(t);
    }
    li.appendChild(bar);
    items.push(li);
  }
  if (model.missing !== null) {
    const li = entry(doc, 'axylo-heatmap-missing');
    li.append(swatch(doc, false), text(doc, 'axylo-heatmap-swatch-label', model.missing));
    items.push(li);
  }
  if (model.invalid !== null) {
    const li = entry(doc, 'axylo-heatmap-invalid');
    li.append(swatch(doc, true), text(doc, 'axylo-heatmap-swatch-label', model.invalid));
    items.push(li);
  }
  list.replaceChildren(...items);
}

const matrixOfView = (view: View): MatrixFrame | undefined =>
  view.kind === 'donut' || view.kind === 'scatter' ? undefined : matrixOf(view.frame);

/** A model and the inputs it was formatted from (compared by identity). */
interface Entry {
  readonly view: View;
  readonly formatters: Formatters;
  readonly messages: Messages;
  readonly model: LegendModel | null;
}

const madeFrom = (e: Entry | null, view: View, formatters: Formatters, messages: Messages): e is Entry =>
  e !== null && e.view === view && e.formatters === formatters && e.messages === messages;

/** What decides whether the slot is seen: the presentation of the state the interaction layer was last given. */
interface Shown {
  readonly legend: ControlsState['legend'];
  readonly ready: boolean;
  readonly tooSmall: boolean;
}

/** The interaction layer's entry points, as the controller's host holds them. */
export interface InteractionEntry {
  prepare(state: ControlsState): boolean;
  commit(state: Committed | null): void;
}

/**
 * One chart's color bar: one model per committed revision, shared by the page and by export.
 *
 * Lifecycle (see the ledger, section 11):
 *
 * - `prepare` (lookup stage, inside the frame, before any write) formats the model of the view about to be drawn.
 *   It is only a candidate: a frame that is superseded or aborted never commits it, so it is never shown or exported.
 * - `publish` (just before the interaction layer's commit, after the controller has recorded the drawn revision)
 *   adopts the candidate made from exactly the committed view, formatters and messages, or keeps the committed one
 *   when those are unchanged (same-geometry reuse: no formatting). Only if neither matches is the model formatted
 *   here. From then on the page shows, and export returns, that one object.
 * - `legend()` (export) returns the published model and never formats: inside a formatter it is the previous
 *   commit's.
 *
 * The slot is kept while the legend option is on, whatever the readiness, so a control-cache hit in the interaction
 * layer (a one-series chart's controls do not depend on readiness or size) cannot leave it stale. Its room and its
 * sight follow every state the interaction layer is given (`arranged`, called after its prepare and commit), and
 * `publish` paints the committed model in the same step as it is exported:
 *
 * - Room: kept while the legend is on and the chart is ready, too small (L8) included, so the fallback's measured
 *   delta is its own DOM only and a legend turned off or moved while in the fallback converges to what a fresh chart
 *   at that size draws. Without room it is `hidden` plus `display: none` (the inline `display: flex` would win over
 *   the hidden attribute), and a slot holding nothing else visible is hidden too, decided in the controller's
 *   arrange, before it measures, so the fallback measures the arrangement it will show and cannot oscillate.
 * - Sight: `visibility: hidden` and `aria-hidden` unless it fits and shows exactly the published model, so any
 *   formatter finds export and the seen bar of the same commit (a list mounted by arrange waits for its publish).
 */
export class HeatmapLegend {
  list: HTMLUListElement | null = null;
  #doc: Document | null = null;
  #prepared: Entry | null = null;
  #committed: Entry | null = null;
  #exported: LegendModel | null = null;
  /** What the list shows; undefined before the first paint into this list. */
  #painted: LegendModel | null | undefined = undefined;
  #shown: Shown | null = null;
  #hidSlot: HTMLElement | null = null;
  #gradientId: string | null = null;
  /** Bumped when the chart goes away, so a model whose formatting outlived the chart is dropped. */
  #epoch = 0;
  /** The chart is gone: a commit still unwinding (a formatter destroyed it) paints nothing more. */
  #disposed = false;

  readonly sliceList: SliceList = (doc, d, _actions, list) => {
    if (!d || d.legend === false || this.#disposed) {
      if (list) list.remove();
      if (!list || list === this.list) {
        this.list?.remove();
        this.list = null;
      }
      this.#painted = undefined;
      this.#hidSlot = null;
      this.#doc = null;
      return null;
    }
    this.#doc = doc;
    let own = list ?? this.list;
    if (own !== this.list) this.#painted = undefined;
    if (!own) {
      own = doc.createElement('ul');
      own.className = 'axylo-legend axylo-heatmap-legend';
      css(own, ['list-style', 'none', 'display', 'flex', 'flex-wrap', 'wrap', 'align-items', 'center', 'gap', '4px 16px', 'margin', '0', 'padding', '0']);
      this.#painted = undefined;
    }
    this.list = own;
    this.#shown = d;
    this.#sync();
    return own;
  };

  /** Lookup stage: the candidate model for what this frame is about to draw (runs author formatters). */
  prepare(view: View, formatters: Formatters, messages: Messages): void {
    if (madeFrom(this.#committed, view, formatters, messages) || madeFrom(this.#prepared, view, formatters, messages)) return;
    const epoch = this.#epoch;
    const model = modelOf(view, formatters, messages);
    if (epoch === this.#epoch) this.#prepared = { view, formatters, messages, model };
  }

  /** Just before the interaction layer commits `state`: its model becomes the one shown and exported. */
  publish(state: Committed | null): void {
    if (this.#disposed) return;
    if (!state) {
      this.#committed = this.#prepared = null;
      this.#exported = null;
      return;
    }
    const { view, formatters, messages } = state;
    let entry: Entry | null = madeFrom(this.#committed, view, formatters, messages) ? this.#committed
      : madeFrom(this.#prepared, view, formatters, messages) ? this.#prepared : null;
    if (entry === null) {
      const epoch = this.#epoch;
      entry = { view, formatters, messages, model: modelOf(view, formatters, messages) };
      if (epoch !== this.#epoch) return;
    }
    this.#committed = entry;
    this.#prepared = null;
    this.#exported = state.legend !== false && state.ready ? entry.model : null;
    this.#shown = state;
    // Painted in the same step that publishes it: the interaction layer's commit runs author formatters (the
    // focused cell's text, the tooltip) before its own controls pass, and they must find export and the seen bar
    // both of this commit.
    this.#sync();
  }

  /**
   * After the interaction layer's prepare or commit: the slot's visibility (and, after a commit, its content)
   * follow `state`. True when that changed what the figure holds, so the controller measures again.
   */
  arranged(state: ControlsState | null): boolean {
    if (this.#disposed) return false;
    if (state) this.#shown = state;
    return this.#sync();
  }

  /** The published model, under the export rules (chart.ts `HeatmapInternals.legend`). Never formats. */
  exported(): LegendModel | null {
    return this.#exported;
  }

  /** The chart is gone: nothing is kept, and a model still being formatted is dropped. */
  dispose(): void {
    this.#epoch++;
    this.#disposed = true;
    this.#prepared = this.#committed = this.#exported = this.#shown = null;
    this.#painted = undefined;
    this.#hidSlot = null;
  }

  #sync(): boolean {
    if (this.#disposed) return false;
    const list = this.list, doc = this.#doc ?? list?.ownerDocument;
    if (!list || !doc) return false;
    const model = this.#committed?.model ?? null;
    let changed = false;
    if (this.#painted !== model) {
      this.#painted = model;
      changed = true;
      list.setAttribute('aria-label', `Color scale${model ? `: ${model.title}` : ''}`);
      if (model) renderLegend(doc, list, model, this.#gradientId ??= nextGradientId());
      else list.replaceChildren();
    }
    const s = this.#shown;
    // Room and sight are decided apart. The bar keeps its room whenever the legend is on and the chart is ready,
    // too small included, so the fallback (L8) measures only its own DOM: turning the legend off or moving it at
    // the same host size then gives the same plot as a fresh chart with that legend (no stale reservation).
    const room = s !== null && s.legend !== false && s.ready && model !== null;
    // Seen only when what it shows is the published model, so a formatter never finds seen ticks other than
    // export's: a list arranged before its commit publishes (a mount) keeps its room but stays unseen until then.
    const seen = room && !s.tooSmall && this.#exported === model;
    if (list.hidden === room) {
      list.hidden = !room;
      changed = true;
    }
    const display = room ? 'flex' : 'none';
    if (list.style.getPropertyValue('display') !== display) list.style.setProperty('display', display);
    const visibility = seen ? 'visible' : 'hidden';
    if (list.style.getPropertyValue('visibility') !== visibility) list.style.setProperty('visibility', visibility);
    if (seen) list.removeAttribute('aria-hidden');
    else list.setAttribute('aria-hidden', 'true');
    const slot = list.parentElement;
    if (room) {
      if (this.#hidSlot && this.#hidSlot === slot && slot.hidden) {
        slot.hidden = false;
        changed = true;
      }
      this.#hidSlot = null;
    } else if (slot && !slot.hidden && onlyHiddenChildren(slot)) {
      // The figure shows a slot that holds controls; holding only this hidden list, it would still take its margins.
      slot.hidden = true;
      this.#hidSlot = slot;
      changed = true;
    }
    return changed;
  }
}

function onlyHiddenChildren(slot: HTMLElement): boolean {
  for (const child of slot.children) if (!(child as HTMLElement).hidden) return false;
  return true;
}

function modelOf(view: View, formatters: Formatters, messages: Messages): LegendModel | null {
  const m = matrixOfView(view);
  return m ? legendModel(m, formatters, messages) : null;
}

/**
 * Routes the interaction layer's prepare and commit through the legend, on this chart's own host object: the
 * controller calls them at exactly the two checkpoints the legend needs (arrange, before measuring; publish,
 * after the drawn revision is recorded), whether or not the layer's control cache then calls the slice list.
 */
export function attachLegend(entry: InteractionEntry, legend: HeatmapLegend): void {
  const prepare = entry.prepare, commit = entry.commit;
  entry.prepare = (state: ControlsState): boolean => {
    const moved = prepare.call(entry, state);
    return legend.arranged(state) || moved;
  };
  entry.commit = (state: Committed | null): void => {
    legend.publish(state);
    commit.call(entry, state);
    legend.arranged(state);
  };
}
