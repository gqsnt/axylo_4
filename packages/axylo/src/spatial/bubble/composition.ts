/**
 * The bubble chart's composition (core/composition.ts): a scatter-shaped frame with a size channel beside it.
 *
 * One composition per chart, because the size options are not part of the frame or the view: an update that
 * changes only `size` or `radius` keeps both (the controller does not renormalize for a key it does not know).
 * The bubble meta of a call is bound to that call's resolved options; every stage reads the meta of the state it
 * was handed, never "the latest call":
 *  - layout: through `AxisContext.resolved`; the meta is part of the layout key, so a size-only update makes a
 *    new layout and with it a new scene and lookup, while a title update keeps all three;
 *  - scene and lookup: through the layout they are given (bound when the layout was computed);
 *  - reader and legend: through the controller's accepted state (the controller hands itself to normalization
 *    as the data environment). A strict update that is rejected never becomes accepted, so nothing drawn reads it.
 */
import type {
  DatumRef, DatumText, Layout, Lookup, PickTarget, PointMark, ScatterView, StepDirection, TableModel,
} from '../../core/contracts';
import { lowerBound, stepIndex } from '../../lookup/search';
import type { Composition } from '../../core/composition';
import { baseLayoutKey } from '../../core/composition';
import { cartesianLayout, temporalTicks, timeScale } from '../../core/axes';
import { stepInSeries } from '../../core/focus';
import type { TargetMarks } from '../../core/focus';
import type { ControllerCore } from '../../core/controller-types';
import { resolveOptions, type ChartType, type ResolvedOptions } from '../../data/options';
import { normalizePoints, type DataEnvironment } from '../../data/normalize';
import { createTimeReadout } from '../../format/time';
import { scatterLookup } from '../../lookup/scatter';
import { pointerOnPlot } from '../../lookup/geometry';
import { scatterReader, type ReaderParts } from '../../reader';
import { linearScale } from '../../scale';
import { cartesianScene, type DataLayers } from '../../scene';
import { svgBand, svgPoints, svgRule, type SvgMark } from '../../render/svg';
import { pointSwatch } from '../../dom/swatch';
import { buildScatterView } from '../../view';
import type { Messages } from '../../public';
import { bubbleFor, bubbleGeometry, circlesPath, drawnRadius, scaleFor, sizeChannel, writeNum, writeRadius, ZERO_RADIUS, type BubbleGeometry } from './geometry';
import { paintedMap } from './paint';
import { bubbleTable, rowSizeText } from './table';
import { legendModel, referenceSizes, renderLegend, type LegendModel } from './legend';
import { resolveBubble, sameMeta, scatterPart, type BubbleMeta } from './options';
import { sizeFormatFailed, sizeMissed, sizeText, watchSizeFormat } from './text';
import { createDiagnostic } from '../../diagnostics';

const NO_DATA = { noData: '' } as const;

export { sizeText };

/**
 * A points mark that carries bubbles: the custom `points` drawer below reads `bubble`, svgPoints the rest.
 * 'series': what series `series` shows of the painter's-order picture (paint.ts), one path per series;
 * 'focus' and 'halo': the hovered or focused bubble drawn whole above everything, and its ring.
 */
export interface BubbleMark extends PointMark {
  readonly bubble: {
    readonly geometry: BubbleGeometry;
    readonly paint: 'series' | 'focus' | 'hollow' | 'halo';
    /** The one bubble of a focus or halo mark (unused for 'series'). */
    readonly members: Uint32Array;
    /** Series count of the frame (the painted map is per frame series). */
    readonly seriesCount: number;
  };
}

/** What a bubble chart keeps beside its controller, for the legend now and for export wiring later. */
export interface BubbleState {
  controller: Pick<ControllerCore, 'accepted' | 'destroyed' | 'drawn' | 'inFrame' | 'inflight' | 'schedule' | 'fallback'> | null;
  last: BubbleMeta | null;
  readonly metas: WeakMap<ResolvedOptions, BubbleMeta>;
  readonly layouts: WeakMap<Layout, BubbleMeta>;
  /** The committed revision's table (every row through `row(i)`), built by the reader stage. */
  table: TableModel | null;
  /** The bubble table whose row is being formatted right now, if any: who a size format failure belongs to. */
  reading: TableModel | null;
  /** Tables whose size format failure was already reported (AX160 once per finding of a table). */
  readonly reported: WeakSet<TableModel>;
  /** Per table, the revision whose frame built it: only that revision, once accepted, owns what its rows find. */
  readonly owners: WeakMap<TableModel, object>;
  /** The meta whose size format failure was reported to the controller: withdrawn once another meta is read. */
  failed: BubbleMeta | null;
  /** The legend model of the latest lookup (what the size legend shows). */
  legend: LegendModel | null;
  /** Per layout, the legend model its lookup built and the legend drew: what a snapshot of that layout reads. */
  readonly legends: WeakMap<Layout, LegendModel>;
  /** Layouts whose always-shown size texts (legend, summary range) were already formatted for AX160. */
  readonly checked: WeakSet<Layout>;
  /** The geometry of the latest scene (what the plot shows), for export wiring and tests. */
  drawn: BubbleGeometry | null;
  /** The size legend while it is mounted, and the model it last rendered. */
  list: HTMLUListElement | null;
  rendered: LegendModel | null;
  refreshQueued: boolean;
  locale: string;
  /** The geometry each view was last looked up with: what single-series stepping counts as drawn. */
  readonly geometries: WeakMap<object, BubbleGeometry>;
}

