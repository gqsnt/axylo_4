/**
 * The `axylo/finance` composition and its chart wrapper, apart from the entry point so a test can open the
 * same composition on a recording host (no DOM) and check strict rollback end to end.
 */
import type { ChartHandle } from '../core/instrument';
import type { Composition } from '../core/composition';
import { StrictError } from '../core/delivery';
import { applyPatch, type OptionRecord } from '../core/options';
import type { Diagnostic } from '../public';
import { lineSwatch } from '../dom/swatch';
import { createTimeReadout } from '../format/time';
import {
  buildFinanceView, createFinanceResolver, normalizeFinance, parseFinanceInput,
  type FinanceStateRef, type FinanceValidationIssue, type ParsedFinance,
} from './core';
import { financeLayout } from './layout';
import {
  buildFinanceScene, createFinanceLookup, createFinanceOverlay, createFinanceReader, financeSvgMarks,
} from './render';

/** A static chart handle: everything but `append`. */
export type FinanceHandle = Omit<ChartHandle, 'append'>;

export function createFinanceComposition(
  stateRef: FinanceStateRef,
  pendingIssues: { list: readonly FinanceValidationIssue[] },
): Composition {
  return {
    kind: 'line',
    resolve: createFinanceResolver(stateRef, pendingIssues),
    normalize: ((kind, resolved, env, sink, version) => normalizeFinance(stateRef, kind, resolved, env, sink, version)) as Composition['normalize'],
    view: ((frame, state, sink) => buildFinanceView(stateRef, frame as never, state as never, sink)) as Composition['view'],
    layout: financeLayout(stateRef),
    timeReadout: createTimeReadout,
    scene: (view, lay, dpr) => buildFinanceScene(stateRef, view, lay, dpr),
    lookup: (view, lay, formatters, messages, locale) => createFinanceLookup(stateRef, view, lay, formatters, messages, locale),
    reader: createFinanceReader(stateRef),
    interaction: { overlay: createFinanceOverlay(stateRef), swatch: lineSwatch, stepInSeries: null, sliceList: null },
    svg: financeSvgMarks,
  };
}

type Handler = (d: Diagnostic) => void;

/** One decision (create or update) in progress: each finding held for it, with the handler it was addressed to. */
interface Deciding {
  readonly held: { readonly handler: unknown; readonly d: Diagnostic }[];
}

/**
 * Opens a candlestick chart with `open` (the browser's static chart, or a test host). The wrapper keeps the
 * raw finance options the chart last accepted, snapshotted where they were submitted (core applyPatch: plain
 * objects copied, functions and data borrowed), and hands the controller each call's meta and pending AX180
 * issues just before it resolves that call; the stages read the meta bound to the revision they draw.
 *
 * The author's `onDiagnostic` is held while a call is decided and handed each finding synchronously once that
 * call is accepted or rolled back, before it returns or throws. A handler that updates the chart then runs over
 * committed options, and that update returns or throws its own strict error to its own caller. An update made
 * by other author code while a call is decided (a getter read with the patch) waits until that call is decided,
 * then runs over the options accepted by then: run at once it would be merged into options that may yet be
 * rejected, or be undone by the outer call's rollback. The controller may deliver a call's findings later than
 * the call (while it drains notifications or draws): they still go to the handler given with that call.
 */
export function openFinanceChart(
  options: unknown,
  open: (composition: Composition, translated: Record<string, unknown>) => FinanceHandle,
): FinanceHandle {
  let acceptedRaw: OptionRecord = applyPatch({}, options).next;
  let deciding: Deciding | null = null;
  let destroyed = false;
  let handlerFailed = false;

  // Each relay is bound to the handler of the call that gave it to the controller: the controller may deliver a
  // call's findings after later calls (it defers while it drains or draws), and they still belong to that call's
  // handler. One relay per authored function keeps an unchanged handler the same function to the controller.
  const relays = new WeakMap<object, Handler>();
  // Without a handler the controller still prints each finding; there is nobody to hand it to.
  const noHandler: Handler = () => {};
  const relayFor = (handler: unknown): Handler => {
    if (typeof handler !== 'function') return noHandler;
    let relay = relays.get(handler);
    if (!relay) {
      relay = (d: Diagnostic): void => {
        if (deciding) {
          deciding.held.push({ handler, d });
          return;
        }
        // Called by the controller's delivery, which isolates a handler that throws.
        (handler as Handler)(d);
      };
      relays.set(handler, relay);
    }
    return relay;
  };
  const translate = (parsed: ParsedFinance, handler: unknown): Record<string, unknown> =>
    ({ ...parsed.translated, onDiagnostic: relayFor(handler) });
  // The controller reads each update as a patch (an absent key keeps its value), while the wrapper sends the
  // whole translation of its accepted snapshot, where a key reset to undefined is simply gone. Every key the
  // controller last accepted that the next translation lacks is therefore sent as undefined, so it returns to
  // its default there too (the commit contract) instead of being retained.
  const resetsFrom = (previous: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> => {
    const patch: Record<string, unknown> = { ...next };
    for (const key of Object.keys(previous)) if (!Object.hasOwn(next, key)) patch[key] = undefined;
    return patch;
  };
  // The held findings of one decided call, in order; a throwing handler is reported once and ignored (as core delivery).
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

  const parsed = parseFinanceInput(acceptedRaw);
  const stateRef: FinanceStateRef = { meta: parsed.meta };
  const pendingIssues = { list: parsed.issues };
  let acceptedMeta = parsed.meta;
  let acceptedIssues = parsed.issues;
  const created: Deciding = { held: [] };
  deciding = created;
  let inner: FinanceHandle;
  let acceptedTranslated = translate(parsed, acceptedRaw.onDiagnostic);
  try {
    inner = open(createFinanceComposition(stateRef, pendingIssues), acceptedTranslated);
  } catch (error) {
    deciding = null;
    release(created);
    throw error;
  }
  deciding = null;
  release(created);
  const waiting: unknown[] = [];

  const apply = (patch: unknown): void => {
    // Reading the patch runs author getters: they count as inside this update too.
    const call: Deciding = { held: [] };
    const outer = deciding;
    deciding = call;
    let failed = false;
    let failure: unknown;
    try {
      // Snapshotted here: editing the caller's objects later reaches the chart only through another update.
      const merged = applyPatch(acceptedRaw, patch).next;
      const next = parseFinanceInput(merged, acceptedMeta);
      stateRef.meta = next.meta;
      pendingIssues.list = next.issues;
      const translated = translate(next, merged.onDiagnostic);
      inner.update(resetsFrom(acceptedTranslated, translated));
      // Only once the controller accepted: a rejected call must not drop a key from what it holds.
      acceptedTranslated = translated;
      acceptedRaw = merged;
      acceptedMeta = next.meta;
      acceptedIssues = next.issues;
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

  return {
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
      // Updates made by getters while this one was decided, in order, each over what was accepted before it.
      // Their findings reached onDiagnostic; this call reports its own outcome only.
      // None of their errors replaces this call's own: a strict rejection already reached its own handler; any
      // other error is thrown after the queue has run only when this call itself succeeded, else printed.
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
    get diagnostics() { return inner.diagnostics; },
    destroy() { destroyed = true; waiting.length = 0; inner.destroy(); },
  };
}
