/**
 * The shared hierarchy model of `axylo/hierarchy`: nested or flat input turned into one tree in typed arrays,
 * with a deterministic bottom-up rollup. Pure: no DOM, no state at module level.
 *
 * Node 0 is the root. Nodes are numbered in pre-order (a parent before its children, children in the order the
 * caller gave), so the table, the keyboard and both layouts walk the same order.
 *
 * Input is read straight into growable columns (typed arrays, plus one string per node for its label and id):
 * no record per node is made, and a nested walk keeps its stack and its set of active ancestors in columns
 * too, so a deep tree is read in linear time.
 */
import type { DiagnosticEffect, DiagnosticInput, DiagnosticSink } from '../core/contracts';

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

export type HierarchyDiagnosticCode = 'AX190' | 'AX191' | 'AX192';

/** Leaf states. Only VALUE contributes to the rollup. */
export const LEAF_VALUE = 0;
export const LEAF_MISSING = 1;
export const LEAF_INVALID = 2;
export const BRANCH = 3;

// Who owns a node's id: restoring drill and focus across an update only trusts an id held by the same kind
// of identity (see `restoreIndex`).
/** A flat row: the caller's own id, unique in the data. */
export const ID_FLAT = 0;
/** A nested node with an explicit id used once in the tree: the id alone, whatever its ancestors. */
export const ID_EXPLICIT = 1;
/** A nested node whose explicit id is repeated: a path under its parent, starting from that id. */
export const ID_REPEATED = 2;
/** A nested node without an explicit id: a path under its parent, from its label or position. */
export const ID_GENERATED = 3;
/** A made-up root (''). */
export const ID_SYNTHETIC = 4;

export interface HierarchyModel {
  readonly count: number;
  /** Parent per node, -1 for the root. */
  readonly parent: Int32Array;
  readonly depth: Uint32Array;
  /** Children of node i are childList[childStart[i] .. childStart[i + 1]). */
  readonly childStart: Int32Array;
  readonly childList: Int32Array;
  /** Place of a node among its siblings. */
  readonly sibling: Int32Array;
  /** Rolled-up value as a double; Infinity where the exact sum passes the largest double (see `mant`). */
  readonly value: Float64Array;
  /**
   * The rolled-up value of each subtree as mant · 2^expo, with mant in [1, 2) (0 for a subtree with nothing to
   * show). Every subtree keeps its own magnitude, so shares between a node and any ancestor are exact even when
   * the tree mixes 1e-200 and 1e200, and even when a total overflows a double.
   */
  readonly mant: Float64Array;
  readonly expo: Int32Array;
  readonly state: Uint8Array;
  /** Source position: the row index (flat) or the pre-order index of the caller's node (nested); -1 for a synthetic root. */
  readonly row: Int32Array;
  readonly labels: readonly string[];
  /** Unique per node: the caller's id (flat); nested: an explicit id used once in the tree, else a path (see readNested). */
  readonly ids: readonly string[];
  /** Who owns each id: ID_FLAT, ID_EXPLICIT, ID_REPEATED, ID_GENERATED or ID_SYNTHETIC. */
  readonly idKind: Uint8Array;
  readonly maxDepth: number;
  /** True when the root was made up because the input had several top-level nodes. */
  readonly syntheticRoot: boolean;
}

export const childCount = (m: HierarchyModel, i: number): number => m.childStart[i + 1]! - m.childStart[i]!;
export const childAt = (m: HierarchyModel, i: number, k: number): number => m.childList[m.childStart[i]! + k]!;
export const isBranch = (m: HierarchyModel, i: number): boolean => childCount(m, i) > 0;
/** Whether the subtree of node i has something positive to draw. */
export const isPositive = (m: HierarchyModel, i: number): boolean => m.mant[i]! > 0;

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A key that names an id: numbers and strings compare by their text, as the caller wrote them in `parent`. */
const idText = (v: unknown): string | null =>
  typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : null;

/** Flat rows are told apart from nested nodes by a `parent` key on any row: nested nodes never have one. */
export function isFlat(data: unknown): data is readonly unknown[] {
  if (!Array.isArray(data)) return false;
  for (const row of data) if (isObject(row) && Object.hasOwn(row, 'parent')) return true;
  return false;
}