export function createBubbleState(): BubbleState {
  return {
    controller: null, last: null, metas: new WeakMap(), layouts: new WeakMap(), table: null, reading: null, reported: new WeakSet(), owners: new WeakMap(), failed: null, legend: null, legends: new WeakMap(), checked: new WeakSet(), drawn: null,
    list: null, rendered: null, refreshQueued: false, locale: 'en-US', geometries: new WeakMap(),
  };
}

/** The meta the accepted (drawn or about to be drawn) revision was resolved with. */
export function committedMeta(state: BubbleState): BubbleMeta | null {
  const resolved = state.controller?.accepted?.resolved;
  return (resolved && state.metas.get(resolved)) ?? null;
}

/** Resolution: the scatter fields, then the bubble part of the same options, bound to the result. */
export function resolveWith(state: BubbleState) {
  return (_kind: ChartType, options: unknown, sink: Parameters<typeof resolveOptions>[2], table?: Parameters<typeof resolveOptions>[3]): ResolvedOptions => {
    const resolved = resolveOptions('scatter', scatterPart(options), sink, table);
    let meta = resolveBubble(options, resolved, sink);
    // An equal meta is the same object, so the layout key (and so the scene and lookup) survive a title update.
    if (state.last && sameMeta(state.last, meta)) meta = state.last;
    state.last = meta;
    // A row's size is formatted lazily, maybe long after its frame: a failure goes to the controller's formatter
    // report (AX160 'changed'), which delivers late findings to the diagnostics, onDiagnostic and the note against
    // the accepted options (an empty or compact chart has no layout stage). That is right only for a read the
    // accepted revision owns, so ownership is checked here (sizeFailureOwned). Neither path re-enters update() or
    // a frame. Before the first frame there is no report yet: a frame is requested, whose layout stage reports it.
    if (meta.format) {
      watchSizeFormat(meta, () => {
        const c = state.controller, reading = state.reading;
        // A table row it could not report for is marked: a later read, maybe owned by then, offers it again.
        if (!c || c.destroyed || !sizeFailureOwned(state, c)) {
          if (reading) (missed ??= new WeakSet()).add(reading);
          return false;
        }
        if (reading) {
          if (state.reported.has(reading)) return true;
          state.reported.add(reading);
        } else if (sizeFormatFailed(meta)) return true;
        state.failed = meta;
        c.fallback ? c.fallback(meta.field, c) : c.schedule();
        return true;
      });
    }
    state.metas.set(resolved, meta);
    return resolved;
  };
}

/**
 * Whether a failing size read belongs to the revision the controller reports against (the accepted one): a row
 * of the drawn table while nothing newer is accepted, or of the table the frame drawing the accepted revision
 * built. A read of a table that is not the active one (the visible table of a revision an accepted update will
 * replace, or one retained after it was replaced) still shows its fallback text but is neither reported to the
 * newer revision's handler, diagnostics and note, nor counted as a failure it found. Reads that are not table
 * rows (legend, summary, layout: inside a frame; a tooltip of the drawn lookup) follow the same rule outside a
 * frame, and the controller's own guards inside one.
 */
function sizeFailureOwned(state: BubbleState, c: NonNullable<BubbleState['controller']>): boolean {
  const d = c.drawn;
  const settled = d !== null && d.accepted === c.accepted;
  const drawing = c.inFrame && c.inflight !== null && c.inflight === c.accepted;
  const reading = state.reading;
  if (!reading) return settled || c.inFrame || !d;
  // The table drawn for the accepted revision is that revision's, also when the core reused it from an earlier one.
  // A table read during a newer revision's frame (an x.tickFormat reading the visible table before the new reader
  // is made) is not that revision's, though it is still `state.table`: ownership is fixed when the table is built.
  return (settled && reading === d.reader.table) || (drawing && reading === state.table && state.owners.get(reading) === c.accepted);
}

function bubbleLayout(state: BubbleState): Composition['layout'] {
  const base = cartesianLayout({ linear: linearScale, time: timeScale, temporalTicks });
  return {
    prepareTicks: base.prepareTicks,
    layoutDiagnostics(view, ctx, layout) {
      const out = [...(base.layoutDiagnostics?.(view, ctx, layout) ?? [])];
      const meta = state.layouts.get(layout) ?? state.metas.get(ctx.resolved);
      if (!meta || view.kind !== 'scatter' || !meta.format) return out;
      // AX160 for the size format, at the layout stage the stock axes report theirs from. The texts formatted
      // here, once per layout, are the ones a ready chart always shows: the size legend's reference values and
      // the summary's range. A row formatted later (table, tooltip, export) that throws schedules a frame
      // (watchSizeFormat above), and this stage then reports what has failed so far.
      // Effect 'changed': the size is shown in a default format instead of the author's, which the reader's note
      // must say (unlike a tick label, whose AX160 is 'none').
      if (!state.checked.has(layout)) {
        state.checked.add(layout);
        const channel = sizeChannel(view.frame, meta.sizes);
        if (channel.max >= 0) {
          for (const entry of referenceSizes(channel.max)) sizeText(meta, state.locale, entry, NO_DATA);
          sizeText(meta, state.locale, channel.min, NO_DATA); sizeText(meta, state.locale, channel.max, NO_DATA);
        }
      }
      if (sizeFormatFailed(meta)) out.push(createDiagnostic('AX160', 'changed', { field: meta.field }, 'presentation'));
      return out;
    },
    layoutKey(view, size, style, fontEpoch, ctx) {
      const key = base.layoutKey(view, size, style, fontEpoch, ctx);
      return [...key, state.metas.get(ctx.resolved) ?? null];
    },
    compute(view, size, text, ctx) {
      const layout = base.compute(view, size, text, ctx);
      const meta = state.metas.get(ctx.resolved);
      if (meta) state.layouts.set(layout, meta);
      return layout;
    },
  };
}

