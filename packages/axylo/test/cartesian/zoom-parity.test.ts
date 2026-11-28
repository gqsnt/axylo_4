import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeAxisDomain } from "../../src/cartesian/axes";
import { buildBarSlotLayout } from "../../src/cartesian/bar-geom";
import { keep, linearPixels } from "../../src/cartesian/dense";
import {
  SLOT_GAP,
  SLOT_NO_ROW,
  SLOT_VALUE,
  type IndexRange,
  type Series,
} from "../../src/core/contracts";
import {
  denseSeries,
  fullStatistics,
  seriesSlots,
  withSignedZeros,
} from "../../src/data/store-statistics";
import { DiagnosticCollector } from "../../src/diagnostics/collector";
import { valueDomain } from "../../src/scale/domain";
import { continuous } from "../../src/scale/linear";
import { niceLogDomain } from "../../src/scale/log";
import { position } from "../../src/scene/geometry";
import { prepare, rng, run } from "./n4-pipeline";

// F2/F5. Form each connected run first, then independently choose its four
// representatives per occupied device column. Ties belong to the earliest slot.
function expectedSlots(
  y: Float64Array,
  slot: Uint8Array | null,
  range: IndexRange,
  pixel: (i: number) => number,
  ratio: number,
  limit: number,
  bridge: boolean,
  log: boolean,
) {
  const runs: number[][] = [];
  let run: number[] = [],
    count = 0;
  for (let i = range.start; i < range.end; i++) {
    const state = slot?.[i] ?? SLOT_VALUE;
    if (state === SLOT_VALUE && (!log || (y[i]! > 0 && Number.isFinite(y[i])))) {
      run.push(i);
      count++;
    } else if (!(bridge && state === SLOT_NO_ROW) && run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  const indexes: number[] = [],
    ends: number[] = [],
    isolated: number[] = [];
  for (const slots of runs) {
    if (slots.length === 1) {
      isolated.push(slots[0]!);
      continue;
    }
    if (count <= limit) indexes.push(...slots);
    else
      for (let k = 0; k < slots.length;) {
        const first = slots[k++]!,
          column = Math.floor(pixel(first) * ratio);
        let min = first,
          max = first,
          last = first;
        while (k < slots.length && Math.floor(pixel(slots[k]!) * ratio) === column) {
          last = slots[k++]!;
          if (y[last]! < y[min]!) min = last;
          if (y[last]! > y[max]!) max = last;
        }
        indexes.push(...Array.from(new Set([first, min, max, last])).sort((a, b) => a - b));
      }
    ends.push(indexes.length);
  }
  return {
    indexes: Uint32Array.from(indexes),
    isolated: Uint32Array.from(isolated),
    ends: Uint32Array.from(ends),
  };
}

describe("zoomed Cartesian columns", () => {
  it("keeps all three F5 buffers byte for byte across ties, gaps, NaNs, zoom edges and fractional DPR", () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer({ min: 520, max: 3000 }),
        fc.boolean(),
        fc.constantFrom(1, 1.25, 2.5),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (seed, n, sparse, ratio, log, bridge, reversed) => {
          const random = rng(seed),
            epoch = 1_700_000_000_000;
          let t = epoch;
          const xs = Float64Array.from({ length: n }, () => (t += random() < 0.04 ? 2048 : 1));
          const y = Float64Array.from(xs, () => Math.floor(random() * 7) - 3);
          for (let i = 0; i < n; i += 29) y[i] = NaN;
          for (let i = 2; i < n; i += 57) y[i] = -0;
          const slot = sparse
            ? Uint8Array.from(xs, () =>
                random() < 0.1 ? SLOT_GAP : random() < 0.2 ? SLOT_NO_ROW : SLOT_VALUE,
              )
            : null;
          const fields = {
            key: "v",
            label: "v",
            field: "v",
            unit: null,
            valueScale: null,
            drawable: true,
            row: null,
            y,
          };
          const series: Series = slot ? { ...fields, slot } : denseSeries(fields, n);
          const range = { start: 7, end: n - 11 };
          const scale = continuous(
            "time",
            [xs[11]!, xs[n - 19]!],
            reversed ? [32.5, 0.5] : [0.5, 32.5],
          );
          const pixel = (i: number) => position(scale, xs[i]!);
          const fast = linearPixels(scale, xs[0]!, xs[n - 1]!)!;
          expect(fast).toBeDefined();
          for (const limit of [48, n]) {
            const expected = expectedSlots(y, slot, range, pixel, ratio, limit, bridge, log);
            for (let draw = 0; draw < 2; draw++) {
              expect(
                keep(y, slot, range, (i) => fast(xs[i]!), ratio, limit, bridge, log, true, series),
              ).toEqual(expected);
            }
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it("keeps ordered extrema in complete cached windows, including all-NaN blocks and NaN column starts", () => {
    const y = new Float64Array(4096).fill(5);
    y.fill(NaN, 256, 512);
    y[712] = y[910] = -7;
    y[1541] = y[1799] = 13;
    y[2048] = NaN;
    y[2151] = -17;
    const series = denseSeries({
      key: "v",
      field: "v",
      label: "v",
      drawable: true,
      unit: null,
      valueScale: null,
      row: null,
      y,
    });
    const pixel = (i: number) => Math.floor(i / 2048);
    for (const start of [0, 0, 11, 0]) {
      const range = { start, end: y.length };
      expect(keep(y, null, range, pixel, 1, 8, true, false, true, series)).toEqual(
        expectedSlots(y, null, range, pixel, 1, 8, true, false),
      );
    }
    expect(seriesSlots(series)).toBeNull();
  });

  it("probes columns sublinearly even on the first million-slot draw", () => {
    const n = 1_000_000,
      width = 640,
      y = new Float64Array(n);
    y[512] = -1;
    y[1024] = 1;
    let calls = 0;
    const kept = keep(
      y,
      null,
      { start: 0, end: n },
      (i) => {
        calls++;
        return (i * width) / n;
      },
      1,
      4 * width,
      true,
      false,
      true,
    );
    expect(kept.indexes.slice(0, 4)).toEqual(Uint32Array.of(0, 512, 1024, 1562));
    expect(calls).toBeLessThan(32 * width);
    expect(kept.ends).toEqual(Uint32Array.of(2 * width + 2));
    expect(kept.isolated).toHaveLength(0);
  });

  it("uses the scale fallback when affine interpolation could overflow or lose an endpoint", () => {
    expect(
      linearPixels(continuous("linear", [-1e308, 1e308], [0, 640]), -1e308, 1e308),
    ).toBeUndefined();
    expect(linearPixels(continuous("linear", [0, 1], [1e20, 1]), 0, 1)).toBeUndefined();
    expect(linearPixels(continuous("time", [2, 2], [0, 640]), 2, 2)).toBeUndefined();
  });
});

const makeAxis = (stacked: boolean) =>
  prepare({
    title: "Axis",
    data: [{ x: 0, a: 1, b: 2 }],
    x: "x",
    axes: { v: { position: "left" } },
    layers: [{ type: stacked ? "bar" : "line", y: ["a", "b"], yAxis: "v", stacked }],
  });

describe("zoomed Cartesian domains", () => {
  it("matches a per-slot domain calculation for linear, positive log and signed stacks", () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer({ min: 520, max: 1100 }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (seed, n, stacked, positive, gapped) => {
          const {
              frame,
              stateRef: { meta },
            } = makeAxis(stacked),
            random = rng(seed);
          const series = frame.series.map((s) => {
            const slot = Uint8Array.from({ length: n }, () =>
              gapped && random() < 0.2 ? SLOT_GAP : SLOT_VALUE,
            );
            const y = Float64Array.from(slot, (st) =>
              st !== SLOT_VALUE
                ? NaN
                : positive
                  ? 1 + Math.floor(random() * 80)
                  : Math.floor(random() * 121) - 60,
            );
            return { ...s, y, slot };
          });
          const input = { ...frame, length: n, series };
          for (const scale of stacked ? (["linear"] as const) : (["linear", "log"] as const)) {
            const axis = { ...meta.axes[0]!, scale };
            for (const range of [
              { start: 0, end: n },
              { start: 3, end: n - 2 },
              { start: 87, end: 149 },
              { start: 0, end: n },
            ]) {
              let lo = Infinity,
                hi = -Infinity;
              for (let i = range.start; i < range.end; i++) {
                const values = series.filter((s) => s.slot[i] === SLOT_VALUE).map((s) => s.y[i]!);
                if (stacked && values.length) {
                  lo = Math.min(
                    lo,
                    values.reduce((a, v) => a + Math.min(0, v), 0),
                  );
                  hi = Math.max(
                    hi,
                    values.reduce((a, v) => a + Math.max(0, v), 0),
                  );
                } else
                  for (const v of values) {
                    if (scale === "log" && v <= 0) continue;
                    lo = Math.min(lo, v);
                    hi = Math.max(hi, v);
                  }
              }
              const expected =
                scale === "log"
                  ? niceLogDomain(lo, hi, axis.base)
                  : valueDomain({ min: lo, max: hi, includeZero: stacked }).domain;
              const result = computeAxisDomain(
                input,
                [true, true],
                range,
                axis,
                [],
                meta,
                new DiagnosticCollector(),
              );
              expect(result).toEqual({ domain: expected, hasPositive: true, error: false });
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("keeps the first zero sign on full and partial ranges without materializing dense slots", () => {
    const {
      frame,
      stateRef: { meta },
      sink,
    } = makeAxis(false);
    const n = 800;
    for (const zero of [-0, 0]) {
      const y = new Float64Array(n).fill(Number.MAX_VALUE);
      y[1] = zero;
      y[8] = -zero;
      const s = denseSeries({ ...frame.series[0]!, y }, n, () => {
        throw new Error("materialized dense slots");
      });
      fullStatistics.set(
        s,
        withSignedZeros({ min: zero, max: Number.MAX_VALUE, last: Number.MAX_VALUE }, 3),
      );
      for (const end of [n, n - 1, n - 1]) {
        const result = computeAxisDomain(
          { ...frame, length: n, series: [s] },
          [true],
          { start: 0, end },
          meta.axes[0]!,
          [],
          meta,
          sink,
        );
        expect(result.domain).toEqual([zero, Number.MAX_VALUE]);
        expect(seriesSlots(s)).toBeNull();
      }
    }
  });

  it("includes a repeated positive scatter row when its first observation is nonpositive", () => {
    const rows = Array.from({ length: 700 }, (_, x) => ({ x, y: -1 }));
    rows.push({ x: 10, y: 250 }, { x: 630, y: 3 });
    const {
      frame,
      stateRef: { meta },
      sink,
    } = prepare({
      title: "Repeat",
      data: rows,
      x: "x",
      axes: { v: { position: "left", scale: "log" } },
      layers: [{ type: "scatter", y: "y", yAxis: "v" }],
    });
    const axis = meta.axes[0]!;
    const domain = (start: number, end: number) =>
      computeAxisDomain(frame, [true], { start, end }, axis, [], meta, sink).domain;
    expect(domain(0, 700)).toEqual(niceLogDomain(3, 250));
    expect(domain(0, 601)).toEqual(niceLogDomain(250, 250));
    expect(domain(20, 600)).toEqual(niceLogDomain(3, 250));
    expect(
      sink
        .inputs()
        .filter((d) => d.code === "AX171")
        .map((d) => d.count),
    ).toEqual([700]);
    expect(sink.inputs().some((d) => d.code === "AX172")).toBe(false);
  });

  it("uses full-data log fallback for empty windows and refuses references as a substitute for positive data", () => {
    const {
      frame,
      stateRef: { meta },
    } = makeAxis(false);
    const n = 1024,
      axis = { ...meta.axes[0]!, scale: "log" as const };
    const test = (
      series: Series,
      start: number,
      refs: { axis: "y"; from: number; to: number; label: string }[] = [],
    ) => {
      const sink = new DiagnosticCollector();
      const r = computeAxisDomain(
        { ...frame, length: n, series: [series] },
        [true],
        { start, end: n },
        axis,
        refs,
        meta,
        sink,
      );
      return { r, codes: sink.inputs().map((d) => d.code) };
    };
    const y = new Float64Array(n).fill(NaN),
      slot = new Uint8Array(n).fill(SLOT_GAP);
    y[0] = 10;
    slot[0] = SLOT_VALUE;
    const s = { ...frame.series[0]!, y, slot };
    const fallback = test(s, 1);
    expect(fallback.r.domain).toEqual(niceLogDomain(10, 10));
    expect(fallback.codes).toEqual([]);
    const absent = test({ ...s, slot: new Uint8Array(n).fill(SLOT_GAP) }, 1, [
      { axis: "y", from: 100, to: 100, label: "target" },
    ]);
    expect(absent.codes).toEqual(["AX172"]);
    expect(absent.r.error).toBe(true);
  });
});

it("writes identical independent bar bytes for the scene and the shared lookup geometry", () => {
  fc.assert(
    fc.property(fc.integer(), fc.boolean(), fc.boolean(), (seed, pin, zoom) => {
      const random = rng(seed);
      let t = 1_700_000_000_000;
      const x = Float64Array.from({ length: 1050 }, () => (t += 1 + Math.floor(random() * 4)));
      const y = Float64Array.from(x, (_, i) =>
        i % 31 === 0 ? -0 : i % 5 < 2 ? 6.25 : i % 5 === 2 ? 262.25 : random() * 180 - 50,
      );
      const chart = run(
        {
          title: "Bars",
          data: { columns: { x, y } },
          x: { field: "x", type: "time" },
          axes: { v: { position: "left", domain: pin ? [-12, 17] : undefined } },
          layers: [{ type: "bar", y: "y", yAxis: "v" }],
        },
        { width: 671, height: 389, zoom: zoom ? [x[112]!, x[931]!] : null },
      );
      const {
        view,
        layout,
        scene,
        stateRef: { meta },
      } = chart;
      if (layout.kind !== "plot") throw new Error("expected plot");
      const geometry = buildBarSlotLayout(view, layout.projection, layout.plot, meta, [0])(0)!;
      const mark = scene.marks.find((m) => m.type === "rects");
      if (mark?.type !== "rects") throw new Error("expected bar rectangles");
      const { start, end } = view.visibleSlots;
      const expected = new Float32Array(4 * (end - start));
      for (let i = start; i < end; i++) geometry.write(i, expected, 4 * (i - start));
      expect(new Uint32Array(mark.xywh.buffer, mark.xywh.byteOffset, mark.xywh.length)).toEqual(
        new Uint32Array(expected.buffer),
      );
    }),
    { numRuns: 20 },
  );
});
