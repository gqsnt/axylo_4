// Admission check: compares what a chart reports it shows (adapter.describe()) with what the fixture says it must show.
// Pure, runs in Node. A timing is accepted only for a run whose readback passes.
//
// Two kinds of readback are checked:
//   held   what the chart's own state holds: visible ranges, per series the points, first and last x, and the
//          number of missing values (required from every adapter);
//   drawn  what the chart drew, which can differ from what it holds when the library decimates or simplifies:
//            kind 'indices'  the source indices the library selected for drawing, as connected paths (Chart.js
//                            after decimation, uPlot's data with its null breaks); index-exact checks;
//            kind 'pixels'   the polylines the library actually stroked, captured in an untimed probe run (Axylo:
//                            the SVG path data or the Canvas 2D moveTo/lineTo calls), mapped through the plot rectangle
//                            and the committed domains; checks at pixel resolution.
//          A drawn readback that retains two neighbouring points with a missing source value between them draws
//          a line across a gap the data has; one whose extremes are not the data's extremes in the visible window
//          lost the spike that a reader would look for. Both are rejected.

// Loose enough for axis padding and nice-number rounding, tight enough to catch a pinned or runaway range.
const X_SLACK = 0.1;        // visible x range may exceed the expected x range by 10% of that range on each side
const Y_LOOSENESS = 4;      // visible y span may be at most 4x the larger of the data's y span and its largest |y|
const X_EXACT_MS = 1;       // oldest/newest x must match to the millisecond
const PX_TOLERANCE = 1.5;   // drawn vertex positions: within 1.5 CSS px of where the datum maps
const PX_GAP_MIN = 2;       // a gap narrower than 2 CSS px cannot be told from a pen-up at pixel resolution

const num = v => typeof v === 'number' && Number.isFinite(v);

/** Prefix count of missing values: missingBetween(i, j) = number of NaN at indices i..j-1. */
function missingIndex(col) {
  const pre = new Int32Array(col.length + 1);
  for (let i = 0; i < col.length; i++) pre[i + 1] = pre[i] + (col[i] !== col[i] ? 1 : 0);
  return (i, j) => (j > i ? pre[j] - pre[i] : 0);
}

function finiteBounds(col, i0, i1) {
  let first = -1, last = -1;
  for (let i = i0; i <= i1; i++) if (col[i] === col[i]) { first = i; break; }
  for (let i = i1; i >= i0; i--) if (col[i] === col[i]) { last = i; break; }
  return [first, last];
}

/**
 * Index readback of one series: `paths` is a list of connected paths; each path is a flat list of inclusive index
 * ranges [start0, end0, start1, end1, ...] in drawing order. Inside a range every index is drawn and consecutive
 * indices are joined; between two ranges of one path the chart joins end_k to start_k+1 with one segment.
 */
export function checkDrawnIndices(col, drawn, { window, seriesY, scatter }, label) {
  const reasons = [];
  const n = col.length;
  const missing = missingIndex(col);
  if (!Array.isArray(drawn.paths) || drawn.paths.length === 0) return [`${label}: drawn readback has no paths`];
  let lo = Infinity, hi = -Infinity, minIdx = Infinity, maxIdx = -Infinity, bridges = 0, atMissing = 0;
  const examples = [];
  for (const path of drawn.paths) {
    if (!Array.isArray(path) || path.length % 2) { reasons.push(`${label}: a drawn path is not a list of index ranges`); continue; }
    let prevEnd = -1;
    for (let k = 0; k < path.length; k += 2) {
      const a = path[k], b = path[k + 1];
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b >= n || b < a) { reasons.push(`${label}: drawn range [${a}, ${b}] is outside the ${n} held points`); prevEnd = -1; continue; }
      if (prevEnd >= 0) {
        if (a <= prevEnd) reasons.push(`${label}: drawn ranges out of order (${prevEnd} then ${a})`);
        else if (!scatter && missing(prevEnd + 1, a) > 0) { bridges++; if (examples.length < 3) examples.push(`${prevEnd}->${a} across ${missing(prevEnd + 1, a)} missing`); }
      }
      if (missing(a, b + 1) > 0) atMissing += missing(a, b + 1);
      // Extremes only over the visible window: points drawn outside it are clipped.
      const from = Math.max(a, window[0]), to = Math.min(b, window[1]);
      for (let i = from; i <= to; i++) { const v = col[i]; if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; } }
      if (a < minIdx) minIdx = a;
      if (b > maxIdx) maxIdx = b;
      prevEnd = b;
    }
  }
  if (bridges) reasons.push(`${label}: ${bridges} drawn segments join retained neighbours across missing source values (${examples.join('; ')}): the drawing bridges gaps the data has`);
  if (atMissing) reasons.push(`${label}: ${atMissing} drawn points sit at missing source values`);
  const [first, last] = finiteBounds(col, window[0], window[1]);
  if (first >= 0) {
    if (minIdx > first || maxIdx < last) reasons.push(`${label}: drawn indices [${minIdx}, ${maxIdx}] do not cover the visible data [${first}, ${last}]`);
    if (lo !== seriesY[0] || hi !== seriesY[1]) reasons.push(`${label}: drawn extremes [${lo}, ${hi}] are not the data's extremes [${seriesY[0]}, ${seriesY[1]}] in the visible window`);
  }
  return reasons;
}