function metaOfLayout(state: BubbleState, layout: Layout): BubbleMeta | null {
  return state.layouts.get(layout) ?? committedMeta(state);
}

const paintIndex = (series: number) => ({ kind: 'series', index: series }) as const;

function sceneWith(state: BubbleState): Composition['scene'] {
  return (view, layout, dpr) => {
    const meta = metaOfLayout(state, layout);
    const layers: DataLayers = (v, projection) => {
      if (!meta || v.kind !== 'scatter' || projection.kind !== 'xy') return [];
      const g = bubbleGeometry(v, layout, meta);
      state.drawn = g;
      if (!g) return [];
      // One path per series that has a drawn bubble, in frame series order: the paths do not overlap (each
      // holds only what its series shows on top), so their order does not change the picture.
      const S = v.frame.series.length;
      const present = new Uint8Array(S);
      for (let b = 0; b < g.count; b++) present[g.series[b]!] = 1;
      const marks: BubbleMark[] = [];
      for (let s = 0; s < S; s++) if (present[s]) marks.push(bubbleMark(g, noMembers ??= new Uint32Array(0), s, 'series', S));
      return [marks];
    };
    return cartesianScene(layers, view, layout, dpr);
  };
}

let noMembers: Uint32Array | undefined;
/** Tables with a failing size read not reported for want of ownership: their rows are cached, so a later read offers it again. */
let missed: WeakSet<TableModel> | undefined;

function bubbleMark(geometry: BubbleGeometry, members: Uint32Array, series: number, paint: BubbleMark['bubble']['paint'], seriesCount: number): BubbleMark {
  return {
    type: 'points', series, xy: new Float32Array(0), shape: 'circle', size: 0,
    fill: paint === 'halo' ? { kind: 'token', name: 'text' } : paintIndex(series),
    bubble: { geometry, members, paint, seriesCount },
  };
}

/** The `points` drawer: bubble discs as one path per mark; any other points mark as the stock drawer does. */
export const svgBubbles: SvgMark<PointMark> = (c, n, mark, bindings, dpr, clip) => {
  const bubble = (mark as Partial<BubbleMark>).bubble;
  if (!bubble) {
    svgPoints(c, n, mark, bindings, dpr, clip);
    return;
  }
  const source = n.source ??= [];
  const el = n.el;
  // This drawer writes the element directly: the stock drawers' caches of what they wrote no longer hold, so a
  // stock mark reusing this node later writes everything again.
  if (n.attrs) delete n.attrs.d;
  n.styles = null;
  if (source[0] !== bubble.geometry || source[1] !== bubble.members || source[2] !== bubble.paint || source[3] !== mark.series) {
    const g = bubble.geometry;
    el.setAttribute('d', bubble.paint === 'series' ? paintedMap(g, bubble.seriesCount).series[mark.series]?.d ?? ''
      : bubble.paint === 'halo' ? haloPath(g, bubble.members, 2) : circlesPath(g, bubble.members));
    // What the path holds, for tests and export: its paint role and the frame series index.
    el.setAttribute('data-bubble', bubble.paint);
    el.setAttribute('data-series', String(mark.series));
    source[0] = g; source[1] = bubble.members; source[2] = bubble.paint; source[3] = mark.series;
  }
  const paint = mark.fill.kind === 'series' ? bindings.series[mark.fill.index] ?? null
    : mark.fill.kind === 'token' ? bindings.tokens[mark.fill.name] : null;
  const style = el.style;
  if (paint !== null) style.setProperty('color', paint);
  // Opaque paint: a series path holds exactly what that series shows, so nothing is blended.
  const filled = bubble.paint === 'series' || bubble.paint === 'focus';
  style.setProperty('fill', filled ? 'currentColor' : 'none');
  style.setProperty('fill-rule', 'nonzero');
  style.setProperty('stroke', filled ? 'none' : 'currentColor');
  style.setProperty('stroke-width', bubble.paint === 'halo' ? '2' : '1');
};

function haloPath(g: BubbleGeometry, members: Uint32Array, grow: number): string {
  let d = '';
  for (let i = 0; i < members.length; i++) {
    const b = members[i]!, r = drawnRadius(g.r[b]!) + grow;
    const scale = scaleFor(r), rr = writeRadius(r), dd = writeRadius(2 * r);
    d += `M${writeNum(g.x[b]! - r, scale)} ${writeNum(g.y[b]!, scale)}a${rr} ${rr} 0 1 0 ${dd} 0a${rr} ${rr} 0 1 0 -${dd} 0Z`;
  }
  return d;
}

const EMPTY_TOOLTIP = { title: '', rows: [], count: 0, total: null } as const;
const EDGE_REACH = 24;

