/**
 * Gate G2 adversarial regression suite for the Axylo 4 speed campaign (C1–C7).
 *
 * Probes subtle correctness, parity, accessibility, and lifecycle edge cases across
 * every optimization cycle using independent spec/analytic oracles and seeded properties.
 */
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { computeAxisDomain } from "../src/cartesian/axes";
import { keep } from "../src/cartesian/dense";
import { controllerFor, type Controller } from "../src/core/controller";
import {
  SLOT_GAP,
  SLOT_INVALID,
  SLOT_NO_ROW,
  SLOT_NULL,
  SLOT_VALUE,
  type MarkerShape,
  type PaintBindings,
  type Rect,
  type RectMark,
  type Scene,
  type Series,
} from "../src/core/contracts";
import {
  LanguageWatch,
  createMeasurer,
  measurementCacheSize,
  noteFontLoad,
  pageLanguage,
  subscribeTreeMutations,
} from "../src/core/environment";
import { resolveOptions } from "../src/data/options";
import {
  denseSeries,
  fullStatistics,
  seriesSlots,
  withSignedZeros,
} from "../src/data/store-statistics";
import { columnsTable, rowsTable, type Table } from "../src/data/table";
import { DiagnosticCollector } from "../src/diagnostics/collector";
import { createFigure, type FigureModel } from "../src/dom/figure";
import {
  DOWN_PAINT,
  UP_PAINT,
  VOLUME_PAINT,
  financeSvgMarks,
  hollowStroke,
} from "../src/finance/render";
import { computeLayout, type LayoutInput } from "../src/layout";
import { scatterGrid } from "../src/lookup/scatter-grid";
import { createSvgRenderer, svgRects, svgRendererWith } from "../src/render/svg";
import { bandScale, linearScale, timeScale } from "../src/scale";
import { valueDomain } from "../src/scale/domain";
import { niceLogDomain } from "../src/scale/log";
import { scatterPoints } from "../src/scene/lines";
import { openBubbleChart } from "../src/spatial/bubble";
import { svgBubbles, type BubbleMark } from "../src/spatial/bubble/composition";
import { GAP, paintedMap } from "../src/spatial/bubble/paint";
import { matrixOf, NO_BIN, normalizeHeatmap, parseHeatmapInput } from "../src/spatial/heatmap/core";
import { buildHeatmapScene, cellPath, cellTagOf, hatchPath } from "../src/spatial/heatmap/render";
import { TOKEN_BINDINGS } from "../src/theme";
import { LIGHT } from "../src/theme/palette";
import { applyTheme, createThemeBatch, finalizeTheme, prepareTheme } from "../src/theme/resolve";
import { alignedStatistics } from "../src/view";
import { prepare, run as runCartesian } from "./cartesian/n4-pipeline";
import { lastModel, record } from "./core/host";
import { TestDocument, TestElement } from "./core/n3-dom";
import { aligned as normalizeAligned } from "./data/helpers";
import {
  FakeElement,
  baseOptions as financeBaseOptions,
  fakeDocument,
  rectsOf as financeRectsOf,
  stage as stageFinance,
  type Staged as StagedFinance,
} from "./finance/fixtures";
import { record as recordFinance } from "./finance/host";
import {
  frame as lookupFrame,
  plot as lookupPlot,
  scatter as scatterView,
} from "./lookup/fixtures";
import { barScene, drawBars, rectValues } from "./render/bar-render";
import { expectedOwner, flatten, geometryOf, winding, type Disc } from "./spatial/bubble/oracle";
import {
  grid as heatmapGrid,
  stage as stageHeatmap,
  type GridValue,
} from "./spatial/heatmap/fixtures";

// ───────────────────────────── C1: Spatial Bubble ─────────────────────────────

describe("C1: bubble occlusion, composition, winding, hover, keyboard and table", () => {
  it("keeps disjoint planar paths for opaque and translucent paints and full circles for focus/halo overlays", () => {
    const discs: Disc[] = [];
    // >64 discs activates coveredShapes culling; large discs sit below a canopy of smaller discs.
    for (let y = 16; y <= 88; y += 12) {
      for (let x = 16; x <= 88; x += 12) {
        discs.push({ x, y, r: 16, series: 0, row: discs.length });
      }
    }
    for (let y = 24; y <= 80; y += 8) {
      for (let x = 24; x <= 80; x += 8) {
        // Grid indices (not raw coordinates, which all step by 8) so both canopy series are populated.
        discs.push({
          x,
          y,
          r: 5,
          series: 1 + (((x - 24) / 8 + (y - 24) / 8) % 2),
          row: discs.length,
        });
      }
    }
    const g = geometryOf(discs, 120, 120);
    const map = paintedMap(g, 3);
    expect(map.culled).toBeGreaterThan(0);
    expect(map.series.every((s) => s.open === 0)).toBe(true);

    const marks: BubbleMark[] = [0, 1, 2].map((series) => ({
      type: "points",
      series,
      xy: new Float32Array(0),
      shape: "circle",
      size: 0,
      fill: { kind: "series", index: series },
      bubble: { geometry: g, members: new Uint32Array(0), paint: "series", seriesCount: 3 },
    }));
    // Add focus + halo overlay for a buried large disc (index 0).
    marks.push(
      {
        type: "points",
        series: 0,
        xy: new Float32Array(0),
        shape: "circle",
        size: 0,
        fill: { kind: "series", index: 0 },
        bubble: { geometry: g, members: Uint32Array.of(0), paint: "focus", seriesCount: 3 },
      },
      {
        type: "points",
        series: 0,
        xy: new Float32Array(0),
        shape: "circle",
        size: 0,
        fill: { kind: "token", name: "text" },
        bubble: { geometry: g, members: Uint32Array.of(0), paint: "halo", seriesCount: 3 },
      },
    );

    const doc = fakeDocument();
    const renderer = svgRendererWith({ points: svgBubbles }, doc);
    const scene: Scene = {
      width: 120,
      height: 120,
      clip: { x: 0, y: 0, width: 120, height: 120 },
      marks,
    };

    const opaque: PaintBindings = {
      tokens: TOKEN_BINDINGS,
      series: ["rgb(20, 90, 180)", "rgb(180, 60, 40)", "rgb(30, 140, 80)"],
    };
    const translucent: PaintBindings = {
      tokens: TOKEN_BINDINGS,
      series: ["rgba(20, 90, 180, 0.5)", "rgba(180, 60, 40, 0.45)", "rgba(30, 140, 80, 0.5)"],
    };

    const drawWith = (bindings: PaintBindings) => {
      renderer.draw(
        scene,
        bindings,
        { paints: bindings, scheme: "light", moreContrast: false, forcedColors: false },
        1,
      );
      return (renderer.element as unknown as FakeElement)
        .all()
        .filter((el) => el.tagName === "path" && el.getAttribute("data-bubble") !== null);
    };

    expect(new Set(discs.map((d) => d.series)).size).toBe(3);
    // Pooled nodes are reused across draws, so snapshot opaque strings before repainting.
    const opaquePaths = drawWith(opaque);
    const opaqueD = opaquePaths.map((p) => p.getAttribute("d"));
    const opaqueColors = opaquePaths.slice(0, 3).map((p) => p.style.getPropertyValue("color"));
    expect(opaqueColors).toEqual(opaque.series);
    const translucentPaths = drawWith(translucent);
    expect(opaquePaths).toHaveLength(5);
    expect(translucentPaths.map((p) => p.getAttribute("d"))).toEqual(opaqueD);
    for (let s = 0; s < 3; s++) {
      expect(translucentPaths[s]!.style.getPropertyValue("color")).toBe(translucent.series[s]);
      expect(translucentPaths[s]!.style.getPropertyValue("fill")).toBe("currentColor");
    }
    expect(translucentPaths[0]!.style.getPropertyValue("color")).toBe("rgba(20, 90, 180, 0.5)");
    expect(translucentPaths[0]!.style.getPropertyValue("fill")).toBe("currentColor");
    expect(translucentPaths[0]!.style.getPropertyValue("fill-rule")).toBe("nonzero");
    expect(translucentPaths[3]!.getAttribute("data-bubble")).toBe("focus");
    expect(translucentPaths[3]!.getAttribute("d")).toContain("a16 16");
    expect(translucentPaths[4]!.getAttribute("data-bubble")).toBe("halo");
    expect(translucentPaths[4]!.style.getPropertyValue("fill")).toBe("none");
    expect(translucentPaths[4]!.getAttribute("d")).toContain("a18 18");

    // Mutually disjoint coverage: no sample point belongs to more than one series path (no double blending).
    // Ownership is checked independently on the snapshotted opaque strings and on the translucent repaint.
    const ownedCounts = [0, 0, 0];
    for (const flat of [
      opaqueD.slice(0, 3).map((d) => flatten(d!)),
      translucentPaths.slice(0, 3).map((p) => flatten(p.getAttribute("d")!)),
    ])
      for (let y = 10.3; y <= 100; y += 7.4) {
        for (let x = 10.7; x <= 100; x += 7.4) {
          const owner = expectedOwner(discs, g, x, y, 0.08);
          if (owner === null) continue;
          const inside = flat.map((seg) => winding(seg, x, y) !== 0);
          const hits = inside.filter(Boolean).length;
          expect(hits, `overlap at (${x}, ${y})`).toBeLessThanOrEqual(1);
          expect(inside, `owner at (${x}, ${y})`).toEqual([0, 1, 2].map((s) => s === owner));
          ownedCounts[owner]!++;
        }
      }
    expect(
      ownedCounts.every((n) => n > 0),
      `owned samples ${ownedCounts}`,
    ).toBe(true);
  });

  it("matches analytic painter coverage on concentric, zero-ring, external/internal tangent and buried overlaps", () => {
    // 1. Pure concentric fast path with zero-size hollow ring exposing a smaller inner disc inside its hole.
    const concentric: Disc[] = [
      { x: 60, y: 60, r: 16, series: 0, row: 0 },
      { x: 60, y: 60, r: 9, series: 1, row: 1 },
      { x: 60, y: 60, r: 1.2, series: 2, row: 2 },
      { x: 60, y: 60, r: 0, series: 0, row: 3 },
    ];
    const cg = geometryOf(concentric, 120, 120);
    const cmap = paintedMap(cg, 3);
    expect(cmap.pairs).toBe(0);
    expect(cmap.series.every((s) => s.open === 0)).toBe(true);
    const cflat = cmap.series.map((s) => flatten(s.d));
    // Radial probes across: inner disc (<1.2), inner disc gap (1.2..1.5), ring inner gap (1.5..2.5),
    // ring body (2.5..3.5), ring outer gap (3.5..4.5), middle disc (4.5..9), middle gap (9..10), outer disc (10..16), outside (>16).
    for (const rad of [0.5, 1.35, 2.0, 3.0, 4.0, 6.5, 9.5, 13.0, 18.0]) {
      const px = 60 + rad,
        py = 60;
      const owner = expectedOwner(concentric, cg, px, py, 0.05);
      expect(owner).not.toBeNull();
      expect(
        cflat.map((p) => winding(p, px, py) !== 0),
        `radial ${rad}`,
      ).toEqual([0, 1, 2].map((s) => s === owner));
    }

    // 2. General dense >64-disc configuration with external tangency, internal tangency, zero ring & buried discs.
    const mixed: Disc[] = [];
    for (let y = 12; y <= 76; y += 8) {
      for (let x = 12; x <= 76; x += 8) {
        mixed.push({ x, y, r: 11, series: (x + y) % 3, row: mixed.length });
      }
    }
    // External tangency (outer edges touch at d = r1 + r2 + GAP) and internal tangency (d = r1 - r2).
    mixed.push(
      { x: 120, y: 50, r: 14, series: 0, row: mixed.length },
      { x: 120 + 14 + 6 + GAP, y: 50, r: 6, series: 1, row: mixed.length + 1 },
      { x: 120 + 14 - 5, y: 50, r: 5, series: 2, row: mixed.length + 2 },
      { x: 120, y: 50, r: 0, series: 1, row: mixed.length + 3 },
      // Canopy over interior of the grid so some r=11 discs are completely buried.
      { x: 44, y: 44, r: 5, series: 2, row: mixed.length + 4 },
      { x: 44, y: 44, r: 18, series: 0, row: mixed.length + 5 },
    );
    // Add a sub-pixel positive disc (<1 px) to also exercise coveredShapes with pruneBuried disabled.
    mixed.push({ x: 12, y: 12, r: 0.4, series: 2, row: mixed.length });
    const mg = geometryOf(mixed, 180, 120);
    const mmap = paintedMap(mg, 3);
    expect(mmap.series.every((s) => s.open === 0)).toBe(true);
    const mflat = mmap.series.map((s) => flatten(s.d));
    const probes: readonly [number, number][] = [
      [120, 50],
      [122.7, 50],
      [127, 50],
      [130, 50],
      [136, 50],
      [142, 50],
      [44, 44],
      [30.3, 30.3],
      [58.2, 58.2],
      [12.15, 12.15],
    ];
    for (const [px, py] of probes) {
      const owner = expectedOwner(mixed, mg, px, py, 0.05);
      expect(owner, `clearance (${px}, ${py})`).not.toBeNull();
      expect(
        mflat.map((p) => winding(p, px, py) !== 0),
        `(${px}, ${py})`,
      ).toEqual([0, 1, 2].map((s) => s === owner));
    }
  });

  it("keeps exact hover, keyboard navigation and table values for buried and equal-radius bubbles", () => {
    const rows: { x: number; y: number; size: number; g: string }[] = [];
    // Buried large disc (row 0) under a dense canopy of smaller discs tightly packed around (50, 50).
    rows.push({ x: 50, y: 50, size: 400, g: "A" });
    // Two identical-position, identical-size discs: later row (row 2) must win hover pick.
    rows.push({ x: 50, y: 50, size: 16, g: "A" });
    rows.push({ x: 50, y: 50, size: 16, g: "B" });
    // Anchor domain bounds [0, 100] and pack 81 overlapping canopy discs around (50, 50) so row 0 is fully buried.
    rows.push({ x: 0, y: 0, size: 10, g: "A" });
    rows.push({ x: 100, y: 100, size: 10, g: "B" });
    for (let i = 0; i < 81; i++) {
      const gx = 42 + (i % 9) * 2;
      const gy = 42 + Math.floor(i / 9) * 2;
      rows.push({ x: gx, y: gy, size: 90 + (i % 5) * 4, g: i % 2 === 0 ? "A" : "B" });
    }
    const rec = recordFinance({ width: 720, height: 420 });
    let ctrl: Controller | null = null;
    const handle = openBubbleChart(
      { title: "Culled Bubbles", data: rows, x: "x", y: "y", size: "size", series: "g" },
      (composition, input) => {
        ctrl = controllerFor(composition, input, rec.host, null);
        return ctrl.handle;
      },
    );
    try {
      rec.frames();
      const committed = rec.committed!;
      const scene = rec.draws.at(-1)!;
      const mark = scene.marks.find((m): m is BubbleMark => m.type === "points" && "bubble" in m)!;
      expect(paintedMap(mark.bubble.geometry, 2).culled).toBeGreaterThan(0);

      // Hover at (50, 50) picks the smallest disc and resolves equal-radius tie to the later row (row 2, series B).
      const box2 = committed.lookup.anchor({ kind: "point", seriesKey: "B", row: 2, x: 50 })!;
      const picked = committed.lookup.pick(box2.x + box2.width / 2, box2.y + box2.height / 2);
      expect(picked).toEqual({
        kind: "point",
        refs: [{ kind: "point", seriesKey: "B", row: 2, x: 50 }],
        count: 1,
      });

      // Keyboard stepping visits every drawable bubble (including buried row 0) with exact datum text.
      expect(committed.lookup.count).toBe(rows.length);
      const visited = new Set<number>();
      let cursor = committed.lookup.step(null, "first");
      while (cursor !== null) {
        expect(cursor.kind).toBe("point");
        if (cursor.kind === "point") visited.add(cursor.row);
        cursor = committed.lookup.step(cursor, "next");
      }
      expect(visited.size).toBe(rows.length);
      expect(visited.has(0)).toBe(true);
      const buriedDatum = committed.lookup.datum({ kind: "point", seriesKey: "A", row: 0, x: 50 })!;
      expect(buriedDatum.value).toContain("400");

      // Table contains all rows with exact unrounded size for the buried bubble.
      const table = committed.reader.table!;
      expect(table.rowCount).toBe(rows.length);
      const allTableRows = Array.from({ length: table.rowCount }, (_, i) => table.row(i));
      expect(
        allTableRows.some(
          (cells) => cells !== null && cells.includes("400") && cells.includes("A"),
        ),
      ).toBe(true);
    } finally {
      handle.destroy();
    }
  });
});

