/**
 * The chart's document structure (plan 2.4; spec A1, C1, F12, L7). The author's target is the root; inside
 * it the figure holds the caption (title, subtitle, summary), the plot container (marks, text layer, state
 * message), the reader's note, a polite live region and the tooltip. Only text is ever set, never HTML.
 *
 * The interaction layer (dom/interaction.ts) adds the keyboard proxy inside the plot and fills the control
 * slots (`top` above the plot, `side` beside it, `controls` under it: legend, toolbar, table) and `readout`;
 * the figure only provides those slots. The plot and `side` share the `body` row.
 */
import { activeElementOf, hideFromAT, isFocusable, make, placeChildren, setAttr, setText } from './attributes';

export interface TitleModel {
  readonly text: string;
  readonly level: number;
  readonly visible: boolean;
}

export interface NoteSegment {
  readonly text: string;
  readonly lang: string | null;
}

export interface FigureModel {
  readonly compact: boolean;
  /** The heading, or null when there is none (only `labelledBy`, or no title at all). */
  readonly title: TitleModel | null;
  /** Id of a heading the page already has. */
  readonly labelledBy: string | null;
  /** Accessible name when neither a title nor `labelledBy` names the chart (generated, AX140). */
  readonly name: string;
  readonly subtitle: string | null;
  readonly summary: string;
  /** The plot is too small to draw (spec L8): the summary is shown instead. */
  readonly summaryVisible: boolean;
  readonly note: string | null;
  /** Loading, empty, error or internal-error text shown inside the plot (spec L7); null when marks are shown. */
  readonly message: string | null;
  /**
   * `lang` for the message and the note: 'en' when they show built-in English on a page in another
   * language (spec A10), else null.
   */
  readonly messageLang?: string | null;
  readonly noteLang?: string | null;
  /**
   * The note as runs of text, each with its own `lang` (A10: a sentence can mix built-in English and the
   * author's text). When given, it is the note's content and `noteLang` is not used.
   */
  readonly noteSegments?: readonly NoteSegment[] | null;
  /** `lang` of the generated summary: 'en' when its built-in sentences are English on another page (A10). */
  readonly summaryLang?: string | null;
}

export interface FigureOptions {
  readonly compact?: boolean;
}

export interface Figure {
  readonly figure: HTMLElement;
  readonly plot: HTMLElement;
  readonly tooltip: HTMLElement;
  /** The readout strip under the plot (readout mode, decided by layout): two reserved lines of running text. */
  readonly readout: HTMLElement;
  /** Legend, toolbar and table, in that order, between the plot and the note. */
  readonly controls: HTMLElement;
  /** Between the caption and the plot (`legend: 'top'`). */
  readonly top: HTMLElement;
  /** Beside the plot, in the same row (`legend: 'right'`). */
  readonly side: HTMLElement;
  /** The row holding the plot's column and `side`; it takes the height the caption and controls leave. */
  readonly body: HTMLElement;
  /** The plot's column inside `body`: the open table covers this, never the controls beside it. */
  readonly stage: HTMLElement;
  readonly id: string;
  /** Whether a lazy control slot (`top` or `side`) is currently mounted in the figure. */
  hasSlot(slot: 'top' | 'side'): boolean;
  /** Places `wanted` into a control slot; detaches lazy `top`/`side` slots when emptied. */
  placeControls(slot: 'top' | 'side' | 'controls', wanted: readonly Element[]): void;
  /** Text signature of currently mounted, visible control slots without force-creating lazy slots. */
  controlsSignature(): string;
  /** Clears and hides `controls`, and detaches lazy `top`/`side` slots without creating them. */
  clearControls(): void;
  /** Returns true when something that can change the figure's layout was written. */
  update(model: FigureModel): boolean;
  /** Puts text in the polite live region (state changes only, spec L7, A7). */
  /** `lang` marks built-in English on a page in another language (spec A10). */
  announce(text: string, lang?: string | null): void;
  /** Removes everything the figure added to the root, and the root's added class. */
  destroy(): void;
}

const HIDDEN = 'axylo-visually-hidden';
const EMPTY_ELEMENTS: readonly Element[] = [];

function show(el: HTMLElement, visible: boolean): void {
  if (el.hidden === visible) el.hidden = !visible;
}

function insertBefore(parent: HTMLElement, node: Node, ref: Node | null): void {
  if (ref && typeof parent.insertBefore === 'function') parent.insertBefore(node, ref);
  else parent.appendChild(node);
}

