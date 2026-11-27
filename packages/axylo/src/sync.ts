/**
 * Opt-in linked hover and zoom (`axylo/sync`, C5.3; peer-local cursors N6) and the multi-panel dashboard (N6).
 *
 * One module, so the packed `dist/sync.d.ts` depends only on `dist/public.d.ts` (the tarball ships no per-file
 * declarations). The group comes before the dashboard: a page that imports only the group still tree-shakes the
 * dashboard away, and nothing runs at import time (0 raw bytes on bare import).
 *
 * Linked hover and zoom across charts:
 * - Single propagation per gesture via a reentrancy guard (zero feedback loops).
 * - Explicit x-kind and unit compatibility checks (`onMismatch` on incompatible peers).
 * - Unmatched x values handled by policy (`'clear' | 'ignore' | 'nearest'`).
 * - An Axylo chart in the group shows the hover of a peer as its own passive cursor: the x is resolved
 *   against the chart's committed frame and lookup, and its crosshair and readout show its own datum and y.
 *   Showing it raises no hover event, takes no focus and announces nothing (core/peer.ts, dom/interaction.ts).
 * - Clean per-peer `detach()` and full `destroy()`.
 *
 * The dashboard: a responsive grid of charts that the caller's factories make, linked by one sync group (hover,
 * and the shared x window: zoom, brushing and reset). It imports no chart kind, so a page pays only for the kinds
 * its factories use. It writes no `<style>` and no style attribute in markup: the grid is set through the
 * element's style object, which a strict Content Security Policy allows. Panels are at least `minPanelWidth` wide
 * and fill the row; a container narrower than two of them (a 320 px viewport) stacks them in one column, with no
 * listener or observer of its own. Everything it makes is undone in reverse order (group membership, chart, panel
 * element, then the grid), on `remove`, on `destroy`, and when a factory throws part-way through, also for an
 * element the page has disconnected meanwhile. It removes only the elements it made.
 */
import type { ChartEvents, Point, Target, XValue } from './public.js';
import type { DatumRef, Layout, Lookup, PickTarget, View } from './core/contracts';
import { SYNC, type SyncCapable, type SyncResolve, type SyncSeam } from './core/peer';

/** `'wall'`: date-times written without an offset (shown as written); declared only, or read from a chart's frame. */
export type SyncXKind = 'number' | 'time' | 'date' | 'wall' | 'category';
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
  readonly c: SyncableChart<unknown>;
  /** The chart's own seam (core/peer.ts): present on Axylo charts, absent on structural handles. */
  readonly s: SyncSeam | null;
  readonly o: SyncMemberOptions<unknown>;
  ik: SyncXKind | null;
  readonly u: (() => void)[];
  by?: object | null;
  off?: boolean;
}

const ISO_DATE_RE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})?$/i;
const ISO_OFFSET_RE = /(?:z|[+-]\d{2}:?\d{2})$/i;

function inferXKind(value: XValue): SyncXKind {
  return typeof value === 'number' ? 'number'
    : value instanceof Date ? 'time'
    : typeof value !== 'string' ? 'category'
    : ISO_DATE_RE.test(value) ? 'date'
    : ISO_DATETIME_RE.test(value) ? (ISO_OFFSET_RE.test(value) ? 'time' : 'wall') : 'category';
}

function numericValueOf(value: XValue, asTime?: boolean): number {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return +value;
  if (typeof value !== 'string') return NaN;
  const d = ISO_DATE_RE.test(value) ? value + '-01-01'.slice(value.length - 4) : '';
  const iso = d ? d + 'T00:00' : ISO_DATETIME_RE.test(value) || asTime ? value.replace(' ', 'T') : '';
  const ms = iso ? Date.parse(ISO_OFFSET_RE.test(iso) ? iso : iso + 'Z') : NaN;
  return !d || new Date(ms).toJSON()?.slice(0, 10) === d ? ms : NaN;
}

