The current declarations pass `tsc --noEmit`. The cumulative replacements below also type-check in memory. Apply the blocks together. Findings 1–13 change `contracts.ts`. Finding 14 changes `public.ts`.

### 1. Frame storage forces dense copies and loses stable provenance

**Inferred.** Long-form data with disjoint x values costs one y value, state, and row index per *series × distinct x*. Sorted `Float32Array` x columns and scatter y columns require widening. Contiguous arrays also force copying when an append exceeds the backing capacity or a retained window wraps. Use borrowed or chunked columns, implicit identity maps, and sparse series. Keep duplicate entries in the Frame for the table while disabling the affected series for AX108. This blocks DX2, F11, A4, P2, P3, P7, and plan §2.1. [Frame declarations](/home/canarit/projects/axylo/packages/axylo/src/core/contracts.ts:50)

Replace the import and the declarations from `Series` through `Frame`. Finding 6 replaces `XColumn`.

```ts
import type { Diagnostic, Title, ValueFieldOptions, XFieldOptions, XValue } from '../public';

export interface IndexRange {
  readonly start: number;
  readonly end: number; // exclusive
}

export type ColumnSpan<T> =
  | { readonly kind: 'array'; readonly values: ArrayLike<T>;
      readonly offset: number; readonly length: number }
  | { readonly kind: 'computed'; readonly length: number; at(index: number): T };

export interface Column<T> {
  readonly length: number;
  at(index: number): T; // valid zero-based indexes only
  /** One span per storage block, in logical order. Views share their backing data. */
  spans(range: IndexRange): Iterable<ColumnSpan<T>>;
}

export type RowIndex =
  | { readonly kind: 'identity'; readonly first: number }
  | { readonly kind: 'mapped'; readonly indices: Column<number> };

export interface SourceRows<Row> {
  readonly revision: number;
  /** Retained source indexes in input order. Can be an implicit range. */
  readonly retained: Column<number>;
  /** Index of the next appended source row, unaffected by keep. */
  readonly nextIndex: number;
  /** Returns null for an unretained row. Column input can materialize a row on demand. */
  rowAt(sourceIndex: number): Row | null;
  /** Column-form storage in retained source order. Null for row input or an absent field. */
  column(field: string): Column<unknown> | null;
}

export interface FieldMeta {
  readonly field: string;
  readonly label: string;
  readonly unit: string | null;
}

export interface ValueMeta extends FieldMeta {
  readonly scale: 'percent' | 'ratio' | null;
  readonly missing: 'gap' | 'zero';
  readonly format: ValueFieldOptions['format'];
  readonly tickFormat: ValueFieldOptions['tickFormat'];
}

export interface ValueColumn {
  readonly field: ValueMeta;
  /** Borrowed or owned. Values outside SLOT_VALUE are ignored. */
  readonly y: Column<number>;
  readonly states: Column<ObservedState> | null; // null means all stored samples are valid
  readonly rows: RowIndex;
}

export interface Series extends ValueColumn {
  readonly key: string;
  readonly label: string;
  readonly drawable: boolean;
  /** Null for dense alignment. Sparse slots are sorted and can repeat on AX108. */
  readonly slots: Column<number> | null;
  /** First expected but absent slot in the range, or -1. Can use implicit intervals. */
  readonly missingSteps: { first(range: IndexRange): number } | null;
}

export interface PointSeries extends ValueColumn {
  readonly key: string;
  readonly label: string;
  readonly drawable: boolean;
  readonly x: XColumn<ContinuousXAxis>; // stored observations sorted by x, then y
}

export interface FrameBase<Row> {
  readonly revision: number;
  /** Changes when source or identity fields are replaced. Survives append and eviction. */
  readonly epoch: number;
  readonly source: SourceRows<Row>;
  readonly unplacedRows: Column<number> | null; // e.g. bad x, retained for provenance
  readonly disclosure: ReaderDisclosure;
}

export interface AlignedFrame<Row = unknown> extends FrameBase<Row> {
  readonly shape: 'aligned';
  readonly x: XColumn;
  readonly series: readonly Series[];
  readonly yTitle: string | null;
  /** Maps observed x ordinals to slots if the axis also has generated steps. */
  readonly observedSlots: Column<number> | null;
}

export interface PointFrame<Row = unknown> extends FrameBase<Row> {
  readonly shape: 'points';
  readonly xAxis: ContinuousXAxis;
  readonly yField: ValueMeta;
  readonly series: readonly PointSeries[];
}

export type Frame<Row = unknown> = AlignedFrame<Row> | PointFrame<Row> | DonutFrame<Row>;
```

### 2. One revision cannot serve synchronous calls and deferred presentation

