/**
 * The chart's document structure (plan 2.4; spec A1, C1, F12, L7). The author's target is the root; inside
 * it the figure holds the caption (title, subtitle, summary), the plot container (marks, text layer, state
 * message), the reader's note, a polite live region and the tooltip. Only text is ever set, never HTML.
 *
 * The interaction layer (dom/interaction.ts) adds the keyboard proxy inside the plot and fills the control
 * slots (`top` above the plot, `side` beside it, `controls` under it: legend, toolbar, table) and `readout`;
 * the figure only provides those slots. The plot and `side` share the `body` row.
 */
import { activeElementOf, announceText, focusContainer, hideFromAT, make, placeChildren, setAttr, setText } from './attributes';

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
  /**
   * The description as runs of text, each with its own `lang` (A10: e.g. a compact author error followed by
   * a built-in English omission sentence). When given, it is the description's content and `summaryLang` is not used.
   */
  readonly summarySegments?: readonly NoteSegment[] | null;
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
const INITIAL_COMPACT = 1, ADDED_CLASS = 2, HAD_CLASS_ATTRIBUTE = 4;
let fullTemplates: WeakMap<Document, HTMLElement | null> | undefined;
let compactTemplates: WeakMap<Document, HTMLElement | null> | undefined;

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
class DomFigure implements Figure {
  readonly figure: HTMLElement;
  readonly plot: HTMLElement;
  readonly id: string;

  readonly #doc: Document;
  readonly #root: HTMLElement;
  readonly #initialFlags: number;
  readonly #description: HTMLElement;
  readonly #message: HTMLElement;
  readonly #note: HTMLElement;

  // Lazily created/mounted structural elements. Full charts mount body/stage/caption/title/summary/readout/
  // controls/live/tooltip initially; subtitle, corner, top and side are always lazy on every chart.
  #body: HTMLElement | null = null;
  #stage: HTMLElement | null = null;
  #caption: HTMLElement | null = null;
  #title: HTMLElement | null = null;
  #subtitle?: HTMLElement;
  #summary: HTMLElement | null = null;
  #corner?: HTMLElement;
  #live: HTMLElement | null = null;
  #tooltip: HTMLElement | null = null;
  #readout: HTMLElement | null = null;
  #controls: HTMLElement | null = null;
  #top: HTMLElement | null = null;
  #side: HTMLElement | null = null;
  #previous: FigureModel | null = null;

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

    this.#doc = doc;
    this.#root = root;
    this.id = id;
    this.#initialFlags = (initialCompact ? INITIAL_COMPACT : 0) |
      (addedClass ? ADDED_CLASS : 0) | (hadClassAttribute ? HAD_CLASS_ATTRIBUTE : 0);

    // The figure carries the `axylo` class too: the theme writes its custom properties and scheme attribute on
    // the figure, so two charts on one target never share them (review 3, finding 10).
    const templates = initialCompact ? compactTemplates ??= new WeakMap() : fullTemplates ??= new WeakMap();
    const template = templates.get(doc);
    const figure = this.figure = template ? template.cloneNode(true) as HTMLElement : make(doc, 'figure', 'axylo axylo-figure');
    let description: HTMLElement, plot: HTMLElement, message: HTMLElement, note: HTMLElement;
    if (template) {
      if (initialCompact) {
        description = figure.firstElementChild as HTMLElement;
        plot = description.nextElementSibling as HTMLElement;
        note = plot.nextElementSibling as HTMLElement;
      } else {
        const caption = this.#caption = figure.firstElementChild as HTMLElement;
        const title = this.#title = caption.firstElementChild as HTMLElement;
        title.id = `${id}-t`;
        description = title.nextElementSibling as HTMLElement;
        this.#summary = description.nextElementSibling as HTMLElement;
        const body = this.#body = caption.nextElementSibling as HTMLElement;
        const stage = this.#stage = body.firstElementChild as HTMLElement;
        plot = stage.firstElementChild as HTMLElement;
        this.#readout = plot.nextElementSibling as HTMLElement;
        this.#controls = body.nextElementSibling as HTMLElement;
        note = this.#controls.nextElementSibling as HTMLElement;
        this.#live = note.nextElementSibling as HTMLElement;
        this.#tooltip = this.#live.nextElementSibling as HTMLElement;
      }
      message = plot.firstElementChild as HTMLElement;
    } else {
      // The description sits before the plot in compact charts and inside the caption in full charts.
      description = element(doc, `description ${HIDDEN}`, 'p');
      plot = element(doc, 'plot');
      message = element(doc, 'message', 'p');
      message.hidden = true;
      note = makeNote(doc);
    }

