import { expect, it, vi } from "vitest";
import { LanguageWatch, pageLanguage, subscribeTreeMutations } from "../../src/core/environment";

it("follows a light-DOM ancestor through two assigned slots for language and theme changes", () => {
  const observers: Observer[] = [];
  class Observer {
    roots: unknown[] = [];
    constructor(readonly deliver: (records: unknown[]) => void) {
      observers.push(this);
    }
    observe(root: unknown) {
      this.roots.push(root);
    }
    disconnect = vi.fn();
  }
  const html = { nodeType: 1, getAttribute: () => "en" };
  const doc = { documentElement: html, defaultView: { MutationObserver: Observer } };
  const element = (parentElement: unknown, parentNode = parentElement, assignedSlot?: unknown) => ({
    ownerDocument: doc,
    parentNode,
    parentElement,
    assignedSlot,
    getAttribute: () => null,
  });
  const outerHost = element(html);
  const outer = { nodeType: 11, host: outerHost };
  let language = "fr";
  const outerSlot = { ...element(null, outer), getAttribute: () => language };
  const innerHost = element(outerHost, outerHost, outerSlot);
  const inner = { nodeType: 11, host: innerHost };
  const innerSlot = element(null, inner);
  const wrapper = element(innerHost, innerHost, innerSlot);
  const target = { ...element(wrapper), getRootNode: () => doc } as unknown as Element;
  expect(target.getRootNode()).toBe(target.ownerDocument);
  expect(pageLanguage(target)).toBe("fr");

  const subscriber = { element: target, onChange: vi.fn() };
  const stop = subscribeTreeMutations(
    "theme",
    target,
    { subtree: true, attributes: true },
    subscriber,
  );
  const changed = { language: vi.fn() };
  const watch = new LanguageWatch(target, changed);
  watch.start();
  const langObserver = observers.at(-1)!;
  expect(langObserver.roots).toEqual([html, inner, outer]);
  const themeObservers = observers.slice(0, -1);
  expect(themeObservers.flatMap((observer) => observer.roots)).toEqual([html, inner, outer]);
  themeObservers[2]!.deliver([{ target: outerSlot, attributeName: "class" }]);
  expect(subscriber.onChange).toHaveBeenCalledOnce();
  language = "de";
  langObserver.deliver([{ target: outerSlot, attributeName: "lang" }]);
  expect(changed.language).toHaveBeenCalledOnce();
  expect(pageLanguage(target)).toBe("de");
  watch.stop();
  stop();
  for (const observer of observers) expect(observer.disconnect).toHaveBeenCalledOnce();
});