function containsNode(host: HTMLElement | null, node: Element | null): boolean {
  return host !== null && node !== null && typeof host.contains === 'function' && host.contains(node);
}

function slotText(el: HTMLElement | null): string {
  return el && el.parentNode !== null && !el.hidden ? el.textContent ?? '' : '';
}

/**
 * Prototype-backed figure instance: keeps every chart in V8 fast-property mode with shared getters/methods
 * and zero per-instance closures. Compact charts omit `body` and `stage` wrappers until promoted to full.
 */
class FigureImpl implements Figure {
  readonly figure: HTMLElement;
  readonly plot: HTMLElement;
  readonly id: string;

  readonly _d: Document;
  readonly _r: HTMLElement;
  readonly _ic: boolean;
  readonly _ac: boolean;
  readonly _hc: boolean;
  readonly _ds: HTMLElement;
  readonly _m: HTMLElement;
  readonly _n: HTMLElement;

  // Lazily created/mounted structural elements. Full charts mount body/stage/caption/title/summary/readout/
  // controls/live/tooltip initially; subtitle, corner, top and side are always lazy on every chart.
  _b: HTMLElement | null = null;
  _st: HTMLElement | null = null;
  _c: HTMLElement | null = null;
  _t: HTMLElement | null = null;
  _su: HTMLElement | null = null;
  _sm: HTMLElement | null = null;
  _co: HTMLElement | null = null;
  _l: HTMLElement | null = null;
  _tp: HTMLElement | null = null;
  _ro: HTMLElement | null = null;
  _ct: HTMLElement | null = null;
  _a: HTMLElement | null = null;
  _s: HTMLElement | null = null;
  _p: FigureModel | null = null;

  constructor(
    root: HTMLElement,
    id: string,
    parts: { marks: Element; text?: Element | null },
    options?: FigureOptions,
  ) {
    const doc = root.ownerDocument;
    const initialCompact = Boolean(options?.compact);
    const addedClass = !root.classList.contains('axylo');
    const hadClassAttribute = root.hasAttribute('class');
    if (addedClass) root.classList.add('axylo');

    this._d = doc;
    this._r = root;
    this.id = id;
    this._ic = initialCompact;
    this._ac = addedClass;
    this._hc = hadClassAttribute;

    // The figure carries the `axylo` class too: the theme writes its custom properties and scheme attribute on
    // the figure, so two charts on one target never share them (review 3, finding 10).
    const figure = this.figure = make(doc, 'figure', 'axylo axylo-figure');
    figure.id = id;

    // The whole generated summary is the figure's description, always (visually hidden). On compact charts it
    // sits directly in `figure` before `plot`; on full charts it lives inside `caption`.
    const description = this._ds = identified(doc, 'p', `description ${HIDDEN}`, id, 's');

    const plot = this.plot = element(doc, 'plot');
    const message = this._m = identified(doc, 'p', 'message', id, 'm');
    message.hidden = true;
    if (parts.text) plot.append(parts.marks, parts.text, message);
    else plot.append(parts.marks, message);

    const note = this._n = identified(doc, 'p', 'note', id, 'n');
    note.setAttribute('role', 'status');
    // A status that is not live: the note can change as streamed data arrives (labels thinned, values left
    // out), and data arriving must not speak (spec A7). The summary carries the same statements.
    note.setAttribute('aria-live', 'off');
    note.hidden = true;

    if (initialCompact) figure.append(description, plot, note);
    else {
      figure.appendChild(note);
      ensureFull(this);
    }
    root.appendChild(figure);
  }

  get tooltip(): HTMLElement { return ensureTooltip(this); }
  get readout(): HTMLElement {
    ensureBodyStage(this);
    return ensureReadout(this);
  }
  get controls(): HTMLElement { return ensureControls(this); }
  get top(): HTMLElement { return ensureTop(this); }
  get side(): HTMLElement { return ensureSide(this); }
  get body(): HTMLElement { return ensureBodyStage(this); }
  // On compact charts `plot` sits directly inside `figure`, so `plot` itself is the stage column and
  // measuring `figure.stage` does not force-create or mutate wrapper divs during read passes.
  get stage(): HTMLElement {
    return this._b?.parentNode === this.figure ? this._st! : this.plot;
  }

