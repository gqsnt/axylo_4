import { expect, it } from "vitest";
import { linearScale } from "../../src/scale";
import { scatterPoints } from "../../src/scene/lines";
import { createSvgRenderer } from "../../src/render/svg";
import { TOKEN_BINDINGS } from "../../src/theme";
import { fakeDocument, type FakeElement } from "../finance/fixtures";
import { frame, scatter } from "../lookup/fixtures";

const projection = {
  kind: "xy",
  x: linearScale([0, 10], [125.5, 25.5]),
  y: linearScale([0, 10], [-75.25, -25.25]),
} as const;

function denseView() {
  const x = new Float64Array(5000).fill(5);
  const y = new Float64Array(5000).fill(5);
  y.fill(-1, 4990);
  const data = frame("scatter", { data: { columns: { x, y } }, x: "x", y: "y" });
  return scatter(data, {
    compact: true,
    cues: [{ marker: "circle", dash: { normal: [], contrast: [] } }],
  });
}

it("keeps every projected centre in the scene of a reversed, offset compact plot", () => {
  const mark = scatterPoints(denseView(), projection)[0]!;
  const widths = mark.xy.filter((_, index) => index % 2 === 0);
  const heights = mark.xy.filter((_, index) => index % 2 === 1);
  // x = 5 is the midpoint of [125.5, 25.5]; y = 5 and y = -1 project through [-75.25, -25.25].
  expect(widths.filter((value) => value === 75.5)).toHaveLength(5000);
  expect(heights.filter((value) => value === -50.25)).toHaveLength(4990);
  expect(heights.filter((value) => value === -80.25)).toHaveLength(10);
  expect(mark.fill).toEqual({ kind: "series", index: 0 });
});

it("culls only redundant interior circles at draw time in the offset clip", () => {
  const mark = scatterPoints(denseView(), projection)[0]!;
  const clip = { x: 25.5, y: -75.25, width: 100, height: 50 };
  const doc = fakeDocument();
  const renderer = createSvgRenderer(doc);
  const root = renderer.element as unknown as FakeElement;
  const group = root.children.find((el) => el.getAttribute("class") === "axylo-scene")!;
  const draw = (color: string) => {
    renderer.draw(
      { width: 100, height: 50, clip, marks: [mark] },
      { tokens: TOKEN_BINDINGS, series: [color] },
      { paints: { tokens: TOKEN_BINDINGS, series: [color] }, scheme: "light", forcedColors: false, moreContrast: false },
      1,
    );
    return group.children[0]!.getAttribute("d")!.split("M").length - 1;
  };
  const before = Float32Array.from(mark.xy);
  const opaque = draw("rgb(15, 80, 190)");
  // The ten clipped centres lie outside the clip and must survive; identical interior ones are redundant.
  expect(opaque).toBeGreaterThanOrEqual(11);
  expect(opaque).toBeLessThan(5000);
  expect(draw("rgba(15, 80, 190, 0.45)")).toBe(5000);
  expect(Array.from(mark.xy)).toEqual(Array.from(before));
});
