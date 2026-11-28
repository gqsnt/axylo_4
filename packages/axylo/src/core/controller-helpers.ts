import {
  SLOT_NO_ROW, SLOT_VALUE,
  type DatumRef, type DiagnosticInput, type Formatters, type Frame, type Layout, type Lookup,
  type ReaderModel, type View,
} from './contracts';
import type { Messages, Point, XValue } from '../public';
import type { ResolvedOptions } from '../data/options';
import type { Table } from '../data/table';
import type { FormatSpec } from '../format';
import { dateUnitOf } from '../data/x';
import { repeatsOf } from '../cartesian/repeats';
import { reviseSeries, seriesSlots, slotState } from '../data/store-statistics';
import { createDiagnostic } from '../diagnostics';
import { resolveMessages } from '../messages';
import { seriesNotDrawnSentence } from '../reader';
import type { FigureModel } from '../dom/figure';
import { sameEntry, type Composition } from './composition';
import { sameValue, type OptionRecord } from './options';
import { object, stringOption, type Span } from './stages';
import type { Accepted, Disclosure, Display, Drawn, Held, PresentationStage, StreamSessionHandle } from './controller-types';
import { builtIn, EMPTY_DIAGNOSTICS, INHERIT_LANGUAGE, READY, type FrameState } from './frame-state';

