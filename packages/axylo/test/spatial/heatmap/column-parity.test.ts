import { expect, it } from "vitest";
import {
  SLOT_INVALID,
  SLOT_NULL,
  SLOT_VALUE,
  type DiagnosticInput,
} from "../../../src/core/contracts";
import { resolveOptions } from "../../../src/data/options";
import { columnsTable, rowsTable, type Table } from "../../../src/data/table";
import { DiagnosticCollector } from "../../../src/diagnostics/collector";
import {
  matrixOf,
  NO_BIN,
  normalizeHeatmap,
  parseHeatmapInput,
} from "../../../src/spatial/heatmap/core";

// Resolve the encoding first, so the observation below is specifically of normalization's reads.
function normalize(table: Table, options: Record<string, unknown> = {}) {
  const parsed = parseHeatmapInput({
    title: "Cells",
    x: "x",
    y: "y",
    value: "v",
    data: [{ x: "x", y: "y", v: 0 }],
    ...options,
  });
  const sink = new DiagnosticCollector();
  const resolved = resolveOptions("line", parsed.translated, sink);
  const findings: DiagnosticInput[] = [];
  const frame = normalizeHeatmap(
    parsed.meta,
    { ...resolved, table, valid: true },
    {
      add(d) {
        findings.push(d);
        sink.add(d);
      },
    },
    { epoch: 2, revision: 3 },
  );
  return { m: matrixOf(frame)!, frame, findings, merged: sink.inputs() };
}

it("reads keys before values, skips unplaced and unsampled values, and preserves diagnostic and provenance order", () => {
  const seen: string[] = [];
  const x = ["a", "a", "a", "a", "a", "b", null, "c", "b"];
  const y = ["r", "r", "r", "r", "r", "r", "r", "r", "s"];
  const v = [2, 9, "duplicate", undefined, 99, NaN, 10, 11, 1];
  const rows = x.map((key, i) => ({
    get x() {
      seen.push("x" + i);
      return key;
    },
    get y() {
      seen.push("y" + i);
      return y[i];
    },
    get v() {
      seen.push("v" + i);
      if (i === 4 || i === 6 || i === 7) throw new Error("value outside the sample");
      return v[i];
    },
  }));
  const { m, frame, findings, merged } = normalize(
    { ...rowsTable(rows), rowIndex: (i) => i + 10 },
    {
      x: { field: "x", categories: ["b", "a"] },
      y: { field: "y", categories: ["r", "s"] },
      color: { domain: [10, 20] },
    },
  );
  expect(seen).toEqual([
    ...rows.flatMap((_, i) => ["x" + i, "y" + i]),
    "v0",
    "v1",
    "v2",
    "v3",
    "v5",
    "v8",
  ]);
  expect([...m.source]).toEqual([15, 10, 18, -1]);
  expect([...m.values]).toEqual([NaN, 2, 1, NaN]);
  expect([...m.state]).toEqual([SLOT_INVALID, SLOT_VALUE, SLOT_VALUE, SLOT_NULL]);
  expect([...m.bin]).toEqual([NO_BIN, 0, 0, NO_BIN]);
  expect([...m.duplicates]).toEqual([[1, { count: 4, values: [9, "duplicate", undefined] }]]);
  expect([...m.invalidText]).toEqual([[0, "NaN"]]);
  expect(merged.find((d) => d.code === "AX183" && d.field === "y/x")).toMatchObject({
    count: 2,
    rows: [16, 17],
  });
  expect([...frame.x.values]).toEqual([0, 1, 2, 3]);
  expect(findings.map((d) => [d.code, d.field, d.count, d.rows])).toEqual([
    ["AX182", "y/x", 4, [11, 12, 13, 14]],
    ["AX183", "v", 1, [15]],
    ["AX183", "y/x", 1, [16]],
    ["AX183", "y/x", 1, [17]],
    ["AX184", "color.domain", undefined, undefined],
  ]);
});

it("honors own fields, short arrays, and typed versus ordinary NaN", () => {
  const base = { x: ["a", "b", "c"], y: ["r", "r", "r"] };
  for (const [column, state] of [
    [Float64Array.of(NaN, -0), SLOT_NULL],
    [[NaN, -0], SLOT_INVALID],
  ] as const) {
    const { m } = normalize(columnsTable({ ...base, v: column }, 3));
    expect([...m.values]).toEqual([NaN, -0, NaN]);
    expect([...m.state]).toEqual([state, SLOT_VALUE, SLOT_NULL]);
    expect([...m.source]).toEqual([0, 1, 2]);
    expect([...m.invalidText]).toEqual(state === SLOT_INVALID ? [[0, "NaN"]] : []);
  }
  const inherited = Object.assign(Object.create({ v: Float64Array.of(2, 3, 4) }), base);
  const { m } = normalize(columnsTable(inherited, 3));
  expect([...m.state]).toEqual([SLOT_NULL, SLOT_NULL, SLOT_NULL]);
  expect([...m.bin]).toEqual([NO_BIN, NO_BIN, NO_BIN]);
  expect(m.domain).toBeNull();
  const missingKey = Object.assign(Object.create({ x: base.x }), { y: base.y, v: [11, 12, 13] });
  const { findings } = normalize(columnsTable(missingKey, 3));
  expect(findings.map((d) => [d.code, d.rows])).toEqual([["AX183", [0, 1, 2]]]);
});

it("evaluates an accessor column when each drawn or sampled value is read", () => {
  let next = 0;
  const table = columnsTable(
    {
      x: ["a", "a", "a", "a", "a", "b"],
      y: ["r", "r", "r", "r", "r", "r"],
      get v() {
        return new Float64Array(6).fill(++next);
      },
    },
    6,
  );
  const { m } = normalize(table);
  // The first access establishes the typed-missing policy. The fourth duplicate is counted without reading it.
  expect([...m.values]).toEqual([2, 6]);
  expect([...m.duplicates]).toEqual([[0, { count: 4, values: [3, 4, 5] }]]);
  expect(next).toBe(6);
});

it("reports AX134 before any value read and returns an empty frame", () => {
  const categories = Array.from({ length: 2001 }, (_, i) => String(i));
  const { findings, m, frame } = normalize(
    rowsTable([
      {
        x: 1,
        y: 1,
        get v() {
          throw new Error("unreachable");
        },
      },
    ]),
    {
      x: { field: "x", categories },
      y: { field: "y", categories },
    },
  );
  expect(findings.map((d) => [d.code, d.count])).toEqual([["AX134", 2001 * 2001]]);
  expect([frame.length, m.rows, m.cols, m.source.length, m.bin.length]).toEqual([0, 0, 0, 0, 0]);
});