// ───────────────────────────── C2: Dense Bar Envelopes ─────────────────────────────

describe("C2: bar envelope 2048/2049 threshold and theme/pattern transitions on reused geometry", () => {
  const zero = 180;
  function makeBars(count: number, heights: readonly number[]): Float32Array {
    const q = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const h = heights[i % heights.length]!;
      q.set([i / 8, Math.min(zero, zero - h), 1, Math.abs(h)], i * 4);
    }
    return q;
  }

  it("switches cleanly across 2048/2049 and restores exact rectangles and order on translucent or patterned transitions", () => {
    const heights = [12, -28, 45, 0, -9, 31, -40];
    const q2048 = makeBars(2048, heights);
    const q2049 = makeBars(2049, heights);
    const exactOf = (q: Float32Array) =>
      Array.from({ length: q.length / 4 }, (_, i) =>
        Array.from(q.subarray(i * 4, i * 4 + 4), (v) => Math.round(v * 100) / 100),
      );

    // 2048 stays exact even under opaque paint.
    const draw = drawBars();
    const g2048 = draw(barScene(q2048), "rgb(18, 52, 86)")[0]!;
    expect(g2048.children.map(rectValues)).toEqual(exactOf(q2048));

    // 2049 reduces on opaque rgb()/#rrggbb, but restores exact boxes on any alpha-bearing or unresolved paint.
    const scene2049 = barScene(q2049);
    const exact2049 = exactOf(q2049);
    const g = draw(scene2049, "rgb(18, 52, 86)")[0]!;
    expect(g).toBe(g2048);
    const envelope = g.children.map(rectValues);
    expect(envelope.length).toBeLessThan(2 * 260);
    expect(envelope.length).toBeGreaterThan(250);

    // rgba(..., 1) is the canvas 8-bit alpha fallback form and MUST stay exact (never treated as opaque).
    for (const nonOpaque of [
      "rgba(18, 52, 86, 0.5)",
      "rgba(18, 52, 86, 1)",
      "#12345680",
      "hsla(210, 60%, 30%, 0.5)",
    ]) {
      expect(draw(scene2049, nonOpaque)[0]).toBe(g);
      expect(g.children.map(rectValues)).toEqual(exact2049);
      expect(draw(scene2049, "#123456")[0]!.children.map(rectValues)).toEqual(envelope);
    }

    // Pattern overlays on the same Float32Array restore exact base + overlay rectangles in order, then clean up.
    for (const pattern of ["diagonal", "cross", "dots"] as const) {
      draw(barScene(q2049, pattern), "rgb(18, 52, 86)");
      expect(g.children).toHaveLength(2 * 2049);
      expect(g.children.slice(0, 2049).map(rectValues)).toEqual(exact2049);
      expect(g.children.slice(2049).map(rectValues)).toEqual(exact2049);
      expect(g.children[2049]!.style.getPropertyValue("fill")).toMatch(/^url\(#axylo-pattern-/);
      // Back to unpatterned opaque envelope clears overlay styles on reused rects.
      draw(scene2049, "rgb(18, 52, 86)");
      expect(g.children.map(rectValues)).toEqual(envelope);
      expect(g.children.every((r) => r.style.getPropertyValue("fill") === "")).toBe(true);
      expect(g.children.every((r) => r.style.getPropertyValue("color") === "")).toBe(true);
    }

    // Pattern → pattern → translucent on the same geometry: each overlay names its own pattern on every reused
    // child, and the translucent step drops the overlay and keeps exact boxes.
    const overlayFills: string[] = [];
    for (const pattern of ["diagonal", "cross", "dots"] as const) {
      draw(barScene(q2049, pattern), "rgb(18, 52, 86)");
      expect(g.children).toHaveLength(2 * 2049);
      expect(g.children.slice(0, 2049).map(rectValues)).toEqual(exact2049);
      expect(g.children.slice(2049).map(rectValues)).toEqual(exact2049);
      const fill = g.children[2049]!.style.getPropertyValue("fill");
      expect(fill).toMatch(/^url\(#axylo-pattern-/);
      expect(g.children.slice(2049).every((r) => r.style.getPropertyValue("fill") === fill)).toBe(
        true,
      );
      overlayFills.push(fill);
    }
    expect(new Set(overlayFills).size).toBe(3);
    draw(barScene(q2049, "cross"), "rgb(18, 52, 86)");
    draw(scene2049, "rgba(18, 52, 86, 0.5)");
    expect(g.children.map(rectValues)).toEqual(exact2049);
    expect(g.children.every((r) => !r.style.getPropertyValue("fill").startsWith("url("))).toBe(
      true,
    );

    // Multi-series root bar scene has no barBaselines metadata and must stay exact.
    const multiScene: Scene = {
      width: 800,
      height: 400,
      clip: { x: 0, y: 0, width: 800, height: 400 },
      marks: [
        {
          type: "rects",
          series: 0,
          variant: "bar",
          xywh: q2049,
          fill: { kind: "series", index: 0 },
        },
        {
          type: "rects",
          series: 1,
          variant: "bar",
          xywh: q2049,
          fill: { kind: "series", index: 1 },
        },
      ],
    };
    const multiDraw = drawBars();
    const groups = multiDraw(multiScene, "rgb(18, 52, 86)");
    expect(groups).toHaveLength(2);
    expect(groups[0]!.children).toHaveLength(2049);
    expect(groups[1]!.children).toHaveLength(2049);

    // Cartesian bar scene with barBaselines reduces opaque 2049 bars and restores all 2049 exact rects on translucent color.
    const cx = Float64Array.from({ length: 2049 }, (_, i) => i);
    const cy = Float64Array.from({ length: 2049 }, (_, i) => (i % 3 === 0 ? -40 : 60));
    const cart = runCartesian(
      {
        title: "Dense Cartesian Bars",
        data: { columns: { x: cx, y: cy } },
        x: { field: "x", type: "linear" },
        axes: { v: { position: "left", domain: [-100, 100] } },
        layers: [{ type: "bar", y: "y", yAxis: "v" }],
      },
      { width: 640, height: 320 },
    );
    const cartMark = cart.scene.marks.find(
      (m): m is RectMark => m.type === "rects" && m.variant === "bar",
    )!;
    const cartExact = exactOf(cartMark.xywh);
    const cartDraw = drawBars();
    const cartOpaque = cartDraw(cart.scene, "rgb(18, 52, 86)")[0]!;
    expect(cartOpaque.children.length).toBeLessThan(2049);
    const cartTranslucent = cartDraw(cart.scene, "rgba(18, 52, 86, 0.5)")[0]!;
    expect(cartTranslucent).toBe(cartOpaque);
    expect(cartTranslucent.children.map(rectValues)).toEqual(cartExact);
  });
});

// ───────────────────────────── C3: Scatter Coverage & Lazy Grid ─────────────────────────────

describe("C3: dense scatter coverage threshold, marker variants and lazy scatter-grid parity", () => {
  const axis100 = linearScale([0, 100], [0, 100]);
  const proj100 = { kind: "xy", x: axis100, y: axis100 } as const;

  function makeScatterMark(x: Float64Array, y: Float64Array, marker: MarkerShape = "circle") {
    const data = lookupFrame("scatter", { data: { columns: { x, y } }, x: "x", y: "y" });
    const view = scatterView(data, { cues: [{ marker, dash: { normal: [], contrast: [] } }] });
    return scatterPoints(view, proj100)[0]!;
  }

  it("activates circle coverage only above 2,000 points, keeps edges and all non-circle marker variants intact", () => {
    // Exactly 2,000 coincident interior circles: must NOT run coveredCircles (xy.length === 4000).
    const x2000 = new Float64Array(2000).fill(50.25);
    const y2000 = new Float64Array(2000).fill(50.25);
    expect(makeScatterMark(x2000, y2000, "circle").xy.length / 2).toBe(2000);
    // 2,001 coincident interior circles: coverage runs and keeps exactly 2,000 witnesses.
    const x2001 = new Float64Array(2001).fill(50.25);
    const y2001 = new Float64Array(2001).fill(50.25);
    expect(makeScatterMark(x2001, y2001, "circle").xy.length / 2).toBe(2000);

    // 2,001 interior points: coveredCircles runs, keeps >= 2,000 interior witnesses, and preserves boundary points.
    const n = 4096;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = 10 + (i % 64);
      y[i] = 10 + Math.floor(i / 64);
    }
    // Pin 4 points inside the 4-px border margin so they must survive unconditionally.
    x[0] = 1.5;
    y[0] = 1.5;
    x[1] = 98.5;
    y[1] = 2.0;
    x[2] = 2.5;
    y[2] = 98.5;
    x[3] = 97.5;
    y[3] = 97.5;
    const mark = makeScatterMark(x, y, "circle");
    expect(mark.xy.length / 2).toBeGreaterThanOrEqual(2000);
    expect(mark.xy.length / 2).toBeLessThan(n);

    // Every border point is retained verbatim.
    for (let b = 0; b < 4; b++) {
      let found = false;
      for (let i = 0; i < mark.xy.length; i += 2) {
        if (mark.xy[i] === Math.fround(x[b]!) && mark.xy[i + 1] === Math.fround(y[b]!)) {
          found = true;
          break;
        }
      }
      expect(found, `border point ${b}`).toBe(true);
    }

    // Translucent single-path SVG render uses fill-rule nonzero (one composited path) with valid relative arcs.
    const doc = fakeDocument();
    const renderer = createSvgRenderer(doc);
    const bindings: PaintBindings = { tokens: TOKEN_BINDINGS, series: ["rgba(15, 80, 190, 0.45)"] };
    renderer.draw(
      { width: 100, height: 100, clip: { x: 0, y: 0, width: 100, height: 100 }, marks: [mark] },
      bindings,
      { paints: bindings, scheme: "light", moreContrast: false, forcedColors: false },
      1,
    );
    const pathEl = (renderer.element as unknown as FakeElement)
      .all()
      .find((el) => el.tagName === "path")!;
    expect(pathEl.style.getPropertyValue("color")).toBe("rgba(15, 80, 190, 0.45)");
    expect(pathEl.getAttribute("d")!).toContain("a3 3 0 11-6 0a3 3 0 116 0");
    // Decode every complete radius-3 relative circle subpath; the whole string must parse.
    const d = pathEl.getAttribute("d")!;
    const circleRe = /M(-?[0-9.]+)[ ,]?(-?[0-9.]+)a3 3 0 11-6 0a3 3 0 116 0/gy;
    const centers: number[] = [];
    let consumed = 0;
    for (let m = circleRe.exec(d); m; m = circleRe.exec(d)) {
      centers.push(Number(m[1]) - 3, Number(m[2]));
      consumed = circleRe.lastIndex;
    }
    expect(consumed).toBe(d.length);
    expect(centers.length / 2).toBe(mark.xy.length / 2);
    // Probe grid offset from integer/quarter ties; compare decoded union to all original centers.
    const step = 0.25;
    const side = 400;
    const minDecoded = new Float64Array(side * side).fill(Infinity);
    const minOriginal = new Float64Array(side * side).fill(Infinity);
    const countOriginal = new Uint16Array(side * side);
    const stamp = (cx: number, cy: number, best: Float64Array, count?: Uint16Array) => {
      const c0 = Math.max(0, Math.floor((cx - 3.5 - 0.0937) / step));
      const c1 = Math.min(side - 1, Math.ceil((cx + 3.5 - 0.0937) / step));
      const r0 = Math.max(0, Math.floor((cy - 3.5 - 0.0937) / step));
      const r1 = Math.min(side - 1, Math.ceil((cy + 3.5 - 0.0937) / step));
      for (let r = r0; r <= r1; r++) {
        const py = 0.0937 + r * step;
        for (let c = c0; c <= c1; c++) {
          const px = 0.0937 + c * step;
          const d2 = (px - cx) ** 2 + (py - cy) ** 2;
          const k = r * side + c;
          if (d2 < best[k]!) best[k] = d2;
          if (count && d2 < 9) count[k]!++;
        }
      }
    };
    for (let i = 0; i < centers.length; i += 2) stamp(centers[i]!, centers[i + 1]!, minDecoded);
    for (let i = 0; i < n; i++) {
      stamp(proj100.x.map(x[i]!), proj100.y.map(y[i]!), minOriginal, countOriginal);
    }
    let overlap = 0;
    let single = 0;
    let exterior = 0;
    let mismatches = 0;
    for (let k = 0; k < side * side; k++) {
      // Skip probes within rounding distance of any circle boundary.
      if (Math.abs(minDecoded[k]! - 9) < 0.05 || Math.abs(minOriginal[k]! - 9) < 0.05) continue;
      const inDecoded = minDecoded[k]! < 9;
      const inOriginal = minOriginal[k]! < 9;
      if (inDecoded !== inOriginal) mismatches++;
      if (!inOriginal) exterior++;
      else if (countOriginal[k]! > 1) overlap++;
      else single++;
    }
    expect(mismatches).toBe(0);
    expect(overlap).toBeGreaterThan(0);
    expect(single).toBeGreaterThan(0);
    expect(exterior).toBeGreaterThan(0);

    // Every non-circle supported marker variant keeps all 2,500 points (no coverage elision).
    const x2500 = new Float64Array(2500).fill(50);
    const y2500 = new Float64Array(2500).fill(50);
    for (const shape of [
      "square",
      "triangle",
      "diamond",
      "cross",
      "plus",
      "triangle-down",
      "star",
    ] as const) {
      expect(makeScatterMark(x2500, y2500, shape).xy.length / 2, shape).toBe(2500);
    }

    // Reversed SVG y-axis [120.25, 20.25] with offset x-axis [42.5, 142.5]: every elided disk's unit squares stay covered.
    const revProj = {
      kind: "xy",
      x: linearScale([0, 100], [42.5, 142.5]),
      y: linearScale([0, 100], [120.25, 20.25]),
    } as const;
    const rx = Float64Array.from({ length: 4096 }, (_, i) => 12.13 + (i % 64));
    const ry = Float64Array.from({ length: 4096 }, (_, i) => 12.29 + Math.floor(i / 64));
    const rData = lookupFrame("scatter", { data: { columns: { x: rx, y: ry } }, x: "x", y: "y" });
    const rMark = scatterPoints(
      scatterView(rData, { cues: [{ marker: "circle", dash: { normal: [], contrast: [] } }] }),
      revProj,
    )[0]!;
    expect(rMark.xy.length / 2).toBeLessThan(4096);
    const left = Math.floor(42.5),
      top = Math.floor(20.25),
      w = 102,
      h = 102;
    const cov = new Uint8Array(w * h);
    const keptSet = new Set<string>();
    for (let i = 0; i < rMark.xy.length; i += 2) {
      const cx = Math.round(rMark.xy[i]! * 10) / 10;
      const cy = Math.round(rMark.xy[i + 1]! * 10) / 10;
      keptSet.add(`${cx},${cy}`);
      for (let r = Math.floor(cy) - 3; r <= cy + 3; r++) {
        for (let c = Math.floor(cx) - 3; c <= cx + 3; c++) {
          if (
            [c, c + 1].every((a) => [r, r + 1].every((b) => (a - cx) ** 2 + (b - cy) ** 2 <= 9))
          ) {
            if (r >= top && r < top + h && c >= left && c < left + w)
              cov[(r - top) * w + (c - left)] = 1;
          }
        }
      }
    }
    let uncovered = 0;
    for (let i = 0; i < 4096; i++) {
      const cx = Math.round(Math.fround(revProj.x.map(rx[i]!)) * 10) / 10;
      const cy = Math.round(Math.fround(revProj.y.map(ry[i]!)) * 10) / 10;
      if (keptSet.has(`${cx},${cy}`)) continue;
      for (let r = Math.floor(cy - 3); r < Math.ceil(cy + 3); r++) {
        for (let c = Math.floor(cx - 3); c < Math.ceil(cx + 3); c++) {
          uncovered += 1 - cov[(r - top) * w + (c - left)]!;
        }
      }
    }
    expect(uncovered).toBe(0);
  });

  it("matches a brute-force oracle for lazy strictX columns, ties, 24 px radius boundaries and members-before-pick", () => {
    const plotW = 120,
      plotH = 120;
    const axis = linearScale([0, plotW], [0, plotW]);
    const projection = { kind: "xy", x: axis, y: axis } as const;
    const layout = { ...lookupPlot(projection, plotW, plotH), projection };
    const cols = Math.floor(plotW / 24) + 1;
    const cellOf = (px: number, py: number) =>
      Math.max(0, Math.min(cols - 1, Math.floor(py / 24))) * cols +
      Math.max(0, Math.min(cols - 1, Math.floor(px / 24)));

    function oraclePick(
      xs: readonly number[],
      ys: readonly number[],
      rows: readonly number[],
      qx: number,
      qy: number,
      dpr: number,
    ) {
      if (qx < 0 || qx > plotW || qy < 0 || qy > plotH) return null;
      const tieDist = 0.5 / dpr;
      const later = (a: number, b: number) => {
        if (rows[a]! !== rows[b]!) return rows[a]! > rows[b]!;
        const cd = cellOf(xs[a]!, ys[a]!) - cellOf(xs[b]!, ys[b]!);
        return cd < 0 || (cd === 0 && a > b);
      };
      let best = 576;
      let nearest = -1;
      for (let i = 0; i < xs.length; i++) {
        const d2 = (xs[i]! - qx) ** 2 + (ys[i]! - qy) ** 2;
        if (d2 < best || (d2 === best && (nearest < 0 || later(i, nearest)))) {
          best = d2;
          nearest = i;
        }
      }
      if (nearest < 0) return null;
      const closest = Math.sqrt(best);
      for (let i = 0; i < xs.length; i++) {
        const d2 = (xs[i]! - qx) ** 2 + (ys[i]! - qy) ** 2;
        if (d2 <= 576 && Math.sqrt(d2) - closest < tieDist && later(i, nearest)) nearest = i;
      }
      const cx = xs[nearest]!,
        cy = ys[nearest]!;
      let count = 0;
      for (let i = 0; i < xs.length; i++) {
        if ((xs[i]! - cx) ** 2 + (ys[i]! - cy) ** 2 <= 0.25) count++;
      }
      return { nearest, count };
    }

    // 1. Targeted strictX lazy-column test: call members() BEFORE any pick() and test exact 24 px & DPR tie bounds.
    const strictXs = Float64Array.from({ length: 80 }, (_, i) => i * 1.4 + 0.5);
    const strictYs = Float64Array.from({ length: 80 }, (_, i) => ((i * 17) % 110) + 5);
    const strictData = lookupFrame("scatter", {
      data: { columns: { x: strictXs, y: strictYs } },
      x: "x",
      y: "y",
    });
    const strictGrid = scatterGrid(scatterView(strictData), layout, 80, 2, {
      exactBudget: Infinity,
    });
    // members() before pick() forces pending[c] materialization cleanly.
    expect(strictGrid.members("exact", 42, 0, 8)).toEqual([42]);
    expect(strictGrid.has("exact", 42, 42)).toBe(true);
    // POINTER_SLACK=1 clamps -1 to the left plot edge, while -1.5 and 121.5 are off-plot (null).
    expect(strictGrid.pick(-1, 50)).not.toBeNull();
    expect(strictGrid.pick(-1.5, 50)).toBeNull();
    expect(strictGrid.pick(121.5, 50)).toBeNull();

    // Exact 24 px radius boundary: distance 24.0 is picked, distance 24.01 is not.
    const singlePt = lookupFrame("scatter", { data: [{ x: 60, y: 60 }], x: "x", y: "y" });
    const boundaryGrid = scatterGrid(scatterView(singlePt), layout, 1, 1, {
      exactBudget: Infinity,
    });
    expect(boundaryGrid.pick(84, 60)).toEqual({ hits: [0], count: 1 });
    expect(boundaryGrid.pick(84.01, 60)).toBeNull();

    // 2. Seeded property test comparing scatterGrid (both exact and forced lattice) against brute-force oracle across DPR 0.5, 1, 2.
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.integer({ min: 0, max: 240 }).map((v) => v / 2),
            y: fc.integer({ min: 0, max: 240 }).map((v) => v / 2),
          }),
          { minLength: 4, maxLength: 60 },
        ),
        fc.constantFrom(0.5, 1, 2),
        fc.array(fc.tuple(fc.integer({ min: 0, max: 120 }), fc.integer({ min: 0, max: 120 })), {
          minLength: 4,
          maxLength: 8,
        }),
        (pts, dpr, queries) => {
          const data = lookupFrame("scatter", { data: pts, x: "x", y: "y" });
          const view = scatterView(data);
          const s = data.series[0]!;
          const exactGrid = scatterGrid(view, layout, s.x.length, dpr, { exactBudget: Infinity });
          const latticeGrid = scatterGrid(view, layout, s.x.length, dpr, { exactBudget: 0 });
          const rows = Array.from({ length: s.x.length }, (_, i) => s.row?.[i] ?? i);
          const snap = (v: number) => Math.round(v * dpr) / dpr;
          const snappedX = Array.from(s.x, snap);
          const snappedY = Array.from(s.y, snap);
          for (const [qx, qy] of queries) {
            const expectedExact = oraclePick(Array.from(s.x), Array.from(s.y), rows, qx, qy, dpr);
            const actualExact = exactGrid.pick(qx, qy);
            if (expectedExact === null) {
              expect(actualExact).toBeNull();
            } else {
              expect(actualExact).not.toBeNull();
              expect(actualExact!.hits[0]).toBe(expectedExact.nearest);
              expect(actualExact!.count).toBe(expectedExact.count);
            }
            const expectedLattice = oraclePick(snappedX, snappedY, rows, qx, qy, dpr);
            const actualLattice = latticeGrid.pick(qx, qy);
            expect(latticeGrid.usedLattice).toBe(true);
            if (expectedLattice === null) {
              expect(actualLattice).toBeNull();
            } else {
              expect(actualLattice).not.toBeNull();
              expect(actualLattice!.hits[0]).toBe(expectedLattice.nearest);
              expect(actualLattice!.count).toBe(expectedLattice.count);
            }
          }
        },
      ),
      { seed: 20261128, numRuns: 30 },
    );
  });
});

