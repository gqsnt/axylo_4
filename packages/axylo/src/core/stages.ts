/**
 * The DOM-free stages a call runs before anything is drawn (plan 1.5, 1.6): option resolution, the parts of
 * the options that decide what normalization reads, the view state, and the call-origin diagnostics the
 * view and the naming rule add. The chart controller and `validate()` both use these, so a server, a test or
 * a coding agent sees the same findings as a created chart (spec 3.5, DX8).
 */
import type { DiagnosticInput, Frame, View } from './contracts';
import type { Diagnostic, Messages, Title, XValue } from '../public';
import { normalize, resolveOptions, type ChartType, type ResolvedOptions } from '../data';
import { object } from '../data/options';

export { object };
import { createDiagnostic, DiagnosticCollector } from '../diagnostics';
import { buildView, zeroBaseline, type ViewState } from '../view';
import { fill, resolveMessages } from '../messages';
import { sameValue, type OptionRecord } from './options';

export type Span<T = number> = readonly [T, T];

export function titleOf(options: OptionRecord): { text: string; level: number; visible: boolean } | null {
  const raw = options.title;
  // A title of only spaces names nothing (A1): it is absent, so the generated name and AX140 apply.
  if (typeof raw === 'string') return raw.trim() ? { text: raw, level: 3, visible: true } : null;
  const t = object(raw) as Partial<Title>;
  if (typeof t.text !== 'string' || !t.text.trim()) return null;
  const level = typeof t.level === 'number' && t.level >= 2 && t.level <= 6 ? Math.floor(t.level) : 3;
  return { text: t.text, level, visible: t.visible !== false };
}

export function stringOption(options: OptionRecord, key: string): string | null {
  const v = options[key];
  return typeof v === 'string' && v !== '' ? v : null;
}

export function isCompact(kind: ChartType, options: OptionRecord): boolean {
  return (kind !== 'scatter' && kind !== 'donut') && options.compact === true;
}

