/**
 * Option parsing, validation (`AX170`, `AX173`, `AX174`), and translation facade for `axylo/cartesian`
 * (RFC C4.1 §2.1 & §6). Translates `{ x, axes, layers, reference, ...rest }` into the carrier `'line'`
 * options shape so `ChartController`'s `encodingChanged`, `namesOnlyChanged`, and `renamed()` work
 * seamlessly with 0 edits to `controller.ts` or `stages.ts`.
 */
import type { DiagnosticSink } from '../core/contracts';
import type { Composition } from '../core/composition';
import { resolveOptions, type ResolvedOptions } from '../data/options';
import type { NumberFormatOption } from '../format';
import { isValidLogBase, isValidLogDomain, type LogBase, type Span } from '../scale/log';
import { reportCartesian } from './diagnostics';
import {
  axesDomainSignature, type CartesianAnnotationSpec, type CartesianAxisSpec, type CartesianIntervalSpec,
  type CartesianLayerMark, type CartesianMeta, type CartesianReferenceSpec, type CartesianSeriesSpec,
  type CartesianStateRef,
} from './meta';

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

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function normalizeFieldList(y: unknown): readonly unknown[] {
  return Array.isArray(y) ? y : y !== undefined ? [y] : [];
}

function fieldNameOf(spec: unknown): string | null {
  if (typeof spec === 'string') return spec;
  if (isObject(spec) && typeof spec.field === 'string') return spec.field;
  return null;
}

function parseDomain(raw: unknown): Span | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const a = Number(raw[0]);
  const b = Number(raw[1]);
  return [a, b];
}

