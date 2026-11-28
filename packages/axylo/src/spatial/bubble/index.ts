/**
 * `bubble` and `validateBubble` (Cycle N8b): a scatter whose points are discs with area proportional to a size
 * field. Owned here for the Director's `axylo/spatial` barrel; importing this module runs no code and touches no
 * DOM (every value is a function or a lazily filled WeakMap).
 *
 * - Area-proportional radii (r = max · √(v / largest)), a 1 px hollow marker for a zero size, a `radius.min` floor.
 * - AX187 (warning, omitted): negative or non-finite sizes (NaN included, from rows or typed columns), exact count
 *   and first source rows, rows kept in the table. AX188 (warning): every size is zero. AX189 (hint): more than
 *   10,000 sized bubbles. A missing or invalid size setting: AX150 for `size`, chart-error (options.ts).
 * - Painter's order largest first, smallest on top, across series, drawn exactly as one opaque path per series
 *   holding the visible parts of its discs (paint.ts).
 * - Picking by containment (the bubble painted on top under the pointer), then nearest edge within 24 px.
 */
import type { Diagnostic, Target } from '../../public';
import type { BubbleChart } from '../../spatial';
import { createStaticChart } from '../../core/chart';
import type { ChartHandle } from '../../core/instrument';
import { dedupe, namingDiagnostics, publicOptions, toPublic, viewStateFor } from '../../core/stages';
import { viewerTimeZone } from '../../core/environment';
import { object } from '../../data/options';
import { normalizePoints } from '../../data/normalize';
import { createDiagnostic, DiagnosticCollector } from '../../diagnostics';
import { resolveMessages } from '../../messages';
import { buildScatterView } from '../../view';
import type { Composition } from '../../core/composition';
import { bubbleSnapshot, createBubbleComposition, createBubbleState, resolveWith, type BubbleSnapshot, type BubbleState } from './composition';
import type { LegendModel } from './legend';
import type { BubbleMeta, BubbleOptions } from './options';
import type { TableModel } from '../../core/contracts';
import type { BubbleGeometry } from './geometry';

export type { BubbleOptions, BubbleRadius, SizeField, SizeFieldOptions } from './options';
export type { BubbleSnapshot } from './composition';

export type { BubbleChart } from '../../spatial';

let internals: WeakMap<object, BubbleState> | undefined;

/**
 * Opens a bubble chart with `open` (the browser's static chart, or a recording host in tests), keeping its
 * bubble state reachable from the handle.
 */
export function openBubbleChart(options: unknown, open: (composition: Composition, options: unknown) => ChartHandle): ChartHandle {
  const state = createBubbleState();
  const handle = open(createBubbleComposition(state), options);
  (internals ??= new WeakMap()).set(handle, state);
  return handle;
}

/** Creates a bubble chart. */
export function bubble<Row>(target: Target, options: BubbleOptions<Row>): BubbleChart<Row> {
  return openBubbleChart(options, (composition, input) => createStaticChart(composition, target, input)) as unknown as BubbleChart<Row>;
}

/**
 * What export wiring reads from a bubble chart: the drawn revision's table, legend, size meta and geometry. Each
 * getter reads the same snapshot (bubbleSnapshot), so they never mix an accepted revision with the one shown;
 * `snapshot()` returns it whole for a reader that wants one object.
 */
export interface BubbleInternals {
  readonly revision: number | null;
  snapshot(): BubbleSnapshot | null;
  /** The committed table model, every row reachable through `row(i)` (the reader pages it, export need not). */
  readonly table: TableModel | null;
  readonly legend: LegendModel | null;
  readonly meta: BubbleMeta | null;
  /** The latest drawn geometry (plot px positions, radii, painter's order); its paths come from paintedMap. */
  readonly geometry: BubbleGeometry | null;
}

export function bubbleInternals(chart: object): BubbleInternals | null {
  const state = internals?.get(chart);
  if (!state) return null;
  return {
    get revision() { return bubbleSnapshot(state)?.revision ?? null; },
    snapshot: () => bubbleSnapshot(state),
    get table() { return bubbleSnapshot(state)?.table ?? null; },
    get legend() { return bubbleSnapshot(state)?.legend ?? null; },
    get meta() { return bubbleSnapshot(state)?.meta ?? null; },
    get geometry() { return bubbleSnapshot(state)?.geometry ?? null; },
  };
}

/**
 * The diagnostics a bubble chart reports for these options and data, without a DOM (Node and SSR safe): options,
 * data (sizes included), view and naming, in the order a created chart lists them.
 */
export function validateBubble<Row>(options: BubbleOptions<Row>): Diagnostic[] {
  const input = publicOptions(options);
  const optionSink = new DiagnosticCollector();
  const dataSink = new DiagnosticCollector();
  let name = 'scatter';
  try {
    const resolved = resolveWith(createBubbleState())('scatter', input, optionSink);
    name = resolved.name;
    const frame = normalizePoints(resolved, { timeZone: viewerTimeZone() }, dataSink, { epoch: 1, revision: 1 });
    const viewSink = new DiagnosticCollector();
    const messages = resolveMessages(object(input.messages));
    const state = viewStateFor('scatter', input, resolved, null, null, new Set(), messages);
    buildScatterView(frame, state as never, viewSink);
    const data = dataSink.inputs();
    return toPublic([...dedupe(optionSink.inputs(), data), ...data, ...viewSink.inputs(), ...namingDiagnostics(input)], name);
  } catch {
    return toPublic([...optionSink.inputs(), createDiagnostic('AX199', 'chart-error', {}, 'presentation'), ...namingDiagnostics(input)], name);
  }
}
