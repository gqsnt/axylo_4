/**
 * Options, validation and the committed state of a hierarchy chart, without a DOM. A chart and
 * `validateTreemap` / `validateSunburst` run the same `prepare`, so a validation in Node reports exactly what a
 * created chart reports for the same call.
 */
import type { DiagnosticInput } from '../core/contracts';
import type { Diagnostic } from '../public';
import type { NumberFormatOption } from '../format/number';
import { DiagnosticCollector } from '../diagnostics/collector';
import { createDiagnostic } from '../diagnostics/registry';
import { strictViolations } from '../core/delivery';
import { buildHierarchy, type HierarchyData, type HierarchyModel } from './tree';
import {
  createHierarchyReader, DEFAULT_HIERARCHY_MESSAGES, type HierarchyMessages, type HierarchyReader,
} from './reader';

export type HierarchyType = 'treemap' | 'sunburst';

// Declared in the entry file (hierarchy.ts): the package ships that declaration file, not this module's.
export type { HierarchyOptions, HierarchyTitle, SunburstOptions, TreemapOptions } from '../hierarchy';
import type { HierarchyOptions, HierarchyTitle } from '../hierarchy';

const KNOWN: ReadonlySet<string> = new Set([
  'data', 'title', 'labelledBy', 'description', 'value', 'rootLabel', 'tooltip', 'table', 'messages', 'locale', 'strict', 'onDiagnostic',
]);

export type RawOptions = Readonly<Record<string, unknown>>;

/** The commit rule of plan 1.5 for hierarchy options: a present key replaces, `undefined` resets, absent keys stay. Data is borrowed, never walked here. */
export function mergeOptions(current: RawOptions, patch: unknown): RawOptions {
  const next: Record<string, unknown> = { ...current };
  if (patch === null || typeof patch !== 'object') return next;
  for (const key of Object.keys(patch)) {
    const v = (patch as Record<string, unknown>)[key];
    if (v === undefined) delete next[key];
    else next[key] = v;
  }
  return next;
}

export interface Prepared {
  readonly raw: RawOptions;
  readonly type: HierarchyType;
  readonly model: HierarchyModel;
  readonly reader: HierarchyReader;
  readonly messages: HierarchyMessages;
  readonly locale: string;
  readonly name: string;
  readonly title: HierarchyTitle | null;
  readonly inputs: readonly DiagnosticInput[];
  readonly diagnostics: readonly Diagnostic[];
  /** Strict and with a warning or error found by this call: the call must be rejected. */
  readonly rejected: boolean;
  /** The reader's note (spec F12): how many nodes or values were left out, or null. */
  readonly note: string | null;
}

export function titleOf(raw: RawOptions): HierarchyTitle | null {
  const t = raw.title;
  if (typeof t === 'string') return t ? { text: t } : null;
  if (t !== null && typeof t === 'object' && typeof (t as HierarchyTitle).text === 'string' && (t as HierarchyTitle).text) return t as HierarchyTitle;
  return null;
}

const fill = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all);

/**
 * Validates and builds everything a chart commits for `raw`. `presentation` collects findings made later
 * (a formatter that throws while a table cell or tooltip is written): reported, never thrown (spec 3.5).
 */
export function prepare(
  type: HierarchyType,
  raw: RawOptions,
  defaultLocale: string,
  presentation: (d: DiagnosticInput) => void = () => {},
): Prepared {
  const sink = new DiagnosticCollector();
  for (const key of Object.keys(raw)) {
    if (!KNOWN.has(key)) sink.add(createDiagnostic('AX150', 'none', { field: key }));
  }
  const overrides = raw.messages !== null && typeof raw.messages === 'object' ? raw.messages as Partial<HierarchyMessages> : {};
  const messages: HierarchyMessages = { ...DEFAULT_HIERARCHY_MESSAGES };
  for (const key of Object.keys(overrides) as (keyof HierarchyMessages)[]) {
    if (typeof overrides[key] === 'string') messages[key] = overrides[key]!;
  }
  const locale = typeof raw.locale === 'string' && raw.locale ? raw.locale : defaultLocale;
  const title = titleOf(raw);
  const typeName = type === 'treemap' ? messages.typeTreemap : messages.typeSunburst;
  const labelledBy = typeof raw.labelledBy === 'string' && raw.labelledBy ? raw.labelledBy : null;
  if (!title && !labelledBy) sink.add(createDiagnostic('AX140', 'none'));
  const name = title ? title.text : fill(messages.chartName, { type: typeName });
  const rootLabel = typeof raw.rootLabel === 'string' && raw.rootLabel ? raw.rootLabel : title?.text ?? 'All';
  const model = buildHierarchy(raw.data, rootLabel, sink);
  const valueOptions = raw.value !== null && typeof raw.value === 'object' ? raw.value as HierarchyOptions['value'] : undefined;
  const field = valueOptions?.label ?? 'value';
  let formatFailed = false;
  const reader = createHierarchyReader(model, messages, locale, valueOptions, typeName, name, () => {
    if (formatFailed) return;
    formatFailed = true;
    presentation(createDiagnostic('AX160', 'changed', { field }, 'presentation'));
  });
  const inputs = sink.inputs();
  const diagnostics = inputs.map(({ effect: _e, origin: _o, ...d }) => ({ ...d, chart: name }));
  const rejected = raw.strict === true && strictViolations(inputs).length > 0;
  const note = noteFor(messages, inputs);
  return { raw, type, model, reader, messages, locale, name, title, inputs, diagnostics, rejected, note };
}

/**
 * The reader's note (spec F12): what was left out and what reads differently from the caller's data — an
 * overflowing total read as "more than", or values in the default format after the author's format failed.
 * Shown in the figure and named in the plot's accessible description.
 */
export function noteFor(messages: HierarchyMessages, inputs: readonly DiagnosticInput[]): string | null {
  let omitted = 0;
  const parts: string[] = [];
  for (const d of inputs) if (d.level === 'warning' && d.effect === 'omitted') omitted += d.count ?? d.rows?.length ?? 1;
  if (omitted > 0) parts.push(fill(messages.valuesNotShown, { count: String(omitted) }));
  for (const d of inputs) {
    if (d.effect !== 'changed') continue;
    if (d.code === 'AX190') parts.push(fill(messages.totalsCapped, { count: String(d.count ?? 1) }));
    else if (d.code === 'AX160') parts.push(messages.formatFallback);
  }
  return parts.length ? parts.join(' ') : null;
}

/** Everything a create call would report, without a DOM (Node and SSR safe). */
export function validateHierarchy(type: HierarchyType, options: unknown): readonly Diagnostic[] {
  const raw = mergeOptions({}, options);
  const late: DiagnosticInput[] = [];
  const p = prepare(type, raw, 'en-US', d => late.push(d));
  // Writing the root's total reaches the author's formatter once, as a created chart does for its summary.
  void p.reader.summary;
  return [...p.diagnostics, ...late.map(({ effect: _e, origin: _o, ...d }) => ({ ...d, chart: p.name }))];
}