**Inferred.** `Frame.revision` and `View.revision` give each module a version, but give the chart no shared publication boundary. An append can advance hit testing while the old marks are on screen, or alter a buffer still used by the old revision before a strict call rejects. Keep an accepted data head and publish one presentation bundle per frame. While paused, advance the accepted head and keep the displayed Frame frozen for appends. `latest` follows the new edge on resume and `fixed` preserves the requested window. This blocks DX5, I6, A7, P3, and plan §1.5. [Commit rules](/home/canarit/projects/axylo/docs/03-plan-typescript-release.md:120)

I use `keep` to count distinct **observed** x values. Source indexes refer to the logical input sequence since the last data replacement, before sorting or eviction. Borrowed buffers follow the plan’s caller immutability rule. An append shares sealed chunks and can copy the open chunk. [Ownership and provenance](/home/canarit/projects/axylo/docs/03-plan-typescript-release.md:53)

```ts
export type ChartChange<Row, Options> =
  | { readonly kind: 'update'; readonly patch: Partial<Options> }
  | { readonly kind: 'append'; readonly rows: readonly Row[]; readonly keep?: number }
  | { readonly kind: 'zoom'; readonly domain: readonly [XValue, XValue] | null }
  | { readonly kind: 'pause' | 'resume' }
  | { readonly kind: 'toggle'; readonly key: string };

export type ZoomState =
  | { readonly kind: 'full' }
  | { readonly kind: 'fixed'; readonly domain: Domain }
  | { readonly kind: 'latest'; readonly span: number };

export type StreamState<Row> =
  | { readonly kind: 'unused' | 'live' }
  | { readonly kind: 'paused'; readonly frozenFrame: Frame<Row> | null };

export interface AcceptedRevision<Row, Options> {
  readonly revision: number;
  readonly options: Readonly<Omit<Options, 'data'>>;
  readonly source: SourceRows<Row>;
  readonly frame: Frame<Row> | null; // accepted data head, even during pause
  readonly diagnostics: readonly Diagnostic[];
  readonly stream: StreamState<Row>;
  readonly hidden: ReadonlySet<string>;
  readonly zoom: ZoomState;
}

export interface PresentedRevision<Row> {
  readonly revision: number; // accepted revision used to build this presentation
  readonly view: View<Row> | null;
  readonly layout: Layout;
  readonly scene: Scene | null;
  readonly lookup: Lookup<Row> | null;
  readonly readers: ReaderModel;
  readonly presentationDiagnostics: readonly DiagnosticInput[];
  readonly focus: DatumRef | null;
}

export interface CommitState<Row, Options> {
  readonly accepted: AcceptedRevision<Row, Options>;
  readonly presented: PresentedRevision<Row> | null;
}
```

### 3. Missing-value policy erases information the readers need

**Inferred.** `SLOT_INVALID` merges an absent field with a malformed value. Once normalized, `missing: 'zero'` cannot distinguish the eligible absence from an infinity or stray string. Keep the observed state and the effective value. Derive `NO_ROW` and `GAP` from sparse alignment and expected steps. With the default policy, only `NO_ROW` is traversable between valid samples. A sample with no joined neighbor gets a point mark. `NO_ROW` reads “No observation” under I1. This affects F2, F3, I1, DX2, AX102, AX104, and AX105. [Slot states](/home/canarit/projects/axylo/packages/axylo/src/core/contracts.ts:42) · [Diagnostic registry](/home/canarit/projects/axylo/docs/02-product-spec.md:148)

I use the plan’s typed-column `NaN` sentinel as the equivalent of row `null`. A row `NaN` is AX103. DX2 equivalence under that convention compares logical missing values. Raw `NaN` parity across the two forms would require a different input encoding or registry rule. [Typed-column missing convention](/home/canarit/projects/axylo/docs/03-plan-typescript-release.md:55)

```ts
export const SLOT_VALUE = 0;
export const SLOT_NULL = 1;
export const SLOT_INVALID = 2;
export const SLOT_NO_ROW = 3;
export const SLOT_GAP = 4;
export const SLOT_ABSENT_FIELD = 5; // AX102
export const SLOT_EMPTY = 6; // empty string in AX104 missing-value handling

export type ObservedState = 0 | 1 | 2 | 5 | 6;
export type SlotState = ObservedState | typeof SLOT_NO_ROW | typeof SLOT_GAP;

export type ResolvedSlot =
  | { readonly state: typeof SLOT_VALUE; readonly value: number }
  | { readonly state: typeof SLOT_INVALID | typeof SLOT_NO_ROW; readonly value: null }
  | { readonly state: typeof SLOT_NULL | typeof SLOT_GAP |
                     typeof SLOT_ABSENT_FIELD | typeof SLOT_EMPTY;
      /** Zero only where the field's explicit missing policy applies. */
      readonly value: 0 | null };
```

### 4. F5 needs device-pixel input and independently sampled area boundaries

