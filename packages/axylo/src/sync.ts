/**
 * Opt-in linked hover & zoom synchronization (`axylo/sync`, C5.3).
 *
 * Guarantees:
 * - Single propagation per gesture via reentrancy guard (zero feedback loops).
 * - Explicit x-kind & unit compatibility checks (`onMismatch` callback on incompatible peers).
 * - Deterministic handling of unmatched x values (`'clear' | 'ignore' | 'nearest'`).
 * - Clean per-peer `detach()` and full `destroy()` leaving 0/0/0 net listeners/observers/DOM nodes
 *   while surviving peers keep their focus and synchronization intact.
 * - Zero DOM dependencies at import time and 0 raw bytes on bare import (`ignoreAnnotations: true`).
 */
import type { ChartEvents, Point, XValue } from './public.js';

export type SyncXKind = 'number' | 'time' | 'date' | 'category';
export type UnmatchedHoverPolicy = 'clear' | 'ignore' | 'nearest';

/** Structural chart handle accepted by `axylo/sync` (compatible with `Chart`, `StaticChart`, and `StaticCartesianChart`). */
export interface SyncableChart<Row = unknown> {
  zoom(domain: readonly [XValue, XValue] | null): void;
  on<E extends keyof ChartEvents<Row>>(event: E, listener: (payload: ChartEvents<Row>[E]) => void): () => void;
  destroy?(): void;
}

export interface SyncOrigin {
  readonly sourceId: string;
  readonly kind: 'hover' | 'zoom';
}

export interface SyncMismatch {
  readonly sourceId: string;
  readonly targetId: string;
  readonly kind: 'hover' | 'zoom';
  readonly reason: 'x-kind-mismatch' | 'unit-mismatch';
  readonly sourceXKind: SyncXKind | null;
  readonly targetXKind: SyncXKind | null;
  readonly sourceUnit: string | null;
  readonly targetUnit: string | null;
}

export interface SyncMemberOptions<Row = unknown> {
  /** Stable identifier for this member in origin/mismatch metadata. */
  readonly id?: string;
  /** Optional declared x-axis kind; inferred from payload values when omitted. */
  readonly xKind?: SyncXKind;
  /** Optional x-axis unit (e.g. `'ms'`, `'USD'`); peers with differing non-null units do not cross-sync. */
  readonly xUnit?: string | null;
  /** Participate in hover synchronization. Default `true`. */
  readonly hover?: boolean;
  /** Participate in zoom synchronization. Default `true`. */
  readonly zoom?: boolean;
  /** Optional known x values for deterministic unmatched-x handling (`'clear' | 'ignore' | 'nearest'`). */
  readonly xValues?: readonly XValue[];
  /** Custom x resolver mapping an incoming synced `x` to a local `XValue` or `null` if unmatched. */
  readonly resolveX?: (x: XValue) => XValue | null;
  /** Invoked on this peer when another peer broadcasts a compatible hover change (or clear). */
  readonly onHoverSync?: (point: Point<Row> | null, origin: SyncOrigin) => void;
  /** Invoked on this peer after a compatible zoom domain is applied. */
  readonly onZoomSync?: (domain: readonly [XValue, XValue] | null, origin: SyncOrigin) => void;
}

export interface SyncGroupOptions {
  /** Enable hover synchronization across attached peers. Default `true`. */
  readonly hover?: boolean;
  /** Enable zoom synchronization across attached peers. Default `true`. */
  readonly zoom?: boolean;
  /** Policy when a synced hover `x` does not exist in a target peer's `xValues` / `resolveX`. Default `'clear'`. */
  readonly unmatchedHover?: UnmatchedHoverPolicy;
  /** Called whenever a source and target peer have incompatible x-kinds or units. */
  readonly onMismatch?: (info: SyncMismatch) => void;
}

export interface SyncGroup {
  attach<Row = unknown>(chart: SyncableChart<Row>, options?: SyncMemberOptions<Row>): () => void;
  detach(chart: SyncableChart<unknown>): void;
  syncHover(x: XValue | null, sourceId?: string): void;
  syncZoom(domain: readonly [XValue, XValue] | null, sourceId?: string): void;
  readonly size: number;
  destroy(): void;
}

interface MemberRecord {
  readonly id: string;
  readonly chart: SyncableChart<unknown>;
  readonly declaredKind: SyncXKind | null;
  inferredKind: SyncXKind | null;
  readonly xUnit: string | null;
  readonly hover: boolean;
  readonly zoom: boolean;
  readonly xValues: readonly XValue[] | null;
  readonly resolveX: ((x: XValue) => XValue | null) | null;
  readonly onHoverSync: ((point: Point<unknown> | null, origin: SyncOrigin) => void) | null;
  readonly onZoomSync: ((domain: readonly [XValue, XValue] | null, origin: SyncOrigin) => void) | null;
  unsubHover: (() => void) | null;
  unsubZoom: (() => void) | null;
  detached: boolean;
}

