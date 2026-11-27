/**
 * Hierarchical keyboard movement over the model, shared by both charts. Pure: a key and a focused node in,
 * the node to focus and whether the drilled root changes out.
 *
 * ArrowLeft / ArrowRight: previous / next sibling (stopping at the ends). Home / End: first / last sibling.
 * ArrowDown: first child. ArrowUp and Escape: the parent. Enter and Space activate (see `activate`): a treemap
 * drills into a branch and selects a leaf; a sunburst promotes any arc, a leaf included, to the center. On the
 * drilled root itself (the treemap's plot, the sunburst's center) Enter and Space go to its first child, as
 * ArrowDown does; a centered sunburst leaf, having none, goes up. A click on the center still goes up (see
 * `activate`). Focus never leaves the drilled subtree: going up from the drilled root drills up too.
 */
import { childAt, childCount, type HierarchyModel } from './tree';

export type HierarchyKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'Enter' | ' ' | 'Escape';

export interface NavState { readonly root: number; readonly focus: number }

export interface NavResult extends NavState {
  /** The focused leaf was activated (Enter or Space on a leaf): the chart emits `select`. */
  readonly select: boolean;
}

const KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' ', 'Escape']);
export const isHierarchyKey = (key: string): key is HierarchyKey => KEYS.has(key);

function siblingAt(m: HierarchyModel, node: number, k: number): number {
  const p = m.parent[node]!;
  return p < 0 ? node : childAt(m, p, k);
}

/** How a chart activates a node (Enter, Space or a click): a treemap drills branches and selects leaves; a sunburst promotes any arc to the center. */
export type ActivationMode = 'treemap' | 'sunburst';

export function navigate(m: HierarchyModel, state: NavState, key: HierarchyKey, mode: ActivationMode = 'treemap'): NavResult {
  const { root, focus } = state;
  const same = { root, focus, select: false };
  const parent = m.parent[focus]!;
  const siblings = parent < 0 || focus === root ? 1 : childCount(m, parent);
  const place = focus === root ? 0 : m.sibling[focus]!;
  switch (key) {
    case 'ArrowLeft': return place > 0 ? { root, focus: siblingAt(m, focus, place - 1), select: false } : same;
    case 'ArrowRight': return place < siblings - 1 ? { root, focus: siblingAt(m, focus, place + 1), select: false } : same;
    case 'Home': return focus === root ? same : { root, focus: siblingAt(m, focus, 0), select: false };
    case 'End': return focus === root ? same : { root, focus: siblingAt(m, focus, siblings - 1), select: false };
    case 'ArrowDown': return childCount(m, focus) > 0 ? { root, focus: childAt(m, focus, 0), select: false } : same;
    case 'ArrowUp':
    case 'Escape':
      if (parent < 0) return same;
      // Up from the drilled root leaves the view: the view goes up with it.
      return focus === root ? { root: parent, focus: parent, select: false } : { root, focus: parent, select: false };
    case 'Enter':
    case ' ':
      if (focus === root) {
        // The drilled root (a treemap's whole plot, a sunburst's center): Enter goes into it, as ArrowDown
        // does. With no child to go to, a treemap selects it and a sunburst's centered leaf goes up, as a click
        // on the center does.
        if (childCount(m, focus) > 0) return { root, focus: childAt(m, focus, 0), select: false };
        if (mode === 'treemap') return { root, focus, select: true };
      }
      return activate(m, mode, root, focus);
  }
}

/**
 * What activating `node` does, by click or by key. Treemap: a branch drills in (focus on its first child), a
 * leaf is selected where it is. Sunburst: any arc, a leaf included, becomes the center (focus on its first
 * child, or on itself when it is a leaf). Activating the drilled root goes one level up, focus staying on it.
 */
export function activate(m: HierarchyModel, mode: ActivationMode, root: number, node: number): NavResult {
  if (node === root) {
    const p = m.parent[root]!;
    return p >= 0 ? { root: p, focus: root, select: false } : { root, focus: node, select: false };
  }
  const k = childCount(m, node);
  if (mode === 'treemap' && k === 0) return { root, focus: node, select: true };
  return { root: node, focus: k > 0 ? childAt(m, node, 0) : node, select: false };
}

/** Whether activating `node` does anything: everything but the top-level root does. */
export const activates = (m: HierarchyModel, root: number, node: number): boolean => node !== root || m.parent[root]! >= 0;