**Inferred.** `PathMark` can express multiple runs in one column with its existing NaN separator. The builder has no shared device-pixel coordinate input, and Float32 can round a vertex across a column boundary. `AreaMark` forces matching x samples on both edges. Independent extrema then require a union of sample indexes, and neighboring bands can approximate their shared edge differently. Allow each edge to retain its own extrema, reuse the packed shared edge, and close each run along its lower edge in reverse. Each run’s edges share x endpoints. Split runs at gaps and at sign changes where the band needs separate lobes. This affects F5, F10, C2, P2, P7, and plan §2.3. [Path and area marks](/home/canarit/projects/axylo/packages/axylo/src/core/contracts.ts:262) · [Simplification rule](/home/canarit/projects/axylo/docs/03-plan-typescript-release.md:210)

I interpret F5’s extrema as a guarantee on the emitted centerline and area boundaries. A literal break at every unsampled column would also cut legal F2 joins across `SLOT_NO_ROW`; the acceptance test needs a shared rule for that case. Plan §2.3 explicitly allows an O(visible) simplification pass and bounds drawing by device columns **and** run count. Alternating valid and missing samples can produce O(n) runs. [F5 and F2](/home/canarit/projects/axylo/docs/02-product-spec.md:95)

```ts
export interface DashStyle {
  readonly normal: readonly number[] | null;
  readonly highContrast: readonly number[] | null;
}

export interface PathMark {
  readonly type: 'path';
  readonly series: number;
  readonly xy: Float64Array; // CSS px; a NaN pair starts a new subpath
  readonly stroke: Paint;
  readonly strokeWidth: number;
  readonly dash: DashStyle;
}

export interface AreaMark {
  readonly type: 'area';
  readonly series: number;
  /** Packed xy pairs. Adjacent stack bands can share a boundary buffer. */
  readonly upper: Float64Array;
  readonly lower: Float64Array;
  /** Quadruples: upper start/count, lower start/count, in vertices. */
  readonly runs: Uint32Array;
  readonly fill: Paint;
  readonly opacity: number;
}

export interface RasterGeometry {
  readonly devicePixelRatio: number;
  /** Device-pixel x coordinate of CSS x = 0 on the rendering surface. */
  readonly deviceXOrigin: number;
}

export type RetainedSample = (
  series: number, boundary: 'line' | 'upper' | 'lower', slot: number,
  column: number, run: number
) => void;

export interface SceneBuilder {
  build<Row>(
    view: View<Row>, layout: PlotLayout, raster: RasterGeometry,
    onRetained?: RetainedSample
  ): Scene;
}
```

### 5. The View conflates visible slots with line guards and lacks signed boundaries

**Inferred.** Widening a global range by one slot can select an offscreen tooltip target and still miss the nearest joinable endpoint of a sparse series. `stack.lo/hi` can describe each bar segment, but gives stacked-area builders no shared positive and negative cumulative boundaries. Rebuilding full-width arrays on append also repeats unaffected work. Use exact visible ranges, per-series drawing guards, and chunkable signed cumulative boundaries. A missing component contributes zero height and retains the incomplete flag. Reference positions belong here so domains, marks, and reader captions use the same normalization. This affects F1, F2, F7, F10, I1, §3.6, P3, and plan §2.1. [View declaration](/home/canarit/projects/axylo/packages/axylo/src/core/contracts.ts:174)

```ts
export type Domain = readonly [number, number];

export interface ResolvedReference {
  readonly axis: 'x' | 'y';
  readonly positions: readonly [number] | Domain;
  readonly label: string;
}

export interface SeriesCue {
  readonly marker: MarkerShape;
  readonly dash: DashStyle;
}

export interface StackSide {
  /** Boundary j and j+1 enclose component j on this side of zero. */
  readonly cumulative: readonly Column<number>[];
  readonly total: Column<number>;
}

export interface StackView {
  /** Frame series indices in accumulation order. */
  readonly seriesOrder: readonly number[];
  readonly positive: StackSide;
  readonly negative: StackSide;
  readonly incomplete: Column<0 | 1> | null; // null means complete
}

export interface CartesianView<F> {
  readonly frame: F;
  readonly revision: number;
  readonly visible: readonly boolean[];
  readonly cues: readonly SeriesCue[];
  readonly xFull: Domain;
  readonly xDomain: Domain;
  readonly yDomain: Domain;
  readonly references: readonly ResolvedReference[];
}

export interface AlignedView<Row = unknown> extends CartesianView<AlignedFrame<Row>> {
  readonly kind: 'line' | 'area' | 'bar';
  readonly horizontal: boolean; // true only for horizontal bars
  readonly compact: boolean;
  readonly visibleSlots: IndexRange;
  /** Stored entry ranges per series, with its own joinable edge samples. */
  readonly drawEntries: readonly IndexRange[];
  readonly stack: StackView | null;
}

export interface ScatterView<Row = unknown> extends CartesianView<PointFrame<Row>> {
  readonly kind: 'scatter';
  readonly visibleEntries: readonly IndexRange[];
}

export type View<Row = unknown> = AlignedView<Row> | ScatterView<Row> | DonutView<Row>;
```

