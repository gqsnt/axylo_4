import fc from "fast-check";
import { expect, it, vi } from "vitest";
import type { MarkerShape, Scene } from "../../src/core/contracts";
import { LINE } from "../../src/kinds/line";
import { SCATTER, SCATTER_STATIC } from "../../src/kinds/scatter";
import { createSvgRenderer, svgRendererWith, type SvgMarks } from "../../src/render/svg";
import { TOKEN_BINDINGS } from "../../src/theme";
import { fakeDocument, type FakeElement } from "../finance/fixtures";
import { linearScale } from "../../src/scale";
import { scatterPoints } from "../../src/scene/lines";
import { frame, scatter } from "../lookup/fixtures";

const axis = linearScale([0, 100], [0, 100]);
const projection = { kind: "xy", x: axis, y: axis } as const;

const clip = { x: 0, y: 0, width: 100, height: 100 };
const bindings = { tokens: TOKEN_BINDINGS, series: ["var(--axylo-series-color-1)"] };
const theme = (color: string) => ({
  paints: { ...bindings, series: [color] },
  scheme: "light" as const,
  forcedColors: false,
  moreContrast: false,
});
const sceneOf = (...marks: Scene["marks"]) => ({ width: 100, height: 100, clip, marks });

function fixture(handlers?: SvgMarks) {
  const doc = fakeDocument();
  const renderer = handlers ? svgRendererWith(handlers, doc) : createSvgRenderer(doc);
  const root = renderer.element as unknown as FakeElement;
  const group = (name: string) => root.children.find((el) => el.getAttribute("class") === name)!;
  const sceneGroup = group("axylo-scene");
  return {
    renderer,
    sceneGroup,
    overlayGroup: group("axylo-overlay"),
    draw(scene: Scene, color = "#0f50be") {
      renderer.draw(scene, bindings, theme(color), 1);
      return sceneGroup.children[0]!.getAttribute("d")!;
    },
  };
}

// These dense fixtures all encode complete radius-three circles at tenth-pixel precision.
function centers(path: string) {
  const circle = /M(-?[\d.]+) (-?[\d.]+)a3 3 0 11-6 0a3 3 0 116 0/gy;
  const result: number[] = [];
  let end = 0;
  for (let match; (match = circle.exec(path));) {
    result.push((Number(match[1]) * 10 - 30) / 10, Number(match[2]));
    end = circle.lastIndex;
  }
  expect(end).toBe(path.length);
  return result;
}

const countPaths = (path: string) => path.split("M").length - 1;

function points(x: Float64Array, y: Float64Array, marker: MarkerShape = "circle") {
  const data = frame("scatter", { data: { columns: { x, y } }, x: "x", y: "y" });
  const view = scatter(data, { cues: [{ marker, dash: { normal: [], contrast: [] } }] });
  return { data, mark: scatterPoints(view, projection)[0]! };
}

