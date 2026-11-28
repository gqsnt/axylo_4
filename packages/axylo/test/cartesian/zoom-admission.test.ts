// The adapter's actual two-axis fixture and zoom sequence, with the Node stage
// pipeline and the recording SVG renderer. Browser task and frame time need Chrome.
import { expect, it } from "vitest";
import { buildCartesianScene } from "../../src/cartesian/scene";
import { buildCartesianView } from "../../src/cartesian/view";
import { createCartesianLookup } from "../../src/cartesian/lookup";
import { defaultMessages } from "../../src/messages";
import { pathData } from "../../src/render/svg";
import { drawBars, rectValues } from "../render/bar-render";
import { prepare, measurer, style } from "./n4-pipeline";

type Span = readonly [number, number];
interface Fixture {
  x: Float64Array;
  ys: Float64Array[];
  names: string[];
}
const bench = "../../../../bench/src";
const fixtures = (await import(/* @vite-ignore */ `${bench}/fixtures.js`)) as {
  cartesianFixture(options: { points: number; seed: number }): Fixture;
  zoomSteps(fix: Fixture): Span[];
  expectedView(fix: Fixture, zoom: Span | null): { window: Span; seriesY: Span[] };
};
const { cartesianOptions } = (await import(/* @vite-ignore */ `${bench}/cartesian.js`)) as {
  cartesianOptions(fix: Fixture, options: object): Record<string, unknown>;
};
const { checkDrawnPixels, checkBarRectangles } = (await import(
  /* @vite-ignore */ `${bench}/admission.js`
)) as {
  checkDrawnPixels(
    x: Float64Array,
    values: Float64Array,
    pixels: object,
    xd: Span,
    yd: Span,
    expected: object,
    label: string,
  ): string[];
  checkBarRectangles(
    x: Float64Array,
    values: Float64Array,
    rects: number[],
    plot: object,
    xd: Span,
    window: Span,
    label: string,
    yd: Span,
  ): string[];
};
const { parsePolylines } = (await import(
  /* @vite-ignore */ `${bench}/adapters/axylo-common.js`
)) as {
  parsePolylines(path: string): number[][] | null;
};

for (const points of [100_000, 1_000_000]) {
  it(`admits the recorded line and bar geometry after ${points === 100_000 ? "mount" : "60 zoom steps"} on ${points} rows`, () => {
    const fix = fixtures.cartesianFixture({ points, seed: 1 });
    const steps = points === 100_000 ? [null] : fixtures.zoomSteps(fix);
    const columns: Record<string, Float64Array> = { t: fix.x };
    fix.names.forEach((name, i) => {
      columns[name] = fix.ys[i]!;
    });
    const options = cartesianOptions(fix, {
      title: "Benchmark",
      data: { columns },
      x: { field: "t", type: "time", timeZone: "UTC" },
    });
    const start = performance.now();
    const { frame, stateRef, sink, ctx, layoutStage, formatters, view: initial } = prepare(options);
    const render = drawBars(),
      hidden = new Set<string>();
    let view = initial;
    const zoomStart = performance.now();
    for (const zoom of steps) {
      if (zoom)
        view = buildCartesianView(
          stateRef,
          frame,
          { kind: "line", hidden, zoom, xField: ctx.resolved.x, previous: view },
          sink,
        );
      const layout = layoutStage.compute(
        view,
        { width: 800, height: 400 },
        { measurer, style },
        ctx,
      );
      const scene = buildCartesianScene(stateRef, view, layout, 1);
      const lookup = createCartesianLookup(stateRef, view, layout, formatters, defaultMessages);
      const groups = render(scene);
      if (zoom !== steps.at(-1)) continue;
      const elapsed = performance.now() - (zoom ? zoomStart : start);
      if (process.env.AXYLO_NODE_TIMING)
        console.info(
          `Cartesian Node ${points} rows, ${steps.length} steps: ${(elapsed / steps.length).toFixed(3)} ms/step`,
        );
      if (
        layout.kind !== "plot" ||
        layout.projection.kind !== "xy" ||
        layout.projection.x.type === "band"
      )
        throw new Error("expected continuous xy plot");
      const { projection, plot } = layout,
        xd = layout.projection.x.domain;
      const expected = fixtures.expectedView(fix, zoom);
      expect(lookup.count).toBe(expected.window[1] - expected.window[0] + 1);
      const path = scene.marks.find(
        (m) => m.type === "path" && frame.series[m.series]?.key === fix.names[0],
      );
      if (path?.type !== "path") throw new Error("expected the price line");
      const strokes = [{ polylines: parsePolylines(pathData(path.xy)) }];
      expect(
        checkDrawnPixels(
          fix.x,
          fix.ys[0]!,
          { plot, strokes },
          xd,
          projection.y.domain,
          { window: expected.window, seriesY: expected.seriesY[0] },
          "line",
        ),
      ).toEqual([]);
      const rects = groups[0]!.children.flatMap(rectValues);
      expect(
        checkBarRectangles(
          fix.x,
          fix.ys[1]!,
          rects,
          plot,
          xd,
          expected.window,
          "orders",
          projection.yAxes![1]!.domain,
        ),
      ).toEqual([]);
    }
  });
}
