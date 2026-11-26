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
  readonly volumeUnit: string | null;
  readonly volumeFormat: NumberFormatOption | null;
  readonly invalidConfig: boolean;
  /** Per-slot status flags populated during normalization: bit 1 = invalid OHLC (AX180), bit 2 = partial/missing OHLC, bit 4 = invalid volume (AX181). */
  slotFlags: Uint8Array;
}

export const FLAG_INVALID_OHLC = 1;
export const FLAG_INCOMPLETE_OHLC = 2;
export const FLAG_INVALID_VOLUME = 4;

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

export function parseFinanceInput(input: unknown): ParsedFinance {
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
  const priceFormat = (yAxis.format as NumberFormatOption | undefined) ?? null;
  const priceTickFormat = (yAxis.tickFormat as NumberFormatOption | undefined) ?? null;
  const priceDomain = Array.isArray(yAxis.domain) && yAxis.domain.length === 2
    ? [Number(yAxis.domain[0]), Number(yAxis.domain[1])] as const : null;

  const volumeUnit = typeof volAxis.unit === 'string' ? volAxis.unit : null;
  const volumeFormat = (volAxis.format as NumberFormatOption | undefined) ?? null;

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
    priceUnit, priceFormat, priceDomain, volumeUnit, volumeFormat,
    invalidConfig: issues.length > 0,
    slotFlags: new Uint8Array(0),
  };

  const {
    open: _o, high: _h, low: _l, close: _c, volume: _v, yAxis: _ya, volumeAxis: _va,
    ...rest
  } = src;

  const translated: Record<string, unknown> = {
    ...rest,
    y: ySpecs,
    series: undefined,
  };
  return { meta, issues, translated };
}

export function createFinanceResolver(
  pendingIssues: { list: readonly FinanceValidationIssue[] },
): Composition['resolve'] {
  return (_kind, options, sink, table): ResolvedOptions => {
    for (const issue of pendingIssues.list) {
      sink.add(createFinanceDiagnostic(issue.code, 'chart-error', { field: issue.field, detail: issue.detail }));
    }
    return resolveOptions('line', options, sink, table);
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
  const { meta } = stateRef;
  const { open, high, low, close, volume } = findOhlcSeries(frame, meta);
  const flags = new Uint8Array(frame.length);
  meta.slotFlags = flags;

  if (!open || !high || !low || !close) return frame;

  const invalidOhlcRows: number[] = [];
  let invalidOhlcCount = 0;
  const invalidVolRows: number[] = [];
  let invalidVolCount = 0;

  for (let i = 0; i < frame.length; i++) {
    const oOk = open.slot[i] === SLOT_VALUE && Number.isFinite(open.y[i]!);
    const hOk = high.slot[i] === SLOT_VALUE && Number.isFinite(high.y[i]!);
    const lOk = low.slot[i] === SLOT_VALUE && Number.isFinite(low.y[i]!);
    const cOk = close.slot[i] === SLOT_VALUE && Number.isFinite(close.y[i]!);
    if (!oOk || !hOk || !lOk || !cOk) {
      flags[i] = (flags[i]! | FLAG_INCOMPLETE_OHLC);
    } else {
      const o = open.y[i]!, h = high.y[i]!, l = low.y[i]!, c = close.y[i]!;
      const bodyMax = Math.max(o, c);
      const bodyMin = Math.min(o, c);
      if (h < bodyMax || l > bodyMin) {
        flags[i] = (flags[i]! | FLAG_INVALID_OHLC);
        invalidOhlcCount++;
        if (invalidOhlcRows.length < 10) {
          const srcRow = open.row ? open.row[i]! : i;
          if (srcRow >= 0) invalidOhlcRows.push(srcRow);
        }
      }
    }
    if (volume && volume.slot[i] === SLOT_VALUE && Number.isFinite(volume.y[i]!) && volume.y[i]! < 0) {
      flags[i] = (flags[i]! | FLAG_INVALID_VOLUME);
      invalidVolCount++;
      if (invalidVolRows.length < 10) {
        const srcRow = volume.row ? volume.row[i]! : i;
        if (srcRow >= 0) invalidVolRows.push(srcRow);
      }
    }
  }

  if (invalidOhlcCount > 0) {
    sink.add(createFinanceDiagnostic('AX180', 'omitted', {
      field: 'ohlc',
      rows: invalidOhlcRows,
      count: invalidOhlcCount,
    }));
  }
  if (invalidVolCount > 0 && meta.volumeField) {
    sink.add(createFinanceDiagnostic('AX181', 'omitted', {
      field: meta.volumeField,
      rows: invalidVolRows,
      count: invalidVolCount,
    }));
  }

  return frame;
}

export function buildFinanceView(
  stateRef: FinanceStateRef,
  frame: AlignedFrame,
  state: AlignedViewState,
  sink: DiagnosticSink,
): AlignedView {
  const { meta } = stateRef;
  const base = buildPlainAlignedView(frame, { ...state, valueDomain: meta.priceDomain }, sink);
  const { high, low } = findOhlcSeries(frame, meta);
  const flags = meta.slotFlags;

  if (meta.priceDomain && meta.priceDomain.every(Number.isFinite)) {
    return { ...base, yDomain: [meta.priceDomain[0], meta.priceDomain[1]] };
  }

  // Compute yDomain strictly from valid OHLC price candles (never distorted by volume magnitude!)
  let pMin = Infinity;
  let pMax = -Infinity;
  const { start, end } = base.visibleSlots;
  const scan = (lo: number, hi: number) => {
    if (!high || !low) return;
    for (let i = lo; i < hi; i++) {
      if ((flags[i]! & (FLAG_INVALID_OHLC | FLAG_INCOMPLETE_OHLC)) !== 0) continue;
      const h = high.y[i]!;
      const l = low.y[i]!;
      if (l < pMin) pMin = l;
      if (h > pMax) pMax = h;
    }
  };
  scan(start, end);
  if (!(pMin <= pMax)) scan(0, frame.length);

  for (const ref of base.references) {
    if (ref.axis === 'y') {
      pMin = Math.min(pMin, ref.from, ref.to);
      pMax = Math.max(pMax, ref.from, ref.to);
    }
  }

  if (!(pMin <= pMax)) return base;
  const span = pMax - pMin;
  const pad = span > 0 ? span * 0.08 : Math.max(1, Math.abs(pMax) * 0.05);
  // Reserve extra bottom headroom (~28% of span) when volume panel is enabled so bars never obscure candles.
  const bottomPad = meta.volumeField ? Math.max(pad, (span > 0 ? span : pad * 2) * 0.34) : pad;
  return {
    ...base,
    yDomain: [pMin - bottomPad, pMax + pad],
  };
}

export function formatFinancePrice(meta: FinanceMeta, value: number, locale: string): string {
  const fmt = createNumberReadout({ locale, unit: meta.priceUnit, format: meta.priceFormat });
  return fmt(value);
}

export function formatFinanceVolume(meta: FinanceMeta, value: number, locale: string): string {
  const fmt = createNumberReadout({ locale, unit: meta.volumeUnit, format: meta.volumeFormat });
  return fmt(value);
}
