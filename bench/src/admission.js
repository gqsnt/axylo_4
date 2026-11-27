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

import { groupedDonut } from './fixtures.js';

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
export function checkDrawnPixels(x, col, pixels, xDomain, yDomain, { window, seriesY }, label, taken = new Set()) {
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
  // One stroke per series: a stroke already taken by another series cannot stand for this one.
  const stroke = strokes.find(s => !taken.has(s) && hasNear(s, fx, fy) && hasNear(s, lx, ly));
  if (!stroke) return [`${label}: no ${taken.size ? 'other ' : ''}drawn stroke passes through the first visible point (${fx.toFixed(1)}, ${fy.toFixed(1)}) px and the last (${lx.toFixed(1)}, ${ly.toFixed(1)}) px`];
  taken.add(stroke);
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
  // A gap is bridged when one continuous polyline (pen down throughout) has a vertex at or before the last finite
  // point and a later vertex at or after the next one: however many short segments it uses to get across.
  for (const [pa, pb, a, b] of gaps) {
    let hit = false;
    for (const p of stroke.polylines) {
      let before = false;
      for (let i = 0; i + 1 < p.length; i += 2) {
        if (p[i] <= pa + 0.5) before = true;
        else if (before && p[i] >= pb - 0.5) { hit = true; break; }
      }
      if (hit) break;
    }
    if (hit) { bridged++; if (examples.length < 3) examples.push(`indices ${a}..${b}, ${(pb - pa).toFixed(1)} px`); }
  }
  if (bridged) reasons.push(`${label}: ${bridged} of ${gaps.length} resolvable gaps are crossed by one continuous drawn path (${examples.join('; ')})`);
  return reasons;
}

/**
 * Kept-index readback (Axylo's `__bench.describe().series[i].kept` without run boundaries): the caller's row
 * indexes the simplified drawing kept, in drawing order. Checked: in range, in order, none at a missing value,
 * covering the visible data, the data's extremes in the window kept. Not checkable from a flat list: whether two
 * consecutive kept indexes on either side of a gap are joined or broken (gap topology); with `breaks` (offsets at
 * which a new run starts) the adapter reports kind 'indices' instead, which is checked in full.
 */
