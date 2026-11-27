import type { DatumRef, DiagnosticInput, Formatters, Frame, Layout, Lookup, MarkRenderer, PaintBindings,
  PlacedText, ReaderModel, ResolvedTheme, Scene, TextMeasurer, TextStyle, View,
} from './contracts';
import type { ChartEvents, Diagnostic, Messages, XValue } from '../public';
import type { ChartType, ResolvedOptions } from '../data/options';
import type { Table } from '../data/table';
import type { DiagnosticCollector } from '../diagnostics';
import type { ThemeResolution } from '../theme';
import type { FigureModel } from '../dom/figure';
import type { Committed, ControlsState } from '../dom/interaction';
import type { Store } from './composition';
import type { ChartHandle, StageCounter } from './instrument';
import type { DeliveryConsole } from './delivery';
import type { OptionRecord } from './options';
import type { Span } from './stages';
import type { SyncResolve } from './peer';

export type ChartKind = ChartType;

export interface Size {
  readonly width: number;
  readonly height: number;
  /**
   * The plot's column (the plot and, in readout mode, the strip under it): the same in both modes, so the
   * mode decided from it does not flip with its own strip. Absent: the plot's size.
   */
  readonly room?: { readonly width: number; readonly height: number };
}

/** Where a pointed datum's values go: a floating tooltip, the reserved strip, or nowhere (rule 5). */
export type ReadoutMode = 'floating' | 'strip' | 'none';

/** Everything the controller needs from the page. */
export interface Host {
  /** Allocated, for the DOM relationships (aria-describedby, the table's id). */
  readonly id: string;
  /** The target element's own `id`, when it has one: an untitled chart is named by it in diagnostics. */
  readonly targetId?: string | null;
  readonly console: DeliveryConsole | null;
  /** The page the once-per-code printing rule applies to. */
  readonly page: object;
  readonly timeZone: string;
  readonly renderer: Pick<MarkRenderer, 'kind' | 'draw'>;
  readonly text: { render(texts: readonly PlacedText[]): void };
  readonly figure: { update(model: FigureModel): boolean; announce(text: string, lang?: string | null): void };
  readonly interaction: {
    prepare(state: ControlsState): boolean; commit(state: Committed | null): void; clear(): void;
    /** A peer's cursor resolver from `axylo/sync` (core/peer.ts); absent where nothing can show one. */
    sync?(resolve: SyncResolve | null, origin: object): void;
  };
  readonly measurer: TextMeasurer;
  /** The callback gets the animation frame's time when the host has one. */
  requestFrame(callback: (time?: number) => void): number;
  cancelFrame(handle: number): void;
  /** Optional microtask scheduler (browser host only) for 1-frame zoom flushes. */
  scheduleMicrotask?(callback: () => void): void;
  /**
   * `pageLang`, when given, is what `pageLang()` just returned for this frame: the host need not read the
   * page's language a second time to resolve the locale from it.
   */
  locale(option: unknown, pageLang?: string | null): string;
  pageLang(): string | null;
  /** Text of the page element with this id, or null when there is none. */
  labelText(id: string): string | null;
  textStyle(): TextStyle;
  /**
   * The plot container's size as the figure lays it out, with what the rest of the figure overflows by
   * subtracted from its height (so it can be negative); null when the figure is not laid out at all (hidden
   * or detached), which is not the same as a visible figure whose caption left no room.
   */
  measure(): Size | null;
  /**
   * The readout strip's height as it would be reserved: two line heights of the strip's own text, measured
   * in the page (decision 0004 rule 5). Absent: estimated from the chart's text style.
   */
  stripHeight?(): number;
  /** Optional phased strip-height probe hooks used during multi-chart rAF batching. */
  stripProbeMount?(): unknown;
  stripProbeRead?(probe: unknown): number;
  stripProbeRemove?(probe: unknown): void;
  devicePixelRatio(): number;
  theme(seriesKeys: readonly string[], colors: Record<string, string>): ThemeResolution;
  /** Optional phased theme resolution hooks used during multi-chart rAF batching. */
  themePrepare?(seriesKeys: readonly string[], colors: Record<string, string>): unknown;
  themeApply?(prepared: unknown): void;
  themeFinish?(prepared: unknown, deferProbe?: boolean): ThemeResolution | null;
  /** Report whether a late probe changed live theme properties. Hosts that omit the report are remeasured. */
  themeProbe?(prepared: unknown, layoutChanged: (changed: boolean) => void): ThemeResolution;
  /** Shows or hides the mark and text surfaces without drawing (the error revision hides them). */
  surfaces?(visible: boolean): void;
  /** Called once by destroy, after the controller released its own state. */
  dispose(): void;
}