function matchXForMember(member: MemberRecord, x: XValue, nearest: boolean): XValue | null {
  if (member.o.resolveX) return member.o.resolveX(x);
  const { xValues } = member.o;
  if (!xValues) return x;
  const k = memberKind(member) ?? inferXKind(x);
  const asTime = k === 'time';
  const targetNum = k === 'category' ? NaN : numericValueOf(x, asTime);
  let best: XValue | null = null, bestDist = Infinity;
  for (const v of xValues) {
    if (v === x) return v;
    if (isFinite(targetNum)) {
      const dist = Math.abs(numericValueOf(v, asTime) - targetNum);
      if (dist === 0) return v;
      if (nearest && dist < bestDist) { bestDist = dist; best = v; }
    }
  }
  return best;
}

/** Authoritative x kind of a committed view (donut has no x axis). */
const viewKind = (v: View): SyncXKind | null =>
  v.kind === 'donut' ? null : v.kind === 'scatter' ? v.frame.xKind : v.frame.x.kind;

const memberKind = (m: MemberRecord): SyncXKind | null =>
  m.s?.drawn ? viewKind(m.s.drawn.accepted.view) : m.o.xKind ?? m.ik;

let categoryIndex: WeakMap<readonly string[], Map<string, number>> | undefined;

function lowerBound(values: Float64Array, lo: number, hi: number, p: number): number {
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (values[mid]! < p) lo = mid + 1; else hi = mid; }
  return lo;
}

/**
 * The peer's own target and datum at `x`: rechecks the authoritative frame kind on every commit, then binary-
 * searches the committed view's borrowed typed x column(s) within visibleSlots / visiblePoints. Donut views
 * have no x axis and resolve to null. Returns `1` when `allowClipped` is set and `x` matches a datum in the
 * full frame hidden only by zoom clipping.
 */
function resolveLocal(
  view: View,
  lookup: Lookup,
  layout: Layout | undefined,
  x: XValue,
  nearest: boolean,
  expectedKind: SyncXKind | null,
  allowClipped?: boolean,
): { readonly t: PickTarget; readonly ref: DatumRef } | 1 | null {
  if (!expectedKind || viewKind(view) !== expectedKind) return null;
  const v = view as Exclude<View, { kind: 'donut' }>;
  let p: number;
  if (expectedKind === 'category') {
    const names = (v as Exclude<View, { kind: 'donut' | 'scatter' }>).frame.x.categories;
    if (!names) return null;
    // Built once per category list, so a hover over a long category axis does not scan it.
    let index = categoryIndex?.get(names);
    if (!index) {
      index = new Map();
      // Reverse order keeps the first index on duplicate category names without a `has` check.
      for (let i = names.length; i--; ) index.set(names[i]!, i);
      (categoryIndex ??= new WeakMap()).set(names, index);
    }
    p = index.get(String(x)) ?? NaN;
  } else p = numericValueOf(x, expectedKind !== 'number');
  if (!isFinite(p)) return null;
  const inView = p >= v.xDomain[0] && p <= v.xDomain[1];
  if (!inView && !(allowClipped && p >= v.xFull[0] && p <= v.xFull[1])) return null;
  if (v.kind === 'scatter') {
    const { series } = v.frame, vis = v.visible, pts = v.visiblePoints;
    const pr = (layout as { projection?: { kind: string; y: { domain: readonly [number, number] } } } | undefined)?.projection;
    const [a, b] = pr?.kind === 'xy' ? pr.y.domain : v.yDomain;
    const yLo = a < b ? a : b, yHi = a < b ? b : a;
    let bestDist = nearest ? Infinity : 0, bestX = Infinity;
    const each = (fn: (entry: (typeof series)[number], start: number, end: number) => boolean | void) => {
      for (let s = 0; s < series.length; s++) {
        const entry = series[s]!;
        if (vis[s] && entry.drawable && fn(entry, pts[s]!.start, pts[s]!.end)) return true;
      }
      return false;
    };
    if (each((entry, start, end) => {
      const xs = entry.x, ys = entry.y;
      if (!inView) {
        const lo = lowerBound(xs, 0, xs.length, p);
        return nearest ? xs.length > 0 : lo < xs.length && xs[lo] === p;
      }
      const lo = lowerBound(xs, start, end, p);
      for (let step = 1; step >= (nearest ? -1 : 1); step -= 2) {
        for (let i = step > 0 ? lo : lo - 1; i >= start && i < end; i += step) {
          const vx = xs[i]!, dist = (vx - p) * step;
          if (dist > bestDist) break;
          if (ys[i]! >= yLo && ys[i]! <= yHi) {
            if (dist < bestDist || vx < bestX) { bestDist = dist; bestX = vx; }
            break;
          }
        }
      }
    })) return 1;
    if (bestX === Infinity) return null;
    const refs: DatumRef[] = [];
    let count = 0;
    each((entry, start, end) => {
      for (let i = lowerBound(entry.x, start, end, bestX); i < end && entry.x[i] === bestX; i++) {
        if (entry.y[i]! >= yLo && entry.y[i]! <= yHi) {
          if (refs.length < 8) {
            const ref: DatumRef = { kind: 'point', seriesKey: entry.key, row: entry.row?.[i] ?? i, x: bestX };
            if (lookup.anchor(ref)) { refs.push(ref); count++; }
          } else count++;
        }
      }
    });
    return refs.length ? { t: { kind: 'point', refs, count }, ref: refs[0]! } : null;
  }
  const xs = v.frame.x.values;
  const start = inView ? v.visibleSlots.start : 0, end = inView ? v.visibleSlots.end : xs.length;
  const lo = lowerBound(xs, start, end, p);
  const slot = lo < end && xs[lo] === p ? lo
    : nearest && start < end ? (lo === start ? lo : lo === end || p - xs[lo - 1]! <= xs[lo]! - p ? lo - 1 : lo) : -1;
  if (slot < 0) return null;
  if (!inView) return 1;
  const t: PickTarget = { kind: 'x', x: xs[slot]! };
  const ref = lookup.primary(t);
  return ref ? { t, ref } : null;
}

