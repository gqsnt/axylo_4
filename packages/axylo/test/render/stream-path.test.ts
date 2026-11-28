import { expect, it } from "vitest";
import type { PaintBindings, PathMark, ResolvedTheme } from "../../src/core/contracts";
import { createSvgRenderer } from "../../src/render/svg";
import { TOKEN_BINDINGS } from "../../src/theme";
import { fakeDocument, type FakeElement } from "../finance/fixtures";

it("keeps a shifted line exact after a changed interior coordinate, pen lift, or equal-length path key", () => {
  const renderer = createSvgRenderer(fakeDocument());
  const bindings: PaintBindings = { tokens: TOKEN_BINDINGS, series: ["red"] };
  const theme: ResolvedTheme = {
    paints: bindings,
    scheme: "light",
    forcedColors: false,
    moreContrast: false,
  };
  const clip = { x: 0, y: 0, width: 200, height: 40 };
  const draw = (xy: Float32Array) => {
    const mark: PathMark = {
      type: "path",
      series: 0,
      xy,
      strokeWidth: 1,
      stroke: { kind: "series", index: 0 },
      dash: { normal: null, contrast: null },
    };
    renderer.draw({ ...clip, clip, marks: [mark] }, bindings, theme, 1);
    const path = (renderer.element as unknown as FakeElement)
      .all()
      .find((el) => el.tagName === "path")!;
    let expected = "",
      pen = false;
    for (let i = 0; i < xy.length; i += 2) {
      const x = xy[i]!,
        y = xy[i + 1]!;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        expected += `${pen ? "L" : "M"}${Math.round(100 * x) / 100} ${Math.round(100 * y) / 100}`;
        pen = true;
      } else pen = false;
    }
    expect(path.getAttribute("d")).toBe(expected);
    return path;
  };

  const size = 80,
    stream = (step: number) =>
      Float32Array.from({ length: 2 * size }, (_, i) =>
        i % 2 ? ((step + (i >> 1)) % 7) + 2.125 : i >> 1,
      );
  const path = draw(stream(0));
  // Cross the circular buffer's wrap point, then force a miss after the first and last coordinates matched.
  for (let n = 1; n <= size + 2; n++) expect(draw(stream(n))).toBe(path);
  const moved = stream(size + 3);
  moved[42] = 22;
  expect(draw(moved)).toBe(path);
  const gap = moved.slice();
  gap[61] = NaN;
  expect(draw(gap)).toBe(path);
  expect(draw(stream(size + 4))).toBe(path);
  renderer.destroy();
});
