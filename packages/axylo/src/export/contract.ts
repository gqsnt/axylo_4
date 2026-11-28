/**
 * The capability a chart gives `axylo/export` (N7b), frozen at version 1. Each subpath is bundled on its
 * own, so the chart an export reads may come from another bundle, and a module-local WeakMap or Symbol()
 * would not be shared: both lookups go through the registry symbol `Symbol.for('axylo.export')`, read the
 * same in every bundle, and the members are plain property names, which a minifier keeps.
 *
 * Where it lives:
 * - on the chart handle, under that symbol, not enumerable and not writable. Every family built on the core
 *   controller gets it from `Handle` (core/controller-wrappers.ts); a family with its own wrapper handle
 *   forwards it with `forwardSeams`, which forwards the sync seam (core/peer.ts) beside it, unchanged;
 * - in one WeakMap shared by every bundle, at `globalThis[Symbol.for('axylo.export')]` (made by the first
 *   chart that registers), keyed by the mounted figure and the element it was mounted on (a chart mounted later on the
 *   same element takes that key). Destroy releases just the entries that still belong to this chart.
 *   Export looks up the exact element first, then its ancestors
 *   (across shadow roots), then its descendants (an open shadow root too).
 *
 * The capability is a frozen object of getters, and every one of them reads committed state: what the chart
 * last drew, never an update that is pending, rejected (strict) or failed; null before the first committed
 * frame and once the chart is destroyed. One interval is narrower: while the chart draws a frame (from its
 * first step until the new marks are committed and the frame closes), `plot` is null. The live figure may
 * already show the next caption, legend and note over the previous marks there, and author code (a formatter)
 * can run in that interval, so a whole-figure export fails instead of mixing two revisions. `figure` stays,
 * so a container lookup still finds this chart rather than reading the page's DOM; `table` stays the last
 * committed table, so a CSV export in that interval is the drawn one. It holds nothing of the sync seam and
 * cannot change the chart.
 *
 * The figure's chrome is what the committed figure shows, inside `figure`: the caption's (`.axylo-caption`) visible title and
 * subtitle, the legend entries with their swatches, the reader's note, and any element a family marks with
 * the attribute `data-axylo-export` (a colour bar, a size legend, a breadcrumb: `CHROME` below). Hidden
 * parts, the other controls (table, zoom, paging) and the transient layers (tooltip, readout, live region,
 * focus ring) are never part of it. A family whose plot is not an SVG gives its plot element as `plot`.
 */
import type { TableModel } from '../core/contracts';
import { SYNC } from '../core/peer';

export const EXPORT: unique symbol = Symbol.for('axylo.export') as never;

/** The parts of a committed figure other than the plot that a whole-figure export composes. */
export const CHROME = '.axylo-caption,.axylo-legend-entry,.axylo-legend-list,.axylo-note,[data-axylo-export]';

export interface ExportSeam {
  /**
   * The committed accessible table, every row of every page; null for the compact variant, with
   * `table: false`, before the first frame and once destroyed. Its rows are formatted when first asked for
   * and kept for that table, so the table the reader opens and every export read the same text.
   */
  readonly table: TableModel | null;
  /** The mounted figure whose chrome is exported (null before the first frame and once destroyed). */
  readonly figure: Element | null;
  /** The plot inside it: the mark surface and its text layer (null as `figure`, and while a frame is drawn). */
  readonly plot: Element | null;
}

export interface ExportCapable { readonly [EXPORT]?: ExportSeam }

type Registry = WeakMap<object, ExportSeam>;

type Shared = { [EXPORT]?: Registry };

/** The map is allocated by the first mount and shared across independently bundled entries. */
export const registry = (): Registry | undefined => (globalThis as Shared)[EXPORT];

/** Handles carry the seam directly. Check the mount and its ancestors before asking the DOM for descendants. */
export function seamOf(source: object): ExportSeam | undefined {
  const el = source as Element;
  const own = (el as ExportCapable)[EXPORT], map = (globalThis as Shared)[EXPORT];
  if (own || !map || el.nodeType !== 1) return own;
  for (let at: Node | null = el; at; at = at.parentNode ?? (at as ShadowRoot).host) {
    const found = map.get(at);
    if (found) return found;
  }
  for (const root of [el, el.shadowRoot]) {
    for (const node of root?.querySelectorAll('*') ?? []) {
      const found = map.get(node);
      if (found?.figure) return found;
    }
  }
}

/** Registers a chart's capability under its figure and the element the figure is mounted in (a later chart there replaces it). */
export function register(seam: ExportSeam, figure: Element | null | undefined): (() => void) | undefined {
  if (!figure) return;
  const map = (globalThis as Shared)[EXPORT] ??= new WeakMap();
  const keys: Node[] = [figure];
  if (figure.parentNode) keys.push(figure.parentNode);
  for (const key of keys) map.set(key, seam);
  return () => {
    for (const key of keys) if (map.get(key) === seam) map.delete(key);
    keys.length = 0;
  };
}

/** Puts a wrapper handle's seams (sync and export) on it, from the inner handle, not enumerable and read-only. */
export function forwardSeams(handle: object, inner: object): void {
  for (const key of [SYNC, EXPORT]) Object.defineProperty(handle, key, { value: (inner as Record<symbol, unknown>)[key] });
}