    this.plot = plot;
    this.#description = description;
    this.#message = message;
    this.#note = note;
    figure.id = id;
    description.id = `${id}-s`;
    message.id = `${id}-m`;
    note.id = `${id}-n`;

    if (!template) {
      if (initialCompact) figure.append(description, plot, note);
      else {
        figure.appendChild(note);
        DomFigure.#ensureFull(this);
      }
      // A single chart creates no detached blueprint. Copy the second skeleton
      // before adding the rendered marks or labels.
      if (typeof figure.cloneNode === 'function') {
        if (template === null) {
          plot.appendChild(message);
          templates.set(doc, figure.cloneNode(true) as HTMLElement);
        } else templates.set(doc, null);
      }
    }
    if (message.parentNode === plot) {
      plot.insertBefore(parts.marks, message);
      if (parts.text) plot.insertBefore(parts.text, message);
    } else if (parts.text) plot.append(parts.marks, parts.text, message);
    else plot.append(parts.marks, message);
    root.appendChild(figure);
  }

  get tooltip(): HTMLElement {
    return DomFigure.#ensureTooltip(this);
  }
  get readout(): HTMLElement {
    DomFigure.#ensureBodyStage(this);
    return DomFigure.#ensureReadout(this);
  }
  get controls(): HTMLElement {
    return DomFigure.#ensureControls(this);
  }
  get top(): HTMLElement {
    return mount(this.figure, this.#top ??= hiddenSlot(this.#doc, 'controls-top'), DomFigure.#middleNode(this));
  }
  get side(): HTMLElement {
    return mount(DomFigure.#ensureBodyStage(this), this.#side ??= hiddenSlot(this.#doc, 'controls-side'));
  }
  get body(): HTMLElement { return DomFigure.#ensureBodyStage(this); }
  // On compact charts `plot` sits directly inside `figure`, so `plot` itself is the stage column and
  // measuring `figure.stage` does not force-create or mutate wrapper divs during read passes.
  get stage(): HTMLElement {
    return this.#body?.parentNode === this.figure ? this.#stage! : this.plot;
  }

  hasSlot(slot: 'top' | 'side'): boolean {
    const host = slot === 'top' ? this.#top : this.#side;
    return host !== null && host.parentNode !== null;
  }

  placeControls(slot: 'top' | 'side' | 'controls', wanted: readonly Element[]): void {
    if (!wanted.length) {
      const host = slot === 'top' ? this.#top : slot === 'side' ? this.#side : this.#controls;
      if (host) {
        if (host.firstChild) host.replaceChildren();
        show(host, false);
        if (slot !== 'controls') detach(host);
      }
      return;
    }
    const host = this[slot];
    placeChildren(host, wanted);
    show(host, true);
  }

  clearControls(): void {
    this.placeControls('top', EMPTY_ELEMENTS);
    this.placeControls('side', EMPTY_ELEMENTS);
    this.placeControls('controls', EMPTY_ELEMENTS);
  }

  controlsSignature(): string {
    return `${slotText(this.#top)}\u0000${slotText(this.#side)}\u0000${slotText(this.#controls)}`;
  }

  update(model: FigureModel): boolean {
    const previous = this.#previous;
    if (previous === model) return false;
    const { compact, title, subtitle, summary, summaryLang, note: noteText, message, messageLang } = model;
    const modeChanged = previous?.compact !== compact;
    const headingChanged = modeChanged || !sameTitle(previous!.title, title);
    const nameChanged = headingChanged || previous!.labelledBy !== model.labelledBy || previous!.name !== model.name;
    const subtitleChanged = modeChanged || previous!.subtitle !== subtitle;
    const summaryTextChanged = previous?.summary !== summary;
    const summaryLangChanged = (previous?.summaryLang ?? null) !== (summaryLang ?? null);
    const summarySegments = model.summarySegments ?? null;
    const summarySegmentsChanged = !sameSegments(summarySegments, previous?.summarySegments);
    const visibilityChanged = modeChanged || previous!.summaryVisible !== model.summaryVisible;
    const segmentsChanged = modeChanged || !sameSegments(model.noteSegments, previous!.noteSegments);
    const noteChanged = segmentsChanged || previous!.note !== noteText || previous!.noteLang !== model.noteLang;
    const messageChanged = previous?.message !== message;
    const messageLangChanged = previous?.messageLang !== messageLang;
    if (!(nameChanged || subtitleChanged || summaryTextChanged || summaryLangChanged || summarySegmentsChanged || visibilityChanged ||
        noteChanged || messageChanged || messageLangChanged)) return false;
    this.#previous = model;
    const { figure, plot } = this, description = this.#description, note = this.#note, status = this.#message;
    if (modeChanged) {
      figure.classList.toggle('axylo-compact', compact);
      setAttr(figure, 'role', compact ? 'img' : 'group');
      if (compact) DomFigure.#makeCompact(this, previous);
      else if (previous?.compact ?? (this.#initialFlags & INITIAL_COMPACT)) DomFigure.#ensureFull(this);
    }

    // Name: the title, else the page's own heading, else the generated name.
    const heading = compact ? null : title;
    const titleNode = this.#title;
    if (titleNode && headingChanged) {
      if (heading) {
        setText(titleNode, heading.text);
        setAttr(titleNode, 'aria-level', String(heading.level));
        if (modeChanged || previous!.title?.visible !== heading.visible) titleNode.classList.toggle(HIDDEN, !heading.visible);
      }
      show(titleNode, heading !== null);
    }
    if (nameChanged) {
      const labelledBy = model.labelledBy || (heading ? titleNode!.id : null);
      if (previous || labelledBy !== null) setAttr(figure, 'aria-labelledby', labelledBy);
      if (previous || labelledBy === null) setAttr(figure, 'aria-label', labelledBy === null ? model.name : null);
    }

    if (subtitleChanged) {
      if (!compact && subtitle) {
        const sub = this.#subtitle ??= makeSubtitle(this.#doc, this.id);
        setText(sub, subtitle);
        mount(this.#caption!, sub, description);
      } else if (this.#subtitle) {
        this.#subtitle.remove();
        this.#subtitle = undefined;
      }
    }

    const lang = summaryLang ?? null;
    if (summarySegments && summarySegments.length > 1) {
      if (summarySegmentsChanged || modeChanged) description.replaceChildren(...makeRuns(this.#doc, summarySegments));
      if (previous || description.hasAttribute('lang')) setAttr(description, 'lang', null);
    } else {
      if (summaryTextChanged || summarySegmentsChanged) {
        if (description.firstElementChild) description.textContent = '';
        setText(description, summary);
      }
      if ((modeChanged || summaryLangChanged || summarySegmentsChanged) && (previous || lang !== null)) setAttr(description, 'lang', lang);
    }
    const summaryNode = this.#summary;
    if (summaryNode && (modeChanged || summaryLangChanged) && (previous || lang !== null)) setAttr(summaryNode, 'lang', lang);
    if (summaryNode) {
      const visible = !compact && model.summaryVisible;
      // The description holds the full text. Only the small-plot fallback needs its own sentence.
      if (visible && (visibilityChanged || summaryTextChanged)) setText(summaryNode, firstSentence(summary));
      else if (!visible && previous?.summaryVisible && visibilityChanged) setText(summaryNode, '');
      if (!compact && visibilityChanged) summaryNode.classList.toggle(HIDDEN, !visible);
    }
    if (previous === null) setAttr(figure, 'aria-describedby', description.id);

    // The compact variant has no note element: the summary says what was left out, and a corner marker
    // shows it (spec C5); the marker's text equivalent is that description.
    const segments = compact ? null : model.noteSegments ?? null;
    if (noteChanged) {
      if (segments && segments.length > 1) {
        // One span per language run lets assistive technology switch voice.
        if (segmentsChanged) note.replaceChildren(...makeRuns(this.#doc, segments));
        if (previous) setAttr(note, 'lang', null);
      } else {
        if (note.firstElementChild) note.textContent = '';
        setText(note, compact ? '' : segments?.[0]?.text ?? noteText ?? '');
        const lang = segments ? segments[0]?.lang ?? null : model.noteLang ?? null;
        if (previous || lang !== null) setAttr(note, 'lang', lang);
      }
      show(note, !compact && noteText !== null);
    }

    const showCorner = compact && noteText !== null;
    if (showCorner) {
      if (!this.#corner) {
        const corner = this.#corner = element(this.#doc, 'corner', 'span');
        hideFromAT(corner);
        corner.textContent = '*';
      }
      setAttr(this.#corner, 'title', noteText);
      mount(plot, this.#corner);
    } else if (this.#corner) {
      this.#corner.remove();
      this.#corner = undefined;
    }

    if (messageChanged) {
      setText(status, message ?? '');
      show(status, message !== null);
    }
    if (messageLangChanged && (previous || messageLang != null)) setAttr(status, 'lang', messageLang ?? null);
    return visibilityChanged || (model.summaryVisible && summaryTextChanged) ||
      (!compact && (headingChanged || subtitleChanged || previous!.note !== noteText));
  }

  announce(text: string, lang: string | null = null): void {
    announceText(DomFigure.#ensureLive(this), text, lang);
  }

  destroy(): void {
    this.figure.remove();
    if (this.#initialFlags & ADDED_CLASS) this.#root.classList.remove('axylo');
    if (!(this.#initialFlags & HAD_CLASS_ATTRIBUTE) && this.#root.classList.length === 0) this.#root.removeAttribute('class');
  }

  // Static helpers can access the private fields without adding an instance brand.
  static #makeCompact(f: DomFigure, previous: FigureModel | null): void {
    const { figure } = f, body = f.#body;
    // Preserve focus on the figure when switching a full chart to compact before interaction.prepare runs.
    const active = activeElementOf(f.#doc, figure);
    const hadFocus = containsNode(f.#controls, active) || containsNode(f.#readout, active) ||
      containsNode(f.#tooltip, active) || containsNode(f.#top, active) ||
      containsNode(f.#side, active) || (body?.parentNode === figure && containsNode(body, active));
    if (f.#caption && f.#caption.parentNode === figure) {
      insertBefore(figure, f.#description, DomFigure.#beforeBody(f));
      f.#caption.remove();
    }
    detach(f.#controls, figure);
    if (f.#stage) detach(f.#readout, f.#stage);
    detach(f.#tooltip, figure);
    if (!(previous?.compact ?? (f.#initialFlags & INITIAL_COMPACT))) detach(f.#live, figure);
    if (body?.parentNode === figure) {
      insertBefore(figure, f.plot, body);
      body.remove();
    }
    if (hadFocus) focusContainer(figure);
  }

  static #middleNode(f: DomFigure): HTMLElement {
    return f.#body?.parentNode === f.figure ? f.#body : f.plot;
  }

  static #beforeBody(f: DomFigure): HTMLElement {
    return f.#top?.parentNode === f.figure ? f.#top : DomFigure.#middleNode(f);
  }

  static #ensureBodyStage(f: DomFigure): HTMLElement {
    if (!f.#body) {
      f.#body = element(f.#doc, 'body');
      f.#stage = element(f.#doc, 'stage');
      f.#body.appendChild(f.#stage);
    }
    mount(f.figure, f.#body, f.plot.parentNode === f.figure ? f.plot : f.#note);
    mount(f.#stage!, f.plot, f.#stage!.firstChild);
    return f.#body;
  }

  static #ensureCaption(f: DomFigure): void {
    if (!f.#caption) {
      // A figcaption would prevent the figure from taking the group or img role.
      const caption = f.#caption = element(f.#doc, 'caption');
      const title = f.#title = makeTitle(f.#doc);
      title.id = `${f.id}-t`;
      const summary = f.#summary = makeSummary(f.#doc);
      caption.append(title, f.#description, summary);
    } else mount(f.#caption, f.#description, f.#summary);
    mount(f.figure, f.#caption, DomFigure.#beforeBody(f));
  }

  static #ensureReadout(f: DomFigure): HTMLElement {
    const readout = f.#readout ??= hiddenSlot(f.#doc, 'readout', true);
    if (readout.parentNode !== f.#stage) insertBefore(f.#stage!, readout, f.plot.nextSibling);
    return readout;
  }

  static #ensureControls(f: DomFigure): HTMLElement {
    return mount(f.figure, f.#controls ??= hiddenSlot(f.#doc, 'controls'), f.#note);
  }

  static #ensureLive(f: DomFigure): HTMLElement {
    f.#live ??= makeLive(f.#doc);
    return mount(f.figure, f.#live, f.#tooltip?.parentNode === f.figure ? f.#tooltip : null);
  }

  static #ensureTooltip(f: DomFigure): HTMLElement {
    return mount(f.figure, f.#tooltip ??= hiddenSlot(f.#doc, 'tooltip', true));
  }

  static #ensureFull(f: DomFigure): void {
    DomFigure.#ensureBodyStage(f);
    DomFigure.#ensureCaption(f);
    DomFigure.#ensureReadout(f);
    DomFigure.#ensureControls(f);
    DomFigure.#ensureLive(f);
    DomFigure.#ensureTooltip(f);
  }
}

function element(doc: Document, name: string, tag: 'div' | 'p' | 'span' = 'div'): HTMLElement {
  return make(doc, tag, `axylo-${name}`);
}

function makeSubtitle(doc: Document, id: string): HTMLElement {
  const subtitle = element(doc, 'subtitle', 'p');
  subtitle.id = `${id}-st`;
  return subtitle;
}

function firstSentence(text: string): string {
  return /^[^\r\n\u2028\u2029]*?[.!?。！？](?=\s)/.exec(text)?.[0] ?? text;
}

function makeNote(doc: Document): HTMLElement {
  const note = element(doc, 'note', 'p');
  note.setAttribute('role', 'status');
  // Streaming can change the note without making an announcement (spec A7).
  note.setAttribute('aria-live', 'off');
  note.hidden = true;
  return note;
}

function makeTitle(doc: Document): HTMLElement {
  const title = element(doc, 'title');
  title.setAttribute('role', 'heading');
  title.hidden = true;
  return title;
}

function makeSummary(doc: Document): HTMLElement {
  const summary = element(doc, `summary ${HIDDEN}`, 'p');
  hideFromAT(summary);
  return summary;
}

function makeLive(doc: Document): HTMLElement {
  const live = element(doc, `live ${HIDDEN}`);
  live.setAttribute('aria-live', 'polite');
  return live;
}

/** Move a node only when its slot's parent changes, so focused descendants stay in place. */
function mount(parent: HTMLElement, node: HTMLElement, before: Node | null = null): HTMLElement {
  if (node.parentNode !== parent) insertBefore(parent, node, before);
  return node;
}

function detach(node: HTMLElement | null, parent = node?.parentNode): void {
  if (node && parent && node.parentNode === parent) node.remove();
}

function hiddenSlot(doc: Document, name: string, ariaHidden = false): HTMLElement {
  const node = element(doc, name);
  node.hidden = true;
  if (ariaHidden) hideFromAT(node);
  return node;
}

export function createFigure(
  root: HTMLElement,
  id: string,
  parts: { marks: Element; text?: Element | null },
  options?: FigureOptions,
): Figure {
  return new DomFigure(root, id, parts, options);
}

function sameTitle(a: TitleModel | null, b: TitleModel | null): boolean {
  return a === b || (a !== null && b !== null && a.text === b.text && a.level === b.level && a.visible === b.visible);
}

function makeRuns(doc: Document, segments: readonly NoteSegment[]): HTMLSpanElement[] {
  return segments.map(run => {
    const span = doc.createElement('span');
    span.textContent = run.text;
    if (run.lang !== null) span.setAttribute('lang', run.lang);
    return span;
  });
}

function sameSegments(a: readonly NoteSegment[] | null | undefined, b: readonly NoteSegment[] | null | undefined): boolean {
  if (a === b || (!a && !b)) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.text !== b[i]!.text || a[i]!.lang !== b[i]!.lang) return false;
  }
  return true;
}
