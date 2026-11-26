/**
 * Opt-in financial candlestick (+ optional volume) entry point (`axylo/finance`, C6.3).
 *
 * Admitted by the Campaign 6 C6.3 architecture council:
 * - Zero edits to `public.ts`, zero legacy bundle tax (0 B), 0 raw bytes on bare import.
 * - Validated OHLC envelope (`AX180`) and non-negative volume (`AX181`) with strict-mode rollback.
 * - Colorblind-safe hollow-up / filled-down / horizontal-doji encoding in O(N) batched typed marks.
 * - Exact tooltip, accessible table, keyboard navigation, and summary parity.
 */
import type { CommonOptions, Diagnostic, Reference, Target, ValueField, XField, XValue } from './public.js';
import type { StaticChart } from './static.js';
import { alignedLayout } from './core/axes';
import { createStaticChart } from './core/chart';
import type { Composition } from './core/composition';
import { namingDiagnostics, toPublic } from './core/stages';
import { resolveOptions } from './data/options';
import { DiagnosticCollector } from './diagnostics/collector';
import { lineSwatch } from './dom/swatch';
import { createTimeReadout } from './format/time';
import { svgBand, svgPath, svgRects, svgRule } from './render/svg';
import {
  buildFinanceView, createFinanceDiagnostic, createFinanceResolver, normalizeFinance,
  parseFinanceInput, type FinanceStateRef, type FinanceValidationIssue,
} from './finance/core';
import {
  buildFinanceScene, createFinanceLookup, createFinanceOverlay, createFinanceReader,
} from './finance/render';

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

function createFinanceComposition(
  stateRef: FinanceStateRef,
  pendingIssues: { list: readonly FinanceValidationIssue[] },
): Composition {
  return {
    kind: 'line',
    resolve: createFinanceResolver(pendingIssues),
    normalize: ((kind, resolved, env, sink, version) => normalizeFinance(stateRef, kind, resolved, env, sink, version)) as Composition['normalize'],
    view: ((frame, state, sink) => buildFinanceView(stateRef, frame as never, state as never, sink)) as Composition['view'],
    layout: alignedLayout(),
    timeReadout: createTimeReadout,
    scene: (view, lay, dpr) => buildFinanceScene(stateRef, view, lay, dpr),
    lookup: (view, lay, formatters, messages, locale) => createFinanceLookup(stateRef, view, lay, formatters, messages, locale),
    reader: createFinanceReader(stateRef),
    interaction: { overlay: createFinanceOverlay(stateRef), swatch: lineSwatch, stepInSeries: null, sliceList: null },
    svg: { band: svgBand, path: svgPath, rects: svgRects, rule: svgRule },
  };
}

/** Creates an opt-in static candlestick (+ optional volume) financial chart. */
export function candlestick<Row>(
  target: Target,
  options: CandlestickOptions<Row>,
): StaticChart<Row, CandlestickOptions<Row>> {
  let currentRaw: Record<string, unknown> = options && typeof options === 'object' ? { ...options } : {};
  const parsed = parseFinanceInput(currentRaw);
  const stateRef: FinanceStateRef = { meta: parsed.meta };
  const pendingIssues = { list: parsed.issues };
  const inner = createStaticChart(createFinanceComposition(stateRef, pendingIssues), target, parsed.translated);

  return {
    update(patch) {
      const prevRaw = currentRaw;
      const prevMeta = stateRef.meta;
      const prevIssues = pendingIssues.list;
      if (patch && typeof patch === 'object') currentRaw = { ...currentRaw, ...patch };
      const next = parseFinanceInput(currentRaw, prevMeta);
      stateRef.meta = next.meta;
      pendingIssues.list = next.issues;
      try {
        inner.update(next.translated);
      } catch (err) {
        currentRaw = prevRaw;
        stateRef.meta = prevMeta;
        pendingIssues.list = prevIssues;
        throw err;
      }
    },
    zoom(range) { inner.zoom(range as never); },
    on(event, listener) { return inner.on(event as never, listener as never); },
    get diagnostics() { return inner.diagnostics; },
    destroy() { inner.destroy(); },
  };
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
