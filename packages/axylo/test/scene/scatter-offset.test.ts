import { expect, it } from "vitest";
import { linearScale } from "../../src/scale";
import { scatterPoints } from "../../src/scene/lines";
import { frame, scatter } from "../lookup/fixtures";

it("retains clipped centres and the dense encoding in a reversed, offset compact plot", () => {
  const x = new Float64Array(5000).fill(5);
  const y = new Float64Array(5000).fill(5);
  y.fill(-1, 4990);
  const data = frame("scatter", { data: { columns: { x, y } }, x: "x", y: "y" });
  const view = scatter(data, {
    compact: true,
    cues: [{ marker: "circle", dash: { normal: [], contrast: [] } }],
  });
  const projection = {
    kind: "xy",
    x: linearScale([0, 10], [125.5, 25.5]),
    y: linearScale([0, 10], [-75.25, -25.25]),
  } as const;
  const mark = scatterPoints(view, projection)[0]!;
  const heights = mark.xy.filter((_, index) => index % 2 === 1);
  expect(heights.filter((value) => value === -50.25)).toHaveLength(2000);
  expect(heights.filter((value) => value === -80.25)).toHaveLength(10);
  expect(mark.fill).toEqual({ kind: "series", index: 0 });
});