it.each(["rgb(15, 80, 190)", "#0f50be"])(
  "elides only circles whose disk is still drawn with %s",
  (color) => {
    const n = 80 * 80;
    const x = Float64Array.from({ length: n }, (_, i) => 10.16 + Math.floor(i / 80));
    const y = Float64Array.from({ length: n }, (_, i) => 10.37 + (i % 80));
    const { data, mark } = points(x, y);
    expect(mark.fill).toEqual({ kind: "series", index: 0 });
    const drawn = centers(fixture().draw(sceneOf(mark), color));
    expect(mark.xy.length / 2).toBe(n);
    expect(drawn.length / 2).toBeLessThan(n / 2);
    expect(data.series[0]!.x).toEqual(x);
    expect(data.series[0]!.y).toEqual(y);

    // Independent oracle: each whole unit square in a missing disk's box has all four
    // corners inside a surviving disk. Test the scene and the dense SVG centre precision.
    for (const scale of [0, 10]) {
      const project = (v: number) => (scale ? Math.round(v * scale) / scale : v);
      const covered = new Uint8Array(100 * 100);
      const kept = new Set<string>();
      for (let i = 0; i < drawn.length; i += 2) {
        // The integer lattice identifies the original datum independently of which disks survived.
        const col = Math.round(drawn[i]! - 10.16),
          row = Math.round(drawn[i + 1]! - 10.37);
        const j = 80 * col + row;
        const cx = scale ? drawn[i]! : Math.fround(x[j]!);
        const cy = scale ? drawn[i + 1]! : Math.fround(y[j]!);
        expect(drawn[i]!).toBe(Math.round(Math.fround(x[j]!) * 10) / 10);
        expect(drawn[i + 1]!).toBe(Math.round(Math.fround(y[j]!) * 10) / 10);
        kept.add(`${cx},${cy}`);
        for (let r = Math.floor(cy) - 3; r <= cy + 3; r++) {
          for (let c = Math.floor(cx) - 3; c <= cx + 3; c++) {
            if (
              [c, c + 1].every((a) => [r, r + 1].every((b) => (a - cx) ** 2 + (b - cy) ** 2 <= 9))
            ) {
              covered[r * 100 + c] = 1;
            }
          }
        }
      }
      let holes = 0;
      for (let i = 0; i < n; i++) {
        const cx = project(Math.fround(x[i]!)),
          cy = project(Math.fround(y[i]!));
        if (kept.has(`${cx},${cy}`)) continue;
        for (let r = Math.floor(cy - 3); r < Math.ceil(cy + 3); r++) {
          for (let c = Math.floor(cx - 3); c < Math.ceil(cx + 3); c++)
            holes += 1 - covered[r * 100 + c]!;
        }
      }
      expect(holes).toBe(0);
    }
  },
);

it("preserves sparse circles, clipped centres and noncircular shapes", () => {
  const x = new Float64Array(3000).fill(50);
  const y = new Float64Array(3000).fill(50);
  y.fill(100.01, 2000);
  const { mark } = points(x, y);
  const { draw } = fixture();
  expect(countPaths(draw(sceneOf(mark)))).toBe(3000);
  y[2000] = 50;
  const dense = centers(draw(sceneOf(points(x, y).mark)));
  expect(dense.filter((v, i) => i % 2 === 1 && v === 100)).toHaveLength(999);
  for (const shape of ["square", "diamond", "triangle"] as const) {
    expect(countPaths(draw(sceneOf(points(x, y, shape).mark)))).toBe(3000);
  }
});

it("keeps distinct exposed silhouettes even within the same pixel", () => {
  const n = 5000;
  const x = Float64Array.from({ length: n }, (_, i) => 12 + i / 100);
  const y = new Float64Array(n).fill(30.25);
  // No retained circle can cover the outermost point of another disk in this row.
  expect(countPaths(fixture().draw(sceneOf(points(x, y).mark)))).toBe(n);
});

it("compares adjacent duplicates to the last retained center", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.integer({ min: 10, max: 90 }), { minLength: 3, maxLength: 10 }),
      (levels) => {
        // Collinear disks leave the sides of every 7x7 box exposed. Group heads get the
        // first witness pass, so only repeats can be dropped until 2,000 centers remain.
        const y = Float32Array.from(
          { length: 2600 },
          (_, i) => levels[Math.floor(i / 17) % levels.length]!,
        );
        const xy = Float32Array.from({ length: y.length * 2 }, (_, i) => (i % 2 ? y[i >> 1]! : 50));
        const expected: number[] = [];
        let excess = y.length - 2000;
        for (const value of y) {
          if (excess && value === expected.at(-1)) excess--;
          else expected.push(value);
        }
        const scene = sceneOf({
          type: "points",
          xy,
          size: 6,
          shape: "circle",
          series: 0,
          fill: { kind: "series", index: 0 },
        });
        const drawn = centers(fixture().draw(scene));
        expect(drawn.filter((_, i) => i % 2)).toEqual(expected);
      },
    ),
    { numRuns: 12 },
  );
});

it("uses coverage for both scatter entries and keeps the shared line marker drawer exact", () => {
  const x = new Float64Array(2500).fill(50);
  const scene = sceneOf(points(x, x).mark);
  for (const scatter of [SCATTER, SCATTER_STATIC]) {
    expect(countPaths(fixture(scatter.svg).draw(scene))).toBe(2000);
  }
  expect(countPaths(fixture(LINE.svg).draw(scene))).toBe(x.length);
});