export function parseCartesianInput(input: unknown, previous?: CartesianMeta | null): ParsedCartesian {
  const src = isObject(input) ? input : {};
  const issues: ValidationIssue[] = [];
  const rawAxes = isObject(src.axes) ? src.axes : null;
  const rawLayers = Array.isArray(src.layers) ? src.layers : [];
  const rawRefs = Array.isArray(src.reference) ? src.reference : [];

  const leftAxes: CartesianAxisSpec[] = [];
  const rightAxes: CartesianAxisSpec[] = [];
  const axisById = new Map<string, CartesianAxisSpec>();

  if (!rawAxes || Object.keys(rawAxes).length === 0) {
    issues.push({ code: 'AX174', field: 'axes', detail: 'Option `axes` must declare at least one left y-axis' });
  } else {
    const entries = Object.entries(rawAxes);
    if (entries.length > 2) {
      issues.push({ code: 'AX174', field: 'axes', detail: `Declared ${entries.length} y-axes; at most 2 ('left' and 'right') are supported` });
    }
    for (const [id, raw] of entries) {
      if (!isObject(raw)) {
        issues.push({ code: 'AX174', field: id, detail: `Axis '${id}' must be an options object` });
        continue;
      }
      const pos = raw.position === 'right' ? 'right' : raw.position === 'left' ? 'left' : null;
      if (!pos) {
        issues.push({ code: 'AX174', field: id, detail: `Axis '${id}' must declare position: 'left' | 'right'` });
        continue;
      }
      const scale: 'linear' | 'log' = raw.scale === 'log' ? 'log' : 'linear';
      if (raw.scale !== undefined && raw.scale !== 'linear' && raw.scale !== 'log') {
        issues.push({ code: 'AX174', field: id, detail: `Axis '${id}' has unsupported scale '${String(raw.scale)}'` });
      }
      const rawBase = raw.base;
      const base: LogBase = isValidLogBase(rawBase) ? rawBase : 10;
      const rawDomain = raw.domain;
      const domain = parseDomain(rawDomain);
      if (scale === 'log') {
        if (rawBase !== undefined && !isValidLogBase(rawBase)) {
          issues.push({ code: 'AX170', field: id, detail: `unsupported log base ${String(rawBase)}` });
        }
        if (rawDomain !== undefined && (!domain || !isValidLogDomain(domain))) {
          issues.push({ code: 'AX170', field: id, detail: 'log domain must be strictly positive [min, max] with min < max' });
        }
      }
      const spec: CartesianAxisSpec = {
        id,
        index: pos === 'left' ? 0 : 1,
        position: pos,
        scale,
        base,
        rawBase,
        domain,
        rawDomain,
        label: typeof raw.label === 'string' ? raw.label : null,
        unit: typeof raw.unit === 'string' ? raw.unit : null,
        format: (raw.format as NumberFormatOption | undefined) ?? null,
        tickFormat: (raw.tickFormat as NumberFormatOption | undefined) ?? null,
      };
      if (pos === 'left') leftAxes.push(spec);
      else rightAxes.push(spec);
      axisById.set(id, spec);
    }
    if (leftAxes.length === 0) {
      issues.push({ code: 'AX174', field: 'axes', detail: "Option `axes` must declare exactly one 'left' y-axis (found 0)" });
    } else if (leftAxes.length > 1) {
      issues.push({ code: 'AX174', field: 'axes', detail: `Option \`axes\` declared ${leftAxes.length} 'left' y-axes; at most 1 is allowed` });
    }
    if (rightAxes.length > 1) {
      issues.push({ code: 'AX174', field: 'axes', detail: `Option \`axes\` declared ${rightAxes.length} 'right' y-axes; at most 1 is allowed` });
    }
  }

  const orderedAxes: CartesianAxisSpec[] = [];
  if (leftAxes[0]) orderedAxes.push(leftAxes[0]);
  if (rightAxes[0]) orderedAxes.push(rightAxes[0]);
  // Fallback synthetic left axis if invalid so downstream stages never throw TypeError before diagnostics deliver.
  const fallbackLeft: CartesianAxisSpec = orderedAxes[0] ?? {
    id: 'y', index: 0, position: 'left', scale: 'linear', base: 10, domain: null,
    label: null, unit: null, format: null, tickFormat: null,
  };
  if (orderedAxes.length === 0) orderedAxes.push(fallbackLeft);

  const seriesSpecs: CartesianSeriesSpec[] = [];
  const seriesByField = new Map<string, CartesianSeriesSpec>();
  const intervals: CartesianIntervalSpec[] = [];
  const translatedY: Record<string, unknown>[] = [];
  const domainSig = axesDomainSignature(orderedAxes);

  if (rawLayers.length === 0) {
    issues.push({ code: 'AX174', field: 'layers', detail: 'Option `layers` must include at least one layer' });
  }

  const pushCarrierField = (
    rawField: unknown,
    axis: CartesianAxisSpec,
    mark: CartesianLayerMark,
    stacked: boolean,
    layerIndex: number,
  ): string | null => {
    const name = fieldNameOf(rawField);
    if (!name) return null;
    if (seriesByField.has(name)) {
      issues.push({
        code: 'AX174',
        field: name,
        detail: `Field '${name}' is bound to multiple layers/axes; bind each source field once`,
      });
      return null;
    }
    const fieldObj = isObject(rawField) ? rawField : {};
    const label = typeof fieldObj.label === 'string' ? fieldObj.label : name;
    const unit = typeof fieldObj.unit === 'string' ? fieldObj.unit : axis.unit;
    const format = (fieldObj.format as NumberFormatOption | undefined) ?? axis.format;
    const tickFormat = (fieldObj.tickFormat as NumberFormatOption | undefined) ?? axis.tickFormat;
    const spec: CartesianSeriesSpec = {
      field: name,
      label,
      mark,
      stacked,
      axisId: axis.id,
      axisIndex: axis.index,
      layerIndex,
    };
    seriesSpecs.push(spec);
    seriesByField.set(name, spec);

    const carrier: Record<string, unknown> = {
      ...fieldObj,
      field: name,
      label,
      ...(unit !== null ? { unit } : {}),
      ...(format !== null ? { format } : {}),
      ...(tickFormat !== null ? { tickFormat } : {}),
      ...(axis.domain !== null ? { domain: axis.domain } : {}),
      __axisId: axis.id,
      __axisPos: axis.position,
      __axisScale: axis.scale,
      __axisBase: axis.base,
      __mark: mark,
      __stacked: stacked,
      ...(translatedY.length === 0 ? { __domainSig: domainSig } : {}),
    };
    translatedY.push(carrier);
    return name;
  };

  for (let layerIndex = 0; layerIndex < rawLayers.length; layerIndex++) {
    const rawLayer = rawLayers[layerIndex];
    if (!isObject(rawLayer)) {
      issues.push({ code: 'AX174', field: `layers[${layerIndex}]`, detail: 'Each layer must be an options object' });
      continue;
    }
    const mark = rawLayer.type as CartesianLayerMark;
    if (mark !== 'bar' && mark !== 'area' && mark !== 'line' && mark !== 'range' && mark !== 'errorBar') {
      issues.push({ code: 'AX174', field: `layers[${layerIndex}]`, detail: `Unsupported layer type '${String(rawLayer.type)}'` });
      continue;
    }
    const yAxisId = typeof rawLayer.yAxis === 'string' ? rawLayer.yAxis : '';
    const axis = axisById.get(yAxisId);
    if (!axis) {
      issues.push({ code: 'AX174', field: yAxisId || `layers[${layerIndex}].yAxis`, detail: `Layer references unknown yAxis '${yAxisId}'` });
      continue;
    }
    if ((mark === 'bar' || mark === 'area') && axis.scale === 'log') {
      issues.push({ code: 'AX173', field: axis.id, detail: `${mark} layer cannot bind to log axis '${axis.id}'` });
    }
    if (mark === 'range' || mark === 'errorBar') {
      const lowName = pushCarrierField(rawLayer.low, axis, mark, false, layerIndex);
      const highName = pushCarrierField(rawLayer.high, axis, mark, false, layerIndex);
      const centerName = rawLayer.y !== undefined ? pushCarrierField(rawLayer.y, axis, mark, false, layerIndex) : null;
      if (!lowName || !highName) {
        issues.push({ code: 'AX174', field: `layers[${layerIndex}]`, detail: `${mark} layer requires distinct 'low' and 'high' value fields` });
        continue;
      }
      const capWidth = typeof rawLayer.capWidth === 'number' && Number.isFinite(rawLayer.capWidth) && rawLayer.capWidth >= 0
        ? rawLayer.capWidth : 8;
      intervals.push({
        mark,
        label: typeof rawLayer.label === 'string' && rawLayer.label.trim() ? rawLayer.label : `${lowName}–${highName}`,
        lowField: lowName,
        highField: highName,
        centerField: centerName,
        axisId: axis.id,
        axisIndex: axis.index,
        layerIndex,
        capWidth,
      });
      continue;
    }
    const stacked = rawLayer.stacked === true;
    const fields = normalizeFieldList(rawLayer.y);
    for (const rawField of fields) {
      pushCarrierField(rawField, axis, mark, stacked, layerIndex);
    }
  }

  // Parse opt-in annotations (C5.2: point event markers, labelled thresholds, shaded x/y ranges)
  const rawAnnotations = Array.isArray(src.annotations) ? src.annotations : [];
  const annotations: CartesianAnnotationSpec[] = [];
  for (let i = 0; i < rawAnnotations.length; i++) {
    const rawAnn = rawAnnotations[i];
    if (!isObject(rawAnn)) continue;
    const annType = rawAnn.type;
    const label = typeof rawAnn.label === 'string' ? rawAnn.label : '';
    const description = typeof rawAnn.description === 'string' ? rawAnn.description : undefined;
    const axisId = typeof rawAnn.axisId === 'string' ? rawAnn.axisId : undefined;
    if (axisId !== undefined && !axisById.has(axisId)) {
      issues.push({ code: 'AX174', field: axisId, detail: `Annotation '${label || i}' targets unknown y-axis '${axisId}'` });
    }
    if (annType === 'point' && rawAnn.x !== undefined && typeof rawAnn.y === 'number' && Number.isFinite(rawAnn.y)) {
      annotations.push({ type: 'point', x: rawAnn.x as never, y: rawAnn.y, axisId, label, description });
    } else if (annType === 'threshold' && (rawAnn.axis === 'x' || rawAnn.axis === 'y') && rawAnn.value !== undefined) {
      annotations.push({ type: 'threshold', axis: rawAnn.axis, value: rawAnn.value as never, axisId, label, description });
    } else if (annType === 'range' && (rawAnn.axis === 'x' || rawAnn.axis === 'y') && rawAnn.from !== undefined && rawAnn.to !== undefined) {
      annotations.push({ type: 'range', axis: rawAnn.axis, from: rawAnn.from as never, to: rawAnn.to as never, axisId, label, description });
    }
  }

  // Validate references (native Axylo Reference shape: { x, label } or { y, axisId?, label })
  const refSpecs: CartesianReferenceSpec[] = [];
  for (const rawRef of rawRefs) {
    if (!isObject(rawRef)) continue;
    const axisKind = rawRef.x !== undefined ? 'x' : rawRef.y !== undefined ? 'y' : null;
    if (!axisKind) continue;
    const axisId = typeof rawRef.axisId === 'string' ? rawRef.axisId : undefined;
    if (axisKind === 'y' && axisId !== undefined && !axisById.has(axisId)) {
      issues.push({ code: 'AX174', field: axisId, detail: `Reference targets unknown y-axis '${axisId}'` });
    }
    const rawVal = axisKind === 'x' ? rawRef.x : rawRef.y;
    const isBand = Array.isArray(rawVal) && rawVal.length === 2;
    refSpecs.push({
      axis: axisKind,
      axisId,
      label: typeof rawRef.label === 'string' ? rawRef.label : '',
      value: isBand ? undefined : rawVal,
      from: isBand ? rawVal[0] : rawVal,
      to: isBand ? rawVal[1] : rawVal,
    });
  }

  const meta: CartesianMeta = {
    axes: orderedAxes,
    axisById,
    leftAxisId: fallbackLeft.id,
    rightAxisId: orderedAxes[1]?.id ?? null,
    series: seriesSpecs,
    seriesByField,
    intervals,
    annotations,
    references: refSpecs,
    invalid: issues.length > 0,
    fullPositiveDomains: previous ? new Map(previous.fullPositiveDomains) : new Map(),
  };

  // Strip Cartesian-only top-level keys (`axes`, `layers`, `annotations`) so resolveOptions does not emit AX150!
  const { axes: _axes, layers: _layers, annotations: _annotations, ...rest } = src;
  const translated: Record<string, unknown> = {
    ...rest,
    y: translatedY.length === 1 ? translatedY[0] : translatedY,
    series: undefined,
  };
  return { meta, issues, translated };
}

