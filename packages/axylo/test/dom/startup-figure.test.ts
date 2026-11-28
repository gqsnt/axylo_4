import { expect, it } from "vitest";
import { createFigure, type FigureModel } from "../../src/dom/figure";
import { TestDocument, TestElement } from "../core/n3-dom";

// The shared DOM double normally exercises the builder. Supply the two DOM operations
// used by the template path so each case also covers figures made from a detached clone.
class ClonableElement extends TestElement {
  get nextElementSibling(): TestElement | null {
    let next = this.nextSibling;
    while (next && !(next instanceof TestElement)) next = next.nextSibling;
    return next;
  }

  cloneNode(deep: boolean): ClonableElement {
    const node = new ClonableElement(this.ownerDocument, this.tagName);
    for (const [name, value] of this.attrs) node.setAttribute(name, value);
    node.hidden = this.hidden;
    if (deep) {
      for (const child of this.childNodes) {
        node.appendChild(
          child instanceof ClonableElement
            ? child.cloneNode(true)
            : this.ownerDocument.createTextNode(child.textContent),
        );
      }
    }
    return node;
  }
}

class ClonableDocument extends TestDocument {
  override createElement(tag: string): ClonableElement {
    return new ClonableElement(this, tag);
  }
}

it.each([true, false])(
  "names and describes each first commit in a shared document (initial compact = %s, A1, C5)",
  (initialCompact) => {
    const doc = new ClonableDocument();
    // The first two mounts populate the optional template. Keep all mounts connected to detect duplicate ids.
    for (let i = 0; i < 4; ++i) {
      const root = doc.createElement("div");
      doc.body.appendChild(root);
      const id = "tile-" + i;
      const figure = createFigure(
        root as unknown as HTMLElement,
        id,
        {
          marks: doc.createElement("svg") as unknown as Element,
        },
        { compact: initialCompact },
      );
      // Theme preparation reads the attached skeleton before the first figure update.
      expect(figure.figure.classList.contains("axylo-compact")).toBe(initialCompact);
      expect(figure.figure.getAttribute("role")).toBe(initialCompact ? "img" : "group");
      // A mode update can be accepted before the scheduler has published its first frame.
      const compact = i === 3 ? !initialCompact : initialCompact;
      const name = "Daily visits " + i;
      const model: FigureModel = {
        compact,
        name,
        title: { text: name, level: 3, visible: true },
        labelledBy: null,
        subtitle: null,
        summary: name + " increased.",
        summaryVisible: false,
        note: i === 1 ? "Two values omitted." : null,
        message: i === 1 ? "Loading" : null,
      };
      figure.update(model);
      const el = figure.figure;
      expect(el.getAttribute("role")).toBe(compact ? "img" : "group");
      expect(el.classList.contains("axylo-compact")).toBe(compact);
      expect(doc.getElementById(id)).toBe(el);
      const description = doc.getElementById(el.getAttribute("aria-describedby")!);
      expect(el.querySelector(".axylo-description")).toBe(description);
      expect(description?.textContent).toBe(model.summary);
      const title = el.querySelector<HTMLElement>(".axylo-title");
      if (compact) {
        expect(el.getAttribute("aria-label")).toBe(name);
        expect(el.getAttribute("aria-labelledby")).toBeNull();
        expect(title).toBeNull();
      } else {
        expect(doc.getElementById(el.getAttribute("aria-labelledby")!)).toBe(title);
        expect(title?.textContent).toBe(name);
        expect(title?.hidden).toBe(false);
      }
      expect(el.querySelector<HTMLElement>(".axylo-note")!.hidden).toBe(
        compact || model.note === null,
      );
      expect(el.querySelector<HTMLElement>(".axylo-message")!.hidden).toBe(model.message === null);
    }
  },
);
