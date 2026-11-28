import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { RectMark, Scene } from "../../src/core/contracts";
import { aggregateOhlcv } from "../../src/finance/aggregate";
import { DOWN_PAINT, VOLUME_PAINT, financeSvgMarks } from "../../src/finance/render";
import { svgRects, svgRendererWith } from "../../src/render/svg";
import { TOKEN_BINDINGS } from "../../src/theme";
import { AXYLO_CSS } from "../../src/theme/css";
import { FakeElement, baseOptions, fakeDocument, rectsOf, stage, type Staged } from "./fixtures";

const bindings = {
  tokens: TOKEN_BINDINGS,
  series: ["red", "rgba(20,30,40,0.3)", "rgba(40,30,20,0.5)"],
};
const theme = {
  scheme: "light",
  moreContrast: false,
  forcedColors: false,
  paints: bindings,
} as const;
const size = { width: 960, height: 480 };

function candles(n: number, x = (i: number) => i) {
  return baseOptions({
    x: { field: "x", type: "number" },
    yAxis: { domain: [95, 115] },
    data: Array.from({ length: n }, (_, i) => ({
      x: x(i),
      o: 105,
      h: 112,
      l: 98,
      c: i === 0 ? 105 : i % 6 === 0 ? 110 : 101,
      v: 6,
    })),
  });
}

const renderer = () => svgRendererWith(financeSvgMarks, fakeDocument());
const elements = (r: ReturnType<typeof renderer>) => (r.element as unknown as FakeElement).all();
const painted = (r: ReturnType<typeof renderer>, name: string) =>
  elements(r).find((n) => n.style.getPropertyValue("color").includes("--axylo-" + name + ","))!;

function clip(r: ReturnType<typeof renderer>, staged: Staged, pane: "price" | "volume") {
  const el = elements(r).find(
    (n) =>
      n.tagName === "clipPath" && n.getAttribute("id")?.startsWith("axylo-finance-" + pane + "-"),
  )!;
  const box = staged.panes[pane]!;
  expect(el.getAttribute("clipPathUnits")).toBe("userSpaceOnUse");
  expect(
    ["x", "y", "width", "height"].map((key) => Number(el.children[0]!.getAttribute(key))),
  ).toEqual([box.x, box.y, box.width, box.height]);
  return "url(#" + el.getAttribute("id") + ")";
}

// The shared rectangle renderer is the reference for independently rounded SVG position and dimensions.
function originalBoxes(scene: Scene, mark: RectMark) {
  const reference = svgRendererWith({ rects: svgRects }, fakeDocument());
  reference.draw({ ...scene, marks: [mark] }, bindings, theme, 1);
  const group = elements(reference).find(
    (n) => n.tagName === "g" && n.style.getPropertyValue("color") === bindings.series[mark.series],
  )!;
  return group.children.map((rect) => {
    const [x, y, w, h] = ["x", "y", "width", "height"].map((key) => rect.getAttribute(key)!);
    return {
      path: `M${x} ${y}h${w}v${h}h-${w}z`,
      x: Math.round(Number(x) * 100),
      w: Math.round(Number(w) * 100),
    };
  });
}

function checkPaths(group: FakeElement, scene: Scene, mark: RectMark) {
  const boxes = originalBoxes(scene, mark);
  expect(group.children.map((el) => el.tagName)).toEqual(group.children.map(() => "path"));
  // Every rectangle is visited, in source order, and overlapping x intervals get separate paint operations.
  let seen = 0;
  for (const path of group.children) {
    const commands = path.getAttribute("d")!.match(/M[^M]+/g)!;
    expect(commands).toEqual(boxes.slice(seen, seen + commands.length).map((b) => b.path));
    let right = -Infinity;
    for (const b of boxes.slice(seen, seen + commands.length)) {
      expect(b.x).toBeGreaterThanOrEqual(right);
      right = b.x + b.w;
    }
    seen += commands.length;
  }
  expect(seen).toBe(boxes.length);
}

