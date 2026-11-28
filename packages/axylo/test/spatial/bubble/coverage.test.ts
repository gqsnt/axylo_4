import { expect, it } from "vitest";
import { paintedMap } from "../../../src/spatial/bubble/paint";
import { expectedOwner, flatten, geometryOf, winding, type Disc } from "./oracle";

it("preserves holes, clear bands and off-plot arcs across horizontal and vertical cell boundaries", () => {
  const discs: Disc[] = [];
  function add(x: number, y: number, r: number, series: number) {
    discs.push({ x, y, r, series, row: discs.length });
  }
  // The top layer covers the interior by a union of discs. Along the edges the
  // larger discs still extend beyond the plot, and the zero rings expose the layer below.
  for (let y = 0; y <= 64; y += 8) {
    for (let x = 0; x <= 64; x += 8) add(x, y, 12, 0);
  }
  for (let y = 0; y <= 64; y += 4) {
    for (let x = 0; x <= 64; x += 4) add(x, y, 3, 1);
  }
  add(32, 32, 0, 2);
  add(64, 32, 0, 2);
  add(100, 100, 12, 0);
  add(100, 100, 7, 1);
  add(100, 100, 0, 2);
  const g = geometryOf(discs, 100, 100);
  const map = paintedMap(g, 3);
  const paths = map.series.map((s) => flatten(s.d));
  const probes = [
    [32.3, 32.3],
    [32, 33.85],
    [35.25, 31.7],
    [31.75, 35.75],
    [36.75, 31.7],
    [-6.3, 31.7],
    [31.7, -6.3],
    [70.7, 32],
    [32, 70.7],
    [-13.8, 31.7],
    [63.7, 32.3],
    [66.75, 32],
    [68.25, 32],
    [100, 100],
    [102, 100],
    [103, 100],
    [104, 100],
    [105.75, 100],
    [107.5, 100],
    [110, 100],
    [114.3, 99.7],
  ] as const;
  for (const [x, y] of probes) {
    const owner = expectedOwner(discs, g, x, y, 0.05);
    expect(owner, `edge clearance at (${x}, ${y})`).not.toBeNull();
    expect(
      paths.map((p) => winding(p, x, y) !== 0),
      `(${x}, ${y})`,
    ).toEqual(paths.map((_, i) => i === owner));
  }
  expect(map.circles).toBe(2 * discs.length + 2 * 3);
  expect(map.culled).toBeGreaterThan(0);
});

it("preserves contour joins at subpixel separations on either side of the coverage grid limit", () => {
  for (const delta of [0.0000005, 0.00000101, 0.004999, 0.005001]) {
    const discs: Disc[] = [];
    for (let y = -16; y <= 16; y += 4) {
      for (let x = -16; x <= 16; x += 4) {
        discs.push({ x, y, r: 3 + delta, series: discs.length % 2, row: discs.length });
      }
    }
    discs.push(
      { x: 0, y: 0, r: 10, series: 1, row: 81 },
      { x: 1, y: 1, r: 10 + delta, series: 2, row: 82 },
      { x: 2, y: 2, r: 15, series: 0, row: 83 },
    );
    // Extending the occupied box forces the full lower-neighbour scan without
    // changing any intersections in the three series under comparison.
    const map = paintedMap(geometryOf(discs, 64, 64), 3);
    const remote = { x: 2048, y: 0, r: 1, series: 3, row: 84 };
    const full = paintedMap(geometryOf([...discs, remote], 2100, 64), 4);
    expect(map.series).toEqual(full.series.slice(0, 3));
    expect(map.culled).toBeGreaterThan(0);
    expect(map.culled).toBe(full.culled);
  }
});

it("agrees with painter ownership on the seeded 50k trace geometry at separated interior and gap samples", () => {
  // S0a makeBubbleData: one series, default area scale and no zero sizes.
  const discs: Disc[] = [];
  let state = 1234567;
  const random = () => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;
  let max = 0;
  for (let row = 0; row < 50_000; row++) {
    const x = random() * 1000,
      y = random() * 500,
      size = 1 + random() * 99;
    max = Math.max(max, size);
    discs.push({ x, y, r: size, series: 0, row });
  }
  // Use the trace host's inner plot and numeric axes. Expected ownership is
  // computed on the Float32 positions that the renderer actually receives.
  for (const d of discs) {
    d.x = Math.fround(60.6953125 + (d.x / 1000) * 895.3046875);
    d.y = Math.fround(368.609375 - (d.y / 500) * 354.609375);
    d.r = Math.max(2, 24 * Math.sqrt(d.r / max));
  }
  const g = geometryOf(discs, 960, 432.609375);
  const map = paintedMap(g, 1);
  // An isolated second-series mark puts the occupied extent beyond the bitmap
  // limit. The first series then takes the full neighbour and lower-cut path.
  const remote: Disc = { x: 2100, y: 16, r: 1, row: discs.length, series: 1 };
  const reference = paintedMap(geometryOf([...discs, remote], 2200, 432.609375), 2);
  expect(map.series[0]).toEqual(reference.series[0]);
  expect(map.culled).toBe(reference.culled);
  expect(map.pairs).toBeLessThan(reference.pairs);
  expect(map.circles).toBe(100_000);
  expect(map.series).toHaveLength(1);

  // Only the competing higher discs can make an expected sample ambiguous.
  // Sample the plot and its margins, and require both paint and gap.
  const probes: { x: number; y: number; owner: number; sum: number }[] = [];
  for (let k = 0; k < 96; k++) {
    const x = 58 + random() * 903,
      y = 11 + random() * 362;
    for (let i = g.count - 1; i >= 0; i--) {
      const d = discs[g.order[i]!]!,
        distance = Math.hypot(x - d.x, y - d.y);
      if (distance >= d.r + 1.15) continue;
      if (Math.abs(distance - d.r) > 0.15 && distance < d.r + 0.85) {
        probes.push({ x, y, owner: distance < d.r ? 0 : -1, sum: 0 });
      }
      break;
    }
  }
  expect(new Set(probes.map((p) => p.owner))).toEqual(new Set([-1, 0]));
  expect(probes.length).toBeGreaterThan(40);
  for (const contour of map.series[0]!.d.match(/M[^Z]*Z/g)!) {
    const flat = flatten(contour);
    let lo = Infinity,
      hi = -Infinity;
    for (let i = 1; i < flat.length; i += 2) {
      lo = Math.min(lo, flat[i]!);
      hi = Math.max(hi, flat[i]!);
    }
    for (const p of probes) if (lo <= p.y && p.y <= hi) p.sum += winding(flat, p.x, p.y);
  }
  for (const p of probes) expect(p.sum !== 0, `(${p.x}, ${p.y})`).toBe(p.owner === 0);
});
