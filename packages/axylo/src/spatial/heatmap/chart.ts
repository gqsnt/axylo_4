/**
 * The heatmap composition and its chart wrapper, apart from the entry point so a test can open the same
 * composition on a recording host (no DOM) and check strict rollback, the legend and lookup end to end.
 *
 * The wrapper follows the `axylo/finance` wrapper (finance/chart.ts): it keeps the raw heatmap options the chart
 * last accepted, hands the controller each call's meta and pending option findings just before the controller
 * resolves that call, and restores the accepted ones afterwards, so a rejected (`strict`) or failed call leaves
 * the frame, view, table, legend and lookup of the accepted revision exactly as they were.
 *
 * The heatmap's own options (fields, categories, color scheme, domain, midpoint, bins, labels, format) shape the
 * frame. The controller cannot see them, so a call that changes any of them hands the controller new data: the
 * same rows in a new holder. The controller then normalizes, validates and accepts (or rejects) that frame like
 * any data change, and everything drawn from it follows.
 */
import type { ChartHandle } from '../../core/instrument';
import type { Composition } from '../../core/composition';
import type { ControllerCore, Drawn } from '../../core/controller-types';
import type { TableModel } from '../../core/contracts';
import { StrictError } from '../../core/delivery';
import { applyPatch, sameValue, type OptionRecord } from '../../core/options';
import type { DataEnvironment } from '../../data/normalize';
import type { Diagnostic } from '../../public';
import { lineSwatch } from '../../dom/swatch';
import { forwardSeams } from '../../export/contract';
import {
  buildHeatmapView, createHeatmapResolver, frameKeyOf, normalizeForController, parseHeatmapInput,
  type HeatmapIssue, type HeatmapMeta, type HeatmapStateRef, type ParsedHeatmap,
} from './core';
import { heatmapLayout } from './layout';
import { attachLegend, HeatmapLegend, type InteractionEntry, type LegendModel } from './legend';
import { heatmapReader } from './reader';
import { buildHeatmapScene, createHeatmapLookup, heatmapSvgMarks, heatmapTargetMarks } from './render';

/** A static chart handle: everything but `append`. */
export type HeatmapHandle = Omit<ChartHandle, 'append'>;

/**
 * What a chart hands export: the table and color bar of the revision the controller last drew (committed to the
 * page), never of a call still being decided or of one that was rejected. Both follow that revision's options:
 *
 * - `table()` is the committed reader's unpaginated table: null with `table: false` (the page has none either),
 *   before the first draw, after an internal failure, and after `destroy()`.
 * - `legend()` is the color bar model the last commit published and the page shows (the same object, legend.ts):
 *   null with `legend: false`, when the committed state is not ready (loading, error, empty: the page shows no
 *   bar), when the matrix has nothing to key, before the first draw, after an internal failure and after
 *   `destroy()`. A chart too small for its bar still answers: the bar is left out for room, not because the
 *   scale is unknown. It never formats: called from a formatter during a redraw, it is the previous commit's.
 */
export interface HeatmapInternals {
  table(): TableModel | null;
  legend(): LegendModel | null;
}

/** Per chart instance: its visible legend. */
export interface HeatmapInstance {
  readonly legend: HeatmapLegend;
}

/** What the wrapper reads of the controller: what it accepted and what it last drew. */
type ControllerView = Pick<ControllerCore, 'accepted' | 'drawn' | 'destroyed'> & { readonly host?: { readonly interaction?: InteractionEntry } };

/**
 * `seen` is given the data environment of each normalization before any row is read: the chart controller
 * passes itself, which is how the wrapper learns what that controller accepted.
 */
export function createHeatmapComposition(
  stateRef: HeatmapStateRef,
  pendingIssues: { list: readonly HeatmapIssue[] },
  instance: HeatmapInstance = { legend: new HeatmapLegend() },
  seen?: (env: DataEnvironment) => void,
): Composition {
  const resolve = createHeatmapResolver(pendingIssues);
  return {
    kind: 'line',
    resolve: (kind, options, sink, table) => resolve(kind, unwrapData(options), sink, table),
    normalize: ((kind, resolved, env, sink, version) => {
      seen?.(env);
      return normalizeForController(stateRef, kind, resolved, env, sink, version);
    }) as Composition['normalize'],
    view: ((frame, state) => buildHeatmapView(frame as never, state)) as Composition['view'],
    layout: heatmapLayout,
    scene: (view, layout, dpr) => buildHeatmapScene(view, layout, dpr),
    lookup: (view, layout, formatters, messages) => {
      // Runs whenever what the chart shows changes (view, layout, formatters, messages), before anything is
      // written: the color bar's model is formatted here, and adopted only if this frame commits.
      instance.legend.prepare(view, formatters, messages);
      return createHeatmapLookup(view, layout, formatters, messages);
    },
    reader: heatmapReader,
    interaction: { overlay: heatmapTargetMarks, swatch: lineSwatch, stepInSeries: null, sliceList: instance.legend.sliceList },
    svg: heatmapSvgMarks,
  };
}