export function checkKept(col, kept, { window, seriesY }, label) {
  const reasons = [];
  if (!Array.isArray(kept) || !kept.length) return [`${label}: the chart reports no kept indexes`];
  let prev = -1, lo = Infinity, hi = -Infinity, atMissing = 0, disorder = 0;
  for (const i of kept) {
    if (!Number.isInteger(i) || i < 0 || i >= col.length) { reasons.push(`${label}: kept index ${i} outside the ${col.length} rows`); return reasons; }
    if (i < prev) disorder++;
    prev = i;
    const v = col[i];
    if (v !== v) { atMissing++; continue; }
    if (i >= window[0] && i <= window[1]) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  if (disorder) reasons.push(`${label}: ${disorder} kept indexes out of drawing order`);
  if (atMissing) reasons.push(`${label}: ${atMissing} kept indexes at missing source values`);
  const [first, last] = finiteBounds(col, window[0], window[1]);
  if (first >= 0) {
    if (kept[0] > first || kept[kept.length - 1] < last) reasons.push(`${label}: kept indexes [${kept[0]}, ${kept[kept.length - 1]}] do not cover the visible data [${first}, ${last}]`);
    if (lo !== seriesY[0] || hi !== seriesY[1]) reasons.push(`${label}: kept extremes [${lo}, ${hi}] are not the data's extremes [${seriesY[0]}, ${seriesY[1]}] in the visible window`);
  }
  return reasons;
}

/**
 * Scatter point geometry (probe runs): the centres of the markers the chart drew, in CSS px of the plot container.
 * Every point is drawn (count), the drawn centres span where the data's extremes map (x and y), and a marker sits
 * where the injected extreme maps. An empty renderer shell has no markers and fails.
 */
export function checkScatterPoints(x, col, points, xDomain, yDomain, extreme, label, window = [0, col.length - 1]) {
  const { plot, centers } = points;
  if (!Array.isArray(centers) || centers.length === 0) return [`${label}: the chart drew no point markers`];
  if (!plot || !(plot.width > 0) || !(plot.height > 0)) return [`${label}: no plot rectangle in the point readback`];
  const reasons = [];
  const [X0, X1] = xDomain, [Y0, Y1] = yDomain;
  const px = v => plot.x + ((v - X0) / (X1 - X0)) * plot.width;
  const py = v => plot.y + ((Y1 - v) / (Y1 - Y0)) * plot.height;
  const n = centers.length / 2;
  let finite = 0, xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (let i = window[0]; i <= window[1]; i++) if (col[i] === col[i]) { finite++; xmin = Math.min(xmin, x[i]); xmax = Math.max(xmax, x[i]); ymin = Math.min(ymin, col[i]); ymax = Math.max(ymax, col[i]); }
  if (n !== finite) reasons.push(`${label}: ${n} point markers drawn for ${finite} points`);
  let cx0 = Infinity, cx1 = -Infinity, cy0 = Infinity, cy1 = -Infinity, hit = false;
  const ex = px(extreme.x), ey = py(extreme.y);
  for (let i = 0; i + 1 < centers.length; i += 2) {
    const cx = centers[i], cy = centers[i + 1];
    if (cx < cx0) cx0 = cx; if (cx > cx1) cx1 = cx; if (cy < cy0) cy0 = cy; if (cy > cy1) cy1 = cy;
    if (Math.abs(cx - ex) <= PX_TOLERANCE && Math.abs(cy - ey) <= PX_TOLERANCE) hit = true;
  }
  if (!hit) reasons.push(`${label}: no marker at the injected extreme (${ex.toFixed(1)}, ${ey.toFixed(1)}) px`);
  const off = (a, b) => !(Math.abs(a - b) <= PX_TOLERANCE);
  if (off(cx0, px(xmin)) || off(cx1, px(xmax))) reasons.push(`${label}: markers span x ${cx0.toFixed(1)}..${cx1.toFixed(1)} px, the data ${px(xmin).toFixed(1)}..${px(xmax).toFixed(1)} px`);
  if (off(cy0, py(ymax)) || off(cy1, py(ymin))) reasons.push(`${label}: markers span y ${cy0.toFixed(1)}..${cy1.toFixed(1)} px, the data ${py(ymax).toFixed(1)}..${py(ymin).toFixed(1)} px`);
  return reasons;
}

// Rectangles are read from the committed SVG or the contender's painted elements.
// Work in CSS pixels to allow SVG's two-decimal coordinate precision.
function checkRectangles(expected, seen, columns) {
  const histogram = expected.kind === 'histogram';
  const values = histogram ? [expected.counts] : columns?.ys;
  const { plot, rectangles, x, y } = seen;
  if (!plot || ![plot.x, plot.y, plot.width, plot.height].every(num) || !(plot.width > 0 && plot.height > 0)
    || !Array.isArray(y) || y.length !== 2 || !y.every(num) || !(y[0] <= 0 && y[1] > y[0])) return ['missing plot or invalid bar value domain'];
  if (!values || !Array.isArray(rectangles) || rectangles.length !== values.length) return ['wrong number of rendered bar series'];
  if (histogram && (!Array.isArray(x) || x.length !== 2 || !x.every(num) || !(x[0] <= expected.min && x[1] >= expected.max && x[1] > x[0]))) return ['sample extent is outside the histogram domain'];
  const py = v => plot.y + (y[1] - v) / (y[1] - y[0]) * plot.height;
  const px = v => plot.x + (v - x[0]) / (x[1] - x[0]) * plot.width;
  if (histogram && seen.binCounts !== undefined && seen.binCounts?.length !== expected.counts.length) return ['missing histogram count readback'];
  let observedTotal = 0;
  for (let s = 0; s < values.length; s++) {
    const bars = rectangles[s], col = values[s];
    if (!Array.isArray(bars) || bars.length !== col.length || !bars.length) return [`series ${s}: expected ${col.length} rectangles`];
    for (let i = 0; i < col.length; i++) {
      const bar = bars[i], value = col[i];
      if (!bar || ![bar.x, bar.y, bar.width, bar.height].every(num) || !(bar.width > 0)
        || !(bar.height >= 0 && (value === 0 || bar.height > 0))) return [`invalid rendered rectangle ${s}/${i}`];
      if (value > y[1] || bar.x < plot.x - 0.51 || bar.x + bar.width > plot.x + plot.width + 0.51
        || Math.abs(bar.y - py(value)) > 0.51 || Math.abs(bar.y + bar.height - py(0)) > 0.51) return [`clipped or incorrect rectangle ${s}/${i} for value ${value}`];
      if (histogram) {
        const edge = k => expected.min + (expected.max - expected.min) * (k / col.length);
        const rightGap = px(edge(i + 1)) - (bar.x + bar.width);
        // Native histogram bars may reserve one CSS pixel between adjacent bins.
        if (expected.max > expected.min && (Math.abs(bar.x - px(edge(i))) > 0.02
          || Math.min(Math.abs(rightGap), Math.abs(rightGap - 1)) > 0.02)) return [`wrong histogram bin edges at ${i}`];
        const count = seen.binCounts ? seen.binCounts[i] : Math.round(bar.height / plot.height * (y[1] - y[0]));
        if (Math.abs(bar.height - (py(0) - py(value))) > 0.006) return [`incorrect drawn height for bin ${i}`];
        if (count !== value) return [`bin ${i}: rendered count ${count}, expected ${value}`];
        observedTotal += count;
      } else {
        if (s > 0) {
          const previous = rectangles[s - 1][i];
          if (bar.x < previous.x + previous.width - 0.02) return [`overlapping grouped bars in category ${i}`];
        }
        const center = (bar.x + bar.width / 2 - plot.x) / plot.width * col.length;
        if (Math.floor(center) !== i) return [`bar ${s}/${i} is outside its category`];
      }
    }
  }
  if (histogram && observedTotal !== expected.points) return ['histogram bin total differs from observation count'];
  return [];
}

function checkSlices(expected, seen, columns) {
  const { slices, plot } = seen;
  if (!plot || ![plot.x, plot.y, plot.width, plot.height].every(num) || plot.width <= 0 || plot.height <= 0) return ['missing donut plot'];
  if (!columns || !Array.isArray(columns.labels) || columns.labels.length !== columns.values?.length) return ['missing donut columns'];
  if (!Array.isArray(slices) || !slices.length || slices.length !== columns.labels.length)
    return [`expected ${columns.labels.length} rendered donut slices, got ${slices?.length ?? 0}`];
  let total = 0;
  for (const [i, slice] of slices.entries()) {
    if (!slice || ![slice.sweep, slice.innerRadius, slice.outerRadius, slice.cx, slice.cy, slice.startAngle].every(num) || !(slice.sweep > 0 && slice.sweep <= 2 * Math.PI + 0.001)
      || !(slice.innerRadius > 0 && slice.outerRadius > slice.innerRadius)
      || !num(slice.value) || slice.value <= 0 || slice.value !== columns?.values[i] || slice.label !== columns.labels[i]) return [`invalid donut slice ${i}`];
    const r = slice.outerRadius;
    if (slice.cx - r < plot.x - 0.02 || slice.cy - r < plot.y - 0.02 ||
      slice.cx + r > plot.x + plot.width + 0.02 || slice.cy + r > plot.y + plot.height + 0.02) return [`clipped donut slice ${i}`];
    if (i) {
      const delta = slice.startAngle - slices[0].startAngle - 2 * Math.PI * total / expected.total;
      if (Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) > 2 / r + 0.001
        || Math.abs(slice.cx - slices[0].cx) > 0.02 || Math.abs(slice.cy - slices[0].cy) > 0.02) return [`misplaced donut slice ${i}`];
    }
    // The SVG renderer leaves a one-pixel separator at the mid-radius.
    if (Math.abs(slice.sweep - 2 * Math.PI * slice.value / expected.total) > 2 / slice.outerRadius + 0.001) return [`wrong angular extent for slice ${i}`];
    total += slice.value;
  }
  return total === expected.total ? [] : ['drawn slice sum differs from fixture total'];
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
  if (seen.cartesian) return checkCartesianView(expected, seen, opts);
  if (expected.cartesian === 'line+bar') {
    return { admitted: false, reasons: ['the dual-axis Cartesian workload needs the axylo/cartesian readback (series by key, line stroke, bar rectangles)'], limits };
  }
  if (expected.kind && seen.kind !== expected.kind) return { admitted: false, reasons: ['wrong chart kind'], limits };
  if (['bar', 'histogram', 'donut'].includes(expected.kind)) {
    if (opts.expectRenderer && seen.renderer?.kind !== opts.expectRenderer) reasons.push('wrong mark renderer');
    if (expected.kind === 'donut') {
      if (opts.columns?.values?.length !== expected.points) reasons.push('wrong number of donut inputs');
      const grouped = opts.library === 'Axylo' && expected.points > 8 && opts.columns?.values?.length === expected.points;
      reasons.push(...checkSlices(expected, seen, grouped ? groupedDonut(opts.columns) : opts.columns));
      if (grouped) limits.push(`Axylo groups ${expected.points} positive inputs into seven individual sectors and Other (F8)`);
    } else reasons.push(...checkRectangles(expected, seen, opts.columns));
    return { admitted: !reasons.length, reasons, limits };
  }
  if (expected.kind === 'area' && seen.areaFills !== expected.series && (opts.requireDrawn !== false || seen.areaFills !== undefined))
    reasons.push('missing rendered area fills');
  if (expected.kind && (!Array.isArray(seen.x) || !Array.isArray(seen.y)
    || !Array.isArray(seen.series) || seen.series.some(s => !s))) return { admitted: false, reasons: ['incomplete chart readback'], limits };
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
  if (x0 < vx0 - xSlack * xSpan - X_EXACT_MS || x1 > vx1 + xSlack * xSpan + X_EXACT_MS)
    reasons.push(`visible x [${x0}, ${x1}] is wider than the expected x range plus ${xSlack * 100}% per side`);

  if (y0 > expected.yMin || y1 < expected.yMax)
    reasons.push(`visible y [${y0}, ${y1}] does not contain the data's y extent [${expected.yMin}, ${expected.yMax}]`);
  const scale = Math.max(expected.yMax - expected.yMin, Math.abs(expected.yMin), Math.abs(expected.yMax));
  if (y1 - y0 > Y_LOOSENESS * scale)
    reasons.push(`visible y span ${y1 - y0} is more than ${Y_LOOSENESS}x the data's scale ${scale}`);
  if (expected.kind === 'area' && !(y0 <= 0 && y1 >= 0)) reasons.push('area domain excludes its zero baseline');
  const ex = expected.extreme;
  if (!(ex.y >= y0 && ex.y <= y1)) reasons.push(`${ex.injected === false ? 'extreme' : 'injected extreme'} y=${ex.y} at x=${ex.x} is outside visible y [${y0}, ${y1}]`);
  if (!(ex.x >= x0 && ex.x <= x1)) reasons.push(`${ex.injected === false ? 'extreme' : 'injected extreme'} x=${ex.x} is outside visible x [${x0}, ${x1}]`);

  const ss = seen.series ?? [];
  const taken = new Set();
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
    if (expected.kind && opts.requireDrawn !== false && (!opts.columns || d.kind === 'not-applicable')) {
      reasons.push(`series ${i}: missing evidence for ${expected.kind} marks`);
      return;
    }
    if (d.kind === 'not-captured') {
      if (opts.requireDrawn) reasons.push(`series ${i}: drawn geometry not captured (${d.reason}) in a run that must capture it`);
      else limits.push(`series ${i}: drawn geometry not captured in this run (${d.reason}); it was checked in the untimed probe run`);
      return;
    }
    if (d.kind === 'not-applicable') { limits.push(`series ${i}: drawn geometry not checked: ${d.reason}`); return; }
    if (d.kind === 'points') {
      if (!opts.columns) { limits.push(`series ${i}: point readback present but no columns given`); return; }
      if (!seen.drawnPoints) { if (opts.requireDrawn) reasons.push(`series ${i}: point geometry not captured in a run that must capture it`); else limits.push(`series ${i}: point geometry checked in the untimed probe run only`); return; }
      for (const r of checkScatterPoints(opts.columns.x, opts.columns.ys[i], seen.drawnPoints, [x0, x1], [y0, y1], expected.extreme, `series ${i}`, expected.kind === 'scatter' ? expected.window : undefined)) reasons.push(r);
      return;
    }
    if (!opts.columns) { limits.push(`series ${i}: drawn readback present but no columns given to check it against`); return; }
    const col = opts.columns.ys[i];
    if (d.kind === 'indices') for (const r of checkDrawnIndices(col, d, ctx, `series ${i}`)) reasons.push(r);
    else if (d.kind === 'kept') {
      for (const r of checkKept(col, d.kept, ctx, `series ${i}`)) reasons.push(r);
      if (seen.drawnPixels) for (const r of checkDrawnPixels(opts.columns.x, col, seen.drawnPixels, [x0, x1], [y0, y1], ctx, `series ${i}`, taken)) reasons.push(r);
      else if (opts.requireDrawn) reasons.push(`series ${i}: strokes not captured in a run that must capture them (gap topology)`);
      else limits.push(`series ${i}: kept indexes checked; gap topology needs run boundaries from the library or the probe run's strokes`);
    } else if (d.kind === 'pixels') {
      if (!seen.drawnPixels) reasons.push(`series ${i}: pixel readback announced but no captured strokes`);
      else for (const r of checkDrawnPixels(opts.columns.x, col, seen.drawnPixels, [x0, x1], [y0, y1], ctx, `series ${i}`, taken)) reasons.push(r);
    } else reasons.push(`series ${i}: unknown drawn readback kind ${JSON.stringify(d.kind)}`);
  });
  return { admitted: reasons.length === 0, reasons, limits };
}