/** AX100 and AX101 describe the supplied data, so they stay with the call that set it. */
export const dataFindings = (list: readonly DiagnosticInput[], data: boolean): DiagnosticInput[] =>
  list.filter(d => (d.code === 'AX100' || d.code === 'AX101') === data);

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
  const kind = axisKind(frame);
  // A Date holds whole milliseconds: a position between them is given as the number zoom() reads the same
  // way, so an event's window can be passed on unchanged (final review, finding 12).
  if (kind === 'time') return Number.isInteger(position) ? new Date(position) : position;
  if ((kind === 'date' || kind === 'wall') && Number.isInteger(position)) {
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

export function positionWindow(frame: Frame, lo: number, hi: number): Span<XValue> {
  return [positionValue(frame, lo), positionValue(frame, hi)];
}

export function axisKind(frame: Frame) {
  return frame.shape === 'aligned' ? frame.x.kind : frame.shape === 'points' ? frame.xKind : undefined;
}

/** Time, date, wall-clock and number positions can be windowed (spec I3). */
export function zoomable(frame: Frame): boolean {
  const kind = axisKind(frame);
  return kind !== undefined && kind !== 'category';
}

function latestX(frame: Frame): number {
  if (frame.shape === 'aligned') return frame.x.values[frame.x.values.length - 1] ?? NaN;
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
export function presentationDiagnostics(presentation: ReadonlyMap<PresentationStage, readonly DiagnosticInput[]> | null | undefined): readonly DiagnosticInput[] {
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
export function followingZoom(a: Accepted, frame: Frame): Span<XValue> | null {
  const view = a.view;
  if (!a.follow || !a.zoom || view.kind === 'donut' || !zoomable(frame)) return a.zoom;
  const width = view.xDomain[1] - view.xDomain[0], latest = latestX(frame);
  return Number.isFinite(latest) && Number.isFinite(width) ? positionWindow(frame, latest - width, latest) : a.zoom;
}

export function canRecoverFields(a: Accepted): boolean {
  return a.options.strict !== true && a.dataOptions.some(d => d.code === 'AX101');
}

/** The window shown, in the form `zoom()` reads (positionValue); null when the whole range is shown. */
export function zoomPayload(a: Accepted): readonly [XValue, XValue] | null {
  const view = a.view;
  if (a.zoom === null || view.kind === 'donut') return null;
  return positionWindow(a.frame, view.xDomain[0], view.xDomain[1]);
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
  const s = view.frame.series;
  return s.length === keys.length && keys.every((k, i) => s[i]!.key === k);
}

export function displayState(a: Accepted, diagnostics: readonly DiagnosticInput[], compact: boolean, failed: boolean): Display {
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
      const table = a.options.table !== false && !compact;
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
  const { frame, resolved, messages } = a;
  const { x, values } = resolved;
  const value = values[0];
  let axis: FormatSpec['x'], series: FormatSpec['series'];
  if (frame.shape === 'donut') {
    axis = { field: x.field, kind: 'category', unit: null, timeZone: null, dateUnit: null, categories: frame.labels };
    series = [{ field: value?.field ?? 'value', unit: frame.unit, scale: frame.valueScale, format: value?.format ?? null }];
  } else {
    const aligned = frame.shape === 'aligned';
    axis = {
      field: x.field, unit: x.unit, scale: x.scale, format: x.format as never,
      kind: aligned ? frame.x.kind : frame.xKind,
      timeZone: aligned ? frame.x.timeZone : frame.timeZone,
      dateUnit: aligned ? frame.x.dateUnit : pointDateUnit(frame, x.field, a.stream),
      categories: aligned ? frame.x.categories : null,
    };
    series = aligned ? frame.series.map(s => ({
      field: s.field, unit: s.unit, scale: s.valueScale,
      format: (values.find(v => v.field === s.field) ?? value)?.format ?? null,
    })) : frame.series.map(() => ({
      field: value?.field ?? 'y', unit: frame.yUnit, scale: value?.scale ?? null, format: value?.format ?? null,
    }));
  }
  return { series, x: axis, locale, messages, onFormatterError };
}

export function formattersKeyOf(spec: FormatSpec, valueCount: number): unknown[] {
  const x = spec.x;
  const key: unknown[] = [spec.locale, x.kind, x.timeZone, x.dateUnit, x.categories, x.format, x.unit, x.scale,
    spec.messages.noData, spec.messages.noObservation, valueCount];
  for (const series of spec.series) key.push(series.field, series.unit, series.scale, series.format);
  return key;
}

export function sameFormatInputs(before: Accepted, after: Accepted): boolean {
  if (before.resolved.x !== after.resolved.x || before.resolved.values !== after.resolved.values ||
      before.messages.noData !== after.messages.noData || before.messages.noObservation !== after.messages.noObservation) return false;
  const a = before.frame, b = after.frame;
  if (a === b) return true;
  if (a.shape === 'aligned' && b.shape === 'aligned') {
    return a.x.kind === b.x.kind && a.x.timeZone === b.x.timeZone && a.x.dateUnit === b.x.dateUnit &&
      a.x.categories === b.x.categories && a.series.length === b.series.length &&
      a.series.every((x, i) => { const y = b.series[i]!; return x.field === y.field && x.unit === y.unit && x.valueScale === y.valueScale; });
  }
  if (a.shape === 'points' && b.shape === 'points') {
    return a.xKind === b.xKind && a.timeZone === b.timeZone && a.yUnit === b.yUnit &&
      a.series.length === b.series.length &&
      pointDateUnit(a, before.resolved.x.field, before.stream) === pointDateUnit(b, after.resolved.x.field, after.stream);
  }
  return a.shape === 'donut' && b.shape === 'donut' &&
    a.labels === b.labels && a.unit === b.unit && a.valueScale === b.valueScale;
}

const NOTE_MESSAGES = ['valuesNotShown', 'valuesChanged', 'labelsHidden'] as const;

function noteLangFor(f: FrameState, disclosure: Disclosure): string | null {
  if (!(disclosure.omitted || disclosure.changed || f.currentHidden)) return null;
  const english = f.english;
  const table = !f.compact && f.a!.options.table !== false;
  let seeTable = false;
  for (const key of NOTE_MESSAGES) {
    const count = key === 'valuesNotShown' ? disclosure.omitted : key === 'valuesChanged' ? disclosure.changed : f.currentHidden;
    if (count > 0) {
      if (!english(key)) return null;
      if (table && f.a!.messages[key].includes('{seeTable}')) seeTable = true;
    }
  }
  return seeTable ? english('seeTable') : 'en';
}

/** A summary ignores the name, caption and hidden-label count. Exact hits also keep the reader and table. */
export function readerInputsMatch(
  k: readonly unknown[], f: FrameState, hidden: number, disclosure: Disclosure, tag: unknown, summary = false,
): boolean {
  const a = f.a!, o = a.options;
  if (k[0] !== f.view || k[1] !== f.formatters || k[2] !== a.messages || k[11] !== f.compact ||
      k[12] !== f.locale || k[7] !== disclosure.omitted || k[8] !== disclosure.changed ||
      !sameEntry(k[5], o.subtitle) || !sameEntry(k[6], o.description)) return false;
  return summary ? sameEntry(k[10], o.table) && sameEntry(k[14], tag)
    : k[10] === o.table && Object.is(k[14], tag) && k[9] === hidden && k[13] === f.caption &&
      k[4] === f.by && sameEntry(k[3], o.title);
}

export function figureModelFor(f: FrameState, disclosure: Disclosure): FigureModel {
  const a = f.a!;
  const shown = f.shown;
  const compact = f.compact;
  const english = f.english;
  const r = f.settled!.reader;
  const ready = shown.kind === 'ready';
  const message = ready ? null : shown.text;
  const messageLang = !ready && shown.message ? english(shown.message) : null;
  const note = shown.kind === 'internal' || shown.kind === 'loading' ? null : r.note;
  const foreign = english !== INHERIT_LANGUAGE;
  const noteLang = foreign ? noteLangFor(f, disclosure) : null;
  // The reader already marked its English runs. On an English page the whole note inherits one language.
  const noteSegments = foreign && note !== null
    ? (r as ReaderModel & Pick<FigureModel, 'noteSegments'>).noteSegments ?? [{ text: note, lang: noteLang }]
    : null;
  const stateMessage = !ready && shown.kind !== 'empty';
  const compactErrorNote = compact && stateMessage && note !== null;
  // A compact chart is one image: its description says what state it is in (C1).
  // Loading and error are not empty (documentation findings 1 and 3): their description is the state, not
  // a reading of data the plot does not show.
  const summary = message === null ? r.summary
    : shown.kind === 'empty' ? (compact ? `${message} ${r.summary}` : r.summary)
    // A compact error still shows the omission marker, whose text equivalent is this description (C5).
    : compactErrorNote ? `${message} ${r.note}` : message;
  const summarySegments = compactErrorNote && noteSegments?.some(run => run.lang !== messageLang)
    ? [{ text: `${message} `, lang: messageLang }, ...noteSegments]
    : null;
  return {
    compact, title: f.by ? null : f.title, labelledBy: f.by, name: r.name || a.name,
    subtitle: stringOption(a.options, 'subtitle'), summary,
    summaryVisible: f.tooSmall, note, message,
    messageLang,
    noteLang,
    // The reader's runs, each in its own language (reader review, finding 5); English is marked only on a
    // page in another language (A10).
    noteSegments,
    // The generated summary's sentences are the built-in templates; the names in them do not change that.
    summaryLang: stateMessage ? messageLang
      : english('chartSummary') && english('seriesSummary') ? 'en' : null,
    summarySegments,
  };
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
  if (ref.kind !== 'slice' && frame.shape === 'aligned') {
    x = positionValue(frame, ref.x);
    const series = frame.series[text.seriesIndex];
    // A Cartesian scatter row at an x it shares: its value is not a slot of the frame, so the lookup reads it.
    if (ref.kind === 'point') y = (d.lookup as { pointValue?: (r: DatumRef) => number | null }).pointValue?.(ref) ?? null;
    else if (series && i >= 0 && slotState(series, i) === SLOT_VALUE) y = series.y[i]!;
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
  for (let i = 0; i < view.frame.series.length; i++) {
    if (!view.visible[i] && !(hidden && view.frame.series[i]!.drawable)) continue;
    if (view.kind === 'scatter') {
      const { start, end } = view.visiblePoints[i]!;
      if (end > start) return true;
      continue;
    }
    const series = view.frame.series[i]!, { start, end } = view.drawSlots[i] ?? view.visibleSlots;
    const more = repeatsOf(series);
    if (more && more.start[end]! > more.start[start]!) return true;
    const slots = seriesSlots(series);
    if (!slots) {
      if (end > start) return true;
    } else {
      // A missing bar still has its no-data glyph at the baseline (spec F2).
      for (let j = start; j < end; j++) {
        const state = slots[j];
        if (state === SLOT_VALUE || (view.kind === 'bar' && state !== SLOT_NO_ROW)) return true;
      }
    }
  }
  return false;
}
