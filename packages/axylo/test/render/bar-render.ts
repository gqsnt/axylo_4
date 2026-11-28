import type { PaintBindings, RectMark, Scene } from "../../src/core/contracts";
import { createSvgRenderer, svgRendererWith, type SvgMarks } from "../../src/render/svg";
import { TOKEN_BINDINGS } from "../../src/theme";
import { fakeDocument, type FakeElement } from "../finance/fixtures";

const bindings: PaintBindings = { tokens: TOKEN_BINDINGS, series: ["var(--axylo-series-color-1)"] };

export function drawBars(handlers?: SvgMarks) {
  const doc = fakeDocument();
  const renderer = handlers ? svgRendererWith(handlers, doc) : createSvgRenderer(doc);
  const root = renderer.element as unknown as FakeElement;
  const sceneGroup = root.children.find((el) => el.getAttribute("class") === "axylo-scene")!;
  return (scene: Scene, resolved = "#123456") => {
    const paints = { ...bindings, series: [resolved] };
    renderer.draw(
      scene,
      bindings,
      { paints, scheme: "light", forcedColors: false, moreContrast: false },
      1,
    );
    return sceneGroup.children.filter((el) => el.tagName === "g");
  };
}

export const rectValues = (rect: FakeElement) =>
  ["x", "y", "width", "height"].map((key) => {
    const value = rect.getAttribute(key);
    if (value === null) throw new Error(`missing SVG rectangle attribute ${key}`);
    return Number(value);
  });

export function barScene(xywh: Float32Array, pattern?: RectMark["pattern"]): Scene {
  const mark: RectMark = {
    type: "rects",
    series: 0,
    variant: "bar",
    xywh,
    pattern,
    fill: { kind: "series", index: 0 },
  };
  return { width: 800, height: 400, clip: { x: 0, y: 0, width: 800, height: 400 }, marks: [mark] };
}