const ISO_DATE_RE = /^\d{4}-\d{2}(?:-\d{2})?$/;

function inferXKind(value: XValue): SyncXKind {
  if (typeof value === 'number') return 'number';
  if (value instanceof Date) return 'time';
  if (typeof value === 'string' && ISO_DATE_RE.test(value)) return 'date';
  return 'category';
}

function numericValueOf(value: XValue): number {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && ISO_DATE_RE.test(value)) {
    const parsed = Date.parse(value.length === 7 ? `${value}-01T00:00:00Z` : `${value}T00:00:00Z`);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function sameXValue(a: XValue, b: XValue): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return Object.is(a, b);
}

function matchXForMember(
  member: MemberRecord,
  x: XValue,
  policy: UnmatchedHoverPolicy,
): { matched: true; x: XValue } | { matched: false; action: 'clear' | 'ignore' } {
  if (member.resolveX) {
    const resolved = member.resolveX(x);
    if (resolved !== null) return { matched: true, x: resolved };
    return { matched: false, action: policy === 'ignore' ? 'ignore' : 'clear' };
  }
  const list = member.xValues;
  if (!list) return { matched: true, x };
  for (let i = 0; i < list.length; i++) {
    if (sameXValue(list[i]!, x)) return { matched: true, x: list[i]! };
  }
  if (policy === 'nearest' && list.length > 0) {
    const targetNum = numericValueOf(x);
    if (Number.isFinite(targetNum)) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < list.length; i++) {
        const curNum = numericValueOf(list[i]!);
        if (!Number.isFinite(curNum)) continue;
        const dist = Math.abs(curNum - targetNum);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) return { matched: true, x: list[bestIdx]! };
    }
  }
  return { matched: false, action: policy === 'ignore' ? 'ignore' : 'clear' };
}

function memberKind(m: MemberRecord): SyncXKind | null {
  return m.declaredKind ?? m.inferredKind;
}

function checkCompatible(
  sourceId: string,
  sourceKind: SyncXKind | null,
  sourceUnit: string | null,
  target: MemberRecord,
  kind: 'hover' | 'zoom',
  onMismatch: ((info: SyncMismatch) => void) | undefined,
): boolean {
  const targetKind = memberKind(target);
  if (sourceKind !== null && targetKind !== null && sourceKind !== targetKind) {
    onMismatch?.({
      sourceId,
      targetId: target.id,
      kind,
      reason: 'x-kind-mismatch',
      sourceXKind: sourceKind,
      targetXKind: targetKind,
      sourceUnit,
      targetUnit: target.xUnit,
    });
    return false;
  }
  if (sourceUnit !== null && target.xUnit !== null && sourceUnit !== target.xUnit) {
    onMismatch?.({
      sourceId,
      targetId: target.id,
      kind,
      reason: 'unit-mismatch',
      sourceXKind: sourceKind,
      targetXKind: targetKind,
      sourceUnit,
      targetUnit: target.xUnit,
    });
    return false;
  }
  return true;
}

