import {
  SLOT_NO_ROW, SLOT_VALUE,
  type DatumRef, type DiagnosticInput, type Formatters, type Frame, type Layout, type Lookup, type PaintBindings,
  type ReaderModel, type ResolvedTheme, type View,
} from './contracts';
import type { Messages, Point, XValue } from '../public';
import type { ChartType, ResolvedOptions } from '../data/options';
import type { Table } from '../data/table';
import type { FormatSpec } from '../format';
import { dateUnitOf } from '../data/x';
import { reviseSeries, seriesSlots, slotState } from '../data/store-statistics';
import { createDiagnostic } from '../diagnostics';
import { resolveMessages } from '../messages';
import { seriesNotDrawnSentence } from '../reader';
import type { FigureModel } from '../dom/figure';
import type { Committed, ControlsState } from '../dom/interaction';
import type { Composition } from './composition';
import { sameValue, type OptionRecord } from './options';
import { isCompact, object, stringOption, type Span } from './stages';
import type { Accepted, Disclosure, Display, Drawn, Held, PresentationStage, ReadoutMode, StreamSessionHandle } from './controller-types';
import { builtIn, EMPTY_DIAGNOSTICS, READY, READER_INPUTS, sameEntry, type FrameState } from './frame-state';

/** AX100 and AX101 describe the supplied data, so they stay with the call that set it. */
export const dataFindings = (list: readonly DiagnosticInput[], data: boolean): DiagnosticInput[] =>
  list.filter(d => (d.code === 'AX100' || d.code === 'AX101') === data);

/**
 * Reader inputs equal apart from the naming ones (sameKey's rule, without filtered copies). The view comes
 * first so a new streaming view ends the comparison early. The title, labelledBy, caption and count of
 * hidden labels do not affect the summary.
 */
export function sameReading(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length || !Object.is(a[0], b[0])) return false;
  for (let i = 1; i < a.length; i++) {
    if (i === 3 || i === 4 || i === 9 || i === 13) continue;
    if (!sameEntry(a[i], b[i])) return false;
  }
  return true;
}

export function lazyLookup(
  composition: Composition, view: View, layout: Layout, formatters: Formatters, messages: Messages,
  locale: string, pixelRatio: number,
): () => Lookup {
  let lookup: Lookup | null = null;
  return () => lookup ??= composition.lookup(view, layout, formatters, messages, locale, pixelRatio);
}

/**
 * An x position in the form `zoom()` and the data read it, so an event's window or `Point.x` can be passed
 * to another chart unchanged (documentation finding 2): a Date for an instant, 'YYYY-MM-DD' for a date, an
 * ISO date-time without offset for a wall-clock time, the category's name, else the number.
 */
export function positionValue(frame: Frame, position: number): XValue {
  if (frame.shape === 'donut') return position;
  const kind = frame.shape === 'points' ? frame.xKind : frame.x.kind;
  // A Date holds whole milliseconds: a position between them is given as the number zoom() reads the same
  // way, so an event's window can be passed on unchanged (final review, finding 12).
  if (kind === 'time') return Number.isInteger(position) ? new Date(position) : position;
  if ((kind === 'date' || kind === 'wall') && Number.isFinite(position)) {
    if (!Number.isInteger(position)) return position;
    const iso = new Date(position).toISOString();
    // Only four-digit years read back as written; others stay positions.
    if (iso.length !== 24) return position;
    // A date is written as one; a position between dates (the padded end of a bar axis) stays a number,
    // which zoom() reads as the same position.
    if (kind === 'date') return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : position;
    // The shortest wall-clock form that keeps the time: seconds and milliseconds only when not zero.
    return iso.endsWith(':00.000Z') ? iso.slice(0, 16) : iso.endsWith('.000Z') ? iso.slice(0, 19) : iso.slice(0, 23);
  }
  if (kind === 'category' && frame.shape === 'aligned') return frame.x.categories?.[position] ?? position;
  return position;
}

/** Whether a window can be set on this frame's x axis: time, date and number axes only in 1.0 (spec I3). */
export function zoomable(frame: Frame): boolean {
  return frame.shape === 'points' || (frame.shape === 'aligned' && frame.x.kind !== 'category');
}

