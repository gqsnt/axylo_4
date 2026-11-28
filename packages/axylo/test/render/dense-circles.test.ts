import { expect, it, vi } from "vitest";
import type { PaintBindings } from "../../src/core/contracts";
import { createSvgRenderer, pathData } from "../../src/render/svg";
import { TOKEN_BINDINGS } from "../../src/theme";
import { fakeDocument, type FakeElement } from "../finance/fixtures";

function drawCircles(xy: Float32Array, radius: number): string {
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

it("draws two relative semicircles per finite pair at the dense threshold", () => {
  // A radius of 99.9 gives the longest eligible suffix. These centers span both sides of zero,
  // the rounding tie and the boundary of the packed decimal table.
  const pairs = [0, -0.25, -99.875, 0.125, 8.375, 999.875, -7123.75, 304.25, NaN, 0, 0, Infinity];
  const xy = Float32Array.from({ length: 4000 }, (_, i) => pairs[i % pairs.length]!);
  let expected = "";
  for (let i = 0; i < xy.length; i += 2) {
    const x = xy[i]!,
      y = xy[i + 1]!;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      expected += `M${(Math.round(10 * x) + 999) / 10} ${Math.round(10 * y) / 10}a99.9 99.9 0 11-199.8 0a99.9 99.9 0 11199.8 0`;
    }
  }
  expect(drawCircles(xy, 99.9)).toBe(expected);

  // Both coordinate strings take seven bytes: the last unaligned word needs padding after the last point.
  for (let i = 0; i < xy.length; i += 2) {
    xy[i] = 9999.875;
    xy[i + 1] = -9999.875;
  }
  expect(drawCircles(xy, 99.9)).toBe(
    "M10099.8 -9999.9a99.9 99.9 0 11-199.8 0a99.9 99.9 0 11199.8 0".repeat(2000),
  );
});

it("packs short and intermediate suffixes when the radius changes between draws", () => {
  const xy = new Float32Array(4000);
  for (let i = 0; i < xy.length; i += 2) {
    xy[i] = -9985.875;
    xy[i + 1] = -9999.875;
  }
  // The one-digit radius leaves seven padding bytes in the fourth word. The fractional radius needs a fifth word.
  expect(drawCircles(xy, 1)).toBe("M-9984.9 -9999.9a1 1 0 11-2 0a1 1 0 112 0".repeat(2000));
  expect(drawCircles(xy, 1.5)).toBe(
    "M-9984.4 -9999.9a1.5 1.5 0 11-3 0a1.5 1.5 0 113 0".repeat(2000),
  );
});

it("keeps both absolute endpoints below the threshold or when any finite pair is out of range", () => {
  const xy = new Float32Array(4000).fill(0.125);
  const circle = "M1.63 0.13A1.5 1.5 0 1 1 -1.37 0.13A1.5 1.5 0 1 1 1.63 0.13Z";
  expect(drawCircles(xy.subarray(0, 3998), 1.5)).toBe(circle.repeat(1999));
  xy[3998] = 10000;
  expect(drawCircles(xy, 1.5)).toBe(
    circle.repeat(1999) + "M10001.5 0.13A1.5 1.5 0 1 1 9998.5 0.13A1.5 1.5 0 1 1 10001.5 0.13Z",
  );
});

it("releases large scratch when the dense attempt falls back and the caller unwinds", () => {
  const xy = new Float32Array(4000);
  xy[3999] = -10000;
  const encode = vi.spyOn(TextEncoder.prototype, "encode").mockImplementationOnce(() => {
    throw new Error("encoding failed");
  });
  try {
    expect(() => drawCircles(xy, 7.7)).toThrow("encoding failed");
  } finally {
    encode.mockRestore();
  }
  const decode = vi.spyOn(TextDecoder.prototype, "decode");
  try {
    expect(pathData(Float32Array.of(1, 2))).toBe("M1 2");
    const input = decode.mock.calls[0]![0];
    expect(input).toBeInstanceOf(Uint8Array);
    expect((input as Uint8Array).buffer.byteLength).toBeLessThanOrEqual(16 * 1024);
  } finally {
    decode.mockRestore();
  }
});
