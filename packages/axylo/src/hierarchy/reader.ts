/**
 * What a reader gets as text from a hierarchy: one description per node shared by the tooltip, the focused
 * item, the breadcrumb and the table, so a value, a share and a path read the same everywhere. Pure.
 */
import type { TableModel, XValue } from '../core/contracts';
import { createNumberReadout, type NumberFormatOption } from '../format/number';
import { shareText } from '../format/number';
import {
  BRANCH, LEAF_INVALID, LEAF_MISSING, pathOf, shareOfParent, shareOfRoot, type HierarchyModel,
} from './tree';

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
}

export const DEFAULT_HIERARCHY_MESSAGES: HierarchyMessages = {
  viewAsTable: 'View as table',
  hideTable: 'Hide table',
  noData: 'No data',
  invalidValue: 'Not shown: invalid value',
  empty: 'No data to show.',
  path: 'Path',
  depth: 'Depth',
  value: 'Value',
  shareOfParent: '% of Parent',
  shareOfRoot: '% of Root',
  hierarchyPath: 'Hierarchy path',
  instructions: 'Left and Right arrows move between siblings, Home and End to the first and last. Down arrow moves to the first child, Up arrow or Escape to the parent. Enter or Space opens a branch.',
  summary: '{type} of {count} nodes over {depth} levels. Total {total}.',
  chartName: '{type} chart',
  typeTreemap: 'Treemap',
  typeSunburst: 'Sunburst',
  up: 'Up one level',
  moreThan: 'more than {value}',
  valuesNotShown: 'Values not shown: {count}.',
  totalsCapped: 'Totals shown as "more than" the largest number: {count}.',
  formatFallback: 'Values use the default number format: the value format failed.',
  emptyBranch: 'Nothing to show in {label}. Go up with the path above, the Up arrow, or a click on the chart.',
};

export const PATH_SEPARATOR = ' / ';

export interface ValueOptions {
  readonly label?: string;
  readonly unit?: string;
  readonly format?: NumberFormatOption;
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

export interface HierarchyReader {
  node(i: number): NodeText;
  readonly table: TableModel;
  readonly summary: string;
  readonly valueLabel: string;
}

const fill = (template: string, values: Readonly<Record<string, string | number>>): string =>
  template.replace(/\{(\w+)\}/g, (all, key: string) => Object.hasOwn(values, key) ? String(values[key]) : all);

export function createHierarchyReader(
  m: HierarchyModel,
  messages: HierarchyMessages,
  locale: string,
  valueOptions: ValueOptions | undefined,
  type: string,
  caption: string,
  onFormatError: (error: unknown) => void,
): HierarchyReader {
  const readout = createNumberReadout({ locale, unit: valueOptions?.unit ?? null, format: valueOptions?.format, onError: onFormatError });
  const share = (r: number | null): string => r === null ? '—' : shareText(r, locale);
  const valueText = (i: number): string => {
    const s = m.state[i]!;
    if (s === LEAF_MISSING) return messages.noData;
    if (s === LEAF_INVALID) return messages.invalidValue;
    const v = m.value[i]!;
    if (s === BRANCH && v === Infinity) return fill(messages.moreThan, { value: readout(Number.MAX_VALUE) });
    return readout(v);
  };
  const cache = new Map<number, NodeText>();
  const node = (i: number): NodeText => {
    let t = cache.get(i);
    if (t) return t;
    t = {
      index: i,
      id: m.ids[i]!,
      label: m.labels[i]!,
      path: pathOf(m, i).join(PATH_SEPARATOR),
      depth: m.depth[i]!,
      value: valueText(i),
      shareOfParent: share(shareOfParent(m, i)),
      shareOfRoot: share(shareOfRoot(m, i)),
    };
    // Bounded: the cache only spares repeated reads of the nodes a reader visits.
    if (cache.size > 4096) cache.clear();
    cache.set(i, t);
    return t;
  };
  const headers = [messages.path, messages.depth, valueOptions?.label ?? messages.value, messages.shareOfParent, messages.shareOfRoot];
  const table: TableModel = {
    caption,
    headers,
    rowCount: m.count,
    // Unpaginated: one page holds every node, so an export or a reader sees the whole tree at once.
    pageSize: Math.max(1, m.count),
    row(ordinal: number): readonly string[] | null {
      if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= m.count) return null;
      const t = node(ordinal);
      return [t.path, String(t.depth), t.value, t.shareOfParent, t.shareOfRoot];
    },
    pageForX(x: XValue): number | null {
      const text = typeof x === 'string' ? x : String(x);
      for (let i = 0; i < m.count; i++) if (m.labels[i] === text || node(i).path === text) return 0;
      return null;
    },
  };
  // Lazy: the summary reaches the author's formatter, which must only run when a chart reads it, never while
  // a call is being validated.
  let summary: string | null = null;
  return {
    node,
    table,
    get summary() {
      return summary ??= fill(messages.summary, { type, count: m.count, depth: m.maxDepth + 1, total: m.count ? valueText(0) : messages.noData });
    },
    valueLabel: headers[2]!,
  };
}

/** The text a focused item or tooltip reads for node i. */
export function nodeSentence(t: NodeText, messages: HierarchyMessages): string {
  return `${t.path}: ${t.value}. ${messages.shareOfParent} ${t.shareOfParent}, ${messages.shareOfRoot} ${t.shareOfRoot}.`;
}