export function isWall(frame: Frame): boolean {
  return frame.shape === 'aligned' ? frame.x.kind === 'wall' : frame.shape === 'points' && frame.xKind === 'wall';
}

function latestX(frame: Frame): number {
  if (frame.shape === 'aligned') return frame.x.values.length ? frame.x.values[frame.x.values.length - 1]! : NaN;
  if (frame.shape === 'points') {
    let latest = -Infinity;
    for (const s of frame.series) {
      if (s.x.length) latest = Math.max(latest, s.x[s.x.length - 1]!);
      // An observation with no y still marks how far the data reaches.
      if (s.missingX) for (let i = 0; i < s.missingX.length; i++) if (Number.isFinite(s.missingX[i]!)) latest = Math.max(latest, s.missingX[i]!);
    }
    return latest;
  }
  return NaN;
}

/** A window that ends at the latest x and does not show everything follows the data (plan 1.5). */
export function followsLatest(view: View, zoom: Span<XValue> | null): boolean {
  if (zoom === null || view.kind === 'donut') return false;
  // The data's own latest position, not the niced or padded edge of the axis (finding 16).
  const latest = latestX(view.frame);
  return Number.isFinite(latest) && view.xDomain[1] >= latest && view.xDomain[0] > view.xFull[0];
}

/** Joins the two findings lists without copying when either list is empty. */
export function joinedDiagnostics(a: readonly DiagnosticInput[], b: readonly DiagnosticInput[]): readonly DiagnosticInput[] {
  return a.length === 0 ? b : b.length === 0 ? a : [...a, ...b];
}

/** The built-in texts, resolved once for every chart that overrides none: resolved messages are only read. */
let builtInMessages: Messages | null = null;

export function messagesOf(option: unknown): Messages {
  if (option === null || typeof option !== 'object') return builtInMessages ??= resolveMessages(null);
  return resolveMessages(option as Partial<Messages>);
}

export function messagesFor(next: OptionRecord, previous: Accepted | null): Messages {
  return previous && sameValue(previous.options.messages, next.messages) ? previous.messages : messagesOf(next.messages);
}

/** AX199 (spec 3.5): Axylo itself failed. */
export function internalFailure(): DiagnosticInput {
  return createDiagnostic('AX199', 'chart-error', {}, 'presentation');
}

/**
 * Every presentation finding once: the same code and field found by two stages (ticks and readouts) is one,
 * the one with an effect on the figure if either has one (a value shown differently keeps its note).
 */
export function presentationDiagnostics(presentation: ReadonlyMap<PresentationStage, readonly DiagnosticInput[]> | null): readonly DiagnosticInput[] {
  if (!presentation || presentation.size === 0) return EMPTY_DIAGNOSTICS;
  if (presentation.size === 1) {
    const only = presentation.values().next().value!;
    if (only.length <= 1) return only.length === 0 ? EMPTY_DIAGNOSTICS : only;
  }
  const seen = new Map<string, DiagnosticInput>();
  for (const list of presentation.values()) {
    for (const d of list) {
      const key = `${d.code}\u0000${d.field ?? ''}`;
      const previous = seen.get(key);
      if (!previous || previous.effect === 'none') seen.set(key, d);
    }
  }
  return [...seen.values()];
}

export function stateDiagnostics(a: Accepted, pending: Held = null): readonly DiagnosticInput[] {
  const o = a.optionDiagnostics, d = pending?.dataDiagnostics ?? a.dataDiagnostics;
  const v = pending?.viewDiagnostics ?? a.viewDiagnostics, n = a.naming;
  const total = o.length + d.length + v.length + n.length;
  if (total === 0) return EMPTY_DIAGNOSTICS;
  if (o.length === total) return o;
  if (d.length === total) return d;
  if (v.length === total) return v;
  if (n.length === total) return n;
  return [...o, ...d, ...v, ...n];
}

