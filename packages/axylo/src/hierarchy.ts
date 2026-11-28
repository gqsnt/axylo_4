/**
 * Opt-in hierarchy charts (`axylo/hierarchy`, N9b): `treemap` (squarified) and `sunburst` (radial partition),
 * with drill-down, an ancestor breadcrumb, hierarchical keyboard movement and a five-column accessible table.
 *
 * - Nested trees or flat parent-id rows, rolled up bottom-up into typed arrays (hierarchy/tree.ts).
 * - AX190 (leaf values that cannot be drawn), AX191 (orphans, duplicate ids, cycles), AX192 (nothing positive to
 *   draw); `strict: true` rejects the call and keeps the committed state.
 * - Importing this module touches no DOM and runs no code at top level, so it is safe in Node and SSR.
 */
import type { Diagnostic, Target, XValue } from './public.js';
import { openHierarchyChart } from './hierarchy/chart';
import { validateHierarchy } from './hierarchy/core';
import { SUNBURST_DRIVER } from './hierarchy/sunburst/render';
import { TREEMAP_DRIVER } from './hierarchy/treemap/render';

// The public types are declared here, not in hierarchy/*: the package ships this entry's declaration file and
// public.d.ts only, so every type a signature names must be reachable from those two files.

/**
 * The accessible table as a chart hands it out (the same shape as the other entries' table model): headers,
 * every row by ordinal, the page size the reader pages it by, and the page holding a node's label or path.
 */
export interface TableModel {
  readonly caption: string;
  /** First entry is the path column. */
  readonly headers: readonly string[];
  readonly rowCount: number;
  readonly pageSize: number;
  /** Cells of one row as text; first cell is the row header. null outside the range. */
  row(ordinal: number): readonly string[] | null;
  /** Zero-based page holding the first node whose label or path is this value; null if there is none. */
  pageForX(x: XValue): number | null;
}

/** A nested node: `children` makes it a branch; a leaf carries `value`. */
export interface HierarchyNode {
  readonly id?: string | number;
  readonly label?: string;
  readonly value?: number | null;
  readonly children?: readonly HierarchyNode[];
}

/** A flat row: `parent` names the id of the row it belongs to; a row without a parent is a top-level node. */
export interface HierarchyRow {
  readonly id: string | number;
  readonly parent?: string | number | null;
  readonly label?: string;
  readonly value?: number | null;
}

export type HierarchyData = HierarchyNode | readonly HierarchyNode[] | readonly HierarchyRow[];

export interface HierarchyMessages {
  viewAsTable: string;
  hideTable: string;
  noData: string;
  invalidValue: string;
  empty: string;
  path: string;
  depth: string;
  value: string;
  shareOfParent: string;
  shareOfRoot: string;
  /** Breadcrumb landmark name. */
  hierarchyPath: string;
  /** Read after the keys; {type} is the chart type. */
  instructions: string;
  /** Generated summary: {type}, {count} nodes, {depth} levels, {total}. */
  summary: string;
  /** Generated name when there is no title. */
  chartName: string;
  typeTreemap: string;
  typeSunburst: string;
  /** Visible on the center of a sunburst whose root is drilled: what clicking it does. */
  up: string;
  /** "more than" a value, for a total above the largest double. */
  moreThan: string;
  /** The reader's note (spec F12) when nodes or values were left out: {count}. */
  valuesNotShown: string;
  /** The reader's note when branch totals passed the largest double and read "more than" it: {count}. */
  totalsCapped: string;
  /** The reader's note when the author's value format failed and the default format is used instead. */
  formatFallback: string;
  /** Visible when the drilled node has nothing to show: {label}. */
  emptyBranch: string;
  /** Table paging (spec A4, 100 rows per page). */
  previousPage: string;
  nextPage: string;
  /** {page} of {count}. */
  pageOf: string;
}

/** Reading of one node, all strings, from the model through the same formatters everywhere. */
export interface NodeText {
  readonly index: number;
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly depth: number;
  readonly value: string;
  readonly shareOfParent: string;
  readonly shareOfRoot: string;
}

