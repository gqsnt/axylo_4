/**
 * The types the interaction layer shares with the controller and each kind's composition. Types only, so a
 * composition can name its interaction parts without importing the interaction code (and its cycle back
 * through core/axes).
 */
import type { DatumRef, Formatters, Layout, Lookup, PaintBindings, ReaderModel, ResolvedTheme, StepDirection, View } from '../core/contracts';
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
}

/** The messages that make up the plot's instructions rather than a control's label. */
export type InstructionKey = 'plotInstructions' | 'donutInstructions' | 'seriesInstructions' | 'zoomInstructions';

export type SeriesSwatch = (index: number, cue: SwatchSpec['cue'], hollow: boolean) => SwatchSpec;

// Called with null when the legend goes away, so the list can release its listeners.
export type SliceList = (doc: Document, d: ControlsState | null, actions: Actions, list: HTMLUListElement | null) => HTMLUListElement | null;

export interface InteractionParts {
  readonly overlay: TargetMarks;
  readonly swatch: SeriesSwatch;
  readonly stepInSeries: ((view: Extract<View, { kind: 'scatter' }>, ref: DatumRef, direction: StepDirection) => DatumRef | null) | null;
  readonly sliceList: SliceList | null;
}
