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

// Declared in the entry file (hierarchy.ts): the package ships that declaration file, not this module's.
export type { HierarchyMessages, NodeText } from '../hierarchy';
import type { HierarchyMessages, NodeText } from '../hierarchy';

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
  previousPage: 'Previous page',
  nextPage: 'Next page',
  pageOf: 'Page {page} of {count}',
};

/** Rows per table page, as every other table (spec A4); the model itself always holds every node. */
export const TABLE_PAGE = 100;

export const PATH_SEPARATOR = ' / ';

export interface ValueOptions {
  readonly label?: string;
  readonly unit?: string;
  readonly format?: NumberFormatOption;
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
  // A node's value text is formatted once per reader and kept, filled as nodes are read (never all up front):
  // the committed table reads the same closed, open and in every export, however many nodes the bounded node
  // cache below has dropped, even with a formatter that answers differently each time.
  const values = new Map<number, string>();
  // While the author's formatter formats a value of this table, it may read the table again (a nested export):
  // a node not formatted yet then reads in the default format, without entering the formatter again and
  // without being kept, so the table's own text stays the formatter's. (The readout catches what the
  // formatter throws, so the count always comes back down.)
  let formatting = 0;
  const plain = createNumberReadout({ locale, unit: valueOptions?.unit ?? null });
  const valueText = (i: number): string => {
    const s = m.state[i]!;
    if (s === LEAF_MISSING) return messages.noData;
    if (s === LEAF_INVALID) return messages.invalidValue;
    let text = values.get(i);
    if (text === undefined) {
      const read = formatting++ ? plain : readout, v = m.value[i]!;
      text = s === BRANCH && v === Infinity ? fill(messages.moreThan, { value: read(Number.MAX_VALUE) }) : read(v);
      // Back at the outermost read: the formatter's own text, kept.
      if (!--formatting) values.set(i, text);
    }
    return text;
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
    // A read nested in the formatter may hold a default text that is not the node's: it is not kept.
    if (formatting) return t;
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
    // Paged for the reader only: `row(i)` reaches every node, so an export reads the whole tree whatever page is shown.
    pageSize: TABLE_PAGE,
    row(ordinal: number): readonly string[] | null {
      if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= m.count) return null;
      const t = node(ordinal);
      return [t.path, String(t.depth), t.value, t.shareOfParent, t.shareOfRoot];
    },
    pageForX(x: XValue): number | null {
      const text = typeof x === 'string' ? x : String(x);
      for (let i = 0; i < m.count; i++) if (m.labels[i] === text || node(i).path === text) return Math.floor(i / TABLE_PAGE);
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