/**
 * The bubble lookup: the scatter lookup's order, stepping, ordinals and reading, with the picking rule and the
 * readouts of bubbles. Pick: among the bubbles whose painted shape contains the pointer (a disc: distance ≤ r + 0.5
 * CSS px; a zero marker: its ring, ZERO_RADIUS ± 1), the one painted on top (the smallest; equal radii the later
 * source row; a zero marker above every disc). Only when
 * no disc contains the pointer, the bubble whose edge is nearest within 24 CSS px; ties within half a device
 * pixel go to the later row. Keyboard stepping, ordinals and focus recovery skip points without a drawn bubble
 * (a size that is null or omitted): they stay in the table and export.
 */
function lookupWith(state: BubbleState): Composition['lookup'] {
  return (view, layout, formatters, messages, given, dpr = 1) => {
    const locale = given ?? state.locale;
    const base = scatterLookup(view as ScatterView, layout.kind === 'plot' || layout.kind === 'compact' ? layout : null, formatters, undefined, dpr, { lazy: true });
    const meta = metaOfLayout(state, layout);
    if (view.kind !== 'scatter' || !meta) return base;
    const g = bubbleGeometry(view, layout, meta);
    const channel = sizeChannel(view.frame, meta.sizes);
    if (g) state.geometries.set(view, g);
    state.locale = locale;
    const legend = legendModel(meta, channel, locale, messages);
    state.legends.set(layout, legend);
    updateLegend(state, legend);
    const keys = new Map(view.frame.series.map((s, i) => [s.key, i]));
    const bubbleOf = (ref: DatumRef): number => {
      const s = ref.kind === 'point' ? keys.get(ref.seriesKey) : undefined;
      return g && s !== undefined && ref.kind === 'point' ? bubbleFor(g, s, ref.row) : -1;
    };
    const grid = g ? pickGrid(g) : null;
    const tie = 0.5 / (dpr > 0 ? dpr : 1);
    const refOf = (b: number): DatumRef => {
      const s = g!.series[b]!, series = view.frame.series[s]!;
      return { kind: 'point', seriesKey: series.key, row: g!.row[b]!, x: series.x[g!.index[b]!]! };
    };
    const write = (ref: DatumRef): DatumText | null => {
      const text = base.datum(ref);
      if (!text || ref.kind !== 'point') return text;
      // The size as given, drawn or not: an omitted bubble (AX187) still reads its raw value, as the table does.
      return { ...text, value: `${text.value}; ${meta.label}: ${rowSizeText(meta, ref.row, locale, messages)}` };
    };
    const lookup: Lookup = {
      ...base,
      pick(px, py): PickTarget | null {
        if (!g || !grid || (layout.kind !== 'plot' && layout.kind !== 'compact')) return null;
        const p = pointerOnPlot(layout.plot, px, py);
        if (!p) return null;
        const b = grid.pick(p.x, p.y, tie);
        return b < 0 ? null : { kind: 'point', refs: [refOf(b)], count: 1 };
      },
      members(target, from, count) {
        if (target.kind !== 'point' || from > 0 || count <= 0 || !target.refs[0]) return [];
        return [target.refs[0]];
      },
      has(target, ref) {
        const first = target.kind === 'point' ? target.refs[0] : undefined;
        return !!first && first.kind === 'point' && ref.kind === 'point' && first.seriesKey === ref.seriesKey && first.row === ref.row;
      },
      tooltip(target) {
        if (target.kind !== 'point') return EMPTY_TOOLTIP;
        const rows = target.refs.slice(0, 1).flatMap(ref => { const t = write(ref); return t ? [t] : []; });
        return { title: rows[0]?.x ?? '', rows, count: rows.length, total: null };
      },
      datum: write,
      anchor(ref) {
        const b = g ? bubbleOf(ref) : -1;
        if (b < 0) return null;
        const r = drawnRadius(g!.r[b]!);
        return { x: g!.x[b]! - r, y: g!.y[b]! - r, width: 2 * r, height: 2 * r };
      },
      get count() { return base.count - undrawnOrdinals().length; },
      ordinal(ref) {
        if (!drawn(ref)) return -1;
        const at = base.ordinal(ref);
        return at < 0 ? -1 : at - lowerBound(undrawnOrdinals(), at);
      },
      step(from, direction) { return stepDrawn(base, view, drawn, from, direction); },
      resolve(ref) { return resolveDrawn(base, drawn, ref); },
    };
    // A point without a bubble in the drawn geometry (a size that is not drawable, or a centre outside the
    // plotted domain) is in the view and the table, but the keyboard, count, ordinals and anchors skip it.
    const drawn = (ref: DatumRef): boolean => {
      if (ref.kind !== 'point') return false;
      if (g) return bubbleOf(ref) >= 0;
      const s = keys.get(ref.seriesKey);
      const slot = s === undefined ? -1 : base.slot(ref);
      return slot >= 0 && !Number.isNaN(channel.values[s!]![slot]!);
    };
    let undrawn: Int32Array | null = null;
    const undrawnOrdinals = (): Int32Array => {
      if (undrawn) return undrawn;
      const found: number[] = [];
      view.frame.series.forEach((series, s) => {
        if (!view.visible[s] || !series.drawable) return;
        const { start, end } = view.visiblePoints[s]!;
        const values = channel.values[s]!;
        for (let i = start; i < end; i++) {
          const row = series.row ? series.row[i]! : i;
          if (g ? bubbleFor(g, s, row) >= 0 : !Number.isNaN(values[i]!)) continue;
          const at = base.ordinal({ kind: 'point', seriesKey: series.key, row, x: series.x[i]! });
          if (at >= 0) found.push(at);
        }
      });
      return undrawn = Int32Array.from(found).sort();
    };
    return lookup;
  };
}

