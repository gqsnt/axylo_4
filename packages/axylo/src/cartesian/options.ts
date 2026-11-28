/**
 * Option parsing, validation (`AX170`, `AX173`, `AX174`), and translation facade for `axylo/cartesian`
 * (RFC C4.1 §2.1 & §6). Translates `{ x, axes, layers, reference, ...rest }` into the carrier `'line'`
 * options shape so `ChartController`'s `encodingChanged`, `namesOnlyChanged`, and `renamed()` work
 * seamlessly with 0 edits to `controller.ts` or `stages.ts`.
 */
import type { Composition } from '../core/composition';
import { resolveOptions, type ResolvedOptions } from '../data/options';
import type { NumberFormatOption } from '../format';
import type { XValue } from '../public';
import { isValidLogBase, isValidLogDomain, type LogBase, type Span } from '../scale/log';
import { annotationPath, reportCartesian } from './diagnostics';
import {
  registerLogical, type OptionIssue, type LogicalKind, type LogicalMark, type PartRole, type OutlierColumn,
} from './boxplot';
import {
  axesDomainSignature, type CartesianAnnotationSpec, type CartesianAxisSpec, type CartesianIntervalSpec,
  type CartesianLayerMark, type CartesianMeta, type CartesianReferenceSpec, type CartesianSeriesSpec,
  type CartesianStateRef,
} from './meta';
import { flushViolin, readViolin, type ViolinNotes } from './violin';

interface ValidationIssue {
  readonly code: 'AX170' | 'AX173' | 'AX174';
  readonly field?: string;
  readonly detail: string;
}

