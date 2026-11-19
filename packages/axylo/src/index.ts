/**
 * Axylo's public entry points. Importing this module touches no DOM, so it loads in Node, where `validate`
 * runs; the chart functions need a document and are only called in a browser.
 */
import type {
  AreaOptions, BarOptions, Chart, Diagnostic, DonutOptions, LineOptions, ScatterOptions, Target,
} from './public.js';
import { staticDiagnostics } from './core/stages';
import { viewerTimeZone } from './core/environment';
import { createChart } from './core/chart';
import { AREA } from './kinds/area';
import { BAR } from './kinds/bar';
import { DONUT } from './kinds/donut';
import { LINE } from './kinds/line';
import { SCATTER } from './kinds/scatter';

export type * from './public.js';

export function line<Row>(target: Target, options: LineOptions<Row>): Chart<Row, LineOptions<Row>> {
  return createChart(LINE, target, options) as unknown as Chart<Row, LineOptions<Row>>;
}

export function area<Row>(target: Target, options: AreaOptions<Row>): Chart<Row, AreaOptions<Row>> {
  return createChart(AREA, target, options) as unknown as Chart<Row, AreaOptions<Row>>;
}

export function bar<Row>(target: Target, options: BarOptions<Row>): Chart<Row, BarOptions<Row>> {
  return createChart(BAR, target, options) as unknown as Chart<Row, BarOptions<Row>>;
}

export function scatter<Row>(target: Target, options: ScatterOptions<Row>): Chart<Row, ScatterOptions<Row>> {
  return createChart(SCATTER, target, options) as unknown as Chart<Row, ScatterOptions<Row>>;
}

export function donut<Row>(target: Target, options: DonutOptions<Row>): Chart<Row, DonutOptions<Row>> {
  return createChart(DONUT, target, options) as unknown as Chart<Row, DonutOptions<Row>>;
}

/**
 * Runs the synchronous stages of a create call without a DOM (option resolution, normalization, the view's
 * domain and series checks, naming) and returns the same call-origin diagnostics a created chart reports
 * (plan 1.6). Each chart type takes its own options, so an option that does not apply does not compile.
 */
export function validate<Row>(type: 'line', options: LineOptions<Row>): Diagnostic[];
export function validate<Row>(type: 'area', options: AreaOptions<Row>): Diagnostic[];
export function validate<Row>(type: 'bar', options: BarOptions<Row>): Diagnostic[];
export function validate<Row>(type: 'scatter', options: ScatterOptions<Row>): Diagnostic[];
export function validate<Row>(type: 'donut', options: DonutOptions<Row>): Diagnostic[];
export function validate(type: 'line' | 'area' | 'bar' | 'scatter' | 'donut', options: unknown): Diagnostic[] {
  return staticDiagnostics(type, options, viewerTimeZone());
}