/** A uniform grid of bubble centres; a query visits the cells within (largest radius + 24 px) of the pointer. */
export function pickGrid(g: BubbleGeometry) {
  const cell = Math.max(16, Math.ceil(g.reach));
  const { plot } = g;
  const cols = Math.max(1, Math.ceil(plot.width / cell) + 1), rows = Math.max(1, Math.ceil(plot.height / cell) + 1);
  const cellOf = (x: number, y: number) => {
    const cx = Math.min(cols - 1, Math.max(0, Math.floor((x - plot.x) / cell)));
    const cy = Math.min(rows - 1, Math.max(0, Math.floor((y - plot.y) / cell)));
    return cy * cols + cx;
  };
  const start = new Uint32Array(cols * rows + 1);
  for (let b = 0; b < g.count; b++) start[cellOf(g.x[b]!, g.y[b]!) + 1]!++;
  for (let c = 0; c < cols * rows; c++) start[c + 1]! += start[c]!;
  const items = new Uint32Array(g.count), fill = start.slice(0, cols * rows);
  for (let b = 0; b < g.count; b++) items[fill[cellOf(g.x[b]!, g.y[b]!)]!++] = b;
  return {
    pick(px: number, py: number, tie: number): number {
      const reach = g.reach + EDGE_REACH;
      const c0 = Math.max(0, Math.floor((px - reach - plot.x) / cell)), c1 = Math.min(cols - 1, Math.floor((px + reach - plot.x) / cell));
      const r0 = Math.max(0, Math.floor((py - reach - plot.y) / cell)), r1 = Math.min(rows - 1, Math.floor((py + reach - plot.y) / cell));
      let inside = -1, insideRank = -1;
      let nearEdge = Infinity;
      for (let cy = r0; cy <= r1; cy++) {
        for (let cx = c0; cx <= c1; cx++) {
          const c = cy * cols + cx;
          for (let k = start[c]!; k < start[c + 1]!; k++) {
            const b = items[k]!;
            const r = drawnRadius(g.r[b]!);
            const d = Math.hypot(px - g.x[b]!, py - g.y[b]!);
            if (d <= r + 0.5 && (g.r[b]! > 0 || d >= ZERO_RADIUS - 1)) {
              // The topmost containing bubble in painter's order (smallest, then latest row): what is seen there.
              if (g.rank[b]! > insideRank) { inside = b; insideRank = g.rank[b]!; }
            } else {
              const edge = edgeDistance(g, b, px, py);
              if (edge < nearEdge) nearEdge = edge;
            }
          }
        }
      }
      if (inside >= 0) return inside;
      if (!(nearEdge <= EDGE_REACH)) return -1;
      // Second pass against the true minimum: the latest row whose edge is within `tie` of it. A running
      // comparison would drift (each new minimum within the window moves the window).
      let near = -1;
      for (let cy = r0; cy <= r1; cy++) {
        for (let cx = c0; cx <= c1; cx++) {
          const c = cy * cols + cx;
          for (let k = start[c]!; k < start[c + 1]!; k++) {
            const b = items[k]!;
            const edge = edgeDistance(g, b, px, py);
            if (edge <= nearEdge + tie && edge <= EDGE_REACH && (near < 0 || g.row[b]! > g.row[near]!)) near = b;
          }
        }
      }
      return near;
    },
  };
}

/**
 * Distance from the pointer to what bubble `b` paints, for the fallback when no painted shape contains it. A zero
 * marker paints only its ring (ZERO_RADIUS ± 0.5): its hollow centre is not painted by it, so a positive disc
 * seen through the hole wins there (true containment above), and only where nothing contains the pointer does
 * the hole count as touching the ring (distance 0), so an isolated zero marker is as easy to pick as a disc.
 */
function edgeDistance(g: BubbleGeometry, b: number, px: number, py: number): number {
  const d = Math.hypot(px - g.x[b]!, py - g.y[b]!);
  return g.r[b]! > 0 ? d - g.r[b]! : Math.max(0, d - ZERO_RADIUS);
}

/** The hovered or selected bubble drawn opaque above every other, with a ring, so a covered bubble is seen. */
function overlayWith(state: BubbleState): TargetMarks {
  return ({ view, layout, lookup, target }, _plot, clipped) => {
    if (target?.kind !== 'point' || view.kind !== 'scatter') return;
    const meta = metaOfLayout(state, layout);
    const g = meta ? bubbleGeometry(view, layout, meta) : null;
    if (!g) return;
    for (const ref of target.refs) {
      const box = lookup.anchor(ref);
      if (!box || ref.kind !== 'point') continue;
      const s = view.frame.series.findIndex(series => series.key === ref.seriesKey);
      const b = bubbleFor(g, s, ref.row);
      if (b < 0) continue;
      const one = Uint32Array.of(b);
      clipped.push(
        bubbleMark(g, one, s, 'halo', view.frame.series.length),
        bubbleMark(g, one, s, g.r[b] === 0 ? 'hollow' : 'focus', view.frame.series.length),
      );
    }
  };
}

const sameRef = (a: DatumRef, b: DatumRef): boolean =>
  a.kind === 'point' && b.kind === 'point' && a.seriesKey === b.seriesKey && a.row === b.row;