/** What the page tells the controller (observers, watchers). */
export interface Invalidate {
  resize(): void;
  /** The chart came back into the document: anything about the page may have changed meanwhile. */
  page(): void;
  theme(): void;
  /** The page's language changed: locale and English marking are read again in the next frame. */
  language(): void;
  fonts(): void;
  pixelRatio(): void;
}

/** What the interaction layer may ask for; everything goes through the public paths. */
export interface ControllerActions {
  zoom(window: Span | null): void;
  toggle(seriesKey: string): void;
  pause(paused: boolean): void;
  select(ref: DatumRef): void;
  hover(ref: DatumRef | null): void;
}

/** Phased execution handle for one frame, allowing a browser host to batch reads and writes across charts. */
export interface FrameRun {
  phase1(): void;
  phase2(): void;
  phase3Theme(): void;
  phase3Measure(): void;
  phase3Probe(): void;
  phase3LayoutCheck(): boolean;
  phase3StripMount(): void;
  phase3StripRead(): void;
  phase3StripRemove(): void;
  phase3ReadoutDecide(): void;
  phase4StripWrite(): void;
  phase4StripMeasure(): void;
  phase4Init(): void;
  phase4PassWrite(): boolean;
  /** Returns true when a chart restored from fallback needs the readout check again. */
  phase4PassMeasure(): boolean | void;
  phase5(): void;
  after(): void;
}

export interface Controller {
  readonly handle: ChartHandle;
  readonly actions: ControllerActions;
  readonly invalidate: Invalidate;
  /** Runs the pending frame now (tests, and theme changes that arrive inside a frame). */
  flush(): void;
  /** Starts a phased frame for multi-chart batching; null when nothing can run. */
  beginFrame(): FrameRun | null;
}

/** Internal streaming retention handle implemented by StreamSession (controller-stream.ts). */
export interface StreamSessionHandle {
  readonly store: Store;
  track(frame: Frame): void;
  ends(frame: Frame, from: Frame, added?: number): void;
  drop(resolved: ResolvedOptions): ResolvedOptions;
  row(frame: Frame, row: number): unknown;
  table(frame: Frame): Table;
  release(screen: Frame | null, pending: Frame, running: Frame | null, pausedFrame: Frame | undefined): void;
  shown(frame: Frame): void;
  clear(): void;
}

/** The state a call produced. Only accepted states are drawn. */
export interface Accepted {
  readonly options: OptionRecord;
  /** Options resolved for the latest call (domains, formats, labels). */
  readonly resolved: ResolvedOptions;
  /** The resolution the current data was normalized with (on the static path it holds the borrowed table). */
  readonly source: ResolvedOptions;
  /** A published snapshot keeps the session that owns its rows even if a call replaces the data. */
  readonly stream: StreamSessionHandle | null;
  /** The frame shown (while paused, the store may hold a newer one). */
  readonly frame: Frame;
  readonly dataDiagnostics: readonly DiagnosticInput[];
  /** AX100 and AX101 from the call that set the data; kept while the data and fields stay. */
  readonly dataOptions: readonly DiagnosticInput[];
  readonly optionDiagnostics: readonly DiagnosticInput[];
  readonly viewDiagnostics: readonly DiagnosticInput[];
  readonly naming: readonly DiagnosticInput[];
  readonly view: View;
  readonly viewKey: readonly unknown[];
  readonly zoom: Span<XValue> | null;
  /** Zoomed to the latest edge: the window follows appended data (plan 1.5). */
  readonly follow: boolean;
  readonly revision: number;
  readonly messages: Messages;
  readonly name: string;
  /** Series the reader hid with the legend, by key (the view's hidden set). */
  readonly hidden: ReadonlySet<string>;
}

export type Display =
  | { readonly kind: 'ready' }
  | {
    readonly kind: 'loading' | 'error' | 'empty' | 'internal'; readonly text: string;
    /** The built-in message shown, or null when the author wrote the text. */
    readonly message: keyof Messages | null;
  };

