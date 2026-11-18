/**
 * The checkers the suite's verdicts rest on, kept apart so each has a negative control
 * (negative-controls.browser.test.ts): separators against a calibrated 1 px control, marker shape class on
 * a grayscale image, motion tracked frame by frame with the page's own clock, reference marks as painted,
 * and a dense series' spike in its own column.
 */
import type { Page } from 'playwright-core';
import { box, center, contrast, distance, interiorColor, modeColor, pixel, ring, screenshot, settle, shapes, type Box, type Image, type RGB } from './util';
import type { ChartType } from './fixtures';
import { gray, minimumDistance, VISIONS } from './vision';

// ── separators ─────────────────────────────────────────────────────────────────────────────────────

export interface Seam { from: number; to: number; coverage: number; at: { x: number; y: number } }

/** Image pixels along a line through `origin` (image px) in direction `dir`, `half` px each way, without repeats. */
export function scanLine(origin: { x: number; y: number }, dir: { x: number; y: number }, half: number): { x: number; y: number }[] {
  const len = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / len, uy = dir.y / len;
  const out: { x: number; y: number }[] = [];
  let prev = '';
  for (let t = -half; t <= half; t += 0.125) {
    const x = Math.floor(origin.x + ux * t), y = Math.floor(origin.y + uy * t);
    const key = `${x},${y}`;
    if (key !== prev) { out.push({ x, y }); prev = key; }
  }
  return out;
}

/**
 * Walks `points` and, at every change from one mark colour to another, sums the background the pixels in
 * between show: each pixel's projection on the line from the nearer mark colour to the background (1 for
 * pure background, 0 for pure mark). A pixel within `tolerance` of a mark colour belongs to that mark.
 */
export function seams(img: Image, points: readonly { x: number; y: number }[], colors: readonly RGB[], bg: RGB, tolerance = 24): Seam[] {
  const out: Seam[] = [];
  let last = -1, coverage = 0;
  let mid: { x: number; y: number } = { x: 0, y: 0 };
  for (const p of points) {
    if (p.x < 0 || p.y < 0 || p.x >= img.width || p.y >= img.height) continue;
    const c = pixel(img, p.x, p.y);
    let k = -1, d = Infinity;
    colors.forEach((m, i) => { const e = distance(c, m); if (e < d) { d = e; k = i; } });
    if (d <= tolerance) {
      if (last >= 0 && k !== last) out.push({ from: last, to: k, coverage, at: mid });
      last = k;
      coverage = 0;
      continue;
    }
    const m = colors[k]!;
    const w = [bg[0] - m[0], bg[1] - m[1], bg[2] - m[2]] as const;
    const len = w[0] * w[0] + w[1] * w[1] + w[2] * w[2] || 1;
    coverage += Math.min(1, Math.max(0, ((c[0] - m[0]) * w[0] + (c[1] - m[1]) * w[1] + (c[2] - m[2]) * w[2]) / len));
    mid = p;
  }
  return out;
}

/**
 * Calibration: in the same page (same rasteriser, same device pixel ratio), two rects in `colors` with a
 * gap of `gap` CSS px between them, rotated so the gap runs at `angle` (radians, 0 = a horizontal seam),
 * at the four quarter-pixel offsets. Returns the smallest seam coverage measured across the gap, scanned
 * the same way as the chart's seams. A 1 px control gives the floor a real 1 px separator must reach.
 */
export async function controlCoverage(page: Page, colors: readonly [RGB, RGB], bg: RGB, gap: number, angle = 0): Promise<number> {
  let worst = Infinity;
  for (const offset of [0, 0.25, 0.5, 0.75]) {
    await page.evaluate(({ colors, bg, gap, angle, offset }) => {
      document.getElementById('seam-control')?.remove();
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.id = 'seam-control';
      svg.setAttribute('width', '80');
      svg.setAttribute('height', '80');
      svg.style.cssText = `position: fixed; left: 0; top: 0; z-index: 99999; background: rgb(${bg.join(',')});`;
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('transform', `rotate(${(angle * 180) / Math.PI} 40 40)`);
      const y = 40 + offset - gap / 2;
      for (const [i, [y0, h]] of ([[0, y], [y + gap, 80 - y - gap]] as const).entries()) {
        const r = document.createElementNS(NS, 'rect');
        r.setAttribute('x', '-40'); r.setAttribute('width', '160');
        r.setAttribute('y', String(y0)); r.setAttribute('height', String(h));
        r.setAttribute('fill', `rgb(${colors[i]!.join(',')})`);
        g.appendChild(r);
      }
      svg.appendChild(g);
      document.body.appendChild(svg);
    }, { colors: colors as unknown as number[][], bg: bg as unknown as number[], gap, angle, offset });
    const { img, scale } = await screenshot(page, '#seam-control', { x: 0, y: 0, width: 80, height: 80 });
    const normal = { x: -Math.sin(angle), y: Math.cos(angle) };
    const found = seams(img, scanLine({ x: 40 * scale, y: (40 + offset) * scale }, normal, 20 * scale), colors, bg);
    worst = Math.min(worst, found.length ? Math.min(...found.map(f => f.coverage)) : 0);
  }
  await page.evaluate(() => document.getElementById('seam-control')?.remove());
  return worst;
}

