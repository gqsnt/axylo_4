/**
 * The browser host of a hierarchy chart: figure, breadcrumb, plot, tooltip, keyboard tree item and table,
 * over the committed state of core.ts. The DOM is touched only inside these functions, through the target's
 * own document, so importing this module in Node does nothing.
 *
 * Commit rule (spec 3.5, plan 1.5): a call is validated first. A `strict` call with a warning or an error is
 * rejected before anything changes (data, diagnostics, drilled root, focus, open table); its findings still
 * reach that call's `onDiagnostic`, and the StrictError is thrown from the call.
 *
 * Reentrancy: author code (a value formatter, `onDiagnostic`, event listeners) may update, drill or destroy the
 * chart at any point. Work is done in transactions (see `run`): state changes first, with event payloads taken
 * from the state it set, then the changed DOM parts are painted, then notifications go out. A part that reads
 * text through the author's formatter reads all of it before writing, and is painted again from the newer
 * state when that formatter changed the chart meanwhile. Every committed state is a revision and every
 * drilled root a view: late findings belong to the revision whose reader found them, a queued finding or
 * event of a replaced revision or view is dropped, and a finding counts as handed out only once it was.
 */
import type { DiagnosticInput, TableModel } from '../core/contracts';
import type { Diagnostic } from '../public';
import { Delivery, diagnosticKey, StrictError } from '../core/delivery';
import { mergeOptions, noteFor, prepare, type HierarchyType, type Prepared, type RawOptions } from './core';
import { installHierarchyStyles } from './styles';
import { EXPORT, register, type ExportSeam } from '../export/contract';
import { svg, type Driver, type Measure, type Rendered } from './draw';
import { activate, activates, isHierarchyKey, navigate } from './nav';
import { nodeSentence, type NodeText } from './reader';
import { childAt, childCount, indexOfId, isBranch, isPositive, pathOf, restoreIndex, within, type HierarchyModel } from './tree';

// Declared in the entry file (hierarchy.ts): the package ships that declaration file, not this module's.
export type { HierarchyChart, HierarchyCrumb, HierarchyEvents, HierarchyPoint } from '../hierarchy';
import type { HierarchyChart, HierarchyCrumb, HierarchyEvents, HierarchyPoint } from '../hierarchy';

type Listener = (payload: unknown) => void;

const HIDDEN = 'axylo-h-sr';
let chartCount = 0;

function pointOf(m: HierarchyModel, i: number): HierarchyPoint {
  const branch = isBranch(m, i);
  const v = m.value[i]!;
  // Frozen: a listener that keeps or changes a payload cannot reach the chart or another listener.
  return Object.freeze({
    id: m.ids[i]!, label: m.labels[i]!, path: Object.freeze(pathOf(m, i)), depth: m.depth[i]!,
    value: branch || Number.isFinite(v) ? v : null, row: m.row[i]!,
  });
}

type Handler = (d: Diagnostic) => void;
const handlerOf = (raw: RawOptions): Handler | null => typeof raw.onDiagnostic === 'function' ? raw.onDiagnostic as Handler : null;
/** The author's value format: what a presentation finding (AX160) is found with. */
const formatOf = (raw: RawOptions): unknown =>
  raw.value !== null && typeof raw.value === 'object' ? (raw.value as { readonly format?: unknown }).format : undefined;
const publicOf = (d: DiagnosticInput, chart: string): Diagnostic => (({ effect: _e, origin: _o, ...rest }) => ({ ...rest, chart }))(d);

type Queued =
  | { readonly kind: 'diagnostic'; readonly d: Diagnostic; readonly handler: Handler | null; readonly revision: number; readonly late: boolean }
  | { readonly kind: 'event'; readonly event: keyof HierarchyEvents; readonly payload: unknown; readonly view: number };

function resolveTarget(target: string | HTMLElement): HTMLElement {
  if (typeof target !== 'string') return target;
  if (typeof document === 'undefined') throw new Error('[axylo] a hierarchy chart needs a DOM; use validateTreemap or validateSunburst in Node.');
  const found = document.querySelector(target);
  if (!found) throw new Error(`[axylo] no element matches ${JSON.stringify(target)}.`);
  return found as HTMLElement;
}

function createMeasure(doc: Document): Measure {
  let context: CanvasRenderingContext2D | null = null;
  try {
    const canvas = doc.createElement('canvas') as HTMLCanvasElement;
    context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  } catch { context = null; }
  let font = '';
  return (text: string) => {
    if (!context) return text.length * 7;
    if (!font) {
      const win = doc.defaultView;
      const family = win?.getComputedStyle?.(doc.body ?? doc.documentElement).fontFamily || 'sans-serif';
      font = `12px ${family}`;
      context.font = font;
    }
    return context.measureText(text).width;
  };
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, name: K, attrs: Readonly<Record<string, string>> = {}): HTMLElementTagNameMap[K] {
  const e = doc.createElement(name);
  for (const key of Object.keys(attrs)) e.setAttribute(key, attrs[key]!);
  return e;
}

