import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { financeSvgMarks } from "../../src/finance/render";
import { barScene, drawBars, rectValues } from "./bar-render";

const zero = 100;
function rectangles(heights: readonly number[], count: number, gap = false) {
  const q = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const x = i / 8,
      h = heights[i % heights.length]!;
    q.set([x + (gap && i >= count / 2 ? 10 : 0), Math.min(zero, zero - h), 1, Math.abs(h)], i * 4);
  }
  return q;
}

describe("opaque SVG bar columns", () => {
  it("keeps exact rectangles when the finance handler substitutes semantic paints", () => {
    const q = rectangles([8, -16], 2056);
    const group = drawBars(financeSvgMarks)(barScene(q))[0]!;
    expect(group.children).toHaveLength(2056);
    expect(rectValues(group.children[1]!)).toEqual([0.13, 100, 1, 16]);
  });

  it.each([
    [4, 16],
    [-16, -4],
    [0, 0],
  ])("keeps the common edge for heights %s and %s", (a, b) => {
    const q = rectangles([a, b], 2056);
    const boxes = drawBars()(barScene(q))[0]!.children.map(rectValues);
    const extreme = Math.abs(a) > Math.abs(b) ? a : b;
    const expected =
      extreme === 0
        ? []
        : Array.from({ length: 257 }, (_, x) => [
            x,
            Math.min(zero, zero - extreme),
            1,
            Math.abs(extreme),
          ]);
    expect(boxes).toEqual(expected);
  });

  it("matches the most distant original endpoint on each side in every occupied column", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -70, max: 80 }), { minLength: 1, maxLength: 30 }),
        (heights) => {
          const q = rectangles(heights, 2304, true);
          const cells = new Map<number, number[]>();
          for (let i = 0; i < q.length; i += 4) {
            const col = Math.floor(q[i]!);
            const range = cells.get(col) ?? [zero, zero];
            range[0] = Math.min(range[0]!, q[i + 1]!);
            range[1] = Math.max(range[1]!, q[i + 1]! + q[i + 3]!);
            cells.set(col, range);
          }
          const wanted = [];
          for (const [x, [top, bottom]] of cells) {
            if (top! < zero) wanted.push([x, top, 1, zero - top!]);
            if (bottom! > zero) wanted.push([x, zero, 1, bottom! - zero]);
          }
          const group = drawBars()(barScene(q))[0]!;
          expect(group.children.map(rectValues)).toEqual(wanted);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("repaints the same geometry as the resolved theme and pattern change", () => {
    const q = rectangles([-8, 0, 5, -15, 10], 2049);
    const scene = barScene(q),
      draw = drawBars();
    const group = draw(scene)[0]!,
      fill = group.children[0]!;
    const envelope = group.children.map(rectValues);
    expect(envelope.length).toBeLessThan(2 * 258);
    const exact = Array.from({ length: 2049 }, (_, i) =>
      Array.from(q.subarray(i * 4, i * 4 + 4), (v) => Math.round(v * 100) / 100),
    );
    for (const color of [
      "rgba(20, 30, 40, 0.999)",
      "#123456fe",
      "color(srgb 0 0 0 / 50%)",
      "var(--unresolved)",
    ]) {
      expect(draw(scene, color)[0]).toBe(group);
      expect(group.children.map(rectValues)).toEqual(exact);
      expect(group.style.getPropertyValue("color")).toBe("var(--axylo-series-color-1)");
      expect(draw(scene, "rgb(20, 30, 40)")[0]!.children.map(rectValues)).toEqual(envelope);
    }
    draw(barScene(q, "dots"));
    expect(group.children.slice(0, exact.length).map(rectValues)).toEqual(exact);
    expect(group.children.slice(exact.length).map(rectValues)).toEqual(exact);
    expect(group.children[exact.length]!.style.getPropertyValue("fill")).toMatch(
      /^url\(#axylo-pattern-/,
    );
    draw(scene);
    expect(group.children.map(rectValues)).toEqual(envelope);
    expect(group.children.every((r) => !r.style.getPropertyValue("fill"))).toBe(true);
    expect(group.children[0]).toBe(fill);
  });

  it("keeps 2,048 bars in their exact fractional positions", () => {
    const group = drawBars()(barScene(rectangles([31], 2048)))[0]!;
    expect(group.children).toHaveLength(2048);
    expect(rectValues(group.children[1]!)).toEqual([0.13, 69, 1, 31]);
  });

  it("clears both overlay styles when a previously patterned child becomes an exact fill", () => {
    const draw = drawBars();
    const group = draw(barScene(rectangles([13], 2), "diagonal"))[0]!;
    const overlay = group.children[2]!;
    expect(overlay.style.getPropertyValue("fill")).toMatch(/^url\(/);
    const q = rectangles([13, -21], 2050);
    draw(barScene(q), "#1234");
    expect(group.children[2]).toBe(overlay);
    expect(overlay.style.getPropertyValue("fill")).toBe("");
    expect(overlay.style.getPropertyValue("color")).toBe("");
    expect(rectValues(overlay)).toEqual([0.25, 87, 1, 13]);
    draw(barScene(q, "dots"));
    expect(group.children).toHaveLength(4100);
    expect(rectValues(group.children[2052]!)).toEqual(rectValues(overlay));
  });

  it.each([
    ["floating", 9, 46],
    ["varying width", 10, 0.5],
    ["very wide", 10, 1e20],
    ["reversed x order", 8, -2],
    ["far-offscreen endpoint", 2048 * 4, 1e25],
    ["non-finite", 10, NaN],
    ["negative dimension", 11, -1],
  ] as const)("keeps exact boxes for %s geometry", (_case, offset, value) => {
    const q = rectangles([11, -50, 73], 2049);
    q[offset] = value;
    expect(drawBars()(barScene(q))[0]!.children).toHaveLength(2049);
  });
});
