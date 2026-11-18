/** Every chart kind's composition, by kind: for callers that hold the kind as a value (tests, the Node host). */
import type { Composition } from '../core/composition';
import type { ChartType } from '../data/options';
import { AREA } from './area';
import { BAR } from './bar';
import { DONUT } from './donut';
import { LINE } from './line';
import { SCATTER } from './scatter';

export const COMPOSITIONS: Readonly<Record<ChartType, Composition>> = { line: LINE, area: AREA, bar: BAR, scatter: SCATTER, donut: DONUT };
export { AREA, BAR, DONUT, LINE, SCATTER };