export function createCartesianResolver(stateRef: CartesianStateRef, pendingIssues: { list: readonly ValidationIssue[] }): Composition['resolve'] {
  return (kind, options, sink, table): ResolvedOptions => {
    for (const issue of pendingIssues.list) {
      reportCartesian(sink, issue.code, 'chart-error', { field: issue.field, detail: issue.detail });
    }
    // Strip internal `__*` tracking keys from y specs before resolveOptions inspects option keys (avoids AX150).
    const cleaned = stripCarrierKeys(isObject(options) ? options : {});
    return resolveOptions(kind, cleaned, sink, table);
  };
}

function stripCarrierKeys(options: Record<string, unknown>): Record<string, unknown> {
  const cleanField = (item: unknown): unknown => {
    if (!isObject(item)) return item;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item)) {
      if (!k.startsWith('__')) out[k] = v;
    }
    return out;
  };
  const y = options.y;
  const cleanedY = Array.isArray(y) ? y.map(cleanField) : cleanField(y);
  const refs = Array.isArray(options.reference)
    ? options.reference.map(r => (isObject(r) ? (({ axisId: _a, ...rest }) => rest)(r) : r))
    : options.reference;
  return { ...options, y: cleanedY, ...(refs !== undefined ? { reference: refs } : {}) };
}