// ── marker shape class on a grayscale image ─────────────────────────────────────────────────────────

/**
 * The shape class of the ink blob around `center` (image px) in a grayscale conversion of `img`: ink is a
 * pixel whose luma differs from the backdrop's by more than half the blob's own contrast. Classes come
 * from two measures that do not depend on size: how much of its bounding box the blob fills, and whether
 * its ink sits evenly above and below its middle.
 */
export function shapeClass(img: Image, center: { x: number; y: number }, radius: number, backdrop: RGB): string {
  const bgLuma = gray(backdrop);
  let peak = 0;
  for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) peak = Math.max(peak, Math.abs(gray(pixel(img, center.x + x, center.y + y)) - bgLuma));
  const ink = (x: number, y: number) => Math.abs(gray(pixel(img, center.x + x, center.y + y)) - bgLuma) > peak / 2;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, n = 0;
  for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) if (ink(x, y)) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (!n) return 'none';
  const fill = n / ((x1 - x0 + 1) * (y1 - y0 + 1));
  const midY = (y0 + y1) / 2;
  let top = 0, bottom = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (ink(x, y)) { if (y < midY) top++; else if (y > midY) bottom++; }
  const tilt = (top - bottom) / Math.max(1, top + bottom);
  if (fill >= 0.9) return 'square';
  if (fill >= 0.68) return 'round';
  if (Math.abs(tilt) > 0.2) return tilt < 0 ? 'triangle-up' : 'triangle-down';
  if (fill >= 0.4) return 'diamond';
  return 'thin';
}

// ── motion, frame by frame, on the page's clock ─────────────────────────────────────────────────────

export interface MotionTrace {
  /** Page-clock ms from the action to each frame, the frame's visual signature, and running animations. */
  frames: { t: number; signature: string; animations: number }[];
  /** Page-clock ms from the action to the first frame whose signature equals the final one, held after. */
  settledAt: number;
  /** Animations or transitions on the chart's elements seen at any frame. */
  animated: boolean;
}

/**
 * Runs `action` in the page (create, update…) and records every following frame for `watch` ms: a
 * signature of what the marks paint (markup plus computed opacity, transform, fill, stroke and path data of
 * each mark) and the number of running animations on the chart's elements. `performance.now()` is read
 * inside the page around the frames, never across the test harness.
 */