### 6. A temporal position cannot recover the original readout

**Inferred.** One column-wide `dateUnit` loses the distinction between inputs such as `2026` and `2026-01-01`. A numeric wall-clock position loses the written representation, and `Formatters.x(position)` offers no per-sample metadata or separate tick path. Give each axis a discriminant and give readouts lazy access to the normalized position and original lexical precision. Instants carry their resolved zone, calendar dates use UTC calendar arithmetic, and wall-clock text is recoverable from the Frame. This affects F4, F6, A1, A3, A4, and C1. [Current temporal metadata](/home/canarit/projects/axylo/packages/axylo/src/core/contracts.ts:50) · [Formatting criteria](/home/canarit/projects/axylo/docs/02-product-spec.md:97)

Replace `XKind`, `XColumn`, and `Formatters`.

```ts
export type CalendarUnit = 'day' | 'month' | 'year';

export interface XFieldMeta extends FieldMeta {
  readonly format: XFieldOptions['format'];
  readonly tickFormat: XFieldOptions['tickFormat'];
}

export type ContinuousXAxis = XFieldMeta & (
  | { readonly kind: 'number' }
  | { readonly kind: 'time'; readonly timeZone: string }
  | { readonly kind: 'date'; readonly tickUnit: CalendarUnit }
  | { readonly kind: 'wall' }
);

export type CategoryAxis = XFieldMeta & {
  readonly kind: 'category';
  readonly ordered: boolean;
};

export type XAxis = ContinuousXAxis | CategoryAxis;
export type XKind = XAxis['kind'];

export interface XReadout<A extends XAxis = XAxis> {
  readonly axis: A;
  readonly position: number;
  /** Observed XValue, preserving the calendar or wall-clock spelling. */
  readonly value: XValue;
  readonly dateUnit: CalendarUnit | null;
}

export interface XColumn<A extends XAxis = XAxis> {
  readonly axis: A;
  readonly positions: Column<number>;
  readonly labels: Column<string> | null;
  /** Continuous position or category ID stable across rebasing within the data epoch. */
  keyAt(index: number): number;
  /** Builds one readout on demand. Generated steps supply a canonical XValue. */
  read(index: number): XReadout<A>;
}

export interface Formatters {
  value(field: ValueMeta, value: number): string;
  valueTick(field: ValueMeta, value: number): string;
  x(sample: XReadout): string;
  xTick(axis: XAxis, position: number, category?: string): string;
  zone(sample: XReadout): string | null;
  percent(ratio: number): string;
  missing(state: Exclude<SlotState, typeof SLOT_VALUE>): string;
}
```

### 7. Donut needs original rows and a separate display grouping

**Inferred.** The current Frame can encode an ungrouped donut as categories. The shared types leave zero and null legend entries, `Other` membership, and slice picking to separate implementations. `ArcMark` cannot supply entries with no arc, and its angles cannot recover exact values. Keep all original categories in the Frame and derive the bounded slice list from it. I preserve input order among the seven selected entries, use input order to break value ties, and place `Other` last. The table reads original rows, including grouped categories. This affects F8, I1, I2, A2, A4, and §3.6. [Donut acceptance criterion](/home/canarit/projects/axylo/docs/02-product-spec.md:101) · [Current arc declaration](/home/canarit/projects/axylo/packages/axylo/src/core/contracts.ts:303)

```ts
export interface DonutFrame<Row = unknown> extends FrameBase<Row> {
  readonly shape: 'donut';
  readonly labels: XColumn<CategoryAxis>; // input order including zero and missing
  readonly values: ValueColumn;
}

export type DonutMembers =
  | { readonly kind: 'row'; readonly sourceIndex: number }
  | { readonly kind: 'other'; readonly sourceIndices: Column<number> };

export interface DonutSlice {
  readonly key: string;
  readonly label: string;
  readonly members: DonutMembers;
  readonly value: ResolvedSlot;
  readonly ratio: number | null; // null for no data
  readonly visible: boolean;
  readonly angles: Domain | null; // exact radians; null means no arc
}

export interface DonutView<Row = unknown> {
  readonly kind: 'donut';
  readonly frame: DonutFrame<Row>;
  readonly revision: number;
  readonly slices: readonly DonutSlice[];
  readonly total: number;
}

export interface ArcMark {
  readonly type: 'arcs';
  readonly cx: number;
  readonly cy: number;
  readonly r0: number;
  readonly r1: number;
  readonly angles: Float64Array; // start/end pairs, clockwise from 12 o'clock
  readonly fills: readonly Paint[];
  readonly gap: number; // CSS px
}
```

### 8. Positional references drift and Lookup cannot express the type matrix

