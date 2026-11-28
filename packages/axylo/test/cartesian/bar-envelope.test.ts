import { expect, it } from "vitest";
import { slotBandwidth } from "../../src/cartesian/bar-geom";
import { type RectMark } from "../../src/core/contracts";
import { linearScale, bandScale } from "../../src/scale";
import { barScene } from "../../src/scene";
import { plot as layout } from "../lookup/fixtures";
import { aligned } from "../view/fixtures";
import { drawBars, rectValues } from "../render/bar-render";
import { run } from "./n4-pipeline";

const bench = "../../../../bench/src";
interface Fixture {
  x: Float64Array;
  ys: Float64Array[];
  names: string[];
}
const { cartesianFixture } = (await import(/* @vite-ignore */ `${bench}/fixtures.js`)) as {
  cartesianFixture(): Fixture;
};
const { cartesianOptions } = (await import(/* @vite-ignore */ `${bench}/cartesian.js`)) as {
  cartesianOptions(f: Fixture, line: object): Record<string, unknown>;
};
const { checkBarRectangles } = (await import(/* @vite-ignore */ `${bench}/admission.js`)) as {
  checkBarRectangles(
    x: Float64Array,
    values: Float64Array,
    rects: number[],
    plot: object,
    domain: readonly number[],
    window: number[],
    label: string,
    right: readonly number[],
  ): string[];
};

it("admits the 100k order series read from rendered SVG attributes against the committed axes", () => {
  const fix = cartesianFixture(),
    columns: Record<string, Float64Array> = { t: fix.x };
  fix.names.forEach((key, i) => {
    columns[key] = fix.ys[i]!;
  });
  const options = cartesianOptions(fix, {
    title: "Benchmark",
    data: { columns },
    x: { field: "t", type: "time", timeZone: "UTC" },
  });
  const chart = run(options, { width: 800, height: 400 });
  if (chart.layout.kind !== "plot" || chart.layout.projection.kind !== "xy")
    throw new Error("expected xy plot");
  const { projection, plot } = chart.layout;
  if (projection.x.type === "band") throw new Error("expected time scale");
  const right = projection.yAxes![1]!;
  const boxes = drawBars()(chart.scene)[0]!.children;
  // Every integer column from the first left edge through the last one occurs in the regular fixture.
  const expectedCount =
    Math.floor(Math.fround(projection.x.map(fix.x.at(-1)!) - 1)) -
    Math.floor(Math.fround(projection.x.map(fix.x[0]!) - 1)) +
    1;
  expect(boxes.length).toBe(expectedCount);
  expect(boxes.length).toBeLessThanOrEqual(2000);
  // Mount the translucent version independently so the recording DOM's array-backed
  // fragment adoption does not dominate a six-figure fixture. Cache transitions run in the SVG suite.
  const exact = drawBars()(chart.scene, "#1238")[0]!.children;
  expect(exact).toHaveLength(100_000);
  for (const mode of [boxes, exact]) {
    expect(
      checkBarRectangles(
        fix.x,
        fix.ys[1]!,
        mode.flatMap(rectValues),
        plot,
        projection.x.domain,
        [0, 99999],
        "orders",
        right.domain,
      ),
    ).toEqual([]);
  }
  expect(chart.lookup.count).toBe(100_000);
  const s = chart.frame.series.findIndex((s) => s.key === "orders");
  const mark = chart.scene.marks.find((m): m is RectMark => m.type === "rects" && m.series === s)!;
  expect(mark.xywh.length).toBe(4 * 100_000);
  const i = 50001,
    x = fix.x[i]!;
  const ref = { kind: "aligned", seriesKey: "orders", x } as const;
  const y = right.map(fix.ys[1]![i]!);
  const box = {
    x: Math.fround(projection.x.map(x) - 1),
    y: Math.fround(y),
    width: 2,
    height: Math.fround(right.map(0) - y),
  };
  expect(chart.lookup.anchor(ref)).toEqual(box);
  const target = chart.lookup.pick(projection.x.map(x), right.map(0) - 1);
  expect(target).toEqual({ kind: "x", x });
  const value = chart.formatters.value(s, fix.ys[1]![i]!);
  expect(chart.lookup.tooltip(target!).rows.find((row) => row.seriesIndex === s)?.value).toBe(
    value,
  );
  expect(chart.lookup.step(ref, "next")).toEqual({ ...ref, x: fix.x[i + 1] });
  expect(chart.reader.table!.rowCount).toBe(100_000);
  expect(chart.reader.table!.row(i)).toContain(value);
  expect(Array.from(mark.xywh.subarray(i * 4, i * 4 + 4))).toEqual([
    box.x,
    box.y,
    box.width,
    box.height,
  ]);
});

const count = 4098;
const x = Float64Array.from({ length: count }, (_, i) => i);
const a = x.map((i) => (i % 2 ? 10 : -20));
const b = x.map((i) => (i % 3 === 0 ? NaN : i % 3 === 1 ? -4 : 3));