/**
 * axylo/cartesian (bench/src/cartesian.js). Each fixture series is matched by key, never by position (the chart
 * holds its layers in declaration order). The line is admitted exactly as a root line on its own left axis: the
 * committed domain must contain that series' extent and the injected extreme, and its captured SVG stroke must
 * pass the drawn-pixel check. Kept indexes are refused: the shared root hook computes them with the root line
 * simplifier, which is not what this chart drew. The bars (right axis) are admitted from the painted rectangles.
 */
function checkCartesianView(expected, seen, opts) {
  const reasons = [], limits = [];
  const ss = Array.isArray(seen.series) ? seen.series : [];
  // The one-line workload is the root line fixture itself (same checksum): one series, so no order to confuse.
  const layout = expected.cartesian ?? (expected.series === 1 && !expected.kind ? 'line' : null);
  const names = expected.names ?? (layout === 'line' ? [ss[0]?.key] : []);
  if (!layout || names.length !== expected.series) {
    return { admitted: false, reasons: ['an axylo/cartesian readback for a fixture that is not a Cartesian workload'], limits };
  }
  if (seen.cartesian.layout !== layout) reasons.push(`chart layout ${seen.cartesian.layout}, fixture ${layout}`);
  if (ss.length !== expected.series) reasons.push(`chart readback has ${ss.length} series, fixture has ${expected.series}`);
  names.forEach((name, i) => { if (!ss[i] || ss[i].key !== name) reasons.push(`series ${name}: the chart holds no series with this key (held: ${JSON.stringify(seen.cartesian.heldKeys)})`); });
  if (reasons.length) return { admitted: false, reasons, limits };
  if (!opts.columns) return { admitted: false, reasons: ['no held columns to check the drawing against'], limits };

  const [line, ...rest] = ss;
  if (line.drawn?.kind === 'kept' || line.drawn?.kind === 'indices') {
    reasons.push(`line ${names[0]}: kept indexes are not evidence for axylo/cartesian (the shared hook reruns the root simplifier); the drawn stroke is required`);
  }
  const lineView = checkView(
    { ...expected, cartesian: undefined, names: undefined, series: 1, yMin: expected.seriesY[0][0], yMax: expected.seriesY[0][1], seriesY: [expected.seriesY[0]], missing: [expected.missing[0]] },
    { ...seen, cartesian: undefined, series: [line] },
    { ...opts, columns: { x: opts.columns.x, ys: [opts.columns.ys[0]] } },
  );
  for (const r of lineView.reasons) reasons.push(`line ${names[0]} (left axis): ${r}`);
  for (const l of lineView.limits) limits.push(`line ${names[0]} (left axis): ${l}`);

  rest.forEach((s, k) => {
    const i = k + 1, label = `bars ${names[i]} (right axis)`;
    if (s.points !== expected.points) reasons.push(`${label}: chart holds ${s.points} points, fixture ${expected.points}`);
    if (!(Math.abs(s.oldestX - expected.oldestX) <= X_EXACT_MS)) reasons.push(`${label}: oldest x ${s.oldestX}, fixture ${expected.oldestX}`);
    if (!(Math.abs(s.newestX - expected.newestX) <= X_EXACT_MS)) reasons.push(`${label}: newest x ${s.newestX}, fixture ${expected.newestX}`);
    if (s.missing !== expected.missing[i]) reasons.push(`${label}: chart holds ${s.missing} missing values, fixture ${expected.missing[i]}`);
    const bars = seen.cartesian.bars;
    if (!bars || bars.kind === 'not-captured') {
      if (opts.requireDrawn) reasons.push(`${label}: rectangles not captured in a run that must capture them`);
      else limits.push(`${label}: rectangles checked in the untimed probe run only`);
      return;
    }
    for (const r of checkBarRectangles(opts.columns.x, opts.columns.ys[i], bars.xywh, seen.cartesian.plot, seen.x, expected.window ?? [0, expected.points - 1], label, seen.cartesian.rightDomain)) reasons.push(r);
  });
  return { admitted: reasons.length === 0, reasons, limits };
}