it.each([
  "rgba(15, 80, 190, 0.45)",
  "rgba(15, 80, 190, 1)",
  "#0f50be80",
  "hsla(210, 80%, 40%, 0.5)",
  "oklch(0.5 0.1 240 / 0.5)",
])("draws every dense circle for resolved paint %s", (color) => {
  const x = new Float64Array(2600).fill(45.5);
  const y = new Float64Array(2600).fill(52.25);
  const { mark } = points(x, y);
  const drawn = centers(fixture().draw(sceneOf(mark), color));
  expect(drawn).toEqual(Array.from({ length: 2 * x.length }, (_, i) => (i % 2 ? 52.3 : 45.5)));
});

it("reuses equivalent opaque inputs and restores exact geometry on paint and clip changes", () => {
  const x = Float64Array.from({ length: 3600 }, (_, i) => 20 + Math.floor(i / 60));
  const y = Float64Array.from({ length: 3600 }, (_, i) => 20 + (i % 60));
  const { mark } = points(x, y);
  const scene = sceneOf(mark),
    xy = mark.xy,
    original = xy.slice();
  const { draw } = fixture();
  const culled = draw(scene);
  expect(countPaths(culled)).toBeLessThan(x.length);
  const decode = vi.spyOn(TextDecoder.prototype, "decode");
  try {
    expect(draw({ ...scene, clip: { ...clip } }, "rgb(15, 80, 190)")).toBe(culled);
    expect(decode).not.toHaveBeenCalled();
  } finally {
    decode.mockRestore();
  }

  const exact = Array.from({ length: 2 * x.length }, (_, i) => (i % 2 ? y : x)[i >> 1]!);
  expect(centers(draw(scene, "rgba(15, 80, 190, 0.45)"))).toEqual(exact);
  expect(draw(scene)).toBe(culled);
  for (const change of [{ x: 80 }, { y: 80 }, { width: 20 }, { height: 20 }]) {
    expect(centers(draw({ ...scene, clip: { ...clip, ...change } }))).toEqual(exact);
    expect(draw(scene)).toBe(culled);
  }
  expect(mark.xy).toBe(xy);
  expect(mark.xy).toEqual(original);
});

it("draws all overlay circles and all scene circles at a different size", () => {
  const x = new Float64Array(2500).fill(50);
  const { mark } = points(x, x);
  const { renderer, overlayGroup, sceneGroup, draw } = fixture();
  expect(countPaths(draw(sceneOf({ ...mark, size: 8 })))).toBe(x.length);
  draw(sceneOf({ ...mark, xy: mark.xy.subarray(0, 2) }));
  renderer.drawOverlay({ clip, clipped: [mark], unclipped: [] }, bindings, theme("#0f50be"), 1);
  expect(centers(overlayGroup.children[0]!.getAttribute("d")!)).toHaveLength(2 * x.length);
  expect(sceneGroup.style.getPropertyValue("will-change")).toBe("");
});

it("sets the scene layer hint at 65,536 ASCII bytes and clears it when the heavy slot is trimmed", () => {
  const path = (xy: Float32Array) => ({
    type: "path" as const,
    series: 0,
    xy,
    stroke: { kind: "series" as const, index: 0 },
    strokeWidth: 1,
    dash: { normal: null, contrast: null },
  });
  // Each pair is four characters (M0 0 or L0 0). A four-digit endpoint adds three characters.
  const below = new Float32Array(2 * 16383);
  below[0] = 1000;
  const sparse = sceneOf(path(below));
  const heavy = sceneOf(path(below), path(new Float32Array(2 * 16384)));
  const { sceneGroup, draw } = fixture();
  const set = vi.spyOn(sceneGroup.style, "setProperty"),
    remove = vi.spyOn(sceneGroup.style, "removeProperty");
  expect(draw(sparse)).toHaveLength(65535);
  expect(set).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  draw(heavy);
  expect(sceneGroup.children[1]!.getAttribute("d")).toHaveLength(65536);
  expect(sceneGroup.style.getPropertyValue("will-change")).toBe("transform");
  draw(heavy);
  expect(set.mock.calls).toEqual([["will-change", "transform"]]);
  draw(sparse);
  draw(sparse);
  expect(remove.mock.calls).toEqual([["will-change"]]);
  expect(sceneGroup.style.getPropertyValue("will-change")).toBe("");
});