describe("finance SVG rectangle batching", () => {
  it.each([180, 10_000])(
    "draws the same solid bars, hollow bodies and doji tick with %i source rows",
    (n) => {
      const s = stage(candles(n), size);
      expect(s.panes.bins !== null).toBe(n === 10_000);
      const r = renderer();
      r.draw(s.scene, bindings, { ...theme, forcedColors: true, moreContrast: true }, 1);
      const price = clip(r, s, "price"),
        volume = clip(r, s, "volume");
      for (const [name, series, url] of [
        ["down", DOWN_PAINT, price],
        ["volume", VOLUME_PAINT, volume],
      ] as const) {
        const group = painted(r, name);
        expect(group.children).toHaveLength(1);
        expect(group.getAttribute("clip-path")).toBe(url);
        expect(group.style.getPropertyValue("color")).toBe(
          `var(--axylo-forced-series, var(--axylo-${name}, ${bindings.series[series]}))`,
        );
        expect(group.style.getPropertyValue("fill")).toBe("currentColor");
        expect(group.style.getPropertyValue("stroke")).toBe("none");
        const mark = rectsOf(s.scene, series)!;
        expect(mark.variant).toBe("bar");
        checkPaths(group, s.scene, mark);
      }
      const up = painted(r, "up");
      expect(up.getAttribute("clip-path")).toBe(price);
      expect(up.style.getPropertyValue("color")).toBe(
        "var(--axylo-forced-series, var(--axylo-up, red))",
      );
      expect(up.style.getPropertyValue("fill")).toBe("none");
      expect(up.style.getPropertyValue("stroke")).toBe("currentColor");
      expect(elements(r).length).toBeLessThanOrEqual(30);
      const forced = AXYLO_CSS.indexOf("@media (forced-colors: active)");
      expect(forced).toBeGreaterThanOrEqual(0);
      expect(AXYLO_CSS.slice(forced)).toContain("--axylo-forced-series: CanvasText !important;");
      if (n === 180) {
        if (s.layout.kind !== "plot" || s.layout.projection.kind !== "xy")
          throw new Error("expected price projection");
        const { x, y } = s.layout.projection;
        const round = (v: number) => Math.round(Math.fround(v) * 100) / 100;
        const half = ((x.map(1) - x.map(0)) * 0.65) / 2;
        const cy = round(y.map(105));
        const wick = elements(r).find((el) => el.getAttribute("stroke-width") === "1.25")!;
        expect(wick.getAttribute("clip-path")).toBe(price);
        expect(wick.getAttribute("d")).toContain(
          `M${round(x.map(0) - half)} ${cy}L${round(x.map(0) + half)} ${cy}`,
        );
      }
    },
  );

  it("keeps small bars and reuses one slot through size, geometry, pane and binding changes", () => {
    const small = stage(candles(60), size),
      large = stage(candles(180), size);
    const r = renderer();
    let slot: FakeElement | undefined;
    for (const [s, series] of [
      [small, VOLUME_PAINT],
      [large, DOWN_PAINT],
      [large, VOLUME_PAINT],
      [small, DOWN_PAINT],
      [large, DOWN_PAINT],
    ] as const) {
      const mark = rectsOf(s.scene, series)!;
      const scene = { ...s.scene, marks: [mark] };
      r.draw(scene, bindings, theme, 1);
      const name = series === DOWN_PAINT ? "down" : "volume";
      const group = painted(r, name);
      if (slot) expect(group).toBe(slot);
      slot = group;
      expect(group.getAttribute("clip-path")).toBe(
        clip(r, s, series === DOWN_PAINT ? "price" : "volume"),
      );
      if (s === small) {
        expect(group.children).toHaveLength(mark.xywh.length / 4);
        expect(group.children.every((el) => el.tagName === "rect")).toBe(true);
      } else {
        expect(group.children).toHaveLength(1);
        checkPaths(group, scene, mark);
      }
      const child = group.children[0];
      const changed = { ...bindings, series: ["blue", "black", "gray"] };
      r.draw(scene, changed, theme, 1);
      expect(group.children[0]).toBe(child);
      expect(group.style.getPropertyValue("color")).toBe(
        `var(--axylo-forced-series, var(--axylo-${name}, ${changed.series[series]}))`,
      );
    }
  });

  it("preserves alpha for the shortened final dense column", () => {
    const input = candles(4000);
    const width = stage(input, size).panes.price.width;
    const s = stage(input, { ...size, width: size.width - (width % 2) + 0.25 });
    // The last bin's center is the edge, only 1.25 px beyond the preceding center; the bodies are 1.5 px.
    const bars = rectsOf(s.scene, VOLUME_PAINT)!;
    const q = bars.xywh;
    expect(q.at(-4)! - q.at(-8)!).toBeCloseTo(1.25, 4);
    const r = renderer();
    r.draw(s.scene, bindings, theme, 1);
    const group = painted(r, "volume");
    expect(group.children).toHaveLength(2);
    checkPaths(group, s.scene, bars);
    expect(elements(r).length).toBeLessThanOrEqual(30);
  });

  it("preserves alpha where sparse candles reach their minimum width", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (step) => {
        const s = stage(
          candles(100, (i) => (i === 2 ? 1 + step / 100 : i)),
          size,
        );
        expect(s.panes.bins).toBeNull();
        const bars = rectsOf(s.scene, VOLUME_PAINT)!;
        expect(bars.xywh[2]).toBe(2);
        expect(bars.xywh[8]! - bars.xywh[4]!).toBeLessThan(2);
        const r = renderer();
        r.draw(s.scene, bindings, theme, 1);
        for (const [name, series] of [
          ["volume", VOLUME_PAINT],
          ["down", DOWN_PAINT],
        ] as const) {
          const group = painted(r, name);
          expect(group.children).toHaveLength(2);
          checkPaths(group, s.scene, rectsOf(s.scene, series)!);
        }
      }),
      { numRuns: 12 },
    );
  });
});

it("keeps the original bin endpoints across non-finite projections, omitted slots and volume-only slots", () => {
  const values = [10, 20, 30, 40, 50, 60, 70, 80, 90];
  const x = [NaN, -1, NaN, 1, 1, 2, 3, 4, Infinity];
  const bins = aggregateOhlcv(
    {
      open: values,
      close: values,
      high: values,
      low: values,
      volume: values,
      x: (i) => x[i]!,
      candle: (i) => i === 1 || i === 4,
      drawableVolume: (i) => i === 3 || i === 7,
    },
    0,
    9,
    0,
    6,
  );
  expect(bins.count).toBe(2);
  expect(Array.from(bins.first.slice(0, 2))).toEqual([1, 7]);
  expect(Array.from(bins.last.slice(0, 2))).toEqual([4, 7]);
  expect(Array.from(bins.center.slice(0, 2))).toEqual([1, 5]);
  expect(Array.from(bins.candles.slice(0, 2))).toEqual([2, 0]);
  expect([bins.open[0], bins.high[0], bins.low[0], bins.close[0], bins.volume[0]]).toEqual([
    20, 50, 20, 50, 40,
  ]);
  expect([bins.open[1], bins.high[1], bins.low[1], bins.close[1], bins.volume[1]]).toEqual([
    NaN,
    -Infinity,
    Infinity,
    NaN,
    80,
  ]);
});