it("preserves both components of a dense signed, incomplete Cartesian stack in a pinned zoom", () => {
  const chart = run(
    {
      title: "Stack",
      data: { columns: { x, a, b } },
      x: { field: "x", type: "linear" },
      axes: { v: { position: "left", domain: [-21, 12] } },
      layers: [{ type: "bar", y: ["a", "b"], yAxis: "v", stacked: true }],
    },
    { zoom: [4, count - 2] },
  );
  if (chart.layout.kind !== "plot" || chart.layout.projection.kind !== "xy")
    throw new Error("expected xy plot");
  const scale = chart.layout.projection.y;
  const { start, end } = chart.view.visibleSlots;
  expect(end - start).toBeGreaterThan(2048);
  const groups = drawBars()(chart.scene);
  expect(groups[1]!.children.length).toBeGreaterThan(2048);
  expect(groups.map((g) => g.children.length)).toEqual([
    end - start,
    b.slice(start, end).filter(Number.isFinite).length,
  ]);
  const i = 8,
    spec = chart.frame.series[1]!;
  const ref = { kind: "aligned", seriesKey: spec.key, x: i } as const;
  const box = chart.lookup.anchor(ref)!;
  expect(box.height).toBe(Math.fround(Math.abs(scale.map(3) - scale.map(0))));
  expect(box.y).toBe(Math.fround(scale.map(3)));
  const k = b.slice(start, i).filter(Number.isFinite).length;
  expect(rectValues(groups[1]!.children[k]!)).toEqual(
    [box.x, box.y, box.width, box.height].map((v) => Math.round(v * 100) / 100),
  );
});

it.each([0.1, 1e-12, 0])(
  "keeps the exact one-pixel minimum at a value of %s near zero",
  (small) => {
    const chart = run({
      title: "Small values",
      data: { columns: { x, a: x.map((i) => (i % 2 ? small : 50)) } },
      x: { field: "x", type: "linear" },
      axes: { v: { position: "left", domain: [0, 100] } },
      layers: [{ type: "bar", y: "a", yAxis: "v" }],
    });
    if (chart.layout.kind !== "plot" || chart.layout.projection.kind !== "xy")
      throw new Error("expected xy plot");
    const y = chart.layout.projection.y;
    const bar = chart.lookup.anchor({ kind: "aligned", seriesKey: "a", x: 1 })!;
    expect(bar.height).toBe(1);
    expect(bar.y).toBe(Math.fround(y.map(small)));
    expect(bar.y + bar.height).toBeGreaterThan(y.map(0));
    expect(drawBars()(chart.scene)[0]!.children).toHaveLength(count);
  },
);

it("keeps every box in a dense boxplot even when the lower quartile is constant", () => {
  const chart = run({
    title: "Spread",
    data: {
      columns: {
        x,
        low: x.map(() => 0),
        q1: x.map(() => 2),
        mid: x.map(() => 4),
        q3: x.map((i) => 6 + (i % 3)),
        high: x.map(() => 10),
      },
    },
    x: { field: "x", type: "linear" },
    axes: { v: { position: "left" } },
    layers: [
      { type: "boxplot", min: "low", q1: "q1", median: "mid", q3: "q3", max: "high", yAxis: "v" },
    ],
  });
  expect(drawBars()(chart.scene)[0]!.children).toHaveLength(count);
});

function root(count: number, horizontal = false, stacked = false) {
  const x = Float64Array.from({ length: count }, (_, i) => i);
  const a = x.map((i) => (i % 2 ? 3 : -5)),
    b = x.map((i) => (i % 3) - 1);
  const { view } = aligned(
    {
      data: { columns: { x, a, b } },
      x: { field: "x", type: "linear" },
      y: stacked ? ["a", "b"] : "a",
    },
    { kind: "bar", horizontal, stacked, valueDomain: [-10, 10] },
  );
  if (view.kind !== "bar") throw new Error("expected root bar view");
  const band = linearScale(view.xDomain, horizontal ? [400, 0] : [0, 800]);
  const value = linearScale(view.yDomain, horizontal ? [0, 800] : [400, 0]);
  return barScene(view, layout({ kind: "bands", band, value, horizontal }, 800, 400), 1);
}

it("reduces the dense root bar scene while horizontal and stacked root bars retain their slots", () => {
  const opaque = drawBars()(root(100_000))[0]!.children;
  // Half a source slot pads each end of the 800 px range. A 1 px bar starts
  // half a pixel before its centre, and both signs occur in every occupied column.
  const first = Math.floor(400 / 100_000 - 0.5);
  const last = Math.floor(800 - 400 / 100_000 - 0.5);
  const wanted = Array.from({ length: last - first + 1 }, (_, i) => [
    [first + i, 140, 1, 60],
    [first + i, 200, 1, 100],
  ]).flat();
  expect(opaque.map(rectValues)).toEqual(wanted);
  expect(opaque.length).toBeLessThanOrEqual(2000);
  for (const scene of [root(count, true), root(count, false, true)]) {
    const expected = scene.marks.filter(
      (m): m is RectMark => m.type === "rects" && m.variant === "bar",
    );
    const groups = drawBars()(scene);
    expected.forEach((m, i) => {
      expect(groups[i]!.children).toHaveLength(m.xywh.length / 4);
      expect(rectValues(groups[i]!.children[1]!)).toEqual(
        Array.from(m.xywh.subarray(4, 8), (v) => Math.round(v * 100) / 100),
      );
    });
  }
});

it("stops measuring after a nonzero gap reaches the lower clamp and respects the visible range", () => {
  let calls = 0;
  const scale = {
    ...linearScale([0, 500], [500, 0]),
    map(v: number) {
      calls++;
      return 500 - v;
    },
  };
  expect(slotBandwidth(scale, Float64Array.of(0, 0, 0, 1, 15, 80, 200), 0, 7, 500)).toBe(2);
  expect(calls).toBe(4);
  expect(slotBandwidth(scale, Float64Array.of(0, 0, 0, 1, 15, 80, 200), 4, 7, 500)).toBe(65 * 0.72);
  expect(slotBandwidth(scale, Float64Array.of(2, 2, 2), 0, 3, 60)).toBe(20 * 0.72);
  const band = bandScale(12, [0, 300], 0.1);
  expect(slotBandwidth(band, x, 0, 12, 300)).toBe(band.bandwidth);
});
