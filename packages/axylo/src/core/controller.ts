/**
 * The chart controller: one implementation behind every chart kind, written
 * against a `Host` that supplies everything the page provides (animation frames, the figure, the mark and
 * text renderers, the interaction layer, measurement, theme resolution). The browser host is built in
 * chart.ts; Node tests supply recording substitutes and a manual frame queue.
 *
 * Two phases (plan 1.5). A call (create, update, append, zoom) resolves options, normalizes or prepares
 * what changed and builds the view synchronously, so `diagnostics` is current when it returns and a `strict`
 * chart throws from it before anything is accepted: data changes are prepared in the store and committed
 * only after the candidate view validated. Everything that needs the page runs in the next animation frame,
 * from the accepted state only, and switches together: no frame mixes two revisions. A displayed revision
 * keeps its rows through store eviction, so hover, tooltip and `Point.row` use the revision on screen.
 *
 * Each frame stage is cached and reruns only when its inputs change (plan 2.2). In development builds the
 * handle exposes a counter per stage (`__dev.stages()`) so tests can assert what reran.
 */
import type { DatumRef, DiagnosticInput, Frame, Layout, Lookup, PaintBindings, ReaderModel, ResolvedTheme,
  Scene, TextStyle, TooltipModel, View, XKind,
} from './contracts';
import type { ChartEvents, Diagnostic, Messages, Title, XValue } from '../public';
import type { PreparedFrame } from '../data';
import { resolveFields, type ChartType } from '../data/options';
import { createDiagnostic, DiagnosticCollector, readerDisclosure, type DiagnosticCode } from '../diagnostics';
import { createFormattersWith } from '../format';
import { rowsTable, type Table } from '../data/table';
import { readerWith } from '../reader';
import { chartTypeName, fill } from '../messages';
import { lowContrastSeries, type ThemeResolution } from '../theme';
import { OptionsStore, sameValue, type OptionRecord } from './options';
import { Delivery, diagnosticKey, StrictError, strictViolations } from './delivery';
import type { AxisContext } from './axes';
import { zoomApplies } from './focus';
import {
  completeViewDiagnostics, dedupe, encodingChanged, isCompact, namesOnlyChanged, namingDiagnostics, object, publicOptions, stringOption,
  titleOf, toPublic, viewKeyFor, viewStateFor, type Span,
} from './stages';
import { sameKey, type Composition } from './composition';
import { sameTextStyle } from './environment';
import { attachHooks, StageCounter, type ChartHandle, type Stage } from './instrument';
import { COMPOSITIONS } from '../kinds';
import type {
  Accepted, Candidate, ChartKind, Controller, ControllerActions, ControllerCore, Disclosure, Display, Drawn,
  FrameRun, Held, Host, Invalidate, PlotLayout, Preparation, PresentationStage, ReaderEntry, ReadoutMode, Size, StreamSessionHandle, Viewed,
} from './controller-types';
// Keep the extracted stages next to their caller in the bundle so gzip sees their shared names.
import {
  COMPACT_TEXT_STYLE, EMPTY_DIAGNOSTICS, EMPTY_DISCLOSURE, INHERIT_LANGUAGE, ENGLISH_TAG, ALL_ENGLISH,
  STEP_PHASE1, STEP_PHASE2, STEP_THEME, STEP_MEASURE, STEP_PROBE, STEP_LAYOUT_CHECK, STEP_STRIP_MOUNT, STEP_STRIP_READ,
  STEP_READOUT, STEP_STRIP_WRITE, STEP_STRIP_MEASURE, STEP_INIT, STEP_PASS_WRITE, STEP_PASS_MEASURE, STEP_PUBLISH,
  FrameHandle, acquireFrame, hiddenIn, readoutSteps, releaseFrame, reservedStrip, sameDisclosure, sameLayoutSize, type FrameDriver, type FrameState,
} from './frame-state';
import {
  buildFormatSpec, canRecoverFields, committedStateFor, controlsStateFor, dataFindings, displayState, englishMarker, figureModelFor,
  followsLatest, followingZoom, FormatterEnvironment, formattersKeyOf, internalFailure, isWall, joinedDiagnostics, lazyLookup,
  messagesFor, messagesOf, presentationDiagnostics, readerInputsMatch, readyText, renamed, sameFormatInputs, sameReading,
  sameSeriesKeys, stateDiagnostics, streamOptions, themeKeys, zoomable, zoomPayload,
} from './controller-helpers';
import { openStreamSession, type StreamFactory } from './controller-stream';
import { ChartActions, ChartInvalidate, ControllerProbe, DeadHost, Handle } from './controller-wrappers';

export type { ChartKind, Controller, ControllerActions, FrameRun, Host, Invalidate, Size } from './controller-types';
export type { BenchHook, ChartHandle, DevHook, Stage } from './instrument';
export type { DiagnosticCode };
export { hasData, positionValue } from './controller-helpers';

/** Thrown inside a frame to stop it before anything was written (see `frame`). */
const ABORT = Symbol('axylo frame superseded');

/** Decision 0004 revision 2, rule 5: a plot narrower or shorter than this is in readout mode. */
const READOUT_WIDTH = 240;
const READOUT_HEIGHT = 140;

let emptyHidden: ReadonlySet<string> | undefined;
const EMPTY_APPEND_OPTIONS: { keep?: number } = {};
const EMPTY_REFS: readonly DatumRef[] = [];
const EMPTY_TOOLTIP: TooltipModel = { title: '', rows: [], count: 0, total: null };
const EMPTY_LOOKUP: Lookup = {
  count: 0,
  pick: () => null,
  members: () => EMPTY_REFS,
  has: () => false,
  slot: () => -1,
  tooltip: () => EMPTY_TOOLTIP,
  primary: () => null,
  datum: () => null,
  anchor: () => null,
  ordinal: () => 0,
  step: () => null,
  resolve: () => null,
};

/** Spec L8: the smallest plot height drawn. */
const MIN_PLOT_HEIGHT = 80;

/** The controller for a kind given by name (tests and Node hosts); the chart functions pass their composition. */
export function createController(kind: ChartKind, input: unknown, page: Host): Controller {
  return controllerFor(COMPOSITIONS[kind], input, page);
}

/** The controller for one chart kind: every stage that differs between kinds comes from its composition. */
export function controllerFor(
  composition: Composition, input: unknown, page: Host, streamFactory: StreamFactory | null = openStreamSession,
): Controller {
  return new ChartController(composition, input, page, streamFactory);
}

/**
 * The static entry uses the same transactions and frame pipeline with no stream factory, so
 * controller-stream.ts and the stores stay out of its bundles.
 */
export function staticControllerFor(composition: Composition, input: unknown, page: Host): Controller {
  return new StaticChartController(composition, input, page, null);
}

/**
 * One chart's controller. Its state is fields and its stages are methods, shared by every chart through the
 * prototype: a page of charts holds one small object per chart rather than a scope and a function per stage
 * each. Every field is set as the chart is made (initializers, then the constructor), in one order, so all charts
 * share one shape.
 */
class ChartController implements Controller, ControllerCore, FrameDriver {
  readonly #composition: Composition;
  readonly #kind: ChartType;
  host: Host;
  // Instrumentation (core/instrument.ts): only in development and benchmark builds; the guard folds to false in
  // the shipped production files, which then carry neither the counters nor the hooks.
  readonly stages: StageCounter | null;
  /** Printing and author notification: made when the chart first has something to deliver (most never do). */
  #deliveryMade: Delivery | null;
  // Preserve a stable viewer zone once needed, without asking Intl for charts with an explicit zone.
  #viewerZone: string | undefined;
  // ── synchronous phase ──────────────────────────────────────────────────────────────────────────
  #options: OptionsStore;
  #accepted: Accepted | null = null;
  // The wrappers read through getters so the controller can keep its own accesses private.
  get accepted(): Accepted | null { return this.#accepted; }
  #presentation: Map<PresentationStage, readonly DiagnosticInput[]> | null = null;
  /** Keys of the current diagnostics already printed and handed to `onDiagnostic`. */
  #deliveredKeys: Set<string> | null = null;
  /** The finding list whose keys `deliveredKeys` holds after the last full delivery pass (see deliverChanges). */
  #settledInputs: readonly DiagnosticInput[] | null = null;
  #destroyed: boolean = false;
  get destroyed(): boolean { return this.#destroyed; }
  #internalError: unknown = null;
  /** `append` was called at least once: the pause control is offered (spec I6). */
  #streaming: boolean = false;
  #paused: boolean = false;
  /** The accepted session, used to release revisions after a call or a frame publishes. */
  #stream: StreamSessionHandle | null = null;
  #openStream: StreamFactory | null;
  /** While paused: the store's newest frame and its findings, accepted but not shown. */
  held: Held = null;
  /**
   * The displayed snapshot's row ownership: what the marks on screen came from (see the invariants at the top
   * of this file). Its session keeps a copy if the store has to retire the revision.
   */
  onScreen: Accepted | null = null;
  /** The wider x domain the layout drew a scatter's automatic domain on, with the domain it widened. */
  #widenedX: { epoch: number; drawn: readonly [number, number] } | null = null;
  #epochs: number = 0;
  #frameRevision: number = 0;
  #commits: number = 0;
  listeners: Map<keyof ChartEvents<unknown>, Set<(payload: never) => void>> | null = null;
  /** True while a frame runs: findings are delivered at its end, not from inside a stage. */
  inFrame: boolean = false;
  /** The accepted state a running frame publishes: its rows are kept until it is on screen. */
  inflight: Accepted | null = null;
  /**
   * Notifications to author code (onDiagnostic, the console, event listeners) in call order: each delivery
   * is a snapshot taken when it is made and is drained in full, and one made by author code during a drain
   * waits behind it. Only destruction stops a drain (review 3, finding 7).
   */
  #notifications: (() => void)[] | null = null;
  #draining: boolean = false;
  #presentationVersion: number = 0;
  // ── frame phase ────────────────────────────────────────────────────────────────────────────────
  #frameRequest: number = 0;
  #frameScheduled: boolean = false;
  get frameScheduled(): boolean { return this.#frameScheduled; }
  #microtaskToken: number = 0;
  #size: Size | null = null;
  sizeDirty: boolean = true;
  /** The readout strip is reserved under the plot (decision 0004 revision 2, rule 5). */
  #readoutMode: boolean = false;
  /** The strip's height as last measured (two 24 px lines until then). */
  #stripHeight: number = 0;
  /** The text style the strip's height was measured for; null after resize or font changes. */
  #stripStyle: TextStyle | null = null;
  #stripFontEpoch: number = -1;
  /** Decision 0004 revision 3, rule 5: how a datum's values are shown when pointed at. */
  #readoutKind: ReadoutMode = 'floating';
  /** L8 fallback: what the fallback's own DOM adds to the plot size, measured when it was entered. */
  #fallback: { width: number; height: number } | null = null;
  #textStyle: TextStyle | null = null;
  textStyleDirty: boolean = true;
  fontEpoch: number = 0;
  pixelRatio: number;
  themeDirty: boolean = true;
  #themeSeries: readonly string[] | null = null;
  #themeColors: unknown;
  theme: { bindings: PaintBindings; theme: ResolvedTheme } | null = null;
  #themeRevision: number = 0;
  /** The display state last shown, for announcing changes once (spec L7). */
  #announced: Display['kind'] | null = null;
  /** The accepted revision the page last settled on (drawn, or its error shown). */
  settledRevision: number = 0;
  drawn: Drawn | null = null;
  #fitKey: {
    small: boolean; dense: boolean; hidden: number; field: string;
    xKind: XKind | undefined; horizontal: boolean | undefined; kind: View['kind'];
  } | null = null;
  /** The last layout computed, also at a size that was only an estimate (the L8 fallback). */
  #lastLayout: PlotLayout | null = null;
  /** Marks were drawn at some point (cleared marks after a failure count): a later empty frame must clear them. */
  #hadMarks: boolean = false;
  /** The host hid the mark and text surfaces for an error revision; the next drawn frame shows them again. */
  #surfacesHidden: boolean = false;
  waiters: { revision: number; resolve: () => void }[] | null = null;
  /** The axis context of the last frame: kept while what it holds is unchanged. */
  #lastAxisContext: AxisContext | null = null;
  /** The English marking of the last frame on a page in another language, by the messages option it read. */
  #englishMemo: { readonly source: unknown; readonly english: (key: keyof Messages) => string | null } | null = null;
  /** What the late theme probe reported, written by one callback made once per chart. */
  #probeWrote: boolean = true;
  /** The interaction layer's and the page watchers' ways in, made when first asked for (a sparkline has no interaction layer). */
  #actionsMade: ChartActions | null = null;
  #invalidateMade: ChartInvalidate | null = null;
  /** Callbacks the host keeps (the frame request, the formatters' error report, the late theme probe), each made once when first needed. */
  #frameCallback: ((time?: number) => void) | null = null;
  #formatterError: ((field: string) => void) | null = null;
  #probeReport: ((wrote: boolean) => void) | null = null;
  readonly handle: ChartHandle;

  constructor(composition: Composition, input: unknown, page: Host, openStream: StreamFactory | null) {
    this.#openStream = openStream;
    this.#composition = composition;
    this.#kind = composition.kind;
    this.host = page;
    this.stages = __DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__) ? new StageCounter() : null;
    // Development and benchmark builds make it now: making one installs their delivery hook.
    this.#deliveryMade = __DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__) ? this.#newDelivery() : null;
    this.#options = new OptionsStore(input);
    this.pixelRatio = this.host.devicePixelRatio();
    // ── create ─────────────────────────────────────────────────────────────────────────────────────
    try {
      this.update(input);
    } catch (error) {
      // A strict create that is rejected leaves nothing behind.
      this.destroy();
      throw error;
    }
    this.handle = new Handle(this);
    if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) attachHooks(this.handle, new ControllerProbe(this));
  }

