/**
 * The chart's document structure (plan 2.4; spec A1, C1, F12, L7). The author's target is the root; inside
 * it the figure holds the caption (title, subtitle, summary), the plot container (marks, text layer, state
 * message), the reader's note, a polite live region and the tooltip. Only text is ever set, never HTML.
 */
import {
  activeElementOf,
  announceText,
  focusContainer,
  hideFromAT,
  make,
  placeChildren,
  setAttr,
  setText,
} from "./attributes";

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
  readonly title: TitleModel | null;
  readonly labelledBy: string | null;
  readonly name: string;
  readonly subtitle: string | null;
  readonly summary: string;
  readonly summaryVisible: boolean;
  readonly note: string | null;
  readonly message: string | null;
  readonly messageLang?: string | null;
  readonly noteLang?: string | null;
  readonly noteSegments?: readonly NoteSegment[] | null;
  readonly summaryLang?: string | null;
  readonly summarySegments?: readonly NoteSegment[] | null;
}

export interface FigureOptions {
  readonly compact?: boolean;
}

export interface Figure {
  readonly figure: HTMLElement;
  readonly plot: HTMLElement;
  readonly tooltip: HTMLElement;
  readonly readout: HTMLElement;
  readonly controls: HTMLElement;
  readonly top: HTMLElement;
  readonly side: HTMLElement;
  readonly body: HTMLElement;
  readonly stage: HTMLElement;
  readonly id: string;
  hasSlot(slot: "top" | "side"): boolean;
  placeControls(slot: "top" | "side" | "controls", wanted: readonly Element[]): void;
  controlsSignature(): string;
  clearControls(): void;
  update(model: FigureModel): boolean;
  announce(text: string, lang?: string | null): void;
  destroy(): void;
}

const HIDDEN = "axylo-visually-hidden";
const EMPTY: readonly Element[] = [];
let fullTemplates: WeakMap<Document, HTMLElement | null> | undefined;
let compactTemplates: WeakMap<Document, HTMLElement | null> | undefined;

const INITIAL_COMPACT = 1,
  ADDED_CLASS = 2,
  HAD_CLASS = 4;

const show = (el: HTMLElement, visible: boolean) => {
  if (el.hidden === visible) el.hidden = !visible;
};
const insertBefore = (p: HTMLElement, n: Node, ref: Node | null) =>
  ref && typeof p.insertBefore === "function" ? p.insertBefore(n, ref) : p.appendChild(n);
const mount = (p: HTMLElement, n: HTMLElement, before: Node | null = null): HTMLElement => {
  if (n.parentNode !== p) insertBefore(p, n, before);
  return n;
};
const detach = (n: HTMLElement | null, p = n?.parentNode) => {
  if (n && p && n.parentNode === p) n.remove();
};
const slotText = (el: HTMLElement | null) =>
  el && el.parentNode !== null && !el.hidden ? (el.textContent ?? "") : "";
const hasNode = (host: HTMLElement | null, node: Element | null) =>
  host !== null && node !== null && typeof host.contains === "function" && host.contains(node);

function el(
  doc: Document,
  name: string,
  tag: "div" | "p" | "span" = "div",
  hidden = false,
  ariaHidden = false,
): HTMLElement {
  const n = make(doc, tag, `axylo-${name}`);
  if (hidden) n.hidden = true;
  if (ariaHidden) hideFromAT(n);
  return n;
}

function setRuns(
  doc: Document,
  host: HTMLElement,
  segs: readonly NoteSegment[] | null,
  text: string,
  lang: string | null,
  segsChanged: boolean,
  textChanged: boolean,
  langChanged: boolean,
  hasPrev: boolean,
  forceLang = false,
): void {
  if (segs && segs.length > 1) {
    if (segsChanged) {
      host.replaceChildren(
        ...segs.map((r) => {
          const s = doc.createElement("span");
          s.textContent = r.text;
          if (r.lang !== null) s.setAttribute("lang", r.lang);
          return s;
        }),
      );
    }
    if (hasPrev || host.hasAttribute("lang")) setAttr(host, "lang", null);
  } else {
    if (textChanged) {
      if (host.firstElementChild) host.textContent = "";
      setText(host, text);
    }
    if (langChanged && (forceLang || hasPrev || lang !== null)) setAttr(host, "lang", lang);
  }
}