  hasSlot(slot: 'top' | 'side'): boolean {
    const host = slot === 'top' ? this._a : this._s;
    return host !== null && host.parentNode !== null;
  }

  placeControls(slot: 'top' | 'side' | 'controls', wanted: readonly Element[]): void {
    if (!wanted.length) {
      const host = slot === 'top' ? this._a : slot === 'side' ? this._s : this._ct;
      if (host) {
        if (host.firstChild) host.replaceChildren();
        if (slot !== 'controls') {
          show(host, false);
          detach(host);
        } else show(host, false);
      }
      return;
    }
    const host = slot === 'top' ? this.top : slot === 'side' ? this.side : this.controls;
    placeChildren(host, wanted);
    show(host, true);
  }

  clearControls(): void {
    this.placeControls('top', EMPTY_ELEMENTS);
    this.placeControls('side', EMPTY_ELEMENTS);
    this.placeControls('controls', EMPTY_ELEMENTS);
  }

  controlsSignature(): string {
    return `${slotText(this._a)}\u0000${slotText(this._s)}\u0000${slotText(this._ct)}`;
  }

  update(model: FigureModel): boolean {
    const previous = this._p;
    if (previous && same(previous, model)) return false;
    const moved = previous === null || movesLayout(previous, model);
    this._p = model;
    const { compact, title, subtitle, summary, summaryLang, note: noteText, message, messageLang } = model;
    const { figure, plot, _ds: description, _n: note, _m: status } = this;
    const modeChanged = previous === null || previous.compact !== compact;
    if (modeChanged) {
      figure.classList.toggle('axylo-compact', compact);
      setAttr(figure, 'role', compact ? 'img' : 'group');
      if (compact) makeCompact(this, previous);
      else if (previous?.compact ?? this._ic) ensureFull(this);
    }

    // Name: the title, else the page's own heading, else the generated name.
    const heading = compact ? null : title;
    const titleNode = this._t;
    const headingChanged = modeChanged || !sameTitle(previous!.title, title);
    if (titleNode && headingChanged) {
      if (heading) {
        setText(titleNode, heading.text);
        setAttr(titleNode, 'aria-level', String(heading.level));
        if (modeChanged || previous!.title?.visible !== heading.visible) titleNode.classList.toggle(HIDDEN, !heading.visible);
      }
      show(titleNode, heading !== null);
    }
    if (headingChanged || previous!.labelledBy !== model.labelledBy || previous!.name !== model.name) {
      const labelledBy = model.labelledBy || (heading ? titleNode!.id : null);
      setAttr(figure, 'aria-labelledby', labelledBy);
      setAttr(figure, 'aria-label', labelledBy === null ? model.name : null);
    }

    if (modeChanged || previous!.subtitle !== subtitle) {
      if (!compact && subtitle) {
        const sub = this._su ??= identified(this._d, 'p', 'subtitle', this.id, 'st');
        setText(sub, subtitle);
        show(sub, true);
        mount(this._c!, sub, description);
      } else clearSubtitle(this._su);
    }

    const summaryChanged = previous === null || previous.summary !== summary || previous.summaryLang !== summaryLang;
    if (summaryChanged) textWithLang(description, summary, summaryLang);
    const summaryNode = this._sm;
    if (summaryNode && !compact) {
      if (modeChanged || summaryChanged) {
        textWithLang(summaryNode, /^.*?[.!?。！？](?=\s|$)/u.exec(summary)?.[0] ?? summary, summaryLang);
      }
      if (modeChanged || previous!.summaryVisible !== model.summaryVisible) summaryNode.classList.toggle(HIDDEN, !model.summaryVisible);
    }
    if (previous === null) setAttr(figure, 'aria-describedby', description.id);

    // The compact variant has no note element: the summary says what was left out, and a corner marker
    // shows it (spec C5); the marker's text equivalent is that description.
    const segments = compact ? null : model.noteSegments ?? null;
    const segmentsChanged = modeChanged || !sameSegments(segments, previous!.noteSegments);
    if (segmentsChanged || previous!.note !== noteText || previous!.noteLang !== model.noteLang) {
      if (segments && segments.length > 1) {
        // One span per language run lets assistive technology switch voice.
        if (segmentsChanged) {
          const spans = segments.map(run => {
            const span = this._d.createElement('span');
            span.textContent = run.text;
            if (run.lang !== null) span.setAttribute('lang', run.lang);
            return span;
          });
          note.replaceChildren(...spans);
        }
        setAttr(note, 'lang', null);
      } else {
        if (note.firstElementChild) note.textContent = '';
        setText(note, compact ? '' : segments?.[0]?.text ?? noteText ?? '');
        setAttr(note, 'lang', segments ? segments[0]?.lang ?? null : model.noteLang ?? null);
      }
      show(note, !compact && noteText !== null);
    }

    const showCorner = compact && noteText !== null;
    if (showCorner) {
      if (!this._co) {
        const corner = this._co = element(this._d, 'corner', 'span');
        hideFromAT(corner);
        corner.textContent = '*';
      }
      show(this._co, true);
      setAttr(this._co, 'title', noteText);
      mount(plot, this._co);
    } else if (this._co && (modeChanged || previous!.note !== noteText)) {
      detach(this._co);
      show(this._co, false);
      setAttr(this._co, 'title', null);
    }

    if (previous === null || previous.message !== message) {
      setText(status, message ?? '');
      show(status, message !== null);
    }
    if (previous === null || previous.messageLang !== messageLang) setAttr(status, 'lang', messageLang ?? null);
    return moved;
  }