// ───────────────────────────── C4: Startup, Templates, Labels, Contrast & Lifecycle ─────────────────────────────

describe("C4: startup settlement, template/label/contrast invalidation and mount/destroy cleanup", () => {
  class ClonableElement extends TestElement {
    get nextElementSibling(): TestElement | null {
      let next = this.nextSibling;
      while (next && !(next instanceof TestElement)) next = next.nextSibling;
      return next;
    }
    cloneNode(deep: boolean): ClonableElement {
      const node = new ClonableElement(this.ownerDocument, this.tagName);
      for (const [name, value] of this.attrs) node.setAttribute(name, value);
      node.hidden = this.hidden;
      if (deep) {
        for (const child of this.childNodes) {
          node.appendChild(
            child instanceof ClonableElement
              ? child.cloneNode(true)
              : this.ownerDocument.createTextNode(child.textContent),
          );
        }
      }
      return node;
    }
  }
  class ClonableDocument extends TestDocument {
    override createElement(tag: string): ClonableElement {
      return new ClonableElement(this, tag);
    }
  }

  it("settles cleanly across repeated mount/update/destroy cycles with zero writes after dispose and unique figure ids", () => {
    const doc = new ClonableDocument();
    const seenIds = new Set<string>();
    for (let cycle = 0; cycle < 16; cycle++) {
      const compact = cycle % 2 === 0;
      const r = record("line", {
        title: `Series ${cycle}`,
        compact,
        x: "x",
        y: "y",
        data: [
          { x: 0, y: cycle },
          { x: 1, y: cycle + 5 },
          { x: 2, y: cycle + 2 },
        ],
      });
      const rounds = r.frames();
      expect(rounds).toBeLessThanOrEqual(3);
      expect(lastModel(r).name).toBe(`Series ${cycle}`);
      expect(r.draws.length).toBeGreaterThanOrEqual(1);

      // Update before destroying, then destroy and verify stale calls perform zero writes.
      r.controller.handle.update({ title: `Updated ${cycle}` });
      r.controller.handle.destroy();
      r.frames();
      r.controller.handle.update({ title: "After destroy" });
      r.controller.handle.zoom([0, 1]);
      r.frames();
      expect(r.disposed).toBe(1);
      expect(r.writesAfterDispose).toBe(0);

      // Template-cloned figure mounts keep distinct ids and clean up on destroy.
      const host = doc.createElement("div");
      doc.body.appendChild(host);
      if (cycle % 2 === 1) host.setAttribute("class", `seed-${cycle}`);
      const classBefore = host.getAttribute("class");
      const id = `g2-fig-${cycle}`;
      const fig = createFigure(
        host as unknown as HTMLElement,
        id,
        { marks: doc.createElement("svg") as unknown as Element },
        { compact },
      );
      const model: FigureModel = {
        compact,
        name: `Series ${cycle}`,
        title: { text: `Series ${cycle}`, level: 3, visible: true },
        labelledBy: null,
        subtitle: null,
        summary: `Summary ${cycle}`,
        summaryVisible: false,
        note: cycle % 3 === 0 ? "1 value omitted." : null,
        message: null,
      };
      fig.update(model);
      const descId = fig.figure.getAttribute("aria-describedby")!;
      expect(seenIds.has(descId)).toBe(false);
      seenIds.add(descId);
      expect(Array.from(host.children)).toContain(fig.figure);
      fig.destroy();
      expect(host.children.length).toBe(0);
      expect(host.getAttribute("class")).toBe(classBefore);
      host.remove();
    }
  });

  it("invalidates document measurement cache on font load and updates computeLayout tick placement", () => {
    let charWidth = 6;
    const doc = {
      createElement: () => ({
        getContext: () => ({
          font: "12px sans-serif",
          letterSpacing: "0px",
          wordSpacing: "0px",
          measureText: (text: string) => ({ width: text.length * charWidth }),
        }),
      }),
    } as unknown as Document;

    const measurer = createMeasurer(doc);
    const style = { font: "400 12px sans-serif", lineHeight: 16, letterSpacing: 0, wordSpacing: 0 };
    expect(measurer.width("Revenue", style)).toBe(42);
    expect(measurementCacheSize(doc)).toBe(1);

    // Changing underlying font metric without noteFontLoad stays cached; noteFontLoad clears cache and recomputes.
    charWidth = 11;
    expect(measurer.width("Revenue", style)).toBe(42);
    noteFontLoad(doc);
    expect(measurementCacheSize(doc)).toBe(0);
    expect(measurer.width("Revenue", style)).toBe(77);
    expect(measurementCacheSize(doc)).toBe(1);

    // computeLayout honors updated widths cleanly.
    const scales = { linear: linearScale, time: timeScale, band: bandScale };
    const ticks = [0, 50, 100].map((v) => ({ value: v, label: `${v},000` }));
    const cats = ["Alpha", "Beta", "Gamma"].map((label, value) => ({ value, label }));
    const input: LayoutInput = {
      kind: "xy",
      width: 360,
      height: 240,
      scales,
      style,
      measurer,
      x: { type: "band", count: 3, padding: 0.1, candidates: [cats], mayThin: false },
      y: { domain: [0, 100], candidates: [ticks], mayThin: true },
    };
    const wideLayout = computeLayout(input);
    charWidth = 5;
    noteFontLoad(doc);
    const narrowLayout = computeLayout(input);
    if (wideLayout.kind !== "plot" || narrowLayout.kind !== "plot")
      throw new Error("expected plot");
    expect(wideLayout.plot.x).toBeGreaterThan(narrowLayout.plot.x);
  });

  it("invalidates ThemeBatch contrast sharing when backdrop, text or series custom property changes", () => {
    const doc = new TestDocument();
    const win = doc.defaultView;
    const baseStyle = win.getComputedStyle.bind(win);
    const firstColor = LIGHT.series[0]!;
    vi.spyOn(win, "getComputedStyle").mockImplementation((el) => {
      const st = baseStyle(el);
      return {
        ...st,
        colorScheme: "normal",
        backgroundColor: String(el.style.backgroundColor || "rgb(255, 255, 255)"),
        color: String(el.style.textColor || "rgb(0, 0, 0)"),
        getPropertyValue(name: string) {
          if (name === "--axylo-series-color-1") return String(el.style.seriesPaint ?? firstColor);
          if (name === "--axylo-text") return String(el.style.axyloText ?? "");
          const token = name.slice("--axylo-default-".length);
          if (name.startsWith("--axylo-default-") && Object.hasOwn(LIGHT, token)) {
            return String(LIGHT[token as keyof typeof LIGHT]);
          }
          return st.getPropertyValue(name);
        },
      };
    });
    const batch = createThemeBatch(win as unknown as Window);
    const makeTile = () => {
      const el = doc.createElement("figure");
      doc.body.appendChild(el);
      return el;
    };
    const runTheme = (el: TestElement) => {
      const p = prepareTheme(el as unknown as HTMLElement, ["s"], null, batch);
      applyTheme(p);
      return finalizeTheme(p, true);
    };

    const t1 = makeTile(),
      t2 = makeTile(),
      t3 = makeTile(),
      t4 = makeTile();
    const r1 = runTheme(t1)!;
    const r2 = runTheme(t2)!;
    // Identical light-DOM tiles share the batch result.
    expect(r2).toBe(r1);
    expect(r1.lowContrast).toEqual([]);

    // Low-contrast backdrop must NOT reuse batch.last and must flag series 0.
    t3.style.backgroundColor = firstColor;
    const r3 = runTheme(t3)!;
    expect(r3).not.toBe(r1);
    expect(r3.lowContrast).toEqual([0]);

    // Custom --axylo-text override must fall through to probe (null with deferProbe=true).
    t4.style.axyloText = "#112233";
    expect(runTheme(t4)).toBeNull();
  });
});