**Inferred.** Evict one slot and `{series, index}` can silently identify another datum. The nearest-x and nearest-point methods also leave band picking, slice picking, coincident scatter results, keyboard ordinals, and tooltip anchors without one shared contract. Bind lookup to the presented View and final projection. Use a stable x key for aligned data, a source index for scatter, and a slice key for donut. Reconcile a surviving key to itself. I use the next eligible datum after an evicted one, then the preceding datum if there is no successor. This affects I1, A2, A3, A7, §3.6, P4, and plan §2.1. [Current Lookup and DatumRef](/home/canarit/projects/axylo/packages/axylo/src/core/contracts.ts:373) · [Type matrix](/home/canarit/projects/axylo/docs/02-product-spec.md:183)

Use binary search within the exact visible range for nearest x. Build the scatter index once per View and projection. Query within 24 CSS px, choose the later source row on a tie, and cap the returned coincident preview at eight while preserving its count. Keyboard order is x/category then series for aligned charts, slice order for donut, and x then y for scatter. Event row materialization goes through `Frame.source`. [Lookup architecture](/home/canarit/projects/axylo/docs/03-plan-typescript-release.md:179)

```ts
export type PointDatumRef = {
  readonly kind: 'point'; readonly epoch: number;
  readonly seriesKey: string; readonly sourceIndex: number;
};

export type SliceDatumRef = {
  readonly kind: 'slice'; readonly epoch: number; readonly sliceKey: string;
};

export type DatumRef =
  | { readonly kind: 'aligned'; readonly epoch: number;
      readonly seriesKey: string; readonly xKey: number }
  | PointDatumRef
  | SliceDatumRef;

export type PickTarget =
  | { readonly kind: 'x'; readonly epoch: number; readonly xKey: number }
  | { readonly kind: 'point'; readonly primary: PointDatumRef;
      readonly coincident: readonly PointDatumRef[]; readonly count: number }
  | { readonly kind: 'slice'; readonly datum: SliceDatumRef };

export interface Pick {
  readonly target: PickTarget;
  readonly primary: DatumRef | null;
  readonly anchor: Rect | null; // chart-space bounds of the active mark, when present
}

export interface ExactDatum {
  readonly ref: DatumRef;
  readonly x: XReadout;
  readonly field: ValueMeta;
  readonly seriesLabel: string;
  readonly value: ResolvedSlot;
  readonly sourceIndex: number | null;
  readonly ratio: number | null;
  readonly cue: SeriesCue | null;
}

export interface StackReadout {
  readonly positive: number;
  readonly negative: number;
  readonly incomplete: boolean;
}

export interface ExactTooltip {
  readonly data: readonly ExactDatum[]; // at most eight entries
  readonly count: number;              // pre-truncation count
  readonly stack: StackReadout | null;
}

export type StepDirection =
  | 'next' | 'previous' | 'first' | 'last'
  | 'series-next' | 'series-previous' | 'page-next' | 'page-previous';

export interface Lookup<Row = unknown> {
  readonly view: View<Row>;
  pick(px: number, py: number): Pick | null;
  datum(ref: DatumRef): ExactDatum | null;
  focusBounds(ref: DatumRef): Rect | null;
  tooltip(target: PickTarget): ExactTooltip;
  readonly count: number;
  ordinal(ref: DatumRef): number; // zero based; -1 when unavailable
  atOrdinal(ordinal: number): DatumRef | null;
  step(from: DatumRef | null, direction: StepDirection): DatumRef | null;
  reconcile(from: DatumRef, previous: Lookup<Row>): DatumRef | null;
}

export interface LookupBuilder {
  build<Row>(view: View<Row>, layout: Extract<PlotLayout, { kind: 'plot' }>): Lookup<Row>;
}
```

### 9. Exact table paging and summaries lack a module boundary

**Inferred.** Nothing in the existing types forces exact reads through the Scene. The failure is at the handoff: `Lookup` exposes nearest indexes and steps, with no Frame-backed ordinal table or summary input. That leaves each consumer to invent a traversal, and makes a million-row expansion an easy implementation mistake. Expose lazy rows and direct x-to-page jumps. Compute summary extents and per-series min, max, and last from Frame data, reusing aggregates across unchanged chunks. Keep the reader model available in the too-small fallback and give compact mode the full summary without interactive controls. I use the current x range for table rows and retain hidden series and original donut categories in that range. This affects F5, F12, A1, A4, C1, C5, P3, P7, and P8. [Table and summary criteria](/home/canarit/projects/axylo/docs/02-product-spec.md:135) · [Frame authority](/home/canarit/projects/axylo/docs/03-plan-typescript-release.md:179)

