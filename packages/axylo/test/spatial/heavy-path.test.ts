import { expect, it, vi } from "vitest";
import type { ResolvedTheme, Scene } from "../../src/core/contracts";
import { svgRendererWith } from "../../src/render/svg";
import { svgBubbles, type BubbleMark } from "../../src/spatial/bubble/composition";
import { heatmapSvgMarks } from "../../src/spatial/heatmap/render";
import { TOKEN_BINDINGS } from "../../src/theme";
import { TestDocument } from "../core/n3-dom";
import { geometryOf } from "./bubble/oracle";
import { stage, typedGrid } from "./heatmap/fixtures";

const paints = { tokens: TOKEN_BINDINGS, series: ["#0f50be"] };
const theme: ResolvedTheme = { scheme: "light", forcedColors: false, moreContrast: false, paints };

function bubbles(side: number) {
  // Disjoint radius-one discs give each center two complete semicircles.
  const discs = Array.from({ length: side * side }, (_, row) => ({
    x: 4 + 8 * Math.floor(row / side),
    y: 4 + 8 * (row % side),
    r: 1,
    series: 0,
    row,
  }));
  const geometry = geometryOf(discs, 512, 512);
  const mark: BubbleMark = {
    type: "points",
    series: 0,
    xy: new Float32Array(),
    shape: "circle",
    size: 0,
    fill: { kind: "series", index: 0 },
    bubble: { geometry, members: new Uint32Array(), seriesCount: 1, paint: "series" },
  };
  return {
    scene: { width: 512, height: 512, clip: geometry.plot, marks: [mark] },
    path: discs.map(({ x, y }) => `M${x - 1} ${y}a1 1 0 1 1 2 0a1 1 0 1 1 -2 0Z`).join(""),
  };
}

function heatmap(side: number) {
  const { scene } = stage({ data: typedGrid(side, side, () => 1) }, { width: 1024, height: 1024 });
  // These cells have a half-pixel inset on all sides, and all belong to one color bin.
  const { x, y, width, height } = scene.clip;
  const w = width / side,
    h = height / side;
  const round = (v: number) => Math.round(v * 100) / 100;
  const paths = Array.from(
    { length: side * side },
    (_, i) =>
      `M${round(x + (i % side) * w + 0.5)} ${round(y + Math.floor(i / side) * h + 0.5)}h${round(w - 1)}v${round(h - 1)}h-${round(w - 1)}z`,
  );
  return { scene, path: paths.join("") };
}

it.each([
  { name: "bubble", marks: { points: svgBubbles }, fixture: bubbles },
  { name: "heatmap", marks: heatmapSvgMarks, fixture: heatmap },
])("isolates a dense $name path and clears the hint on a sparse redraw", ({ marks, fixture }) => {
  const renderer = svgRendererWith(marks, new TestDocument() as unknown as Document);
  const group = renderer.element.querySelector<SVGGElement>(".axylo-scene")!;
  const draw = (scene: Scene) => renderer.draw(scene, paints, theme, 1);
  const dense = fixture(64),
    sparse = fixture(1);
  draw(dense.scene);
  const path = group.querySelector("path")!;
  expect(path.getAttribute("d")).toBe(dense.path);
  expect(dense.path.length).toBeGreaterThanOrEqual(65_536);
  expect(group.style.getPropertyValue("will-change")).toBe("transform");

  const read = vi.spyOn(path, "getAttribute");
  draw(dense.scene);
  expect(read).not.toHaveBeenCalledWith("d");
  expect(group.style.getPropertyValue("will-change")).toBe("transform");
  read.mockRestore();

  draw(sparse.scene);
  expect(group.querySelector("path")).toBe(path);
  expect(path.getAttribute("d")).toBe(sparse.path);
  expect(group.style.getPropertyValue("will-change")).toBe("");
  renderer.destroy();
});