type Step = (from: DatumRef | null, direction: StepDirection) => DatumRef | null;

/** Steps `direction` from `from` until a drawn point; null at the end. Bounded by the steps a view can take. */
function walk(step: Step, drawn: (ref: DatumRef) => boolean, from: DatumRef, direction: 'next' | 'previous', limit: number): DatumRef | null {
  let at: DatumRef | null = from;
  for (let k = 0; k < limit && at; k++) {
    at = step(at, direction);
    if (at && drawn(at)) return at;
  }
  return null;
}

/** The base resolution, moved to the nearest drawn point after it, else before it: focus is never left on nothing. */
function resolveDrawn(base: Lookup, drawn: (ref: DatumRef) => boolean, ref: DatumRef): DatumRef | null {
  const at = base.resolve(ref);
  if (!at || drawn(at)) return at;
  const limit = base.count + 1;
  return walk(base.step, drawn, at, 'next', limit) ?? walk(base.step, drawn, at, 'previous', limit);
}

/**
 * The scatter lookup's keyboard order over drawn points only. Every direction lands on a drawn point or returns
 * null as the base does at an edge; from a point that is not drawn (or gone) it starts at the nearest drawn one.
 */
function stepDrawn(base: Lookup, view: ScatterView, drawn: (ref: DatumRef) => boolean, from: DatumRef | null, direction: StepDirection): DatumRef | null {
  const limit = base.count + 1;
  const step: Step = (f, d) => base.step(f, d);
  if (!from) {
    const first = base.step(null, 'next');
    return !first || drawn(first) ? first : walk(step, drawn, first, 'next', limit);
  }
  const at = resolveDrawn(base, drawn, from);
  if (!at) return stepDrawn(base, view, drawn, null, 'next');
  return stepFromDrawn(step, view, drawn, at, direction, limit, true);
}

function stepFromDrawn(
  step: Step, view: ScatterView, drawn: (ref: DatumRef) => boolean, at: DatumRef, direction: StepDirection, limit: number, crossSeries: boolean,
): DatumRef | null {
  const differs = (to: DatumRef | null) => (to && !sameRef(to, at) ? to : null);
  switch (direction) {
    case 'next':
    case 'previous': return walk(step, drawn, at, direction, limit);
    case 'first':
    case 'last': {
      const edge = step(at, direction);
      if (!edge) return null;
      return differs(drawn(edge) ? edge : walk(step, drawn, edge, direction === 'first' ? 'next' : 'previous', limit));
    }
    case 'page-next':
    case 'page-previous': {
      const to = step(at, direction);
      if (!to) return null;
      if (drawn(to)) return to;
      const ahead = direction === 'page-next' ? 'next' : 'previous';
      return differs(walk(step, drawn, to, ahead, limit) ?? walk(step, drawn, to, ahead === 'next' ? 'previous' : 'next', limit));
    }
    case 'series-next':
    case 'series-previous': {
      if (!crossSeries) return null;
      // The nearest point of the neighbouring series; if it has no bubble, the nearest drawn one in that series,
      // else the series after it.
      let to = step(at, direction);
      for (let k = 0; to && k <= view.frame.series.length; k++) {
        if (drawn(to)) return to;
        const inSeries: Step = (f, d) => (f ? stepInSeries(view, f, d) : null);
        const near = walk(inSeries, drawn, to, 'next', limit) ?? walk(inSeries, drawn, to, 'previous', limit);
        if (near) return near;
        to = step(to, direction);
      }
      return null;
    }
  }
}

/**
 * `stepInSeries` (single-series keyboard stepping) over drawn points only, on a typed list of the series' drawn
 * point indexes (ascending, the order stepInSeries walks): each step is the stock target index snapped to the
 * nearest drawn one by binary search, so a series of 50,000 mostly omitted rows costs O(log n) per key after
 * one O(n) pass, never a scan per skipped row.
 */
function stepInSeriesWith(state: BubbleState): NonNullable<Composition['interaction']['stepInSeries']> {
  return (view, ref, direction) => {
    const meta = committedMeta(state);
    if (!meta || ref.kind !== 'point') return stepInSeries(view, ref, direction);
    const s = view.frame.series.findIndex(series => series.key === ref.seriesKey);
    const series = view.frame.series[s], range = view.visiblePoints[s];
    if (!series || !range || range.end <= range.start) return null;
    const slots = slotsByRow(series);
    const at = ref.row >= 0 && ref.row < slots.length ? slots[ref.row]! : -1;
    if (at < range.start || at >= range.end) return null;
    const list = drawnSlots(state, view, s, meta);
    const refAt = (i: number): DatumRef => ({ kind: 'point', seriesKey: series.key, row: series.row ? series.row[i]! : i, x: series.x[i]! });
    const n = list.length;
    if (!n) return null;
    // Nearest drawn index at or after / at or before `i`, or -1.
    const after = (i: number) => { const k = lowerBound(list, i); return k < n ? list[k]! : -1; };
    const before = (i: number) => { const k = lowerBound(list, i + 1) - 1; return k >= 0 ? list[k]! : -1; };
    const out = (i: number) => (i < 0 || i === at ? null : refAt(i));
    switch (direction) {
      case 'next': return out(after(at + 1));
      case 'previous': return out(before(at - 1));
      case 'first': return out(list[0]!);
      case 'last': return out(list[n - 1]!);
      case 'page-next':
      case 'page-previous': {
        const to = stepIndex(direction, at, range.start, range.end);
        if (to === null) return null;
        const ahead = direction === 'page-next' ? after(to) : before(to);
        return out(ahead >= 0 ? ahead : direction === 'page-next' ? before(to) : after(to));
      }
      default: return null;
    }
  };
}