  announce(text: string, lang: string | null = null): void {
    const region = ensureLive(this);
    setAttr(region, 'lang', lang);
    if (region.textContent === text) {
      // Replace the text node so an identical re-announcement is still observed by assistive technology.
      if (text !== '') region.replaceChildren(this._d.createTextNode(text));
    } else {
      region.textContent = text;
    }
  }

  destroy(): void {
    this.figure.remove();
    if (this._ac) this._r.classList.remove('axylo');
    if (!this._hc && this._r.classList.length === 0) this._r.removeAttribute('class');
  }
}

function element(doc: Document, name: string, tag: 'div' | 'p' | 'span' = 'div'): HTMLElement {
  return make(doc, tag, `axylo-${name}`);
}

function identified(doc: Document, tag: 'div' | 'p', name: string, id: string, suffix: string): HTMLElement {
  const node = element(doc, name, tag);
  node.id = `${id}-${suffix}`;
  return node;
}

function textWithLang(node: HTMLElement, text: string, lang?: string | null): void {
  setText(node, text);
  setAttr(node, 'lang', lang ?? null);
}

function makeCompact(f: FigureImpl, previous: FigureModel | null): void {
  const { figure, _b: body } = f;
  // Preserve focus on the figure when switching a full chart to compact before interaction.prepare runs.
  const active = activeElementOf(f._d, figure);
  const hadFocus = containsNode(f._ct, active) || containsNode(f._ro, active) ||
    containsNode(f._tp, active) || containsNode(f._a, active) ||
    containsNode(f._s, active) || (body?.parentNode === figure && containsNode(body, active));
  if (f._c && f._c.parentNode === figure) {
    insertBefore(figure, f._ds, beforeBody(f));
    f._c.remove();
  }
  clearSubtitle(f._su);
  detach(f._ct, figure);
  if (f._st) detach(f._ro, f._st);
  detach(f._tp, figure);
  if (!(previous?.compact ?? f._ic)) detach(f._l, figure);
  if (body?.parentNode === figure) {
    insertBefore(figure, f.plot, body);
    body.remove();
  }
  if (hadFocus && isFocusable(figure)) {
    if (!figure.hasAttribute('tabindex')) figure.setAttribute('tabindex', '-1');
    figure.focus({ preventScroll: true });
  }
}

/** Move a node only when its slot's parent changes, so focused descendants stay in place. */
function mount(parent: HTMLElement, node: HTMLElement, before: Node | null = null): HTMLElement {
  if (node.parentNode !== parent) insertBefore(parent, node, before);
  return node;
}

function detach(node: HTMLElement | null, parent = node?.parentNode): void {
  if (node && parent && node.parentNode === parent) node.remove();
}

function clearSubtitle(node: HTMLElement | null): void {
  if (node) {
    detach(node);
    setText(node, '');
    show(node, false);
  }
}

function middleNode(f: FigureImpl): HTMLElement {
  return f._b?.parentNode === f.figure ? f._b : f.plot;
}

function beforeBody(f: FigureImpl): HTMLElement {
  return f._a?.parentNode === f.figure ? f._a : middleNode(f);
}