// ───────────────────────────── C5: Cartesian Zoom, 256-Row Blocks, Log, Signed Zero & Stacks ─────────────────────────────

describe("C5: Cartesian 256-row block boundaries, log gaps, signed zero, stacks and exact lookup", () => {
  it("matches exact domain, F5 keep, and lookup across narrow zoom windows straddling 256-row block boundaries", () => {
    const n = 1024;
    const x = Float64Array.from({ length: n }, (_, i) => i);
    const y = Float64Array.from({ length: n }, (_, i) => ((i * 37) % 100) - 50);
    // Place sharp extrema directly on 256-row block edges (255, 256, 511, 512, 767, 768).
    y[255] = -900;
    y[256] = 950;
    y[511] = 880;
    y[512] = -870;
    y[767] = 990;
    y[768] = -990;
    // Mid-block extrema: a stale cached block extremum would miss these in partial windows.
    y[900] = 5000;
    y[1000] = -10000;

    const {
      frame,
      stateRef: { meta },
    } = prepare({
      title: "Blocks",
      data: { columns: { x, y } },
      x: { field: "x", type: "linear" },
      axes: { v: { position: "left" } },
      layers: [{ type: "line", y: "y", yAxis: "v" }],
    });
    const series = frame.series[0]!;
    const axis = meta.axes[0]!;

    // Probe narrow windows crossing 256-row boundaries twice (warming seriesWindows on visit 2).
    const windows: readonly [number, number][] = [
      [0, n],
      [255, 257],
      [250, 262],
      [256, 512],
      [254, 514],
      [511, 769],
      [255, 768],
      // Distinct expected domains: [0,600) spans [-900, 950]; [254,950) spans [-990, 5000]; full spans [-10000, 5000].
      [0, 600],
      [254, 950],
    ];
    for (let pass = 0; pass < 2; pass++) {
      for (const [start, end] of windows) {
        let lo = Infinity,
          hi = -Infinity;
        for (let i = start; i < end; i++) {
          if (y[i]! < lo) lo = y[i]!;
          if (y[i]! > hi) hi = y[i]!;
        }
        const dom = computeAxisDomain(
          frame,
          [true],
          { start, end },
          axis,
          [],
          meta,
          new DiagnosticCollector(),
        );
        expect(dom.error).toBe(false);
        expect(dom.domain).toEqual(
          valueDomain({ min: lo, max: hi, includeZero: false, authorDomain: null }).domain,
        );
        // Verify keep() preserves both boundary extrema when downsampled into 2 pixel columns.
        const kept = keep(
          y,
          null,
          { start, end },
          (i) => ((i - start) * 2) / Math.max(1, end - start),
          1,
          8,
          true,
          false,
          true,
          series,
        );
        // Oracle: per fixture column, earliest first/min/max/last indexes in ascending order.
        const expected: number[] = [];
        if (end - start <= 8) {
          for (let i = start; i < end; i++) expected.push(i);
        } else {
          for (let first = start; first < end;) {
            const column = Math.floor(((first - start) * 2) / (end - start));
            let last = first;
            while (
              last + 1 < end &&
              Math.floor(((last + 1 - start) * 2) / (end - start)) === column
            )
              last++;
            let minAt = first,
              maxAt = first;
            for (let i = first; i <= last; i++) {
              if (y[i]! < y[minAt]!) minAt = i;
              if (y[i]! > y[maxAt]!) maxAt = i;
            }
            expected.push(...[...new Set([first, minAt, maxAt, last])].sort((a, b) => a - b));
            first = last + 1;
          }
        }
        expect(Array.from(kept.indexes), `[${start}, ${end})`).toEqual(expected);
      }
    }

    // End-to-end zoomed Cartesian lookup at block boundary slots 255 & 256.
    const zoomed = runCartesian(
      {
        title: "Zoomed Blocks",
        data: { columns: { x, y } },
        x: { field: "x", type: "linear" },
        axes: { v: { position: "left" } },
        layers: [{ type: "line", y: "y", yAxis: "v" }],
      },
      { width: 640, height: 320, zoom: [250, 262] },
    );
    if (zoomed.layout.kind !== "plot" || zoomed.layout.projection.kind !== "xy")
      throw new Error("expected plot");
    for (const slot of [255, 256]) {
      const px = zoomed.layout.projection.x.map(slot);
      const py = zoomed.layout.projection.y.map(y[slot]!);
      const picked = zoomed.lookup.pick(px, py);
      expect(picked).toEqual({ kind: "x", x: slot });
      const tip = zoomed.lookup.tooltip(picked!);
      expect(tip.rows[0]!.value).toBe(zoomed.formatters.value(0, y[slot]!));
    }

    // Stacked bar layer under the same zoom crossing row 256: pick from each segment's projected middle.
    const z = Float64Array.from(y, (value) => value / 2);
    const zoomedBars = runCartesian(
      {
        title: "Zoomed Bars",
        data: { columns: { x, y, z } },
        x: { field: "x", type: "linear" },
        axes: { v: { position: "left" } },
        layers: [{ type: "bar", y: ["y", "z"], yAxis: "v", stacked: true }],
      },
      { width: 640, height: 320, zoom: [250, 262] },
    );
    if (zoomedBars.layout.kind !== "plot" || zoomedBars.layout.projection.kind !== "xy")
      throw new Error("expected plot");
    for (const slot of [255, 256]) {
      const px = zoomedBars.layout.projection.x.map(slot);
      const probes: readonly [string, number][] = [
        ["y", y[slot]! / 2],
        ["z", y[slot]! + z[slot]! / 2],
      ];
      for (const [seriesKey, height] of probes) {
        const py = zoomedBars.layout.projection.y.map(height);
        const picked = zoomedBars.lookup.pick(px, py);
        expect(picked).toEqual({ kind: "x", x: slot });
        expect(zoomedBars.lookup.primary(picked!)).toEqual({ kind: "aligned", seriesKey, x: slot });
        const tip = zoomedBars.lookup.tooltip(picked!);
        expect(tip.rows).toHaveLength(2);
        expect(tip.rows[0]!.value).toBe(zoomedBars.formatters.value(0, y[slot]!));
        expect(tip.rows[1]!.value).toBe(zoomedBars.formatters.value(0, z[slot]!));
      }
    }
  });

  it("handles log-axis non-positive gaps, isolated positive points and zoomed empty-positive fallback", () => {
    const n = 600;
    const x = Float64Array.from({ length: n }, (_, i) => i);
    const y = Float64Array.from({ length: n }, (_, i) => {
      if (i === 255) return 0;
      if (i === 256) return 42; // isolated positive point between 0 and -5 across block boundary
      if (i === 257) return -5;
      if (i >= 300 && i < 360) return i % 2 === 0 ? 0 : -10; // all non-positive zoom window
      if (i === 400) return NaN;
      return 10 + (i % 50);
    });

    const chart = runCartesian(
      {
        title: "Log Gaps",
        data: { columns: { x, y } },
        x: { field: "x", type: "linear" },
        axes: { v: { position: "left", scale: "log" } },
        layers: [{ type: "line", y: "y", yAxis: "v" }],
      },
      { width: 600, height: 300 },
    );
    expect(chart.sink.inputs().some((d) => d.code === "AX171")).toBe(true);
    expect(chart.sink.inputs().some((d) => d.code === "AX172")).toBe(false);

    // Slot 256 is isolated between non-positive 255 and 257.
    const series = chart.frame.series[0]!;
    const kept = keep(
      series.y,
      series.slot,
      { start: 250, end: 265 },
      (i) => i,
      1,
      100,
      true,
      true,
      true,
      series,
    );
    expect(Array.from(kept.isolated)).toContain(256);
    expect(Array.from(kept.indexes)).not.toContain(255);
    expect(Array.from(kept.indexes)).not.toContain(257);

    // Tooltip and table still report non-positive slot 257 as "(not plotted)".
    const tip257 = chart.lookup.tooltip({ kind: "x", x: 257 });
    expect(tip257.rows[0]!.value).toContain("not plotted");

    // Zooming into the all-non-positive window [305, 355] keeps full-data positive log domain without AX172.
    const zoomed = runCartesian(
      {
        title: "Log Zoom Fallback",
        data: { columns: { x, y } },
        x: { field: "x", type: "linear" },
        axes: { v: { position: "left", scale: "log" } },
        layers: [{ type: "line", y: "y", yAxis: "v" }],
      },
      { width: 600, height: 300, zoom: [305, 355] },
    );
    expect(zoomed.sink.inputs().some((d) => d.code === "AX172")).toBe(false);
    expect(zoomed.view.yDomain).toEqual(niceLogDomain(10, 59, 10));
  });

  it("preserves signed zero (-0 vs +0) across 256-row block boundaries without materializing dense slots", () => {
    const {
      frame,
      stateRef: { meta },
      sink,
    } = prepare({
      title: "Zeros",
      data: [{ x: 0, y: 1 }],
      x: "x",
      axes: { v: { position: "left" } },
      layers: [{ type: "line", y: "y", yAxis: "v" }],
    });
    const n = 768;
    for (const firstZero of [-0, 0]) {
      const y = new Float64Array(n).fill(Number.MAX_VALUE);
      y[255] = firstZero;
      y[256] = -firstZero;
      const s: Series = denseSeries({ ...frame.series[0]!, y }, n, () => {
        throw new Error("dense slot column must not materialize");
      });
      fullStatistics.set(
        s,
        withSignedZeros({ min: firstZero, max: Number.MAX_VALUE, last: Number.MAX_VALUE }, 3),
      );
      for (const range of [
        { start: 0, end: n },
        { start: 200, end: 760 },
        { start: 200, end: 760 },
      ]) {
        const res = computeAxisDomain(
          { ...frame, length: n, series: [s] },
          [true],
          range,
          meta.axes[0]!,
          [],
          meta,
          sink,
        );
        expect(Object.is(res.domain[0], firstZero)).toBe(true);
        expect(seriesSlots(s)).toBeNull();
      }
    }
  });

  it("keeps exact domains, non-enveloped bar baselines and lookup readouts for stacked bars and stacked areas under zoom", () => {
    const n = 640;
    const x = Float64Array.from({ length: n }, (_, i) => i);
    // i % 3 === 0 hits both odd (e.g. 261 -> a=-15, b=-8 => -23) and even (e.g. 258 -> a=-15, b=10 => mixed) slots.
    const a = Float64Array.from({ length: n }, (_, i) => (i % 3 === 0 ? -15 : 20));
    const b = Float64Array.from({ length: n }, (_, i) =>
      i % 5 === 0 ? NaN : i % 2 === 0 ? 10 : -8,
    );

    const barChart = runCartesian(
      {
        title: "Stacked Bars",
        data: { columns: { x, a, b } },
        x: { field: "x", type: "linear" },
        axes: { v: { position: "left" } },
        layers: [{ type: "bar", y: ["a", "b"], yAxis: "v", stacked: true }],
      },
      { width: 640, height: 320, zoom: [250, 520] },
    );
    // Stacked bar baselines must be null so barEnvelope never merges stacked segments.
    const baselines = (barChart.scene as Scene & { barBaselines?: readonly (number | null)[] })
      .barBaselines;
    expect(baselines).toEqual([null, null]);
    // Domain covers both positive sum (20+10=30) and negative sum (-15+-8=-23).
    expect(barChart.view.yDomain[0]).toBeLessThanOrEqual(-23);
    expect(barChart.view.yDomain[1]).toBeGreaterThanOrEqual(30);
    // Slot 255 has a=-15, b=NaN -> incomplete stack in tooltip.
    const tip255 = barChart.lookup.tooltip({ kind: "x", x: 255 });
    expect(tip255.total).toMatch(/incomplete/i);
    // Slot 258 has a=-15, b=10 -> mixed sign total shows both positive and negative ends.
    const tip258 = barChart.lookup.tooltip({ kind: "x", x: 258 });
    expect(tip258.total).toContain("10");
    expect(tip258.total).toContain("-15");

    const areaChart = runCartesian(
      {
        title: "Stacked Areas",
        data: { columns: { x, a, b } },
        x: { field: "x", type: "linear" },
        axes: { v: { position: "left" } },
        layers: [{ type: "area", y: ["a", "b"], yAxis: "v", stacked: true }],
      },
      { width: 640, height: 320, zoom: [250, 520] },
    );
    expect(areaChart.view.yDomain[0]).toBeLessThanOrEqual(-23);
    expect(areaChart.view.yDomain[1]).toBeGreaterThanOrEqual(30);
    expect(areaChart.scene.marks.filter((m) => m.type === "area").length).toBeGreaterThanOrEqual(2);

    // Dense independent Cartesian bars (>=512 slots) with 256-slot value-cache collisions (0, -0, 0.5, 256, -256, 512).
    const collisionVals = [0, -0, 0.5, 256, -256, 512, 256.5, -0.5];
    const yc = Float64Array.from(
      { length: 600 },
      (_, i) => collisionVals[i % collisionVals.length]!,
    );
    const barColl = runCartesian(
      {
        title: "Cache Collisions",
        data: { columns: { x: Float64Array.from({ length: 600 }, (_, i) => i), y: yc } },
        x: { field: "x", type: "linear" },
        axes: { v: { position: "left" } },
        layers: [{ type: "bar", y: "y", yAxis: "v" }],
      },
      { width: 640, height: 320 },
    );
    const mark = barColl.scene.marks.find(
      (m): m is RectMark => m.type === "rects" && m.variant === "bar",
    )!;
    for (let i = 0; i < 16; i++) {
      const box = barColl.lookup.anchor({ kind: "aligned", seriesKey: "y", x: i })!;
      expect(Array.from(mark.xywh.subarray(i * 4, i * 4 + 4))).toEqual([
        box.x,
        box.y,
        box.width,
        box.height,
      ]);
    }
  });
});