export interface ParsedCartesian {
  readonly meta: CartesianMeta;
  readonly issues: readonly ValidationIssue[];
  readonly translated: Record<string, unknown>;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const fieldName = (spec: unknown): string | null => typeof spec === 'string' ? spec : isObj(spec) && typeof spec.field === 'string' ? spec.field : null;
const LAYER_KINDS = ['bar', 'area', 'line', 'range', 'errorBar', 'scatter', 'boxplot', 'violin'] as const;
const BOX_ROLES = ['median', 'min', 'q1', 'q3', 'max'] as const;

export function parseCartesianInput(input: unknown, previous?: CartesianMeta | null): ParsedCartesian {
  const src = isObj(input) ? input : {};
  const issues: ValidationIssue[] = [];
  const optionIssues: OptionIssue[] = [];
  // Violin payload omissions, pooled over the layers so a field two layers read is reported once (flushed below).
  const violinNotes: ViolinNotes = new Map();
  const err = (code: ValidationIssue['code'], field: string, detail: string) => { issues.push({ code, field, detail }); };
  const opt = (code: OptionIssue['code'], field: string, detail: string) => { optionIssues.push({ code, field, detail }); };
  const rawAxes = isObj(src.axes) ? src.axes : null;
  const rawLayers = Array.isArray(src.layers) ? src.layers : [];
  const rawRefs = Array.isArray(src.reference) ? src.reference : [];

  const leftAxes: CartesianAxisSpec[] = [];
  const rightAxes: CartesianAxisSpec[] = [];
  const axisById = new Map<string, CartesianAxisSpec>();

  const axisEntries = rawAxes ? Object.entries(rawAxes) : [];
  if (!axisEntries.length) {
    err('AX174', 'axes', 'Option `axes` must declare at least one left y-axis');
  } else {
    if (axisEntries.length > 2) err('AX174', 'axes', `Declared ${axisEntries.length} y-axes; at most 2 ('left' and 'right') are supported`);
    for (const [id, raw] of axisEntries) {
      if (!isObj(raw)) { err('AX174', id, `Axis '${id}' must be an options object`); continue; }
      const pos = raw.position === 'right' || raw.position === 'left' ? raw.position : null;
      if (!pos) { err('AX174', id, `Axis '${id}' must declare position: 'left' | 'right'`); continue; }
      const scale: 'linear' | 'log' = raw.scale === 'log' ? 'log' : 'linear';
      if (raw.scale !== undefined && raw.scale !== 'linear' && raw.scale !== 'log') {
        err('AX174', id, `Axis '${id}' has unsupported scale '${String(raw.scale)}'`);
      }
      const rawBase = raw.base;
      const base: LogBase = isValidLogBase(rawBase) ? rawBase : 10;
      const rawDomain = raw.domain;
      const domain: Span | null = Array.isArray(rawDomain) && rawDomain.length === 2 ? [Number(rawDomain[0]), Number(rawDomain[1])] : null;
      if (scale === 'log') {
        if (rawBase !== undefined && !isValidLogBase(rawBase)) err('AX170', id, `unsupported log base ${String(rawBase)}`);
        if (rawDomain !== undefined && (!domain || !isValidLogDomain(domain))) err('AX170', id, 'log domain must be strictly positive [min, max] with min < max');
      }
      const spec: CartesianAxisSpec = {
        id, index: pos === 'left' ? 0 : 1, position: pos, scale, base, rawBase, domain, rawDomain,
        label: typeof raw.label === 'string' ? raw.label : null,
        unit: typeof raw.unit === 'string' ? raw.unit : null,
        format: (raw.format as NumberFormatOption | undefined) ?? null,
        tickFormat: (raw.tickFormat as NumberFormatOption | undefined) ?? null,
      };
      (pos === 'left' ? leftAxes : rightAxes).push(spec);
      axisById.set(id, spec);
    }
    if (leftAxes.length !== 1) err('AX174', 'axes', `Option \`axes\` must declare exactly one 'left' y-axis (found ${leftAxes.length})`);
    if (rightAxes.length > 1) err('AX174', 'axes', `Option \`axes\` declared ${rightAxes.length} 'right' y-axes; at most 1 is allowed`);
  }

  const orderedAxes: CartesianAxisSpec[] = [];
  if (leftAxes[0]) orderedAxes.push(leftAxes[0]);
  if (rightAxes[0]) orderedAxes.push(rightAxes[0]);
  const fallbackLeft: CartesianAxisSpec = orderedAxes[0] ?? {
    id: 'y', index: 0, position: 'left', scale: 'linear', base: 10, domain: null, label: null, unit: null, format: null, tickFormat: null,
  };
  if (!orderedAxes.length) orderedAxes.push(fallbackLeft);

  const seriesSpecs: CartesianSeriesSpec[] = [];
  const seriesByField = new Map<string, CartesianSeriesSpec>();
  const intervals: CartesianIntervalSpec[] = [];
  const leading: Record<string, unknown>[] = [];
  const trailing: Record<string, unknown>[] = [];
  const marks: LogicalMark[] = [];

  if (!rawLayers.length) err('AX174', 'layers', 'Option `layers` must include at least one layer');

  const pushCarrier = (
    rawField: unknown, axis: CartesianAxisSpec, mark: CartesianLayerMark, stacked: boolean,
    layerIndex: number, into: Record<string, unknown>[], seriesLabel?: string,
  ): CartesianSeriesSpec | null => {
    const name = fieldName(rawField);
    if (!name) return null;
    if (seriesByField.has(name)) {
      err('AX174', name, `Field '${name}' is bound to multiple layers/axes; bind each source field once`);
      return null;
    }
    const obj = isObj(rawField) ? rawField : {};
    const label = seriesLabel ?? (typeof obj.label === 'string' ? obj.label : name);
    const unit = typeof obj.unit === 'string' ? obj.unit : axis.unit;
    const format = (obj.format as NumberFormatOption | undefined) ?? axis.format;
    const tickFormat = (obj.tickFormat as NumberFormatOption | undefined) ?? axis.tickFormat;
    const spec: CartesianSeriesSpec = { field: name, label, mark, stacked, axisId: axis.id, axisIndex: axis.index, layerIndex };
    seriesSpecs.push(spec);
    seriesByField.set(name, spec);
    const carrier: Record<string, unknown> = {
      ...obj, field: name, label,
      __s: `${axis.id}\0${axis.position}\0${axis.scale}\0${axis.base}\0${mark}\0${stacked}`,
    };
    if (unit !== null) carrier.unit = unit;
    if (format !== null) carrier.format = format;
    if (tickFormat !== null) carrier.tickFormat = tickFormat;
    if (axis.domain !== null) carrier.domain = axis.domain;
    into.push(carrier);
    return spec;
  };

  const numOpt = (v: unknown, fallback: number, min: number, max = Infinity) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min ? Math.min(v, max) : fallback;

  for (let layerIndex = 0; layerIndex < rawLayers.length; layerIndex++) {
    let rawLayer = rawLayers[layerIndex];
    const at = `layers[${layerIndex}]`;
    if (!isObj(rawLayer)) { err('AX174', at, 'Each layer must be an options object'); continue; }
    const kind = (rawLayer.type === 'point' ? 'scatter' : rawLayer.type) as LogicalKind;
    if (!LAYER_KINDS.includes(kind)) { err('AX174', at, `Unsupported layer type '${String(rawLayer.type)}'`); continue; }
    const yAxisId = typeof rawLayer.yAxis === 'string' ? rawLayer.yAxis : '';
    const axis = axisById.get(yAxisId) ?? (kind === 'scatter'
      ? (rawLayer.yAxis === undefined || yAxisId === 'left' ? leftAxes[0] : yAxisId === 'right' ? rightAxes[0] : undefined)
      : undefined);
    if (!axis) { err('AX174', yAxisId || `${at}.yAxis`, `Layer references unknown yAxis '${yAxisId}'`); continue; }
    if ((kind === 'bar' || kind === 'area' || kind === 'violin') && axis.scale === 'log') err('AX173', axis.id, `${kind} layer cannot bind to log axis '${axis.id}'`);

    const layerLabel = typeof rawLayer.label === 'string' && rawLayer.label.trim() ? rawLayer.label : null;
    const addMark = (label: string, roles: readonly PartRole[], fields: string[], capWidth = 0, size = 4, outliers: OutlierColumn | null = null) => {
      marks.push({ kind, label, axisId: axis.id, axisIndex: axis.index, roles, fields, capWidth, size, outliers });
    };

    if (kind === 'range' || kind === 'errorBar' || kind === 'boxplot' || kind === 'violin') {
      const violin = kind === 'violin';
      // A violin's fields default to the columns of axylo/stats violinData(), also when given as undefined.
      if (violin) rawLayer = { ...rawLayer, ...Object.fromEntries(BOX_ROLES.map(role => [role, rawLayer[role] ?? role])) };
      const box = kind === 'boxplot' || violin;
      const centerField = kind === 'errorBar' ? fieldName(rawLayer.y) : null;
      if (!box && rawLayer.y !== undefined && centerField === null) {
        opt('AX150', `${at}.y`, kind === 'range' ? "A range layer draws no centre; use an errorBar layer for 'y'." : "Name the centre's field in 'y'.");
      }
      // The first carrier is the published series. Bounds and other box statistics follow all representatives.
      const roles: readonly PartRole[] = box ? BOX_ROLES : centerField ? ['y', 'low', 'high'] : ['low', 'high'];
      const names = roles.map(role => fieldName(rawLayer[role]));
      const invalid = box ? "boxplot layer requires distinct 'min', 'q1', 'median', 'q3' and 'max' value fields"
        : `${kind} layer requires distinct 'low' and 'high' value fields`;
      if (names.some(n => !n) || new Set(names).size !== roles.length) { err('AX174', at, invalid); continue; }

      const lowField = names[names.length - 2]!, highField = names[names.length - 1]!;
      const label = layerLabel ?? (box ? names[0]! : `${lowField}–${highField}`);
      const capWidth = numOpt(rawLayer.capWidth, box ? -1 : 8, 0);
      const fields: string[] = [];
      roles.forEach((role, k) => {
        const spec = pushCarrier(rawLayer[role], axis, box ? 'line' : kind, false, layerIndex, k ? trailing : leading, k ? undefined : label);
        if (spec) fields.push(spec.field);
      });
      if (fields.length !== roles.length) { if (!box) err('AX174', at, invalid); continue; }

      if (violin) {
        const name = (key: string) => {
          const v = rawLayer[key];
          if (v !== undefined && typeof v !== 'string') err('AX174', `${at}.${key}`, `violin '${key}' must name a field of the data`);
          return typeof v === 'string' ? v : key;
        };
        if (rawLayer.inner !== undefined && rawLayer.inner !== 'box' && rawLayer.inner !== 'none') {
          opt('AX150', `${at}.inner`, "Use inner: 'box' or 'none'.");
        }
        addMark(label, roles, fields);
        marks[marks.length - 1] = { ...marks[marks.length - 1]!, violin: readViolin(src.data, fieldName(src.x), [name('grid'), name('density'), name('n'), name('bandwidth')], rawLayer.inner !== 'none', optionIssues, violinNotes) };
      } else if (box) {
        const outlierField = typeof rawLayer.outliers === 'string' ? rawLayer.outliers : null;
        if (rawLayer.outliers !== undefined && outlierField === null) {
          err('AX174', `${at}.outliers`, "boxplot 'outliers' must name a field whose values are arrays of numbers");
        }
        addMark(label, roles, fields, capWidth, numOpt(rawLayer.size, 3.5, Number.MIN_VALUE, 24), outlierField ? readOutliers(src.data, outlierField, optionIssues) : null);
      } else {
        intervals.push({ mark: kind, label, lowField, highField, centerField, axisId: axis.id, axisIndex: axis.index, layerIndex, capWidth });
        addMark(label, roles, fields, capWidth, 4.5);
      }
    } else {
      const isScatter = kind === 'scatter';
      const fields = Array.isArray(rawLayer.y) ? rawLayer.y : rawLayer.y !== undefined ? [rawLayer.y] : [];
      const size = isScatter ? numOpt(rawLayer.size, 4, Number.MIN_VALUE, 24) : 4;
      for (const rawField of fields) {
        const override = isScatter && fields.length === 1 && layerLabel ? layerLabel : undefined;
        const spec = pushCarrier(rawField, axis, isScatter ? 'line' : kind, !isScatter && rawLayer.stacked === true, layerIndex, leading, override);
        if (spec) addMark(spec.label, ['y'], [spec.field], 0, size);
      }
    }
  }

  flushViolin(violinNotes, optionIssues, new Set(marks.map(m => m.violin?.field)));

  const translatedY = [...leading, ...trailing];
  if (translatedY[0]) {
    translatedY[0].__domainSig = axesDomainSignature(orderedAxes);
    // What the carriers do not say about a layer (its true mark, sizes, caps, outlier field): a change of any of
    // them is a change of encoding, so the core builds the view, scene and readers again (review finding 4).
    translatedY[0].__layerSig = marks.map(m => `${m.kind}:${m.capWidth}:${m.size}:${m.outliers?.field ?? ''}:${m.violin?.key ?? ''}`).join();
  }

  const rawAnnotations = Array.isArray(src.annotations) ? src.annotations : [];
  if (src.annotations !== undefined && !Array.isArray(src.annotations)) opt('AX150', 'annotations', 'Supply annotations as an array.');
  const annotations: CartesianAnnotationSpec[] = [];
  for (let i = 0; i < rawAnnotations.length; i++) {
    const rawAnn = rawAnnotations[i];
    const at = `annotations[${i}]`;
    if (!isObj(rawAnn)) { opt('AX150', at, 'Each annotation must be an object with a type.'); continue; }
    const annType = rawAnn.type;
    const missing = (key: string, what: string) => opt('AX150', `${at}.${key}`, `Supply ${what}.`);
    const add = (spec: CartesianAnnotationSpec) => { annotations.push(spec); annotationPath(spec, at); };
    // `label` is required to be a string; optional text fields must also be strings when supplied.
    let bad = false;
    if (typeof rawAnn.label !== 'string') { missing('label', 'label as a string'); bad = true; }
    for (const key of ['description', 'axisId']) {
      if (rawAnn[key] !== undefined && typeof rawAnn[key] !== 'string') { missing(key, `${key} as a string`); bad = true; }
    }
    if (bad) continue;
    const label = rawAnn.label as string;
    const description = rawAnn.description as string | undefined;
    const axisId = rawAnn.axisId as string | undefined;
    const checkYAxis = () => {
      if (axisId !== undefined && !axisById.has(axisId)) err('AX174', `${at}.axisId`, `Annotation '${label || i}' targets unknown y-axis '${axisId}'`);
    };
    const log = axisById.get(axisId ?? fallbackLeft.id)?.scale === 'log';
    const yValue = (key: string): number | null => {
      const v = rawAnn[key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        if (!log || v > 0) return v;
        opt('AX171', `${at}.${key}`, 'nonpositive on a log axis');
        return null;
      }
      if (typeof v === 'number') opt('AX103', `${at}.${key}`, 'non-finite value');
      else missing(key, 'a finite number for a y-axis annotation');
      return null;
    };
    const xValue = (key: string): XValue | null => {
      const v = rawAnn[key];
      if (typeof v === 'string') return v;
      if (typeof v === 'number') {
        if (Number.isFinite(v)) return v;
        opt('AX103', `${at}.${key}`, 'non-finite value');
        return null;
      }
      if (v instanceof Date) {
        let t: number;
        try { t = Date.prototype.getTime.call(v); } catch { missing(key, 'a number, string or Date for an x position'); return null; }
        if (Number.isFinite(t)) return new Date(t);
        opt('AX103', `${at}.${key}`, 'non-finite value');
        return null;
      }
      missing(key, 'a number, string or Date for an x position');
      return null;
    };
    if (annType === 'point') {
      checkYAxis();
      const x = xValue('x');
      if (x === null) continue;
      const y = yValue('y');
      if (y !== null) add({ type: 'point', x, y, axisId, label, description });
    } else if (annType === 'threshold' || annType === 'range') {
      if (rawAnn.axis !== 'x' && rawAnn.axis !== 'y') { missing('axis', "axis: 'x' or 'y'"); continue; }
      if (rawAnn.axis === 'x') {
        if (axisId !== undefined) { opt('AX150', `${at}.axisId`, "An x-axis annotation does not accept 'axisId'."); continue; }
      } else checkYAxis();
      const keys = annType === 'threshold' ? ['value'] : ['from', 'to'];
      let ok = true;
      const values = keys.map(key => {
        const v = rawAnn.axis === 'y' ? yValue(key) : xValue(key);
        if (v === null) ok = false;
        return v;
      });
      if (!ok) continue;
      add(annType === 'threshold'
        ? { type: 'threshold', axis: rawAnn.axis, value: values[0] as never, axisId, label, description }
        : { type: 'range', axis: rawAnn.axis, from: values[0] as never, to: values[1] as never, axisId, label, description });
    } else {
      opt('AX150', `${at}.type`, "Use type 'point', 'threshold' or 'range'.");
    }
  }

  const refSpecs: CartesianReferenceSpec[] = [];
  for (const rawRef of rawRefs) {
    if (!isObj(rawRef)) continue;
    const axisKind = rawRef.x !== undefined ? 'x' : rawRef.y !== undefined ? 'y' : null;
    if (!axisKind) continue;
    const axisId = typeof rawRef.axisId === 'string' ? rawRef.axisId : undefined;
    if (axisKind === 'y' && axisId !== undefined && !axisById.has(axisId)) err('AX174', axisId, `Reference targets unknown y-axis '${axisId}'`);
    const rawVal = axisKind === 'x' ? rawRef.x : rawRef.y;
    const isBand = Array.isArray(rawVal) && rawVal.length === 2;
    refSpecs.push({
      axis: axisKind, axisId, label: typeof rawRef.label === 'string' ? rawRef.label : '',
      value: isBand ? undefined : rawVal, from: isBand ? rawVal[0] : rawVal, to: isBand ? rawVal[1] : rawVal,
    });
  }

  if (translatedY.length > 0 && (annotations.length > 0 || optionIssues.length > 0)) {
    // Structural type tag keeps Date coordinates distinct from ISO strings and avoids Date.prototype.toJSON.
    const tag = (v: unknown) => v instanceof Date ? ['date', Date.prototype.getTime.call(v)] : v;
    const annKey = annotations.map(a => a.type === 'point'
      ? [a.type, tag(a.x), a.y, a.axisId, a.label, a.description]
      : a.type === 'threshold'
        ? [a.type, a.axis, tag(a.value), a.axisId, a.label, a.description]
        : [a.type, a.axis, tag(a.from), tag(a.to), a.axisId, a.label, a.description]);
    translatedY[0]!.__annSig = JSON.stringify([annKey, optionIssues]);
  }

  const meta: CartesianMeta = {
    axes: orderedAxes, axisById, leftAxisId: fallbackLeft.id, rightAxisId: orderedAxes[1]?.id ?? null,
    series: seriesSpecs, seriesByField, intervals, annotations, references: refSpecs,
    invalid: issues.length > 0, fullPositiveDomains: previous ? new Map(previous.fullPositiveDomains) : new Map(),
  };
  registerLogical(meta, marks, optionIssues);

  const { axes: _a, layers: _l, annotations: _an, ...rest } = src;
  return { meta, issues, translated: { ...rest, y: translatedY.length === 1 ? translatedY[0] : translatedY, series: undefined } };
}

const isList = (v: unknown): v is ArrayLike<unknown> => Array.isArray(v) || (ArrayBuffer.isView(v) && 'length' in v);
const isColumn = (v: unknown): v is ArrayLike<unknown> => {
  if (typeof v !== 'object' || v === null) return false;
  const n = (v as { length?: unknown }).length;
  return Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 0x7fffffff;
};

/** Per-row outlier numbers into CSR typed arrays; caller arrays are read once and never retained. */
function readOutliers(data: unknown, field: string, issues: OptionIssue[]): OutlierColumn {
  const rows = Array.isArray(data) ? data : null;
  const rawCol = !rows && isObj(data) && isObj(data.columns) ? data.columns[field] : undefined;
  const col = isColumn(rawCol) ? rawCol : undefined;
  if (!rows && rawCol !== undefined && rawCol !== null && !col) {
    issues.push({ code: 'AX106', field, count: 1 });
    return { field, start: new Uint32Array(1), values: new Float64Array(0) };
  }
  const len = rows ? rows.length : col ? col.length : 0;
  const at = (r: number): unknown => rows ? (isObj(rows[r]) ? rows[r][field] : undefined) : col![r];
  const start = new Uint32Array(len + 1);
  let total = 0, nfCount = 0, badCount = 0;
  const nfRows: number[] = [], badRows: number[] = [];
  const note = (list: number[], r: number) => { if (list.length < 10 && list[list.length - 1] !== r) list.push(r); };
  const record = (v: unknown, r: number, visit: (n: number) => void, check: boolean) => {
    if (typeof v === 'number') {
      if (Number.isFinite(v)) visit(v);
      else if (check) { nfCount++; note(nfRows, r); }
    } else if (check) { badCount++; note(badRows, r); }
  };
  const each = (cell: unknown, r: number, visit: (v: number) => void, check: boolean) => {
    if (cell === undefined || cell === null) return;
    if (!isList(cell)) { record(cell, r, visit, check); return; }
    for (let k = 0; k < cell.length; k++) record(cell[k], r, visit, check);
  };
  for (let r = 0; r < len; r++) { start[r] = total; each(at(r), r, () => { total++; }, true); }
  if (nfCount) issues.push({ code: 'AX103', field, count: nfCount, rows: nfRows });
  if (badCount) issues.push({ code: 'AX106', field, count: badCount, rows: badRows });
  start[len] = total;
  const values = new Float64Array(total);
  let o = 0;
  for (let r = 0; r < len; r++) each(at(r), r, v => { values[o++] = v; }, false);
  return { field, start, values };
}

export function createCartesianResolver(_stateRef: CartesianStateRef, pendingIssues: { list: readonly ValidationIssue[] }): Composition['resolve'] {
  return (kind, options, sink, table): ResolvedOptions => {
    for (const issue of pendingIssues.list) reportCartesian(sink, issue.code, 'chart-error', { field: issue.field, detail: issue.detail });
    const src = isObj(options) ? options : {};
    const clean = (item: unknown): unknown => {
      if (!isObj(item)) return item;
      const out: Record<string, unknown> = {};
      for (const k in item) if (!k.startsWith('__')) out[k] = item[k];
      return out;
    };
    const cleaned: Record<string, unknown> = { ...src, y: Array.isArray(src.y) ? src.y.map(clean) : clean(src.y) };
    if (Array.isArray(src.reference)) cleaned.reference = src.reference.map(r => (isObj(r) ? (({ axisId: _a, ...rest }) => rest)(r) : r));
    return resolveOptions(kind, cleaned, sink, table);
  };
}
