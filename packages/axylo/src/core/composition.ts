/**
 * What one chart kind brings to the shared controller and browser host: every stage that differs between
 * kinds, as functions the controller calls instead of dispatching on the kind itself. Each named entry
 * (`line`, `area`, …) passes its own composition (src/kinds), so a page that imports one kind bundles that
 * kind's stages only; the controller, the host, aligned data and Cartesian layout stay one implementation.
 */
import type { DiagnosticSink, Frame, Layout, Scene, View } from './contracts';
import type { ChartType, ResolvedOptions } from '../data/options';
import type { DataEnvironment, FrameVersion } from '../data/normalize';
import type { AlignedStore } from '../data/store';
import type { DonutStore, PointStore } from '../data/store-unaligned';
import type { ViewState } from '../view';
import type { LookupBuilder } from '../lookup';
import type { ReaderParts } from '../reader';
import type { InteractionParts } from '../dom/interaction';
import type { SvgMarks } from '../render/svg';
import type { CanvasMarks } from '../render/canvas';

export type Store = AlignedStore | PointStore | DonutStore;

export interface Composition {
  readonly kind: ChartType;
  /** The frame shape's normalization; the kind is passed back in (the aligned kinds share one). */
  normalize(kind: ChartType, resolved: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): Frame;
  /** Streaming storage for a static frame, opened by the first append. */
  openStore(frame: Frame, source: ResolvedOptions, data: unknown, env: DataEnvironment, kind: ChartType): Store;
  view(frame: Frame, state: ViewState, sink: DiagnosticSink): View;
  scene(view: View, layout: Layout, devicePixelRatio: number): Scene;
  readonly lookup: LookupBuilder;
  readonly reader: ReaderParts;
  readonly interaction: InteractionParts;
  /** The mark handlers of each renderer, for the marks this kind's scenes and overlays can produce. */
  readonly svg: SvgMarks;
  readonly canvas: CanvasMarks;
}
