/**
 * Opt-in financial candlestick (+ optional volume) entry point (`axylo/finance`, C6.3; split panes in N7a).
 *
 * The chart is a price pane over a volume pane with one shared x axis (finance/layout.ts). An explicit
 * `yAxis.domain` is drawn exactly; `yAxis.label` and `volumeAxis.label` title the two value axes. Dense views
 * draw pixel-bin OHLCV aggregates (finance/aggregate.ts) while every readout stays on the raw rows.
 *
 * Admitted by the Campaign 6 C6.3 architecture council:
 * - Zero edits to `public.ts`, zero legacy bundle tax (0 B), 0 raw bytes on bare import.
 * - Validated OHLC envelope (`AX180`) and non-negative volume (`AX181`) with strict-mode rollback.
 * - Colorblind-safe hollow-up / filled-down / horizontal-doji encoding in O(N) batched typed marks.
 * - Exact tooltip, accessible table, keyboard navigation, and summary parity.
 */
import type { CommonOptions, Diagnostic, Reference, Target, ValueField, XField, XValue } from './public.js';
import type { StaticChart } from './static.js';
import { createStaticChart } from './core/chart';
import { namingDiagnostics, toPublic } from './core/stages';
import { resolveOptions } from './data/options';
import { DiagnosticCollector } from './diagnostics/collector';
import { openFinanceChart } from './finance/chart';
import {
  buildFinanceView, createFinanceDiagnostic, normalizeFinance, parseFinanceInput, type FinanceStateRef,
} from './finance/core';

export interface FinanceAxisOptions {
  readonly label?: string;
  readonly unit?: string;
  readonly format?: Intl.NumberFormatOptions | ((value: number) => string);
  readonly tickFormat?: Intl.NumberFormatOptions | ((value: number) => string);
  readonly domain?: readonly [number, number];
}

export interface CandlestickOptions<Row> extends CommonOptions<Row> {
  readonly x: XField<Row>;
  readonly open: ValueField<Row>;
  readonly high: ValueField<Row>;
  readonly low: ValueField<Row>;
  readonly close: ValueField<Row>;
  readonly volume?: ValueField<Row>;
  readonly yAxis?: FinanceAxisOptions;
  readonly volumeAxis?: Omit<FinanceAxisOptions, 'tickFormat' | 'domain'>;
  readonly zoom?: boolean | 'touch';
  readonly reference?: readonly Reference[];
}

/** Creates an opt-in static candlestick (+ optional volume) financial chart. */
export function candlestick<Row>(
  target: Target,
  options: CandlestickOptions<Row>,
): StaticChart<Row, CandlestickOptions<Row>> {
  return openFinanceChart(options, (composition, translated) => createStaticChart(composition, target, translated)) as unknown as
    StaticChart<Row, CandlestickOptions<Row>>;
}

/** Validates `axylo/finance` candlestick options and OHLC/volume data without a DOM (Node/SSR safe). */
export function validateCandlestick<Row>(options: CandlestickOptions<Row>): readonly Diagnostic[] {
  const parsed = parseFinanceInput(options);
  const stateRef: FinanceStateRef = { meta: parsed.meta };
  const sink = new DiagnosticCollector();
  for (const issue of parsed.issues) {
    sink.add(createFinanceDiagnostic(issue.code, 'chart-error', { field: issue.field, detail: issue.detail }));
  }
  const resolved = resolveOptions('line', parsed.translated, sink);
  const frame = normalizeFinance(stateRef, 'line', resolved, { timeZone: 'UTC' }, sink, { epoch: 1, revision: 1 });
  buildFinanceView(stateRef, frame, {
    kind: 'line', hidden: new Set(), zoom: null, xField: resolved.x, xDomain: resolved.x.domain,
    valueDomain: parsed.meta.priceDomain, valueField: resolved.values[0]?.field,
    references: Array.isArray(parsed.translated.reference) ? parsed.translated.reference as never : [],
    previous: null, stacked: false, horizontal: false, compact: false,
  }, sink);
  for (const d of namingDiagnostics(parsed.translated)) sink.add(d);
  return toPublic(sink.inputs(), resolved.name);
}

export type { CommonOptions, Diagnostic, Reference, Target, ValueField, XField, XValue } from './public.js';
export type { StaticChart } from './static.js';
