import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Rect, RectMark } from "../../../src/core/contracts";
import {
  cellPath,
  cellTagOf,
  buildHeatmapScene,
  hatchPath,
} from "../../../src/spatial/heatmap/render";
import { grid, stage, type GridValue } from "./fixtures";

function sceneFor(cells: readonly GridValue[], cols: number, plot: Rect) {
  const rows = cells.length / cols;
  const options = {
    data: grid(rows, cols, (r, c) => cells[r * cols + c]),
    color: { bins: 2, domain: [0, 1] },
  };
  const s = stage(options);
  if (s.layout.kind !== "plot") throw new Error("expected a plot");
  const scene = buildHeatmapScene(s.view, { ...s.layout, plot }, 1);
  return scene.marks.map((mark) => {
    const tag = cellTagOf(mark)!;
    return { key: tag.kind === "bin" ? tag.bin : tag.kind, boxes: (mark as RectMark).xywh };
  });
}

type Box = readonly [number, number, number, number];

// Parse the serialized region in integer hundredths of a CSS pixel, so even a one-cent gap is observable.
function readBoxes(d: string): Box[] {
  return [...d.matchAll(/M([^ ]+) ([^h]+)h([^v]+)v([^h]+)h-[^z]+z/g)].map(
    (match) => match.slice(1).map((s) => Math.round(Number(s) * 100)) as unknown as Box,
  );
}
const storedCents = (n: number) => Math.round(Math.fround(n) * 100);

function assertCoverage(actual: Box[], expected: Box[]) {
  // Sort all horizontal and vertical boundaries. Coverage is constant inside each elementary rectangle.
  const all = [...actual, ...expected];
  const edges = (axis: 0 | 1) =>
    [...new Set(all.flatMap((b) => [b[axis], b[axis] + b[axis + 2]!]))].sort((a, b) => a - b);
  const xs = edges(0),
    ys = edges(1);
  const covered = (boxes: Box[], x: number, y: number) =>
    boxes.some(([l, t, w, h]) => l <= x && x < l + w && t <= y && y < t + h);
  for (const y of ys)
    for (const x of xs) {
      expect(covered(actual, x, y), `at (${x}, ${y}) cents`).toBe(covered(expected, x, y));
    }
}

