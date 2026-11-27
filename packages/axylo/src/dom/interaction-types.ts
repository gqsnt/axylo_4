/**
 * The types the interaction layer shares with the controller and each kind's composition. Types only, so a
 * composition can name its interaction parts without importing the interaction code (and its cycle back
 * through core/axes).
 */
import type { DatumRef, Formatters, Layout, Lookup, PaintBindings, ReaderModel, ResolvedTheme, StepDirection, View } from '../core/contracts';
import type { SyncResolve } from '../core/peer';
import type { Messages } from '../public';
import type { TargetMarks } from '../core/focus';
import type { SwatchSpec } from './swatch';

export type Span = readonly [number, number];
export type ReadoutMode = 'floating' | 'strip' | 'none';

export interface ControlsState {
  readonly kind: 'line' | 'area' | 'bar' | 'histogram' | 'scatter' | 'donut';
  readonly view: View;
  readonly formatters: Formatters;
  readonly messages: Messages;
  readonly reader: ReaderModel;
  readonly tooSmall: boolean;
  readonly ready: boolean;
  readonly inspectable?: boolean;
  readonly empty?: boolean;
  readonly message?: string | null;
  readonly interactive: boolean;
  readonly tooltip: boolean;
  readonly legend: false | 'top' | 'right' | 'bottom';
  readonly zoom: false | true | 'touch';
  readonly zoomed: boolean;
  readonly streaming: boolean;
  readonly paused: boolean;
  readonly epoch: number;
  english(key: keyof Messages): string | null;
  readonly pageLang: string | null;
  readonly readout?: boolean | ReadoutMode;
  readonly readoutMode?: ReadoutMode;
}

export interface Committed extends ControlsState {
  readonly layout: Layout;
  readonly lookup: Lookup;
  readonly bindings: PaintBindings;
  readonly theme: ResolvedTheme;
  readonly pixelRatio: number;
}

export interface Actions {
  zoom(window: Span | null): void;
  toggle(seriesKey: string): void;
  pause(paused: boolean): void;
  select(ref: DatumRef): void;
  hover(ref: DatumRef | null): void;
}

export interface Interaction {
  prepare(state: ControlsState): boolean;
  commit(state: Committed | null): void;
  clear(): void;
  attach(): void;
  detach(): void;
  destroy(): void;
  /**
   * A peer's cursor (`axylo/sync`): drawn like a hover but passive. It never raises hover, takes focus, writes
   * the value text or announces, and the chart's own pointer, keyboard, hold and pin always win over it. A null
   * target clears it only for the origin that showed it.
   */
  sync?(resolve: SyncResolve | null, origin: object): void;
}

/** The messages that make up the plot's instructions rather than a control's label. */
export type InstructionKey = 'plotInstructions' | 'donutInstructions' | 'seriesInstructions' | 'zoomInstructions';

/** `view` is the committed one the swatch is drawn for: a composition with several marks reads the series' mark from it. */
export interface SeriesSwatch {
  (index: number, cue: SwatchSpec['cue'], hollow: boolean, view: View): SwatchSpec;
  /**
   * What the swatch depends on beyond the series' index, cue and visibility, compared by identity so the cached
   * controls redraw when it changes (a Cartesian update that keeps a series but changes its mark). Absent: nothing.
   */
  readonly key?: (index: number, view: View) => unknown;
  /**
   * Whether a view with one published series still gets its legend toggle. A lone Cartesian range or error bar
   * is one series drawn from several columns, so hiding it is a choice the reader can make; a lone line or bar
   * keeps no legend. Absent: never.
   */
  readonly legendForOne?: (view: View) => boolean;
}

// Called with null when the legend goes away, so the list can release its listeners.
export type SliceList = (doc: Document, d: ControlsState | null, actions: Actions, list: HTMLUListElement | null) => HTMLUListElement | null;

export interface InteractionParts {
  readonly overlay: TargetMarks;
  readonly swatch: SeriesSwatch;
  readonly stepInSeries: ((view: Extract<View, { kind: 'scatter' }>, ref: DatumRef, direction: StepDirection) => DatumRef | null) | null;
  readonly sliceList: SliceList | null;
}
