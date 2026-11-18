import { SLOT_VALUE, type AlignedFrame, type AlignedView, type DonutFrame, type DonutView, type Formatters, type Frame, type Layout, type Projection, type ScatterView } from '../../src/core/contracts';
import { normalize, resolveOptions, type AlignedChartType, type ChartType } from '../../src/data';
import { DiagnosticCollector } from '../../src/diagnostics';
import { createFormatters } from '../../src/format';
import { defaultMessages } from '../../src/messages';

const env = { locale: 'en-US', timeZone: 'UTC' };

export function frame(type: AlignedChartType, options: unknown, revision?: number): AlignedFrame;
export function frame(type: 'scatter', options: unknown, revision?: number): ScatterView['frame'];
export function frame(type: 'donut', options: unknown, revision?: number): DonutFrame;
export function frame(type: ChartType, options: unknown, revision = 1): Frame {
  const sink = new DiagnosticCollector();
  return normalize(type, resolveOptions(type, options, sink), env, sink, { epoch: 1, revision });
}

export function aligned(data: AlignedFrame, patch: Partial<Omit<AlignedView, 'frame'>> = {}): AlignedView {
  const visibleSlots = patch.visibleSlots ?? { start: 0, end: data.length };
  const xDomain = [data.x.values[visibleSlots.start] ?? 0, data.x.values[visibleSlots.end - 1] ?? 1] as const;
  return {
    kind: 'line', frame: data, visible: data.series.map(s => s.drawable), cues: [], compact: false,
    xFull: xDomain, xDomain, yDomain: [0, 100], references: [], horizontal: false, stack: null,
    revision: data.revision, visibleSlots, drawSlots: data.series.map(() => visibleSlots), ...patch,
  };
}

export function scatter(data: ScatterView['frame'], patch: Partial<Omit<ScatterView, 'frame'>> = {}): ScatterView {
  return {
    kind: 'scatter', frame: data, revision: data.revision, visible: data.series.map(s => s.drawable),
    cues: [], compact: false, xFull: [0, 100], xDomain: [0, 100], yDomain: [0, 100], references: [],
    visiblePoints: data.series.map(({ x }) => ({ start: 0, end: x.length })), ...patch,
  };
}

export function donut(data: DonutFrame): DonutView {
  const total = data.values.reduce((sum, value, i) => sum + (data.slot[i] === SLOT_VALUE ? value : 0), 0);
  let last = 0;
  return {
    kind: 'donut', frame: data, revision: data.revision, total,
    slices: data.labels.map((label, i) => {
      const value = data.slot[i] === SLOT_VALUE ? data.values[i]! : null;
      const ratio = value === null ? null : value / total;
      const angles = value ? [last, last += ratio! * 2 * Math.PI] as const : null;
      return { key: label, label, members: [i], value, ratio, angles };
    }),
  };
}

export function plot(projection: Projection, width = 100, height = 100): Extract<Layout, { kind: 'plot' }> {
  const fit = { remedies: [], hidden: 0 } as const;
  return {
    kind: 'plot', width, height, plot: { x: 0, y: 0, width, height }, projection,
    xTicks: [], yTicks: [], texts: [], fit: { x: fit, y: fit },
  };
}

export function formatter(data: Frame): Formatters {
  const x = data.shape === 'aligned' ? data.x
    : { kind: data.shape === 'points' ? data.xKind : 'category', categories: data.shape === 'donut' ? data.labels : null,
      dateUnit: null, timeZone: data.shape === 'points' ? data.timeZone : null } as const;
  const series = data.shape === 'aligned' ? data.series.map(s => ({ field: s.field, unit: s.unit, scale: s.valueScale }))
    : data.shape === 'points' ? data.series.map(() => ({ field: 'y', unit: data.yUnit, scale: null }))
      : [{ field: 'value', unit: data.unit, scale: data.valueScale }];
  return createFormatters({
    series, x: { field: 'x', unit: data.shape === 'points' ? data.xUnit : null, ...x }, messages: defaultMessages,
  }, env);
}