function style(e: HTMLElement | SVGElement, props: Readonly<Record<string, string>>): void {
  for (const key of Object.keys(props)) e.style.setProperty(key, props[key]!);
}

export function openHierarchyChart<Options>(driver: Driver, target: string | HTMLElement, options: Options): HierarchyChart<Options> {
  const host = resolveTarget(target);
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  const type: HierarchyType = driver.type;
  const defaultLocale = doc.documentElement?.getAttribute?.('lang') || (typeof navigator !== 'undefined' ? navigator.language : '') || 'en-US';
  const delivery = new Delivery({ console: typeof console === 'undefined' ? null : console, development: __DEV__, page: doc });


  // ── transactions ──
  // A piece of chart work (a call, an input event, a resize) runs inside `run`. It changes state at once, takes
  // event payloads from the state it changed, marks the parts of the DOM to redraw and bumps `epoch`; when the
  // outermost piece ends, `paint` draws the marked parts and then `flush` hands out notifications.
  // Author code (a value formatter) runs only while a part reads its text, and it may change the chart: a
  // nested call inside a paint changes state and marks parts, but never draws. A part reads all its text
  // first, and when `epoch` moved meanwhile it writes nothing and is drawn again from the new state, so the
  // last change always wins and no stale index or text reaches the DOM.
  let committed: Prepared | null = null;
  /** The committed state once every part of the figure shows it (null before the first paint and after destroy). */
  let shown: Prepared | null = null;
  /** Bumped on every commit and on destroy: a finding queued for an older revision is stale. */
  let revision = 0;
  /** Bumped on every commit, drilled-root change and destroy: an event queued for an older view is stale. */
  let view = 0;
  /** Bumped on every state change: a part whose text was read before the latest change is redrawn. */
  let epoch = 0;
  let destroyed = false;
  // Findings made while text is written (a value formatter that throws), for the committed revision only.
  let lateInputs: DiagnosticInput[] = [];
  // Findings the committed revision's handler has actually been handed, and those queued for it: a
  // replacement handler still gets everything, and a finding queued but superseded is queued again.
  let sentTo: Handler | null = null;
  let delivered = new Set<string>();
  let pending = new Set<string>();
  // Presentation findings (found while drawing, not by validation) actually handed to `sentTo` while the
  // value format was `sentFormat`. Every revision draws again and finds them again; they are not handed again
  // while the handler and the format stay the same, or a handler that updates the chart on each one would
  // never let the update return. A new handler or a new format starts empty.
  let lateSent = new Set<string>();
  let sentFormat: unknown = undefined;
  const queue: Queued[] = [];
  let busy = 0;
  let flushing = false;
  let painting = false;

  const CHROME = 1, NOTE = 2, CRUMBS = 4, TABLE = 8, PLOT = 16, ITEM = 32, FOCUS = 64, OVERLAY = 128;
  const ALL = CHROME | NOTE | CRUMBS | TABLE | PLOT | ITEM | OVERLAY;
  let dirty = 0;
  /** A state change: what it invalidates is drawn again, and text read before it is stale. */
  const change = (parts: number): void => { epoch++; dirty |= parts; };
  // A formatter that changes the chart each time it runs would redraw forever: give up after this many.
  const SUPERSEDED_LIMIT = 32;

  function flush(): void {
    if (flushing) return;
    flushing = true;
    try {
      while (queue.length && !destroyed) {
        const q = queue.shift()!;
        if (q.kind === 'diagnostic') {
          if (q.revision !== revision) continue;
          const key = diagnosticKey(q.d);
          pending.delete(key);
          if (delivered.has(key)) continue;
          // Recorded before the handler runs: an update it makes knows this one was handed out.
          delivered.add(key);
          if (q.late) lateSent.add(key);
          delivery.print(q.d);
          if (q.handler) delivery.notify(q.handler, q.d);
        } else {
          if (q.view !== view) continue;
          for (const l of [...listeners.get(q.event) ?? []]) {
            if (q.view !== view || destroyed) break;
            try { l(q.payload); } catch (error) { if (typeof console !== 'undefined') console.error('[axylo] a listener threw:', error); }
          }
        }
      }
    } finally {
      flushing = false;
      if (destroyed) queue.length = 0;
    }
  }
  /** Runs chart work; the outermost piece paints what it marked, then hands out what it queued. */
  function run<T>(work: () => T): T {
    busy++;
    try { return work(); } finally {
      try { if (busy === 1) paint(); } finally { busy--; }
      if (busy === 0) flush();
    }
  }
  /** Queued with the view it describes and a payload taken now, before any author code runs. */
  const emit = (event: keyof HierarchyEvents, payload: unknown): void => {
    queue.push({ kind: 'event', event, payload, view });
  };
  /** Queues the committed revision's findings for its handler, each once. */
  const send = (list: readonly Diagnostic[], late = false): void => {
    const handler = handlerOf(committed!.raw);
    for (const d of list) {
      const key = diagnosticKey(d);
      if (delivered.has(key) || pending.has(key)) continue;
      pending.add(key);
      queue.push({ kind: 'diagnostic', d, handler, revision, late });
    }
  };
  /** The presentation sink of one prepared state: findings of a state that is not (or no longer) committed are dropped. */
  const lateFor = (owner: () => Prepared | null) => (d: DiagnosticInput): void => {
    const c = committed;
    if (destroyed || !c || owner() !== c) return;
    const pub = publicOf(d, c.name);
    const key = diagnosticKey(pub);
    if (c.diagnostics.some(x => diagnosticKey(x) === key) || lateInputs.some(x => diagnosticKey(publicOf(x, c.name)) === key)) return;
    lateInputs.push(d);
    // Only the note changes: text being read stays valid, so this is no state change.
    dirty |= NOTE;
    send([pub], true);
    if (busy === 0) run(() => {});
  };
  const prepareFor = (raw: RawOptions): Prepared => {
    let self: Prepared | null = null;
    self = prepare(type, raw, defaultLocale, lateFor(() => self));
    return self;
  };

  const first = prepareFor(mergeOptions({}, options));
  if (first.rejected) {
    const handler = handlerOf(first.raw);
    for (const d of first.diagnostics) { delivery.print(d); if (handler) delivery.notify(handler, d); }
    throw new StrictError(first.name, first.diagnostics);
  }
  committed = first;
  sentTo = handlerOf(first.raw);
  sentFormat = formatOf(first.raw);
  const id = `axylo-h${++chartCount}`;
  const listeners = new Map<string, Set<Listener>>();

  // ── structure ──
  const figure = el(doc, 'figure', { class: 'axylo-hierarchy', 'data-axylo-type': type });
  // The title and the breadcrumb (the drilled path) are family chrome for a whole-figure export (export/contract.ts).
  const header = el(doc, 'div', { class: 'axylo-h-header', 'data-axylo-export': 'header' });
  let heading: HTMLElement | null = null;
  const nav = el(doc, 'nav', { class: 'axylo-h-breadcrumb' });
  const crumbList = el(doc, 'ol', { class: 'axylo-h-crumbs' });
  nav.appendChild(crumbList);
  const summary = el(doc, 'p', { id: `${id}-summary`, class: HIDDEN });
  const instructions = el(doc, 'p', { id: `${id}-keys`, class: HIDDEN });
  const plot = el(doc, 'div', { class: 'axylo-h-plot', id: `${id}-plot` });
  const svgRoot = svg(doc, 'svg', { class: 'axylo-h-svg', 'aria-hidden': 'true', focusable: 'false' });
  const marks = svg(doc, 'g', { class: 'axylo-hierarchy-marks' });
  const labels = svg(doc, 'g', { class: 'axylo-hierarchy-labels' });
  // `axylo-overlay`: the focus ring and hover outline are transient, never exported (export.ts SKIP).
  const overlay = svg(doc, 'g', { class: 'axylo-hierarchy-overlay axylo-overlay' });
  svgRoot.append(marks, labels, overlay);
  const item = el(doc, 'div', { id: `${id}-item`, role: 'treeitem', class: HIDDEN });
  // Visible text over the plot when there is nothing (or nothing drilled) to show: exported with the figure.
  const empty = el(doc, 'p', { class: 'axylo-h-empty', 'data-axylo-export': 'empty' });
  const tip = el(doc, 'div', { class: 'axylo-h-tip', 'aria-hidden': 'true', hidden: '' });
  plot.append(svgRoot, item, empty, tip);
  const note = el(doc, 'p', { class: 'axylo-h-note', id: `${id}-note`, hidden: '', 'data-axylo-export': 'note' });
  const controls = el(doc, 'div', { class: 'axylo-h-controls' });
  const toggle = el(doc, 'button', { type: 'button', class: 'axylo-h-button', 'aria-expanded': 'false', 'aria-controls': `${id}-table` });
  controls.appendChild(toggle);
  const region = el(doc, 'div', { id: `${id}-table`, class: 'axylo-h-region', role: 'region', tabindex: '0', hidden: '' });
  // Kept across pages and redraws, so a reader paging with the keyboard keeps focus on the button they pressed.
  const pager = el(doc, 'div', { class: 'axylo-h-pager' });
  const previous = el(doc, 'button', { type: 'button', class: 'axylo-h-button' });
  const pageText = el(doc, 'span', { class: 'axylo-h-page' });
  const next = el(doc, 'button', { type: 'button', class: 'axylo-h-button' });
  pager.append(previous, pageText, next);
  figure.append(header, summary, instructions, plot, note, controls, region);
  host.appendChild(figure);
  const rootNode = host.getRootNode?.() as Document | ShadowRoot | undefined;
  if (rootNode) installHierarchyStyles(rootNode);
  const measure = createMeasure(doc);

  // ── view state ──
  let root = 0;
  let focus = 0;
  let hover = -1;
  let tableOpen = false;
  let tablePage = 0;
  let rendered: Rendered | null = null;
  /** The state `rendered` was drawn for: picking answers for that model and root only. */
  let renderedFor: Prepared | null = null;
  let renderedRoot = -1;
  let tipFor = -1;
  let pointer: readonly [number, number] = [0, 0];
  // Set by a key press on the plot, cleared by a pointer press or blur: whether focus is the keyboard's.
  let keyed = false;
  // Escape closed the pointer's tooltip on this node: it stays closed until the pointer reaches another (spec I1).
  let dismissedHover = -1;
  // Escape at the top closed the keyboard reading of this node: until the keyboard moves.
  let dismissedFocus = -1;

  const model = (): HierarchyModel => committed!.model;
  /** Nothing positive in the whole tree (AX192): the chart's empty state. */
  const isEmpty = (): boolean => !isPositive(model(), 0);
  /** The drilled node has nothing to show, though the tree does: an empty plot that still navigates up. */
  const drilledEmpty = (): boolean => root !== 0 && !isPositive(model(), root);
  const tableOn = (): boolean => committed!.raw.table !== false;
  const tooltipOn = (): boolean => committed!.raw.tooltip !== false;
  /** The marks under the pointer, when they show the committed state. */
  const picked = (px: number, py: number): number =>
    rendered && renderedFor === committed && renderedRoot === root ? rendered.pick(px, py) : -1;

  const size = (): { width: number; height: number } => ({ width: plot.clientWidth || 0, height: plot.clientHeight || 0 });

  /**
   * Draws the marked parts. Each part returns false when author code it ran changed the chart before it wrote
   * anything; it is then marked again and drawn from the new state.
   */
  function paint(): void {
    if (painting) return;
    painting = true;
    try {
      let superseded = 0;
      while (dirty && !destroyed) {
        const e = epoch;
        const part = dirty & -dirty;
        dirty &= ~part;
        if (drawPart(part, e) || destroyed) continue;
        dirty |= part;
        if (++superseded > SUPERSEDED_LIMIT) {
          if (typeof console !== 'undefined') console.error('[axylo] a value formatter keeps changing the chart while it is drawn; drawing stopped.');
          break;
        }
      }
      // Every part now shows the committed state: it is what export reads until the next one is drawn. Drawing
      // that stopped (past the limit) keeps the parts it did not draw marked, so the figure mixes revisions and
      // nothing is exported until a later paint, whatever action runs it, has drawn every one of them.
      if (!destroyed) shown = dirty ? null : committed;
    } finally { painting = false; }
  }

  function drawPart(part: number, e: number): boolean {
    switch (part) {
      case CHROME: return drawChrome(e);
      case NOTE: drawNote(); return true;
      case CRUMBS: return drawCrumbs(e);
      case TABLE: return drawTable(e);
      case PLOT: drawPlot(); return true;
      case ITEM: return drawItem(e);
      case FOCUS: if (!isEmpty()) plot.focus(); return true;
      default: return drawOverlay(e);
    }
  }

  function drawChrome(e: number): boolean {
    const c = committed!;
    const description = typeof c.raw.description === 'string' ? c.raw.description : '';
    const text = description ? `${c.reader.summary} ${description}` : c.reader.summary;
    if (epoch !== e) return false;
    // Heading: the author's level, a string title is a level-3 heading (as the other charts).
    const t = c.title;
    if (t && t.visible !== false) {
      const level = t.level ?? 3;
      if (!heading || heading.tagName !== `H${level}`) {
        const next = el(doc, `h${level}` as 'h3', { id: `${id}-title`, class: 'axylo-h-title' });
        if (heading) heading.replaceWith(next); else header.insertBefore(next, header.firstChild);
        heading = next;
      }
      heading.textContent = t.text;
    } else if (heading) { heading.remove(); heading = null; }
    nav.setAttribute('aria-label', c.messages.hierarchyPath);
    const labelledBy = typeof c.raw.labelledBy === 'string' && c.raw.labelledBy ? c.raw.labelledBy : null;
    figure.removeAttribute('aria-label');
    figure.removeAttribute('aria-labelledby');
    if (labelledBy) figure.setAttribute('aria-labelledby', labelledBy);
    else if (heading) figure.setAttribute('aria-labelledby', heading.id);
    else figure.setAttribute('aria-label', c.name);
    summary.textContent = text;
    instructions.textContent = c.messages.instructions;
    if (!header.contains(nav)) header.appendChild(nav);
    drawNote();
    return true;
  }

  /** The reader's note, with late findings included, and the plot's description that names it. */
  function drawNote(): void {
    const c = committed!;
    const text = lateInputs.length ? noteFor(c.messages, [...c.inputs, ...lateInputs]) : c.note;
    note.textContent = text ?? '';
    note.hidden = text === null;
    const ids = [summary.id, ...(text === null ? [] : [note.id]), ...(plot.getAttribute('role') === 'tree' ? [instructions.id] : [])];
    plot.setAttribute('aria-describedby', ids.join(' '));
  }

  function drawCrumbs(e: number): boolean {
    const c = committed!;
    const m = c.model;
    const chain: number[] = [];
    for (let k = root; k >= 0; k = m.parent[k]!) chain.push(k);
    chain.reverse();
    const texts = chain.map(n => c.reader.node(n));
    if (epoch !== e) return false;
    const current = root;
    const items: HTMLLIElement[] = [];
    for (let k = 0; k < chain.length; k++) {
      const n = chain[k]!;
      const t = texts[k]!;
      const li = el(doc, 'li');
      if (k > 0) {
        const sep = el(doc, 'span', { 'aria-hidden': 'true' });
        sep.textContent = '›';
        li.appendChild(sep);
      }
      if (n === current) {
        const span = el(doc, 'span', { class: 'axylo-h-current', 'aria-current': 'location', 'data-node': String(n), title: t.path });
        span.textContent = t.label;
        li.appendChild(span);
      } else {
        const b = el(doc, 'button', { type: 'button', class: 'axylo-h-button', 'data-node': String(n), title: t.path });
        b.textContent = t.label;
        b.addEventListener('click', () => run(() => {
          // A button of a bar that no longer shows the committed path does nothing.
          if (destroyed || committed !== c || !within(m, n, root)) return;
          // The child of the ancestor on the way to where we were keeps focus continuity.
          let child = root;
          while (child >= 0 && m.parent[child] !== n) child = m.parent[child]!;
          setRoot(n, child >= 0 ? child : n, true);
        }));
        li.appendChild(b);
      }
      items.push(li);
    }
    crumbList.replaceChildren(...items);
    return true;
  }

  function drawTable(e: number): boolean {
    const c = committed!;
    const open = tableOpen && tableOn();
    const tm = c.reader.table;
    const pages = Math.max(1, Math.ceil(tm.rowCount / tm.pageSize));
    const page = Math.min(tablePage, pages - 1);
    const first = page * tm.pageSize;
    const rows: (readonly string[] | null)[] = [];
    // Only the shown page is formatted; export reads every row through the model, open or closed.
    if (open) for (let r = first; r < Math.min(tm.rowCount, first + tm.pageSize); r++) rows.push(tm.row(r));
    if (epoch !== e) return false;
    tablePage = page;
    toggle.textContent = tableOpen ? c.messages.hideTable : c.messages.viewAsTable;
    toggle.setAttribute('aria-expanded', String(tableOpen));
    controls.hidden = !tableOn();
    region.setAttribute('aria-label', tm.caption);
    if (!open) { region.hidden = true; region.replaceChildren(); return true; }
    const table = el(doc, 'table');
    const caption = el(doc, 'caption');
    caption.textContent = tm.caption;
    const thead = el(doc, 'thead');
    const hr = el(doc, 'tr');
    for (const h of tm.headers) { const th = el(doc, 'th', { scope: 'col' }); th.textContent = h; hr.appendChild(th); }
    thead.appendChild(hr);
    const tbody = el(doc, 'tbody');
    rows.forEach((cells, r) => {
      if (!cells) return;
      const tr = el(doc, 'tr', { 'data-node': String(first + r) });
      cells.forEach((text, k) => {
        const cell = el(doc, k === 0 ? 'th' : 'td', k === 0 ? { scope: 'row' } : {});
        cell.textContent = text;
        tr.appendChild(cell);
      });
      tbody.appendChild(tr);
    });
    table.append(caption, thead, tbody);
    previous.textContent = c.messages.previousPage;
    next.textContent = c.messages.nextPage;
    previous.setAttribute('aria-disabled', String(page === 0));
    next.setAttribute('aria-disabled', String(page >= pages - 1));
    pageText.textContent = c.messages.pageOf.replace('{page}', String(page + 1)).replace('{count}', String(pages));
    pager.hidden = pages <= 1;
    region.hidden = false;
    region.replaceChildren(table, pager);
    return true;
  }

  /** Marks and the plot's role; runs no author code. */
  function drawPlot(): void {
    const c = committed!;
    const m = c.model;
    const { width, height } = size();
    svgRoot.setAttribute('width', String(width));
    svgRoot.setAttribute('height', String(height));
    svgRoot.setAttribute('viewBox', `0 0 ${width} ${height}`);
    marks.replaceChildren();
    labels.replaceChildren();
    renderedFor = c;
    renderedRoot = root;
    if (isEmpty()) {
      rendered = null;
      empty.hidden = false;
      empty.removeAttribute('aria-hidden');
      empty.textContent = c.messages.empty;
      plot.removeAttribute('tabindex');
      plot.removeAttribute('aria-activedescendant');
      plot.removeAttribute('aria-roledescription');
      plot.setAttribute('role', 'img');
      plot.setAttribute('aria-label', `${c.name}. ${c.messages.empty}`);
      item.remove();
      drawNote();
      return;
    }
    plot.setAttribute('role', 'tree');
    plot.setAttribute('tabindex', '0');
    plot.setAttribute('aria-roledescription', type === 'treemap' ? c.messages.typeTreemap : c.messages.typeSunburst);
    plot.setAttribute('aria-label', c.name);
    drawNote();
    if (drilledEmpty()) {
      // Visible text; readers get the same through the focused item (its value) and the breadcrumb.
      empty.hidden = false;
      empty.setAttribute('aria-hidden', 'true');
      empty.textContent = c.messages.emptyBranch.replace('{label}', m.labels[root]!);
    } else {
      empty.hidden = true;
    }
    if (!plot.contains(item)) plot.insertBefore(item, empty);
    plot.setAttribute('aria-activedescendant', item.id);
    rendered = width > 0 && height > 0
      ? driver.render({ doc, model: m, root, width, height, marks, labels, measure, lineHeight: 14 })
      : null;
    figure.setAttribute('data-labelled', String(rendered?.labelled ?? 0));
  }

  /** The single tree item carries the focused node: its place, its text and whether it opens. */
  function drawItem(e: number): boolean {
    if (isEmpty()) return true;
    const c = committed!;
    const m = c.model;
    const at = focus;
    const text = nodeSentence(c.reader.node(at), c.messages);
    if (epoch !== e) return false;
    const p = m.parent[at]!;
    item.textContent = text;
    item.setAttribute('aria-level', String(m.depth[at]! - m.depth[root]! + 1));
    item.setAttribute('aria-setsize', String(at === root || p < 0 ? 1 : childCount(m, p)));
    item.setAttribute('aria-posinset', String(at === root || p < 0 ? 1 : m.sibling[at]! + 1));
    item.setAttribute('aria-selected', 'true');
    item.setAttribute('data-node', String(at));
    if (isBranch(m, at)) item.setAttribute('aria-expanded', String(at === root));
    else item.removeAttribute('aria-expanded');
    return true;
  }

  function drawOverlay(e: number): boolean {
    const c = committed!;
    const shownRendered = rendered && renderedFor === c && renderedRoot === root ? rendered : null;
    const reading = keyboardReading();
    const pointerTip = hover >= 0 && hover !== dismissedHover;
    const shown = !shownRendered || !tooltipOn() ? -1 : pointerTip ? hover : reading && focus !== dismissedFocus ? focus : -1;
    const anchor = shown >= 0 ? shownRendered!.anchor(shown) : null;
    // The tooltip's text is read before anything is written: reading it may run the author's formatter.
    const t = anchor && tipFor !== shown ? c.reader.node(shown) : null;
    if (epoch !== e) return false;
    overlay.replaceChildren();
    if (!shownRendered) { hideTip(); return true; }
    if (hover >= 0 && hover !== focus) shownRendered.outline(overlay, hover, 'hover');
    if (reading) shownRendered.outline(overlay, focus, 'focus');
    if (!anchor) { hideTip(); return true; }
    if (t) {
      const title = el(doc, 'div', { class: 'axylo-h-tip-title' });
      title.textContent = t.path;
      const rows: [string, string][] = [
        [c.reader.valueLabel, t.value], [c.messages.shareOfParent, t.shareOfParent], [c.messages.shareOfRoot, t.shareOfRoot],
      ];
      const list = el(doc, 'dl');
      for (const [k, v] of rows) {
        const dt = el(doc, 'dt'); dt.textContent = k;
        const dd = el(doc, 'dd'); dd.textContent = v;
        list.append(dt, dd);
      }
      tip.replaceChildren(title, list);
      tip.setAttribute('data-node', String(shown));
      tipFor = shown;
    }
    placeTip(anchor, pointerTip ? pointer : null);
    return true;
  }

  const plotFocused = (): boolean => doc.activeElement === plot;
  // The focus ring and the keyboard reading show for keyboard focus only, as :focus-visible decides; a click
  // that focuses the plot shows neither. Without :focus-visible support (or no DOM matching), a key press decides.
  const keyboardReading = (): boolean => {
    if (!plotFocused()) return false;
    if (keyed) return true;
    try { return typeof plot.matches === 'function' && plot.matches(':focus-visible'); } catch { return false; }
  };

  /** `at`: the pointer, which the tooltip sits beside and never covers (spec I1); else the mark's box. */
  function placeTip(anchor: { x: number; y: number; width: number; height: number }, at: readonly [number, number] | null): void {
    const box = at ? { x: at[0], y: at[1], width: 0, height: 0 } : anchor;
    tip.hidden = false;
    const { width, height } = size();
    const tw = tip.offsetWidth || 160, th = tip.offsetHeight || 60;
    // Beside the point or mark: right of it when there is room, else left; clamped to the plot. Only a mark
    // wider than the plot leaves no side, and then the tooltip sits at its top.
    const gap = at ? 14 : 8;
    const right = box.x + box.width + gap;
    let x = right + tw <= width ? right : box.x - tw - gap;
    let y = box.y + box.height / 2 - th / 2;
    if (x < 0) {
      x = Math.max(0, Math.min(width - tw, box.x + box.width / 2 - tw / 2));
      y = at ? (box.y - th - gap >= 0 ? box.y - th - gap : box.y + gap) : box.y + 2;
    }
    y = Math.max(0, Math.min(height - th, y));
    style(tip, { left: `${Math.round(x)}px`, top: `${Math.round(y)}px` });
  }

  function hideTip(): void {
    tip.hidden = true;
    tipFor = -1;
  }

  /** Moves the drilled root (and focus inside it); events describe the state set here. */
  function setRoot(next: number, nextFocus: number, moveFocus: boolean): void {
    const m = model();
    const f = within(m, next, nextFocus) ? nextFocus : next;
    const changed = next !== root;
    const hovered = hover >= 0;
    if (changed || f !== focus || hovered || dismissedHover >= 0 || dismissedFocus >= 0) {
      root = next;
      focus = f;
      hover = -1;
      dismissedHover = -1;
      dismissedFocus = -1;
      if (changed) view++;
      change(changed ? CRUMBS | PLOT | ITEM | OVERLAY : ITEM | OVERLAY);
      if (hovered) emit('hover', null);
      if (changed) emit('drill', pointOf(m, root));
    }
    if (moveFocus) dirty |= FOCUS;
  }

  // ── input ──
  const localPoint = (e: PointerEvent | MouseEvent): [number, number] => {
    const r = plot.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const onMove = (e: PointerEvent): void => run(() => {
    if (destroyed) return;
    const [px, py] = localPoint(e);
    const n = picked(px, py);
    pointer = [px, py];
    plot.style.setProperty('cursor', n >= 0 && activates(model(), root, n) ? 'pointer' : 'default');
    if (n === hover) {
      // The tooltip follows the pointer.
      if (n >= 0 && n !== dismissedHover) change(OVERLAY);
      return;
    }
    // A different datum: an Escape-dismissed tooltip may show again (spec I1).
    if (n !== dismissedHover) dismissedHover = -1;
    hover = n;
    change(OVERLAY);
    emit('hover', n >= 0 ? pointOf(model(), n) : null);
  });
  const onLeave = (): void => run(() => {
    if (hover < 0 || destroyed) return;
    hover = -1;
    change(OVERLAY);
    emit('hover', null);
  });
  const onClick = (e: MouseEvent): void => run(() => {
    if (destroyed) return;
    const [px, py] = localPoint(e);
    const n = picked(px, py);
    if (n < 0) return;
    const m = model();
    const r = activate(m, type, root, n);
    if (r.select) {
      if (focus !== n) { focus = n; change(ITEM | OVERLAY); }
      emit('select', pointOf(m, n));
      return;
    }
    if (r.root !== root) setRoot(r.root, r.focus, false);
  });
  const onKey = (e: KeyboardEvent): void => run(() => {
    if (destroyed || !isHierarchyKey(e.key) || isEmpty() || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const m = model();
    if (!keyed) { keyed = true; change(OVERLAY); }
    if (e.key === 'Escape') {
      // Escape closes a pointer's tooltip (spec I1) and, on the same key, ascends when there is a parent;
      // at the top it only closes what is shown.
      if (hover >= 0 && !tip.hidden && tipFor === hover) dismissedHover = hover;
      if (m.parent[focus]! < 0) { dismissedFocus = focus; change(OVERLAY); return; }
    }
    dismissedFocus = -1;
    const r = navigate(m, { root, focus }, e.key, type);
    if (r.select) { emit('select', pointOf(m, focus)); return; }
    if (r.root !== root) { setRoot(r.root, r.focus, false); return; }
    const hovered = hover >= 0;
    // The keyboard takes over the reading from the pointer.
    hover = -1;
    focus = r.focus;
    change(ITEM | OVERLAY);
    if (hovered) emit('hover', null);
  });
  const onFocus = (): void => run(() => { if (!destroyed) change(OVERLAY); });
  const onBlur = (): void => run(() => { keyed = false; if (!destroyed) change(OVERLAY); });
  const onDown = (): void => { keyed = false; };
  const onToggle = (): void => run(() => { if (destroyed) return; tableOpen = !tableOpen; change(TABLE); });
  const turn = (by: number) => (): void => run(() => {
    if (destroyed || !tableOpen) return;
    const tm = committed!.reader.table;
    const target = Math.max(0, Math.min(tablePage + by, Math.ceil(tm.rowCount / tm.pageSize) - 1));
    if (target !== tablePage) { tablePage = target; change(TABLE); }
  });
  const onPrevious = turn(-1), onNext = turn(1);
  plot.addEventListener('pointermove', onMove);
  plot.addEventListener('pointerdown', onDown);
  plot.addEventListener('pointerleave', onLeave);
  plot.addEventListener('click', onClick);
  plot.addEventListener('keydown', onKey);
  plot.addEventListener('focus', onFocus);
  plot.addEventListener('blur', onBlur);
  toggle.addEventListener('click', onToggle);
  previous.addEventListener('click', onPrevious);
  next.addEventListener('click', onNext);
  let observer: ResizeObserver | null = null;
  if (win && typeof win.ResizeObserver === 'function') {
    let last = '';
    observer = new win.ResizeObserver(() => {
      const s = size();
      const key = `${s.width}x${s.height}`;
      if (key === last || destroyed) return;
      last = key;
      run(() => change(PLOT | OVERLAY));
    });
    observer.observe(plot);
  }

  /** A handle read that runs author code (a formatter) is redone when that code changed the chart. */
  const read = <T>(work: () => T): T => {
    for (let tries = 0; ; tries++) {
      const e = epoch;
      const out = run(work);
      if (e === epoch || tries === 2) return out;
    }
  };

  const handle: HierarchyChart<Options> = {
    update(patch) {
      if (destroyed) return;
      run(() => {
        const raw: RawOptions = mergeOptions(committed!.raw, patch);
        const next = prepareFor(raw);
        const handler = handlerOf(raw);
        if (next.rejected) {
          // Nothing changed: the committed data, diagnostics, drilled root, focus and table stay as they were.
          // The call's handler gets every finding it has not been handed (or is not about to be handed) for
          // the committed state; a new handler has been handed nothing yet.
          const known = handler === sentTo ? new Set([...delivered, ...pending]) : new Set<string>();
          for (const d of next.diagnostics) {
            if (known.has(diagnosticKey(d))) continue;
            delivery.print(d);
            if (handler) delivery.notify(handler, d);
          }
          throw new StrictError(next.name, next.diagnostics);
        }
        const before = committed!;
        committed = next;
        revision++;
        view++;
        lateInputs = [];
        // Persisting findings actually handed to this handler are not handed again; a replacement handler
        // gets all of them, and so does a finding that was only queued for the replaced revision.
        // Presentation findings handed out carry forward only for the same handler and the same format; they
        // are still found again by this revision's drawing, so its diagnostics and note show them.
        const kept = new Set<string>();
        if (handler === sentTo) for (const d of next.diagnostics) if (delivered.has(diagnosticKey(d))) kept.add(diagnosticKey(d));
        const format = formatOf(raw);
        if (handler !== sentTo || !Object.is(format, sentFormat)) lateSent = new Set();
        for (const key of lateSent) kept.add(key);
        delivered = kept;
        pending = new Set();
        sentTo = handler;
        sentFormat = format;
        // Focus continuity: the same identities (restoreIndex), else the top-level view and its root. A
        // sunburst keeps a leaf at its center.
        const m = next.model;
        const r = restoreIndex(before.model, root, m);
        root = r >= 0 && (type === 'sunburst' || r === 0 || isBranch(m, r)) ? r : 0;
        const f = restoreIndex(before.model, focus, m);
        focus = f >= 0 && within(m, root, f) ? f : root;
        hover = -1;
        tipFor = -1;
        dismissedHover = -1;
        dismissedFocus = -1;
        // Queued now, handed out once drawn: a handler that reads the handle sees the new state.
        send(next.diagnostics);
        change(ALL);
      });
    },
    on(event, listener) {
      let set = listeners.get(event);
      if (!set) listeners.set(event, set = new Set());
      set.add(listener as Listener);
      return () => { set!.delete(listener as Listener); };
    },
    drill(target) {
      if (destroyed) return false;
      return run(() => {
        const m = model();
        const n = target === null ? 0 : indexOfId(m, target);
        if (n < 0 || (n !== 0 && type === 'treemap' && !isBranch(m, n))) return false;
        setRoot(n, childCount(m, n) ? childAt(m, n, 0) : n, false);
        return true;
      });
    },
    get diagnostics() {
      const c = committed!;
      return [...c.diagnostics, ...lateInputs.map(d => publicOf(d, c.name))];
    },
    get table() { return tableOn() ? committed!.reader.table : null; },
    get breadcrumb() {
      return read(() => {
        const c = committed!;
        const m = c.model;
        const out: HierarchyCrumb[] = [];
        for (let k = root; k >= 0; k = m.parent[k]!) out.push({ ...c.reader.node(k), current: k === root });
        return out.reverse();
      });
    },
    get drilled() { return pointOf(model(), root); },
    get focused() { return isEmpty() ? null : pointOf(model(), focus); },
    element: figure,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      revision++;
      view++;
      epoch++;
      dirty = 0;
      queue.length = 0;
      observer?.disconnect();
      plot.removeEventListener('pointermove', onMove);
      plot.removeEventListener('pointerdown', onDown);
      plot.removeEventListener('pointerleave', onLeave);
      plot.removeEventListener('click', onClick);
      plot.removeEventListener('keydown', onKey);
      plot.removeEventListener('focus', onFocus);
      plot.removeEventListener('blur', onBlur);
      toggle.removeEventListener('click', onToggle);
      previous.removeEventListener('click', onPrevious);
      next.removeEventListener('click', onNext);
      listeners.clear();
      unregister?.();
      shown = null;
      figure.remove();
    },
  };

  // The read-only capability for axylo/export (export/contract.ts). It reads the state the figure fully shows:
  // while parts are drawn (a value formatter runs in between, and may export) the header and note can already
  // show the next state over the previous marks, so the plot is absent; the table stays the one last shown. The
  // plot is the mark surface: the tooltip, the focused item and the overlay's focus ring and hover outline are
  // not part of an exported image.
  const seam: ExportSeam = Object.freeze({
    get table() { return shown && shown.raw.table !== false ? shown.reader.table : null; },
    get figure() { return shown && figure; },
    get plot() { return shown && !painting && !dirty && shown === committed ? svgRoot : null; },
  });
  Object.defineProperty(handle, EXPORT, { value: seam });
  const unregister = register(seam, figure);

  // Create-call findings go out after the chart is drawn: a handler may already read the handle.
  run(() => {
    send(first.diagnostics);
    change(ALL);
  });
  return handle;
}
