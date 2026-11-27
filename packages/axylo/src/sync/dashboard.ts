/**
 * A multi-panel dashboard (`axylo/sync`, N6): a responsive grid of charts that the caller's factories make,
 * linked by one sync group (hover, and the shared x window: zoom, brushing and reset).
 *
 * It imports no chart kind, so a page pays only for the kinds its factories use. It writes no `<style>` and no
 * style attribute in markup: the grid is set through the element's style object, which a strict Content
 * Security Policy allows. Panels are at least `minPanelWidth` wide and fill the row; a container narrower than
 * two of them (a 320 px viewport) stacks them in one column, with no listener or observer of its own.
 *
 * Everything it makes is undone in reverse order (group membership, chart, panel element, then the grid), on
 * `remove`, on `destroy`, and when a factory throws part-way through, also for an element the page has
 * disconnected meanwhile. It removes only the elements it made.
 */
import type { Target, XValue } from '../public.js';
import { createSyncGroup, releaseAll, type SyncableChart, type SyncGroup, type SyncGroupOptions, type SyncMemberOptions } from './group';

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