```ts
export interface TableCell {
  readonly text: string;
  readonly sourceIndex: number | null;
}

export interface TableRow {
  readonly header: TableCell;
  readonly cells: readonly TableCell[];
  readonly stack: StackReadout | null;
}

export interface TableIndex {
  readonly caption: string;
  readonly headers: readonly FieldMeta[];
  readonly rowCount: number;
  readonly pageSize: 100;
  rowAt(ordinal: number): TableRow | null;
  /** Zero-based page of the first row at or after x. */
  pageForX(x: XValue): number | null;
}

export interface ReaderText {
  readonly name: string;
  readonly summary: string;
  readonly title: Readonly<Title> | null;
  readonly labelledBy: string | null;
  readonly subtitle: string | null;
}

export type ReaderModel =
  | (ReaderText & { readonly kind: 'compact' })
  | (ReaderText & { readonly kind: 'full'; readonly table: TableIndex | null });

export interface ReaderInput<Row> extends Omit<ReaderText, 'summary'> {
  readonly view: View<Row> | null;
  readonly formatters: Formatters;
  readonly caption: string;
  readonly description: string | null;
  readonly disclosure: ReaderDisclosure;
  readonly compact: boolean;
  readonly tableEnabled: boolean;
}

export interface ReaderBuilder {
  build<Row>(input: ReaderInput<Row>): ReaderModel;
}
```

### 10. Invalidation lacks explicit dependencies

**Inferred.** `Environment` has no definite-height distinction or font-load epoch. `View.revision` alone either reruns layout for every append or leaves stale labels and placements. The scene key also needs DPR because F5 buckets are computed before rasterization. Compare key tuple elements. Advance `labelsRevision` for changes to actual layout text, including bar values and donut percentages. Advance `placementInputsRevision` for changed tick positions, label anchors, or control requirements. A data-only update with the same placement inputs and text reuses layout. This affects L1, L3, L4, A6, P1–P5, P8, and plan §2.2. [Environment declaration](/home/canarit/projects/axylo/packages/axylo/src/core/contracts.ts:390) · [Invalidation rules](/home/canarit/projects/axylo/docs/03-plan-typescript-release.md:190)

```ts
export interface ContainerSize {
  readonly width: number;
  readonly definiteHeight: number | null;
}

export interface Environment {
  readonly locale: string;
  readonly timeZone: string;
  readonly raster: RasterGeometry;
  readonly reducedMotion: boolean;
  readonly container: ContainerSize;
  readonly textStyles: Readonly<Record<TextRole, TextStyle>>;
  readonly fontEpoch: number;
  readonly development: boolean;
}

export interface StageKeys {
  readonly normalize: readonly [
    dataRevision: number, encodingRevision: number, resolvedZone: string | null
  ];
  readonly view: readonly [
    frameRevision: number, zoomRevision: number, visibilityRevision: number,
    domainRevision: number, referenceRevision: number, chartModeRevision: number
  ];
  readonly layout: readonly [
    width: number, definiteHeight: number | null, locale: string, fontEpoch: number,
    textStyleRevision: number, labelsRevision: number, placementInputsRevision: number
  ];
  readonly scene: readonly [
    viewRevision: number, layoutRevision: number, geometryPolicyRevision: number,
    devicePixelRatio: number, deviceXOrigin: number
  ];
  readonly lookup: readonly [viewRevision: number, projectionRevision: number];
  readonly raster: readonly [
    sceneRevision: number, devicePixelRatio: number,
    paintBindingsRevision: number, resolvedThemeRevision: number
  ];
}
```

### 11. Layout cannot hand off the whole fitted figure

**Inferred.** `PlacedText` can represent wrapping, rotation, truncation, axis titles, and bar value labels. The missing outputs are the final shared projection, fitted legend items with values and hit areas, controls, and distinct fallback states. A single `remedy` also loses the sequence and the axis it applied to. Represent the hidden-label note explicitly and measure text bounds with the current spacing. Use the full-plot 120×80 fallback, the full-chart auto-height rule, and the separate compact sizing rule. Keep title, summary, and the table in figure flow. This affects L1, L3, L6–L8, I2, I4, A4, A6, C1, and C3. [Current Layout](/home/canarit/projects/axylo/packages/axylo/src/core/contracts.ts:211) · [Figure structure](/home/canarit/projects/axylo/docs/03-plan-typescript-release.md:216)