export async function traceMotion(page: Page, action: string, watch = 1500, selector = '#chart'): Promise<MotionTrace> {
  return page.evaluate(async ({ action, watch, selector }) => {
    const root = () => document.querySelector(selector);
    const signature = () => {
      const scene = document.querySelector(`${selector} svg.axylo-svg .axylo-scene`);
      if (!scene) return '';
      let s = scene.innerHTML.replace(/axylo-clip-\d+/g, 'clip');
      for (const el of [scene, ...scene.querySelectorAll('*')]) {
        const c = getComputedStyle(el);
        s += `|${c.opacity},${c.transform},${c.fill},${c.stroke},${(c as unknown as { d?: string }).d ?? ''}`;
      }
      return s;
    };
    const running = () => document.getAnimations().filter(a => {
      const t = (a.effect as KeyframeEffect | null)?.target;
      return t instanceof Element && root()?.contains(t) && a.playState === 'running';
    }).length;
    const frames: { t: number; signature: string; animations: number }[] = [];
    const t0 = performance.now();
    // eslint-disable-next-line no-new-func
    new Function(action)();
    await new Promise<void>(resolve => {
      const step = () => {
        const t = performance.now() - t0;
        frames.push({ t, signature: signature(), animations: running() });
        if (t >= watch) resolve(); else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    // Settled: from the first frame after which the picture never changes again and no animation runs.
    const final = frames.at(-1)!.signature;
    let settled = frames.length - 1;
    while (settled > 0 && frames[settled - 1]!.signature === final && frames[settled - 1]!.animations === 0) settled--;
    if (frames[settled]!.animations > 0) settled = frames.length - 1;
    return { frames: frames.map(f => ({ ...f, signature: f.signature.length > 200 ? String(f.signature.length) + ':' + f.signature.slice(-120) : f.signature })), settledAt: frames[settled]!.t, animated: frames.some(f => f.animations > 0) };
  }, { action, watch, selector });
}

// ── reference marks as painted ──────────────────────────────────────────────────────────────────────

export interface ReferenceMark { kind: 'line' | 'band'; box: Box; paint: string }

/** The scene elements painted with the reference colour (`--axylo-reference`), as viewport boxes. */
export async function referenceMarks(page: Page, selector = '#chart'): Promise<ReferenceMark[]> {
  return page.evaluate(selector => {
    const out: { kind: 'line' | 'band'; box: { x: number; y: number; width: number; height: number }; paint: string }[] = [];
    for (const el of document.querySelectorAll<SVGGraphicsElement>(`${selector} svg.axylo-svg .axylo-scene *`)) {
      if (!/--axylo-reference/.test(el.style.getPropertyValue('color'))) continue;
      const r = el.getBoundingClientRect();
      const kind = r.width > 2.5 && r.height > 2.5 ? 'band' : 'line';
      out.push({ kind, box: { x: r.x, y: r.y, width: r.width, height: r.height }, paint: getComputedStyle(el).color });
    }
    return out;
  }, selector);
}

// ── a dense series' spike in its own column ─────────────────────────────────────────────────────────

/** The stroked line vertices of colour slot `slot`, in viewport px, and where the pen lifts between runs. */
export async function strokeRuns(page: Page, slot = 1, selector = '#chart'): Promise<{ x: number; y: number }[][]> {
  return page.evaluate(({ slot, selector }) => {
    const svg = document.querySelector(`${selector} svg.axylo-svg`) as SVGSVGElement;
    const m = svg.getScreenCTM()!;
    const runs: { x: number; y: number }[][] = [];
    for (const el of svg.querySelectorAll<SVGPathElement>('.axylo-scene path')) {
      if (!new RegExp(`--axylo-series-color-${slot}\\b`).test(el.style.getPropertyValue('color')) || el.style.getPropertyValue('stroke') !== 'currentcolor') continue;
      for (const sub of (el.getAttribute('d') ?? '').split(/(?=M)/)) {
        const nums = sub.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
        const run: { x: number; y: number }[] = [];
        for (let i = 0; i + 1 < nums.length; i += 2) { const p = new DOMPoint(nums[i]!, nums[i + 1]!).matrixTransform(m); run.push({ x: p.x, y: p.y }); }
        if (run.length) runs.push(run);
      }
    }
    return runs;
  }, { slot, selector });
}

/** Whether a stroke segment passes over `x` (more than `slack` px on either side of it): a line drawn across a gap. */
export function bridges(runs: readonly { x: number; y: number }[][], x: number, slack = 1): boolean {
  return runs.some(run => run.some((p, i) => i > 0 && Math.min(run[i - 1]!.x, p.x) < x - slack && Math.max(run[i - 1]!.x, p.x) > x + slack));
}

/**
 * Where the drawing reaches a spike: the vertices within `tolerance` px of the spike's projected height,
 * and whether every one of them lies in the device-pixel column of the spike's projected x.
 */
export function spikeColumn(runs: readonly { x: number; y: number }[][], spike: { x: number; y: number }, dpr: number, tolerance = 0.75): { reached: boolean; outside: { x: number; y: number }[] } {
  const near = runs.flat().filter(p => Math.abs(p.y - spike.y) <= tolerance);
  const column = Math.floor(spike.x * dpr);
  const outside = near.filter(p => Math.abs(Math.floor(p.x * dpr) - column) > 1);
  return { reached: near.some(p => Math.abs(Math.floor(p.x * dpr) - column) <= 1), outside };
}

// ── painted palette ───────────────────────────────────────────────────────────────────────────────

/**
 * Eight series (or slices) of the type, drawn so each colour has a uniform painted interior to sample:
 * flat lines (their 2 px stroke at device pixel ratio 2), grouped bars, scatter points, donut slices.
 */
export function eight(type: ChartType): { fn: string; options: Record<string, unknown> } {
  const names = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];
  if (type === 'donut') return { fn: 'donut', options: { title: 'Eight', data: names.map((n, i) => ({ n, v: 10 + i })), label: 'n', value: 'v' } };
  if (type === 'scatter') return { fn: 'scatter', options: { title: 'Eight', data: [...names.map((s, i) => ({ x: i + 1, y: i + 1, s })), { x: 0, y: 0, s: 'S1' }, { x: 9, y: 9, s: 'S1' }], x: 'x', y: 'y', series: 's' } };
  if (type === 'bar') return { fn: 'bar', options: { title: 'Eight', data: names.map((s, i) => ({ x: 'A', s, y: 10 + i })), x: 'x', y: 'y', series: 's' } };
  // Levels 15…85 keep every line inside the plot, never on a clipped edge.
  const data = names.flatMap((s, i) => [0, 1, 2, 3].map(x => ({ x, s, y: 15 + 10 * i })));
  return { fn: type === 'compact' ? 'line' : type, options: { title: 'Eight', data, x: 'x', y: 'y', series: 's', ...(type === 'compact' ? { compact: true } : {}) } };
}

/** The painted colour of each series, sampled from a uniform part of its own marks, in series order. */
export async function paintedSeries(page: Page, type: ChartType): Promise<{ colors: RGB[]; backdrop: RGB; problems: string[] }> {
  const { img, box: view, scale } = await screenshot(page, '#chart .axylo-plot');
  const backdrop = modeColor(img, { x0: 0, y0: 0, x1: img.width, y1: img.height }).color;
  const colors: RGB[] = [];
  const problems: string[] = [];
  const sample = (b: Box, slot: number) => {
    const m = interiorColor(img, view, b, 0);
    if (m.pixels === 0 || m.share < 0.5) problems.push(`series ${slot}: no uniform paint in ${JSON.stringify(b)} (share ${m.share.toFixed(2)})`);
    colors.push(m.color);
  };
  if (type === 'donut') {
    const g = await ring(page);
    const total = 10 * 8 + 28;
    let before = 0;
    for (let i = 0; i < 8; i++) {
      const v = 10 + i, a = (2 * Math.PI * (before + v / 2)) / total;
      before += v;
      sample({ x: g.cx + 0.85 * g.outer * Math.sin(a) - 1.5, y: g.cy - 0.85 * g.outer * Math.cos(a) - 1.5, width: 3, height: 3 }, i + 1);
    }
  } else if (type === 'bar') {
    const drawn = await shapes(page, '#chart', 100000);
    for (let slot = 1; slot <= 8; slot++) { const b = drawn[slot]?.[0]?.box; if (!b) problems.push(`series ${slot}: no bar`); else sample({ x: b.x + 2, y: b.y + b.height / 2, width: Math.max(1, b.width - 4), height: 4 }, slot); }
  } else if (type === 'scatter') {
    const drawn = await shapes(page, '#chart', 14);
    // A point's shape may be thin (plus, cross, star): its most frequent colour other than the backdrop. The
    // point nearest the plot's middle is used, away from any clipped edge.
    const plotBox = await box(page, '#chart .axylo-proxy');
    const mid = { x: plotBox.x + plotBox.width / 2, y: plotBox.y + plotBox.height / 2 };
    for (let slot = 1; slot <= 8; slot++) {
      const b = (drawn[slot] ?? []).map(s => s.box).sort((p, q) => Math.hypot(center(p).x - mid.x, center(p).y - mid.y) - Math.hypot(center(q).x - mid.x, center(q).y - mid.y))[0];
      if (!b) { problems.push(`series ${slot}: no point`); continue; }
      const ink = inkColor(img, view, b, backdrop);
      if (!ink) { problems.push(`series ${slot}: no uniform paint in its point`); continue; }
      colors.push(ink);
    }
  } else {
    // Flat lines: the middle of the first segment, away from any marker.
    for (let slot = 1; slot <= 8; slot++) {
      const run = (await strokeRuns(page, slot)).flat().sort((a, b) => a.x - b.x);
      if (run.length < 2) { problems.push(`series ${slot}: no line`); continue; }
      // Along the whole first segment (a dashed line has gaps), the most frequent non-backdrop colour.
      const ink = inkColor(img, view, { x: run[0]!.x + 4, y: run[0]!.y - 0.5, width: run[1]!.x - run[0]!.x - 8, height: 1 }, backdrop);
      if (!ink) { problems.push(`series ${slot}: no uniform paint on its line`); continue; }
      colors.push(ink);
    }
  }
  return { colors, backdrop, problems };
}

/**
 * The most frequent colour in a box that differs from the backdrop by more than 40 per channel, when it
 * is at least 30 % of those pixels (a mark's own paint, not its anti-aliased edge); null otherwise.
 */
export function inkColor(img: Image, view: Box, b: Box, backdrop: RGB): RGB | null {
  const s = img.width / view.width;
  const counts = new Map<string, number>();
  let inked = 0;
  for (let y = Math.floor((b.y - view.y) * s); y < (b.y + b.height - view.y) * s; y++) {
    for (let x = Math.floor((b.x - view.x) * s); x < (b.x + b.width - view.x) * s; x++) {
      const p = pixel(img, x, y);
      if (distance(p, backdrop) <= 40) continue;
      inked++;
      counts.set(p.join(','), (counts.get(p.join(',')) ?? 0) + 1);
    }
  }
  const best = [...counts.entries()].sort((a, c2) => c2[1] - a[1])[0];
  return best && best[1] / inked >= 0.3 ? best[0].split(',').map(Number) as unknown as RGB : null;
}

/** Contrast and distance problems of eight painted colours on their painted backdrop (empty when none). */
export function paletteProblems(colors: readonly RGB[], backdrop: RGB): string[] {
  const out: string[] = [];
  colors.forEach((c, i) => { const r = contrast(c, backdrop); if (r < 3) out.push(`series ${i + 1} ${c} is ${r.toFixed(2)}:1 on ${backdrop}`); });
  for (const vision of VISIONS) {
    for (const raster of [false, true]) {
      const m = minimumDistance(colors, vision, raster);
      if (m.distance < 0.1) out.push(`${vision}${raster ? ' (8-bit simulated image)' : ''}: series ${m.pair[0] + 1} and ${m.pair[1] + 1} are ${m.distance.toFixed(3)} apart`);
    }
  }
  return out;
}


// ── marker classes ────────────────────────────────────────────────────────────────────────────────

/**
 * The shape class of each crossing trace's last-point marker and of its legend marker, on a grayscale
 * conversion of a screenshot at device pixel ratio 4. The line strokes are made transparent for the
 * measurement only, so a marker is not merged with the line through it.
 */
export async function markerClasses(page: Page): Promise<{ plot: string[]; legend: string[] }> {
  await page.addStyleTag({ content: '#chart .axylo-scene path[stroke-width] { stroke: transparent !important; } #chart .axylo-swatch-line { stroke: transparent !important; }' });
  await settle(page);
  const drawn = await shapes(page, '#chart', 14);
  const { img, box: view, scale } = await screenshot(page, '#chart figure');
  const backdrop = modeColor(img, { x0: 0, y0: 0, x1: img.width, y1: img.height }).color;
  const plot: string[] = [];
  for (const slot of [1, 2, 3]) {
    const last = (drawn[slot] ?? []).map(s => center(s.box)).sort((a, b) => b.x - a.x)[0];
    plot.push(last ? shapeClass(img, { x: Math.round((last.x - view.x) * scale), y: Math.round((last.y - view.y) * scale) }, Math.round(6 * scale), backdrop) : 'none');
  }
  const legend: string[] = [];
  for (const el of await page.locator('#chart .axylo-legend-entry .axylo-swatch-marker').all()) {
    const b = (await el.boundingBox())!;
    legend.push(shapeClass(img, { x: Math.round((b.x + b.width / 2 - view.x) * scale), y: Math.round((b.y + b.height / 2 - view.y) * scale) }, Math.round(6 * scale), backdrop));
  }
  return { plot, legend };
}

/**
 * The fill pattern of each bar series, in slot order: for every rect of the series, what its pattern draws (the
 * pattern's own path), or "none" for a solid bar. A series with one pattern on every bar gives one signature.
 */
export async function barPatterns(page: Page): Promise<string[][]> {
  return page.evaluate(() => {
    const by = new Map<number, Set<string>>();
    for (const el of document.querySelectorAll<SVGElement>('#chart svg.axylo-svg .axylo-scene rect')) {
      let slot: number | null = null;
      for (let e: Element | null = el; e && !e.classList.contains('axylo-scene'); e = e.parentElement) {
        const m = /--axylo-series-color-(\d+)/.exec((e as SVGElement).style?.getPropertyValue('color') ?? '');
        if (m) { slot = Number(m[1]); break; }
      }
      if (slot === null) continue;
      const fill = getComputedStyle(el).fill;
      const id = /url\(["']?#([^"')]+)/.exec(fill)?.[1];
      const pattern = id ? document.getElementById(id) : null;
      if (!by.has(slot)) by.set(slot, new Set());
      if (pattern) by.get(slot)!.add([...pattern.querySelectorAll('path')].map(p => p.getAttribute('d')).join(' '));
    }
    return [...by].sort((a, b) => a[0] - b[0]).map(([, set]) => (set.size ? [...set].sort() : ['none']));
  });
}
