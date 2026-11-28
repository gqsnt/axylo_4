import { expect, it } from "vitest";
import type { MarkerShape } from "../../src/core/contracts";
import { linearScale } from "../../src/scale";
import { scatterPoints } from "../../src/scene/lines";
import { frame, scatter } from "../lookup/fixtures";

const axis = linearScale([0, 100], [0, 100]);
const projection = { kind: "xy", x: axis, y: axis } as const;

function points(x: Float64Array, y: Float64Array, marker: MarkerShape = "circle") {
  const data = frame("scatter", { data: { columns: { x, y } }, x: "x", y: "y" });
  const view = scatter(data, { cues: [{ marker, dash: { normal: [], contrast: [] } }] });
  return { data, mark: scatterPoints(view, projection)[0]! };
}

it("elides only circles whose filled disk is still present in the series path", () => {
  const n = 80 * 80;
  const x = Float64Array.from({ length: n }, (_, i) => 10.16 + Math.floor(i / 80));
  const y = Float64Array.from({ length: n }, (_, i) => 10.37 + (i % 80));
  const { data, mark } = points(x, y);
  expect(mark.fill).toEqual({ kind: "series", index: 0 });
  expect(mark.xy.length / 2).toBeLessThan(n / 2);
  expect(data.series[0]!.x).toEqual(x);
  expect(data.series[0]!.y).toEqual(y);

  // Independent oracle: each whole unit square in a missing disk's box has all four
  // corners inside a surviving disk. Test the scene and the dense SVG centre precision.
  for (const scale of [0, 10]) {
    const project = (v: number) => (scale ? Math.round(v * scale) / scale : v);
    const covered = new Uint8Array(100 * 100);
    const kept = new Set<string>();
    for (let i = 0; i < mark.xy.length; i += 2) {
      const cx = project(mark.xy[i]!),
        cy = project(mark.xy[i + 1]!);
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
});

it("preserves sparse circles, clipped centres and noncircular shapes", () => {
  const x = new Float64Array(3000).fill(50);
  const y = new Float64Array(3000).fill(50);
  y.fill(100.01, 2000);
  const { mark } = points(x, y);
  expect(mark.xy.length / 2).toBe(3000);
  y[2000] = 50;
  const dense = points(x, y).mark.xy;
  expect(dense.filter((v, i) => i % 2 === 1 && v === Math.fround(100.01))).toHaveLength(999);
  for (const shape of ["square", "diamond", "triangle"] as const) {
    expect(points(x, y, shape).mark.xy.length / 2).toBe(3000);
  }
});

it("keeps distinct exposed silhouettes even within the same pixel", () => {
  const n = 5000;
  const x = Float64Array.from({ length: n }, (_, i) => 12 + i / 100);
  const y = new Float64Array(n).fill(30.25);
  // No retained circle can cover the outermost point of another disk in this row.
  expect(points(x, y).mark.xy.length / 2).toBe(n);
});
