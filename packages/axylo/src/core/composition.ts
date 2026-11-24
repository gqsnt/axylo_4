/**
 * What one chart kind brings to the shared controller and browser host: every stage that differs between
 * kinds, as functions the controller calls instead of dispatching on the kind itself. Each named entry
 * (`line`, `area`, …) passes its own composition (src/kinds), so a page that imports one kind bundles that
 * kind's stages only; the controller, the host, aligned data and Cartesian layout stay one implementation.
 */
import type { AlignedFrame, DiagnosticSink, Frame, Layout, Scene, TextMeasurer, TextStyle, View } from './contracts';
import type { ChartType, resolveOptions, ResolvedOptions } from '../data/options';
import type { DataEnvironment, FrameVersion } from '../data/normalize';
import type { AlignedStore } from '../data/store';
import type { DonutStore, PointStore, SampleStore } from '../data/store-unaligned';
import type { ViewState } from '../view';
import type { LookupBuilder } from '../lookup';
import type { ReaderParts } from '../reader';
import type { InteractionParts } from '../dom/interaction';
import type { SvgMarks } from '../render/svg';
import type { createTimeReadout } from '../format/time';
import type { AxisContext } from './axes';

export type Store = AlignedStore | PointStore | DonutStore | SampleStore<AlignedFrame>;

type Size = { readonly width: number; readonly height: number };

export interface LayoutStage {
  prepareTicks?(view: View, ctx: AxisContext): void;
  tickFormatFailures?(view: View, ctx: AxisContext, layout: Layout): readonly string[];
  layoutKey(view: View, size: Size, style: TextStyle, fontEpoch: number, ctx: AxisContext): readonly unknown[];
  compute(view: View, size: Size, text: { measurer: TextMeasurer; style: TextStyle }, ctx: AxisContext): Layout;
}

export function baseLayoutKey(view: View, size: Size, style: TextStyle, fontEpoch: number, ctx: AxisContext): unknown[] {
  return [size.width, size.height, style.font, style.letterSpacing, style.wordSpacing, style.lineHeight,
    fontEpoch, ctx.locale, ctx.compact, view.kind];
}

export interface Composition {
  readonly kind: ChartType;
  readonly resolve?: typeof resolveOptions;
  /** The frame shape's normalization; the kind is passed back in (the aligned kinds share one). */
  normalize(kind: ChartType, resolved: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): Frame;
  /** Streaming storage for a static frame, opened by the first append. */
  openStore(frame: Frame, source: ResolvedOptions, data: unknown, env: DataEnvironment, kind: ChartType): Store;
  view(frame: Frame, state: ViewState, sink: DiagnosticSink): View;
  readonly layout: LayoutStage;
  readonly timeReadout?: typeof createTimeReadout;
  scene(view: View, layout: Layout, devicePixelRatio: number): Scene;
  readonly lookup: LookupBuilder;
  readonly reader: ReaderParts;
  readonly interaction: InteractionParts;
  /** The handlers for the marks this kind's scenes and overlays can produce. */
  readonly svg: SvgMarks;
}

export function sameKey(a: readonly unknown[] | null, b: readonly unknown[]): boolean {
  if (a === null || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (Object.is(x, y)) continue;
    // Categories are compared by content: a renormalized frame has a new array with the same names.
    if (Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, k) => v === y[k])) continue;
    return false;
  }
  return true;
}
