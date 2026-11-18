// What a comparison library drew, as index paths into the points it holds (admission.js, kind 'indices'). Pure:
// the adapters call these on the library's own state after the measured window, the tests call them in Node.
// A path is a flat list of inclusive index ranges [start0, end0, start1, end1, ...]; inside a range consecutive
// indices are joined, and the library joins end_k to start_k+1 with one segment.

/**
 * uPlot: its line path builder visits every index in the series' drawn index window (series.idxs) and breaks the
 * line at null unless spanGaps is set (default false). So the paths are the runs of non-null values inside that
 * window. This is uPlot's documented gap model, read from its own state; uPlot clips gaps at whole device pixels,
 * so a gap narrower than a pixel is not visible as a break (a limit this readback does not see; README).
 */
export function uplotDrawnPaths(col, idxs, spanGaps) {
  const [i0, i1] = idxs ?? [0, col.length - 1];
  const paths = [];
  let start = -1;
  const close = end => { if (start >= 0) { if (spanGaps && paths.length) paths[paths.length - 1].push(start, end); else paths.push([start, end]); } start = -1; };
  for (let i = i0; i <= i1; i++) {
    if (col[i] == null || col[i] !== col[i]) close(i - 1);
    else if (start < 0) start = i;
  }
  close(i1);
  return paths;
}

/** First index i with xs[i] >= v. */
function lowerBound(xs, v) {
  let lo = 0, hi = xs.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (xs[mid] < v) lo = mid + 1; else hi = mid; }
  return lo;
}

/**
 * Chart.js: the points the line controller draws, in order (with the decimation plugin active, the decimated copy
 * in dataset.data; its points are the original {x, y} objects, so each maps back to its held index by x). Chart.js
 * breaks the line at a point whose y is null or NaN unless spanGaps is set (default false).
 */
export function chartjsDrawnPaths(drawnPoints, heldX, spanGaps) {
  const paths = [];
  let path = null, rs = -1, re = -1;
  const flush = () => { if (rs >= 0) path.push(rs, re); rs = re = -1; };
  for (const p of drawnPoints) {
    const y = p?.y;
    if (y == null || y !== y) { if (!spanGaps) { flush(); if (path?.length) paths.push(path); path = null; } continue; }
    const i = lowerBound(heldX, p.x);
    if (!path) path = [];
    // min-max decimation can emit one point twice (a column's first point is also its minimum): a zero-length
    // segment, not a new range.
    if (rs >= 0 && i === re) continue;
    if (rs >= 0 && i === re + 1) re = i;
    else { flush(); rs = re = i; }
  }
  flush();
  if (path?.length) paths.push(path);
  return paths;
}

/**
 * Theme check of one state: every series mark shows the color the library assigns that series in the current
 * scheme. `state` = { expected: [color per series], marks: [color per series mark] }, colors already normalized.
 * Returns null when they agree, else what differs.
 */
export function themeMismatch(state) {
  if (state.marks.length !== state.expected.length) return `${state.marks.length} series marks for ${state.expected.length} series`;
  const bad = state.marks.map((m, i) => (m !== state.expected[i] ? `series ${i} ${m}, expected ${state.expected[i]}` : null)).filter(Boolean);
  return bad.length ? bad.join('; ') : null;
}