/**
 * Pixel readback (Axylo): `strokes` are the polylines one stroke operation drew (one SVG path element, or one
 * beginPath..stroke on the scene canvas), in CSS px of the plot container. The series is the stroke that passes
 * through the series' first and last visible data points. Its vertex extremes inside the plot must sit where the
 * data's extremes map, and no segment may run across a missing stretch at least PX_GAP_MIN wide.
 */
export function checkDrawnPixels(x, col, pixels, xDomain, yDomain, { window, seriesY }, label) {
  const reasons = [];
  const { plot, strokes } = pixels;
  if (Array.isArray(strokes) && strokes.length === 0) return [`${label}: the chart drew no line strokes${plot && plot.height < 20 ? ` (its plot area is ${plot.width}×${plot.height} px)` : ''}`];
  if (!plot || !num(plot.x) || !num(plot.y) || !(plot.width > 0) || !(plot.height > 0)) return [`${label}: no plot rectangle in the drawn readback`];
  if (!Array.isArray(strokes)) return [`${label}: no strokes in the drawn readback`];
  const [X0, X1] = xDomain, [Y0, Y1] = yDomain;
  const px = v => plot.x + ((v - X0) / (X1 - X0)) * plot.width;
  const py = v => plot.y + ((Y1 - v) / (Y1 - Y0)) * plot.height;
  const [first, last] = finiteBounds(col, window[0], window[1]);
  if (first < 0) return reasons;
  const near = (poly, tx, ty) => { for (let i = 0; i + 1 < poly.length; i += 2) if (Math.abs(poly[i] - tx) <= PX_TOLERANCE && Math.abs(poly[i + 1] - ty) <= PX_TOLERANCE) return true; return false; };
  const hasNear = (s, tx, ty) => s.polylines.some(p => near(p, tx, ty));
  const fx = px(x[first]), fy = py(col[first]), lx = px(x[last]), ly = py(col[last]);
  const stroke = strokes.find(s => hasNear(s, fx, fy) && hasNear(s, lx, ly));
  if (!stroke) return [`${label}: no drawn stroke passes through the first visible point (${fx.toFixed(1)}, ${fy.toFixed(1)}) px and the last (${lx.toFixed(1)}, ${ly.toFixed(1)}) px`];
  let top = Infinity, bottom = -Infinity;
  for (const p of stroke.polylines) for (let i = 0; i + 1 < p.length; i += 2) {
    if (p[i] < plot.x - 0.5 || p[i] > plot.x + plot.width + 0.5) continue;
    if (p[i + 1] < top) top = p[i + 1];
    if (p[i + 1] > bottom) bottom = p[i + 1];
  }
  const wantTop = py(seriesY[1]), wantBottom = py(seriesY[0]);
  if (!(Math.abs(top - wantTop) <= PX_TOLERANCE)) reasons.push(`${label}: highest drawn vertex at y=${top.toFixed(1)} px, the data's maximum ${seriesY[1]} maps to ${wantTop.toFixed(1)} px`);
  if (!(Math.abs(bottom - wantBottom) <= PX_TOLERANCE)) reasons.push(`${label}: lowest drawn vertex at y=${bottom.toFixed(1)} px, the data's minimum ${seriesY[0]} maps to ${wantBottom.toFixed(1)} px`);
  // Gaps wide enough to resolve: a missing stretch between finite neighbours a and b.
  const gaps = [];
  for (let i = window[0]; i <= window[1]; i++) {
    if (col[i] === col[i]) continue;
    let j = i; while (j + 1 <= window[1] && col[j + 1] !== col[j + 1]) j++;
    const a = i - 1, b = j + 1;
    if (a >= 0 && b < col.length && col[a] === col[a] && col[b] === col[b]) { const pa = px(x[a]), pb = px(x[b]); if (pb - pa >= PX_GAP_MIN) gaps.push([pa, pb, a, b]); }
    i = j;
  }
  let bridged = 0;
  const examples = [];
  for (const [pa, pb, a, b] of gaps) {
    let hit = false;
    for (const p of stroke.polylines) {
      for (let i = 0; i + 3 < p.length; i += 2) {
        const sx0 = Math.min(p[i], p[i + 2]), sx1 = Math.max(p[i], p[i + 2]);
        if (sx0 <= pa + 0.5 && sx1 >= pb - 0.5) { hit = true; break; }
      }
      if (hit) break;
    }
    if (hit) { bridged++; if (examples.length < 3) examples.push(`indices ${a}..${b}, ${(pb - pa).toFixed(1)} px`); }
  }
  if (bridged) reasons.push(`${label}: ${bridged} of ${gaps.length} resolvable gaps are crossed by one drawn segment (${examples.join('; ')})`);
  return reasons;
}

