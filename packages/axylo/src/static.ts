/**
 * `axylo/static`: the chart functions without streaming storage. The compositions here have no `openStore`
 * and the controller has no stream factory, so none of the stores or the stream session is bundled; a chart
 * is created, updated and zoomed as from `axylo`, and `append()` throws. Importing this module touches no DOM.
 */
import type {
  AreaOptions, BarOptions, Chart, DonutOptions, HistogramOptions, LineOptions, ScatterOptions, Target,
} from './public.js';
import { createStaticChart } from './core/chart';
import { AREA_STATIC } from './kinds/area';
import { BAR_STATIC } from './kinds/bar';
import { DONUT_STATIC } from './kinds/donut';
import { HISTOGRAM_STATIC } from './kinds/histogram';
import { LINE_STATIC } from './kinds/line';
import { SCATTER_STATIC } from './kinds/scatter';

export type * from './public.js';
export { validate } from './index.js';

/** A chart without `append`: the type says what the runtime enforces. */
export type StaticChart<Row, Opts> = Omit<Chart<Row, Opts>, 'append'>;

export function line<Row>(target: Target, options: LineOptions<Row>): StaticChart<Row, LineOptions<Row>> {
  return createStaticChart(LINE_STATIC, target, options) as unknown as StaticChart<Row, LineOptions<Row>>;
}

export function area<Row>(target: Target, options: AreaOptions<Row>): StaticChart<Row, AreaOptions<Row>> {
  return createStaticChart(AREA_STATIC, target, options) as unknown as StaticChart<Row, AreaOptions<Row>>;
}

export function bar<Row>(target: Target, options: BarOptions<Row>): StaticChart<Row, BarOptions<Row>> {
  return createStaticChart(BAR_STATIC, target, options) as unknown as StaticChart<Row, BarOptions<Row>>;
}

export function histogram<Row>(target: Target, options: HistogramOptions<Row>): StaticChart<Row, HistogramOptions<Row>> {
  return createStaticChart(HISTOGRAM_STATIC, target, options) as unknown as StaticChart<Row, HistogramOptions<Row>>;
}

export function scatter<Row>(target: Target, options: ScatterOptions<Row>): StaticChart<Row, ScatterOptions<Row>> {
  return createStaticChart(SCATTER_STATIC, target, options) as unknown as StaticChart<Row, ScatterOptions<Row>>;
}

export function donut<Row>(target: Target, options: DonutOptions<Row>): StaticChart<Row, DonutOptions<Row>> {
  return createStaticChart(DONUT_STATIC, target, options) as unknown as StaticChart<Row, DonutOptions<Row>>;
}