export interface PlotLayout {
  readonly layout: Layout;
  readonly key: readonly unknown[] | null;
  readonly width: number;
  readonly height: number;
  /** A reserved strip can leave the size unchanged (for example on an auto-height tile). */
  readonly strip: number | null;
}

export type Disclosure = { readonly omitted: number; readonly changed: number };
export interface ReaderEntry { readonly reader: ReaderModel; readonly inputs: readonly unknown[] }

/** Presentation diagnostics by the stage that found them (spec 3.5: reported when found, never thrown). */
export type PresentationStage = 'theme' | 'layout' | 'fit' | 'format' | 'naming' | 'internal';

export interface Candidate {
  readonly options: OptionRecord;
  readonly resolved: ResolvedOptions;
  readonly source: ResolvedOptions;
  readonly stream: StreamSessionHandle | null;
  readonly frame: Frame;
  readonly dataDiagnostics: readonly DiagnosticInput[];
  readonly dataOptions: readonly DiagnosticInput[];
  readonly optionDiagnostics: readonly DiagnosticInput[];
  readonly zoom: Span<XValue> | null;
  readonly hidden: ReadonlySet<string>;
  readonly messages: Messages;
}

export interface Viewed {
  readonly view: View;
  readonly viewKey: readonly unknown[];
  readonly viewDiagnostics: readonly DiagnosticInput[];
  /** What this build found that the previous view did not have. */
  readonly found: readonly DiagnosticInput[];
}

/**
 * The call being prepared: what it found so far, for a failure before it is accepted (finding 7). One per
 * call, so a nested call made by author code (a getter) cannot end the outer call's strict check (defect 6).
 */
export interface Preparation {
  sink: DiagnosticCollector | null;
  strict: boolean;
  name: string;
  handler: unknown;
  /** AX140 of a create: validate() lists it after AX199. */
  naming: readonly DiagnosticInput[];
}

/** While paused: the store's newest frame and its findings, accepted but not shown. */
export type Held = { frame: Frame; dataDiagnostics: readonly DiagnosticInput[]; viewDiagnostics: readonly DiagnosticInput[] } | null;

export interface Drawn {
  accepted: Accepted;
  formatters: Formatters;
  formattersKey: readonly unknown[];
  locale: string;
  style: TextStyle;
  fontEpoch: number;
  pixelRatio: number;
  layout: Layout;
  plotLayout: PlotLayout | null;
  scene: Scene;
  lookup: Lookup;
  reader: ReaderModel;
  readerInputs: readonly unknown[];
  paintedTheme: number | null;
}

/** The controller surface used by the handle, the host adapters and the development probe. */
export interface ControllerCore {
  readonly accepted: Accepted | null;
  readonly destroyed: boolean;
  readonly drawn: Drawn | null;
  readonly frameScheduled: boolean;
  readonly held: Held;
  readonly host: Host;
  readonly inFrame: boolean;
  readonly inflight: Accepted | null;
  readonly onScreen: { readonly frame: Frame } | null;
  readonly settledRevision: number;
  readonly stages: StageCounter | null;
  readonly theme: { bindings: PaintBindings; theme: ResolvedTheme } | null;
  fontEpoch: number;
  listeners: Map<keyof ChartEvents<unknown>, Set<(payload: never) => void>> | null;
  disposers: Set<() => void> | null;
  pixelRatio: number;
  textStyleDirty: boolean;
  themeDirty: boolean;
  waiters: { revision: number; resolve: () => void }[] | null;
  append(rows: unknown, options?: { keep?: number }): void;
  deliverChanges(): void;
  destroy(): void;
  diagnosticInputs(): readonly DiagnosticInput[];
  dirtyTextAndStrip(size: boolean): void;
  emit<E extends keyof ChartEvents<unknown>>(event: E, payload: ChartEvents<unknown>[E] | null): void;
  publicDiagnostics(inputs: readonly DiagnosticInput[]): Diagnostic[];
  resolveTheme(keys: readonly string[], colors: unknown): void;
  schedule(): void;
  setPaused(paused: boolean): void;
  toggleSeries(key: string): void;
  update(patch: unknown): void;
  zoom(domain: unknown): void;
}
