/**
 * Core option parsing, OHLC/volume validation (`AX180`/`AX181`), normalization, and view stages
 * for opt-in `axylo/finance` (C6.3).
 * Zero edits to `public.ts` and zero bytes added to legacy bundles.
 */
import {
  SLOT_VALUE, type AlignedFrame, type AlignedView, type DiagnosticEffect, type DiagnosticInput,
  type DiagnosticSink, type Series,
} from '../core/contracts';
import type { Composition } from '../core/composition';
import { sameValue } from '../core/options';
import { normalizeAligned, type DataEnvironment, type FrameVersion } from '../data/normalize';
import { resolveOptions, type ChartType, type ResolvedOptions } from '../data/options';
import type { NumberFormatOption } from '../format';
import { createNumberReadout } from '../format/number';
import { buildPlainAlignedView, type AlignedViewState } from '../view';

export type FinanceDiagnosticCode = 'AX180' | 'AX181';

export interface FinanceMeta {
  readonly openField: string;
  readonly highField: string;
  readonly lowField: string;
  readonly closeField: string;
  readonly volumeField: string | null;
  readonly openLabel: string;
  readonly highLabel: string;
  readonly lowLabel: string;
  readonly closeLabel: string;
  readonly volumeLabel: string;
  readonly priceUnit: string | null;
  readonly priceFormat: NumberFormatOption | null;
  readonly priceDomain: readonly [number, number] | null;
  /** `yAxis.label`: the price pane's axis title (null = the generic value title). */
  readonly priceAxisLabel: string | null;
  /** `volumeAxis.label`: the volume pane's axis title (null = the volume field's label). */
  readonly volumeAxisLabel: string | null;
  readonly volumeUnit: string | null;
  readonly volumeFormat: NumberFormatOption | null;
  readonly invalidConfig: boolean;
}

export const FLAG_INVALID_OHLC = 1;
export const FLAG_INCOMPLETE_OHLC = 2;
export const FLAG_INVALID_VOLUME = 4;

/**
 * The meta of the call the controller resolves next. The wrapper sets it before each create or update; the
 * stages never read it while drawing. Layout reads the meta bound to the accepted resolved options, every other
 * stage the meta bound to the frame, so a callback that updates the chart mid-frame (a tick formatter) cannot
 * mix the options of two revisions in one drawn frame.
 */
export interface FinanceStateRef {
  meta: FinanceMeta;
}

export interface FinanceValidationIssue {
  readonly code: FinanceDiagnosticCode;
  readonly field?: string;
  readonly detail: string;
}