let drawnLists: WeakMap<object, Map<number, Int32Array>> | undefined;
/** Drawn point indexes of series `s` inside its visible range, ascending; cached per geometry (or view). */
function drawnSlots(state: BubbleState, view: ScatterView, s: number, meta: BubbleMeta): Int32Array {
  const g = state.geometries.get(view);
  const owner: object = g ?? view;
  let bySeries = (drawnLists ??= new WeakMap()).get(owner);
  if (!bySeries) drawnLists.set(owner, bySeries = new Map());
  const known = bySeries.get(s);
  if (known) return known;
  const range = view.visiblePoints[s]!, series = view.frame.series[s]!;
  let list: Int32Array;
  if (g) {
    let m = 0;
    for (let b = 0; b < g.count; b++) if (g.series[b] === s && g.index[b]! >= range.start && g.index[b]! < range.end) m++;
    list = new Int32Array(m);
    m = 0;
    for (let b = 0; b < g.count; b++) if (g.series[b] === s && g.index[b]! >= range.start && g.index[b]! < range.end) list[m++] = g.index[b]!;
    list.sort();
  } else {
    const values = sizeChannel(view.frame, meta.sizes).values[s]!;
    const found: number[] = [];
    if (series.drawable) for (let i = range.start; i < range.end; i++) if (!Number.isNaN(values[i]!)) found.push(i);
    list = Int32Array.from(found);
  }
  bySeries.set(s, list);
  return list;
}

let slotIndexes: WeakMap<object, Int32Array> | undefined;
/** Point index by source row for one series (-1: not in it). */
function slotsByRow(series: ScatterView['frame']['series'][number]): Int32Array {
  const known = (slotIndexes ??= new WeakMap()).get(series);
  if (known) return known;
  const rows = series.row, n = series.x.length;
  let max = n - 1;
  if (rows) for (let i = 0; i < n; i++) if (rows[i]! > max) max = rows[i]!;
  const index = new Int32Array(max + 1).fill(-1);
  for (let i = 0; i < n; i++) index[rows ? rows[i]! : i] = i;
  slotIndexes.set(series, index);
  return index;
}

/** What the chart shows right now, all from one drawn revision: what export reads. */
export interface BubbleSnapshot {
  readonly revision: number;
  readonly meta: BubbleMeta;
  /** The drawn revision's table (every row through `row(i)`), null when `table: false`. */
  readonly table: TableModel | null;
  readonly legend: LegendModel;
  readonly geometry: BubbleGeometry | null;
}

/** Per drawn layout, the snapshot and the reader it was taken with (a resize keeps reader and revision). */
let snapshots: WeakMap<Layout, { reader: object; snapshot: BubbleSnapshot }> | undefined;

/**
 * The snapshot of the revision on screen (controller.drawn), never of one accepted but not yet drawn: every field
 * comes from the same drawn state, so a size update read before its frame still sees the old meta with the old
 * table. Null before the first frame, for an error revision, and after destroy.
 */
export function bubbleSnapshot(state: BubbleState): BubbleSnapshot | null {
  const c = state.controller;
  if (!c || c.destroyed) {
    if (c?.destroyed) { state.table = null; state.legend = null; state.drawn = null; state.list = null; state.rendered = null; }
    return null;
  }
  const d = c.drawn;
  if (!d || d.accepted.view.kind !== 'scatter') return null;
  const known = (snapshots ??= new WeakMap()).get(d.layout);
  if (known && known.reader === d.reader && known.snapshot.revision === d.accepted.revision) return known.snapshot;
  const meta = state.layouts.get(d.layout) ?? state.metas.get(d.accepted.resolved);
  if (!meta) return null;
  // The legend the drawn layout's lookup built and the legend list rendered: a read, never a new call of the
  // author's format, so export sees the very texts on screen and no user code runs (or destroys the chart) here.
  const legend = state.legends.get(d.layout);
  if (!legend) return null;
  const view = d.accepted.view;
  const snapshot: BubbleSnapshot = {
    revision: d.accepted.revision, meta, table: d.reader.table, legend,
    geometry: bubbleGeometry(view, d.layout, meta),
  };
  snapshots.set(d.layout, { reader: d.reader, snapshot });
  return snapshot;
}

