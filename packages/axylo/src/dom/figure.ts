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

export function createFigure(
  root: HTMLElement,
  id: string,
  parts: { marks: Element; text?: Element | null },
  options?: FigureOptions,
): Figure {
  const doc = root.ownerDocument;
  const initialCompact = Boolean(options?.compact);
  const addedClass = !root.classList.contains('axylo');
  const hadClassAttribute = root.hasAttribute('class');
  if (addedClass) root.classList.add('axylo');

  // The figure carries the `axylo` class too: the theme writes its custom properties and scheme attribute on
  // the figure, so two charts on one target never share them (review 3, finding 10).
  const figure = make(doc, 'figure', 'axylo axylo-figure');
  figure.id = id;
  // The whole generated summary is the figure's description, always (visually hidden). On compact charts it
  // sits directly in `figure` before `body`; on full charts it lives inside `caption`.
  const description = make(doc, 'p', `axylo-description ${HIDDEN}`);
  description.id = `${id}-s`;

  const plot = make(doc, 'div', 'axylo-plot');
  const message = make(doc, 'p', 'axylo-message');
  message.id = `${id}-m`;
  message.hidden = true;
  if (parts.text) plot.append(parts.marks, parts.text, message);
  else plot.append(parts.marks, message);

  const note = make(doc, 'p', 'axylo-note');
  note.id = `${id}-n`;
  note.setAttribute('role', 'status');
  // A status that is not live: the note can change as streamed data arrives (labels thinned, values left
  // out), and data arriving must not speak (spec A7). The summary carries the same statements.
  note.setAttribute('aria-live', 'off');
  note.hidden = true;

  const body = make(doc, 'div', 'axylo-body');
  const stage = make(doc, 'div', 'axylo-stage');

  // Lazily created/mounted structural elements. Full charts mount caption/title/summary/readout/controls/
  // live/tooltip initially; subtitle, corner, top and side are always lazy on every chart.
  let caption: HTMLElement | null = null;
  let title: HTMLElement | null = null;
  let subtitle: HTMLElement | null = null;
  let summary: HTMLElement | null = null;
  let corner: HTMLElement | null = null;
  let live: HTMLElement | null = null;
  let tooltip: HTMLElement | null = null;
  let readout: HTMLElement | null = null;
  let controls: HTMLElement | null = null;
  let top: HTMLElement | null = null;
  let side: HTMLElement | null = null;

  function makeCaptionParts(): void {
    // A div, not figcaption: a figure with a figcaption may not take the group or img role (ARIA in HTML), and
    // the figure is named and described through aria-labelledby and aria-describedby anyway.
    caption = make(doc, 'div', 'axylo-caption');
    title = make(doc, 'div', 'axylo-title');
    title.id = `${id}-t`;
    title.setAttribute('role', 'heading');
    // Hidden until the first update says otherwise, so nothing is measured with an empty caption.
    title.hidden = true;
    // What the too-small state shows (spec L8) is `summary`: the first sentence, aria-hidden since the
    // description already says it.
    summary = make(doc, 'p', `axylo-summary ${HIDDEN}`);
    hideFromAT(summary);
    caption.append(title, description, summary);
  }

  function ensureCaption(): void {
    if (!caption) makeCaptionParts();
    else if (description.parentNode !== caption) insertBefore(caption, description, summary);
    if (caption!.parentNode !== figure) {
      insertBefore(figure, caption!, top && top.parentNode === figure ? top : body);
    }
  }

  function ensureReadout(): HTMLElement {
    if (!readout) {
      readout = make(doc, 'div', 'axylo-readout');
      readout.hidden = true;
      hideFromAT(readout);
    }
    // The readout strip sits under the plot in the plot's column: in readout mode it is in the flow there, so
    // it covers nothing and nothing covers it (decision 0004 revision 2, rule 5).
    if (readout.parentNode !== stage) insertBefore(stage, readout, plot.nextSibling);
    return readout;
  }

  function ensureControls(): HTMLElement {
    if (!controls) {
      controls = make(doc, 'div', 'axylo-controls');
      controls.hidden = true;
    }
    if (controls.parentNode !== figure) insertBefore(figure, controls, note);
    return controls;
  }

  function ensureLive(): HTMLElement {
    if (!live) {
      live = make(doc, 'div', `axylo-live ${HIDDEN}`);
      live.setAttribute('aria-live', 'polite');
    }
    if (live.parentNode !== figure) insertBefore(figure, live, tooltip && tooltip.parentNode === figure ? tooltip : null);
    return live;
  }

  function ensureTooltip(): HTMLElement {
    if (!tooltip) {
      tooltip = make(doc, 'div', 'axylo-tooltip');
      tooltip.hidden = true;
      hideFromAT(tooltip);
    }
    if (tooltip.parentNode !== figure) figure.appendChild(tooltip);
    return tooltip;
  }

  function ensureTop(): HTMLElement {
    if (!top) {
      top = make(doc, 'div', 'axylo-controls-top');
      top.hidden = true;
    }
    if (top.parentNode !== figure) insertBefore(figure, top, body);
    return top;
  }

  function ensureSide(): HTMLElement {
    if (!side) {
      side = make(doc, 'div', 'axylo-controls-side');
      side.hidden = true;
    }
    if (side.parentNode !== body) body.appendChild(side);
    return side;
  }

  function ensureFull(): void {
    ensureCaption();
    ensureReadout();
    ensureControls();
    ensureLive();
    ensureTooltip();
  }

  if (initialCompact) {
    stage.append(plot);
    body.append(stage);
    figure.append(description, body, note);
  } else {
    makeCaptionParts();
    readout = make(doc, 'div', 'axylo-readout');
    readout.hidden = true;
    hideFromAT(readout);
    controls = make(doc, 'div', 'axylo-controls');
    controls.hidden = true;
    live = make(doc, 'div', `axylo-live ${HIDDEN}`);
    live.setAttribute('aria-live', 'polite');
    tooltip = make(doc, 'div', 'axylo-tooltip');
    tooltip.hidden = true;
    hideFromAT(tooltip);
    stage.append(plot, readout);
    body.append(stage);
    figure.append(caption!, body, controls, note, live, tooltip);
  }
  root.appendChild(figure);

  function placeControls(slot: 'top' | 'side' | 'controls', wanted: readonly Element[]): void {
    if (slot === 'controls') {
      if (wanted.length === 0) {
        if (controls) {
          if (controls.firstChild) controls.replaceChildren();
          if (!controls.hidden) controls.hidden = true;
        }
        return;
      }
      const host = ensureControls();
      placeChildren(host, wanted);
      if (host.hidden) host.hidden = false;
      return;
    }
    if (wanted.length === 0) {
      const host = slot === 'top' ? top : side;
      if (host) {
        if (host.firstChild) host.replaceChildren();
        host.hidden = true;
        if (host.parentNode !== null) host.remove();
      }
      return;
    }
    const host = slot === 'top' ? ensureTop() : ensureSide();
    placeChildren(host, wanted);
    if (host.hidden) host.hidden = false;
  }

  function clearControls(): void {
    placeControls('top', []);
    placeControls('side', []);
    placeControls('controls', []);
  }

  function controlsSignature(): string {
    const textOf = (el: HTMLElement | null) => el && el.parentNode !== null && !el.hidden ? el.textContent ?? '' : '';
    return `${textOf(top)}\u0000${textOf(side)}\u0000${textOf(controls)}`;
  }

  let last: FigureModel | null = null;
  /** The note's runs as last written, when it was written as runs. */
  let noteRuns: string | null = null;

  return {
    figure,
    plot,
    get tooltip() { return ensureTooltip(); },
    get readout() { return ensureReadout(); },
    get controls() { return ensureControls(); },
    get top() { return ensureTop(); },
    get side() { return ensureSide(); },
    body,
    stage,
    id,
    hasSlot(slot: 'top' | 'side'): boolean {
      const host = slot === 'top' ? top : side;
      return host !== null && host.parentNode !== null;
    },
    placeControls,
    controlsSignature,
    clearControls,
    update(model: FigureModel): boolean {
      if (last !== null && same(last, model)) return false;
      const previous = last;
      const moved = previous === null || movesLayout(previous, model);
      last = model;
      const { compact } = model;
      figure.classList.toggle('axylo-compact', compact);
      setAttr(figure, 'role', compact ? 'img' : 'group');

      if (compact) {
        // Preserve focus on the figure when switching a full chart to compact before interaction.prepare runs.
        const active = activeElementOf(doc, figure);
        const hadFocus = containsNode(controls, active) || containsNode(readout, active) || containsNode(tooltip, active);
        if (caption && caption.parentNode === figure) {
          insertBefore(figure, description, top && top.parentNode === figure ? top : body);
          caption.remove();
        }
        if (subtitle) {
          if (subtitle.parentNode !== null) subtitle.remove();
          setText(subtitle, '');
          subtitle.hidden = true;
        }
        if (controls && controls.parentNode === figure) controls.remove();
        if (readout && readout.parentNode === stage) readout.remove();
        if (tooltip && tooltip.parentNode === figure) tooltip.remove();
        if (live && live.parentNode === figure && (previous === null ? !initialCompact : !previous.compact)) live.remove();
        if (hadFocus && isFocusable(figure)) {
          if (!figure.hasAttribute('tabindex')) figure.setAttribute('tabindex', '-1');
          figure.focus({ preventScroll: true });
        }
      } else {
        ensureFull();
      }

      // Name: the title, else the page's own heading, else the generated name.
      const heading = !compact && model.title !== null;
      if (title) {
        if (heading) {
          setText(title, model.title!.text);
          setAttr(title, 'aria-level', String(model.title!.level));
          title.classList.toggle(HIDDEN, !model.title!.visible);
        }
        show(title, heading);
      }
      if (model.labelledBy) {
        setAttr(figure, 'aria-labelledby', model.labelledBy);
        setAttr(figure, 'aria-label', null);
      } else if (heading) {
        setAttr(figure, 'aria-labelledby', title!.id);
        setAttr(figure, 'aria-label', null);
      } else {
        setAttr(figure, 'aria-labelledby', null);
        setAttr(figure, 'aria-label', model.name);
      }

      const showSubtitle = !compact && !!model.subtitle;
      if (showSubtitle) {
        if (!subtitle) {
          subtitle = make(doc, 'p', 'axylo-subtitle');
          subtitle.id = `${id}-st`;
        }
        setText(subtitle, model.subtitle!);
        subtitle.hidden = false;
        if (subtitle.parentNode !== caption) insertBefore(caption!, subtitle, description);
      } else if (subtitle) {
        if (subtitle.parentNode !== null) subtitle.remove();
        setText(subtitle, '');
        subtitle.hidden = true;
      }

      setText(description, model.summary);
      setAttr(description, 'lang', model.summaryLang ?? null);
      if (summary && !compact) {
        setText(summary, /^.*?[.!?。！？](?=\s|$)/u.exec(model.summary)?.[0] ?? model.summary);
        setAttr(summary, 'lang', model.summaryLang ?? null);
        summary.classList.toggle(HIDDEN, !model.summaryVisible);
      }
      // Shown in the too-small state (spec L8) as one line (the stylesheet clips it after its first line), the
      // whole text staying the figure's description for assistive technology.
      setAttr(figure, 'aria-describedby', description.id);

      // The compact variant has no note element: the summary says what was left out, and a corner marker
      // shows it (spec C5); the marker's text equivalent is that description.
      const segments = compact ? null : model.noteSegments ?? null;
      if (segments && segments.length > 1) {
        // Runs in their own languages: one span each, so assistive technology switches voice per run.
        // Compared in memory: nothing but the runs' text reaches the page (the distribution test reads every
        // attribute for stray serialized data).
        const signature = segments.map(run => `${run.lang ?? ''}\u0001${run.text}`).join('\u0002');
        if (noteRuns !== signature) {
          note.replaceChildren(...segments.map(run => {
            const span = doc.createElement('span');
            // The runs carry their own spacing (the reader joins sentences with a space run).
            span.textContent = run.text;
            if (run.lang !== null) span.setAttribute('lang', run.lang);
            return span;
          }));
          noteRuns = signature;
        }
        setAttr(note, 'lang', null);
      } else {
        noteRuns = null;
        if (note.firstElementChild) note.textContent = '';
        setText(note, compact ? '' : segments?.[0]?.text ?? model.note ?? '');
        setAttr(note, 'lang', segments ? segments[0]?.lang ?? null : model.noteLang ?? null);
      }
      setAttr(message, 'lang', model.messageLang ?? null);
      show(note, !compact && model.note !== null);

      const showCorner = compact && model.note !== null;
      if (showCorner) {
        if (!corner) {
          corner = make(doc, 'span', 'axylo-corner');
          hideFromAT(corner);
          corner.textContent = '*';
        }
        corner.hidden = false;
        setAttr(corner, 'title', model.note);
        if (corner.parentNode !== plot) plot.appendChild(corner);
      } else if (corner) {
        if (corner.parentNode !== null) corner.remove();
        corner.hidden = true;
        setAttr(corner, 'title', null);
      }

      setText(message, model.message ?? '');
      show(message, model.message !== null);
      return moved;
    },
    announce(text: string, lang: string | null = null): void {
      const region = ensureLive();
      setAttr(region, 'lang', lang);
      if (region.textContent === text) {
        // Replace the text node so an identical re-announcement is still observed by assistive technology.
        if (text !== '') region.replaceChildren(doc.createTextNode(text));
      } else {
        region.textContent = text;
      }
    },
    destroy(): void {
      figure.remove();
      if (addedClass) root.classList.remove('axylo');
      if (!hadClassAttribute && root.classList.length === 0) root.removeAttribute('class');
    },
  };
}

/** Whether going from `a` to `b` can change the size of anything around the plot (the caption or the note). */
function movesLayout(a: FigureModel, b: FigureModel): boolean {
  const heading = (m: FigureModel) => m.compact || m.title === null ? '' : `${m.title.visible}\u0000${m.title.level}\u0000${m.title.text}`;
  return a.compact !== b.compact || heading(a) !== heading(b) || (a.compact ? '' : a.subtitle) !== (b.compact ? '' : b.subtitle) ||
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