/** The window moved to end at the new latest x, keeping its width; null when it cannot follow. */
function followLatest(frame: Frame, before: View): Span<XValue> | null {
  if (before.kind === 'donut' || frame.shape === 'donut') return null;
  if (frame.shape === 'aligned' && frame.x.kind === 'category') return null;
  const span = before.xDomain[1] - before.xDomain[0];
  const latest = latestX(frame);
  if (!Number.isFinite(latest) || !Number.isFinite(span)) return null;
  return [positionValue(frame, latest - span), positionValue(frame, latest)];
}

export function followingZoom(a: Accepted, frame: Frame): Span<XValue> | null {
  return a.follow && a.zoom ? followLatest(frame, a.view) ?? a.zoom : a.zoom;
}

export function canRecoverFields(a: Accepted): boolean {
  return a.options.strict !== true && a.dataOptions.some(d => d.code === 'AX101');
}

/** The window shown, in the form `zoom()` reads (positionValue); null when the whole range is shown. */
export function zoomPayload(a: Accepted): readonly [XValue, XValue] | null {
  const view = a.view;
  if (a.zoom === null || view.kind === 'donut') return null;
  return [positionValue(a.frame, view.xDomain[0]), positionValue(a.frame, view.xDomain[1])];
}

/** Theme bindings per palette slot: series by index; donut slices by their colorIndex (DX6). */
export function themeKeys(view: View): string[] {
  if (view.kind !== 'donut') return view.frame.series.map(s => s.key);
  const keys: string[] = [];
  for (const slice of view.slices) if (slice.colorIndex !== null) keys[slice.colorIndex] = slice.label;
  for (let i = 0; i < keys.length; i++) keys[i] ??= '';
  return keys;
}

export function sameSeriesKeys(view: Exclude<View, { kind: 'donut' }>, keys: readonly string[]): boolean {
  const series = view.frame.series;
  if (series.length !== keys.length) return false;
  for (let i = 0; i < keys.length; i++) if (series[i]!.key !== keys[i]) return false;
  return true;
}

export function displayState(a: Accepted, diagnostics: readonly DiagnosticInput[], chartType: ChartType, failed: boolean): Display {
  const m = a.messages;
  if (failed) return builtIn('internal', m, 'internalError');
  const state = a.options.state;
  if (state === 'loading') return builtIn('loading', m, 'loading');
  if (state && typeof state === 'object') {
    const s = state as { error?: unknown; empty?: unknown };
    for (const kind of ['error', 'empty'] as const) {
      if (!(kind in s)) continue;
      const text = s[kind];
      if (typeof text === 'string' && text !== '') return { kind, text, message: null };
      return builtIn(kind, m, kind);
    }
  }
  // A loop rather than `some`: every frame asks, and most have nothing to scan.
  for (let i = 0; i < diagnostics.length; i++) {
    if (diagnostics[i]!.effect === 'chart-error') return builtIn('error', m, 'error');
  }
  // Series the reader hid are still data: the chart stays ready, so the legend can show them again.
  if (!hasData(a.view, true)) {
    // Nothing drawn because series could not be (AX108: series disabled) is not an empty chart: the figure
    // says which, as the summary does (spec 3.5).
    const undrawn = a.view.kind === 'donut' ? [] : a.view.frame.series.filter(s => !s.drawable);
    if (undrawn.length) {
      const table = a.options.table !== false && !isCompact(chartType, a.options);
      const text = undrawn.map(s => seriesNotDrawnSentence(m, s.label, table)).join(' ');
      return { kind: 'error', text, message: 'seriesNotDrawn' };
    }
    return builtIn('empty', m, 'empty');
  }
  return READY;
}

/**
 * `lang` for an element showing the built-in text of `key`: 'en' when the page is in another language and
 * the author has not replaced that text (spec A10), else null.
 */
export function englishMarker(source: unknown): (key: keyof Messages) => string | null {
  const overrides = object(source);
  return key => typeof overrides[key] !== 'string' ? 'en' : null;
}