/** Creates an explicit synchronization group linking hover and/or zoom across compatible Axylo charts. */
export function createSyncGroup(options: SyncGroupOptions = {}): SyncGroup {
  const enableHover = options.hover !== false;
  const enableZoom = options.zoom !== false;
  const unmatchedPolicy: UnmatchedHoverPolicy = options.unmatchedHover ?? 'clear';
  const onMismatch = options.onMismatch;

  const members = new Map<SyncableChart<unknown>, MemberRecord>();
  let nextId = 1;
  let propagating = false;
  let destroyed = false;

  function broadcastHover(
    source: MemberRecord | null,
    sourceId: string,
    payload: Point<unknown> | null,
  ): void {
    if (destroyed || propagating || !enableHover) return;
    const payloadKind = payload ? inferXKind(payload.x) : null;
    if (source && payloadKind && !source.declaredKind) source.inferredKind = payloadKind;
    const srcKind = source ? (memberKind(source) ?? payloadKind) : payloadKind;
    const srcUnit = source ? source.xUnit : null;
    const origin: SyncOrigin = { sourceId, kind: 'hover' };

    propagating = true;
    try {
      for (const target of [...members.values()]) {
        if (target.detached || target === source || !target.hover || !target.onHoverSync) continue;
        if (payload === null) {
          target.onHoverSync(null, origin);
          continue;
        }
        if (!checkCompatible(sourceId, srcKind, srcUnit, target, 'hover', onMismatch)) continue;
        const resolved = matchXForMember(target, payload.x, unmatchedPolicy);
        if (resolved.matched) {
          target.onHoverSync(
            { series: payload.series, x: resolved.x, y: payload.y, row: null, index: -1 },
            origin,
          );
        } else if (resolved.action === 'clear') {
          target.onHoverSync(null, origin);
        }
      }
    } finally {
      propagating = false;
    }
  }

  function broadcastZoom(
    source: MemberRecord | null,
    sourceId: string,
    domain: readonly [XValue, XValue] | null,
  ): void {
    if (destroyed || propagating || !enableZoom) return;
    const payloadKind = domain ? inferXKind(domain[0]) : null;
    if (source && payloadKind && !source.declaredKind) source.inferredKind = payloadKind;
    const srcKind = source ? (memberKind(source) ?? payloadKind) : payloadKind;
    const srcUnit = source ? source.xUnit : null;
    const origin: SyncOrigin = { sourceId, kind: 'zoom' };

    propagating = true;
    try {
      for (const target of [...members.values()]) {
        if (target.detached || target === source || !target.zoom) continue;
        if (domain !== null && !checkCompatible(sourceId, srcKind, srcUnit, target, 'zoom', onMismatch)) {
          continue;
        }
        target.chart.zoom(domain);
        target.onZoomSync?.(domain, origin);
      }
    } finally {
      propagating = false;
    }
  }

  function detachMember(chart: SyncableChart<unknown>): void {
    const rec = members.get(chart);
    if (!rec) return;
    rec.detached = true;
    members.delete(chart);
    rec.unsubHover?.();
    rec.unsubZoom?.();
  }

  return {
    attach<Row = unknown>(chart: SyncableChart<Row>, memberOptions: SyncMemberOptions<Row> = {}): () => void {
      const key = chart as unknown as SyncableChart<unknown>;
      if (destroyed) return () => {};
      if (members.has(key)) detachMember(key);

      const id = memberOptions.id ?? `chart-${nextId++}`;
      const hover = memberOptions.hover !== false;
      const zoom = memberOptions.zoom !== false;
      const xValues = memberOptions.xValues ?? null;
      const inferredFromValues = xValues && xValues.length > 0 ? inferXKind(xValues[0]!) : null;

      const rec: MemberRecord = {
        id,
        chart: key,
        declaredKind: memberOptions.xKind ?? null,
        inferredKind: inferredFromValues,
        xUnit: memberOptions.xUnit ?? null,
        hover,
        zoom,
        xValues,
        resolveX: memberOptions.resolveX ?? null,
        onHoverSync: (memberOptions.onHoverSync as ((point: Point<unknown> | null, origin: SyncOrigin) => void) | undefined) ?? null,
        onZoomSync: memberOptions.onZoomSync ?? null,
        unsubHover: null,
        unsubZoom: null,
        detached: false,
      };

      if (enableHover && hover) {
        rec.unsubHover = key.on('hover', payload => { broadcastHover(rec, rec.id, payload); });
      }
      if (enableZoom && zoom) {
        rec.unsubZoom = key.on('zoom', domain => { broadcastZoom(rec, rec.id, domain); });
      }
      members.set(key, rec);
      return () => { detachMember(key); };
    },

    detach(chart: SyncableChart<unknown>): void {
      detachMember(chart);
    },

    syncHover(x: XValue | null, sourceId = 'external'): void {
      broadcastHover(null, sourceId, x === null ? null : { series: '', x, y: null, row: null, index: -1 });
    },

    syncZoom(domain: readonly [XValue, XValue] | null, sourceId = 'external'): void {
      broadcastZoom(null, sourceId, domain);
    },

    get size(): number {
      return members.size;
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      for (const chart of [...members.keys()]) detachMember(chart);
      members.clear();
    },
  };
}

/** Convenience helper that attaches an array of charts to a new `SyncGroup`. */
export function syncCharts(
  charts: readonly (SyncableChart<unknown> | { readonly chart: SyncableChart<unknown>; readonly options?: SyncMemberOptions<unknown> })[],
  options?: SyncGroupOptions,
): SyncGroup {
  const group = createSyncGroup(options);
  for (const item of charts) {
    if ('chart' in item && typeof item.chart?.on === 'function') {
      group.attach(item.chart, item.options);
    } else {
      group.attach(item as SyncableChart<unknown>);
    }
  }
  return group;
}

export type { ChartEvents, Point, XValue } from './public.js';