// ───────────────────────────── C6: Shadow DOM, Stream, denseCircles & Borrowed Float64Array ─────────────────────────────

describe("C6: slotted shadow mutations/teardown, stream lifecycle, denseCircles and borrowed Float64Array", () => {
  it("isolates per-root observers across slotted shadow ancestors and tears down cleanly without leaks", () => {
    const observers: MockObserver[] = [];
    class MockObserver {
      readonly roots: unknown[] = [];
      disconnected = 0;
      constructor(readonly deliver: (records: unknown[]) => void) {
        observers.push(this);
      }
      observe(root: unknown) {
        this.roots.push(root);
      }
      disconnect() {
        this.disconnected++;
      }
    }
    const html = { nodeType: 1, getAttribute: () => "en" };
    const doc = { documentElement: html, defaultView: { MutationObserver: MockObserver } };
    const mk = (parentElement: unknown, parentNode = parentElement, assignedSlot?: unknown) => ({
      ownerDocument: doc,
      parentNode,
      parentElement,
      assignedSlot,
      getAttribute: () => null,
    });

    let slotLang = "fr";
    const host = mk(html);
    const shadow = { nodeType: 11, host };
    const slot = { ...mk(null, shadow), getAttribute: () => slotLang };
    const slottedTarget = { ...mk(host, host, slot), getRootNode: () => doc } as unknown as Element;
    const lightTarget = { ...mk(html), getRootNode: () => doc } as unknown as Element;
    const unrelated = { ...mk(html), getRootNode: () => doc } as unknown as Element;

    expect(pageLanguage(slottedTarget)).toBe("fr");
    expect(pageLanguage(lightTarget)).toBe("en");

    const slottedTheme = vi.fn();
    const lightTheme = vi.fn();
    const stopSlotted = subscribeTreeMutations(
      "theme",
      slottedTarget,
      { attributes: true, subtree: true },
      {
        element: slottedTarget,
        onChange: slottedTheme,
      },
    );
    const stopLight = subscribeTreeMutations(
      "theme",
      lightTarget,
      { attributes: true, subtree: true },
      {
        element: lightTarget,
        onChange: lightTheme,
      },
    );
    const langCb = { language: vi.fn() };
    const langWatch = new LanguageWatch(slottedTarget, langCb);
    langWatch.start();

    // Theme observers: html hub (shared by slotted + light) and shadow hub (only slotted).
    const htmlObs = observers.find((o) => o.roots.length === 1 && o.roots[0] === html)!;
    const shadowObs = observers.find((o) => o.roots.length === 1 && o.roots[0] === shadow)!;
    const langObs = observers.find((o) => o.roots.length === 2)!;

    // Unrelated light sibling triggers neither chart.
    htmlObs.deliver([{ target: unrelated, attributeName: "class" }]);
    expect(slottedTheme).not.toHaveBeenCalled();
    expect(lightTheme).not.toHaveBeenCalled();

    // Mutating the assigned slot inside shadow triggers ONLY the slotted chart.
    shadowObs.deliver([{ target: slot, attributeName: "data-theme" }]);
    expect(slottedTheme).toHaveBeenCalledTimes(1);
    expect(lightTheme).not.toHaveBeenCalled();

    // Language mutation on slot triggers LanguageWatch.
    slotLang = "es";
    langObs.deliver([{ target: slot, attributeName: "lang" }]);
    expect(langCb.language).toHaveBeenCalledTimes(1);
    expect(pageLanguage(slottedTarget)).toBe("es");

    // Stopping the slotted chart disconnects shadowObs, keeps htmlObs alive for lightTarget.
    stopSlotted();
    stopSlotted(); // idempotent
    expect(shadowObs.disconnected).toBe(1);
    expect(htmlObs.disconnected).toBe(0);

    htmlObs.deliver([{ target: html, attributeName: "class" }]);
    expect(lightTheme).toHaveBeenCalledTimes(1);
    expect(slottedTheme).toHaveBeenCalledTimes(1);

    // Stopping lightTarget and langWatch disconnects all remaining observers once.
    stopLight();
    langWatch.stop();
    langWatch.stop(); // idempotent
    expect(htmlObs.disconnected).toBe(1);
    expect(langObs.disconnected).toBe(1);
  });

  it("preserves stream lifecycle invariants across pause, eviction, out-of-order append (AX151) and destroy", () => {
    const r = record("line", {
      title: "Stream",
      x: "x",
      y: "y",
      data: [
        { x: 0, y: 10 },
        { x: 1, y: 20 },
      ],
    });
    try {
      r.frames();
      r.controller.handle.append([{ x: 2, y: 30 }], { keep: 2 });
      r.frames();
      const baseline = r.controller.handle.__dev!.retainedRows();

      // Pause and push well beyond RETENTION_SLACK so pinned revisions freeze and retire.
      r.controller.actions.pause(true);
      let peak = 0;
      for (let t = 3; t <= 40; t++) {
        r.controller.handle.append([{ x: t, y: t * 10 }], { keep: 2 });
        r.frames();
        peak = Math.max(peak, r.controller.handle.__dev!.retainedRows());
      }
      expect(peak).toBeLessThanOrEqual(2 * baseline + 8);
      // Paused view still displays the frozen window [1, 2].
      expect(
        Array.from(r.committed!.lookup.tooltip({ kind: "x", x: 2 }).rows.map((row) => row.value)),
      ).toEqual(["30"]);

      // Resume catches up to latest window [39, 40].
      r.controller.actions.pause(false);
      r.frames();
      expect(r.committed!.lookup.tooltip({ kind: "x", x: 40 }).rows[0]!.value).toBe("400");

      // Out-of-order append raises AX151 and keeps sorted data.
      r.controller.handle.append([{ x: 35, y: 350 }]);
      r.frames();
      expect(r.controller.handle.diagnostics.some((d) => d.code === "AX151")).toBe(true);
      expect(r.committed!.lookup.tooltip({ kind: "x", x: 35 }).rows[0]!.value).toBe("350");
    } finally {
      r.controller.handle.destroy();
    }
    r.frames();
    expect(r.writesAfterDispose).toBe(0);
    // Retention measured after teardown: a destroyed stream must release its window.
    expect(r.controller.handle.__dev!.retainedRows()).toBe(0);
  });

  it("emits exact relative SVG arcs at r=0.5 and r=2.5 across negative/tie coordinates and falls back out of range", () => {
    function renderPoints(xy: Float32Array, radius: number): string {
      const renderer = createSvgRenderer(fakeDocument());
      const bindings: PaintBindings = { tokens: TOKEN_BINDINGS, series: ["red"] };
      const clip = { x: 0, y: 0, width: 1000, height: 400 };
      renderer.draw(
        {
          ...clip,
          clip,
          marks: [
            {
              type: "points",
              series: 0,
              xy,
              shape: "circle",
              size: radius * 2,
              fill: { kind: "series", index: 0 },
            },
          ],
        },
        bindings,
        { paints: bindings, scheme: "light", moreContrast: false, forcedColors: false },
        1,
      );
      return (renderer.element as unknown as FakeElement)
        .all()
        .find((el) => el.tagName === "path")!
        .getAttribute("d")!;
    }

    const samplePairs = [-0.05, -0.25, 0, -9999.875, 9999.875, 12.35, NaN, 4, 4, Infinity];
    const xy = Float32Array.from({ length: 4000 }, (_, i) => samplePairs[i % samplePairs.length]!);

    for (const radius of [0.5, 2.5]) {
      const diameter = radius * 2;
      const rTenths = radius * 10;
      let expected = "";
      for (let i = 0; i < xy.length; i += 2) {
        const x = xy[i]!,
          y = xy[i + 1]!;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const cx = Math.round(x * 10);
        const cy = Math.round(y * 10);
        const mx = (cx + rTenths) / 10;
        const my = cy === 0 ? 0 : cy / 10;
        expected += `M${mx === 0 ? 0 : mx} ${my}a${radius} ${radius} 0 11-${diameter} 0a${radius} ${radius} 0 11${diameter} 0`;
      }
      expect(renderPoints(xy, radius)).toBe(expected);
    }

    // Any finite coordinate at |v| >= 10000 falls back to absolute A...Z arcs.
    const outOfRange = new Float32Array(4000).fill(1.25);
    outOfRange[3999] = -10000;
    const fallback = renderPoints(outOfRange, 2.5);
    expect(fallback).toContain("A2.5 2.5 0 1 1 ");
    expect(
      fallback.endsWith("M3.75 -10000A2.5 2.5 0 1 1 -1.25 -10000A2.5 2.5 0 1 1 3.75 -10000Z"),
    ).toBe(true);

    // Non-tenth radius (r = 1.25) also falls back cleanly to absolute arcs.
    const quarter = renderPoints(new Float32Array(4000).fill(10), 1.25);
    expect(quarter.startsWith("M11.25 10A1.25 1.25 0 1 1 8.75 10A1.25 1.25 0 1 1 11.25 10Z")).toBe(
      true,
    );

    // Streaming slidingPath ring-buffer boundaries at fitsPixelWord extremes (-999.99, -999.996, 9999.99, 9999.995, -1000).
    const pathRenderer = createSvgRenderer(fakeDocument());
    const bindings: PaintBindings = { tokens: TOKEN_BINDINGS, series: ["blue"] };
    const theme = {
      paints: bindings,
      scheme: "light",
      moreContrast: false,
      forcedColors: false,
    } as const;
    const clip = { x: 0, y: 0, width: 400, height: 100 };
    const edgeVals = [-999.99, -999.996, 9999.99, 9999.995, -1000, 10000, 12.5];
    const size = 64;
    const ys = Array.from({ length: size }, (_, i) => i + 0.25);
    const drawLine = (values: readonly number[]) => {
      const buf = new Float32Array(size * 2);
      for (let i = 0; i < size; i++) {
        buf[2 * i] = i;
        buf[2 * i + 1] = values[i]!;
      }
      pathRenderer.draw(
        {
          ...clip,
          clip,
          marks: [
            {
              type: "path",
              series: 0,
              xy: buf,
              strokeWidth: 1,
              stroke: { kind: "series", index: 0 },
              dash: { normal: null, contrast: null },
            },
          ],
        },
        bindings,
        theme,
        1,
      );
      const d = (pathRenderer.element as unknown as FakeElement)
        .all()
        .find((el) => el.tagName === "path")!
        .getAttribute("d")!;
      let expected = "";
      for (let i = 0; i < size; i++) {
        const px = Math.round(buf[2 * i]! * 100) / 100;
        const py = Math.round(buf[2 * i + 1]! * 100) / 100;
        expected += `${i ? "L" : "M"}${px} ${py}`;
      }
      expect(d).toBe(expected);
    };
    drawLine(ys);
    for (const nextVal of edgeVals) {
      ys.shift();
      ys.push(nextVal);
      drawLine(ys);
    }
    pathRenderer.destroy();
  });

  it("borrows Float64Array for signed zeros and typed NaN, and clones without mutating caller buffer on Infinity", () => {
    const x = Float64Array.of(0, 1, 2, 3);

    // 1. All-finite with mixed signed zeros: borrowed buffer, ordered keeps first zero, signed separates -0/+0.
    const z1 = Float64Array.of(0, -0, 5, 10);
    const r1 = normalizeAligned({
      data: { columns: { x, y: z1 } },
      x: { field: "x", type: "number" },
      y: "y",
    });
    expect(r1.frame.series[0]!.y).toBe(z1);
    const ord1 = alignedStatistics(r1.frame.series[0]!, 0, 4);
    const sig1 = alignedStatistics(r1.frame.series[0]!, 0, 4, true);
    expect(Object.is(ord1.min, 0)).toBe(true);
    expect(Object.is(sig1.min, -0)).toBe(true);
    expect(r1.diagnostics.inputs()).toEqual([]);

    // 2. Typed NaN stays borrowed as silent SLOT_NULL (no AX103).
    const withNaN = Float64Array.of(2, NaN, -0, 8);
    const r2 = normalizeAligned({
      data: { columns: { x, y: withNaN } },
      x: { field: "x", type: "number" },
      y: "y",
    });
    expect(r2.frame.series[0]!.y).toBe(withNaN);
    expect(Array.from(r2.frame.series[0]!.slot)).toEqual([
      SLOT_VALUE,
      SLOT_NULL,
      SLOT_VALUE,
      SLOT_VALUE,
    ]);
    expect(r2.diagnostics.inputs()).toEqual([]);

    // 3. Infinity / -Infinity clones buffer (caller array untouched) and reports AX103 on exact rows.
    const withInf = Float64Array.of(1, Infinity, -Infinity, -0);
    const r3 = normalizeAligned({
      data: { columns: { x, y: withInf } },
      x: { field: "x", type: "number" },
      y: "y",
    });
    expect(r3.frame.series[0]!.y).not.toBe(withInf);
    expect(withInf[1]).toBe(Infinity);
    expect(withInf[2]).toBe(-Infinity);
    expect(Array.from(r3.frame.series[0]!.slot)).toEqual([
      SLOT_VALUE,
      SLOT_INVALID,
      SLOT_INVALID,
      SLOT_VALUE,
    ]);
    expect(r3.diagnostics.inputs().find((d) => d.code === "AX103")).toMatchObject({
      count: 2,
      rows: [1, 2],
    });
    expect(Object.is(alignedStatistics(r3.frame.series[0]!, 0, 4).min, -0)).toBe(true);
  });
});