const noop = () => {};

/** Runs every release step even when one throws, then throws the first failure unless `swallow`. */
function releaseAll(steps: readonly ((() => void) | undefined)[], swallow?: boolean): void {
  let failure: [unknown] | undefined;
  for (const step of steps) {
    try { step?.(); } catch (error) { failure ??= [error]; }
  }
  if (failure && !swallow) throw failure[0];
}

/** Creates an explicit synchronization group linking hover and/or zoom across compatible Axylo charts. */
export function createSyncGroup(options: SyncGroupOptions = {}): SyncGroup {
  const nearest = options.unmatchedHover === 'nearest', ignore = options.unmatchedHover === 'ignore';
  const onMismatch = options.onMismatch;

  const members = new Map<SyncableChart<unknown>, MemberRecord>();
  // One origin token per explicit external sourceId so distinct manual callers cannot clear each other.
  const externalTokens = new Map<string, object>();
  let nextId = 1, propagating = false, destroyed = false;

  const alive = (a: MemberRecord | null, b?: MemberRecord): boolean =>
    !destroyed && (!a || members.get(a.c) === a) && (!b || members.get(b.c) === b);
  const clearShown = (m: MemberRecord, only?: object): void => {
    const by = m.by;
    if (by && (!only || by === only)) { m.by = null; m.s?.sync(null, by); }
  };

  function broadcast(
    source: MemberRecord | string,
    kind: 'hover' | 'zoom',
    payload: Point<unknown> | readonly [XValue, XValue] | null,
  ): void {
    const src = typeof source === 'string' ? null : source;
    const isHover = kind === 'hover';
    if (!alive(src) || propagating || options[kind] === false) return;
    const sampleX = payload ? (isHover ? (payload as Point<unknown>).x : (payload as readonly [XValue, XValue])[0]) : null;
    const pk = sampleX !== null ? inferXKind(sampleX) : null;
    if (src && pk && !src.o.xKind) src.ik = pk;
    const sourceXKind = src ? (memberKind(src) ?? pk) : pk;
    const sourceUnit = src?.o.xUnit ?? null;
    const origin: SyncOrigin = { sourceId: src ? src.id : source as string, kind };
    let token: object | undefined;

    propagating = true;
    try {
      for (const target of [...members.values()]) {
        if (!alive(src)) break;
        const to = target.o, seam = target.s, oh = to.onHoverSync;
        if (target.off || target === src || to[kind] === false) continue;
        if (isHover) {
          if (!seam && !oh) continue;
          if (!token && !(token = src ?? externalTokens.get(origin.sourceId))) externalTokens.set(origin.sourceId, token = {});
          if (payload === null) {
            if (target.by === token) { clearShown(target); if (alive(src, target)) oh?.(null, origin); }
            continue;
          }
        }
        const targetXKind = isHover && to.resolveX ? (to.xKind ?? null) : memberKind(target);
        const targetUnit = to.xUnit ?? null;
        // The kind is checked first: a pair that differs in both reports the kind.
        const reason = sourceXKind && targetXKind && sourceXKind !== targetXKind ? 'x-kind-mismatch'
          : sourceUnit !== null && targetUnit !== null && sourceUnit !== targetUnit ? 'unit-mismatch' : null;
        if (reason) onMismatch?.({ ...origin, targetId: target.id, reason, sourceXKind, targetXKind, sourceUnit, targetUnit });
        if (!alive(src)) break;
        if (reason || target.off) { if (isHover && !target.off) clearShown(target, token); continue; }
        if (!isHover) {
          const dom = payload as readonly [XValue, XValue] | null;
          target.c.zoom(dom);
          if (alive(src, target)) to.onZoomSync?.(dom, origin);
          continue;
        }
        const d = seam?.drawn;
        // Derive expected kind from the authoritative committed frame (donut has no x axis and is skipped).
        const expectedKind = d ? viewKind(d.accepted.view) : null;
        if (seam && !expectedKind) continue;
        const hp = payload as Point<unknown>;
        const matchedX = matchXForMember(target, hp.x, nearest);
        if (!alive(src)) break;
        if (target.off) continue;
        if (matchedX !== null) {
          if (!seam) {
            // Structural handles (no seam) keep the C5 payload at their matched x.
            target.by = token;
            oh!({ series: hp.series, x: matchedX, y: hp.y, row: null, index: -1 }, origin);
            continue;
          }
          const res = resolveLocal(d!.accepted.view, d!.lookup, d!.layout, matchedX, nearest, expectedKind, true);
          if (res) {
            const pt = res !== 1 && oh ? (seam.point?.(res.ref) ?? null) : null;
            if (!alive(src)) break;
            if (target.off) continue;
            // Record ownership before sync() so reentrant teardown during rendering/formatting clears this peer.
            target.by = token;
            seam.sync((v, l, ly) => (resolveLocal(v, l, ly, matchedX, nearest, expectedKind) as { t: PickTarget } | null)?.t ?? null, token!);
            if (alive(src, target)) oh?.(pt, origin);
            continue;
          }
        }
        if (!ignore) { clearShown(target); if (alive(src, target)) oh?.(null, origin); }
      }
    } finally {
      propagating = false;
    }
  }

  function detachMember(chart: SyncableChart<unknown>): void {
    const rec = members.get(chart);
    if (!rec) return;
    rec.off = true;
    members.delete(chart);
    // Visual cleanup first so reentrant attach during unsubscribe cannot have its new cursor clobbered or old resolver orphaned.
    releaseAll([
      () => clearShown(rec),
      ...[...members.values()].map(peer => () => clearShown(peer, rec)),
      ...rec.u.splice(0).reverse(),
    ]);
  }

  return {
    attach<Row = unknown>(chart: SyncableChart<Row>, memberOptions: SyncMemberOptions<Row> = {}): () => void {
      const key = chart as unknown as SyncableChart<unknown>;
      detachMember(key);
      if (destroyed || members.has(key)) return noop;

      const o = { ...memberOptions } as SyncMemberOptions<unknown>;
      const seam = (key as SyncCapable)[SYNC];
      const u: (() => void)[] = [];
      const rec: MemberRecord = {
        id: o.id ?? `chart-${nextId++}`,
        c: key,
        s: seam && typeof seam === 'object' ? seam : null,
        o,
        ik: o.xValues?.length ? inferXKind(o.xValues[0]!) : null,
        u,
      };
      const ok = () => !destroyed && !rec.off;
      // Scope detach callback to this exact attachment record so re-attaching never gets removed by a stale handle.
      const leave = () => { if (members.get(key) === rec) detachMember(key); else rec.off = true; };
      const rollback = () => {
        rec.off = true;
        releaseAll(u.reverse(), true);
      };
      try {
        for (const ev of ['hover', 'zoom'] as const) {
          if (ok() && options[ev] !== false && o[ev] !== false) {
            u.push(key.on(ev, p => { broadcast(rec, ev, p as Point<unknown> | readonly [XValue, XValue] | null); }));
          }
        }
        if (ok() && rec.s?.onDestroy) u.push(rec.s.onDestroy(leave));
        if (ok()) detachMember(key);
      } catch (err) {
        rollback();
        throw err;
      }
      if (!ok() || members.has(key)) { rollback(); return noop; }
      members.set(key, rec);
      return leave;
    },

    detach: detachMember,

    syncHover(x: XValue | null, sourceId = 'external'): void {
      broadcast(sourceId, 'hover', x === null ? null : { series: '', x, y: null, row: null, index: -1 });
    },

    syncZoom(domain: readonly [XValue, XValue] | null, sourceId = 'external'): void {
      broadcast(sourceId, 'zoom', domain);
    },

    get size(): number {
      return members.size;
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      externalTokens.clear();
      releaseAll([...members.values()].map(m => () => detachMember(m.c)));
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
    const e = item as { chart?: SyncableChart<unknown>; options?: SyncMemberOptions<unknown> };
    const w = typeof e.chart?.on === 'function';
    group.attach(w ? e.chart! : item as SyncableChart<unknown>, w ? e.options : undefined);
  }
  return group;
}


export interface DashboardPanel<Row = unknown> {
  /** Names the panel for `remove` and `chart`, and is its member id in the sync group. Default `panel-N`. */
  readonly id?: string;
  /** Makes the panel's chart in the element given: any entry point (`line`, `cartesian`, `candlestick`, …). */
  readonly create: (element: HTMLElement) => SyncableChart<Row>;
  /** The panel's membership in the group (its `id` is the panel's). */
  readonly sync?: Omit<SyncMemberOptions<Row>, 'id'>;
}

export interface DashboardOptions extends SyncGroupOptions {
  /** The narrowest a panel column may be, in CSS px. Default 320. */
  readonly minPanelWidth?: number;
  /** Space between panels, in CSS px. Default 16. */
  readonly gap?: number;
  /** Accessible name of the dashboard, which is a `role="group"` element. */
  readonly label?: string;
}

export interface Dashboard {
  /** The grid element the dashboard made inside the target. */
  readonly element: HTMLElement;
  readonly group: SyncGroup;
  /** Panel ids in layout order. */
  readonly ids: readonly string[];
  chart(id: string): SyncableChart<unknown> | undefined;
  /** Mounts one more panel at the end; returns its id. A factory that throws leaves nothing behind. */
  add<Row>(panel: DashboardPanel<Row>): string;
  /** Unmounts a panel (membership, chart, element); false when there is no such panel. */
  remove(id: string): boolean;
  /** Sets the x window on every linked panel; `null` resets it. */
  zoom(domain: readonly [XValue, XValue] | null): void;
  reset(): void;
  destroy(): void;
}

type Mounted = readonly [el: HTMLElement, c?: SyncableChart<unknown>, lv?: () => void];

function fail(msg: string): never { throw new Error(`Axylo: ${msg}`); }

function unmountSteps(m: Mounted | null): ((() => void) | undefined)[] {
  return m ? [m[2], () => m[1]?.destroy?.(), () => m[0].remove()] : [];
}

/** Lays out the panels the factories make in a responsive grid inside `target`, linked by one sync group. */
export function createDashboard(
  target: Target,
  panels: readonly DashboardPanel<unknown>[],
  options: DashboardOptions = {},
): Dashboard {
  const host = typeof target === 'string'
    ? (typeof document !== 'undefined' ? document.querySelector<HTMLElement>(target) : null)
    : target?.nodeType === 1 ? target : null;
  if (!host) fail(`no dashboard target ${JSON.stringify(target)}.`);
  const doc = host.ownerDocument;
  const div = (suffix: string) => { const e = doc.createElement('div'); e.className = `axylo-dashboard${suffix}`; return e; };
  const root = div('');
  root.setAttribute('role', 'group');
  if (options.label) root.setAttribute('aria-label', options.label);
  // Through the style object, which a strict CSP allows. min(100%, …): a container narrower than one column
  // still fits it, so nothing scrolls sideways at 320 px.
  root.style.cssText = `display:grid;gap:${options.gap ?? 16}px;grid-template-columns:repeat(auto-fit,minmax(min(100%,${options.minPanelWidth ?? 320}px),1fr));align-items:start`;

  const DESTROYED = 'the dashboard was destroyed.';
  const group = createSyncGroup(options);
  const mounted = new Map<string, Mounted | null>();
  let next = 1;
  let destroyed = false;

  function mount(panel: DashboardPanel<unknown>): string {
    const id = panel.id ?? `panel-${next++}`;
    if (mounted.has(id)) fail(`duplicate dashboard panel ${JSON.stringify(id)}.`);
    mounted.set(id, null);
    const el = div('-panel');
    // A grid item is as wide as its content by default; a chart must be able to shrink with its column.
    el.style.minWidth = '0';
    el.dataset.panel = id;
    root.appendChild(el);
    let c: SyncableChart<unknown> | undefined;
    let lv: (() => void) | undefined;
    try {
      c = panel.create(el);
      if (!destroyed) lv = group.attach(c, { ...panel.sync, id });
      if (destroyed) fail(DESTROYED);
      mounted.set(id, [el, c, lv]);
      return id;
    } catch (error) {
      mounted.delete(id);
      // Unwind pending membership, chart and element in reverse order; the first error wins.
      releaseAll(unmountSteps([el, c, lv]), true);
      throw error;
    }
  }

  const teardown = (swallow?: boolean) => {
    const all = [...mounted.values()].reverse();
    mounted.clear();
    releaseAll([...all.flatMap(unmountSteps), group.destroy, () => root.remove()], swallow);
  };

  host.appendChild(root);
  try {
    for (const panel of panels) mount(panel);
  } catch (error) {
    // Reverse order: the panels mounted so far, then the group and the grid.
    destroyed = true;
    teardown(true);
    throw error;
  }

  const zoom = (domain: readonly [XValue, XValue] | null) => { group.syncZoom(domain, 'dashboard'); };

  return {
    element: root,
    group,
    get ids() { return [...mounted].flatMap(([k, v]) => v ? [k] : []); },
    chart(id) { return mounted.get(id)?.[1]; },
    add(panel) {
      if (destroyed) fail(DESTROYED);
      return mount(panel as DashboardPanel<unknown>);
    },
    remove(id) {
      const m = mounted.get(id);
      if (!m) return false;
      mounted.delete(id);
      releaseAll(unmountSteps(m));
      return true;
    },
    zoom,
    reset() { zoom(null); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      teardown();
    },
  };
}

export type { ChartEvents, Point, XValue } from './public.js';
