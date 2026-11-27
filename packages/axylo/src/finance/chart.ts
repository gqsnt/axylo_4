/**
 * The `axylo/finance` composition and its chart wrapper, apart from the entry point so a test can open the
 * same composition on a recording host (no DOM) and check strict rollback end to end.
 */
import type { ChartHandle } from '../core/instrument';
import type { Composition } from '../core/composition';
import type { ControllerCore } from '../core/controller-types';
import { StrictError } from '../core/delivery';
import { forwardSync } from '../core/peer';
import { applyPatch, type OptionRecord } from '../core/options';
import type { Diagnostic } from '../public';
import type { DataEnvironment } from '../data/normalize';
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

/**
 * `seen` is given the data environment of each normalization before any row is read: the chart controller
 * passes itself, which is how the wrapper learns what that controller accepted.
 */
export function createFinanceComposition(
  stateRef: FinanceStateRef,
  pendingIssues: { list: readonly FinanceValidationIssue[] },
  seen?: (env: DataEnvironment) => void,
): Composition {
  const resolve = createFinanceResolver(stateRef, pendingIssues)!;
  return {
    kind: 'line',
    // The controller holds the wrapper's data holder; resolution, and so every stage after it, reads the caller's own data.
    resolve: (kind, options, sink, table) => resolve(kind, unwrapData(options), sink, table),
    normalize: ((kind, resolved, env, sink, version) => {
      seen?.(env);
      return normalizeFinance(stateRef, kind, resolved, env, sink, version);
    }) as Composition['normalize'],
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

/**
 * The caller's data as the wrapper hands it to the controller. The controller tells whether data changed while it
 * previews a patch, before it installs that patch's `strict` and `onDiagnostic`, and for two arrays of one length
 * that comparison reads the rows: a throwing row getter would then fail under the previous call's settings. A
 * holder is not a plain object, so it is compared by identity alone and no row is read until the controller
 * resolves the options, under the submitted settings (spec 3.5, AX199). It points to the exact rows or columns
 * given (borrowed, plan 1.2): making it reads nothing, and the resolver gives the original back.
 */
class DataHolder {
  constructor(readonly source: unknown) {}
}

function unwrapData(options: unknown): unknown {
  const data = options !== null && typeof options === 'object' ? (options as OptionRecord).data : undefined;
  return data instanceof DataHolder ? { ...options as OptionRecord, data: data.source } : options;
}

/**
 * Merges a patch into accepted raw options by the commit contract, without reading the rows of either `data`.
 * Core applyPatch compares an old and a new value structurally to tell whether it changed; for two arrays of
 * the same length that walks the rows and runs their getters here, outside the controller's error boundary
 * (a throwing getter must become AX199 there, spec 3.5). The wrapper never needs that answer: the controller
 * makes its own comparison under its own guard. So the old data is replaced by an undefined placeholder in the
 * base: a submitted value replaces it (borrowed), an explicit undefined deletes the key, and an omitted key keeps
 * the placeholder, which is then given back the accepted data. Each submitted getter is still read once.
 */
function mergeRaw(accepted: OptionRecord, patch: unknown): OptionRecord {
  if (!Object.hasOwn(accepted, 'data')) return applyPatch(accepted, patch).next;
  const next = applyPatch({ ...accepted, data: undefined }, patch).next as Record<string, unknown>;
  if (Object.hasOwn(next, 'data') && next.data === undefined) next.data = accepted.data;
  return next;
}

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
 * A call counts as accepted only when the controller accepted it, not when its update returned: a failure while
 * it was prepared (a row getter that throws) is reported as AX199 and returns normally under non-strict, with the
 * controller still on its previous options. The controller hands itself to normalization as the data
 * environment; its accepted options record is replaced on every accepted update (and kept by a zoom), so the
 * same record after the call means the controller kept its previous revision, and so does the wrapper.
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
  // The data the controller accepted keeps its holder, so an update that leaves data alone (or gives the same
  // rows again) is no data change there and keeps the frame. Other data gets a new holder: a change, normalized.
  const translate = (parsed: ParsedFinance, handler: unknown, accepted?: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...parsed.translated, onDiagnostic: relayFor(handler) };
    if (Object.hasOwn(out, 'data')) {
      const kept = accepted?.data;
      out.data = kept instanceof DataHolder && kept.source === out.data ? kept : new DataHolder(out.data);
    }
    return out;
  };
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

  // The controller, once it first normalizes: the accepted options it holds are read before and after each call.
  let controller: Pick<ControllerCore, 'accepted'> | null = null;
  const seen = (env: DataEnvironment): void => {
    if (controller === null && 'accepted' in env) controller = env as Pick<ControllerCore, 'accepted'>;
  };
  // Before the first normalization nothing was accepted, and a call that did not reach it accepted nothing either.
  const acceptedOptions = (): OptionRecord | undefined => controller?.accepted?.options;

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
    inner = open(createFinanceComposition(stateRef, pendingIssues, seen), acceptedTranslated);
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
      const merged = mergeRaw(acceptedRaw, patch);
      const next = parseFinanceInput(merged, acceptedMeta);
      stateRef.meta = next.meta;
      pendingIssues.list = next.issues;
      const translated = translate(next, merged.onDiagnostic, acceptedTranslated);
      const before = acceptedOptions();
      inner.update(resetsFrom(acceptedTranslated, translated));
      // Only once the controller accepted: a rejected or failed call must not drop a key from what it holds, or
      // the reset it carried would not be sent again when it is retried.
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

  const handle: FinanceHandle = {
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
  // axylo/sync reaches the chart through the inner handle's seam (core/peer.ts).
  forwardSync(handle, inner);
  return handle;
}