function updateLegend(state: BubbleState, model: LegendModel): void {
  state.legend = model;
  // The toolbar redraws the legend only when its own inputs change, which a single-series chart's size, data or
  // locale change does not touch, so the bubble writes it. Inside the frame that draws the accepted revision this
  // lookup stage is past every point that can abandon the frame (author code ran above, and nothing of the
  // author's runs before the plot is written and published): the legend is written now, with the plot, so no
  // callback after the frame and no export sees a new plot beside the old legend.
  if (!state.list) return;
  const c = state.controller;
  // A lookup made inside a frame is published by that frame, also when author code it ran (a size format calling
  // update) accepted a newer revision meanwhile: the core still publishes the in-flight plot and table once it has
  // started writing, so the legend is written with them, before any callback runs.
  if (c && !c.destroyed && c.inFrame && c.inflight !== null) {
    if (state.rendered?.signature !== model.signature) renderLegend(state.list.ownerDocument, state.list, model);
    state.rendered = model;
    if (c.inflight === c.accepted) return;
  } else if (state.rendered?.signature === model.signature) return;
  // Otherwise (a lookup made outside a frame, or a superseded frame that may stop before it writes) the legend
  // follows the layout actually drawn once the current task is done.
  if (state.refreshQueued) return;
  state.refreshQueued = true;
  queueMicrotask(() => {
    state.refreshQueued = false;
    const list = state.list, ctl = state.controller, d = ctl?.drawn;
    const shown = (d && state.legends.get(d.layout)) ?? state.legend;
    if (list && shown && ctl && !ctl.destroyed && state.rendered?.signature !== shown.signature) {
      renderLegend(list.ownerDocument, list, shown);
      state.rendered = shown;
    }
  });
}

function readerWith(state: BubbleState): ReaderParts {
  return {
    table(view, caption, formatters, messages, labels, locale) {
      const meta = committedMeta(state) ?? state.last;
      retire(state, meta);
      if (!meta || view.kind !== 'scatter') return scatterReader.table(view, caption, formatters, messages, labels, locale);
      const built = bubbleTable(view, caption, formatters, messages, labels, meta, sizeChannel(view.frame, meta.sizes), locale ?? state.locale);
      // Every row read names its table, so a size format failure is reported only for the table that owns it.
      // The controller caches each row once per table (it replaces `row`), so a failure a read could not report
      // (the table was not the accepted revision's yet) is offered again on any later read (every read looks `row`
      // up), as a read of this table under the same guard.
      // A negative ordinal is that offer: a missed failure is the meta's, read as this table's.
      const read: TableModel['row'] = i => {
        const outer = state.reading;
        state.reading = table;
        try { return i < 0 ? (missed?.has(table) && sizeMissed(meta)) as never : built.row(i); } finally { state.reading = outer; }
      };
      let row = read;
      const table: TableModel = {
        ...built,
        get row() { return read(-1), row; },
        set row(kept) { row = kept; },
      };
      const c = state.controller;
      if (c) state.owners.set(table, (c.inFrame && c.inflight) || c.accepted!);
      state.table = table;
      return table;
    },
    text(input, type, xLabel, yLabel, table, listReady) {
      const sentences = scatterReader.text(input, type, xLabel, yLabel, table, listReady);
      const meta = committedMeta(state) ?? state.last;
      retire(state, meta);
      if (!meta || input.view.kind !== 'scatter') return sentences;
      const channel = sizeChannel(input.view.frame, meta.sizes);
      const locale = input.locale ?? state.locale;
      if (channel.max >= 0) {
        sentences.push(`Bubble area shows ${meta.label}, from ${sizeText(meta, locale, channel.min, input.messages)} to ${sizeText(meta, locale, channel.max, input.messages)}.`);
      }
      return sentences;
    },
    stateKey: () => committedMeta(state),
  };
}

/**
 * A size format finding belongs to the size options (meta) that made it, as a stock formatter's belongs to its
 * formatters: once the reader of a revision with another meta is made, the controller's report for the old one
 * is withdrawn (an empty chart has no layout stage whose findings would replace it). An equal meta is the same
 * object (resolveWith), so an update that keeps the size options keeps its finding.
 */
function retire(state: BubbleState, meta: BubbleMeta | null): void {
  const failed = state.failed, c = state.controller;
  if (!failed || failed === meta || !c) return;
  state.failed = null;
  c.fallback?.(failed.field, c, c);
}

function sliceListWith(state: BubbleState): NonNullable<Composition['interaction']['sliceList']> {
  return (doc, d, _actions, list) => {
    const meta = committedMeta(state);
    const shown = d !== null && d.view.kind === 'scatter' && !!d.legend && !d.tooSmall && (d.ready || !!d.inspectable) && meta !== null;
    if (!shown) {
      list?.remove();
      if (state.list === list) { state.list = null; state.rendered = null; }
      return null;
    }
    const own = list ?? doc.createElement('ul');
    const model = state.legend ?? legendModel(meta!, sizeChannel((d!.view as ScatterView).frame, meta!.sizes), state.locale, d!.messages);
    renderLegend(doc, own, model);
    state.list = own;
    state.rendered = model;
    return own;
  };
}

/**
 * The composition of one bubble chart. `kind` is 'scatter': the shared controller, view and axes treat the frame
 * as the point frame it is (x then y order, x-only zoom, scatter's 24 px reach), and only these stages differ.
 */
export function createBubbleComposition(state: BubbleState): Composition {
  const layout = bubbleLayout(state);
  return {
    kind: 'scatter',
    resolve: resolveWith(state),
    normalize: (_kind, resolved, env: DataEnvironment, sink, version) => {
      if (state.controller === null && 'accepted' in env) state.controller = env as unknown as BubbleState['controller'];
      return normalizePoints(resolved, env, sink, version);
    },
    view: buildScatterView as Composition['view'],
    layout,
    timeReadout: createTimeReadout,
    scene: sceneWith(state),
    lookup: lookupWith(state),
    reader: readerWith(state),
    interaction: { overlay: overlayWith(state), swatch: pointSwatch, stepInSeries: stepInSeriesWith(state), sliceList: sliceListWith(state) },
    svg: { points: svgBubbles, rule: svgRule, band: svgBand },
  };
}
