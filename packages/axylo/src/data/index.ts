import type { AlignedFrame, DiagnosticSink, DonutFrame, Frame, PointFrame } from '../core/contracts';
import { normalizeHistogram } from './histogram';
import { normalizeAligned, normalizeDonut, normalizePoints, type DataEnvironment, type FrameVersion } from './normalize';
import type { AlignedChartType, ChartType, ResolvedOptions } from './options';

export function normalize(type: AlignedChartType, options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): AlignedFrame;
export function normalize(type: 'scatter', options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): PointFrame;
export function normalize(type: 'donut', options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): DonutFrame;
export function normalize(type: ChartType, options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): Frame;
export function normalize(type: ChartType, options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): Frame {
  if (type === 'histogram') return normalizeHistogram(type, options, env, sink, version);
  if (type === 'donut') return normalizeDonut(options, env, sink, version);
  if (type === 'scatter') return normalizePoints(options, env, sink, version);
  return normalizeAligned(type, options, env, sink, version);
}
export type { DataEnvironment, FrameVersion } from './normalize';
export { resolveOptions } from './options';
export type { AlignedChartType, ChartType, ResolvedOptions, ResolvedValueField, ResolvedXField } from './options';
export { AlignedStore } from './store';
export { DonutStore, PointStore } from './store-unaligned';
export type { OwnedBuffer, OwnedBytes } from './store-bytes';
export type { PreparedFrame, StoreAppendOptions } from './transaction';
export { createXParser } from './x';
export type { XAxisMeta, XPositionParser } from './x';
export { validateOptions } from './validate';