export function buildFormatSpec(a: Accepted, locale: string, onFormatterError: (field: string) => void): FormatSpec {
  const { frame, resolved } = a;
  const valueFor = (field: string) => resolved.values.find(v => v.field === field) ?? resolved.values[0];
  const messages = { noData: a.messages.noData, noObservation: a.messages.noObservation };
  if (frame.shape === 'donut') {
    const v = resolved.values[0];
    return {
      series: [{ field: v?.field ?? 'value', unit: frame.unit, scale: frame.valueScale, format: v?.format ?? null }],
      x: { field: resolved.x.field, kind: 'category', unit: null, timeZone: null, dateUnit: null, categories: frame.labels },
      locale, messages, onFormatterError,
    };
  }
  const x = frame.shape === 'aligned'
    ? { kind: frame.x.kind, timeZone: frame.x.timeZone, dateUnit: frame.x.dateUnit, categories: frame.x.categories }
    : { kind: frame.xKind, timeZone: frame.timeZone, dateUnit: pointDateUnit(frame, resolved.x.field, a.stream), categories: null };
  const series = frame.shape === 'aligned'
    ? frame.series.map(s => ({ field: s.field, unit: s.unit, scale: s.valueScale, format: valueFor(s.field)?.format ?? null }))
    : frame.series.map(() => ({ field: resolved.values[0]?.field ?? 'y', unit: frame.yUnit, scale: resolved.values[0]?.scale ?? null, format: resolved.values[0]?.format ?? null }));
  return {
    series, x: { field: resolved.x.field, unit: resolved.x.unit, scale: resolved.x.scale, format: resolved.x.format as never, ...x },
    locale, messages, onFormatterError,
  };
}

export function formattersKeyOf(spec: FormatSpec, valueCount: number): unknown[] {
  return [spec.locale, spec.x.kind, spec.x.timeZone, spec.x.dateUnit, spec.x.categories, spec.x.format, spec.x.unit, spec.x.scale,
    spec.messages.noData, spec.messages.noObservation,
    spec.series.map(s => `${s.field}\u0001${s.unit}\u0001${s.scale}`).join('\u0002'), ...spec.series.map(s => s.format), valueCount];
}

export function sameFormatInputs(before: Accepted, after: Accepted): boolean {
  if (before.resolved.x !== after.resolved.x || before.resolved.values !== after.resolved.values ||
      before.messages.noData !== after.messages.noData || before.messages.noObservation !== after.messages.noObservation) return false;
  const a = before.frame, b = after.frame;
  if (a === b) return true;
  if (a.shape === 'aligned' && b.shape === 'aligned') {
    if (a.x.kind !== b.x.kind || a.x.timeZone !== b.x.timeZone || a.x.dateUnit !== b.x.dateUnit ||
        a.x.categories !== b.x.categories || a.series.length !== b.series.length) return false;
    for (let i = 0; i < a.series.length; i++) {
      const x = a.series[i]!, y = b.series[i]!;
      if (x.field !== y.field || x.unit !== y.unit || x.valueScale !== y.valueScale) return false;
    }
    return true;
  }
  if (a.shape === 'points' && b.shape === 'points') {
    return a.xKind === b.xKind && a.timeZone === b.timeZone && a.yUnit === b.yUnit &&
      a.series.length === b.series.length &&
      pointDateUnit(a, before.resolved.x.field, before.stream) === pointDateUnit(b, after.resolved.x.field, after.stream);
  }
  return a.shape === 'donut' && b.shape === 'donut' &&
    a.labels === b.labels && a.unit === b.unit && a.valueScale === b.valueScale;
}

function noteLangFor(f: FrameState, disclosure: Disclosure): string | null {
  const labelsHidden = f.currentHidden;
  if (disclosure.omitted === 0 && disclosure.changed === 0 && labelsHidden === 0) return null;
  const a = f.a!;
  const english = f.english;
  const shownKeys = [disclosure.omitted > 0 ? 'valuesNotShown' : null, disclosure.changed > 0 ? 'valuesChanged' : null,
    labelsHidden > 0 ? 'labelsHidden' : null].filter((k): k is 'valuesNotShown' | 'valuesChanged' | 'labelsHidden' => k !== null);
  const withTable = a.options.table !== false && !f.compact && shownKeys.some(k => a.messages[k].includes('{seeTable}'));
  const keysList: (keyof Messages)[] = withTable ? [...shownKeys, 'seeTable'] : shownKeys;
  return shownKeys.length > 0 && keysList.every(k => english(k)) ? 'en' : null;
}

