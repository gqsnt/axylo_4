import assert from "node:assert/strict";
import test from "node:test";
import { checkBarRectangles } from "../src/admission.js";

// The x scale is the identity and the single dense bar lane is 2 px wide.
// The first three and last two occupied columns are separated by a real gap.
const plot = { x: 0, y: 0, width: 10, height: 100 };
const x = [
  1.1, 1.3, 1.5, 1.8, 2.1, 2.2, 2.3, 2.6, 2.7, 3.1, 3.3, 3.4, 3.6, 3.8, 7.1, 7.2, 7.5, 7.8, 8.05,
  8.15, 8.2, 8.4, 8.5, 8.6, 8.7, 8.8,
];
const values = [
  5,
  2,
  10,
  NaN,
  5,
  -6,
  -7,
  2,
  20,
  -3,
  -0.2,
  -1,
  -2,
  -0.6,
  0.5,
  0.2,
  0.3,
  0.4,
  19,
  13,
  20,
  -9,
  -10,
  -5,
  8,
  2,
];
const domain = [-25, 25]; // zero at 50, two px per unit
const boxes = [
  [0, 30, 2, 20],
  [1, 10, 2, 40],
  [1, 50, 2, 14],
  [2, 50, 2, 6],
  [6, 49, 2, 1],
  [7, 10, 2, 40],
  [7, 50, 2, 20],
];
const check = (rects, y = domain) =>
  checkBarRectangles(x, values, rects.flat(), plot, [0, 10], [0, x.length - 1], "orders", y);

test("admits independently projected positive and negative extrema with a column gap", () => {
  assert.deepEqual(check(boxes), []);
});

test("rejects a missing width in an otherwise well-sized readback array", () => {
  const flat = boxes.flat();
  delete flat[2];
  assert.match(
    checkBarRectangles(x, values, flat, plot, [0, 10], [0, x.length - 1], "orders", domain).join(
      " ",
    ),
    /malformed/,
  );
});

test("classifies near-zero signs after SVG rounding on a fractional zero baseline", () => {
  const shifted = { ...plot, y: 0.004 };
  const read = (rects) =>
    checkBarRectangles(
      x,
      values,
      rects.flat(),
      shifted,
      [0, 10],
      [0, x.length - 1],
      "orders",
      domain,
    );
  assert.deepEqual(read(boxes), []);
  const wrong = boxes.map((b) => b.slice());
  wrong[4][1] = 50; // Only 0.004 px above zero at the start, then a full pixel down.
  assert.notDeepEqual(read(wrong), []);
});

for (const [name, mutate] of [
  [
    "narrow",
    (b) => {
      b[1][2] = 0.1;
    },
  ],
  [
    "short of the full two-pixel lane",
    (b) => {
      b[1][2] = 1;
    },
  ],
  [
    "excessive width",
    (b) => {
      b[1][2] = 4;
    },
  ],
  [
    "missing side",
    (b) => {
      b.splice(2, 1);
    },
  ],
  [
    "missing end of span",
    (b) => {
      b.shift();
    },
  ],
  [
    "invented column in the gap",
    (b) => {
      b.push([4, 20, 2, 30]);
    },
  ],
  [
    "duplicate coverage",
    (b) => {
      b.push(b[0]);
    },
  ],
  [
    "excessive height",
    (b) => {
      b[0] = [0, 22, 2, 28];
    },
  ],
  [
    "flattened extreme",
    (b) => {
      b[3][3] = 3;
    },
  ],
  [
    "wrong sign within 1.5 px of the baseline",
    (b) => {
      b[4] = [6, 50, 2, 1];
    },
  ],
  [
    "near-zero mark straddling the baseline",
    (b) => {
      b[4] = [6, 49.1, 2, 1];
    },
  ],
  [
    "wrong baseline",
    (b) => {
      for (const box of b) box[1] += 1;
    },
  ],
  [
    "fractional column shift",
    (b) => {
      b[0][0] += 0.5;
    },
  ],
]) {
  test(`rejects ${name}`, () => {
    const copy = boxes.map((b) => b.slice());
    mutate(copy);
    assert.notDeepEqual(check(copy), []);
  });
}

test("uses the committed domain for the scale, zero and height limit", () => {
  for (const bad of [undefined, [25, -25], [0, 18], [-30, 30]])
    assert.notDeepEqual(check(boxes, bad ?? null), []);
  const small = boxes.map(([x, y, w, h]) => [x, 50 + (y - 50) / 10, w, h / 10]);
  assert.match(check(small, [-250, 250]).join(" "), /tallest/);
});

test("checks every finite original slot when exact readback contains an internal gap", () => {
  const series = [5, NaN, 20, -10],
    x = [1, 2, 6, 8];
  const exact = [
    [0, 40, 2, 10],
    [5, 10, 2, 40],
    [7, 50, 2, 20],
  ];
  const read = (boxes) =>
    checkBarRectangles(x, series, boxes.flat(), plot, [0, 10], [0, 3], "orders", domain);
  assert.deepEqual(read(exact), []);
  assert.notDeepEqual(read([exact[0], exact[0], exact[2]]), []);
});

test("checks a dense envelope against the committed zoom window and domain", () => {
  // Zoomed to x in [2, 4] on a 4 px plot: two px per unit, so the 2 px lane's left edge is 2(x - 2) - 1.
  // The window holds slots 4..13 (x 2.1 to 3.8): ten values, more than two per pixel column.
  const narrow = { ...plot, width: 4 };
  const read = (rects) =>
    checkBarRectangles(x, values, rects.flat(), narrow, [2, 4], [4, 13], "orders", domain);
  // Column -1: slot 4 (+5) above, slots 5 and 6 (-6, -7) below. Column 0: slots 7 and 8 (+2, +20).
  // Column 1: slots 9 to 11 (-3, -0.2, -1). Column 2: slots 12 and 13 (-2, -0.6).
  const zoomed = [
    [-1, 40, 2, 10],
    [-1, 50, 2, 14],
    [0, 10, 2, 40],
    [1, 50, 2, 6],
    [2, 50, 2, 4],
  ];
  assert.deepEqual(read(zoomed), []);
  // Slot 2 (+10, x 1.5) lies before the window: a bar from outside the zoom is invented coverage.
  assert.notDeepEqual(read([[-2, 30, 2, 20], ...zoomed]), []);
  // The window's last column must be covered.
  assert.notDeepEqual(read(zoomed.slice(0, -1)), []);
  // Column 0's extreme 2 px short of slot 8 is outside the 1.5 px tolerance.
  assert.notDeepEqual(read([zoomed[0], zoomed[1], [0, 12, 2, 38], zoomed[3], zoomed[4]]), []);
  // Negative -0.2 in column 1 cannot be painted above zero even inside the pixel tolerance.
  assert.notDeepEqual(read([...zoomed.slice(0, 3), [1, 50, 2, 6], [1, 49, 2, 1], zoomed[4]]), []);
});