/**
 * @param {object} expected  from fixtures.expectedView
 * @param {object|null} seen from adapter.describe(): { x: [min, max], y: [min, max], renderer?, drawnPixels?,
 *                           series: [{ points, oldestX, newestX, missing, drawn }] }
 * @param {object} [opts]    { columns: { x, ys } the held columns (heldColumns), requireDrawn: boolean,
 *                           expectRenderer: 'canvas' | 'svg' | undefined }
 * @returns {{ admitted: boolean, reasons: string[], limits: string[] }}
 */
export function checkView(expected, seen, opts = {}) {
  const reasons = [], limits = [];
  if (!seen) return { admitted: false, reasons: ['describe() returned nothing'], limits };
  const [x0, x1] = seen.x ?? [];
  const [y0, y1] = seen.y ?? [];
  if (!num(x0) || !num(x1)) reasons.push(`visible x range is not two finite numbers: ${JSON.stringify(seen.x)}`);
  if (!num(y0) || !num(y1)) reasons.push(`visible y range is not two finite numbers: ${JSON.stringify(seen.y)}`);
  if (reasons.length) return { admitted: false, reasons, limits };

  if (opts.expectRenderer) {
    const kind = seen.renderer?.kind;
    if (kind !== opts.expectRenderer) reasons.push(`renderer: the committed chart has ${kind ? `${kind} marks (${seen.renderer.canvases} canvas, ${seen.renderer.svgs} svg)` : 'no renderer readback'}, the adapter was asked for ${opts.expectRenderer}`);
  }

  const [vx0, vx1] = expected.visibleX ?? [expected.oldestX, expected.newestX];
  const xSpan = vx1 - vx0, xSlack = expected.xSlack ?? X_SLACK;
  if (x0 > vx0 + X_EXACT_MS || x1 < vx1 - X_EXACT_MS)
    reasons.push(`visible x [${x0}, ${x1}] does not contain the expected x range [${vx0}, ${vx1}]`);
  if (x0 < vx0 - xSlack * xSpan || x1 > vx1 + xSlack * xSpan)
    reasons.push(`visible x [${x0}, ${x1}] is wider than the expected x range plus ${xSlack * 100}% per side`);

  if (y0 > expected.yMin || y1 < expected.yMax)
    reasons.push(`visible y [${y0}, ${y1}] does not contain the data's y extent [${expected.yMin}, ${expected.yMax}]`);
  const scale = Math.max(expected.yMax - expected.yMin, Math.abs(expected.yMin), Math.abs(expected.yMax));
  if (y1 - y0 > Y_LOOSENESS * scale)
    reasons.push(`visible y span ${y1 - y0} is more than ${Y_LOOSENESS}x the data's scale ${scale}`);
  const ex = expected.extreme;
  if (!(ex.y >= y0 && ex.y <= y1)) reasons.push(`${ex.injected === false ? 'extreme' : 'injected extreme'} y=${ex.y} at x=${ex.x} is outside visible y [${y0}, ${y1}]`);
  if (!(ex.x >= x0 && ex.x <= x1)) reasons.push(`${ex.injected === false ? 'extreme' : 'injected extreme'} x=${ex.x} is outside visible x [${x0}, ${x1}]`);

  const ss = seen.series ?? [];
  if (ss.length !== expected.series) reasons.push(`chart holds ${ss.length} series, fixture has ${expected.series}`);
  ss.slice(0, expected.series).forEach((s, i) => {
    if (s.points !== expected.points) reasons.push(`series ${i}: chart holds ${s.points} points, fixture ${expected.points}`);
    if (!(Math.abs(s.oldestX - expected.oldestX) <= X_EXACT_MS)) reasons.push(`series ${i}: oldest x ${s.oldestX}, fixture ${expected.oldestX}`);
    if (!(Math.abs(s.newestX - expected.newestX) <= X_EXACT_MS)) reasons.push(`series ${i}: newest x ${s.newestX}, fixture ${expected.newestX}`);
    if (s.missing === undefined) reasons.push(`series ${i}: no missing-value readback (required from every adapter)`);
    else if (s.missing !== expected.missing[i]) reasons.push(`series ${i}: chart holds ${s.missing} missing values, fixture ${expected.missing[i]}`);
    // Drawn readback.
    const d = s.drawn;
    const ctx = { window: expected.window ?? [0, expected.points - 1], seriesY: expected.seriesY?.[i] ?? [expected.yMin, expected.yMax], scatter: expected.scatter };
    if (!d) { if (opts.requireDrawn !== false) reasons.push(`series ${i}: no drawn readback`); return; }
    if (d.kind === 'not-captured') {
      if (opts.requireDrawn) reasons.push(`series ${i}: drawn geometry not captured (${d.reason}) in a run that must capture it`);
      else limits.push(`series ${i}: drawn geometry not captured in this run (${d.reason}); it was checked in the untimed probe run`);
      return;
    }
    if (d.kind === 'not-applicable') { limits.push(`series ${i}: drawn geometry not checked: ${d.reason}`); return; }
    if (!opts.columns) { limits.push(`series ${i}: drawn readback present but no columns given to check it against`); return; }
    const col = opts.columns.ys[i];
    if (d.kind === 'indices') for (const r of checkDrawnIndices(col, d, ctx, `series ${i}`)) reasons.push(r);
    else if (d.kind === 'pixels') {
      if (!seen.drawnPixels) reasons.push(`series ${i}: pixel readback announced but no captured strokes`);
      else for (const r of checkDrawnPixels(opts.columns.x, col, seen.drawnPixels, [x0, x1], [y0, y1], ctx, `series ${i}`)) reasons.push(r);
    } else reasons.push(`series ${i}: unknown drawn readback kind ${JSON.stringify(d.kind)}`);
  });
  return { admitted: reasons.length === 0, reasons, limits };
}

/** Several charts (W-page): every one must pass. */
export function checkViews(expectedList, seenList, optsList = []) {
  if (!Array.isArray(seenList) || seenList.length !== expectedList.length)
    return { admitted: false, reasons: [`expected ${expectedList.length} chart readbacks, got ${Array.isArray(seenList) ? seenList.length : typeof seenList}`], limits: [] };
  const reasons = [], limits = [];
  expectedList.forEach((e, i) => {
    const r = checkView(e, seenList[i], optsList[i] ?? {});
    for (const m of r.reasons) reasons.push(`chart ${i}: ${m}`);
    for (const m of r.limits) if (!limits.includes(m)) limits.push(m);
  });
  return { admitted: reasons.length === 0, reasons, limits };
}
