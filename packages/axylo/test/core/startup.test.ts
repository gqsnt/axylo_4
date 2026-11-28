import fc from "fast-check";
import { expect, it, vi } from "vitest";
import { computeLayout, type LayoutInput } from "../../src/layout";
import { bandScale, linearScale, timeScale } from "../../src/scale";
import { LIGHT } from "../../src/theme/palette";
import { applyTheme, createThemeBatch, finalizeTheme, prepareTheme } from "../../src/theme/resolve";
import { lastModel, record } from "./host";
import { TestDocument } from "./n3-dom";

it("anchors each value label to its own tick while the category labels need fitting (F7, L5)", () => {
  const scales = { linear: linearScale, time: timeScale, band: bandScale };
  const yTicks = [0, 25, 100].map((value) => ({ value, label: String(value) }));
  const categories = Array.from({ length: 8 }, (_, value) => ({
    value,
    label: `Reporting department with a long category name ${value}`,
  }));
  fc.assert(
    fc.property(
      fc.integer({ min: 300, max: 500 }),
      fc.integer({ min: 240, max: 410 }),
      (width, height) => {
        const input: LayoutInput = {
          kind: "xy",
          width,
          height,
          scales,
          style: { font: "16px sans-serif", lineHeight: 16, letterSpacing: 0, wordSpacing: 0 },
          measurer: { width: (text) => text.length * 6 },
          x: {
            type: "band",
            count: categories.length,
            padding: 0,
            candidates: [categories],
            mayThin: false,
          },
          y: { domain: [0, 100], candidates: [yTicks], mayThin: true },
        };
        const widths = new Map<string, number>();
        // Exercise both the opening fit and a resize that keeps its measured widths.
        for (const size of [width, width + 20]) {
          const layout = computeLayout({ ...input, width: size }, widths);
          if (layout.kind !== "plot" || layout.projection.kind !== "xy")
            throw new Error("Expected a drawn plot");
          expect(layout.fit.x.remedies.length).toBeGreaterThan(0);
          const labels = layout.texts.filter((text) => text.role === "tick-y");
          expect(labels.map((label) => label.full)).toEqual(yTicks.map((tick) => tick.label));
          for (const [i, label] of labels.entries()) {
            expect(label.y).toBeCloseTo(layout.projection.y.map(yTicks[i]!.value));
            expect(label.box.width).toBe(label.full.length * 6);
            expect(label.box.x + label.box.width).toBeCloseTo(label.x);
            expect(label.x).toBeLessThan(layout.plot.x);
          }
        }
      },
    ),
    { numRuns: 50 },
  );
});

it("checks chart-specific backdrops and the live series paint before sharing contrast findings (L2, L4, AX141)", () => {
  const doc = new TestDocument();
  const win = doc.defaultView;
  const styleOf = win.getComputedStyle.bind(win);
  const firstColor = LIGHT.series[0]!;
  // Model only the computed custom properties read on these figures. A different effective series color
  // requires the probe phase; the browser theme suite covers the CSS engine's resolution of that paint.
  vi.spyOn(win, "getComputedStyle").mockImplementation((el) => {
    const style = styleOf(el);
    return {
      ...style,
      colorScheme: "normal",
      backgroundColor: String(el.style.backgroundColor || "rgb(255, 255, 255)"),
      getPropertyValue(name) {
        if (name === "--axylo-series-color-1") return String(el.style.seriesPaint ?? firstColor);
        const token = name.slice("--axylo-default-".length);
        if (name.startsWith("--axylo-default-") && Object.hasOwn(LIGHT, token))
          return String(LIGHT[token as keyof typeof LIGHT]);
        return style.getPropertyValue(name);
      },
    };
  });
  const batch = createThemeBatch(win as unknown as Window);
  function tile() {
    const el = doc.createElement("figure");
    doc.body.appendChild(el);
    return el;
  }
  function resolve(el: ReturnType<typeof tile>) {
    const p = prepareTheme(el as unknown as HTMLElement, ["y"], null, batch);
    applyTheme(p);
    return finalizeTheme(p, true);
  }
  const first = tile(),
    second = tile();
  const light = resolve(first)!;
  second.style.backgroundColor = firstColor;
  const matching = resolve(second)!;
  const charts = [light, matching].map((theme) => {
    const r = record("line", {
      title: "Visits",
      x: "x",
      y: "y",
      data: [
        { x: 1, y: 2 },
        { x: 2, y: 3 },
      ],
    });
    r.host.theme = () => theme;
    r.frames();
    return r;
  });
  try {
    expect(charts[0]!.controller.handle.diagnostics.filter((d) => d.code === "AX141")).toHaveLength(
      0,
    );
    expect(
      charts[1]!.controller.handle.diagnostics.filter((d) => d.code === "AX141"),
    ).toMatchObject([{ count: 1 }]);
    second.style.seriesPaint = "#123456";
    expect(resolve(second)).toBeNull();
    second.style.seriesPaint = firstColor;
    second.style.backgroundColor = "rgb(255, 255, 255)";
    second.style["--axylo-axis"] = LIGHT.axis;
    const restored = resolve(second)!;
    expect(restored.theme.paints).toEqual(light.theme.paints);
    second.style["--axylo-axis"] = "#123456";
    expect(resolve(second)).toBeNull();
  } finally {
    for (const chart of charts) chart.controller.handle.destroy();
  }
});