function noteRunsFor(f: FrameState, r: ReaderModel, disclosure: Disclosure): { text: string; lang: string | null }[] {
  const runs = (r as ReaderModel & { noteSegments?: readonly { text: string; lang: 'en' | null }[] | null }).noteSegments;
  if (!runs) return [{ text: r.note ?? '', lang: noteLangFor(f, disclosure) }];
  const out = new Array<{ text: string; lang: string | null }>(runs.length);
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    out[i] = { text: run.text, lang: run.lang === 'en' && f.foreignPage ? 'en' : null };
  }
  return out;
}

/** The reader's inputs equal `k` (sameKey's rule), without making the array to compare. */
export function readerInputsMatch(k: readonly unknown[], f: FrameState, labelsHidden: number, disclosure: Disclosure): boolean {
  const a = f.a!;
  const o = a.options;
  return k.length === READER_INPUTS && sameEntry(k[0], f.view) && sameEntry(k[1], f.formatters) &&
    sameEntry(k[2], a.messages) && sameEntry(k[3], o.title) && sameEntry(k[4], f.named ? f.by : null) &&
    sameEntry(k[5], o.subtitle) && sameEntry(k[6], o.description) && sameEntry(k[7], disclosure.omitted) &&
    sameEntry(k[8], disclosure.changed) && sameEntry(k[9], labelsHidden) && sameEntry(k[10], o.table) &&
    sameEntry(k[11], f.compact) && sameEntry(k[12], f.locale) && sameEntry(k[13], f.caption);
}

export function figureModelFor(f: FrameState, r: ReaderModel, small: boolean, disclosure: Disclosure): FigureModel {
  const a = f.a!;
  const shown = f.shown;
  const compact = f.compact;
  const named = f.named;
  const english = f.english;
  const message = shown.kind === 'ready' ? null : shown.text;
  // A compact chart is one image: its description says what state it is in (C1).
  // Loading and error are not empty (documentation findings 1 and 3): their description is the state, not
  // a reading of data the plot does not show.
  const summary = message === null ? r.summary
    : shown.kind === 'empty' ? (compact ? `${message} ${r.summary}` : r.summary) : message;
  return {
    compact, title: named ? null : f.title, labelledBy: named ? f.by : null, name: r.name || a.name,
    subtitle: stringOption(a.options, 'subtitle'), summary,
    summaryVisible: small, note: f.noteShown ? r.note : null, message,
    messageLang: message !== null && shown.kind !== 'ready' && shown.message ? english(shown.message) : null,
    noteLang: noteLangFor(f, disclosure),
    // The reader's runs, each in its own language (reader review, finding 5); English is marked only on a
    // page in another language (A10).
    noteSegments: f.noteShown && r.note !== null ? noteRunsFor(f, r, disclosure) : null,
    // The generated summary's sentences are the built-in templates; the names in them do not change that.
    summaryLang: message !== null && shown.kind !== 'ready' && shown.kind !== 'empty'
      ? (shown.message && english(shown.message) ? 'en' : null)
      : english('chartSummary') && english('seriesSummary') ? 'en' : null,
  };
}

export function controlsStateFor(
  f: FrameState, r: ReaderModel, small: boolean, kind: ChartType, streaming: boolean, paused: boolean,
  readout: boolean, readoutMode: ReadoutMode,
): ControlsState {
  const a = f.a!;
  const shown = f.shown;
  return {
    kind, view: f.view, formatters: f.formatters, messages: a.messages, reader: r, tooSmall: small,
    ready: shown.kind === 'ready', interactive: !f.compact, tooltip: a.options.tooltip !== false, legend: f.legend,
    // Series that could not be drawn are still rows: the table their sentence points to is offered.
    inspectable: (shown.kind === 'empty' || (shown.kind === 'error' && shown.message === 'seriesNotDrawn')) &&
      (r.table?.rowCount ?? 0) > 0,
    empty: shown.kind === 'empty', message: shown.kind === 'ready' ? null : shown.text,
    zoom: f.zoomOn, zoomed: f.zoomed, streaming, paused, epoch: a.frame.epoch, english: f.english, pageLang: f.lang, readout,
    // Decision 0004 revision 3, rule 5, for the interaction layer: 'floating', 'strip' or 'none'.
    readoutMode,
  };
}

