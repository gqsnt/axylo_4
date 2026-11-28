import { expect, it } from "vitest";
import { scatterGrid } from "../../src/lookup/scatter-grid";
import { linearScale } from "../../src/scale";
import { frame, plot, scatter } from "./fixtures";

const axis = linearScale([0, 96], [0, 96]);
const projection = { kind: "xy", x: axis, y: axis } as const;
const layout = { ...plot(projection, 96, 96), projection };

it.each([Infinity, 0])(
  "retains equal-row cell order and coincident page order at budget %s",
  (exactBudget) => {
    const base = frame("scatter", { data: [{ x: 0, y: 0 }], x: "x", y: "y" });
    const entry = base.series[0]!;
    const data = {
      ...base,
      series: Array.from({ length: 12 }, (_, s) => ({
        ...entry,
        key: String(s),
        x: Float64Array.of(s < 10 ? 23.75 : 24.25),
        y: Float64Array.of(24),
        row: Int32Array.of(14),
      })),
    };
    const view = scatter(data);
    const grid = scatterGrid(view, layout, 12, 4, { exactBudget });
    // Equal source row: the earlier coarse cell wins, then its later input point.
    const result = grid.pick(24, 24)!;
    expect(result).toEqual({ hits: [9, 8, 7, 6, 5, 4, 3, 2], count: 12 });
    const rule = exactBudget ? "exact" : "lattice";
    expect(grid.usedLattice).toBe(!exactBudget);
    expect(grid.members(rule, 9, 8, 4)).toEqual([1, 0, 11, 10]);
    expect(grid.members(rule, 4, 0, 4)).toEqual([4, 9, 8, 7]);
    expect(grid.has(rule, 4, 11)).toBe(true);
  },
);

it("keeps a held nonwinning member first when the entire view shares a position", () => {
  const n = 40_000;
  const base = frame("scatter", { data: [{ x: 0, y: 0 }], x: "x", y: "y" });
  const row = Int32Array.from({ length: n }, (_, i) => (i + n / 2) % n);
  const view = scatter({
    ...base,
    series: [
      {
        ...base.series[0]!,
        x: new Float64Array(n).fill(48.25),
        y: new Float64Array(n).fill(48.75),
        row,
      },
    ],
  });
  for (const exactBudget of [Infinity, 0]) {
    const grid = scatterGrid(view, layout, n, 1, { exactBudget });
    const rule = exactBudget ? "exact" : "lattice";
    const winner = n / 2 - 1;
    expect(grid.pick(48, 49)).toEqual({
      hits: [winner, ...Array.from({ length: 7 }, (_, i) => n - 1 - i)],
      count: n,
    });
    expect(grid.members(rule, 3, 0, 4)).toEqual([3, winner, n - 1, n - 2]);
    expect(grid.members(rule, 3, n - 4, 4)).toEqual([4, 2, 1, 0]);
    expect(grid.has(rule, 3, 0)).toBe(true);
  }
});