/**
 * Bars of one series on a linear axis with the zero baseline (F1), from painted rectangles in source order.
 * The right axis's domain is not in the shared hook, so values are checked by proportion: every bar stands on one
 * zero baseline inside the plot, on the side of its value's sign; the n-th rectangle is the n-th drawn slot (a
 * clipped overscan neighbour on either side is allowed); its centre is at its x; its height is its value times the
 * one pixels-per-unit factor of the tallest bar (1 px); the window's extremes are drawn; the tallest bar is inside
 * the plot and at least a quarter of its height (the domain is not looser than Y_LOOSENESS).
 * Absolute check on top of the proportions: the right axis's committed domain (the Cartesian hook's drawn y axes)
 * must be finite, increasing, contain zero and the window's extremes; every bar of a nonzero value must have
 * positive width and height, and both its edges must sit within PX_TOLERANCE of zero and its value mapped onto the
 * CSS plot (domain[1] at plot.y). A clipped overscan neighbour may instead match that mapping clamped to the plot.
 */
export function checkBarRectangles(x, col, xywh, plot, xDomain, window, label, yDomain) {
  const reasons = [];
  if (!plot || !num(plot.x) || !num(plot.y) || !(plot.width > 0) || !(plot.height > 0)) return [`${label}: no plot rectangle`];
  if (!Array.isArray(xDomain) || !num(xDomain[0]) || !num(xDomain[1]) || !(xDomain[1] > xDomain[0])) return [`${label}: no committed x domain`];
  if (!Array.isArray(xywh) || xywh.length % 4 || !xywh.every(num)) return [`${label}: malformed rectangle readback`];
  const [i0, i1] = window;
  const slots = [];
  for (let i = i0; i <= i1; i++) if (Number.isFinite(col[i])) slots.push(i);
  const n = xywh.length / 4;
  if (!slots.length) return n ? [`${label}: ${n} rectangles for a window with no values`] : [];
  const extra = n - slots.length;
  if (extra < 0 || extra > 2) return [`${label}: ${n} rectangles, fixture has ${slots.length} values in the window (plus at most 2 clipped neighbours)`];
  const top = k => xywh[4 * k + 1], bottom = k => xywh[4 * k + 1] + xywh[4 * k + 3];
  let tall = 0;
  for (let j = 1; j < slots.length; j++) if (Math.abs(col[slots[j]]) > Math.abs(col[slots[tall]])) tall = j;
  const px = v => plot.x + ((v - xDomain[0]) / (xDomain[1] - xDomain[0])) * plot.width;
  const value = (s, k) => {
    const i = s + k;
    return i >= 0 && i < col.length ? col[i] : NaN;
  };
  // The first drawn slot: the window's first value or one of the clipped neighbours before it.
  let lead = null;
  for (let o = 0; o <= extra && lead === null; o++) {
    const first = slots[0] - o;
    if (!(Math.abs(px(x[first]) - (xywh[0] + xywh[2] / 2)) <= PX_TOLERANCE)) continue;
    lead = first;
  }
  if (lead === null) return [`${label}: the first rectangle is not at the x of the window's first value or a neighbour before it`];
  const kTall = slots[tall] - lead;
  // The baseline is the edge of the tallest bar on the side of zero (its bottom when positive).
  const zero = col[slots[tall]] >= 0 ? bottom(kTall) : top(kTall);
  if (!(zero >= plot.y - PX_TOLERANCE && zero <= plot.y + plot.height + PX_TOLERANCE)) reasons.push(`${label}: zero baseline ${zero} is outside the plot`);
  const height = Math.abs(col[slots[tall]]) > 0 ? xywh[4 * kTall + 3] / Math.abs(col[slots[tall]]) : NaN;
  if (!(xywh[4 * kTall + 3] >= plot.height / Y_LOOSENESS - PX_TOLERANCE)) reasons.push(`${label}: the tallest bar is ${xywh[4 * kTall + 3]} px of a ${plot.height} px plot (domain looser than ${Y_LOOSENESS}x)`);
  if (!(top(kTall) >= plot.y - PX_TOLERANCE)) reasons.push(`${label}: the tallest bar leaves the plot (domain does not cover the window's largest value)`);
  // Every rectangle in source order is checked: position, baseline, side and height. Constant work per bar.
  let wrong = 0, first = '';
  for (let k = 0; k < n; k++) {
    const v = value(lead, k);
    const want = Math.abs(v) * height;
    const sideOk = v >= 0 ? Math.abs(bottom(k) - zero) <= PX_TOLERANCE : Math.abs(top(k) - zero) <= PX_TOLERANCE;
    const inWindow = lead + k >= i0 && lead + k <= i1;
    const ok = Number.isFinite(v) && sideOk
      && (!inWindow || Math.abs(px(x[lead + k]) - (xywh[4 * k] + xywh[4 * k + 2] / 2)) <= PX_TOLERANCE)
      && (!inWindow || Math.abs(xywh[4 * k + 3] - want) <= PX_TOLERANCE);
    if (!ok && wrong++ === 0) first = `slot ${lead + k} (value ${v}): rectangle ${JSON.stringify(xywh.slice(4 * k, 4 * k + 4))}, expected height ${want.toFixed(2)} on baseline ${zero.toFixed(2)} at x ${px(x[lead + k]).toFixed(2)}`;
  }
  if (wrong) reasons.push(`${label}: ${wrong} rectangle(s) do not show their value; first: ${first}`);
  if (!Array.isArray(yDomain) || yDomain.length !== 2 || !num(yDomain[0]) || !num(yDomain[1]) || !(yDomain[1] > yDomain[0])) {
    reasons.push(`${label}: no valid committed right-axis domain (${JSON.stringify(yDomain ?? null)})`);
    return reasons;
  }
  let lo = 0, hi = 0;
  for (const s of slots) { if (col[s] < lo) lo = col[s]; if (col[s] > hi) hi = col[s]; }
  if (!(yDomain[0] <= lo && yDomain[1] >= hi)) reasons.push(`${label}: committed right-axis domain ${JSON.stringify(yDomain)} does not contain zero and the window's extremes [${lo}, ${hi}]`);
  const py = v => plot.y + ((yDomain[1] - v) / (yDomain[1] - yDomain[0])) * plot.height;
  const clamp = p => Math.min(plot.y + plot.height, Math.max(plot.y, p));
  const near = (got, want, inWindow) => Math.abs(got - want) <= PX_TOLERANCE || (!inWindow && Math.abs(got - clamp(want)) <= PX_TOLERANCE);
  let bad = 0, firstBad = '';
  for (let k = 0; k < n; k++) {
    const v = value(lead, k);
    const inWindow = lead + k >= i0 && lead + k <= i1;
    const wantTop = py(Math.max(v, 0)), wantBottom = py(Math.min(v, 0));
    const sized = v === 0 || (xywh[4 * k + 2] > 0 && xywh[4 * k + 3] > 0);
    const ok = Number.isFinite(v) && sized && near(top(k), wantTop, inWindow) && near(bottom(k), wantBottom, inWindow);
    if (!ok && bad++ === 0) firstBad = `slot ${lead + k} (value ${v}): rectangle ${JSON.stringify(xywh.slice(4 * k, 4 * k + 4))}, expected positive size with top ${wantTop.toFixed(2)} and bottom ${wantBottom.toFixed(2)} on domain ${JSON.stringify(yDomain)}`;
  }
  if (bad) reasons.push(`${label}: ${bad} rectangle(s) disagree with the committed right-axis mapping; first: ${firstBad}`);
  return reasons;
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