export function createHierarchyDiagnostic(
  code: HierarchyDiagnosticCode,
  effect: DiagnosticEffect,
  details: { readonly rows?: readonly number[]; readonly count?: number; readonly detail?: string; readonly field?: string } = {},
): DiagnosticInput {
  const rows = details.rows ? [...new Set(details.rows)].slice(0, 10) : undefined;
  const count = details.count ?? rows?.length;
  const at = rows?.length ? ` (${rows.length === 1 ? 'row' : 'rows'} ${rows.join(', ')})` : '';
  const n = count ?? 1;
  const message = details.detail ?? (code === 'AX190'
    ? `The hierarchy has ${n} leaf value${n === 1 ? '' : 's'} that ${n === 1 ? 'is' : 'are'} missing, negative or not finite${at}. Give every leaf a finite value of zero or more. Those leaves are not drawn and read "No data" in the tooltip and table.`
    : code === 'AX191'
      ? `The hierarchy has ${n} node${n === 1 ? '' : 's'} with an invalid parent: a parent id that does not exist, a duplicate id, or a cycle${at}. Give every node a unique id and a parent that leads to a top-level node. Those nodes and their descendants are left out.`
      : 'The hierarchy has no node with a positive value. Give at least one leaf a value above zero. The chart shows its empty state.');
  return {
    code,
    level: 'warning',
    effect,
    origin: 'call',
    message,
    ...(details.field ? { field: details.field } : {}),
    ...(rows ? { rows } : {}),
    ...(count !== undefined ? { count } : {}),
  };
}

/** v · 2^e without passing through an overflowing or underflowing power of two. */
function ldexp(v: number, e: number): number {
  while (e > 1000) { v *= 2 ** 1000; e -= 1000; }
  while (e < -1000) { v *= 2 ** -1000; e += 1000; }
  return v * 2 ** e;
}

/** Writes positive finite v as mant · 2^expo with mant in [1, 2). */
function setScaled(mant: Float64Array, expo: Int32Array, i: number, v: number): void {
  let e = Math.floor(Math.log2(v));
  let f = ldexp(v, -e);
  // log2 can be off by one next to a power of two.
  if (f >= 2) { f /= 2; e++; } else if (f < 1) { f *= 2; e--; }
  mant[i] = f;
  expo[i] = e;
}

/** value(a) / value(b) from the scaled totals; 0 when a has nothing, null when b has nothing. */
export function ratio(m: HierarchyModel, a: number, b: number): number | null {
  const mb = m.mant[b]!;
  if (!(mb > 0)) return null;
  const ma = m.mant[a]!;
  if (!(ma > 0)) return 0;
  return ldexp(ma / mb, m.expo[a]! - m.expo[b]!);
}

/** Reads a leaf value: its state. */
function leafState(raw: unknown): number {
  if (raw === null || raw === undefined) return LEAF_MISSING;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return LEAF_INVALID;
  return LEAF_VALUE;
}

/** Nodes as columns while one input is read. Grows by doubling; trimmed copies go into the model. */
class Columns {
  count = 0;
  parent = new Int32Array(16);
  depth = new Uint32Array(16);
  row = new Int32Array(16);
  /** Leaf state of the caller's value, and the value when it is one. */
  raw = new Uint8Array(16);
  given = new Float64Array(16);
  idKind = new Uint8Array(16);
  readonly labels: string[] = [];
  readonly ids: string[] = [];

  add(parent: number, label: string, id: string, row: number, value: unknown): number {
    const i = this.count;
    if (i === this.parent.length) {
      const grow = <T extends Int32Array | Uint32Array | Uint8Array | Float64Array>(a: T): T => {
        const b = new (a.constructor as new (n: number) => T)(a.length * 2);
        b.set(a);
        return b;
      };
      this.parent = grow(this.parent); this.depth = grow(this.depth); this.row = grow(this.row);
      this.raw = grow(this.raw); this.given = grow(this.given);
      this.idKind = grow(this.idKind);
    }
    this.parent[i] = parent;
    this.depth[i] = parent < 0 ? 0 : this.depth[parent]! + 1;
    this.row[i] = row;
    const s = leafState(value);
    this.raw[i] = s;
    this.given[i] = s === LEAF_VALUE ? value as number : NaN;
    this.labels.push(label);
    this.ids.push(id);
    this.count++;
    return i;
  }
}