function ensureBodyStage(f: FigureImpl): HTMLElement {
  if (!f._b) {
    f._b = element(f._d, 'body');
    f._st = element(f._d, 'stage');
    f._b.appendChild(f._st);
  }
  mount(f.figure, f._b, f.plot.parentNode === f.figure ? f.plot : f._n);
  mount(f._st!, f.plot, f._st!.firstChild);
  return f._b;
}

function ensureCaption(f: FigureImpl): void {
  if (!f._c) {
    // A figcaption would prevent the figure from taking the group or img role.
    const caption = f._c = element(f._d, 'caption');
    const title = f._t = identified(f._d, 'div', 'title', f.id, 't');
    title.setAttribute('role', 'heading');
    title.hidden = true;
    const summary = f._sm = element(f._d, `summary ${HIDDEN}`, 'p');
    hideFromAT(summary);
    caption.append(title, f._ds, summary);
  } else mount(f._c, f._ds, f._sm);
  mount(f.figure, f._c, beforeBody(f));
}

function hiddenSlot(f: FigureImpl, name: string, ariaHidden = false): HTMLElement {
  const node = element(f._d, name);
  node.hidden = true;
  if (ariaHidden) hideFromAT(node);
  return node;
}

function ensureReadout(f: FigureImpl): HTMLElement {
  const readout = f._ro ??= hiddenSlot(f, 'readout', true);
  if (readout.parentNode !== f._st) insertBefore(f._st!, readout, f.plot.nextSibling);
  return readout;
}

function ensureControls(f: FigureImpl): HTMLElement {
  return mount(f.figure, f._ct ??= hiddenSlot(f, 'controls'), f._n);
}

function ensureLive(f: FigureImpl): HTMLElement {
  if (!f._l) {
    f._l = element(f._d, `live ${HIDDEN}`);
    f._l.setAttribute('aria-live', 'polite');
  }
  return mount(f.figure, f._l, f._tp?.parentNode === f.figure ? f._tp : null);
}

function ensureTooltip(f: FigureImpl): HTMLElement {
  return mount(f.figure, f._tp ??= hiddenSlot(f, 'tooltip', true));
}

function ensureTop(f: FigureImpl): HTMLElement {
  return mount(f.figure, f._a ??= hiddenSlot(f, 'controls-top'), middleNode(f));
}

function ensureSide(f: FigureImpl): HTMLElement {
  return mount(ensureBodyStage(f), f._s ??= hiddenSlot(f, 'controls-side'));
}

function ensureFull(f: FigureImpl): void {
  ensureBodyStage(f);
  ensureCaption(f);
  ensureReadout(f);
  ensureControls(f);
  ensureLive(f);
  ensureTooltip(f);
}

export function createFigure(
  root: HTMLElement,
  id: string,
  parts: { marks: Element; text?: Element | null },
  options?: FigureOptions,
): Figure {
  return new FigureImpl(root, id, parts, options);
}

function sameTitle(a: TitleModel | null, b: TitleModel | null): boolean {
  return a === b || (a !== null && b !== null && a.text === b.text && a.level === b.level && a.visible === b.visible);
}

/** Whether going from `a` to `b` can change the size of anything around the plot (the caption or the note). */
function movesLayout(a: FigureModel, b: FigureModel): boolean {
  return a.compact !== b.compact || (!b.compact && (!sameTitle(a.title, b.title) || a.subtitle !== b.subtitle)) ||
    a.summaryVisible !== b.summaryVisible || (b.summaryVisible && a.summary !== b.summary) ||
    (a.compact ? null : a.note) !== (b.compact ? null : b.note);
}

function sameSegments(a: readonly NoteSegment[] | null | undefined, b: readonly NoteSegment[] | null | undefined): boolean {
  if (a === b || (!a && !b)) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.text !== b[i]!.text || a[i]!.lang !== b[i]!.lang) return false;
  }
  return true;
}

function same(a: FigureModel, b: FigureModel): boolean {
  return a.compact === b.compact && a.messageLang === b.messageLang && a.noteLang === b.noteLang && a.labelledBy === b.labelledBy && a.name === b.name && a.subtitle === b.subtitle &&
    a.summary === b.summary && a.summaryLang === b.summaryLang && a.summaryVisible === b.summaryVisible && a.note === b.note && a.message === b.message &&
    sameSegments(a.noteSegments, b.noteSegments) &&
    sameTitle(a.title, b.title);
}