/** The controls state with what the frame drew, in one object (the controls' keys first, as before). */
export function committedStateFor(
  f: FrameState, r: ReaderModel, small: boolean, layout: Layout, lookup: Lookup, ratio: number,
  kind: ChartType, streaming: boolean, paused: boolean, readout: boolean, readoutMode: ReadoutMode,
  bindings: PaintBindings, theme: ResolvedTheme,
): Committed {
  const a = f.a!;
  const shown = f.shown;
  return {
    kind, view: f.view, formatters: f.formatters, messages: a.messages, reader: r, tooSmall: small,
    ready: shown.kind === 'ready', interactive: !f.compact, tooltip: a.options.tooltip !== false, legend: f.legend,
    inspectable: (shown.kind === 'empty' || (shown.kind === 'error' && shown.message === 'seriesNotDrawn')) &&
      (r.table?.rowCount ?? 0) > 0,
    empty: shown.kind === 'empty', message: shown.kind === 'ready' ? null : shown.text,
    zoom: f.zoomOn, zoomed: f.zoomed, streaming, paused, epoch: a.frame.epoch, english: f.english, pageLang: f.lang, readout,
    readoutMode,
    layout, lookup, bindings, theme, pixelRatio: ratio,
  };
}

export function readyText(a: Accepted, reader: ReaderModel, byText: string | null): string {
  if (reader.name) return reader.name;
  return byText?.trim() || a.name;
}

/** The public description of a datum, for `hover` and `select`, from the displayed revision. */
export function pointForDatum(d: Drawn, ref: DatumRef): Point<unknown> | null {
  const text = d.lookup.datum(ref);
  if (!text) return null;
  const frame = d.accepted.frame;
  // Where the datum is in its columns, as the lookup located it: values come from the frame, with no search
  // and no second read of the caller's row (re-check, C7 and R6).
  const i = d.lookup.slot(ref);
  let x: XValue = 0;
  let y: number | null = null;
  if (ref.kind === 'aligned' && frame.shape === 'aligned') {
    x = positionValue(frame, ref.x);
    const series = frame.series[text.seriesIndex];
    if (series && i >= 0 && slotState(series, i) === SLOT_VALUE) y = series.y[i]!;
  } else if (ref.kind === 'point' && frame.shape === 'points') {
    const series = frame.series[text.seriesIndex];
    x = positionValue(frame, series && i >= 0 ? series.x[i]! : ref.x);
    if (series && i >= 0) y = series.y[i]!;
  } else if (ref.kind === 'slice' && frame.shape === 'donut') {
    x = text.seriesLabel;
    const at = frame.labels.indexOf(text.seriesLabel);
    if (at >= 0 && frame.slot[at] === SLOT_VALUE) y = frame.values[at]!;
  }
  // The caller's row object, where the event promises it: taken once, through the owned-row accessor. A
  // source that fails now (a row materialized on demand) gives none rather than failing the event.
  let row: unknown = null;
  if (text.row >= 0) {
    try { row = rowOf(frame, text.row, d.accepted.stream); } catch { row = null; }
  }
  return { series: ref.kind === 'slice' ? ref.sliceKey : ref.seriesKey, x, y, row, index: text.row };
}

/** The formatters' environment: their locale, and the viewer's zone read through the chart when first needed. */
export class FormatterEnvironment {
  constructor(readonly locale: string, private readonly zone: { readonly timeZone: string }) {}
  get timeZone(): string { return this.zone.timeZone; }
}

/** Options of a chart that streams from its own store: without the caller's opening data. */
export function streamOptions(o: OptionRecord): OptionRecord {
  if (o.data === undefined) return o;
  const { data: _data, ...rest } = o;
  void _data;
  return rest;
}