it("publishes a formatter disclosure raised after the first arrangement and measures the space its note uses (F12, AX160)", () => {
  const delivered: string[] = [];
  const r = record("line", {
    title: "Visits",
    x: "day",
    messages: { valuesChanged: "{count} value formatted with the default." },
    y: {
      field: "visits",
      format: (value: number) => {
        if (value === 6) throw Error("Cannot format six");
        return String(value);
      },
    },
    data: [3, 6, 9].map((visits, day) => ({ day, visits })),
    onDiagnostic: (d: { code: string }) => delivered.push(d.code),
  });
  const measure = r.host.measure;
  let reads = 0;
  r.host.measure = () => {
    if (++reads === 1) r.prepared[0]!.reader.table!.row(1);
    return measure();
  };
  r.frames();
  expect(r.models[0]!.note).toBeNull();
  expect(lastModel(r).note).toMatch(/1 value/i);
  expect(r.committed!.reader.note).toBe(lastModel(r).note);
  expect(delivered.filter((code) => code === "AX160")).toHaveLength(1);
  expect(reads).toBeGreaterThan(1);
  r.controller.handle.destroy();
});

it("keeps a finished batch handle inert while a different chart owns the reused frame", () => {
  const options = {
    title: "Visits",
    x: "x",
    y: "y",
    data: [
      { x: 1, y: 2 },
      { x: 2, y: 3 },
    ],
  };
  const first = record("line", { ...options, compact: true });
  const done = first.controller.beginFrame()!;
  done.phase1();
  done.after();
  first.controller.handle.destroy();
  const second = record("line", options);
  const fresh = second.controller.beginFrame()!;
  fresh.phase1();
  done.phase2();
  done.phase3Measure();
  done.phase5();
  done.after();
  expect(second.models).toHaveLength(0);
  expect(second.draws).toHaveLength(0);
  fresh.after();
  second.controller.flush();
  expect(lastModel(second).name).toBe("Visits");
  expect(second.draws).toHaveLength(1);
  second.controller.handle.destroy();
});

it("keeps a literal unit distinct from an omitted unit when reusing first-frame formatters (F6)", () => {
  const chart = record("line", {
    title: "Records",
    x: "x",
    y: { field: "count" },
    data: [
      { x: 1, count: 4 },
      { x: 2, count: 6 },
    ],
  });
  try {
    chart.frames();
    expect(chart.committed!.formatters.value(0, 4)).toBe("4");
    chart.controller.handle.update({ y: { field: "count", unit: "null" } });
    chart.frames();
    expect(chart.committed!.formatters.value(0, 4)).toBe("4 null");
    chart.controller.handle.update({ y: { field: "count" } });
    chart.frames();
    expect(chart.committed!.formatters.value(0, 4)).toBe("4");
  } finally {
    chart.controller.handle.destroy();
  }
});
