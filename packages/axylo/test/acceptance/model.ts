import { expect } from 'vitest';
import type { ChartKind } from '../../src/core/controller';
import type { DatumRef, Layout, Mark, TooltipModel, XScale } from '../../src/core/contracts';
import { defaultMessages } from '../../src/messages';
import { valueText } from '../../src/core/focus';
import { lastModel, record, type HostOptions, type Recording } from '../core/host';

export { lastModel, record, type Recording };
export const types = ['line', 'area', 'bar', 'scatter', 'donut', 'compact'] as const;
export const aligned = ['line', 'area', 'bar'] as const;
export const compactKinds = (type: Type) => type === 'compact' ? aligned : ['line'] as const;
export { defaultMessages };
export function message(key: keyof typeof defaultMessages, values: Record<string, string | number> = {}) {
  let text = defaultMessages[key];
  for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
  return text.trim();
}
export type Type = typeof types[number];
export const day = 86_400_000;
export const date = (offset: number) => Date.UTC(2024, 1, 24) + offset * day;

export function chart(type: Type, data: unknown, options: Record<string, unknown> = {}, host?: HostOptions, compactKind: typeof aligned[number] = 'line') {
  const encoding = type === 'donut' ? { label: 'x', value: 'y' } : { x: 'x', y: 'y' };
  const kind: ChartKind = type === 'compact' ? compactKind : type;
  return record(kind, { title: 'Measurements', data, ...encoding, compact: type === 'compact' || undefined, ...options }, host);
}

export function committed(r: Recording) {
  expect(r.committed, 'frame handed to interaction').not.toBeNull();
  return r.committed!;
}

export function plot(r: Recording): Extract<Layout, { kind: 'plot' | 'compact' }> {
  const layout = committed(r).layout;
  if (layout.kind !== 'plot' && layout.kind !== 'compact') throw new Error('Expected a plot, got ' + layout.kind);
  return layout;
}

export function axes(r: Recording) {
  const { projection } = plot(r);
  if (projection.kind === 'ring') throw new Error('Expected Cartesian axes');
  return projection.kind === 'xy' ? { x: projection.x, y: projection.y } : { x: projection.band, y: projection.value };
}

export const pixel = (axis: XScale, x: number) => axis.type === 'band' ? axis.center(x) : axis.map(x);
export const codes = (r: Recording) => r.controller.handle.diagnostics.map(d => d.code);
export const scene = (r: Recording) => r.draws.at(-1)!;
export const marks = <Kind extends Mark['type']>(r: Recording, kind: Kind) =>
  scene(r).marks.filter((mark): mark is Extract<Mark, { type: Kind }> => mark.type === kind);
export const rows = (r: Recording) => {
  const table = committed(r).reader.table;
  expect(table, 'table model handed to interaction').not.toBeNull();
  return Array.from({ length: table!.rowCount }, (_, i) => table!.row(i)!);
};

export function walk(r: Recording, limit = 100) {
  const { lookup } = committed(r);
  const result: DatumRef[] = [];
  for (let ref = lookup.step(null, 'first'); ref !== null; ref = lookup.step(ref, 'next')) {
    if (result.length === limit) throw new Error('Keyboard walk exceeded the expected fixture length');
    result.push(ref);
  }
  return result;
}

export function reading(r: Recording, ref: DatumRef, mode: 'all' | 'single' = 'all') {
  const { view, lookup, formatters, messages } = committed(r);
  return valueText(view, lookup, ref, mode, formatters, messages);
}

export function at(r: Recording, x: number): TooltipModel {
  return committed(r).lookup.tooltip({ kind: 'x', x });
}

export function refAt(r: Recording, x: number): DatumRef {
  const ref = committed(r).lookup.primary({ kind: 'x', x });
  expect(ref, 'readable datum at the fixture x').not.toBeNull();
  return ref!;
}

export function expectValues(r: Recording, x: number, expected: readonly string[]) {
  const tooltip = at(r, x);
  expect(tooltip.rows.map(row => row.value)).toEqual(expected);
  const ref = refAt(r, x);
  for (const value of expected) expect(reading(r, ref)).toContain(value);
}

export function points(xy: Float32Array): [number, number][] {
  const result: [number, number][] = [];
  for (let i = 0; i < xy.length; i += 2) result.push([xy[i]!, xy[i + 1]!]);
  return result;
}

export function pathRuns(xy: Float32Array): [number, number][][] {
  const runs: [number, number][][] = [[]];
  for (const pair of points(xy)) {
    if (Number.isNaN(pair[0])) runs.push([]);
    else runs.at(-1)!.push(pair);
  }
  return runs.filter(run => run.length > 0);
}

export function expectGeometry(actual: readonly number[], expected: readonly number[]) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((number, i) => expect(actual[i]).toBeCloseTo(number, 3));
}

export function expectCompact(r: Recording) {
  expect(committed(r)).toMatchObject({ interactive: false, zoom: false, reader: { table: null } });
  expect(r.texts.at(-1)).toEqual([]);
  expect(r.announcements).toEqual([]);
}

export function seriesRows(size: number) {
  return Array.from({ length: size }, (_, n) => [
    { s: 'Series ' + n, x: 1, y: n + 1 }, { s: 'Series ' + n, x: 2, y: n + 2 },
  ]).flat();
}