describe("row-adjacent heatmap rectangles", () => {
  it("merges only equal spans on consecutive rows, and leaves missing and invalid hatches separate", () => {
    const rows = [
      [0, 0, 1, 1, null, "bad"],
      [0, 0, 1, 1, null, "bad"],
      [0, 1, 1, 1, null, "bad"],
      [0, 0, 1, 1, null, "bad"],
    ];
    const groups = sceneFor(rows.flat(), 6, { x: 10, y: 4, width: 18, height: 8 });
    const group = (key: string | number) => groups.find((g) => g.key === key)!.boxes;
    expect([...group(0)]).toEqual([10, 4, 6, 4, 10, 8, 3, 2, 10, 10, 6, 2]);
    expect([...group(1)]).toEqual([16, 4, 6, 4, 13, 8, 9, 2, 16, 10, 6, 2]);
    for (const [key, x] of [
      ["missing", 22],
      ["invalid", 25],
    ] as const) {
      expect([...group(key)]).toEqual([x, 4, 3, 2, x, 6, 3, 2, x, 8, 3, 2, x, 10, 3, 2]);
    }
    // Same endpoints and bin, but a different interior on the middle row.
    const split = sceneFor([0, 0, 0, 0, 1, 0, 0, 0, 0], 3, { x: 0, y: 0, width: 9, height: 6 });
    expect([...split.find((g) => g.key === 0)!.boxes]).toEqual([
      0, 0, 9, 2, 0, 2, 3, 2, 6, 2, 3, 2, 0, 4, 9, 2,
    ]);
  });

  it("keeps every cell in a checkerboard and every inset on an otherwise uniform block", () => {
    const values = Array.from({ length: 20 }, (_, i) => ((i % 5) + Math.floor(i / 5)) % 2);
    const mixed = sceneFor(values, 5, { x: 2, y: 3, width: 20, height: 8 });
    expect(mixed.map((g) => g.boxes.length / 4)).toEqual([10, 10]);
    const inset = sceneFor(Array(20).fill(0), 5, { x: 2, y: 3, width: 35, height: 24 });
    expect([...inset[0]!.boxes]).toEqual(
      values.flatMap((_, i) => [2.5 + 7 * (i % 5), 3.5 + 6 * Math.floor(i / 5), 6, 5]),
    );
  });

  it("covers the exact cell lattice for arbitrary bin and hatch patterns", () => {
    const cell = fc.constantFrom<GridValue>(0, 1, null, "bad");
    fc.assert(
      fc.property(fc.array(cell, { minLength: 24, maxLength: 24 }), (cells) => {
        const plot = { x: 0.25, y: 0.5, width: 19.5, height: 9 };
        const groups = sceneFor(cells, 6, plot);
        for (const [value, key] of [
          [0, 0],
          [1, 1],
          [null, "missing"],
          ["bad", "invalid"],
        ] as const) {
          const expected: Box[] = [];
          for (const [i, v] of cells.entries())
            if (v === value) {
              expected.push([25 + (i % 6) * 325, 50 + Math.floor(i / 6) * 225, 325, 225]);
            }
          const q = groups.find((g) => g.key === key)?.boxes ?? new Float32Array(0);
          assertCoverage(readBoxes(cellPath(q)), expected);
          if (typeof key === "string") expect(q.length).toBe(4 * expected.length);
        }
      }),
      { numRuns: 48 },
    );
  });

  it("retains the painted bottom and any gaps between independently rounded fractional rows", () => {
    const block = Array(8).fill(0);
    // A height of 1.003 draws as 1.00, with a one-cent gap before the third row.
    const gapped = sceneFor(block, 2, { x: 0, y: 0, width: 6, height: 4.012 });
    expect(cellPath(gapped[0]!.boxes)).toBe("M0 0h6v2h-6zM0 2.01h6v2h-6z");
    // Each height of 1.006 draws as 1.01. The last row starts at 3.02, so the union ends at 4.03.
    const overlapping = sceneFor(block, 2, { x: 0, y: 0, width: 6, height: 4.024 });
    expect(cellPath(overlapping[0]!.boxes)).toBe("M0 0h6v4.03h-6z");
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3000 }),
        fc.integer({ min: -100, max: 100 }),
        (height, offset) => {
          const plot = { x: 0.13, y: offset / 1000, width: 9.75, height: height / 100 };
          const ch = plot.height / 7;
          const groups = sceneFor(Array(21).fill(0), 3, plot);
          const rows: Box[] = Array.from({ length: 7 }, (_, r) => [
            13,
            storedCents(plot.y + r * ch),
            975,
            storedCents(ch),
          ]);
          assertCoverage(readBoxes(cellPath(groups[0]!.boxes)), rows);
        },
      ),
      { numRuns: 64 },
    );
  });

  it("preserves each bin's painted row spans at fractional column and row boundaries", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1 }), { minLength: 8, maxLength: 8 }),
        fc.integer({ min: 8001, max: 27000 }),
        fc.integer({ min: 4001, max: 18000 }),
        (pattern, width, height) => {
          const plot = { x: 1.127, y: 2.133, width: width / 1000, height: height / 1000 };
          const cols = pattern.length,
            rows = 4,
            cw = plot.width / cols,
            ch = plot.height / rows;
          const cells = [...pattern, ...pattern, ...pattern.slice().reverse(), ...pattern];
          const groups = sceneFor(cells, cols, plot);
          for (const color of [0, 1]) {
            const spans: Box[] = [];
            for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols;) {
                const start = c++,
                  value = cells[r * cols + start];
                while (c < cols && cells[r * cols + c] === value) c++;
                if (value !== color) continue;
                const x = Math.fround(plot.x + start * cw);
                // The existing horizontal span uses the last cell's right edge and the stored left origin.
                const w = c === start + 1 ? cw : plot.x + (c - 1) * cw + cw - x;
                spans.push([
                  storedCents(x),
                  storedCents(plot.y + r * ch),
                  storedCents(w),
                  storedCents(ch),
                ]);
              }
            }
            const boxes = groups.find((g) => g.key === color)?.boxes ?? new Float32Array(0);
            assertCoverage(readBoxes(cellPath(boxes)), spans);
          }
        },
      ),
      { numRuns: 48 },
    );
  });
});

it("serializes every Float32 box exactly as separately rounded SVG numbers", () => {
  const f = (v: number) => String(Math.round(v * 100) / 100);
  const number = fc.oneof(
    fc.float(),
    fc.constantFrom(-0, -0.005, 1.125, 2e9, NaN, Infinity, -Infinity),
  );
  fc.assert(
    fc.property(fc.array(fc.tuple(number, number, number, number), { maxLength: 30 }), (boxes) => {
      const q = new Float32Array(boxes.flat());
      let expected = "";
      for (let i = 0; i < q.length; i += 4) {
        const w = f(q[i + 2]!);
        expected += `M${f(q[i]!)} ${f(q[i + 1]!)}h${w}v${f(q[i + 3]!)}h-${w}z`;
      }
      expect(cellPath(q)).toBe(expected);
    }),
    { numRuns: 128 },
  );
  const q = Float32Array.of(2.125, -1.125, 3.25, 4.625);
  const outline = "M2.13 -1.12h3.25v4.63h-3.25z";
  expect(cellPath(q)).toBe(outline);
  expect(hatchPath(q, false)).toBe(outline + "M2.13 3.5l3.25 -4.63");
  expect(hatchPath(q, true)).toBe(outline + "M2.13 3.5l3.25 -4.63M2.13 -1.12l3.25 4.63");
});