/** Options without the controller's own keys (the renderer switch). */
export function publicOptions(input: unknown): OptionRecord {
  if (input === null || typeof input !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    const value = (input as Record<string, unknown>)[key];
    // A key set to undefined is a default, as the patch rule reads it on create (finding 14: one path).
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Option keys whose content normalization reads. */
const ENCODING_KEYS = ['x', 'y', 'series', 'label', 'value', 'bins', 'normalize'] as const;
/** Parts of a field spec that only the view, layout or formatting read: changing them never renormalizes. */
const PRESENTATION_PARTS = new Set(['domain', 'format', 'tickFormat']);

function fieldEncoding(spec: unknown, ignore: ReadonlySet<string> = PRESENTATION_PARTS): unknown {
  if (Array.isArray(spec)) return spec.map(item => fieldEncoding(item, ignore));
  // 'day' and { field: 'day' } read the same field.
  if (typeof spec === 'string') return { field: spec };
  if (spec === null || typeof spec !== 'object') return spec;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(spec)) if (!ignore.has(key)) out[key] = (spec as Record<string, unknown>)[key];
  return out;
}

/** True when the field specs differ in something normalization reads (plan 2.2: author domains belong to the view). */
export function encodingChanged(before: OptionRecord, after: OptionRecord): boolean {
  return !namesOnlyChanged(before, after, PRESENTATION_PARTS);
}

/** PRESENTATION_PARTS with the names (a literal: no work at import time). */
const NAMING_PARTS = new Set(['domain', 'format', 'tickFormat', 'label', 'unit']);

/**
 * True when the field specs differ only in labels and units: the values read are the same, so the frame's
 * names can be updated without reading the data again (review 3, finding 12).
 */
export function namesOnlyChanged(before: OptionRecord, after: OptionRecord, ignore = NAMING_PARTS): boolean {
  return ENCODING_KEYS.every(key => sameValue(fieldEncoding(before[key], ignore), fieldEncoding(after[key], ignore)));
}

export function viewStateFor(
  kind: ChartType, options: OptionRecord, resolved: ResolvedOptions, zoom: Span<XValue> | null,
  previous: View | null, hidden: ReadonlySet<string>, messages: Messages,
): ViewState {
  if (kind === 'donut') return { kind, otherLabel: count => fill(messages.otherSlices, { count }), previous };
  const value = resolved.values[0];
  const common = {
    hidden, zoom, xField: resolved.x, xDomain: resolved.x.domain, valueDomain: value?.domain ?? null,
    valueField: value?.field, references: Array.isArray(options.reference) ? options.reference as never : [], previous,
  };
  // Scatter has no frame-level value scale to infer from: the declared one reaches the domain (F7).
  if (kind === 'scatter') return { ...common, kind, valueScale: value?.scale ?? null };
  return {
    ...common, kind,
    stacked: kind === 'area' ? options.stacked === true : kind === 'bar' ? options.layout === 'stacked' : false,
    horizontal: kind === 'bar' && options.horizontal === true,
    compact: isCompact(kind, options),
  };
}

/** What the view depends on; equal keys mean the previous view is still right. */
export function viewKeyFor(
  kind: ChartType, options: OptionRecord, resolved: ResolvedOptions, frame: Frame, zoom: Span<XValue> | null,
  hidden: ReadonlySet<string>, messages: Messages,
): readonly unknown[] {
  return [frame, zoom, [...hidden].sort().join('\u0000'), resolved.x.domain, resolved.values[0]?.domain, options.reference,
    options.stacked, options.layout, options.horizontal, options.compact, kind === 'donut' ? messages.otherSlices : null];
}

/**
 * The view reports AX110, AX130 and AX131 only when they are new against the previous view it reuses. The
 * chart keeps the complete set: a finding the previous view had is kept while its condition still holds.
 */
export function completeViewDiagnostics(
  kind: ChartType, found: readonly DiagnosticInput[], before: readonly DiagnosticInput[], view: View, state: ViewState,
): DiagnosticInput[] {
  const out = [...found];
  if (view.kind === 'donut') return out;
  const has = (code: string) => out.some(d => d.code === code);
  const series = view.frame.series.length;
  const domain = 'valueDomain' in state ? state.valueDomain : null;
  const stillHolds: Record<string, boolean> = {
    AX130: series > 8,
    AX131: view.compact && series > 1,
    AX110: zeroBaseline(kind) && domain !== null && domain !== undefined &&
      domain.every(Number.isFinite) && (Math.min(domain[0], domain[1]) > 0 || Math.max(domain[0], domain[1]) < 0),
  };
  for (const d of before) {
    if (stillHolds[d.code] && !has(d.code)) out.push(d);
  }
  return out;
}

/** AX140 (spec A1): no title and no `labelledBy`. A `labelledBy` that names nothing is checked when drawn. */
export function namingDiagnostics(options: OptionRecord): DiagnosticInput[] {
  if (titleOf(options) !== null || stringOption(options, 'labelledBy') !== null) return [];
  return [createDiagnostic('AX140', 'none')];
}

/** resolveOptions reports AX100 and AX101; normalization may report them again. Keep one copy. */
export function dedupe(options: readonly DiagnosticInput[], data: readonly DiagnosticInput[]): DiagnosticInput[] {
  return options.filter(o => !data.some(d => d.code === o.code && d.field === o.field));
}

export function toPublic(inputs: readonly DiagnosticInput[], chart: string): Diagnostic[] {
  return inputs.map(({ effect: _e, origin: _o, ...d }) => ({ ...d, chart }));
}

/**
 * Everything a create call validates without a DOM, in the order the chart lists it: options, data, view,
 * naming. `validate()` returns this; a created chart reports the same call-origin findings.
 */
export function staticDiagnostics(kind: ChartType, input: unknown, timeZone: string): Diagnostic[] {
  const options = publicOptions(input);
  const optionSink = new DiagnosticCollector();
  const dataSink = new DiagnosticCollector();
  let name: string = kind;
  try {
    const resolved = resolveOptions(kind, options, optionSink);
    name = resolved.name;
    const frame = normalize(kind, resolved, { timeZone }, dataSink, { epoch: 1, revision: 1 });
    const viewSink = new DiagnosticCollector();
    const messages = resolveMessages(object(options.messages));
    const state = viewStateFor(kind, options, resolved, null, null, new Set(), messages);
    buildView(frame as never, state as never, viewSink);
    const data = dataSink.inputs();
    return toPublic([...dedupe(optionSink.inputs(), data), ...data, ...viewSink.inputs(), ...namingDiagnostics(options)], name);
  } catch {
    // A failure inside the stages (an x getter that throws): AX199, as a created chart reports it (finding 14).
    return toPublic([...optionSink.inputs(), createDiagnostic('AX199', 'chart-error', {}, 'presentation'), ...namingDiagnostics(options)], name);
  }
}

export { createDiagnostic };