export function createFinanceDiagnostic(
  code: FinanceDiagnosticCode,
  effect: DiagnosticEffect,
  details: { readonly field?: string; readonly rows?: readonly number[]; readonly count?: number; readonly detail?: string } = {},
): DiagnosticInput {
  const firstRows = details.rows ? [...new Set(details.rows)].slice(0, 10) : undefined;
  const count = details.count ?? firstRows?.length;
  const sample = firstRows?.length ? ` (rows ${firstRows.join(', ')})` : '';
  const message = code === 'AX180'
    ? details.detail ?? `OHLC data has ${count ?? 0} invalid candle${count === 1 ? '' : 's'} where high < max(open, close) or low > min(open, close)${sample}. Affected candles are omitted and preserved in the table.`
    : details.detail ?? `Field '${details.field ?? 'volume'}' has ${count ?? 0} negative volume value${count === 1 ? '' : 's'}${sample}. Affected volume bars are omitted and preserved in the table.`;
  return {
    code,
    level: 'warning',
    effect,
    origin: 'call',
    message,
    ...(details.field ? { field: details.field } : {}),
    ...(firstRows ? { rows: firstRows } : {}),
    ...(count !== undefined ? { count } : {}),
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function fieldName(spec: unknown): string {
  if (typeof spec === 'string') return spec;
  if (isObj(spec) && typeof spec.field === 'string') return spec.field;
  return '';
}

function fieldLabel(spec: unknown, fallback: string): string {
  if (isObj(spec) && typeof spec.label === 'string' && spec.label.trim()) return spec.label;
  return fallback;
}

export interface ParsedFinance {
  readonly meta: FinanceMeta;
  readonly issues: readonly FinanceValidationIssue[];
  readonly translated: Record<string, unknown>;
}

/** Per-slot flags of one frame: bit 1 = invalid OHLC (AX180), bit 2 = partial/missing OHLC, bit 4 = invalid volume (AX181). */
interface FrameRecord {
  readonly meta: FinanceMeta;
  readonly flags: Uint8Array;
}

let resolvedMetas: WeakMap<object, FinanceMeta> | undefined;
let frameRecords: WeakMap<AlignedFrame, FrameRecord> | undefined;

/** Ties resolved options to the finance meta they were resolved from (the first binding wins). */
export function bindResolved(resolved: object, meta: FinanceMeta): void {
  const map = resolvedMetas ??= new WeakMap();
  if (!map.has(resolved)) map.set(resolved, meta);
}

/** The meta of a revision's resolved options: what layout reads for titles, units and formats. */
export function metaForResolved(stateRef: FinanceStateRef, resolved: object): FinanceMeta {
  return resolvedMetas?.get(resolved) ?? stateRef.meta;
}

function slotFlagsOf(frame: AlignedFrame, meta: FinanceMeta): {
  readonly flags: Uint8Array; readonly ohlcRows: number[]; readonly ohlcCount: number; readonly volRows: number[]; readonly volCount: number;
} {
  const { open, high, low, close, volume } = findOhlcSeries(frame, meta);
  const flags = new Uint8Array(frame.length);
  const ohlcRows: number[] = [];
  const volRows: number[] = [];
  let ohlcCount = 0;
  let volCount = 0;
  if (!open || !high || !low || !close) return { flags, ohlcRows, ohlcCount, volRows, volCount };
  for (let i = 0; i < frame.length; i++) {
    const oOk = open.slot[i] === SLOT_VALUE && Number.isFinite(open.y[i]!);
    const hOk = high.slot[i] === SLOT_VALUE && Number.isFinite(high.y[i]!);
    const lOk = low.slot[i] === SLOT_VALUE && Number.isFinite(low.y[i]!);
    const cOk = close.slot[i] === SLOT_VALUE && Number.isFinite(close.y[i]!);
    if (!oOk || !hOk || !lOk || !cOk) {
      flags[i] = (flags[i]! | FLAG_INCOMPLETE_OHLC);
    } else {
      const o = open.y[i]!, h = high.y[i]!, l = low.y[i]!, c = close.y[i]!;
      if (h < Math.max(o, c) || l > Math.min(o, c)) {
        flags[i] = (flags[i]! | FLAG_INVALID_OHLC);
        ohlcCount++;
        if (ohlcRows.length < 10) {
          const srcRow = open.row ? open.row[i]! : i;
          if (srcRow >= 0) ohlcRows.push(srcRow);
        }
      }
    }
    if (volume && volume.slot[i] === SLOT_VALUE && Number.isFinite(volume.y[i]!) && volume.y[i]! < 0) {
      flags[i] = (flags[i]! | FLAG_INVALID_VOLUME);
      volCount++;
      if (volRows.length < 10) {
        const srcRow = volume.row ? volume.row[i]! : i;
        if (srcRow >= 0) volRows.push(srcRow);
      }
    }
  }
  return { flags, ohlcRows, ohlcCount, volRows, volCount };
}

/**
 * The frame's own record. A frame the controller derived without normalizing (labels or units renamed over the
 * same columns) is recorded when a stage first meets it, which is its view stage inside the same update, with
 * that update's meta; its flags are recomputed from its (borrowed, unchanged) columns.
 */
function recordFor(frame: AlignedFrame, meta: FinanceMeta): FrameRecord {
  const map = frameRecords ??= new WeakMap();
  let record = map.get(frame);
  if (!record) map.set(frame, record = { meta, flags: slotFlagsOf(frame, meta).flags });
  return record;
}

/** The meta a frame was made with: its field names and labels, read by view, scene, lookup and reader. */
export function frameMeta(stateRef: FinanceStateRef, frame: AlignedFrame): FinanceMeta {
  return recordFor(frame, stateRef.meta).meta;
}

export function flagsForFrame(frame: AlignedFrame, meta: FinanceMeta): Uint8Array {
  return recordFor(frame, meta).flags;
}

function keptFormat(given: unknown, before: NumberFormatOption | null | undefined): NumberFormatOption | null {
  const format = (given as NumberFormatOption | undefined) ?? null;
  return before !== undefined && sameValue(before, format) ? before : format;
}

export function parseFinanceInput(input: unknown, previous?: FinanceMeta | null): ParsedFinance {
  const src = isObj(input) ? input : {};
  const issues: FinanceValidationIssue[] = [];
  const yAxis = isObj(src.yAxis) ? src.yAxis : {};
  const volAxis = isObj(src.volumeAxis) ? src.volumeAxis : {};

  const openField = fieldName(src.open);
  const highField = fieldName(src.high);
  const lowField = fieldName(src.low);
  const closeField = fieldName(src.close);
  const volumeField = src.volume !== undefined ? fieldName(src.volume) || null : null;

  const priceUnit = typeof yAxis.unit === 'string' ? yAxis.unit : null;
  // Formats are the snapshot taken where the options were submitted (the chart wrapper's applyPatch): one equal to
  // the accepted one keeps the accepted object, so the layout key, compared by identity, changes with content only.
  const priceFormat = keptFormat(yAxis.format, previous?.priceFormat);
  const priceTickFormat = (yAxis.tickFormat as NumberFormatOption | undefined) ?? null;
  const givenDomain = Array.isArray(yAxis.domain) && yAxis.domain.length === 2
    ? [Number(yAxis.domain[0]), Number(yAxis.domain[1])] as const : null;
  // The same ends keep the same array, so an update that leaves the domain alone keeps the view (and the
  // shared tick labels made for it) instead of looking like a new domain.
  const before = previous?.priceDomain;
  const priceDomain = givenDomain && before && Object.is(before[0], givenDomain[0]) && Object.is(before[1], givenDomain[1])
    ? before : givenDomain;

  const priceAxisLabel = typeof yAxis.label === 'string' && yAxis.label.trim() ? yAxis.label : null;
  const volumeAxisLabel = typeof volAxis.label === 'string' && volAxis.label.trim() ? volAxis.label : null;
  const volumeUnit = typeof volAxis.unit === 'string' ? volAxis.unit : null;
  const volumeFormat = keptFormat(volAxis.format, previous?.volumeFormat);

  const makeSpec = (raw: unknown, name: string, label: string, unit: string | null, format: NumberFormatOption | null, tickFormat: NumberFormatOption | null, includeDomain: boolean) => {
    const base = isObj(raw) ? raw : {};
    return {
      ...base,
      field: name,
      label,
      ...(unit !== null && base.unit === undefined ? { unit } : {}),
      ...(format !== null && base.format === undefined ? { format } : {}),
      ...(tickFormat !== null && base.tickFormat === undefined ? { tickFormat } : {}),
      ...(includeDomain && priceDomain !== null ? { domain: priceDomain } : {}),
    };
  };

  const openLabel = fieldLabel(src.open, 'Open');
  const highLabel = fieldLabel(src.high, 'High');
  const lowLabel = fieldLabel(src.low, 'Low');
  const closeLabel = fieldLabel(src.close, 'Close');
  const volumeLabel = src.volume !== undefined ? fieldLabel(src.volume, 'Volume') : 'Volume';

  const ySpecs: Record<string, unknown>[] = [];
  if (openField) ySpecs.push(makeSpec(src.open, openField, openLabel, priceUnit, priceFormat, priceTickFormat, true));
  if (highField) ySpecs.push(makeSpec(src.high, highField, highLabel, priceUnit, priceFormat, priceTickFormat, false));
  if (lowField) ySpecs.push(makeSpec(src.low, lowField, lowLabel, priceUnit, priceFormat, priceTickFormat, false));
  if (closeField) ySpecs.push(makeSpec(src.close, closeField, closeLabel, priceUnit, priceFormat, priceTickFormat, false));
  if (volumeField) ySpecs.push(makeSpec(src.volume, volumeField, volumeLabel, volumeUnit, volumeFormat, null, false));

  const distinct = new Set([openField, highField, lowField, closeField, ...(volumeField ? [volumeField] : [])].filter(Boolean));
  const expectedCount = volumeField ? 5 : 4;
  if (!openField || !highField || !lowField || !closeField || distinct.size < expectedCount) {
    issues.push({
      code: 'AX180',
      field: 'ohlc',
      detail: 'Candlestick requires four distinct numeric fields: open, high, low, close (plus optional distinct volume).',
    });
  }

  const meta: FinanceMeta = {
    openField, highField, lowField, closeField, volumeField,
    openLabel, highLabel, lowLabel, closeLabel, volumeLabel,
    priceUnit, priceFormat, priceDomain, priceAxisLabel, volumeAxisLabel, volumeUnit, volumeFormat,
    invalidConfig: issues.length > 0,
  };

  const {
    open: _o, high: _h, low: _l, close: _c, volume: _v, yAxis: _ya, volumeAxis: _va,
    ...rest
  } = src;

  const translated: Record<string, unknown> = {
    // Default legend off for OHLC candlesticks (individual O/H/L/C toggles do not map to separate series)
    legend: false,
    ...rest,
    y: ySpecs,
    series: undefined,
  };
  return { meta, issues, translated };
}

export function createFinanceResolver(
  stateRef: FinanceStateRef,
  pendingIssues: { list: readonly FinanceValidationIssue[] },
): Composition['resolve'] {
  return (_kind, options, sink, table): ResolvedOptions => {
    for (const issue of pendingIssues.list) {
      sink.add(createFinanceDiagnostic(issue.code, 'chart-error', { field: issue.field, detail: issue.detail }));
    }
    const resolved = resolveOptions('line', options, sink, table);
    // Resolution runs inside the call the wrapper set the meta for: the binding is that call's revision.
    bindResolved(resolved, stateRef.meta);
    return resolved;
  };
}

export function findOhlcSeries(frame: AlignedFrame, meta: FinanceMeta): {
  open: Series | undefined;
  high: Series | undefined;
  low: Series | undefined;
  close: Series | undefined;
  volume: Series | undefined;
} {
  let open: Series | undefined;
  let high: Series | undefined;
  let low: Series | undefined;
  let close: Series | undefined;
  let volume: Series | undefined;
  for (const s of frame.series) {
    if (s.field === meta.openField) open = s;
    else if (s.field === meta.highField) high = s;
    else if (s.field === meta.lowField) low = s;
    else if (s.field === meta.closeField) close = s;
    else if (meta.volumeField && s.field === meta.volumeField) volume = s;
  }
  return { open, high, low, close, volume };
}

export function normalizeFinance(
  stateRef: FinanceStateRef,
  _kind: ChartType,
  resolved: ResolvedOptions,
  env: DataEnvironment,
  sink: DiagnosticSink,
  version: FrameVersion,
): AlignedFrame {
  const frame = normalizeAligned('line', resolved, env, sink, version);
  bindResolved(resolved, stateRef.meta);
  const meta = metaForResolved(stateRef, resolved);
  const found = slotFlagsOf(frame, meta);
  (frameRecords ??= new WeakMap()).set(frame, { meta, flags: found.flags });

  if (found.ohlcCount > 0) {
    sink.add(createFinanceDiagnostic('AX180', 'omitted', { field: 'ohlc', rows: found.ohlcRows, count: found.ohlcCount }));
  }
  if (found.volCount > 0 && meta.volumeField) {
    sink.add(createFinanceDiagnostic('AX181', 'omitted', { field: meta.volumeField, rows: found.volRows, count: found.volCount }));
  }
  return frame;
}

/** An explicit price domain the price pane can draw as given: two finite, distinct ends (sorted). */
export function explicitPriceDomain(d: readonly [number, number] | null | undefined): readonly [number, number] | null {
  if (!d || !Number.isFinite(d[0]) || !Number.isFinite(d[1]) || d[0] === d[1]) return null;
  return d[0] < d[1] ? [d[0], d[1]] : [d[1], d[0]];
}

/** The price pane's domain when nothing is drawable in view (all-invalid data, a zoom into a gap). */
export const NEUTRAL_PRICE_DOMAIN: readonly [number, number] = [0, 1];
const PRICE_PAD = 0.08;

/**
 * The automatic price domain: the lows and highs of the visible drawable candles and the y references, padded
 * by 8% of their span on each side. Volume never takes part: it has its own pane and scale. A padded lower end
 * that would cross zero for non-negative prices stops at zero, so a positive series never shows negative ticks.
 *
 * Every finite price is drawable, so the ends stay finite: the padding is taken from each end before
 * subtracting (hi - lo overflows for [-1e308, 1e308]), and an end padded past the largest double stops there,
 * which still encloses the data. The linear scale and ticks are overflow-safe for such spans.
 */
export function fitPriceDomain(
  low: Float64Array | Float32Array, high: Float64Array | Float32Array, flags: Uint8Array, start: number, end: number,
  references: readonly { readonly axis: 'x' | 'y'; readonly from: number; readonly to: number }[],
): readonly [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = start; i < end; i++) {
    if ((flags[i]! & (FLAG_INVALID_OHLC | FLAG_INCOMPLETE_OHLC)) !== 0) continue;
    const l = low[i]!;
    const h = high[i]!;
    if (l < lo) lo = l;
    if (h > hi) hi = h;
  }
  for (const ref of references) {
    if (ref.axis !== 'y' || !Number.isFinite(ref.from) || !Number.isFinite(ref.to)) continue;
    lo = Math.min(lo, ref.from, ref.to);
    hi = Math.max(hi, ref.from, ref.to);
  }
  if (!(lo <= hi) || !Number.isFinite(lo) || !Number.isFinite(hi)) return NEUTRAL_PRICE_DOMAIN;
  const pad = lo < hi ? hi * PRICE_PAD - lo * PRICE_PAD : Math.abs(hi) * 0.05 || 1;
  const bottom = lo >= 0 ? Math.max(0, lo - pad) : Math.max(-Number.MAX_VALUE, lo - pad);
  return [bottom, Math.min(Number.MAX_VALUE, hi + pad)];
}

export function buildFinanceView(
  stateRef: FinanceStateRef,
  frame: AlignedFrame,
  state: AlignedViewState,
  sink: DiagnosticSink,
): AlignedView {
  const meta = frameMeta(stateRef, frame);
  // The view state's domain is the accepted options' own (a domain-only update keeps the frame).
  const explicit = explicitPriceDomain(state.valueDomain);
  const base = buildPlainAlignedView(frame, { ...state, valueDomain: explicit }, sink);
  // An explicit domain is drawn exactly as given, through every zoom: no room is borrowed for volume (it has its own pane).
  if (explicit) return { ...base, yDomain: explicit, ...(base.yDomains ? { yDomains: [explicit] } : {}) };
  const { high, low } = findOhlcSeries(frame, meta);
  const flags = flagsForFrame(frame, meta);
  const { start, end } = base.visibleSlots;
  const yDomain = high && low
    ? fitPriceDomain(low.y, high.y, flags, start, end, base.references)
    : fitPriceDomain(new Float64Array(0), new Float64Array(0), flags, 0, 0, base.references);
  return { ...base, yDomain, ...(base.yDomains ? { yDomains: [yDomain] } : {}) };
}

export function formatFinancePrice(meta: FinanceMeta, value: number, locale: string): string {
  const fmt = createNumberReadout({ locale, unit: meta.priceUnit, format: meta.priceFormat });
  return fmt(value);
}

export function formatFinanceVolume(meta: FinanceMeta, value: number, locale: string): string {
  const fmt = createNumberReadout({ locale, unit: meta.volumeUnit, format: meta.volumeFormat });
  return fmt(value);
}
