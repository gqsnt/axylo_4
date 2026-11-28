import { expect, it, vi } from "vitest";
import { subscribeTreeMutations } from "../../src/core/environment";

it("filters own style records in order and delivers the same changes to a nested chart", () => {
  type Change = Pick<MutationRecord, "target" | "attributeName" | "oldValue">;
  let deliver!: (records: readonly Change[]) => void;
  class Observer {
    constructor(callback: typeof deliver) {
      deliver = callback;
    }
    observe() {}
    disconnect() {}
  }
  const html = {};
  const doc = { documentElement: html, defaultView: { MutationObserver: Observer } };
  const node = (parentElement: unknown) =>
    ({ ownerDocument: doc, parentElement }) as unknown as Element;
  const outer = node(html),
    inner = node(outer),
    other = node(html);
  const ownChange = vi.fn(),
    innerChange = vi.fn(),
    styleChanged = vi.fn(() => false);
  const stopOuter = subscribeTreeMutations(
    "theme",
    outer,
    { attributes: true },
    { element: outer, onChange: ownChange, styleChanged },
  );
  const stopInner = subscribeTreeMutations(
    "theme",
    inner,
    { attributes: true },
    { element: inner, onChange: innerChange },
  );
  const style = (target: Element, oldValue: string): Change => ({
    target,
    attributeName: "style",
    oldValue,
  });
  const first = style(outer, ""),
    second = style(outer, "color: red");
  deliver([first, style(other, ""), second]);
  expect(styleChanged).toHaveBeenCalledExactlyOnceWith([first, second]);
  expect(ownChange).not.toHaveBeenCalled();
  expect(innerChange).toHaveBeenCalledOnce();
  deliver([{ ...first, attributeName: "class" }, second]);
  expect(ownChange).toHaveBeenCalledOnce();
  expect(innerChange).toHaveBeenCalledTimes(2);
  stopInner();
  stopOuter();
});