  /** After destroy the host is the dead one, whose console is null: a delivery made then prints nothing. */
  get #delivery(): Delivery {
    return this.#deliveryMade ??= this.#newDelivery();
  }

  #newDelivery(): Delivery {
    const host = this.host;
    return new Delivery({ console: host.console, development: __DEV__, page: host.page });
  }

  get actions(): ControllerActions {
    return this.#actionsMade ??= new ChartActions(this);
  }

  get invalidate(): Invalidate {
    return this.#invalidateMade ??= new ChartInvalidate(this);
  }

  /** The data environment the stages read the viewer's zone from: asked of the host once, when first needed. */
  get timeZone(): string {
    return this.#viewerZone ??= this.host.timeZone;
  }

  #stage(name: Stage): void {
    if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) this.stages!.ran(name);
  }

  #chartName(o: OptionRecord): string {
    return titleOf(o)?.text ?? (this.host.targetId || this.host.id);
  }

  diagnosticInputs(): readonly DiagnosticInput[] {
    const pres = presentationDiagnostics(this.#presentation);
    const a = this.#accepted;
    return a ? joinedDiagnostics(stateDiagnostics(a, this.held), pres) : pres;
  }

  publicDiagnostics(inputs: readonly DiagnosticInput[]): Diagnostic[] {
    return inputs.length ? toPublic(inputs, this.#accepted?.name ?? this.#chartName(this.#options.current)) : [];
  }

  /** Replaces what a presentation stage found; outside a frame the change is delivered at once. */
  #setPresentation(where: PresentationStage, list: readonly DiagnosticInput[]): void {
    const before = this.#presentation?.get(where);
    const beforeLen = before ? before.length : 0;
    if (beforeLen === 0 && list.length === 0) return;
    if (before && beforeLen === list.length && before.every((d, i) => diagnosticKey(d) === diagnosticKey(list[i]!))) return;
    this.#setPresentationQuiet(where, list);
    if (!this.inFrame && !this.#destroyed) {
      this.deliverChanges();
      // The reader's note may change with it (spec F12).
      this.schedule();
    }
  }

  #addPresentation(where: PresentationStage, d: DiagnosticInput): void {
    const list = this.#presentation?.get(where);
    if (list && list.some(o => o.code === d.code && o.field === d.field)) return;
    this.#setPresentation(where, list ? [...list, d] : [d]);
  }

  #formatterFailed(field: string): void {
    // A frame a formatter's own call superseded is not drawn: what its formatters threw on is not reported.
    if (this.inFrame && this.inflight !== null && this.inflight !== this.#accepted) return;
    this.#addPresentation('format', createDiagnostic('AX160', 'changed', { field }, 'presentation'));
  }

  #enqueue(work: () => void): void {
    (this.#notifications ??= []).push(work);
    // During a frame nothing reaches author code: hover, select and zoom that the interaction layer raises
    // while it is being committed are delivered once the frame has finished publishing (final review, 1).
    if (this.#draining || this.inFrame) return;
    this.#drain();
  }

  #drain(): void {
    if (this.#draining || !this.#notifications || this.#notifications.length === 0) return;
    this.#draining = true;
    try {
      while (this.#notifications && this.#notifications.length && !this.#destroyed) this.#notifications.shift()!();
    } finally {
      this.#draining = false;
      if (this.#destroyed && this.#notifications) {
        this.#notifications.length = 0;
        this.#notifications = null;
      }
    }
  }

  /**
   * Prints and hands to `onDiagnostic` what is new. The set to deliver is fixed and marked delivered when the
   * delivery is made, so a handler that updates the chart cannot be given a finding twice.
   */
  deliverChanges(): void {
    if (this.#destroyed) return;
    const inputs = this.diagnosticInputs();
    if (!inputs.length) {
      this.#deliveredKeys?.clear();
      this.#settledInputs = null;
      return;
    }
    // Finding lists are replaced, never changed in place, and a key depends on the finding alone (not the chart
    // name): the list a full pass last settled holds nothing new, and the delivered set already equals its keys.
    // Charts with a standing finding (a hint on their data) then skip the copies and key sets on every frame.
    if (inputs === this.#settledInputs) return;
    const now = this.publicDiagnostics(inputs);
    if (this.#deliveredKeys && this.#deliveredKeys.size > 0) {
      const keys = new Set(now.map(diagnosticKey));
      for (const k of [...this.#deliveredKeys]) if (!keys.has(k)) this.#deliveredKeys.delete(k);
    }
    const fresh = this.#undelivered(now);
    // Settled before any handler runs: a delivery that author code starts from the handler settles its own list.
    this.#settledInputs = inputs;
    if (!fresh.length) return;
    const delivered = this.#deliveredKeys ??= new Set();
    for (const d of fresh) delivered.add(diagnosticKey(d));
    const handler = (this.#accepted?.options ?? this.#options.current).onDiagnostic;
    this.#notifyDiagnostics(fresh, handler);
  }

  /** A rejected or ignored call's findings: printed and given to `onDiagnostic`, never part of `diagnostics`. */
  #deliverRejected(found: readonly DiagnosticInput[], name: string, handler: unknown): void {
    this.#notifyDiagnostics(this.#undelivered(toPublic(found, name)), handler);
  }

  #undelivered(list: Diagnostic[]): Diagnostic[] {
    return this.#deliveredKeys?.size ? list.filter(d => !this.#deliveredKeys!.has(diagnosticKey(d))) : list;
  }

  #notifyDiagnostics(list: readonly Diagnostic[], handler: unknown): void {
    if (!list.length) return;
    this.#enqueue(() => {
      for (const d of list) {
        if (this.#destroyed) return;
        this.#delivery.print(d);
        if (typeof handler === 'function') this.#delivery.notify(handler as (d: Diagnostic) => void, d);
      }
    });
  }

  #viewFor(c: Candidate, previous: Accepted | null): Viewed {
    // A window kept across a data change does not reach an axis it does not apply to.
    const zoom = zoomable(c.frame) ? c.zoom : null;
    const key = viewKeyFor(this.#kind, c.options, c.resolved, c.frame, zoom, c.hidden, c.messages);
    // Frames of different revisions are never equal (a revision is part of the frame), so a new frame is a
    // new view without comparing the rest of the key, or the frames, field by field.
    const viewed = previous?.viewKey[0] as Frame | undefined;
    if (previous && (viewed === c.frame || viewed?.revision === c.frame.revision) && sameValue(previous.viewKey, key)) {
      return { view: previous.view, viewKey: previous.viewKey, viewDiagnostics: previous.viewDiagnostics, found: [] };
    }
    this.#stage('view');
    let sink = new DiagnosticCollector();
    let state = viewStateFor(this.#kind, c.options, c.resolved, zoom, previous?.view ?? null, c.hidden, c.messages);
    let view = this.#composition.view(c.frame, state, sink);
    // A window is read against the domain that is drawn: when the layout drew this data on a wider automatic
    // domain (a narrow scatter's coarser one, F7), that domain is the full range a window may take, for
    // zoom() and for the gestures reading `xFull` (re-check, R8).
    const wide = this.#widenedX;
    // The drawn bounds stay for the zoom on the same data, appends included, and grow with the data
    // (closing pass, item 3).
    if (zoom && view.kind === 'scatter' && wide && !c.resolved.x.domain && wide.epoch === c.frame.epoch) {
      const full = view.xFull;
      sink = new DiagnosticCollector();
      state = { ...state as Exclude<typeof state, { kind: 'donut' }>, xDomain: [Math.min(wide.drawn[0], full[0]), Math.max(wide.drawn[1], full[1])] };
      view = this.#composition.view(c.frame, state, sink);
    }
    // A wall-clock window on a wall-clock axis is what the axis reads: the column's own AX112 already says
    // the values have no offset, and the window is not news (documentation finding 2).
    const rawFound = sink.inputs();
    const found = rawFound.length === 0
      ? EMPTY_DIAGNOSTICS
      : rawFound.filter(d => !(d.code === 'AX112' && d.field === 'zoom' && isWall(c.frame)));
    const before = previous?.viewDiagnostics ?? EMPTY_DIAGNOSTICS;
    const viewDiagnostics = found.length === 0 && before.length === 0
      ? EMPTY_DIAGNOSTICS
      : completeViewDiagnostics(this.#kind, found, before, view, state);
    let newFound: readonly DiagnosticInput[];
    if (found.length === 0) newFound = EMPTY_DIAGNOSTICS;
    else if (before.length === 0) newFound = found;
    else {
      const known = new Set(before.map(diagnosticKey));
      newFound = found.filter(d => !known.has(diagnosticKey(d)));
    }
    return { view, viewKey: key, viewDiagnostics, found: newFound };
  }

  /**
   * Accepts a validated candidate: the store commits first (so the frame on screen and the store agree),
   * then the options, then the state. Nothing before this changes the chart.
   */
  #accept(c: Candidate, viewed: Viewed, follow: boolean, commit: (() => void) | null, microtask = false): void {
    // Liveness before acceptance: a chart destroyed by author code during the call takes nothing (defect 6).
    if (this.#destroyed) return;
    commit?.();
    if (commit && c.stream?.store.frame === c.frame) c.stream.track(c.frame);
    if (this.held && c.frame === this.held.frame) this.held = null;
    this.#options.commit(c.options);
    this.#frameRevision = Math.max(this.#frameRevision, c.frame.revision);
    // Naming and the chart's name come from the options alone: a stream's appends keep the same options object,
    // so they keep the same naming list too (and the delivery pass can see that nothing changed).
    const before = this.#accepted;
    const sameOptions = before !== null && before.options === c.options;
    this.#accepted = {
      ...c, viewDiagnostics: viewed.viewDiagnostics, naming: sameOptions ? before.naming : namingDiagnostics(c.options), view: viewed.view,
      viewKey: viewed.viewKey, follow, revision: ++this.#commits, name: sameOptions ? before.name : this.#chartName(c.options),
    };
    if (this.#internalError !== null) {
      this.#internalError = null;
      this.#setPresentationQuiet('internal', EMPTY_DIAGNOSTICS);
    }
    this.#stream = c.stream;
    this.#release();
    this.deliverChanges();
    if (microtask) this.#scheduleMicrotask();
    else this.schedule();
  }

  #setPresentationQuiet(where: PresentationStage, list: readonly DiagnosticInput[]): void {
    this.#presentationVersion++;
    if (list.length) (this.#presentation ??= new Map()).set(where, list);
    else this.#presentation?.delete(where);
  }

  /** A strict chart rejects a create, update or append whose own findings include an error or warning. */
  #rejectIfStrict(strict: boolean, found: readonly DiagnosticInput[], name: string, handler: unknown): void {
    if (strict && strictViolations(found).length) this.#reject(found, name, handler);
  }

  #reject(found: readonly DiagnosticInput[], name: string, handler: unknown): never {
    this.#deliverRejected(found, name, handler);
    throw new StrictError(name, toPublic(found, name));
  }

  /** Runs a call. A strict rejection propagates; anything else that throws becomes the internal-error state. */
  #guarded(run: (call: Preparation) => void): void {
    if (this.#destroyed) return;
    const call: Preparation = { sink: null, strict: false, name: '', handler: undefined, naming: [] };
    try {
      run(call);
    } catch (error) {
      if (error instanceof StrictError) throw error;
      // Author code destroyed the chart during the call: nothing is reported on a handle that is gone.
      if (this.#destroyed) return;
      // A failure while a call was prepared (a row getter that throws): what the call had found until then is
      // kept, with AX199 after it, as validate() reports it; under strict that is a rejection, before the
      // accepted chart changes (final review, finding 7).
      const before = call.sink?.inputs() ?? [];
      const after = this.#accepted === null ? call.naming : [];
      if (call.strict) this.#reject([...before, internalFailure(), ...after], call.name, call.handler);
      this.#raiseInternal(error, before, after);
      // A create that failed has nothing to draw from: show the error state now (never a blank box).
      if (this.#accepted === null) this.#showInternal(messagesOf(this.#options.current.messages), this.#chartName(this.#options.current), this.#options.current);
      this.schedule();
    }
  }

  #nextVersion(): { epoch: number; revision: number } {
    return { epoch: ++this.#epochs, revision: ++this.#frameRevision };
  }

  update(patch: unknown): void {
    this.#guarded(call => {
      this.#stage('options');
      // Reading the patch runs author getters: until it has been read, the chart is as strict as it is now
      // (re-check, C6).
      const now = this.#options.current;
      Object.assign(call, { strict: now.strict === true, name: this.#chartName(now), handler: now.onDiagnostic });
      const { next, changed } = this.#options.preview(patch);
      const previous = this.#accepted;
      const supplied = patch !== null && typeof patch === 'object' && Object.hasOwn(patch, 'data');
      const optionSink = new DiagnosticCollector();
      Object.assign(call, {
        sink: optionSink, strict: next.strict === true, name: this.#chartName(next), handler: next.onDiagnostic,
        naming: previous === null ? namingDiagnostics(next) : [],
      });
      const messages = messagesFor(next, previous);
      const common = { options: next, messages, zoom: previous?.zoom ?? null, hidden: previous?.hidden ?? (emptyHidden ??= new Set()) };
      const resolve = (table?: Table, sink = optionSink) => (this.#composition.resolve ?? resolveFields)(this.#kind, publicOptions(next), sink, table);
      let c: Candidate;
      let commit: (() => void) | null = null;
      let heldAfter: Held = null;
      const replace = previous === null || changed.has('data') || (supplied && previous.stream !== null);
      const reencode = !replace && encodingChanged(previous!.options, next);
      if (!replace && reencode && previous!.stream === null && namesOnlyChanged(previous!.options, next)) {
        // Labels or units only, over the caller's own data: the same columns with new names (finding 12).
        const resolved = resolve(previous!.source.table);
        const p = previous!;
        const opts = dataFindings(optionSink.inputs(), false);
        c = {
          ...common, resolved, source: resolved, stream: null, frame: renamed(p.frame, resolved, this.#frameRevision += 1),
          dataDiagnostics: p.dataDiagnostics, dataOptions: p.dataOptions,
          optionDiagnostics: dedupe([...p.dataOptions, ...opts], p.dataDiagnostics),
        };
      } else if (replace || (reencode && previous!.stream === null)) {
        // New data, or new fields over the caller's own data: normalized from the options, borrowing typed
        // columns (plan 1.2). A stream this replaces is dropped with everything it held.
        this.#stage('normalize');
        const resolved = resolve();
        const dataSink = new DiagnosticCollector();
        const frame = this.#composition.normalize(this.#kind, resolved, this, dataSink, this.#nextVersion());
        const data = dataSink.inputs();
        const opts = optionSink.inputs();
        c = {
          ...common, resolved, source: resolved, stream: null, frame, dataDiagnostics: data,
          dataOptions: dataFindings(opts, true), optionDiagnostics: dedupe(opts, data),
        };
      } else if (reencode) {
        // New fields after streaming: the retained rows are read again (a new epoch, plan 1.5).
        this.#stage('normalize');
        const stream = previous!.stream!;
        const store = stream.store;
        const resolved = store.resolveEncoding(publicOptions(next), optionSink);
        const prepared: PreparedFrame<Frame> = store.prepareReencode(resolved, this.#nextVersion());
        stream.ends(prepared.frame, store.frame);
        commit = prepared.commit;
        const opts = optionSink.inputs();
        c = { ...common, resolved, source: resolved, stream, frame: prepared.frame,
          dataDiagnostics: prepared.diagnostics, dataOptions: [], optionDiagnostics: [] };
        if (this.#paused && this.held) {
          // Paused: the rows on screen are read again with the new fields on their own, and the arrivals stay
          // held, re-encoded in the store, until Resume (review 3, finding 5). The rows on screen are the
          // displayed revision's raw window, typed-column rows marked as such (verification, defect 4).
          const table = stream.table(previous!.frame);
          // What the fields say about the rows on screen counts too: a field only the held rows have leaves
          // the plot shown without values (AX101), which strict rejects (re-check, C4).
          const shownOptions = new DiagnosticCollector();
          const shownResolved = resolve(table, shownOptions);
          const shownData = dataFindings(shownOptions.inputs(), true);
          const shownSink = new DiagnosticCollector();
          const shown = this.#composition.normalize(this.#kind, shownResolved, this, shownSink, this.#nextVersion());
          // Both views are built and validated before either is accepted: the held one keeps its findings
          // (AX130 of a held ninth series), which count for strict and for `diagnostics` (defect 4).
          const heldView = this.#viewFor(c, null);
          heldAfter = { frame: prepared.frame, dataDiagnostics: prepared.diagnostics, viewDiagnostics: heldView.viewDiagnostics };
          c = {
            ...c, source: shownResolved, frame: shown, dataDiagnostics: shownSink.inputs(),
            dataOptions: shownData, optionDiagnostics: dedupe([...dedupe(shownData, opts), ...opts], prepared.diagnostics),
          };
        } else {
          c = { ...c, optionDiagnostics: dedupe(opts, prepared.diagnostics) };
        }
      } else {
        // Presentation only (title, domains, references, colors, …): the frame stays. Rows held by a Resume
        // that failed are shown by the next accepted call (finding 5).
        const p = this.#resumable(previous!);
        // The fields are unchanged, so what the retained rows said about them still holds: a stream is checked
        // against no rows (a title update must not walk them, finding 11) unless they were found wanting.
        const resolved = p.stream
          ? p.resolved.valid ? resolve(rowsTable([]))
            : p.stream.store.resolveEncoding(publicOptions(next), optionSink)
          : resolve(p.source.table);
        const opts = dataFindings(optionSink.inputs(), false);
        c = {
          ...p, ...common, resolved, optionDiagnostics: dedupe([...p.dataOptions, ...opts], p.dataDiagnostics),
        };
      }
      const viewed = this.#viewFor(c, previous);
      // Author code (a getter) destroyed the chart while the call was prepared: nothing is accepted.
      if (this.#destroyed) return;
      const found = [...c.optionDiagnostics, ...c.dataDiagnostics, ...viewed.viewDiagnostics, ...namingDiagnostics(next)];
      // While paused the held window is part of the chart: its findings count for strict too (finding 6).
      const keptHeld = heldAfter ?? (c.frame === previous?.frame ? this.held : null);
      if (this.#paused && keptHeld) found.push(...keptHeld.dataDiagnostics, ...keptHeld.viewDiagnostics);
      this.#rejectIfStrict(next.strict === true, found, this.#chartName(next), next.onDiagnostic);
      // Data replaced or bounds changed: a window that no longer ends at the latest x stops following.
      const follow = followsLatest(viewed.view, c.zoom);
      if (c.frame !== previous?.frame) this.held = null;
      // The held arrivals are in place before anything is delivered: a handler that resumes from inside
      // this call finds them, and no arrival stays held on a running chart (final review, finding 6).
      if (heldAfter) this.held = heldAfter;
      this.#accept(c, viewed, follow, commit);
    });
  }

  #recoverFields(previous: Accepted, stream: StreamSessionHandle, c: Candidate, before: Frame) {
    const store = stream.store;
    const check = new DiagnosticCollector();
    const resolved = store.resolveEncoding(publicOptions(previous.options), check);
    if (check.inputs().some(d => d.code === 'AX101')) return null;
    const again = store.prepareReencode(resolved, this.#nextVersion());
    stream.ends(again.frame, before);
    const candidate = {
      ...c, resolved, source: resolved, frame: again.frame, dataDiagnostics: again.diagnostics, dataOptions: [],
      optionDiagnostics: dataFindings(previous.optionDiagnostics, false),
    };
    return { candidate, commit: again.commit };
  }

  #commitRetained(prepared: PreparedFrame<Frame>, stream: StreamSessionHandle): void {
    prepared.commit();
    stream.track(prepared.frame);
    this.#frameRevision = Math.max(this.#frameRevision, prepared.frame.revision);
  }

  append(rows: unknown, appendOptions?: { keep?: number }): void {
    // The factory is null only after destroy(), which #guarded turns into a no-op, and for the static
    // controller, whose subclass replaces this method.
    this.#guarded(call => {
      const previous = this.#accepted;
      if (!previous) return;
      // A row getter that throws is a failure of this call: under strict, a rejection (defect 6).
      call.strict = previous.options.strict === true;
      call.name = previous.name;
      call.handler = previous.options.onDiagnostic;
      // The pause control appears (spec I6) once an append was accepted, not before it validated.
      if (!Array.isArray(rows) || rows.length === 0) {
        if (!this.#streaming) { this.#streaming = true; this.schedule(); }
        return;
      }
      this.#stage('append');
      const keep = appendOptions?.keep;
      // An opening session belongs to this candidate until validation succeeds.
      const stream = previous.stream ?? this.#openStream!(this.#composition, previous, this, this.#kind);
      const store = stream.store;
      const prepared = (store.prepareAppend as (r: readonly unknown[], o: { keep?: number }) => PreparedFrame<Frame>)(
        rows, keep === undefined ? EMPTY_APPEND_OPTIONS : { keep });
      stream.ends(prepared.frame, store.frame, rows.length);
      // While paused the view does not move (spec I6), but the rows are validated now, with the window shown.
      const base = this.held ? { ...previous, frame: this.held.frame } : previous;
      const zoom = this.#paused ? previous.zoom : followingZoom(previous, prepared.frame);
      const nextOptions = streamOptions(previous.options);
      const resolved = stream.drop(previous.resolved);
      const source = stream.drop(previous.source);
      let c: Candidate = {
        // Once the stream has its store the caller's opening data is no longer read: options and source keep no
        // reference to it, so it can be collected once no displayed frame needs it (data agent's report).
        ...previous, options: nextOptions, resolved, source, stream, frame: prepared.frame, dataDiagnostics: prepared.diagnostics, zoom,
      };
      let commitAppend: (() => void) | null = prepared.commit;
      if (!this.#paused && canRecoverFields(previous)) {
        // A field the earlier data did not have: once the retained rows have it, the frame is read again with
        // the fields as given and AX101 goes (review 3, finding 8).
        this.#commitRetained(prepared, stream);
        commitAppend = null;
        const repaired = this.#recoverFields(previous, stream, c, prepared.frame);
        if (repaired) {
          c = repaired.candidate;
          commitAppend = repaired.commit;
        }
      }
      const viewed = this.#viewFor(c, base);
      if (this.#destroyed) return;
      if (previous.options.strict === true) {
        const found = joinedDiagnostics(prepared.callDiagnostics, viewed.found);
        this.#rejectIfStrict(true, found, previous.name, previous.options.onDiagnostic);
      }
      if (this.#paused) {
        this.#commitRetained(prepared, stream);
        // The store is the accepted state's now; rows no displayed or pending frame needs go (finding 4).
        this.#accepted = { ...previous, options: nextOptions, resolved, source, stream };
        this.#options.commit(this.#accepted.options);
        this.#stream = stream;
        this.#release();
        // The held state: complete findings for the data accepted so far, kept apart from what is drawn, so a
        // display effect (an error state) never reaches the ring on screen before Resume (finding 6).
        this.held = { frame: prepared.frame, dataDiagnostics: prepared.diagnostics, viewDiagnostics: viewed.viewDiagnostics };
        this.#streaming = true;
        this.deliverChanges();
        this.schedule();
        return;
      }
      this.#streaming = true;
      // The new frame is made from the store's head, which already has every held arrival: a revision held by
      // a Resume that failed is superseded here, in the same step (final review, finding 3).
      this.held = null;
      this.#accept(c, viewed, previous.follow && zoom !== null, commitAppend);
    });
  }

  /** The accepted state with the held frame in it, when Resume was asked for but did not complete. */
  #resumable(a: Accepted): Accepted {
    return !this.#paused && this.held ? { ...a, frame: this.held.frame, dataDiagnostics: this.held.dataDiagnostics } : a;
  }

  /** Same options and data for a call that only changes the view. */
  #viewCandidate(given: Accepted, change: Partial<Pick<Candidate, 'zoom' | 'hidden' | 'frame' | 'dataDiagnostics'>>): Candidate {
    return { ...this.#resumable(given), ...change };
  }

  zoom(domain: unknown): void {
    this.#guarded(() => {
      const previous = this.#accepted;
      if (!previous) return;
      const applicable = zoomable(previous.frame);
      if (!applicable || isCompact(this.#kind, previous.options)) {
        if (domain !== null && domain !== undefined) {
          const detail = applicable ? 'A compact chart does not zoom.' : 'Zoom applies to time, date and number x axes only.';
          this.#deliverRejected([createDiagnostic('AX150', 'none', { field: 'zoom', detail }, 'call')], previous.name, previous.options.onDiagnostic);
        }
        return;
      }
      // The window is kept as given at the call: a Date the caller mutates later does not move it (finding 12).
      const own = (v: unknown) => v instanceof Date ? new Date(v.getTime()) : v;
      const pair = Array.isArray(domain) && domain.length === 2 ? [own(domain[0]), own(domain[1])] as unknown as Span<XValue> : null;
      const c = this.#viewCandidate(previous, { zoom: pair });
      const viewed = this.#viewFor(c, previous);
      // A window that cannot be read is reported and ignored; zoom never throws (spec 3.5).
      // A hint (AX112: a wall-clock window on a wall-clock axis) does not make the window unreadable.
      const bad = viewed.found.filter(d => d.field === 'zoom' && d.level !== 'hint');
      if (bad.length) {
        this.#deliverRejected(bad, previous.name, previous.options.onDiagnostic);
        return;
      }
      this.#accept(c, viewed, followsLatest(viewed.view, pair), null, true);
      const now = this.#accepted;
      if (this.#destroyed || now === null) return;
      const view = now.view;
      const before = previous.view;
      if (view.kind !== 'donut' && before.kind !== 'donut' &&
        (view.xDomain[0] !== before.xDomain[0] || view.xDomain[1] !== before.xDomain[1] || (previous.zoom === null) !== (pair === null))) {
        this.emit('zoom', zoomPayload(now));
      }
    });
  }

  toggleSeries(key: string): void {
    this.#guarded(() => {
      const previous = this.#accepted;
      if (!previous) return;
      const hidden = new Set(previous.hidden);
      if (!hidden.delete(key)) hidden.add(key);
      const c = this.#viewCandidate(previous, { hidden });
      this.#accept(c, this.#viewFor(c, previous), previous.follow, null);
    });
  }

  /** Pause and resume (spec I6). Resume shows the newest held frame. */
  setPaused(next: boolean): void {
    if (this.#destroyed || next === this.#paused) return;
    this.#paused = next;
    if (!next && this.held) {
      const frame = this.held;
      this.#guarded(() => {
        const previous = this.#accepted;
        if (!previous) return;
        const zoomed = followingZoom(previous, frame.frame);
        let c = this.#viewCandidate(previous, { frame: frame.frame, dataDiagnostics: frame.dataDiagnostics, zoom: zoomed });
        let commit: (() => void) | null = null;
        const stream = previous.stream;
        if (stream && canRecoverFields(previous)) {
          // A field the earlier data did not have, which the held arrivals bring: the frame is read again with
          // the fields as given, and AX101 goes, as for a running append (final review, finding 6).
          const repaired = this.#recoverFields(previous, stream, c, stream.store.frame);
          if (repaired) {
            c = repaired.candidate;
            commit = repaired.commit;
          }
        }
        const viewed = this.#viewFor(c, previous);
        // The held frame is let go only once its replacement is accepted (review 3, finding 5).
        this.held = null;
        this.#accept(c, viewed, previous.follow && zoomed !== null, commit);
      });
    }
    this.schedule();
  }

  schedule(): void {
    if (this.#destroyed || this.#frameScheduled) return;
    this.#frameScheduled = true;
    this.#frameRequest = this.host.requestFrame(this.#frameCallback ??= this.#frameCallbackFor());
  }

  /** The one callback this chart gives the host's frame requests, made on its first request. */
  #frameCallbackFor(): (time?: number) => void {
    return () => this.#runScheduledFrame();
  }

  #runScheduledFrame(): void {
    this.#frameRequest = 0;
    this.#frameScheduled = false;
    this.flush();
  }

  #scheduleMicrotask(): void {
    if (this.#destroyed || this.#frameScheduled) return;
    if (!this.inFrame && this.drawn !== null && this.host.scheduleMicrotask) {
      this.#frameScheduled = true;
      const token = ++this.#microtaskToken;
      this.host.scheduleMicrotask(() => {
        if (this.#destroyed || !this.#frameScheduled || token !== this.#microtaskToken) return;
        this.#frameScheduled = false;
        this.flush();
      });
      return;
    }
    this.schedule();
  }

  #reportFit(a: Accepted, layout: Layout, tooSmall: boolean, hidden: number): void {
    const view = a.view;
    const small = tooSmall || layout.kind === 'too-small';
    const dense = view.kind === 'bar' && layout.kind === 'plot' &&
      view.visibleSlots.end - view.visibleSlots.start > (view.horizontal ? layout.plot.height : layout.plot.width);
    if (!small && !dense && hidden === 0) {
      if (this.#fitKey !== null) {
        this.#fitKey = null;
        this.#setPresentation('fit', EMPTY_DIAGNOSTICS);
      }
      return;
    }
    const field = a.resolved.x.field;
    // AX143 suggests horizontal bars only for vertical bars on category labels.
    const xKind = view.kind === 'donut' ? undefined : view.kind === 'scatter' ? view.frame.xKind : view.frame.x.kind;
    const horizontal = view.kind === 'bar' ? view.horizontal : undefined;
    if (this.#fitKey && this.#fitKey.small === small && this.#fitKey.dense === dense && this.#fitKey.hidden === hidden && this.#fitKey.field === field &&
        this.#fitKey.xKind === xKind && this.#fitKey.horizontal === horizontal && this.#fitKey.kind === view.kind) return;
    this.#fitKey = { small, dense, hidden, field, xKind, horizontal, kind: view.kind };
    const fit: DiagnosticInput[] = [];
    if (small) fit.push(createDiagnostic('AX142', 'none', {}, 'presentation'));
    if (hidden > 0) fit.push(createDiagnostic('AX143', 'none', {
      field, count: hidden, chartType: view.kind, xKind, horizontal,
    }, 'presentation'));
    if (dense) fit.push(createDiagnostic('AX132', 'none', { field }, 'presentation'));
    this.#setPresentation('fit', fit);
  }

  /** AX199 (spec 3.5): Axylo itself failed. Given to onDiagnostic and printed, beside the error state. */
  #raiseInternal(error: unknown, before: readonly DiagnosticInput[] = [], after: readonly DiagnosticInput[] = []): void {
    const first = this.#internalError === null;
    this.#internalError = error;
    if (first) this.#delivery.internal(this.#accepted?.name ?? (this.host.targetId || this.host.id), error);
    this.#setPresentationQuiet('internal', [...before, internalFailure(), ...after]);
    if (!this.inFrame) this.deliverChanges();
  }

  /** What a formatter's failure reaches: the chart, not the options it was made from. */
  #formatterErrorCallback(): (field: string) => void {
    return field => this.#formatterFailed(field);
  }

  flush(): void {
    const run = this.#startFrame();
    if (!run) return;
    // A ready compact plot has no readout strip and no L8 fallback: its readout steps would all pass.
    run.phase1();
    run.phase2();
    // The measure's layout brings style up to date, so the theme's reads after it start no style pass of their
    // own; a late theme probe that moved the figure has it measured again (the second call does nothing else).
    run.phase3Measure();
    run.phase3Theme();
    run.phase3Probe();
    run.phase3Measure();
    if (run.stripless()) run.phase4Init();
    else readoutSteps(run);
    for (let pass = 0; pass < 4; pass++) {
      if (!run.phase4PassWrite()) break;
      if (run.phase4PassMeasure()) readoutSteps(run);
    }
    run.phase5();
    run.after();
  }

  /** Whether a frame may go on after author code ran (a formatter): the chart is alive and on the same state. */
  #current(a: Accepted): boolean {
    return !this.#destroyed && this.#accepted === a;
  }

  #cancelFrameRequest(): void {
    this.#microtaskToken++;
    if (this.#frameRequest !== 0) this.host.cancelFrame(this.#frameRequest);
    this.#frameRequest = 0;
    this.#frameScheduled = false;
  }

  /** The late theme probe's report: one callback per chart, made when a chart first needs the probe. */
  #probeReportCallback(): (wrote: boolean) => void {
    return wrote => { this.#probeWrote = wrote; };
  }

  #startFrame(): FrameState | null {
    this.#cancelFrameRequest();
    const a = this.#accepted;
    if (this.#destroyed || !a) return null;
    this.inFrame = true;
    // The frame's own rows are kept while it publishes, whatever its author code accepts meanwhile (an append
    // with keep from a callback can no longer retire them; final review, finding 1).
    this.inflight = a;
    const f = acquireFrame(this);
    const view = a.view;
    const zoomOn = zoomApplies(view, a.options.zoom) ? (a.options.zoom === 'touch' ? 'touch' as const : true) : false;
    const zoomed = view.kind !== 'donut' && a.zoom !== null && (view.xDomain[0] > view.xFull[0] || view.xDomain[1] < view.xFull[1]);
    const placement = a.options.legend;
    const legend = placement === false || placement === 'top' || placement === 'right' ? placement : 'bottom';
    f.begin(a, isCompact(this.#kind, a.options), stateDiagnostics(a), zoomOn, zoomed, legend);
    return f;
  }

  /**
   * Runs one step of a frame. A step that throws ends the frame: a superseded frame (ABORT, or a newer
   * accepted state) leaves error handling to the revision that will be drawn; any other failure is this
   * revision's error state. A closed or destroyed frame does nothing more.
   */
  frameStep(f: FrameState, id: number): boolean {
    if (f.closed) return false;
    if (!this.#destroyed) {
      try {
        switch (id) {
          case STEP_PHASE1: this.#phase1(f); break;
          case STEP_PHASE2: this.#phase2(f); break;
          case STEP_THEME: this.#finishTheme(f); break;
          case STEP_MEASURE: this.#measurePending(f); break;
          case STEP_PROBE: this.#probeTheme(f); break;
          case STEP_LAYOUT_CHECK: return this.#layoutCheck(f);
          case STEP_STRIP_MOUNT: this.#stripMount(f); break;
          case STEP_STRIP_READ: this.#stripRead(f); break;
          case STEP_READOUT: this.#readoutDecide(f); break;
          case STEP_STRIP_WRITE: this.#stripWrite(f); break;
          case STEP_STRIP_MEASURE: this.#stripMeasure(f); break;
          case STEP_INIT: this.#layoutInit(f); break;
          case STEP_PASS_WRITE: return this.#passWrite(f);
          case STEP_PASS_MEASURE: return this.#passMeasure(f);
          default: this.#publish(f);
        }
        return false;
      } catch (error) {
        const a = f.a!;
        if (error !== ABORT && this.#current(a)) this.#failSafe(a, error);
      }
    }
    this.#closeFrame(f);
    return false;
  }

  /** Removes the strip-height probe if it is in the figure; runs even on a closed frame. */
  removeStripProbe(f: FrameState): void {
    if (f.stripProbe === null) return;
    const probe = f.stripProbe;
    f.stripProbe = null;
    try { this.host.stripProbeRemove?.(probe); } catch { /* ignore cleanup error */ }
  }

  #closeFrame(f: FrameState): void {
    if (f.closed) return;
    f.closed = true;
    this.inFrame = false;
    this.inflight = null;
    // A frame that stopped between mounting the probe and the step that removes it leaves no probe behind.
    this.removeStripProbe(f);
    if (!this.#destroyed) this.#release();
  }

  // Phase 5: Final diagnostics, scene, lookup, draw, text, figure, commit & close out frame.
  finishFrame(f: FrameState): void {
    this.frameStep(f, STEP_PUBLISH);
    this.#closeFrame(f);
  }

  // Post-frame: re-schedule if superseded, deliver diagnostics, and drain notifications.
  afterFrame(f: FrameState): void {
    this.#closeFrame(f);
    // Already finished (idle): only what author code queued since is left to deliver.
    if (!f.idle) {
      const a = f.a;
      // The frame's references go now, and the state back to the pool: a pooled state holds nothing of this
      // chart. A frame author code starts from here (below) may take it again; this one is done with it.
      releaseFrame(f);
      // A call made by author code during the frame is drawn by the next one.
      if (!this.#destroyed && this.#accepted !== a) this.schedule();
    }
    // Author code last: the frame is complete before any handler runs.
    this.deliverChanges();
    this.#drain();
  }

  /**
   * Every host mutation of this frame comes from `a`. Author code (formatters, the lazy summary) runs
   * before the first one; if it changed or destroyed the chart, the frame stops with nothing written and
   * the next frame draws the newer state. Once writing has started the frame completes for `a`, so no layer
   * is left on another revision (invariant 3; review 3, controller blocker 1).
   */
  #mutate(f: FrameState): void {
    if (this.#destroyed) throw ABORT;
    if (!f.mutated) {
      if (this.#accepted !== f.a) throw ABORT;
      f.mutated = true;
    }
  }

  #disclosureNow(f: FrameState): Disclosure {
    if (f.discVer !== this.#presentationVersion) {
      f.discVer = this.#presentationVersion;
      const pres = presentationDiagnostics(this.#presentation);
      const known = f.stateDiag;
      f.discCache = known.length === 0 && pres.length === 0 ? EMPTY_DISCLOSURE : readerDisclosure(joinedDiagnostics(known, pres));
    }
    return f.discCache;
  }

  #readerFor(f: FrameState, labelsHidden: number, disclosure: Disclosure): ReaderEntry {
    const a = f.a!;
    const shownBefore = this.drawn;
    if (shownBefore && readerInputsMatch(shownBefore.readerInputs, f, labelsHidden, disclosure)) {
      return { reader: shownBefore.reader, inputs: shownBefore.readerInputs };
    }
    const lastReader = f.lastReader;
    if (lastReader && readerInputsMatch(lastReader.inputs, f, labelsHidden, disclosure)) return lastReader;
    const view = f.view, formatters = f.formatters, named = f.named, by = f.by, compact = f.compact, locale = f.locale, caption = f.caption;
    const inputs = [view, formatters, a.messages, a.options.title, named ? by : null, a.options.subtitle,
      a.options.description, disclosure.omitted, disclosure.changed, labelsHidden, a.options.table, compact, locale, caption];
    this.#stage('reader');
    // The summary reads the view, not the name: when only the naming inputs changed, the statistics already
    // written are kept rather than scanned again (finding 11).
    const before = lastReader ?? (shownBefore ? { reader: shownBefore.reader, inputs: shownBefore.readerInputs } : null);
    const kept = before && sameReading(before.inputs, inputs) ? before.reader : null;
    const t = a.options.title;
    const built = readerWith(this.#composition.reader, {
      view, formatters, messages: a.messages, type: chartTypeName(a.messages, this.#kind),
      title: typeof t === 'string' || (t && typeof t === 'object') ? t as string | Title : undefined,
      labelledBy: named ? by! : undefined, caption,
      // The x column header carries the x unit (spec A4).
      labels: { xUnit: a.resolved.x.unit ?? undefined },
      subtitle: stringOption(a.options, 'subtitle') ?? undefined,
      description: stringOption(a.options, 'description') ?? undefined,
      disclosure, labelsHidden, table: a.options.table !== false, compact, locale,
    });
    if (kept) {
      const summary = kept.summary;
      const renamedModel: ReaderModel & { noteSegments: typeof built.noteSegments } = {
        name: built.name, note: built.note, table: built.table, noteSegments: built.noteSegments, get summary() { return summary; },
      };
      return f.lastReader = { reader: renamedModel, inputs };
    }
    return f.lastReader = { reader: built, inputs };
  }

  #settleReader(f: FrameState, labelsHidden: number): ReaderEntry {
    f.currentHidden = labelsHidden;
    const disclosure = this.#disclosureNow(f);
    const settled = f.settled;
    if (settled && f.settledHidden === labelsHidden && sameDisclosure(f.settledDisclosure, disclosure)) return settled;
    let built = this.#readerFor(f, labelsHidden, disclosure);
    // The summary runs author formatters lazily: it is made here, so what they threw on is in the
    // disclosure this settles on, and no reader is built again once writing has started (verification,
    // claims: a throwing value formatter ran again during the figure's write).
    void built.reader.summary;
    const after = this.#disclosureNow(f);
    if (!sameDisclosure(after, disclosure)) {
      built = this.#readerFor(f, labelsHidden, after);
    }
    f.settledHidden = labelsHidden;
    f.settledDisclosure = after;
    return f.settled = built;
  }

  #settleFigureReader(f: FrameState, hidden: number): void {
    const settled = this.#settleReader(f, hidden);
    f.reader = settled.reader;
    f.readerInputs = settled.inputs;
  }

  #measurePending(f: FrameState): void {
    if (f.needMeasure) {
      f.needMeasure = false;
      this.sizeDirty = false;
      this.#size = this.host.measure();
    }
  }

  #arrangedFor(f: FrameState, small: boolean): boolean {
    return f.arrangedReader === f.reader && f.arrangedSmall === small && f.arrangedHidden === f.currentHidden &&
      sameDisclosure(f.arrangedDisclosure, this.#disclosureNow(f));
  }

  #arrange(f: FrameState, small: boolean): boolean {
    if (this.#arrangedFor(f, small) && f.arrangedStrip === this.#readoutMode) return false;
    const reader = f.reader;
    f.arrangedReader = reader;
    f.arrangedSmall = small;
    f.arrangedHidden = f.currentHidden;
    f.arrangedDisclosure = this.#disclosureNow(f);
    f.arrangedStrip = this.#readoutMode;
    this.#stage('figure');
    const model = figureModelFor(f, reader, small, f.arrangedDisclosure);
    this.#mutate(f);
    const moved = this.host.figure.update(model);
    // The legend and toolbar are in place before the plot is measured: they take their share now.
    return this.host.interaction.prepare(
      controlsStateFor(f, reader, small, this.#kind, this.#streaming, this.#paused, this.#readoutMode, this.#readoutKind),
    ) || moved;
  }

  #plotLayout(f: FrameState, width: number, height: number, strip: number | null): PlotLayout {
    const without = f.withoutLayout;
    if (sameLayoutSize(without, width, height, strip)) return without;
    const result = f.result;
    if (sameLayoutSize(result, width, height, strip)) return result;
    const compact = f.compact;
    // A visible figure that leaves the plot no room is too small (L8), not unmeasured.
    if (!compact && (width <= 0 || height <= 0)) {
      return { layout: { kind: 'too-small', width: Math.max(0, width), height: Math.max(0, height) },
        key: null, width, height, strip };
    }
    const a = f.a!;
    const view = f.view;
    const style = f.style;
    const layoutEpoch = f.layoutEpoch;
    const previous = this.drawn;
    const previousLayout = previous?.plotLayout;
    const sameSize = sameLayoutSize(previousLayout, width, height, strip) && previousLayout.layout.kind !== 'unmeasured';
    if (sameSize && previous && previous.accepted.view === view && previous.accepted.resolved === a.resolved &&
        previous.accepted.options.x === a.options.x && previous.accepted.messages.value === a.messages.value &&
        isCompact(this.#kind, previous.accepted.options) === compact && previous.locale === f.locale &&
        previous.style === style && previous.fontEpoch === layoutEpoch) return previousLayout;
    const at = { width, height };
    const key = this.#composition.layout.layoutKey(view, at, style, layoutEpoch, f.axisContext);
    if (sameSize && sameKey(previousLayout.key, key)) return previousLayout;
    if (sameLayoutSize(this.#lastLayout, width, height, strip) && sameKey(this.#lastLayout.key, key)) return this.#lastLayout;
    this.#stage('layout');
    const computed = { layout: this.#composition.layout.compute(view, at, { measurer: this.host.measurer, style }, f.axisContext), key, width, height, strip };
    this.#lastLayout = computed;
    return computed;
  }

  #layoutForSize(f: FrameState): PlotLayout | null {
    return this.#size === null || this.#size.width <= 0 || f.shown.kind !== 'ready' ? null
      : this.#plotLayout(f, this.#size.width - (this.#fallback?.width ?? 0), this.#size.height - (this.#fallback?.height ?? 0), reservedStrip(this.#size, this.#readoutMode));
  }

  /** The axis context for this frame: the last one while what it holds is the same. */
  #axisContextFor(a: Accepted, locale: string, compact: boolean): AxisContext {
    const xLabelGiven = typeof object(a.options.x).label === 'string';
    const valueTitle = a.messages.value;
    const last = this.#lastAxisContext;
    if (last !== null && last.resolved === a.resolved && last.locale === locale && last.compact === compact &&
        last.xLabelGiven === xLabelGiven && last.valueTitle === valueTitle) return last;
    return this.#lastAxisContext = { resolved: a.resolved, locale, compact, xLabelGiven, valueTitle };
  }

  /** Make the English marking once per messages option so repeated frames can reuse it. */
  #englishOf(a: Accepted, foreign: boolean): (key: keyof Messages) => string | null {
    if (!foreign) return INHERIT_LANGUAGE;
    const source = a.options.messages;
    // Only an object is read live by the marking; anything else overrides nothing, so every text is English.
    if (source === null || typeof source !== 'object') return ALL_ENGLISH;
    const memo = this.#englishMemo;
    if (memo !== null && memo.source === source) return memo.english;
    const english = englishMarker(source);
    this.#englishMemo = { source, english };
    return english;
  }

  // Phase 1: Initial reads & pure CPU prep (zero DOM writes, zero probeColors).
  #phase1(f: FrameState): void {
    const a = f.a!;
    const view = f.view;
    const compact = f.compact;
    this.#stage('frame');
    const shown = f.shown = displayState(a, f.stateDiag, this.#kind, this.#internalError !== null);
    f.noteShown = shown.kind === 'ready' || shown.kind === 'empty' || shown.kind === 'error';
    if (compact) {
      f.style = COMPACT_TEXT_STYLE;
      // Compact charts do not mount the text layer; keep dirty so an upgrade to full reads the real text style.
      this.textStyleDirty = true;
    } else {
      if (this.textStyleDirty) {
        const next = this.host.textStyle();
        if (!sameTextStyle(this.#textStyle, next)) this.#textStyle = next;
        this.textStyleDirty = false;
      }
      f.style = this.#textStyle!;
    }
    f.layoutEpoch = this.fontEpoch;
    // The inherited language is read once and serves the locale and the English marking alike.
    const lang = f.lang = this.host.pageLang();
    const locale = f.locale = this.host.locale(a.options.locale, lang);

    // Formatters. What a formatter threw on belongs to the formatters and the revision it formatted.
    const previous = this.drawn;
    if (previous?.locale === locale && sameFormatInputs(previous.accepted, a)) {
      f.fKey = previous.formattersKey;
      f.formatters = previous.formatters;
    } else {
      const spec = buildFormatSpec(a, locale, this.#formatterError ??= this.#formatterErrorCallback());
      const fKey = f.fKey = formattersKeyOf(spec, a.resolved.values.length);
      if (previous && sameKey(previous.formattersKey, fKey)) {
        f.formatters = previous.formatters;
      } else {
        this.#stage('formatters');
        // The bucket belongs to the formatters, including any fallback they reported on construction.
        this.#setPresentation('format', EMPTY_DIAGNOSTICS);
        f.formatters = createFormattersWith(spec, new FormatterEnvironment(locale, this), this.#composition.timeReadout);
      }
    }

    // Naming (spec A1): a labelledBy that names nothing falls back to the title or a generated name.
    const by = f.by = stringOption(a.options, 'labelledBy');
    const byText = f.byText = by ? this.host.labelText(by) : null;
    // A heading with no text names nothing either (A1): the title, else the generated name, is used instead.
    const named = f.named = !!byText?.trim();
    const title = f.title = titleOf(a.options);
    this.#setPresentation('naming', by !== null && !named && title === null
      ? [createDiagnostic('AX140', 'none', { detail: `No element with text has the id "${by}".` }, 'presentation')] : EMPTY_DIAGNOSTICS);
    f.caption = named ? byText!.trim() || undefined : undefined;

    const foreignPage = f.foreignPage = lang !== null && !ENGLISH_TAG.test(lang);
    f.english = this.#englishOf(a, foreignPage);

    // Tick labels are made now, before anything is written: an author tick formatter runs here, never during
    // publication (final review, finding 1), and what it reported belongs to every layout made from them,
    // cached ones included (finding 11).
    const axisContext = f.axisContext = this.#axisContextFor(a, locale, compact);
    if (shown.kind === 'ready' && !compact) this.#composition.layout.prepareTicks?.(view, axisContext);
    // A formatter that changed the chart made findings about a revision that is not drawn (defect 3); what
    // the formatters threw on is reported with the layout, from the ticks it draws (re-check, R12).
    if (!this.#current(a)) throw ABORT;

    this.#settleFigureReader(f, hiddenIn(this.drawn?.layout));
    // The lazy parts of the reader model run author formatters: materialized here, before anything is written.
    void f.reader.summary;
    void f.reader.note;
    if (!this.#current(a)) throw ABORT;

    // Theme check: read-only preparation when the host supports phased theme resolution.
    let needsTheme = this.themeDirty || !this.theme || this.#themeSeries === null || this.#themeColors !== a.options.colors;
    if (needsTheme || view.kind === 'donut') {
      const keys = f.keys = themeKeys(view);
      needsTheme ||= !sameKey(this.#themeSeries, keys);
    } else if (!sameSeriesKeys(view, this.#themeSeries!)) {
      f.keys = themeKeys(view);
      needsTheme = true;
    }
    f.needsTheme = needsTheme;
    if (needsTheme && this.host.themePrepare) {
      f.preparedTheme = this.host.themePrepare(f.keys!, object(a.options.colors) as Record<string, string>);
    }

    // The fallback is only for a plot; a state message is shown in whatever room there is.
    if (shown.kind !== 'ready' || compact) this.#fallback = null;
    f.tooSmall = this.#fallback !== null;
  }

  // Phase 2: Theme writes + initial arrange.
  #phase2(f: FrameState): void {
    const a = f.a!;
    if (f.needsTheme) {
      this.#mutate(f);
      if (f.preparedTheme !== null && this.host.themeApply) {
        this.#stage('theme');
        this.host.themeApply(f.preparedTheme);
      } else {
        this.resolveTheme(f.keys!, a.options.colors);
      }
    }
    const hadStrip = this.#readoutMode;
    const shown = f.shown;
    if (shown.kind !== 'ready' || f.compact || f.tooSmall || a.options.tooltip === false) {
      this.#readoutMode = false;
      this.#readoutKind = 'floating';
    }
    f.needMeasure = this.#arrange(f, f.tooSmall) || hadStrip !== this.#readoutMode || this.sizeDirty || this.#size === null;
    f.noReadout = shown.kind === 'ready' && f.compact && !f.tooSmall && !this.#readoutMode;
  }

  // Phase 3a (part 1): Verify standard theme declarations after Phase 2 writes (reads only).
  #finishTheme(f: FrameState): void {
    if (f.needsTheme && f.preparedTheme !== null && this.host.themeFinish) {
      const res = this.host.themeFinish(f.preparedTheme, true);
      if (res !== null) this.#applyThemeResolution(res, f.keys!, f.a!.options.colors);
      else f.needsThemeProbe = true;
    }
  }

  // Phase 3a (part 3): Non-standard theme probes (only when a chart uses custom CSS tokens/colors).
  #probeTheme(f: FrameState): void {
    if (f.needsThemeProbe && f.preparedTheme !== null && this.host.themeProbe) {
      this.#probeWrote = true;
      const res = this.host.themeProbe(f.preparedTheme, this.#probeReport ??= this.#probeReportCallback());
      f.needMeasure ||= this.#probeWrote;
      this.#applyThemeResolution(res, f.keys!, f.a!.options.colors);
      f.needsThemeProbe = false;
    }
  }

  // Phase 3b (part 1): Pure layout check; returns true if this chart needs a strip-height probe.
  #layoutCheck(f: FrameState): boolean {
    if (!f.readoutPending) return false;
    this.#measurePending(f);
    f.needsStripProbe = false;
    // Readout mode, decided by layout (rule 5): the plot's rectangle as it is without the strip, laid out in
    // the plot's whole column, is narrower than 240 or shorter than 140 CSS px. The strip is then reserved and
    // the plot measured again; the decision does not depend on the strip, so it cannot flip with it. Held
    // while the plot is too small (L8): that state has no strip.
    f.withoutLayout = null;
    f.narrowPlotHeight = null;
    f.stripAction = null;
    if (this.#size !== null && this.#size.width > 0 && f.shown.kind === 'ready' && !f.compact && !f.tooSmall && f.a!.options.tooltip !== false) {
      const room = this.#size.room ?? this.#size;
      const withoutLayout = f.withoutLayout = this.#plotLayout(f, room.width, room.height, null);
      const without = withoutLayout.layout;
      if (without.kind === 'plot' && (without.plot.width < READOUT_WIDTH || without.plot.height < READOUT_HEIGHT)) {
        f.narrowPlotHeight = without.plot.height;
        // Measure the strip only when it might use space, and re-measure on style or fontEpoch changes.
        if (this.#stripStyle !== f.style || this.#stripFontEpoch !== f.layoutEpoch) {
          f.needsStripProbe = true;
        }
      }
    }
    return f.needsStripProbe;
  }

  // Phase 3b (part 2A): Mount hidden strip-height probe div (write pass, batched across charts).
  #stripMount(f: FrameState): void {
    if (f.needsStripProbe && f.stripProbe === null && this.host.stripProbeMount) {
      f.stripProbe = this.host.stripProbeMount();
    }
  }

  // Phase 3b (part 2B): Read strip-height computed style (read pass, 1 layout across all charts).
  #stripRead(f: FrameState): void {
    if (!f.needsStripProbe) return;
    const style = f.style;
    this.#stripStyle = style;
    this.#stripFontEpoch = f.layoutEpoch;
    const measured = f.stripProbe !== null && this.host.stripProbeRead
      ? this.host.stripProbeRead(f.stripProbe)
      : this.host.stripHeight?.();
    this.#stripHeight = measured !== undefined && Number.isFinite(measured) && measured > 0
      ? measured : 2 * Math.max(24, style.lineHeight);
    f.needsStripProbe = false;
  }

  // Phase 3b (part 3): Pure readout mode decision using measured stripHeight.
  #readoutDecide(f: FrameState): void {
    if (f.readoutPending && this.#size !== null && f.withoutLayout !== null) {
      // Decision 0004 revision 3, rule 5: a plot that, laid out without a strip, is under 240 × 140 has the
      // strip; if the strip would leave it under the L8 minimum of 80 px, there is no strip and no floating
      // tooltip either ('none': pointing highlights the datum; its values are in the keyboard reading and the
      // table). Never floating below the limit (final review, finding 9).
      let next: ReadoutMode = 'floating';
      const narrow = f.narrowPlotHeight;
      if (narrow !== null) {
        if (this.#readoutMode && this.#size.room && this.#size.room.height - this.#size.height > 0) this.#stripHeight = this.#size.room.height - this.#size.height;
        next = narrow - this.#stripHeight >= MIN_PLOT_HEIGHT ? 'strip' : 'none';
      }
      if (next !== this.#readoutKind) {
        this.#readoutKind = next;
        const wantStrip = next === 'strip';
        if (wantStrip !== this.#readoutMode) {
          this.#readoutMode = wantStrip;
          f.stripAction = 'strip-arrange';
        } else {
          f.stripAction = 'prepare-only';
        }
      }
    }
  }

  // Phase 4.0 (writes): Reserve/release readout strip or update floating/none controls.
  #stripWrite(f: FrameState): void {
    if (f.stripAction === 'strip-arrange') {
      // Reserving or giving back the strip always changes the plot: it is measured again.
      this.#arrange(f, f.tooSmall);
    } else if (f.stripAction === 'prepare-only') {
      // Readout switched between 'floating' and 'none' without reserving a strip: only the controls state changes.
      this.#mutate(f);
      this.host.interaction.prepare(controlsStateFor(f, f.reader, f.tooSmall, this.#kind, this.#streaming, this.#paused, this.#readoutMode, this.#readoutKind));
    }
  }

  // Phase 4.0 (reads): Batched re-measure after strip reservation.
  #stripMeasure(f: FrameState): void {
    if (f.stripAction === 'strip-arrange') {
      this.#size = this.host.measure();
    }
    f.stripAction = null;
  }

  // Phase 4.1 (init): Initial layout computation for L8 / hidden-label note convergence loop.
  #layoutInit(f: FrameState): void {
    if (!f.readoutPending) return;
    f.readoutPending = false;
    f.passAction = null;
    // Subtract the fallback's own effect on the plot size so L8 uses the normal plot's room.
    const result = f.result = this.#layoutForSize(f);
    f.layoutDone = result === null;
  }

  // Phase 4.1 (per-pass writes): Drop strip, enter L8 fallback, or arrange hidden-label note.
  #passWrite(f: FrameState): boolean {
    f.passAction = null;
    const result = f.result;
    if (f.layoutDone || result === null || this.#size === null) return false;
    const small = result.layout.kind === 'too-small';
    if (small && this.#readoutMode && f.withoutLayout?.layout.kind === 'plot') {
      // Too small only because of the strip (its real height was more than expected): no strip and no
      // tooltip, and the readable plot stays (rule 5). The measured height keeps the next frame there.
      if (this.#size.room) this.#stripHeight = Math.max(this.#stripHeight, this.#size.room.height - this.#size.height);
      this.#readoutMode = false;
      this.#readoutKind = 'none';
      this.#arrange(f, f.tooSmall);
      f.passAction = 'drop-strip';
      return true;
    }
    if (small && !f.tooSmall) {
      f.normalSize = this.#size;
      f.tooSmall = true;
      this.#readoutMode = false;
      this.#readoutKind = 'floating';
      this.#settleFigureReader(f, 0);
      this.#arrange(f, true);
      f.passAction = 'enter-fallback';
      return true;
    }
    if (!small && f.tooSmall) {
      f.tooSmall = false;
      this.#fallback = null;
      this.#settleFigureReader(f, hiddenIn(result.layout));
      this.#arrange(f, false);
      f.passAction = 'leave-fallback';
      return true;
    }
    if (f.tooSmall) {
      f.layoutDone = true;
      return false;
    }
    // Normal: the note says what this layout hides; if that moves the figure, judge the new size.
    this.#settleFigureReader(f, hiddenIn(result.layout));
    if (!this.#arrange(f, false)) {
      f.layoutDone = true;
      return false;
    }
    f.passAction = 'note-moved';
    return true;
  }

  // Phase 4.1 (per-pass reads): Batched re-measure after pass writes.
  #passMeasure(f: FrameState): boolean {
    const action = f.passAction;
    f.passAction = null;
    if (action === null || this.#size === null) return false;
    // Every pass action changed what the figure holds: each reads the plot again first.
    const size = this.#size = this.host.measure();
    if (action === 'drop-strip') {
      const result = f.result = this.#layoutForSize(f);
      f.layoutDone = result === null;
    } else if (action === 'enter-fallback') {
      const normal = f.normalSize!;
      this.#fallback = { width: (size?.width ?? normal.width) - normal.width, height: (size?.height ?? normal.height) - normal.height };
      if (size === null || size.width <= 0) f.result = null;
      f.layoutDone = true;
    } else if (action === 'leave-fallback') {
      // The estimate let us leave fallback. Only the restored plot's measured room can decide readout.
      f.readoutPending = true;
      return true;
    } else {
      const next = this.#layoutForSize(f);
      f.layoutDone = next === null || f.result === next;
      f.result = next;
    }
    return false;
  }


  #publish(f: FrameState): void {
    const a = f.a!;
    const view = f.view;
    const shown = f.shown;
    const compact = f.compact;
    const result = f.result;
    const layout: Layout = result?.layout ?? {
      kind: 'unmeasured', width: this.#size?.width ?? 0,
      height: this.#size && this.#size.width > 0 && shown.kind !== 'ready' ? Math.max(0, this.#size.height) : this.#size?.height ?? 0,
    };
    if (result !== null) {
      if (view.kind === 'scatter' && a.zoom === null) {
        const x = layout.kind === 'plot' && layout.projection.kind === 'xy' ? layout.projection.x : null;
        if (x && x.type !== 'band' && (x.domain[0] !== view.xFull[0] || x.domain[1] !== view.xFull[1])) {
          if (this.#widenedX?.epoch !== view.frame.epoch || this.#widenedX.drawn !== x.domain) {
            this.#widenedX = { epoch: view.frame.epoch, drawn: x.domain };
          }
        } else {
          this.#widenedX = null;
        }
      }
      if (this.#destroyed) throw ABORT;
    }

    const hidden = hiddenIn(layout);
    this.#reportFit(a, layout, f.tooSmall, hidden);
    // A tick label in the default format is not a value shown differently (F12): its AX160 has no effect on
    // the figure, so the note it would add cannot take room from the ticks and bring the label back (closing
    // pass, item 2).
    const failed = shown.kind === 'ready' && !compact ? this.#composition.layout.tickFormatFailures?.(view, f.axisContext, layout) : undefined;
    this.#setPresentation('layout', failed?.length
      ? failed.map(field => createDiagnostic('AX160', 'none', { field }, 'presentation')) : EMPTY_DIAGNOSTICS);
    const measured = layout.kind !== 'unmeasured' || (shown.kind !== 'ready' && this.#size !== null && this.#size.width > 0 && this.#size.height > 0);
    this.#settleFigureReader(f, hidden);
    if (this.#destroyed) throw ABORT;
    const reader = f.reader;
    const formatters = f.formatters;
    const locale = f.locale;

    // Scene.
    const ratio = this.pixelRatio;
    const previous = this.drawn;
    const sameGeometry = previous?.accepted.view === view && previous.layout === layout;
    let scene: Scene;
    if (sameGeometry && Object.is(previous.pixelRatio, ratio)) scene = previous.scene;
    else {
      this.#stage('scene');
      scene = this.#composition.scene(view, layout, ratio);
    }

    // Lookup reads the frame through the view; it switches with the marks.
    // Scatter ties are decided within half a device pixel: the ratio is part of what the lookup depends on.
    // Compact charts have no interaction, so skip building a lookup until promoted to full.
    let lookup: Lookup;
    if (compact) {
      lookup = EMPTY_LOOKUP;
    } else if (sameGeometry && previous.lookup !== EMPTY_LOOKUP && previous.formatters === formatters &&
        previous.accepted.messages === a.messages && previous.locale === locale &&
        (view.kind !== 'scatter' || Object.is(previous.pixelRatio, ratio))) {
      lookup = previous.lookup;
    } else {
      this.#stage('lookup');
      lookup = this.#composition.lookup(view, layout, formatters, a.messages, locale, ratio);
    }

    // Marks: drawn again for a new scene, a new theme or a new pixel ratio, never rebuilt for a theme alone.
    // A frame that cannot draw (no size) clears what an earlier frame drew, so no marks outlive their rows.
    this.#mutate(f);
    if (this.#surfacesHidden) {
      this.host.surfaces?.(true);
      this.#surfacesHidden = false;
    }
    // Nothing drawn yet and nothing to draw: no call at all (a hidden container stays untouched, L3).
    const paintedTheme = measured ? this.#themeRevision : null;
    const drewBefore = previous ? previous.paintedTheme !== null : this.#hadMarks;
    if (measured ? previous?.paintedTheme !== paintedTheme || previous.scene !== scene || !Object.is(previous.pixelRatio, ratio) : drewBefore) {
      this.#stage('draw');
      this.host.renderer.draw(measured ? scene : this.#emptyScene(), this.theme!.bindings, this.theme!.theme, ratio);
      this.#hadMarks = measured;
    }
    if (this.drawn?.layout !== layout) {
      this.#stage('text');
      this.host.text.render(layout.kind === 'plot' ? layout.texts : []);
    }

    if (!this.#arrangedFor(f, f.tooSmall)) {
      this.#stage('figure');
      this.host.figure.update(figureModelFor(f, reader, f.tooSmall, this.#disclosureNow(f)));
    }

    // A change of state is said once, politely (spec L7). The first state is not announced: it is what
    // the page shows on load, and 24 charts saying "Loading" at once is noise.
    if (this.#announced !== null && this.#announced !== shown.kind) {
      this.host.figure.announce(shown.kind === 'ready' ? readyText(a, reader, f.byText) : shown.text,
        shown.kind !== 'ready' && shown.message ? f.english(shown.message) : null);
    }
    if (measured || this.#announced !== null) this.#announced = shown.kind;

    this.drawn = {
      accepted: a, formatters, formattersKey: f.fKey, locale, style: f.style, fontEpoch: f.layoutEpoch, pixelRatio: ratio,
      layout, plotLayout: result, scene, lookup, reader, readerInputs: f.readerInputs, paintedTheme,
    };
    const { bindings, theme } = this.theme!;
    const committed = committedStateFor(f, reader, f.tooSmall, layout, lookup, ratio,
      this.#kind, this.#streaming, this.#paused, this.#readoutMode, this.#readoutKind, bindings, theme);
    if (__DEV__ && compact) {
      // Dev/test hosts (acceptance tests) may inspect committed.lookup on compact charts; materialize
      // lazily on first access while keeping browser compact charts completely free of lookup allocations.
      Object.defineProperty(committed, 'lookup', {
        enumerable: true,
        configurable: true,
        get: lazyLookup(this.#composition, view, layout, formatters, a.messages, locale, ratio),
      });
    }
    this.host.interaction.commit(committed);
    // The displayed snapshot is now this revision (or nothing, when nothing could be drawn): older rows go.
    this.#showing(measured ? a : null);
    if (this.stages && measured) this.#settle(a.revision);
  }

  #emptyScene(): Scene {
    const width = Math.max(0, this.#size?.width ?? 0);
    const height = Math.max(0, this.#size?.height ?? 0);
    return { width, height, clip: { x: 0, y: 0, width, height }, marks: [] };
  }

  #release(): void {
    const stream = this.#stream;
    if (!stream) return;
    const screen = this.onScreen?.stream === stream ? this.onScreen.frame : null;
    const running = this.inflight?.stream === stream ? this.inflight.frame : null;
    stream.release(screen, this.#accepted!.frame, running, this.held?.frame);
  }

  /** The displayed snapshot owns its rows until another revision is published. */
  #showing(a: Accepted | null): void {
    if (this.#destroyed) return;
    this.onScreen = a;
    this.#release();
    if (a) this.#stream?.shown(a.frame);
  }

  /**
   * An exception in our own pipeline: a complete error revision. The interaction layer is cleared (no old
   * lookup answers the pointer), every output the error state cleared is invalidated so recovery redraws
   * it all, and readiness settles on this revision.
   */
  #failSafe(a: Accepted, error: unknown): void {
    this.#raiseInternal(error);
    this.#showInternal(a.messages, a.name, a.options);
    this.drawn = null;
    // Nothing on screen needs rows any more: the error revision has none.
    this.#showing(null);
    this.#lastLayout = null;
    // The error revision keeps nothing of the options it failed on.
    this.#lastAxisContext = null;
    this.themeDirty = true;
    this.sizeDirty = true;
    if (this.stages) this.#settle(a.revision);
  }

  /** Records a resolved theme and its AX141 presentation finding. */
  #applyThemeResolution(resolution: ThemeResolution, keys: readonly string[], colors: unknown): void {
    this.theme = resolution;
    this.#themeSeries = keys;
    this.#themeColors = colors;
    // A detached chart gets the light defaults; it resolves again in the next frame that draws.
    this.themeDirty = resolution.resolved === false;
    this.#themeRevision++;
    // When the backdrop could not be determined the background is a guess, so contrast is not judged.
    const low = resolution.backdropKnown === false ? [] : lowContrastSeries(resolution.theme).filter(i => i < keys.length);
    this.#setPresentation('theme', low.length ? [createDiagnostic('AX141', 'none', { count: low.length }, 'presentation')] : EMPTY_DIAGNOSTICS);
  }

  /** Resolves the theme for these series keys and writes it (custom properties, scheme) on the figure. */
  resolveTheme(keys: readonly string[], colors: unknown): void {
    this.#stage('theme');
    this.#applyThemeResolution(this.host.theme(keys, object(colors) as Record<string, string>), keys, colors);
  }

  /**
   * The error revision on every layer, each step on its own (one that throws does not stop the others):
   * interaction off first, so no old lookup answers the pointer; then the message; then the mark and text
   * surfaces hidden by the host independently of their draw methods, which may be what failed; then their
   * contents cleared (review 3, controller blocker 3).
   */
  #showInternal(m: Messages, name: string, o: OptionRecord): void {
    const attempt = (step: () => void) => {
      try { step(); } catch { /* the next step still runs */ }
    };
    attempt(() => this.host.interaction.clear());
    attempt(() => this.host.figure.update({
      compact: isCompact(this.#kind, o), title: titleOf(o), labelledBy: null, name,
      subtitle: null, summary: m.internalError, summaryVisible: false, note: null, message: m.internalError,
    }));
    attempt(() => {
      if (this.#announced !== null && this.#announced !== 'internal') this.host.figure.announce(m.internalError);
      this.#announced = 'internal';
    });
    attempt(() => {
      this.host.surfaces?.(false);
      this.#surfacesHidden = true;
    });
    attempt(() => this.host.text.render([]));
    attempt(() => { if (this.theme) this.host.renderer.draw(this.#emptyScene(), this.theme.bindings, this.theme.theme, this.pixelRatio); this.#hadMarks = false; });
  }

  #settle(revision: number): void {
    this.settledRevision = Math.max(this.settledRevision, revision);
    if (!this.waiters || this.waiters.length === 0) return;
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      if (this.waiters[i]!.revision <= revision) this.waiters.splice(i, 1)[0]!.resolve();
    }
  }

  // ── events ─────────────────────────────────────────────────────────────────────────────────────
  /** Every listener subscribed when the event happened gets it, in order; nested events follow (finding 7). */
  emit<E extends keyof ChartEvents<unknown>>(event: E, payload: ChartEvents<unknown>[E] | null): void {
    const set = this.listeners?.get(event);
    if (!set || set.size === 0) return;
    const snapshot = [...set];
    this.#enqueue(() => {
      for (const listener of snapshot) {
        if (this.#destroyed) return;
        try {
          (listener as (p: unknown) => void)(payload);
        } catch (error) {
          this.host.console?.error('[axylo] event listener threw:', error);
        }
      }
    });
  }

  // ── watchers ───────────────────────────────────────────────────────────────────────────────────
  /** The text style and the strip's height are read again; with `size`, the plot size too. */
  dirtyTextAndStrip(size: boolean): void {
    if (size) this.sizeDirty = true;
    this.textStyleDirty = true;
    this.#stripStyle = null;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#cancelFrameRequest();
    const pending = this.waiters;
    this.waiters = null;
    // Nothing the handle still references keeps the data, the options or the drawing alive.
    this.#accepted = null;
    this.drawn = null;
    this.held = null;
    this.#lastLayout = null;
    this.#lastAxisContext = null;
    this.#textStyle = null;
    this.#stripStyle = null;
    this.#englishMemo = null;
    this.onScreen = null;
    this.#stream?.clear();
    this.#stream = null;
    this.#openStream = null;
    this.theme = null;
    this.#themeSeries = null;
    this.#themeColors = undefined;
    if (this.listeners) { this.listeners.clear(); this.listeners = null; }
    if (this.#presentation) { this.#presentation.clear(); this.#presentation = null; }
    if (this.#deliveredKeys) { this.#deliveredKeys.clear(); this.#deliveredKeys = null; }
    this.#settledInputs = null;
    if (this.#notifications) { this.#notifications.length = 0; this.#notifications = null; }
    this.#options = new OptionsStore({});
    const owner = this.host;
    this.host = new DeadHost(owner.id, owner.renderer.kind);
    this.#deliveryMade = null;
    try {
      owner.dispose();
    } finally {
      if (pending) for (const w of pending) w.resolve();
    }
  }

  /** A phased frame for a multi-chart batch, behind a single-use handle (see FrameHandle). */
  beginFrame(): FrameRun | null {
    const f = this.#startFrame();
    return f ? new FrameHandle(f) : null;
  }
}

/**
 * A chart from `axylo/static` has no streaming storage. Its append fails loudly, before touching any state,
 * rather than dropping the rows unseen; the subclass keeps that message out of the streaming bundles, where
 * append after destroy() still returns quietly.
 */
class StaticChartController extends ChartController {
  override append(): void {
    throw new Error('append() is not available on charts created from axylo/static; import from axylo/stream or axylo for streaming.');
  }
}
