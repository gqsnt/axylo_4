// Admission check: compares what a chart reports it shows (adapter.describe()) with what the fixture says it must show.
// Pure, runs in Node. A timing is accepted only for a run whose readback passes.

// Loose enough for axis padding and nice-number rounding, tight enough to catch a pinned or runaway range.
const X_SLACK = 0.1;        // visible x range may exceed the data's x extent by 10% of that extent on each side
const Y_LOOSENESS = 4;      // visible y span may be at most 4x the larger of the data's y span and its largest |y|
const X_EXACT_MS = 1;       // oldest/newest x must match to the millisecond

/**
 * @param {object} expected  from fixtures.expectedView
 * @param {object|null} seen from adapter.describe(): { x: [min, max], y: [min, max], series: [{ points, oldestX, newestX, missing? }], reads }
 * @returns {{ admitted: boolean, reasons: string[] }}
 */
export function checkView(expected, seen) {
  const reasons = [];
  if (!seen) return { admitted: false, reasons: ['describe() returned nothing'] };
  const num = v => typeof v === 'number' && Number.isFinite(v);
  const [x0, x1] = seen.x ?? [];
  const [y0, y1] = seen.y ?? [];
  if (!num(x0) || !num(x1)) reasons.push(`visible x range is not two finite numbers: ${JSON.stringify(seen.x)}`);
  if (!num(y0) || !num(y1)) reasons.push(`visible y range is not two finite numbers: ${JSON.stringify(seen.y)}`);
  if (reasons.length) return { admitted: false, reasons };

  const xSpan = expected.newestX - expected.oldestX;
  if (x0 > expected.oldestX + X_EXACT_MS || x1 < expected.newestX - X_EXACT_MS)
    reasons.push(`visible x [${x0}, ${x1}] does not contain the data's x extent [${expected.oldestX}, ${expected.newestX}]`);
  if (x0 < expected.oldestX - X_SLACK * xSpan || x1 > expected.newestX + X_SLACK * xSpan)
    reasons.push(`visible x [${x0}, ${x1}] is wider than the data's x extent plus ${X_SLACK * 100}% per side`);

  if (y0 > expected.yMin || y1 < expected.yMax)
    reasons.push(`visible y [${y0}, ${y1}] does not contain the data's y extent [${expected.yMin}, ${expected.yMax}]`);
  const scale = Math.max(expected.yMax - expected.yMin, Math.abs(expected.yMin), Math.abs(expected.yMax));
  if (y1 - y0 > Y_LOOSENESS * scale)
    reasons.push(`visible y span ${y1 - y0} is more than ${Y_LOOSENESS}x the data's scale ${scale}`);
  const ex = expected.extreme;
  if (!(ex.y >= y0 && ex.y <= y1)) reasons.push(`injected extreme y=${ex.y} at x=${ex.x} is outside visible y [${y0}, ${y1}]`);
  if (!(ex.x >= x0 && ex.x <= x1)) reasons.push(`injected extreme x=${ex.x} is outside visible x [${x0}, ${x1}]`);

  const ss = seen.series ?? [];
  if (ss.length !== expected.series) reasons.push(`chart holds ${ss.length} series, fixture has ${expected.series}`);
  ss.slice(0, expected.series).forEach((s, i) => {
    if (s.points !== expected.points) reasons.push(`series ${i}: chart holds ${s.points} points, fixture ${expected.points}`);
    if (!(Math.abs(s.oldestX - expected.oldestX) <= X_EXACT_MS)) reasons.push(`series ${i}: oldest x ${s.oldestX}, fixture ${expected.oldestX}`);
    if (!(Math.abs(s.newestX - expected.newestX) <= X_EXACT_MS)) reasons.push(`series ${i}: newest x ${s.newestX}, fixture ${expected.newestX}`);
    if (s.missing !== undefined && s.missing !== expected.missing[i]) reasons.push(`series ${i}: chart holds ${s.missing} missing values, fixture ${expected.missing[i]}`);
  });
  return { admitted: reasons.length === 0, reasons };
}

/** Several charts (W-page): every one must pass. */
export function checkViews(expectedList, seenList) {
  if (!Array.isArray(seenList) || seenList.length !== expectedList.length)
    return { admitted: false, reasons: [`expected ${expectedList.length} chart readbacks, got ${Array.isArray(seenList) ? seenList.length : typeof seenList}`] };
  const reasons = [];
  expectedList.forEach((e, i) => { for (const r of checkView(e, seenList[i]).reasons) reasons.push(`chart ${i}: ${r}`); });
  return { admitted: reasons.length === 0, reasons };
}