/**
 * Builds the model. `rootLabel` names a made-up root (several top-level nodes). Diagnostics go to `sink`:
 * AX190 for leaf values that cannot be drawn, AX191 for nodes whose place in the tree cannot be known, AX192
 * when nothing positive is left to draw.
 */
export function buildHierarchy(data: unknown, rootLabel: string, sink: DiagnosticSink): HierarchyModel {
  const cols = new Columns();
  const synthetic = isFlat(data) ? readFlat(data, rootLabel, cols, sink) : readNested(data, rootLabel, cols, sink);
  return finish(cols, synthetic, sink);
}

/** One path component, or an explicit id: `\`, `/` and `#` are escaped, so `/` only joins and `#` only numbers. */
const escapeId = (s: string): string => s.replace(/[\\/#]/g, c => '\\' + c);

/**
 * Nested ids (two passes, both linear and stack-free):
 * - A node whose explicit `id` is non-empty and occurs once in the whole tree is named by that id alone,
 *   escaped (an id without `\`, `/` or `#` reads as written). It does not depend on its ancestors, its
 *   siblings or their order, and every generated id below it starts with it, so its subtree keeps its ids
 *   wherever it moves.
 * - Every other node (no explicit id, or one repeated in the tree) gets a path: its escaped explicit id, else
 *   label, else pre-order index, after its parent's id and `/` (the root and the top-level nodes of a forest
 *   have no prefix). A path or a component already taken, including by an explicit id above, gets `#2`,
 *   `#3`, … (an unescaped `#` no explicit id has), so no generated id ever equals an explicit one or another
 *   generated one. Among siblings the repeated explicit ids claim their paths first, in the caller's order.
 * - A made-up root is ''.
 */
function readNested(data: unknown, rootLabel: string, cols: Columns, sink: DiagnosticSink): boolean {
  const cyclic: number[] = [];
  const synthetic = Array.isArray(data) || !isObject(data);
  const tops: readonly unknown[] = Array.isArray(data) ? data : [];
  // Pass 1: the explicit id of each node (null: none), and how often each occurs in the tree.
  const owns: (string | null)[] = [];
  const seen = new Map<string, number>();
  // Explicit stack, never recursion: a deep tree must not overflow the call stack.
  const stackNode: unknown[] = [];
  let stackParent = new Int32Array(16);
  const push = (node: unknown, parent: number): void => {
    if (stackNode.length === stackParent.length) {
      const b = new Int32Array(stackParent.length * 2);
      b.set(stackParent);
      stackParent = b;
    }
    stackParent[stackNode.length] = parent;
    stackNode.push(node);
  };
  // The objects on the path from the root (null for a node that is not an object); `active` holds the same
  // objects for a constant-time test: a node found among its own ancestors closes a cycle.
  const path: (object | null)[] = [];
  const active = new Set<object>();
  if (synthetic) {
    cols.add(-1, rootLabel, '', -1, undefined);
    owns.push(null);
    path.push(null);
    for (let k = tops.length - 1; k >= 0; k--) push(tops[k], 0);
  } else {
    push(data, -1);
  }
  let source = 0;
  while (stackNode.length) {
    const parent = stackParent[stackNode.length - 1]!;
    const node = stackNode.pop();
    const row = source++;
    const depth = parent < 0 ? 0 : cols.depth[parent]! + 1;
    // Trim the path to this node's ancestors.
    while (path.length > depth) { const o = path.pop(); if (o) active.delete(o); }
    if (isObject(node) && active.has(node)) { cyclic.push(row); continue; }
    const n = isObject(node) ? node : {};
    const kids = Array.isArray(n.children) ? n.children as readonly unknown[] : null;
    const own = idText(n.id);
    const label = typeof n.label === 'string' ? n.label : own ?? '';
    const index = cols.add(parent, label, '', row, kids && kids.length ? undefined : n.value);
    owns.push(own);
    if (own !== null) seen.set(own, (seen.get(own) ?? 0) + 1);
    const self = isObject(node) ? node : null;
    path.push(self);
    if (self) active.add(self);
    if (kids) for (let k = kids.length - 1; k >= 0; k--) push(kids[k], index);
  }
  if (cyclic.length) sink.add(createHierarchyDiagnostic('AX191', 'omitted', { rows: cyclic, count: cyclic.length, field: 'children' }));

  // Pass 2: ids in pre-order, a parent's before its children's. Children grouped by parent in typed arrays.
  const count = cols.count;
  const ids = cols.ids;
  const start = new Int32Array(count + 1);
  for (let i = 1; i < count; i++) start[cols.parent[i]! + 1]!++;
  for (let i = 0; i < count; i++) start[i + 1]! += start[i]!;
  const list = new Int32Array(Math.max(0, count - 1));
  const at = start.slice(0, count);
  for (let i = 1; i < count; i++) list[at[cols.parent[i]!]!++] = i;
  const alone = (i: number): boolean => { const o = owns[i] ?? null; return o !== null && o !== '' && seen.get(o) === 1; };
  const repeated = (i: number): boolean => owns[i] !== null && !alone(i);
  // Paths already given, and the next number to try for a repeated one.
  const used = new Map<string, number>();
  const unique = (base: string): string => {
    let k = used.get(base);
    if (k === undefined) { used.set(base, 2); return base; }
    let id = `${base}#${k}`;
    while (used.has(id)) id = `${base}#${++k}`;
    used.set(base, k + 1);
    used.set(id, 2);
    return id;
  };
  // Explicit ids used once are reserved before any path is made: they never move to make room.
  for (let i = 0; i < count; i++) if (alone(i)) used.set(escapeId(owns[i]!), 2);
  const name = (i: number, prefix: string | null): string => {
    if (alone(i)) return escapeId(owns[i]!);
    const part = escapeId(owns[i] ?? (cols.labels[i] || String(cols.row[i]!)));
    return unique(prefix === null ? part : `${prefix}/${part}`);
  };
  const kind = cols.idKind;
  for (let i = 0; i < count; i++) kind[i] = alone(i) ? ID_EXPLICIT : repeated(i) ? ID_REPEATED : ID_GENERATED;
  if (count) {
    if (synthetic) { used.set(ids[0] = '', 2); kind[0] = ID_SYNTHETIC; }
    else ids[0] = name(0, null);
  }
  for (let i = 0; i < count; i++) {
    const prefix = i === 0 && synthetic ? null : ids[i]!;
    const from = start[i]!, to = start[i + 1]!;
    for (let k = from; k < to; k++) { const c = list[k]!; if (repeated(c)) ids[c] = name(c, prefix); }
    for (let k = from; k < to; k++) { const c = list[k]!; if (!repeated(c)) ids[c] = name(c, prefix); }
  }
  return synthetic;
}

function readFlat(rows: readonly unknown[], rootLabel: string, cols: Columns, sink: DiagnosticSink): boolean {
  const badId: number[] = [];
  const badParent: number[] = [];
  const byId = new Map<string, number>();
  const parentOf = new Int32Array(rows.length).fill(-2);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const id = isObject(row) ? idText(row.id) : null;
    if (id === null || byId.has(id)) { badId.push(r); continue; }
    byId.set(id, r);
  }
  // -1: top level. -3: a parent that does not exist or is the row itself. Otherwise the parent's row.
  for (const [, r] of byId) {
    const p = (rows[r] as Record<string, unknown>).parent;
    if (p === null || p === undefined || p === '') { parentOf[r] = -1; continue; }
    const at = byId.get(idText(p) ?? '\u0000');
    parentOf[r] = at === undefined || at === r ? -3 : at;
  }
  // A row is placed when following parents reaches a top-level row; orphans and cycles never do.
  const placed = new Uint8Array(rows.length); // 0 unknown, 1 placed, 2 not placed, 3 on the current walk
  const walk = new Int32Array(rows.length);
  for (const [, start] of byId) {
    let r = start;
    let len = 0;
    while (placed[r] === 0) {
      placed[r] = 3;
      walk[len++] = r;
      const p = parentOf[r]!;
      if (p === -1) { placed[r] = 1; break; }
      if (p < 0) { placed[r] = 2; break; }
      r = p;
    }
    const verdict = placed[r] === 3 ? 2 : placed[r]!;
    for (let k = 0; k < len; k++) placed[walk[k]!] = verdict;
  }
  for (const [, r] of byId) if (placed[r] !== 1) badParent.push(r);
  if (badId.length) sink.add(createHierarchyDiagnostic('AX191', 'omitted', { rows: badId, count: badId.length, field: 'id' }));
  if (badParent.length) {
    badParent.sort((a, b) => a - b);
    sink.add(createHierarchyDiagnostic('AX191', 'omitted', { rows: badParent, count: badParent.length, field: 'parent' }));
  }
  // Children in row order; then a pre-order walk with an explicit stack.
  const kidStart = new Int32Array(rows.length + 2);
  let tops = 0;
  for (const [, r] of byId) {
    if (placed[r] !== 1) continue;
    if (parentOf[r] === -1) tops++;
    else kidStart[parentOf[r]! + 1]!++;
  }
  for (let r = 0; r < rows.length; r++) kidStart[r + 1]! += kidStart[r]!;
  const kids = new Int32Array(Math.max(0, kidStart[rows.length]!));
  const fillAt = kidStart.slice(0, rows.length);
  const topList = new Int32Array(tops);
  let t = 0;
  for (let r = 0; r < rows.length; r++) {
    // Only placed rows (unique ids that reach a top-level row) have a slot; duplicates were never placed.
    if (placed[r] !== 1) continue;
    if (parentOf[r] === -1) topList[t++] = r;
    else kids[fillAt[parentOf[r]!]!++] = r;
  }
  const synthetic = tops !== 1;
  // Each placed row is pushed once: the stack never holds more than the rows.
  const stackRow = new Int32Array(rows.length + 1);
  const stackParent = new Int32Array(rows.length + 1);
  let sp = 0;
  if (synthetic) { cols.add(-1, rootLabel, '', -1, undefined); cols.idKind[0] = ID_SYNTHETIC; }
  for (let k = tops - 1; k >= 0; k--) { stackRow[sp] = topList[k]!; stackParent[sp++] = synthetic ? 0 : -1; }
  while (sp > 0) {
    const r = stackRow[--sp]!, parent = stackParent[sp]!;
    const row = rows[r] as Record<string, unknown>;
    const id = idText(row.id)!;
    const from = kidStart[r]!, to = kidStart[r + 1]!;
    const index = cols.add(parent, typeof row.label === 'string' ? row.label : id, id, r, to === from ? row.value : undefined);
    for (let k = to - 1; k >= from; k--) { stackRow[sp] = kids[k]!; stackParent[sp++] = index; }
  }
  return synthetic;
}

function finish(cols: Columns, syntheticRoot: boolean, sink: DiagnosticSink): HierarchyModel {
  const count = cols.count;
  const parent = cols.parent.slice(0, count);
  const depth = cols.depth.slice(0, count);
  const row = cols.row.slice(0, count);
  const childStart = new Int32Array(count + 1);
  const sibling = new Int32Array(count);
  const value = new Float64Array(count);
  const mant = new Float64Array(count);
  const expo = new Int32Array(count);
  const state = new Uint8Array(count);
  let maxDepth = 0;
  for (let i = 0; i < count; i++) {
    if (depth[i]! > maxDepth) maxDepth = depth[i]!;
    if (parent[i]! >= 0) childStart[parent[i]! + 1]!++;
  }
  for (let i = 0; i < count; i++) childStart[i + 1]! += childStart[i]!;
  const childList = new Int32Array(Math.max(0, count - 1));
  const at = childStart.slice(0, count);
  for (let i = 1; i < count; i++) {
    const p = parent[i]!;
    if (p < 0) continue;
    sibling[i] = at[p]! - childStart[p]!;
    childList[at[p]!++] = i;
  }
  const bad: number[] = [];
  let badCount = 0;
  let overflow = 0;
  // Bottom-up: in pre-order every descendant comes after its node, so a reverse pass sees children first.
  for (let i = count - 1; i >= 0; i--) {
    const from = childStart[i]!, to = childStart[i + 1]!;
    // A made-up root is a branch even with nothing under it: it has no value of its own to be invalid.
    if (to > from || (i === 0 && syntheticRoot)) {
      state[i] = BRANCH;
      // Sum the children at the scale of the largest: every term is below 2, the largest at least 1.
      let top = -Infinity, sum = 0;
      for (let k = from; k < to; k++) { const c = childList[k]!; if (mant[c]! > 0 && expo[c]! > top) top = expo[c]!; }
      for (let k = from; k < to; k++) {
        const c = childList[k]!;
        if (mant[c]! > 0) sum += ldexp(mant[c]!, expo[c]! - top);
        if (state[c] === BRANCH || state[c] === LEAF_VALUE) value[i]! += value[c]!;
      }
      if (sum > 0) { setScaled(mant, expo, i, sum); expo[i]! += top; }
      if (value[i] === Infinity) overflow++;
      continue;
    }
    const s = cols.raw[i]!;
    state[i] = s;
    if (s === LEAF_VALUE) {
      const v = cols.given[i]!;
      value[i] = v;
      if (v > 0) setScaled(mant, expo, i, v);
    } else {
      value[i] = NaN;
      badCount++;
      if (row[i]! >= 0) {
        bad.push(row[i]!);
        // Only the first ten rows are reported: keep a small buffer, not one entry per invalid leaf.
        if (bad.length > 64) { bad.sort((x, y) => x - y); bad.length = 10; }
      }
    }
  }
  if (badCount) {
    bad.sort((a, b) => a - b);
    sink.add(createHierarchyDiagnostic('AX190', 'omitted', { rows: bad.slice(0, 10), count: badCount, field: 'value' }));
  }
  if (overflow) {
    sink.add(createHierarchyDiagnostic('AX190', 'changed', {
      count: overflow,
      field: 'value',
      detail: `The hierarchy has ${overflow} branch total${overflow === 1 ? '' : 's'} above the largest double (about 1.8e308). Proportions are drawn exactly from scaled values; those totals read "more than" the largest double.`,
    }));
  }
  if (count === 0 || !(mant[0]! > 0)) sink.add(createHierarchyDiagnostic('AX192', 'none'));
  return {
    count, parent, depth, childStart, childList, sibling, value, mant, expo, state, row,
    labels: cols.labels, ids: cols.ids, idKind: cols.idKind.slice(0, count), maxDepth, syntheticRoot,
  };
}

/** Share of the parent (0–1), or null for the root and for a node whose parent has nothing to share. */
export function shareOfParent(m: HierarchyModel, i: number): number | null {
  const p = m.parent[i]!;
  return p < 0 ? null : ratio(m, i, p);
}

/** Share of the whole tree (0–1), always of the original root whatever is drilled, or null when the tree has nothing to share. */
export function shareOfRoot(m: HierarchyModel, i: number): number | null {
  return m.count ? ratio(m, i, 0) : null;
}

/** Labels from the root (included) down to node i. */
export function pathOf(m: HierarchyModel, i: number): string[] {
  const out: string[] = [];
  for (let k = i; k >= 0; k = m.parent[k]!) out.push(m.labels[k]!);
  return out.reverse();
}

/** Whether `node` lies in the subtree of `root` (itself included). */
export function within(m: HierarchyModel, root: number, node: number): boolean {
  for (let k = node; k >= 0; k = m.parent[k]!) if (k === root) return true;
  return false;
}

export function indexOfId(m: HierarchyModel, id: string): number {
  for (let i = 0; i < m.count; i++) if (m.ids[i] === id) return i;
  return -1;
}

/**
 * The node of `next` that is node `i` of `prev`, or -1 when that identity is gone or cannot be told apart.
 * Node 0 is always node 0: the top-level view stays the top-level view whatever id it now has. Otherwise the
 * id must be held by the same kind of identity. A flat id and an explicit id used once name the node alone.
 * A path (repeated explicit or generated) is only the same node when every ancestor up to an explicit id used
 * once (or the root) is also held by the same kind with the same id: a path string can be reused when an
 * explicit id takes over, or gives up, a name a generated ancestor had. Walks the two ancestor chains in
 * place; allocates nothing.
 */
export function restoreIndex(prev: HierarchyModel, i: number, next: HierarchyModel): number {
  if (i <= 0 || next.count === 0) return 0;
  const n = indexOfId(next, prev.ids[i]!);
  if (n < 0) return -1;
  let a = i, b = n;
  for (;;) {
    const k = prev.idKind[a]!;
    if (k !== next.idKind[b]! || prev.ids[a] !== next.ids[b]) return -1;
    if (k === ID_FLAT || k === ID_EXPLICIT) return n;
    a = prev.parent[a]!;
    b = next.parent[b]!;
    if (a < 0 || b < 0) return a === b ? n : -1;
  }
}

/** End (exclusive) of the pre-order range that holds the subtree of `root`: a subtree is contiguous in pre-order. */
export function subtreeEnd(m: HierarchyModel, root: number): number {
  const d = m.depth[root]!;
  let i = root + 1;
  while (i < m.count && m.depth[i]! > d) i++;
  return i;
}
