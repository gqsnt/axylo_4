/**
 * Axylo's public entry points. Importing this module touches no DOM, so it loads in Node, where `validate`
 * runs; the chart functions need a document and are only called in a browser.
 */
import type {
  AreaOptions, BarOptions, Chart, Diagnostic, DonutOptions, LineOptions, ScatterOptions, Target,
} from './public';
import { createChart } from './core/chart';
import { validateOptions } from './data';
import { createDiagnostic } from './diagnostics';

export type * from './public';

export function line<Row>(target: Target, options: LineOptions<Row>): Chart<Row, LineOptions<Row>> {
  return createChart('line', target, options) as unknown as Chart<Row, LineOptions<Row>>;
}

export function area<Row>(target: Target, options: AreaOptions<Row>): Chart<Row, AreaOptions<Row>> {
  return createChart('area', target, options) as unknown as Chart<Row, AreaOptions<Row>>;
}

export function bar<Row>(target: Target, options: BarOptions<Row>): Chart<Row, BarOptions<Row>> {
  return createChart('bar', target, options) as unknown as Chart<Row, BarOptions<Row>>;
}

export function scatter<Row>(target: Target, options: ScatterOptions<Row>): Chart<Row, ScatterOptions<Row>> {
  return createChart('scatter', target, options) as unknown as Chart<Row, ScatterOptions<Row>>;
}

export function donut<Row>(target: Target, options: DonutOptions<Row>): Chart<Row, DonutOptions<Row>> {
  return createChart('donut', target, options) as unknown as Chart<Row, DonutOptions<Row>>;
}

/** Runs option resolution and normalization only, without a DOM, and returns the diagnostics (plan 1.6). */
export function validate<Row>(type: 'line' | 'area' | 'bar', options: LineOptions<Row> | AreaOptions<Row> | BarOptions<Row>): Diagnostic[];
export function validate<Row>(type: 'scatter', options: ScatterOptions<Row>): Diagnostic[];
export function validate<Row>(type: 'donut', options: DonutOptions<Row>): Diagnostic[];
export function validate(type: 'line' | 'area' | 'bar' | 'scatter' | 'donut', options: unknown): Diagnostic[] {
  const given = options !== null && typeof options === 'object';
  const { __renderer: _renderer, ...rest } = (given ? options : {}) as Record<string, unknown>;
  const found = [...validateOptions(type, given ? rest : options)];
  // The chart raises AX140 when it is created; validate says the same.
  const title = typeof rest.title === 'string' ? rest.title : (rest.title as { text?: unknown } | undefined)?.text;
  const named = (typeof title === 'string' && title !== '') || (typeof rest.labelledBy === 'string' && rest.labelledBy !== '');
  if (!named) {
    const { effect: _e, origin: _o, ...d } = createDiagnostic('AX140', 'none');
    found.push({ ...d, chart: type });
  }
  return found;
}
