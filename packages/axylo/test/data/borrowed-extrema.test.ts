import fc from "fast-check";
import { expect, it } from "vitest";
import { alignedStatistics } from "../../src/view";
import { aligned } from "./helpers";

it.each([Float64Array, Float32Array])(
  "preserves zero signs, ordered ties and the last observation in a borrowed %s",
  (Column) => {
    const sample = fc.constantFrom(-12.25, -1, -0, 0, 1, 12.25, NaN);
    fc.assert(
      fc.property(
        fc.array(sample, { minLength: 1, maxLength: 12 }),
        fc.constantFrom(1, 120, 255, 256, 1024),
        (pattern, count) => {
          const x = Float64Array.from({ length: count }, (_, i) => i);
          const y = new Column(count);
          for (let i = 0; i < count; i++) y[i] = pattern[i % pattern.length]!;
          const { frame } = aligned({
            data: { columns: { x, y } },
            x: { field: "x", type: "number" },
            y: "y",
          });
          const series = frame.series[0]!;
          expect(series.y).toBe(y);
          const finite = Array.from(y).filter(Number.isFinite);
          const min = Math.min(...finite),
            max = Math.max(...finite),
            last = finite.at(-1) ?? NaN;
          expect(alignedStatistics(series, 0, count)).toEqual({
            min: finite.find((v) => v === min) ?? Infinity,
            max: finite.find((v) => v === max) ?? -Infinity,
            last,
          });
          expect(alignedStatistics(series, 0, count, true)).toEqual({ min, max, last });
        },
      ),
    );
  },
);