```ts
export type TextRole =
  | 'tick-x' | 'tick-y' | 'title-x' | 'title-y' | 'value' | 'reference'
  | 'legend' | 'notice' | 'status';

export interface TextMeasurer {
  width(text: string, style: TextStyle): number;
  /** Relative to the line's top-left. Includes glyph overhang and the line box. */
  bounds(text: string, style: TextStyle): Rect;
}

export interface PlacedText {
  readonly lines: readonly string[];
  readonly full: string;
  readonly x: number;
  readonly y: number;
  readonly anchor: 'start' | 'middle' | 'end';
  readonly baseline: 'top' | 'middle' | 'bottom';
  readonly rotate: number;
  readonly role: TextRole;
  readonly box: Rect;
}

export type Projection =
  | { readonly kind: 'xy'; readonly x: XScale; readonly y: ContinuousScale }
  | { readonly kind: 'bands'; readonly horizontal: boolean; readonly firstSlot: number;
      readonly band: BandScale; readonly value: ContinuousScale }
  | { readonly kind: 'ring'; readonly cx: number; readonly cy: number;
      readonly r0: number; readonly r1: number; readonly gap: number };

export interface AxisLabelFit {
  readonly remedies: readonly Exclude<LabelRemedy, 'none'>[];
  readonly hidden: number;
}

export interface LegendItem {
  readonly key: string;
  readonly label: PlacedText;
  readonly value: PlacedText | null;
  readonly percent: PlacedText | null;
  readonly paint: Paint;
  readonly cue: SeriesCue | null;
  readonly pressed: boolean;
  readonly hitBox: Rect;
}

export interface ControlPlacement {
  readonly kind: 'zoom-in' | 'zoom-out' | 'reset-zoom' | 'stream' | 'table';
  readonly box: Rect;
}

export interface LayoutSize {
  readonly width: number;
  readonly height: number; // mark/text host. Controls and table can flow outside.
}

export interface PlotGeometry extends LayoutSize {
  readonly plot: Rect;
  readonly projection: Projection;
}

export type PlotLayout = PlotGeometry & (
  | { readonly kind: 'compact'; readonly omissionMarker: PlacedText | null }
  | { readonly kind: 'plot';
      readonly xTicks: readonly Tick[]; readonly yTicks: readonly Tick[];
      readonly texts: readonly PlacedText[];
      readonly fit: { readonly x: AxisLabelFit; readonly y: AxisLabelFit };
      readonly hiddenLabelsNote: PlacedText | null;
      readonly legend: { readonly dock: 'top' | 'right' | 'bottom';
                         readonly items: readonly LegendItem[] } | null;
      readonly controls: readonly ControlPlacement[] }
);

export type Layout = PlotLayout | (LayoutSize & (
  | { readonly kind: 'unmeasured' }
  | { readonly kind: 'too-small'; readonly tableControl: ControlPlacement | null }
  | { readonly kind: 'message'; readonly state: 'loading' | 'empty' | 'error';
      readonly text: PlacedText; readonly tableControl: ControlPlacement | null }
));
```

### 12. Renderer updates conflate CSS bindings, computed colors, and geometry

**Inferred.** Symbolic `Paint` permits CSS binding, but the renderer only receives concrete colors. A computed series color can lose the author’s `var(--brand-1)` binding. The overlay also lacks explicit clearing and clipping semantics. Give SVG live CSS bindings and contrast dash alternatives. On theme changes, Canvas repaints its cached Scene and overlay with computed colors within one frame. An overlay update can use an independent surface or group. Clipped cursor marks and unclipped focus rings use the same coordinates. A dedicated band primitive also gives reference ranges a representation independent of bar series. This affects L4, I1, A2, A5, C4, DX6, P4, P7, and plan §2.3. [Theme and renderer declarations](/home/canarit/projects/axylo/packages/axylo/src/core/contracts.ts:337) · [Renderer comparison contract](/home/canarit/projects/axylo/docs/03-plan-typescript-release.md:204)

```ts
export type PaintToken = Extract<Paint, { kind: 'token' }>['name'];

export interface PaintBindings {
  readonly tokens: Readonly<Record<PaintToken, string>>;
  readonly series: readonly string[];
}

export interface ResolvedTheme {
  readonly scheme: 'light' | 'dark';
  readonly forcedColors: boolean;
  readonly moreContrast: boolean;
  readonly paints: PaintBindings; // concrete computed colors, for Canvas
}

export interface PointMark {
  readonly type: 'points';
  readonly series: number;
  readonly xy: Float32Array;
  readonly shape: MarkerShape;
  readonly size: number;
  readonly fill: Paint;
  readonly outline: { readonly paint: Paint; readonly width: number;
                      readonly dash: DashStyle } | null;
}

export interface BandMark {
  readonly type: 'band';
  readonly box: Rect;
  readonly fill: Paint;
  readonly opacity: number;
}

export type Mark = PathMark | AreaMark | RectMark | PointMark | ArcMark | RuleMark | BandMark;

export interface Overlay {
  readonly clip: Rect;
  readonly clipped: readonly Mark[];
  readonly unclipped: readonly Mark[];
}

export interface RenderUpdate {
  readonly scene?: Scene | null; // null clears, absent retains
  readonly overlay?: Overlay | null;
  /** Unresolved CSS expressions, including author var(...) bindings. */
  readonly bindings?: PaintBindings;
  readonly raster?: {
    readonly theme: ResolvedTheme;
    readonly devicePixelRatio: number;
  };
}

export interface MarkRenderer {
  readonly kind: 'canvas' | 'svg';
  readonly element: HTMLElement | SVGSVGElement; // aria-hidden surface or wrapper
  present(update: RenderUpdate): void;
  destroy(): void;
}
```