type Handler = (d: Diagnostic) => void;

/**
 * AX132 ("more bars than pixels") is the controller's bar-density hint. A heatmap is drawn as bars only in the
 * controller's eyes, and only for a matrix with no finite cell (core.ts buildHeatmapView), so the hint never
 * describes a heatmap: cell size has its own finding, AX185. It is left out of everything the wrapper hands on.
 * (A development build may still print it once to the console: the controller prints before any handler.)
 */
const notForHeatmaps = (d: Diagnostic): boolean => d.code === 'AX132';

/** The caller's data as handed to the controller: compared by identity, so no row is read to tell a change. */
class DataHolder {
  constructor(readonly source: unknown) {}
}

function unwrapData(options: unknown): unknown {
  const data = options !== null && typeof options === 'object' ? (options as OptionRecord).data : undefined;
  return data instanceof DataHolder ? { ...options as OptionRecord, data: data.source } : options;
}

/** Merges a patch into accepted raw options without reading the rows of either `data` (see finance/chart.ts). */
function mergeRaw(accepted: OptionRecord, patch: unknown): OptionRecord {
  if (!Object.hasOwn(accepted, 'data')) return applyPatch(accepted, patch).next;
  const next = applyPatch({ ...accepted, data: undefined }, patch).next as Record<string, unknown>;
  if (Object.hasOwn(next, 'data') && next.data === undefined) next.data = accepted.data;
  return next;
}

interface Deciding {
  readonly held: { readonly handler: unknown; readonly d: Diagnostic }[];
}

let internalsByHandle: WeakMap<object, HeatmapInternals> | undefined;

/** The export hooks of a heatmap handle, or undefined for any other object. */
export function heatmapInternals(handle: object): HeatmapInternals | undefined {
  return internalsByHandle?.get(handle);
}

/**
 * Opens a heatmap with `open` (the browser's static chart, or a test host). Accepted state, held findings and
 * queued updates follow finance/chart.ts exactly; see the comments there for each rule.
 */