// ───────────────────────────── C7: Finance 64/65 Batching & Heatmap 2D Merging / Column Parity ─────────────────────────────

describe("C7: finance 64/65 batching boundary and heatmap 2D run merging & column parity", () => {
  const financeBindings: PaintBindings = {
    tokens: TOKEN_BINDINGS,
    series: ["rgb(10, 120, 60)", "rgb(180, 40, 40)", "rgba(80, 90, 100, 0.4)"],
  };
  const financeTheme = {
    scheme: "light",
    moreContrast: false,
    forcedColors: false,
    paints: financeBindings,
  } as const;
  const financeSize = { width: 960, height: 480 };

  function makeFinanceCase(
    downCount: number,
    upCount: number,
    dojiCount: number,
    volumeCount: number,
  ) {
    const total = downCount + upCount + dojiCount;
    const rows = Array.from({ length: total }, (_, i) => {
      const isDown = i < downCount;
      const isDoji = !isDown && i < downCount + dojiCount;
      return {
        x: i,
        o: 105,
        h: 112,
        l: 98,
        c: isDown ? 100 : isDoji ? 105 : 110,
        v: i < volumeCount ? 10 + (i % 7) : 0,
      };
    });
    return stageFinance(
      financeBaseOptions({
        x: { field: "x", type: "number" },
        yAxis: { domain: [95, 115] },
        data: rows,
      }),
      financeSize,
    );
  }

  function renderFinance(
    staged: StagedFinance,
    r = svgRendererWith(financeSvgMarks, fakeDocument()),
  ) {
    r.draw(staged.scene, financeBindings, financeTheme, 1);
    const all = (r.element as unknown as FakeElement).all();
    const byPaint = (name: "up" | "down" | "volume") =>
      all.find((el) => el.style.getPropertyValue("color").includes(`--axylo-${name},`))!;
    const clipUrl = (pane: "price" | "volume") => {
      const cp = all.find(
        (el) =>
          el.tagName === "clipPath" && el.getAttribute("id")?.startsWith(`axylo-finance-${pane}-`),
      )!;
      const box = staged.panes[pane]!;
      expect(
        ["x", "y", "width", "height"].map((k) => Number(cp.children[0]!.getAttribute(k))),
      ).toEqual([box.x, box.y, box.width, box.height]);
      return `url(#${cp.getAttribute("id")})`;
    };
    return { r, all, byPaint, clipUrl };
  }

  // Reference boxes come from the unbatched svgRects painter for the same scene mark.
  function referenceRects(staged: StagedFinance, paint: number, count: number) {
    const mark = financeRectsOf(staged.scene, paint)!;
    const ref = svgRendererWith({ rects: svgRects }, fakeDocument());
    ref.draw({ ...staged.scene, marks: [mark] }, financeBindings, financeTheme, 1);
    const group = (ref.element as unknown as FakeElement)
      .all()
      .find((el) => el.tagName === "g" && el.children.length === count)!;
    expect(group, `reference group of ${count}`).toBeDefined();
    return group.children.map((rect) =>
      ["x", "y", "width", "height"].map((k) => rect.getAttribute(k)!),
    );
  }

  function expectPathParity(group: FakeElement, staged: StagedFinance, paint: number) {
    expect(group.children.every((el) => el.tagName === "path")).toBe(true);
    const d = group.children.map((c) => c.getAttribute("d")).join("");
    const subpaths = d.match(/M[^Mz]*z/g) ?? [];
    expect(subpaths).toHaveLength(65);
    expect(subpaths.join("")).toBe(d);
    const expected = referenceRects(staged, paint, 65)
      .map(([rx, ry, rw, rh]) => `M${rx} ${ry}h${rw}v${rh}h-${rw}z`)
      .join("");
    expect(d).toBe(expected);
  }

  function expectRectParity(group: FakeElement, staged: StagedFinance, paint: number) {
    expect(group.children).toHaveLength(64);
    expect(group.children.every((el) => el.tagName === "rect")).toBe(true);
    expect(
      group.children.map((rect) => ["x", "y", "width", "height"].map((k) => rect.getAttribute(k)!)),
    ).toEqual(referenceRects(staged, paint, 64));
  }

  it("enforces the exact 64/65 batching threshold independently for price down-candles and volume bars", () => {
    // A: 64 down + 64 volume -> both remain individual <rect> elements.
    const caseA = makeFinanceCase(64, 1, 1, 64);
    const resA = renderFinance(caseA);
    expect(resA.byPaint("down").children.every((el) => el.tagName === "rect")).toBe(true);
    expect(resA.byPaint("down").children).toHaveLength(64);
    expect(resA.byPaint("volume").children.every((el) => el.tagName === "rect")).toBe(true);
    expect(resA.byPaint("volume").children).toHaveLength(64);

    // B: 65 down + 64 volume -> down batches to <path>, volume stays 64 <rect>s.
    const caseB = makeFinanceCase(65, 1, 1, 64);
    const resB = renderFinance(caseB);
    expect(resB.byPaint("down").children.every((el) => el.tagName === "path")).toBe(true);
    expect(resB.byPaint("down").getAttribute("clip-path")).toBe(resB.clipUrl("price"));
    expectPathParity(resB.byPaint("down"), caseB, DOWN_PAINT);
    expect(resB.byPaint("volume").children.every((el) => el.tagName === "rect")).toBe(true);
    expect(resB.byPaint("volume").children).toHaveLength(64);
    expect(resB.byPaint("volume").getAttribute("clip-path")).toBe(resB.clipUrl("volume"));
    expectRectParity(resB.byPaint("volume"), caseB, VOLUME_PAINT);

    // C: 64 down + 65 volume -> down stays 64 <rect>s, volume batches to <path>.
    const caseC = makeFinanceCase(64, 1, 1, 65);
    const resC = renderFinance(caseC);
    expect(resC.byPaint("down").children.every((el) => el.tagName === "rect")).toBe(true);
    expect(resC.byPaint("down").children).toHaveLength(64);
    expect(resC.byPaint("volume").children.every((el) => el.tagName === "path")).toBe(true);
    expect(resC.byPaint("volume").getAttribute("clip-path")).toBe(resC.clipUrl("volume"));
    expectRectParity(resC.byPaint("down"), caseC, DOWN_PAINT);
    expectPathParity(resC.byPaint("volume"), caseC, VOLUME_PAINT);

    // D: 65 down + 65 volume + hollow up + doji: verify live CSS expressions, hollow stroke, doji tick, and exact box parity.
    const caseD = makeFinanceCase(65, 2, 1, 65);
    const sharedRenderer = svgRendererWith(financeSvgMarks, fakeDocument());
    // Transition 64 -> 65 -> 64 -> 65 on the same renderer to verify mode switching on pooled slots.
    for (const staged of [caseA, caseD, caseA, caseD]) {
      const { all, byPaint, clipUrl } = renderFinance(staged, sharedRenderer);
      const priceClip = clipUrl("price");
      const volClip = clipUrl("volume");
      const downGroup = byPaint("down");
      const volGroup = byPaint("volume");
      const upPath = byPaint("up");
      expect(downGroup.getAttribute("clip-path")).toBe(priceClip);
      expect(volGroup.getAttribute("clip-path")).toBe(volClip);
      expect(upPath.getAttribute("clip-path")).toBe(priceClip);
      expect(downGroup.style.getPropertyValue("color")).toBe(
        `var(--axylo-forced-series, var(--axylo-down, ${financeBindings.series[DOWN_PAINT]}))`,
      );
      expect(volGroup.style.getPropertyValue("color")).toBe(
        `var(--axylo-forced-series, var(--axylo-volume, ${financeBindings.series[VOLUME_PAINT]}))`,
      );
      expect(upPath.style.getPropertyValue("color")).toBe(
        `var(--axylo-forced-series, var(--axylo-up, ${financeBindings.series[UP_PAINT]}))`,
      );
      expect(upPath.style.getPropertyValue("fill")).toBe("none");
      expect(upPath.style.getPropertyValue("stroke")).toBe("currentColor");
      if (staged === caseD) {
        expectPathParity(downGroup, staged, DOWN_PAINT);
        expectPathParity(volGroup, staged, VOLUME_PAINT);
      } else {
        expectRectParity(downGroup, staged, DOWN_PAINT);
        expectRectParity(volGroup, staged, VOLUME_PAINT);
      }

      if (staged === caseD) {
        // Check hollow stroke width and doji horizontal tick.
        const downMark = financeRectsOf(staged.scene, DOWN_PAINT)!;
        const bodyW = downMark.xywh[2]!;
        expect(Number(upPath.getAttribute("stroke-width"))).toBeCloseTo(hollowStroke(bodyW), 5);
        const wick = all.find((el) => el.getAttribute("stroke-width") === "1.25")!;
        expect(wick.getAttribute("clip-path")).toBe(priceClip);
        if (staged.layout.kind !== "plot" || staged.layout.projection.kind !== "xy")
          throw new Error("expected xy");
        const round2 = (v: number) => Math.round(Math.fround(v) * 100) / 100;
        const dojiX = staged.layout.projection.x.map(65);
        const dojiY = round2(staged.layout.projection.y.map(105));
        expect(wick.getAttribute("d")).toContain(
          `M${round2(dojiX - bodyW / 2)} ${dojiY}L${round2(dojiX + bodyW / 2)} ${dojiY}`,
        );
      }
    }
  });

  it("matches an independent 2D cell-coverage oracle for checkerboards, L-shapes, subpixel seams, inset and missing/invalid cells", () => {
    type Box = readonly [number, number, number, number];
    const readBoxes = (d: string): Box[] =>
      [...d.matchAll(/M([^ ]+) ([^h]+)h([^v]+)v([^h]+)h-[^z]+z/g)].map(
        (m) => m.slice(1).map((s) => Math.round(Number(s) * 100)) as unknown as Box,
      );
    const cents = (v: number) => Math.round(Math.fround(v) * 100);

    function assertExactCoverage(actual: Box[], expected: Box[]) {
      const all = [...actual, ...expected];
      const edges = (axis: 0 | 1) =>
        [...new Set(all.flatMap((b) => [b[axis], b[axis] + b[axis + 2]!]))].sort((a, b) => a - b);
      const xs = edges(0),
        ys = edges(1);
      const hit = (boxes: Box[], x: number, y: number) =>
        boxes.some(([l, t, w, h]) => l <= x && x < l + w && t <= y && y < t + h);
      for (const y of ys) {
        for (const x of xs) {
          expect(hit(actual, x, y), `(${x},${y})`).toBe(hit(expected, x, y));
        }
      }
    }

    function build(cells: readonly GridValue[], cols: number, plot: Rect) {
      const rows = cells.length / cols;
      const s = stageHeatmap({
        data: heatmapGrid(rows, cols, (r, c) => cells[r * cols + c]),
        color: { bins: 2, domain: [0, 1] },
      });
      if (s.layout.kind !== "plot") throw new Error("expected plot");
      const scene = buildHeatmapScene(s.view, { ...s.layout, plot }, 1);
      return scene.marks.map((mark) => {
        const tag = cellTagOf(mark)!;
        return { key: tag.kind === "bin" ? tag.bin : tag.kind, boxes: (mark as RectMark).xywh };
      });
    }

    // 1. L-shape, inverted L-shape, missing and invalid neighbors (no inset: cw=4, ch=2).
    const lGrid: GridValue[] = [0, 0, 1, null, 0, 1, 1, "bad", 0, 0, 0, 1, null, "bad", 0, 1];
    const plotNoInset = { x: 4, y: 6, width: 16, height: 8 };
    const lMarks = build(lGrid, 4, plotNoInset);
    for (const [val, key] of [
      [0, 0],
      [1, 1],
      [null, "missing"],
      ["bad", "invalid"],
    ] as const) {
      const expected: Box[] = [];
      lGrid.forEach((v, idx) => {
        if (v === val)
          expected.push([400 + (idx % 4) * 400, 600 + Math.floor(idx / 4) * 200, 400, 200]);
      });
      const q = lMarks.find((m) => m.key === key)!.boxes;
      assertExactCoverage(readBoxes(cellPath(q)), expected);
      if (key === "missing") {
        expect(q.length / 4).toBe(expected.length);
        // Single diagonal per missing cell (2 M commands per cell).
        expect(hatchPath(q, false).match(/M/g)).toHaveLength(expected.length * 2);
      }
      if (key === "invalid") {
        expect(q.length / 4).toBe(expected.length);
        // Crossed diagonals per invalid cell (3 M commands per cell).
        expect(hatchPath(q, true).match(/M/g)).toHaveLength(expected.length * 3);
      }
    }

    // 2. Inset > 0 (large cells: cw=10, ch=10 -> inset=0.5): uniform grid MUST NOT merge at all.
    const uniform = Array<GridValue>(12).fill(0);
    const withInset = build(uniform, 4, { x: 0, y: 0, width: 40, height: 30 });
    expect(withInset[0]!.boxes.length / 4).toBe(12);

    // 3. Checkerboard (no inset): zero merges, exact cell count per bin.
    const checker = Array.from({ length: 16 }, (_, i) => ((i % 4) + Math.floor(i / 4)) % 2);
    const checkerMarks = build(checker, 4, { x: 0, y: 0, width: 12, height: 8 });
    expect(checkerMarks.map((m) => m.boxes.length / 4)).toEqual([8, 8]);

    // 4. Subpixel rounding seam (ch = 1.003 -> 1-cent gap between row 1 and row 2) vs overlap (ch = 1.006).
    const seamMarks = build(Array(8).fill(0), 2, { x: 0, y: 0, width: 4, height: 4.012 });
    expect(cellPath(seamMarks[0]!.boxes)).toBe("M0 0h4v2h-4zM0 2.01h4v2h-4z");
    const overlapMarks = build(Array(8).fill(0), 2, { x: 0, y: 0, width: 4, height: 4.024 });
    expect(cellPath(overlapMarks[0]!.boxes)).toBe("M0 0h4v4.03h-4z");

    // 5. Seeded property test over arbitrary 2D grids with fractional plot origins/dimensions.
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<GridValue>(0, 1, null, "bad"), { minLength: 20, maxLength: 20 }),
        fc.integer({ min: 1001, max: 2400 }),
        fc.integer({ min: 501, max: 1200 }),
        (cells, wMilli, hMilli) => {
          const plot = { x: 0.37, y: 0.63, width: wMilli / 100, height: hMilli / 100 };
          const cols = 5,
            rows = 4,
            cw = plot.width / cols,
            ch = plot.height / rows;
          const marks = build(cells, cols, plot);
          for (const [val, key] of [
            [0, 0],
            [1, 1],
            [null, "missing"],
            ["bad", "invalid"],
          ] as const) {
            const expected: Box[] = [];
            for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols;) {
                const start = c++;
                if (cells[r * cols + start] !== val) continue;
                if (typeof key === "number") while (c < cols && cells[r * cols + c] === val) c++;
                const x0 = Math.fround(plot.x + start * cw);
                const w = c === start + 1 ? cw : plot.x + (c - 1) * cw + cw - x0;
                expected.push([cents(x0), cents(plot.y + r * ch), cents(w), cents(ch)]);
              }
            }
            const q = marks.find((m) => m.key === key)?.boxes ?? new Float32Array(0);
            assertExactCoverage(readBoxes(cellPath(q)), expected);
          }
        },
      ),
      { seed: 20261128, numRuns: 30 },
    );
  });

  it("preserves matrix parity, AX182 duplicates and AX183 invalid values across row-major, interleaved and out-of-order columns", () => {
    const xCats = ["c0", "c1", "c2"];
    const yCats = ["r0", "r1"];

    // Canonical logical records (including duplicates for (r0,c1), invalid string, Infinity, out-of-category, null key, -0, null).
    const baseRecords = [
      { r: "r0", c: "c0", v: -0 },
      { r: "r0", c: "c1", v: 10 },
      { r: "r0", c: "c1", v: 99 }, // duplicate #1 (AX182)
      { r: "r0", c: "c1", v: "dup-bad" }, // duplicate #2 (AX182)
      { r: "r0", c: "c2", v: "oops" }, // invalid value (AX183)
      { r: "r1", c: "c0", v: Infinity }, // invalid non-finite (AX183)
      { r: "r1", c: "c1", v: null }, // missing (silent SLOT_NULL)
      { r: "r1", c: "c2", v: 25 },
      { r: "r1", c: "outside", v: 5 }, // outside x categories (AX183)
      { r: "", c: "c0", v: 5 }, // empty key (AX183)
    ];

    // Interleaved/out-of-order permutation preserving relative order of the (r0,c1) duplicate group.
    const interleaved = [
      baseRecords[7]!,
      baseRecords[1]!,
      baseRecords[5]!,
      baseRecords[8]!,
      baseRecords[0]!,
      baseRecords[2]!,
      baseRecords[4]!,
      baseRecords[9]!,
      baseRecords[6]!,
      baseRecords[3]!,
    ];

    function runNorm(table: Table) {
      const parsed = parseHeatmapInput({
        title: "Parity",
        x: { field: "c", categories: xCats },
        y: { field: "r", categories: yCats },
        value: "v",
        data: [{ r: "r0", c: "c0", v: 0 }],
      });
      const sink = new DiagnosticCollector();
      const resolved = resolveOptions("line", parsed.translated, sink);
      const frame = normalizeHeatmap(parsed.meta, { ...resolved, table, valid: true }, sink, {
        epoch: 1,
        revision: 1,
      });
      return { m: matrixOf(frame)!, diags: sink.inputs() };
    }

    const rowMajorRows = runNorm(rowsTable(baseRecords));
    const rowMajorCols = runNorm(
      columnsTable(
        {
          r: baseRecords.map((d) => d.r),
          c: baseRecords.map((d) => d.c),
          v: baseRecords.map((d) => d.v),
        },
        baseRecords.length,
      ),
    );
    const shuffledCols = runNorm(
      columnsTable(
        {
          r: interleaved.map((d) => d.r),
          c: interleaved.map((d) => d.c),
          v: interleaved.map((d) => d.v),
        },
        interleaved.length,
      ),
    );

    for (const candidate of [rowMajorCols, shuffledCols]) {
      expect(candidate.m.rows).toBe(2);
      expect(candidate.m.cols).toBe(3);
      expect([...candidate.m.values]).toEqual([...rowMajorRows.m.values]);
      expect(Object.is(candidate.m.values[0], -0)).toBe(true);
      expect([...candidate.m.state]).toEqual([
        SLOT_VALUE,
        SLOT_VALUE,
        SLOT_INVALID,
        SLOT_INVALID,
        SLOT_NULL,
        SLOT_VALUE,
      ]);
      expect([...candidate.m.bin]).toEqual([...rowMajorRows.m.bin]);
      expect(candidate.m.bin[2]).toBe(NO_BIN);
      expect(candidate.m.bin[3]).toBe(NO_BIN);
      expect(candidate.m.bin[4]).toBe(NO_BIN);
      expect(candidate.m.domain).toEqual(rowMajorRows.m.domain);
      expect([...candidate.m.duplicates]).toEqual([[1, { count: 2, values: [99, "dup-bad"] }]]);
      expect([...candidate.m.invalidText].sort((a, b) => a[0] - b[0])).toEqual([
        [2, '"oops"'],
        [3, "Infinity"],
      ]);
      expect(candidate.diags.find((d) => d.code === "AX182")?.count).toBe(2);
      expect(candidate.diags.find((d) => d.code === "AX183" && d.field === "v")?.count).toBe(2);
      expect(candidate.diags.find((d) => d.code === "AX183" && d.field === "r/c")?.count).toBe(2);
    }

    // Typed Float64Array column: NaN is silent SLOT_NULL, while Infinity is AX183 SLOT_INVALID.
    const typedRes = runNorm(
      columnsTable(
        {
          r: ["r0", "r0", "r0", "r1", "r1", "r1"],
          c: ["c0", "c1", "c2", "c0", "c1", "c2"],
          v: Float64Array.of(1, NaN, Infinity, -Infinity, -0, 4),
        },
        6,
      ),
    );
    expect([...typedRes.m.state]).toEqual([
      SLOT_VALUE,
      SLOT_NULL,
      SLOT_INVALID,
      SLOT_INVALID,
      SLOT_VALUE,
      SLOT_VALUE,
    ]);
    expect(typedRes.diags.find((d) => d.code === "AX183" && d.field === "v")).toMatchObject({
      count: 2,
      rows: [2, 3],
    });
  });
});
