// Bundle with esbuild --platform=node --format=esm --bundle --define:__DEV__=false
// --define:__BENCH__=false and run the output with Node. Inputs are outside the timers.
import type { Scene } from "../../src/core/contracts";
import { svgRendererWith, type SvgMarks } from "../../src/render/svg";
import { TOKEN_BINDINGS } from "../../src/theme";
import { financeSvgMarks } from "../../src/finance/render";
import { cellPath, heatmapSvgMarks } from "../../src/spatial/heatmap/render";
import { stage as heatmap, typedGrid } from "../spatial/heatmap/fixtures";
import { baseOptions, FakeElement, fakeDocument, stage as finance } from "./fixtures";

const size = { width: 960, height: 480 };
const bindings = { tokens: TOKEN_BINDINGS, series: ["#182848", "#334455", "#445566"] };
const theme = {
  scheme: "light",
  moreContrast: false,
  forcedColors: false,
  paints: bindings,
} as const;
const median = (times: number[]) => times.sort((a, b) => a - b)[times.length >> 1]!.toFixed(3);

function measure(label: string, sceneFor: () => Scene, marks: SvgMarks) {
  const total: number[] = [],
    drawing: number[] = [];
  let nodes = 0,
    bytes = 0;
  for (let i = -12; i < 31; i++) {
    const start = performance.now();
    const scene = sceneFor();
    const ready = performance.now();
    const renderer = svgRendererWith(marks, fakeDocument());
    renderer.draw(scene, bindings, theme, 1);
    const end = performance.now();
    if (i >= 0) {
      total.push(end - start);
      drawing.push(end - ready);
    }
    const elements = (renderer.element as unknown as FakeElement).all();
    nodes = elements.length;
    bytes = elements.reduce((sum, e) => sum + (e.getAttribute("d")?.length ?? 0), 0);
    renderer.destroy();
  }
  console.log(label, {
    totalMs: median(total),
    firstDrawMs: median(drawing),
    svgNodes: nodes,
    pathBytes: bytes,
  });
}

for (const length of [10_000, 50_000]) {
  const x = Float64Array.from({ length }, (_, i) => i);
  const o = x.map((i) => 100 + 20 * Math.sin(i / 41));
  const c = x.map((i) => o[i]! + (i % 3) - 1);
  const h = x.map((i) => Math.max(o[i]!, c[i]!) + 2);
  const l = x.map((i) => Math.min(o[i]!, c[i]!) - 2);
  const v = x.map((i) => 100 + (i % 211));
  const options = baseOptions({
    x: { field: "x", type: "number" },
    data: { columns: { x, o, h, l, c, v } },
  });
  measure("finance-" + length, () => finance(options, size).scene, financeSvgMarks);
}

for (const kind of ["smooth", "blocks"]) {
  const data = typedGrid(250, 200, (r, c) =>
    kind === "smooth"
      ? Math.sin(r / 17) * 50 + Math.cos(c / 23) * 50
      : (Math.floor(r / 25) + Math.floor(c / 20)) % 8,
  );
  measure("heatmap-50000-" + kind, () => heatmap({ data }, size).scene, heatmapSvgMarks);
}

const boxes = new Float32Array(50_000 * 4);
for (let i = 0; i < 50_000; i++) {
  boxes[4 * i] = (i % 200) * 4.321;
  boxes[4 * i + 1] = Math.floor(i / 200) * 2.345;
  boxes[4 * i + 2] = 4.321;
  boxes[4 * i + 3] = 2.345;
}
const times: number[] = [];
let bytes = 0;
for (let i = -12; i < 31; i++) {
  const start = performance.now();
  bytes = Buffer.byteLength(cellPath(boxes));
  if (i >= 0) times.push(performance.now() - start);
}
console.log("cellPath-50000", { serializeAndFlattenMs: median(times), pathBytes: bytes });
