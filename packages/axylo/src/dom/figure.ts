/**
 * The chart's document structure (plan 2.4; spec A1, C1, F12, L7). The author's target is the root; inside
 * it the figure holds the caption (title, subtitle, summary), the plot container (marks, text layer, state
 * message), the reader's note, a polite live region and the tooltip. Only text is ever set, never HTML.
 *
 * The interaction layer (dom/interaction.ts) adds the keyboard proxy inside the plot and fills the control
 * slots (`top` above the plot, `side` beside it, `controls` under it: legend, toolbar, table) and `readout`;
 * the figure only provides those slots. The plot and `side` share the `body` row.
 */

export interface TitleModel {
  readonly text: string;
  readonly level: number;
  readonly visible: boolean;
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
}

export interface Figure {
  readonly figure: HTMLElement;
  readonly plot: HTMLElement;
  readonly tooltip: HTMLElement;
  /** Fixed readout under the plot, used instead of the tooltip when it cannot fit beside the mark. */
  readonly readout: HTMLElement;
  /** Legend, toolbar and table, in that order, between the plot and the note. */
  readonly controls: HTMLElement;
  /** Between the caption and the plot (`legend: 'top'`). */
  readonly top: HTMLElement;
  /** Beside the plot, in the same row (`legend: 'right'`). */
  readonly side: HTMLElement;
  /** The row holding the plot and `side`; it takes the height the caption and controls leave. */
  readonly body: HTMLElement;
  readonly id: string;
  /** Returns true when something that can change the figure's layout was written. */
  update(model: FigureModel): boolean;
  /** Puts text in the polite live region (state changes only, spec L7, A7). */
  /** `lang` marks built-in English on a page in another language (spec A10). */
  announce(text: string, lang?: string | null): void;
  /** Removes everything the figure added to the root, and the root's added class. */
  destroy(): void;
}

const HIDDEN = 'axylo-visually-hidden';

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

function show(el: HTMLElement, visible: boolean): void {
  if (el.hidden === visible) el.hidden = !visible;
}

export function createFigure(root: HTMLElement, id: string, parts: { marks: Element; text: Element }): Figure {
  const doc = root.ownerDocument;
  const addedClass = !root.classList.contains('axylo');
  const hadClassAttribute = root.hasAttribute('class');
  if (addedClass) root.classList.add('axylo');

  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] => {
    const el = doc.createElement(tag);
    el.className = className;
    return el;
  };
  const figure = make('figure', 'axylo-figure');
  figure.id = id;
  // A div, not figcaption: a figure with a figcaption may not take the group or img role (ARIA in HTML), and
  // the figure is named and described through aria-labelledby and aria-describedby anyway.
  const caption = make('div', 'axylo-caption');
  const title = make('div', 'axylo-title');
  title.id = `${id}-t`;
  title.setAttribute('role', 'heading');
  const subtitle = make('p', 'axylo-subtitle');
  subtitle.id = `${id}-st`;
  // Hidden until the first update says otherwise, so nothing is measured with an empty caption.
  title.hidden = true;
  subtitle.hidden = true;
  const summary = make('p', `axylo-summary ${HIDDEN}`);
  summary.id = `${id}-s`;
  const plot = make('div', 'axylo-plot');
  const message = make('p', 'axylo-message');
  message.id = `${id}-m`;
  message.hidden = true;
  const corner = make('span', 'axylo-corner');
  corner.setAttribute('aria-hidden', 'true');
  corner.textContent = '*';
  corner.hidden = true;
  plot.append(parts.marks, parts.text, message, corner);
  const note = make('p', 'axylo-note');
  note.id = `${id}-n`;
  note.setAttribute('role', 'status');
  // A status that is not live: the note can change as streamed data arrives (labels thinned, values left
  // out), and data arriving must not speak (spec A7). The summary carries the same statements.
  note.setAttribute('aria-live', 'off');
  note.hidden = true;
  const live = make('div', `axylo-live ${HIDDEN}`);
  live.setAttribute('aria-live', 'polite');
  const tooltip = make('div', 'axylo-tooltip');
  tooltip.hidden = true;
  tooltip.setAttribute('aria-hidden', 'true');
  const readout = make('div', 'axylo-readout');
  readout.hidden = true;
  readout.setAttribute('aria-hidden', 'true');
  const controls = make('div', 'axylo-controls');
  controls.hidden = true;
  const top = make('div', 'axylo-controls-top');
  top.hidden = true;
  const side = make('div', 'axylo-controls-side');
  side.hidden = true;
  const body = make('div', 'axylo-body');
  body.append(plot, side);
  caption.append(title, subtitle, summary);
  figure.append(caption, top, body, controls, note, live, tooltip, readout);
  root.appendChild(figure);

  let last: FigureModel | null = null;

  return {
    figure,
    plot,
    tooltip,
    readout,
    controls,
    top,
    side,
    body,
    id,
    update(model: FigureModel): boolean {
      if (last !== null && same(last, model)) return false;
      const moved = last === null || movesLayout(last, model);
      last = model;
      const { compact } = model;
      figure.classList.toggle('axylo-compact', compact);
      setAttr(figure, 'role', compact ? 'img' : 'group');

      // Name: the title, else the page's own heading, else the generated name.
      const heading = !compact && model.title !== null;
      if (heading) {
        setText(title, model.title!.text);
        setAttr(title, 'aria-level', String(model.title!.level));
        title.classList.toggle(HIDDEN, !model.title!.visible);
      }
      show(title, heading);
      if (model.labelledBy) {
        setAttr(figure, 'aria-labelledby', model.labelledBy);
        setAttr(figure, 'aria-label', null);
      } else if (heading) {
        setAttr(figure, 'aria-labelledby', title.id);
        setAttr(figure, 'aria-label', null);
      } else {
        setAttr(figure, 'aria-labelledby', null);
        setAttr(figure, 'aria-label', model.name);
      }

      setText(subtitle, model.subtitle ?? '');
      show(subtitle, !compact && !!model.subtitle);
      setText(summary, model.summary);
      summary.classList.toggle(HIDDEN, compact || !model.summaryVisible);
      setAttr(figure, 'aria-describedby', summary.id);

      // The compact variant has no note element: the summary says what was left out, and a corner marker
      // shows it (spec C5); the marker's text equivalent is that description.
      setText(note, compact ? '' : model.note ?? '');
      setAttr(note, 'lang', model.noteLang ?? null);
      setAttr(message, 'lang', model.messageLang ?? null);
      show(note, !compact && model.note !== null);
      show(corner, compact && model.note !== null);
      setAttr(corner, 'title', compact ? model.note : null);

      setText(message, model.message ?? '');
      show(message, model.message !== null);
      return moved;
    },
    announce(text: string, lang: string | null = null): void {
      setAttr(live, 'lang', lang);
      setText(live, text);
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

function same(a: FigureModel, b: FigureModel): boolean {
  return a.compact === b.compact && a.messageLang === b.messageLang && a.noteLang === b.noteLang && a.labelledBy === b.labelledBy && a.name === b.name && a.subtitle === b.subtitle &&
    a.summary === b.summary && a.summaryVisible === b.summaryVisible && a.note === b.note && a.message === b.message &&
    (a.title === b.title || (a.title !== null && b.title !== null && a.title.text === b.title.text &&
      a.title.level === b.title.level && a.title.visible === b.title.visible));
}