### 13. Diagnostic severity cannot drive omissions or strict timing

**Inferred.** AX141 and AX150 can warn while leaving the plotted data intact. Summing warning counts can therefore produce false F12 disclosures. AX108 also needs a series-specific effect. Track disposition and count affected values separately from developer-facing diagnostic examples. AX141 from a later CSS change and AX160 from the first formatting of a lazy table cell can first arise outside a handle call. I scope synchronous strict rejection to call-origin diagnostics and report presentation-origin diagnostics on discovery. The strict wording needs that boundary explicitly. The two density hints in §3.6 still need stable registry codes before their tests can assert diagnostic IDs. This affects F3, F6, F11, F12, C5, DX4, and DX5. [Diagnostic sink](/home/canarit/projects/axylo/packages/axylo/src/core/contracts.ts:18) · [Registry](/home/canarit/projects/axylo/docs/02-product-spec.md:148)

```ts
export type DiagnosticEffect =
  | { readonly kind: 'none' | 'values-omitted' | 'values-changed' | 'chart-error' }
  | { readonly kind: 'series-disabled'; readonly seriesKey: string };

export type DiagnosticInput = Omit<Diagnostic, 'chart'> & {
  readonly origin: 'call' | 'presentation';
  readonly effect: DiagnosticEffect;
};

export interface ReaderDisclosure {
  readonly omittedValues: number;
  readonly changedValues: number;
}

export interface DiagnosticSink {
  /** Aggregate by code, field, origin and effect. Count all cases; cap source examples at ten. */
  add(diagnostic: DiagnosticInput): void;
}
```

### 14. Public types reject or omit options the spec promises

**Inferred.** `zoom: 'touch'` fails to compile under I3. L1’s ordered-category thinning has no input property. The message keys lack “No observation,” hidden-label and incomplete-stack text, and other reader templates. Scatter also advertises explicit categorical x while its internal frame and the matrix’s two-measure workflow assume continuous x. I narrow the explicit scatter option to that interpretation. Inferred string fields still need runtime validation. This affects L1, I1, I3, F8, F10, A10, DX3, and §3.6. [Public axis options](/home/canarit/projects/axylo/packages/axylo/src/public.ts:52) · [Public messages](/home/canarit/projects/axylo/packages/axylo/src/public.ts:176)

```ts
export interface CartesianOptions {
  zoom?: boolean | 'touch';
  reference?: readonly Reference[];
}

export interface XFieldOptions extends FieldCommon {
  type?: 'number' | 'time' | 'date' | 'category';
  ordered?: boolean; // category axes only, including inferred categories
  timeZone?: 'local' | 'UTC' | (string & {});
  format?: Intl.DateTimeFormatOptions | Intl.NumberFormatOptions | ((value: XValue) => string);
  tickFormat?: Intl.DateTimeFormatOptions | Intl.NumberFormatOptions | ((value: XValue) => string);
  domain?: readonly [XValue, XValue];
}

export type ScatterXField<Row> =
  | XKey<Row>
  | ({ field: XKey<Row>; type?: 'number' | 'time' | 'date'; ordered?: never } &
     Omit<XFieldOptions, 'type' | 'ordered'>);

export type ScatterOptions<Row> = CommonOptions<Row> & CartesianOptions & {
  x: ScatterXField<Row>;
  y: ValueField<Row>;
  series?: SeriesKey<Row>;
};

export interface Messages {
  viewAsTable: string;
  noData: string;
  noObservation: string;
  incompleteStack: string;
  moreRows: string;
  otherSlices: string;
  valuesNotShown: string;
  valuesChanged: string;
  labelsHidden: string;
  loading: string;
  empty: string;
  error: string;
  internalError: string;
  chartName: string;
  chartSummary: string;
  seriesSummary: string;
  referenceSummary: string;
  plotLabel: string;
  controlsLabel: string;
  pointOf: string;
  zoomIn: string;
  zoomOut: string;
  resetZoom: string;
  pause: string;
  resume: string;
  previousPage: string;
  nextPage: string;
  pageOf: string;
  jumpToX: string;
}
```

### Keep as written

- `ContinuousScale`, `BandScale`, and `XScale` for mapping and inversion in CSS pixels.
- `Tick` and `TickCandidates` for ordered candidate sets.
- `TextStyle` for resolved font and spacing inputs.
- `Paint` for symbolic series and theme-token references.
- `RectMark` with its packed rectangles and distinct missing-bar variant.
- `RuleMark` for axis, grid, reference, cursor, and break strokes.
- `Scene` as plain, clipped geometry ordered back to front.