/** The same frame with the names and units the resolved fields now give (no value is read again). */
export function renamed(frame: Frame, resolved: ResolvedOptions, revision: number): Frame {
  const value = resolved.values[0];
  if (frame.shape === 'donut') return { ...frame, revision, valueLabel: value?.label ?? frame.valueLabel, unit: value?.unit ?? null };
  if (frame.shape === 'points') {
    return { ...frame, revision, xLabel: resolved.x.label, yLabel: value?.label ?? frame.yLabel, xUnit: resolved.x.unit, yUnit: value?.unit ?? null };
  }
  if (frame.binEdges) return { ...frame, revision, xLabel: resolved.x.label };
  const byField = new Map(resolved.values.map(v => [v.field, v]));
  return {
    ...frame, revision, xLabel: resolved.x.label, yLabel: resolved.values.length === 1 ? value!.label : null,
    series: frame.series.map(s => {
      const v = byField.get(s.field) ?? value;
      if (!v) return s;
      // Named by its field (wide form, or one series without a series field), else by its series value.
      return reviseSeries(s, { unit: v.unit, label: resolved.form === 'wide' || resolved.series === null ? v.label : s.label });
    }),
  };
}

let pointDateUnits: WeakMap<Frame, 'day' | 'month' | 'year'> | undefined;

function rowOf(frame: Frame, row: number, stream: StreamSessionHandle | null): unknown {
  return stream ? stream.row(frame, row) : frame.source.rowAt(row);
}

/**
 * The precision calendar dates were written in on a scatter frame, the finest if mixed ("2024-02" is a month;
 * spec F4). The point frame has no field for it (contracts: only the aligned x column does), so it is read
 * from the caller's rows of the frame, once per frame, through the accessor hover uses (`rowOf`): a frame
 * that kept its own copy after the store moved on reads that copy (verification, defect 5).
 */
function pointDateUnit(
  frame: Extract<Frame, { shape: 'points' }>, field: string, stream: StreamSessionHandle | null,
): 'day' | 'month' | 'year' | null {
  if (frame.xKind !== 'date') return null;
  const known = pointDateUnits?.get(frame);
  if (known) return known;
  let unit: 'day' | 'month' | 'year' = 'year';
  outer: for (const s of frame.series) {
    for (let i = 0; i < s.x.length; i++) {
      const row = rowOf(frame, s.row ? s.row[i]! : i, stream);
      const raw = row !== null && typeof row === 'object' ? (row as Record<string, unknown>)[field] : undefined;
      const u = dateUnitOf(raw);
      if (u === 'day') { unit = 'day'; break outer; }
      if (u === 'month') unit = 'month';
    }
  }
  (pointDateUnits ??= new WeakMap()).set(frame, unit);
  return unit;
}

/** A frame's source that is a whole table (a static frame over the caller's data). */
export function isTable(source: unknown): source is Table {
  const t = source as Partial<Table>;
  return typeof t.isColumnRow === 'function' && typeof t.rowIndex === 'function' && typeof t.length === 'number';
}

/**
 * Whether the view has something to draw, from what the marks use: per series its draw range (a segment
 * that crosses a zoomed window counts), per scatter series its visible points. With `hidden`, series the
 * reader hid count too.
 */
export function hasData(view: View, hidden = false): boolean {
  if (view.kind === 'donut') return view.slices.some(s => s.angles !== null);
  const shown = (i: number) => view.visible[i] || (hidden && view.frame.series[i]!.drawable);
  if (view.kind === 'scatter') {
    return view.frame.series.some((_, i) => shown(i) && view.visiblePoints[i]!.end > view.visiblePoints[i]!.start);
  }
  // A bar with no value is still drawn: its "no data" glyph at the baseline (spec F2; finding 18).
  const drawable = (state: number) => state === SLOT_VALUE || (view.kind === 'bar' && state !== SLOT_NO_ROW);
  return view.frame.series.some((s, i) => {
    if (!shown(i)) return false;
    const { start, end } = view.drawSlots[i] ?? view.visibleSlots;
    const slots = seriesSlots(s);
    if (!slots) return end > start;
    for (let j = start; j < end; j++) if (drawable(slots[j]!)) return true;
    return false;
  });
}
