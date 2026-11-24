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

  private readonly doc: Document;
  private readonly root: HTMLElement;
  private readonly initialCompact: boolean;
  private readonly addedClass: boolean;
  private readonly hadClassAttribute: boolean;
  private readonly description: HTMLElement;
  private readonly message: HTMLElement;
  private readonly note: HTMLElement;

  // Lazily created/mounted structural elements. Full charts mount body/stage/caption/title/summary/readout/
  // controls/live/tooltip initially; subtitle, corner, top and side are always lazy on every chart.
  private _body: HTMLElement | null = null;
  private _stage: HTMLElement | null = null;
  private _caption: HTMLElement | null = null;
  private _title: HTMLElement | null = null;
  private _subtitle: HTMLElement | null = null;
  private _summary: HTMLElement | null = null;
  private _corner: HTMLElement | null = null;
  private _live: HTMLElement | null = null;
  private _tooltip: HTMLElement | null = null;
  private _readout: HTMLElement | null = null;
  private _controls: HTMLElement | null = null;
  private _top: HTMLElement | null = null;
  private _side: HTMLElement | null = null;
  private last: FigureModel | null = null;
  /** The note's runs as last written, when it was written as runs. */
  private noteRuns: string | null = null;

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

    this.doc = doc;
    this.root = root;
    this.id = id;
    this.initialCompact = initialCompact;
    this.addedClass = addedClass;
    this.hadClassAttribute = hadClassAttribute;

    // The figure carries the `axylo` class too: the theme writes its custom properties and scheme attribute on
    // the figure, so two charts on one target never share them (review 3, finding 10).
    const figure = make(doc, 'figure', 'axylo axylo-figure');
    figure.id = id;
    this.figure = figure;

    // The whole generated summary is the figure's description, always (visually hidden). On compact charts it
    // sits directly in `figure` before `plot`; on full charts it lives inside `caption`.
    const description = make(doc, 'p', `axylo-description ${HIDDEN}`);
    description.id = `${id}-s`;
    this.description = description;

    const plot = make(doc, 'div', 'axylo-plot');
    const message = make(doc, 'p', 'axylo-message');
    message.id = `${id}-m`;
    message.hidden = true;
    if (parts.text) plot.append(parts.marks, parts.text, message);
    else plot.append(parts.marks, message);
    this.plot = plot;
    this.message = message;

    const note = make(doc, 'p', 'axylo-note');
    note.id = `${id}-n`;
    note.setAttribute('role', 'status');
    // A status that is not live: the note can change as streamed data arrives (labels thinned, values left
    // out), and data arriving must not speak (spec A7). The summary carries the same statements.
    note.setAttribute('aria-live', 'off');
    note.hidden = true;
    this.note = note;

    if (initialCompact) {
      figure.append(description, plot, note);
    } else {
      const body = make(doc, 'div', 'axylo-body');
      const stage = make(doc, 'div', 'axylo-stage');
      this._body = body;
      this._stage = stage;
      this.makeCaptionParts();
      const readout = make(doc, 'div', 'axylo-readout');
      readout.hidden = true;
      hideFromAT(readout);
      this._readout = readout;
      const controls = make(doc, 'div', 'axylo-controls');
      controls.hidden = true;
      this._controls = controls;
      const live = make(doc, 'div', `axylo-live ${HIDDEN}`);
      live.setAttribute('aria-live', 'polite');
      this._live = live;
      const tooltip = make(doc, 'div', 'axylo-tooltip');
      tooltip.hidden = true;
      hideFromAT(tooltip);
      this._tooltip = tooltip;
      stage.append(plot, readout);
      body.append(stage);
      figure.append(this._caption!, body, controls, note, live, tooltip);
    }
    root.appendChild(figure);
  }

  get tooltip(): HTMLElement { return this.ensureTooltip(); }
  get readout(): HTMLElement { return this.ensureReadout(); }
  get controls(): HTMLElement { return this.ensureControls(); }
  get top(): HTMLElement { return this.ensureTop(); }
  get side(): HTMLElement { return this.ensureSide(); }
  get body(): HTMLElement { return this.ensureBodyStage(); }
  // On compact charts `plot` sits directly inside `figure`, so `plot` itself is the stage column and
  // measuring `figure.stage` does not force-create or mutate wrapper divs during read passes.
  get stage(): HTMLElement {
    return this._stage !== null && this._body !== null && this._body.parentNode === this.figure
      ? this._stage : this.plot;
  }

  private middleNode(): HTMLElement {
    return this._body !== null && this._body.parentNode === this.figure ? this._body : this.plot;
  }

  private ensureBodyStage(): HTMLElement {
    if (!this._body) {
      this._body = make(this.doc, 'div', 'axylo-body');
      this._stage = make(this.doc, 'div', 'axylo-stage');
      this._body.appendChild(this._stage);
    }
    if (this._body.parentNode !== this.figure) {
      insertBefore(this.figure, this._body, this.plot.parentNode === this.figure ? this.plot : this.note);
    }
    if (this.plot.parentNode !== this._stage) {
      insertBefore(this._stage!, this.plot, this._stage!.firstChild);
    }
    return this._body;
  }

  private makeCaptionParts(): void {
    // A div, not figcaption: a figure with a figcaption may not take the group or img role (ARIA in HTML), and
    // the figure is named and described through aria-labelledby and aria-describedby anyway.
    const caption = make(this.doc, 'div', 'axylo-caption');
    const title = make(this.doc, 'div', 'axylo-title');
    title.id = `${this.id}-t`;
    title.setAttribute('role', 'heading');
    // Hidden until the first update says otherwise, so nothing is measured with an empty caption.
    title.hidden = true;
    // What the too-small state shows (spec L8) is `summary`: the first sentence, aria-hidden since the
    // description already says it.
    const summary = make(this.doc, 'p', `axylo-summary ${HIDDEN}`);
    hideFromAT(summary);
    caption.append(title, this.description, summary);
    this._caption = caption;
    this._title = title;
    this._summary = summary;
  }

  private ensureCaption(): void {
    if (!this._caption) this.makeCaptionParts();
    else if (this.description.parentNode !== this._caption) insertBefore(this._caption, this.description, this._summary);
    if (this._caption!.parentNode !== this.figure) {
      insertBefore(this.figure, this._caption!, this._top && this._top.parentNode === this.figure ? this._top : this.middleNode());
    }
  }

  private ensureReadout(): HTMLElement {
    this.ensureBodyStage();
    if (!this._readout) {
      const readout = make(this.doc, 'div', 'axylo-readout');
      readout.hidden = true;
      hideFromAT(readout);
      this._readout = readout;
    }
    // The readout strip sits under the plot in the plot's column: in readout mode it is in the flow there, so
    // it covers nothing and nothing covers it (decision 0004 revision 2, rule 5).
    if (this._readout.parentNode !== this._stage) insertBefore(this._stage!, this._readout, this.plot.nextSibling);
    return this._readout;
  }

  private ensureControls(): HTMLElement {
    if (!this._controls) {
      const controls = make(this.doc, 'div', 'axylo-controls');
      controls.hidden = true;
      this._controls = controls;
    }
    if (this._controls.parentNode !== this.figure) insertBefore(this.figure, this._controls, this.note);
    return this._controls;
  }

  private ensureLive(): HTMLElement {
    if (!this._live) {
      const live = make(this.doc, 'div', `axylo-live ${HIDDEN}`);
      live.setAttribute('aria-live', 'polite');
      this._live = live;
    }
    if (this._live.parentNode !== this.figure) {
      insertBefore(this.figure, this._live, this._tooltip && this._tooltip.parentNode === this.figure ? this._tooltip : null);
    }
    return this._live;
  }

  private ensureTooltip(): HTMLElement {
    if (!this._tooltip) {
      const tooltip = make(this.doc, 'div', 'axylo-tooltip');
      tooltip.hidden = true;
      hideFromAT(tooltip);
      this._tooltip = tooltip;
    }
    if (this._tooltip.parentNode !== this.figure) this.figure.appendChild(this._tooltip);
    return this._tooltip;
  }

  private ensureTop(): HTMLElement {
    if (!this._top) {
      const top = make(this.doc, 'div', 'axylo-controls-top');
      top.hidden = true;
      this._top = top;
    }
    if (this._top.parentNode !== this.figure) insertBefore(this.figure, this._top, this.middleNode());
    return this._top;
  }

  private ensureSide(): HTMLElement {
    const body = this.ensureBodyStage();
    if (!this._side) {
      const side = make(this.doc, 'div', 'axylo-controls-side');
      side.hidden = true;
      this._side = side;
    }
    if (this._side.parentNode !== body) body.appendChild(this._side);
    return this._side;
  }

  private ensureFull(): void {
    this.ensureBodyStage();
    this.ensureCaption();
    this.ensureReadout();
    this.ensureControls();
    this.ensureLive();
    this.ensureTooltip();
  }

  hasSlot(slot: 'top' | 'side'): boolean {
    const host = slot === 'top' ? this._top : this._side;
    return host !== null && host.parentNode !== null;
  }

  placeControls(slot: 'top' | 'side' | 'controls', wanted: readonly Element[]): void {
    if (slot === 'controls') {
      if (wanted.length === 0) {
        if (this._controls) {
          if (this._controls.firstChild) this._controls.replaceChildren();
          if (!this._controls.hidden) this._controls.hidden = true;
        }
        return;
      }
      const host = this.ensureControls();
      placeChildren(host, wanted);
      if (host.hidden) host.hidden = false;
      return;
    }
    if (wanted.length === 0) {
      const host = slot === 'top' ? this._top : this._side;
      if (host) {
        if (host.firstChild) host.replaceChildren();
        host.hidden = true;
        if (host.parentNode !== null) host.remove();
      }
      return;
    }
    const host = slot === 'top' ? this.ensureTop() : this.ensureSide();
    placeChildren(host, wanted);
    if (host.hidden) host.hidden = false;
  }

  clearControls(): void {
    this.placeControls('top', EMPTY_ELEMENTS);
    this.placeControls('side', EMPTY_ELEMENTS);
    this.placeControls('controls', EMPTY_ELEMENTS);
  }

  controlsSignature(): string {
    return `${slotText(this._top)}\u0000${slotText(this._side)}\u0000${slotText(this._controls)}`;
  }

  update(model: FigureModel): boolean {
    if (this.last !== null && same(this.last, model)) return false;
    const previous = this.last;
    const moved = previous === null || movesLayout(previous, model);
    this.last = model;
    const { compact } = model;
    const figure = this.figure;
    figure.classList.toggle('axylo-compact', compact);
    setAttr(figure, 'role', compact ? 'img' : 'group');

    if (compact) {
      // Preserve focus on the figure when switching a full chart to compact before interaction.prepare runs.
      const active = activeElementOf(this.doc, figure);
      const hadFocus = containsNode(this._controls, active) || containsNode(this._readout, active) ||
        containsNode(this._tooltip, active) || containsNode(this._top, active) ||
        containsNode(this._side, active) || (this._body !== null && this._body.parentNode === figure && containsNode(this._body, active));
      if (this._caption && this._caption.parentNode === figure) {
        insertBefore(figure, this.description, this._top && this._top.parentNode === figure ? this._top : this.middleNode());
        this._caption.remove();
      }
      if (this._subtitle) {
        if (this._subtitle.parentNode !== null) this._subtitle.remove();
        setText(this._subtitle, '');
        this._subtitle.hidden = true;
      }
      if (this._controls && this._controls.parentNode === figure) this._controls.remove();
      if (this._readout && this._readout.parentNode === this._stage) this._readout.remove();
      if (this._tooltip && this._tooltip.parentNode === figure) this._tooltip.remove();
      if (this._live && this._live.parentNode === figure && (previous === null ? !this.initialCompact : !previous.compact)) {
        this._live.remove();
      }
      if (this._body && this._body.parentNode === figure) {
        insertBefore(figure, this.plot, this._body);
        this._body.remove();
      }
      if (hadFocus && isFocusable(figure)) {
        if (!figure.hasAttribute('tabindex')) figure.setAttribute('tabindex', '-1');
        figure.focus({ preventScroll: true });
      }
    } else {
      this.ensureFull();
    }

    // Name: the title, else the page's own heading, else the generated name.
    const heading = !compact && model.title !== null;
    if (this._title) {
      if (heading) {
        setText(this._title, model.title!.text);
        setAttr(this._title, 'aria-level', String(model.title!.level));
        this._title.classList.toggle(HIDDEN, !model.title!.visible);
      }
      show(this._title, heading);
    }
    if (model.labelledBy) {
      setAttr(figure, 'aria-labelledby', model.labelledBy);
      setAttr(figure, 'aria-label', null);
    } else if (heading) {
      setAttr(figure, 'aria-labelledby', this._title!.id);
      setAttr(figure, 'aria-label', null);
    } else {
      setAttr(figure, 'aria-labelledby', null);
      setAttr(figure, 'aria-label', model.name);
    }

    const showSubtitle = !compact && !!model.subtitle;
    if (showSubtitle) {
      if (!this._subtitle) {
        const sub = make(this.doc, 'p', 'axylo-subtitle');
        sub.id = `${this.id}-st`;
        this._subtitle = sub;
      }
      setText(this._subtitle, model.subtitle!);
      this._subtitle.hidden = false;
      if (this._subtitle.parentNode !== this._caption) insertBefore(this._caption!, this._subtitle, this.description);
    } else if (this._subtitle) {
      if (this._subtitle.parentNode !== null) this._subtitle.remove();
      setText(this._subtitle, '');
      this._subtitle.hidden = true;
    }

    setText(this.description, model.summary);
    setAttr(this.description, 'lang', model.summaryLang ?? null);
    if (this._summary && !compact) {
      setText(this._summary, /^.*?[.!?。！？](?=\s|$)/u.exec(model.summary)?.[0] ?? model.summary);
      setAttr(this._summary, 'lang', model.summaryLang ?? null);
      this._summary.classList.toggle(HIDDEN, !model.summaryVisible);
    }
    // Shown in the too-small state (spec L8) as one line (the stylesheet clips it after its first line), the
    // whole text staying the figure's description for assistive technology.
    setAttr(figure, 'aria-describedby', this.description.id);

    // The compact variant has no note element: the summary says what was left out, and a corner marker
    // shows it (spec C5); the marker's text equivalent is that description.
    const segments = compact ? null : model.noteSegments ?? null;
    if (segments && segments.length > 1) {
      // Runs in their own languages: one span each, so assistive technology switches voice per run.
      // Compared in memory: nothing but the runs' text reaches the page (the distribution test reads every
      // attribute for stray serialized data).
      let signature = '';
      for (let i = 0; i < segments.length; i++) {
        const run = segments[i]!;
        if (i > 0) signature += '\u0002';
        signature += `${run.lang ?? ''}\u0001${run.text}`;
      }
      if (this.noteRuns !== signature) {
        const spans: HTMLElement[] = [];
        for (let i = 0; i < segments.length; i++) {
          const run = segments[i]!;
          const span = this.doc.createElement('span');
          // The runs carry their own spacing (the reader joins sentences with a space run).
          span.textContent = run.text;
          if (run.lang !== null) span.setAttribute('lang', run.lang);
          spans.push(span);
        }
        this.note.replaceChildren(...spans);
        this.noteRuns = signature;
      }
      setAttr(this.note, 'lang', null);
    } else {
      this.noteRuns = null;
      if (this.note.firstElementChild) this.note.textContent = '';
      setText(this.note, compact ? '' : segments?.[0]?.text ?? model.note ?? '');
      setAttr(this.note, 'lang', segments ? segments[0]?.lang ?? null : model.noteLang ?? null);
    }
    setAttr(this.message, 'lang', model.messageLang ?? null);
    show(this.note, !compact && model.note !== null);

    const showCorner = compact && model.note !== null;
    if (showCorner) {
      if (!this._corner) {
        const corner = make(this.doc, 'span', 'axylo-corner');
        hideFromAT(corner);
        corner.textContent = '*';
        this._corner = corner;
      }
      this._corner.hidden = false;
      setAttr(this._corner, 'title', model.note);
      if (this._corner.parentNode !== this.plot) this.plot.appendChild(this._corner);
    } else if (this._corner) {
      if (this._corner.parentNode !== null) this._corner.remove();
      this._corner.hidden = true;
      setAttr(this._corner, 'title', null);
    }

    setText(this.message, model.message ?? '');
    show(this.message, model.message !== null);
    return moved;
  }

  announce(text: string, lang: string | null = null): void {
    const region = this.ensureLive();
    setAttr(region, 'lang', lang);
    if (region.textContent === text) {
      // Replace the text node so an identical re-announcement is still observed by assistive technology.
      if (text !== '') region.replaceChildren(this.doc.createTextNode(text));
    } else {
      region.textContent = text;
    }
  }

  destroy(): void {
    this.figure.remove();
    if (this.addedClass) this.root.classList.remove('axylo');
    if (!this.hadClassAttribute && this.root.classList.length === 0) this.root.removeAttribute('class');
  }
}

export function createFigure(
  root: HTMLElement,
  id: string,
  parts: { marks: Element; text?: Element | null },
  options?: FigureOptions,
): Figure {
  return new FigureImpl(root, id, parts, options);
}

function headingKey(m: FigureModel): string {
  return m.compact || m.title === null ? '' : `${m.title.visible}\u0000${m.title.level}\u0000${m.title.text}`;
}

/** Whether going from `a` to `b` can change the size of anything around the plot (the caption or the note). */
function movesLayout(a: FigureModel, b: FigureModel): boolean {
  return a.compact !== b.compact || headingKey(a) !== headingKey(b) || (a.compact ? '' : a.subtitle) !== (b.compact ? '' : b.subtitle) ||
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
    (a.title === b.title || (a.title !== null && b.title !== null && a.title.text === b.title.text &&
      a.title.level === b.title.level && a.title.visible === b.title.visible));
}