class DomFigure implements Figure {
  readonly figure: HTMLElement;
  readonly plot: HTMLElement;
  readonly id: string;
  readonly #doc: Document;
  readonly #root: HTMLElement;
  readonly #flags: number;
  readonly #desc: HTMLElement;
  readonly #msg: HTMLElement;
  readonly #note: HTMLElement;

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
  #prev: FigureModel | null = null;

  constructor(
    root: HTMLElement,
    id: string,
    parts: { marks: Element; text?: Element | null },
    options?: FigureOptions,
  ) {
    const doc = root.ownerDocument,
      compact = Boolean(options?.compact);
    const added = !root.classList.contains("axylo"),
      hadClass = root.hasAttribute("class");
    if (added) root.classList.add("axylo");
    this.#doc = doc;
    this.#root = root;
    this.id = id;
    this.#flags =
      (compact ? INITIAL_COMPACT : 0) | (added ? ADDED_CLASS : 0) | (hadClass ? HAD_CLASS : 0);

    const templates = compact
      ? (compactTemplates ??= new WeakMap())
      : (fullTemplates ??= new WeakMap());
    const template = templates.get(doc);
    const figure = (this.figure = template
      ? (template.cloneNode(true) as HTMLElement)
      : make(doc, "figure", compact ? "axylo axylo-figure axylo-compact" : "axylo axylo-figure"));
    let description: HTMLElement, plot: HTMLElement, message: HTMLElement, note: HTMLElement;
    if (template) {
      if (compact) {
        description = figure.firstElementChild as HTMLElement;
        plot = description.nextElementSibling as HTMLElement;
        note = plot.nextElementSibling as HTMLElement;
      } else {
        const caption = (this.#caption = figure.firstElementChild as HTMLElement);
        const title = (this.#title = caption.firstElementChild as HTMLElement);
        title.id = `${id}-t`;
        description = title.nextElementSibling as HTMLElement;
        this.#summary = description.nextElementSibling as HTMLElement;
        const body = (this.#body = caption.nextElementSibling as HTMLElement);
        const stage = (this.#stage = body.firstElementChild as HTMLElement);
        plot = stage.firstElementChild as HTMLElement;
        this.#readout = plot.nextElementSibling as HTMLElement;
        this.#controls = body.nextElementSibling as HTMLElement;
        note = this.#controls.nextElementSibling as HTMLElement;
        this.#live = note.nextElementSibling as HTMLElement;
        this.#tooltip = this.#live.nextElementSibling as HTMLElement;
      }
      message = plot.firstElementChild as HTMLElement;
    } else {
      // Give the detached skeleton its mode before the first theme/style read, including on template clones.
      figure.setAttribute("role", compact ? "img" : "group");
      // The description sits before the plot in compact charts and inside the caption in full charts.
      description = el(doc, `description ${HIDDEN}`, "p");
      plot = el(doc, "plot");
      message = el(doc, "message", "p");
      message.hidden = true;
      note = el(doc, "note", "p", true);
      note.setAttribute("role", "status");
      note.setAttribute("aria-live", "off");
    }

    this.plot = plot;
    this.#desc = description;
    this.#msg = message;
    this.#note = note;
    if (!template) {
      if (compact) figure.append(description, plot, note);
      else {
        figure.appendChild(note);
        this.#ensureFull();
      }
      // A single chart creates no detached blueprint. Copy the second skeleton
      // before adding the rendered marks or labels.
      if (typeof figure.cloneNode === "function") {
        if (template === null) {
          plot.appendChild(message);
          templates.set(doc, figure.cloneNode(true) as HTMLElement);
        } else templates.set(doc, null);
      }
    }
    // These ids belong to the instance. The blueprint can omit them instead of copying them into every clone.
    figure.id = id;
    description.id = `${id}-s`;
    message.id = `${id}-m`;
    note.id = `${id}-n`;
    if (message.parentNode === plot) {
      plot.insertBefore(parts.marks, message);
      if (parts.text) plot.insertBefore(parts.text, message);
    } else if (parts.text) plot.append(parts.marks, parts.text, message);
    else plot.append(parts.marks, message);
    root.appendChild(figure);
  }

  #mid() {
    return this.#body?.parentNode === this.figure ? this.#body : this.plot;
  }
  #beforeBody() {
    return this.#top?.parentNode === this.figure ? this.#top : this.#mid();
  }
  #ensureLive() {
    if (!this.#live) {
      this.#live = el(this.#doc, `live ${HIDDEN}`);
      this.#live.setAttribute("aria-live", "polite");
    }
    return mount(
      this.figure,
      this.#live,
      this.#tooltip?.parentNode === this.figure ? this.#tooltip : null,
    );
  }
  #ensureFull(): void {
    void this.readout;
    if (!this.#caption) {
      const cap = (this.#caption = el(this.#doc, "caption"));
      const title = (this.#title = el(this.#doc, "title", "div", true));
      title.setAttribute("role", "heading");
      title.id = `${this.id}-t`;
      cap.append(
        title,
        this.#desc,
        (this.#summary = el(this.#doc, `summary ${HIDDEN}`, "p", false, true)),
      );
    } else mount(this.#caption, this.#desc, this.#summary);
    mount(this.figure, this.#caption, this.#beforeBody());
    void this.controls;
    this.#ensureLive();
    void this.tooltip;
  }

  get tooltip() {
    return mount(this.figure, (this.#tooltip ??= el(this.#doc, "tooltip", "div", true, true)));
  }
  get readout() {
    void this.body;
    const r = (this.#readout ??= el(this.#doc, "readout", "div", true, true));
    if (r.parentNode !== this.#stage) insertBefore(this.#stage!, r, this.plot.nextSibling);
    return r;
  }
  get controls() {
    return mount(
      this.figure,
      (this.#controls ??= el(this.#doc, "controls", "div", true)),
      this.#note,
    );
  }
  get top() {
    return mount(
      this.figure,
      (this.#top ??= el(this.#doc, "controls-top", "div", true)),
      this.#mid(),
    );
  }
  get side() {
    return mount(this.body, (this.#side ??= el(this.#doc, "controls-side", "div", true)));
  }
  get body() {
    if (!this.#body) {
      this.#body = el(this.#doc, "body");
      this.#body.appendChild((this.#stage = el(this.#doc, "stage")));
    }
    mount(this.figure, this.#body, this.plot.parentNode === this.figure ? this.plot : this.#note);
    mount(this.#stage!, this.plot, this.#stage!.firstChild);
    return this.#body;
  }
  get stage() {
    return this.#body?.parentNode === this.figure ? this.#stage! : this.plot;
  }

  hasSlot(slot: "top" | "side"): boolean {
    const h = slot === "top" ? this.#top : this.#side;
    return h !== null && h.parentNode !== null;
  }

  placeControls(slot: "top" | "side" | "controls", wanted: readonly Element[]): void {
    if (!wanted.length) {
      const h = slot === "top" ? this.#top : slot === "side" ? this.#side : this.#controls;
      if (h) {
        if (h.firstChild) h.replaceChildren();
        show(h, false);
        if (slot !== "controls") detach(h);
      }
      return;
    }
    const h = this[slot];
    placeChildren(h, wanted);
    show(h, true);
  }

  clearControls(): void {
    this.placeControls("top", EMPTY);
    this.placeControls("side", EMPTY);
    this.placeControls("controls", EMPTY);
  }

  controlsSignature(): string {
    return `${slotText(this.#top)}\u0000${slotText(this.#side)}\u0000${slotText(this.#controls)}`;
  }

  update(model: FigureModel): boolean {
    const prev = this.#prev;
    if (prev === model) return false;
    const {
      compact,
      title,
      subtitle,
      summary,
      summaryLang,
      note: noteText,
      message,
      messageLang,
    } = model;
    const switched = prev !== null && prev.compact !== compact;
    const headingChanged = switched || !sameTitle(prev?.title ?? null, title);
    const nameChanged =
      !prev || headingChanged || prev.labelledBy !== model.labelledBy || prev.name !== model.name;
    const subtitleChanged = switched || (prev?.subtitle ?? null) !== subtitle;
    const summaryTextChanged = prev?.summary !== summary;
    const summaryLangChanged = (prev?.summaryLang ?? null) !== (summaryLang ?? null);
    const sumSegs = model.summarySegments ?? null,
      sumSegsChanged = !sameSegments(sumSegs, prev?.summarySegments);
    const visChanged = switched || (prev?.summaryVisible ?? false) !== model.summaryVisible;
    const noteSegsChanged = switched || !sameSegments(model.noteSegments, prev?.noteSegments);
    const noteChanged =
      noteSegsChanged ||
      (prev?.note ?? null) !== noteText ||
      (prev?.noteLang ?? null) !== (model.noteLang ?? null);
    const msgChanged = (prev?.message ?? null) !== message,
      msgLangChanged = (prev?.messageLang ?? null) !== (messageLang ?? null);
    if (
      !(
        nameChanged ||
        subtitleChanged ||
        summaryTextChanged ||
        summaryLangChanged ||
        sumSegsChanged ||
        visChanged ||
        noteChanged ||
        msgChanged ||
        msgLangChanged
      )
    )
      return false;
    this.#prev = model;

    const { figure, plot } = this,
      desc = this.#desc,
      note = this.#note,
      status = this.#msg,
      hasPrev = prev !== null;
    if (!hasPrev || switched) {
      figure.classList.toggle("axylo-compact", compact);
      setAttr(figure, "role", compact ? "img" : "group");
      if (compact) this.#makeCompact(prev);
      else if (prev?.compact ?? this.#flags & INITIAL_COMPACT) this.#ensureFull();
    }

    const heading = compact ? null : title,
      titleNode = this.#title;
    if (titleNode && headingChanged) {
      if (heading) {
        setText(titleNode, heading.text);
        setAttr(titleNode, "aria-level", String(heading.level));
        if (switched || (prev ? prev.title?.visible : true) !== heading.visible)
          titleNode.classList.toggle(HIDDEN, !heading.visible);
      }
      show(titleNode, heading !== null);
    }
    if (nameChanged) {
      const by = model.labelledBy || (heading ? titleNode!.id : null);
      if (hasPrev || by !== null) setAttr(figure, "aria-labelledby", by);
      if (hasPrev || by === null) setAttr(figure, "aria-label", by === null ? model.name : null);
    }
    if (subtitleChanged) {
      if (!compact && subtitle) {
        const sub = (this.#subtitle ??= ((s) => {
          s.id = `${this.id}-st`;
          return s;
        })(el(this.#doc, "subtitle", "p")));
        setText(sub, subtitle);
        mount(this.#caption!, sub, desc);
      } else if (this.#subtitle) {
        this.#subtitle.remove();
        this.#subtitle = undefined;
      }
    }

    const sLang = summaryLang ?? null;
    setRuns(
      this.#doc,
      desc,
      sumSegs,
      summary,
      sLang,
      sumSegsChanged || switched,
      summaryTextChanged || sumSegsChanged,
      switched || summaryLangChanged || sumSegsChanged,
      hasPrev,
      true,
    );
    const sumNode = this.#summary;
    if (sumNode) {
      if (switched || summaryLangChanged) setAttr(sumNode, "lang", sLang);
      const visible = !compact && model.summaryVisible;
      if (visible && (visChanged || summaryTextChanged))
        setText(sumNode, /^[^\r\n\u2028\u2029]*?[.!?。！？](?=\s)/.exec(summary)?.[0] ?? summary);
      else if (!visible && prev?.summaryVisible && visChanged) setText(sumNode, "");
      if (!compact && visChanged) sumNode.classList.toggle(HIDDEN, !visible);
    }
    if (!hasPrev) setAttr(figure, "aria-describedby", desc.id);

    const nSegs = compact ? null : (model.noteSegments ?? null);
    if (noteChanged) {
      setRuns(
        this.#doc,
        note,
        nSegs,
        compact ? "" : (nSegs?.[0]?.text ?? noteText ?? ""),
        nSegs ? (nSegs[0]?.lang ?? null) : (model.noteLang ?? null),
        noteSegsChanged,
        true,
        true,
        hasPrev,
      );
      show(note, !compact && noteText !== null);
    }

    if (compact && noteText !== null) {
      if (!this.#corner) {
        (this.#corner = el(this.#doc, "corner", "span", false, true)).textContent = "*";
      }
      setAttr(this.#corner, "title", noteText);
      mount(plot, this.#corner);
    } else if (this.#corner) {
      this.#corner.remove();
      this.#corner = undefined;
    }

    if (msgChanged) {
      setText(status, message ?? "");
      show(status, message !== null);
    }
    if (msgLangChanged && (hasPrev || messageLang != null))
      setAttr(status, "lang", messageLang ?? null);
    return (
      !hasPrev ||
      visChanged ||
      (model.summaryVisible && summaryTextChanged) ||
      (!compact && (headingChanged || subtitleChanged || prev.note !== noteText))
    );
  }

  announce(text: string, lang: string | null = null): void {
    announceText(this.#ensureLive(), text, lang);
  }

  destroy(): void {
    this.figure.remove();
    if (this.#flags & ADDED_CLASS) this.#root.classList.remove("axylo");
    if (!(this.#flags & HAD_CLASS) && this.#root.classList.length === 0)
      this.#root.removeAttribute("class");
  }

  #makeCompact(prev: FigureModel | null): void {
    const { figure } = this,
      body = this.#body;
    if (!body && !this.#controls && !this.#top && !this.#tooltip) return;
    const act = activeElementOf(this.#doc, figure);
    const hadFocus =
      hasNode(this.#controls, act) ||
      hasNode(this.#readout, act) ||
      hasNode(this.#tooltip, act) ||
      hasNode(this.#top, act) ||
      hasNode(this.#side, act) ||
      (body?.parentNode === figure && hasNode(body, act));
    if (this.#caption?.parentNode === figure) {
      insertBefore(figure, this.#desc, this.#beforeBody());
      this.#caption.remove();
    }
    detach(this.#controls, figure);
    if (this.#stage) detach(this.#readout, this.#stage);
    detach(this.#tooltip, figure);
    if (!(prev?.compact ?? this.#flags & INITIAL_COMPACT)) detach(this.#live, figure);
    if (body?.parentNode === figure) {
      insertBefore(figure, this.plot, body);
      body.remove();
    }
    if (hadFocus) focusContainer(figure);
  }
}

export function createFigure(
  root: HTMLElement,
  id: string,
  parts: { marks: Element; text?: Element | null },
  options?: FigureOptions,
): Figure {
  return new DomFigure(root, id, parts, options);
}

const sameTitle = (a: TitleModel | null, b: TitleModel | null) =>
  a === b ||
  (a !== null && b !== null && a.text === b.text && a.level === b.level && a.visible === b.visible);

function sameSegments(
  a: readonly NoteSegment[] | null | undefined,
  b: readonly NoteSegment[] | null | undefined,
): boolean {
  if (a === b || (!a && !b)) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++)
    if (a[i]!.text !== b[i]!.text || a[i]!.lang !== b[i]!.lang) return false;
  return true;
}