export function openHeatmapChart(
  options: unknown,
  open: (composition: Composition, translated: Record<string, unknown>) => HeatmapHandle,
): HeatmapHandle {
  let acceptedRaw: OptionRecord = applyPatch({}, options).next;
  let deciding: Deciding | null = null;
  let destroyed = false;
  let handlerFailed = false;

  const relays = new WeakMap<object, Handler>();
  const noHandler: Handler = () => {};
  const relayFor = (handler: unknown): Handler => {
    if (typeof handler !== 'function') return noHandler;
    let relay = relays.get(handler);
    if (!relay) {
      relay = (d: Diagnostic): void => {
        if (notForHeatmaps(d)) return;
        if (deciding) {
          deciding.held.push({ handler, d });
          return;
        }
        (handler as Handler)(d);
      };
      relays.set(handler, relay);
    }
    return relay;
  };
  // The accepted holder is kept while the rows and every frame-shaping option are the same; otherwise a new
  // holder tells the controller the data changed, and it builds (and validates) a new frame.
  const translate = (
    parsed: ParsedHeatmap, handler: unknown, accepted?: Record<string, unknown>, acceptedMeta?: HeatmapMeta,
  ): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...parsed.translated, onDiagnostic: relayFor(handler) };
    if (Object.hasOwn(out, 'data')) {
      const kept = accepted?.data;
      const same = kept instanceof DataHolder && kept.source === out.data && acceptedMeta !== undefined &&
        sameValue(frameKeyOf(acceptedMeta), frameKeyOf(parsed.meta));
      out.data = same ? kept : new DataHolder(out.data);
    }
    return out;
  };
  const resetsFrom = (previous: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> => {
    const patch: Record<string, unknown> = { ...next };
    for (const key of Object.keys(previous)) if (!Object.hasOwn(next, key)) patch[key] = undefined;
    return patch;
  };
  const release = (call: Deciding): void => {
    for (const { handler, d } of call.held) {
      if (destroyed) return;
      try {
        (handler as Handler)(d);
      } catch (error) {
        if (!handlerFailed && typeof console !== 'undefined') console.error('[axylo] onDiagnostic threw:', error);
        handlerFailed = true;
      }
    }
  };

  let controller: ControllerView | null = null;
  const seen = (env: DataEnvironment): void => {
    if (controller !== null || !('accepted' in env && 'drawn' in env)) return;
    controller = env as unknown as ControllerView;
    // Before the first frame: the legend sees every state the interaction layer is given (legend.ts).
    const entry = controller.host?.interaction;
    if (entry) attachLegend(entry, instance.legend);
  };
  const acceptedOptions = (): OptionRecord | undefined => controller?.accepted?.options;

  const parsed = parseHeatmapInput(acceptedRaw);
  const stateRef: HeatmapStateRef = { meta: parsed.meta };
  const pendingIssues = { list: parsed.issues };
  const instance: HeatmapInstance = { legend: new HeatmapLegend() };
  let acceptedMeta = parsed.meta;
  let acceptedIssues = parsed.issues;
  const created: Deciding = { held: [] };
  deciding = created;
  let inner: HeatmapHandle;
  let acceptedTranslated = translate(parsed, acceptedRaw.onDiagnostic);
  try {
    inner = open(createHeatmapComposition(stateRef, pendingIssues, instance, seen), acceptedTranslated);
  } catch (error) {
    deciding = null;
    release(created);
    throw error;
  } finally {
    stateRef.meta = acceptedMeta;
    pendingIssues.list = acceptedIssues;
  }
  deciding = null;
  release(created);
  const waiting: unknown[] = [];

  const apply = (patch: unknown): void => {
    const call: Deciding = { held: [] };
    const outer = deciding;
    deciding = call;
    let failed = false;
    let failure: unknown;
    try {
      const merged = mergeRaw(acceptedRaw, patch);
      const next = parseHeatmapInput(merged, acceptedMeta);
      stateRef.meta = next.meta;
      pendingIssues.list = next.issues;
      const translated = translate(next, merged.onDiagnostic, acceptedTranslated, acceptedMeta);
      const before = acceptedOptions();
      inner.update(resetsFrom(acceptedTranslated, translated));
      const after = acceptedOptions();
      if (after !== undefined && after !== before) {
        acceptedTranslated = translated;
        acceptedRaw = merged;
        acceptedMeta = next.meta;
        acceptedIssues = next.issues;
      }
    } catch (err) {
      failed = true;
      failure = err;
    } finally {
      deciding = outer;
      stateRef.meta = acceptedMeta;
      pendingIssues.list = acceptedIssues;
    }
    release(call);
    if (failed) throw failure;
  };

  const handle: HeatmapHandle = {
    update(patch) {
      if (deciding) {
        waiting.push(patch);
        return;
      }
      let failed = false;
      let failure: unknown;
      try {
        apply(patch);
      } catch (err) {
        failed = true;
        failure = err;
      }
      let queuedFailure: { error: unknown } | null = null;
      while (waiting.length && !destroyed) {
        try {
          apply(waiting.shift());
        } catch (err) {
          if (err instanceof StrictError) continue;
          if (failed || queuedFailure) {
            if (typeof console !== 'undefined') console.error('[axylo] a queued update threw:', err);
          } else {
            queuedFailure = { error: err };
          }
        }
      }
      if (failed) throw failure;
      if (queuedFailure) throw queuedFailure.error;
    },
    zoom(range) { inner.zoom(range); },
    on(event, listener) { return inner.on(event as never, listener as never); },
    get diagnostics() {
      const all = inner.diagnostics;
      return all.some(notForHeatmaps) ? all.filter(d => !notForHeatmaps(d)) : all;
    },
    destroy() { destroyed = true; waiting.length = 0; try { inner.destroy(); } finally { instance.legend.dispose(); } },
  };
  // axylo/sync and axylo/export reach the chart through the inner handle's seams (core/peer.ts, export/contract.ts):
  // the inner handle reads the controller's committed frame, which this wrapper never runs ahead of.
  forwardSeams(handle, inner);
  const drawnNow = (): Drawn | null => (destroyed || !controller || controller.destroyed ? null : controller.drawn);
  (internalsByHandle ??= new WeakMap()).set(handle, {
    table: () => drawnNow()?.reader.table ?? null,
    // The model the last commit published (legend.ts): no formatting here, so export never runs author code.
    legend: () => (drawnNow() ? instance.legend.exported() : null),
  });
  return handle;
}