export interface HierarchyTitle { text: string; visible?: boolean; level?: 2 | 3 | 4 | 5 | 6 }

export interface HierarchyOptions {
  /** A nested tree (one root, or several top-level nodes) or flat rows that name their `parent`. */
  data: HierarchyData;
  title?: string | HierarchyTitle;
  labelledBy?: string;
  description?: string;
  /** How values read in the tooltip, focused item, breadcrumb and table. */
  value?: { label?: string; unit?: string; format?: Intl.NumberFormatOptions | ((value: number) => string) };
  /** Name of the made-up root when the data has several top-level nodes. Default: the title, else "All". */
  rootLabel?: string;
  tooltip?: boolean;
  table?: boolean;
  messages?: Partial<HierarchyMessages>;
  locale?: string;
  /** Throw on any warning or error found while validating a create or update call; the chart keeps its last valid state. */
  strict?: boolean;
  onDiagnostic?: (diagnostic: Diagnostic) => void;
}

export type TreemapOptions = HierarchyOptions;
export type SunburstOptions = HierarchyOptions;

/** A node as events and the handle report it: identity, place and the caller's value. */
export interface HierarchyPoint {
  readonly id: string;
  readonly label: string;
  /** Labels from the root down to this node. */
  readonly path: readonly string[];
  readonly depth: number;
  /** The rolled-up value; null for a leaf whose value is missing or invalid. */
  readonly value: number | null;
  /** The caller's row (flat) or pre-order node index (nested); -1 for a made-up root. */
  readonly row: number;
}

export interface HierarchyEvents {
  hover: HierarchyPoint | null;
  select: HierarchyPoint;
  /** The drilled root changed: the new root. */
  drill: HierarchyPoint;
}

/** One entry of the breadcrumb, from the root to the drilled node, with the texts the bar shows. */
export interface HierarchyCrumb extends NodeText {
  readonly current: boolean;
}

export interface HierarchyChart<Options> {
  /** Changes options (plan 1.5). A `strict` chart throws here and keeps its last valid state. */
  update(patch: Partial<Options>): void;
  on<E extends keyof HierarchyEvents>(event: E, listener: (payload: HierarchyEvents[E]) => void): () => void;
  /** Drills to the node with this id (`null`: the root). Unknown ids leave the chart as it is and return false. */
  drill(id: string | null): boolean;
  /** Diagnostics for the committed options and data. */
  readonly diagnostics: readonly Diagnostic[];
  /** The committed table: every node in pre-order, 100 rows per page (spec A4). null when `table: false`. */
  readonly table: TableModel | null;
  /** The breadcrumb as shown: root first, the drilled node last. */
  readonly breadcrumb: readonly HierarchyCrumb[];
  /** The drilled root and the focused node. */
  readonly drilled: HierarchyPoint;
  readonly focused: HierarchyPoint | null;
  /** The chart's root element (the figure). */
  readonly element: HTMLElement;
  destroy(): void;
}

export type TreemapChart = HierarchyChart<TreemapOptions>;
export type SunburstChart = HierarchyChart<SunburstOptions>;

/** Creates a squarified treemap. */
export function treemap(target: Target, options: TreemapOptions): TreemapChart {
  return openHierarchyChart(TREEMAP_DRIVER, target, options);
}

/** Creates a sunburst: the root at the center, rings by depth, clockwise from 12 o'clock. */
export function sunburst(target: Target, options: SunburstOptions): SunburstChart {
  return openHierarchyChart(SUNBURST_DRIVER, target, options);
}

/** Validates treemap options and data without a DOM (Node and SSR safe): what a created chart would report. */
export function validateTreemap(options: TreemapOptions): readonly Diagnostic[] {
  return validateHierarchy('treemap', options);
}

/** Validates sunburst options and data without a DOM (Node and SSR safe). */
export function validateSunburst(options: SunburstOptions): readonly Diagnostic[] {
  return validateHierarchy('sunburst', options);
}

export type { Diagnostic, Target, XValue } from './public.js';
