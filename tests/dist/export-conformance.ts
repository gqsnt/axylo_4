/**
 * Whole-figure export conformance (N7b), shared by every chart family's packed Chrome test (Wave 4:
 * heatmap, bubble, violin, treemap, sunburst …). A family test mounts its charts on a page whose script puts
 * `exportSvg`, `exportPngDataUrl`, `exportCsv` and `parseCsv` from `axylo/export` on `window.__exp`, then:
 *
 *   const s = await page.evaluate(summarizeExport, { selector: '#chart' });
 *   expectWholeFigure(s);                                   // SVG: visible content, geometry, metadata
 *   expectPng(await page.evaluate(pngExport, { selector: '#chart', scale: 2 }), s, 2);
 *   expectClosedOpenCsv(await csvClosedOpen(page, '#chart'), expectedRowCount);
 *
 * `summarizeExport` and `pngExport` run in the page (page.evaluate): they are self-contained, with no
 * reference to anything in this module. What they read from the live figure is what a reader sees there (the
 * visible caption, legend, note and the labels' rotation), so the checks follow the figure, not a family.
 */
import { expect } from 'vitest';
import type { Page } from 'playwright-core';
import { decodePng } from './png';

export interface Box { x: number; y: number; width: number; height: number }

export interface ExportSummary {
  readonly parseError: boolean;
  readonly hasVar: boolean;
  readonly width: number;
  readonly height: number;
  readonly viewBox: readonly number[];
  readonly title: string | null;
  readonly desc: string | null;
  readonly background: string | null;
  /** Each `<text>` in viewBox coordinates (the group's translation applied). */
  readonly texts: readonly { text: string; x: number; y: number; rotate: number; fill: string }[];
  /**
   * Each nested `<svg>` (the plot surface and the swatches), with the fill and stroke of each shape outside its
   * `<defs>` as exported (judged by `concretePaint`, see `paintedShapes`).
   */
  readonly svgs: readonly (Box & { viewBox: string | null; paints: readonly (readonly [fill: string, stroke: string])[] })[];
  /**
   * The exported image laid out in the page (then removed): each `<text>`'s rendered bounds and each
   * `.axylo-scene` shape's, in viewBox coordinates, with its geometry signature and paint.
   */
  readonly textBoxes: readonly (Box & { text: string })[];
  readonly marks: readonly (Box & { shape: string; fill: string; stroke: string })[];
  /** The shapes of each exported swatch (not the plot), as geometry signatures. */
  readonly swatchShapes: readonly string[];
  /** What the live figure shows. */
  readonly dom: {
    readonly name: string;
    readonly title: string | null;
    readonly subtitle: string | null;
    readonly note: string | null;
    readonly legend: readonly string[];
    readonly legendValues: readonly string[];
    readonly swatches: number;
    /** Of those, the graphics that are not 20 × 12 legend swatches (a family's colour bar or size legend). */
    readonly chromeGraphics: number;
    readonly rotatedLabels: number;
    readonly multilineLabels: number;
    /** Each line of each visible multi-line label, as shown. */
    readonly labelLines: readonly string[];
    /** Geometry signatures of the live `.axylo-scene` shapes and of the live legend swatches' shapes. */
    readonly marks: readonly string[];
    readonly swatchShapes: readonly string[];
    readonly figure: { width: number; height: number };
  };
}

/** In the page: exports `selector` and describes the SVG and the live figure. */
export function summarizeExport(args: { selector: string; options?: Record<string, unknown> }): ExportSummary {
  const api = (window as unknown as { __exp: { exportSvg(t: string, o?: unknown): string } }).__exp;
  const text = api.exportSvg(args.selector, args.options);
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  const group = svg.querySelector(':scope > g');
  const shift = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(group?.getAttribute('transform') ?? '');
  const tx = shift ? Number(shift[1]) : 0, ty = shift ? Number(shift[2]) : 0;
  const num = (el: Element, name: string) => Number(el.getAttribute(name) ?? 0);
  const texts = [...(group?.querySelectorAll(':scope > text') ?? [])].map(t => ({
    text: t.textContent ?? '', x: num(t, 'x') + tx, y: num(t, 'y') + ty, fill: t.getAttribute('fill') ?? '',
    rotate: Number(/rotate\(([-\d.e]+)/.exec(t.getAttribute('transform') ?? '')?.[1] ?? 0),
  }));
  const svgs = [...(group?.querySelectorAll(':scope > svg') ?? [])].map(s => ({
    x: num(s, 'x') + tx, y: num(s, 'y') + ty, width: num(s, 'width'), height: num(s, 'height'), viewBox: s.getAttribute('viewBox'),
    paints: [...s.querySelectorAll('path, rect, line, circle, polygon, polyline')].filter(e => !e.closest('defs'))
      .map(e => [e.getAttribute('fill') ?? '', e.getAttribute('stroke') ?? ''] as const),
  }));
  const root = document.querySelector(args.selector)!;
  const figure = (root.closest('.axylo-figure') ?? root.querySelector('.axylo-figure'))!;
  const shown = (el: Element | null): el is HTMLElement => !!el && !el.closest('[hidden], .axylo-visually-hidden') && getComputedStyle(el).display !== 'none';
  const textOf = (selector: string) => { const el = figure.querySelector(selector); return shown(el) ? el.textContent!.trim() : null; };
  const labels = [...figure.querySelectorAll('.axylo-text .axylo-label')].filter(shown);
  const angle = (el: Element) => {
    const m = /^matrix\(([^,]+),([^,]+)/.exec(getComputedStyle(el).transform);
    return m ? Math.round(Math.atan2(Number(m[2]), Number(m[1])) * 180 / Math.PI) : 0;
  };
  // A shape's geometry signature: its tag and the attributes that place it (never paint).
  const shape = (e: Element) => [e.localName, ...['d', 'x', 'y', 'width', 'height', 'points', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r']
    .map(a => e.getAttribute(a)).filter(v => v !== null)].join('|');
  const shapes = 'path, rect, line, circle, polygon, polyline';
  // A live shape is drawn unless it or a group above it inside the scene is not displayed (the export drops those).
  const displayed = (e: Element) => {
    for (let at: Element | null = e; at && !at.matches('.axylo-scene'); at = at.parentElement) if (getComputedStyle(at).display === 'none') return false;
    return true;
  };
  // Legend swatches and the graphics of a family's own chrome (data-axylo-export: a colour bar, a size legend).
  const liveSwatches = [...figure.querySelectorAll('.axylo-legend-entry svg, .axylo-legend-list svg, [data-axylo-export] svg')].filter(shown);
  // Lay the exported image out in the page for its real text and mark bounds, then take it out again.
  const holder = document.createElement('div');
  holder.style.position = 'fixed';
  holder.style.left = '-20000px';
  holder.style.top = '0';
  const image = document.importNode(svg, true) as unknown as SVGSVGElement;
  holder.appendChild(image);
  document.body.appendChild(holder);
  const frame = image.getBoundingClientRect();
  const vb = (svg.getAttribute('viewBox') ?? '0 0 1 1').split(' ').map(Number);
  const kx = vb[2]! / (frame.width || 1), ky = vb[3]! / (frame.height || 1);
  const local = (r: DOMRect): Box => ({ x: (r.left - frame.left) * kx, y: (r.top - frame.top) * ky, width: r.width * kx, height: r.height * ky });
  const textBoxes = [...image.querySelectorAll(':scope > g text')].map(t => ({ text: t.textContent ?? '', ...local(t.getBoundingClientRect()) }));
  const marks = [...image.querySelectorAll('.axylo-scene')].flatMap(g => [...g.querySelectorAll(shapes)]).map(e => ({
    shape: shape(e), fill: e.getAttribute('fill') ?? '', stroke: e.getAttribute('stroke') ?? '', ...local(e.getBoundingClientRect()),
  }));
  holder.remove();
  const plotSvg = [...(group?.querySelectorAll(':scope > svg') ?? [])].sort((a, b) => num(b, 'width') * num(b, 'height') - num(a, 'width') * num(a, 'height'))[0];
  const swatchShapes = [...(group?.querySelectorAll(':scope > svg') ?? [])].filter(x => x !== plotSvg)
    .map(x => [...x.querySelectorAll(shapes)].filter(e => !e.closest('defs')).map(shape).join(' ')).filter(Boolean);
  const byId = (id: string | null) => (id ? (figure.getRootNode() as Document).getElementById(id)?.textContent?.trim() ?? '' : '');
  const box = figure.getBoundingClientRect();
  return {
    parseError: !!doc.querySelector('parsererror'), hasVar: text.includes('var(--'),
    width: num(svg, 'width'), height: num(svg, 'height'), viewBox: (svg.getAttribute('viewBox') ?? '').split(' ').map(Number),
    title: svg.querySelector(':scope > title')?.textContent ?? null, desc: svg.querySelector(':scope > desc')?.textContent ?? null,
    background: svg.querySelector(':scope > rect')?.getAttribute('fill') ?? null,
    texts, svgs, textBoxes, marks, swatchShapes,
    dom: {
      name: figure.getAttribute('aria-label') || byId(figure.getAttribute('aria-labelledby')),
      title: textOf('.axylo-title'), subtitle: textOf('.axylo-subtitle'), note: textOf('.axylo-note'),
      legend: [...figure.querySelectorAll('.axylo-legend-entry .axylo-control-label, .axylo-legend-name')].filter(shown).map(e => e.textContent!.trim()),
      legendValues: [...figure.querySelectorAll('.axylo-legend-value')].filter(shown).map(e => e.textContent!.trim()),
      swatches: liveSwatches.length,
      chromeGraphics: liveSwatches.filter(x => x.getAttribute('viewBox') !== '0 0 20 12').length,
      rotatedLabels: labels.filter(l => angle(l) !== 0).length,
      multilineLabels: labels.filter(l => l.children.length > 1).length,
      labelLines: labels.filter(l => l.children.length > 1).flatMap(l => [...l.children].map(c => c.textContent!.trim())),
      marks: [...figure.querySelectorAll('.axylo-scene')].flatMap(g => [...g.querySelectorAll(shapes)]).filter(displayed).map(shape),
      swatchShapes: liveSwatches.map(x => [...x.querySelectorAll(shapes)].filter(e => !e.closest('defs')).map(shape).join(' ')).filter(Boolean),
      figure: { width: box.width, height: box.height },
    },
  };
}

/** In the page: the PNG data URL of `selector` at `scale`. */
export async function pngExport(args: { selector: string; scale: number; options?: Record<string, unknown> }): Promise<string> {
  const api = (window as unknown as { __exp: { exportPngDataUrl(t: string, o?: unknown): Promise<string> } }).__exp;
  return api.exportPngDataUrl(args.selector, { ...args.options, scale: args.scale });
}

/**
 * Whether an exported paint is a colour a reader sees: any concrete CSS colour as the browser computes it, which
 * for a `color-mix(in oklab, …)` (the heatmap's bins) is `oklab(…)` and for a mix in another space `color(…)`
 * or `lab(…)` …, never transparent (zero alpha), `none`, `currentColor`, a paint-server reference or missing.
 */
export function concretePaint(v: string | null | undefined): boolean {
  return !!v && /^(#|rgba?\(|hsla?\(|hwb\(|(ok)?l(ab|ch)\(|color\()/i.test(v) &&
    !/^(rgba|hsla)\(.*,\s*0(\.0*)?%?\)$|\/\s*0(\.0*)?%?\)$|^#([0-9a-f]{3}0|[0-9a-f]{6}00)$/i.test(v);
}

/** How many of a nested SVG's shapes are filled or stroked in a concrete colour. */
export function paintedShapes(svg: { paints: readonly (readonly [string, string])[] }): number {
  return svg.paints.filter(([fill, stroke]) => concretePaint(fill) || concretePaint(stroke)).length;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const inside = (x: number, y: number, b: Box, slack = 0) =>
  x >= b.x - slack && x <= b.x + b.width + slack && y >= b.y - slack && y <= b.y + b.height + slack;

/** The plot surface: the largest nested SVG. */
export function plotOf(s: ExportSummary): ExportSummary['svgs'][number] {
  return [...s.svgs].sort((a, b) => b.width * b.height - a.width * a.height)[0]!;
}

/**
 * Whole-figure SVG conformance: well-formed and standalone; every visible title, subtitle, legend label and
 * value, swatch and note is in it; all parts inside the viewBox; caption above and note below the plot, no
 * chrome text over the plot; rotated labels kept rotated; accessible name and description kept.
 */
export function expectWholeFigure(s: ExportSummary, options: { plotOnly?: boolean } = {}): void {
  expect(s.parseError, 'SVG parses as XML').toBe(false);
  expect(s.hasVar, 'no unresolved custom property').toBe(false);
  const [vx, vy, vw, vh] = s.viewBox as [number, number, number, number];
  expect([vx, vy]).toEqual([0, 0]);
  expect(vw).toBeGreaterThan(0);
  expect(vh).toBeGreaterThan(0);
  const view: Box = { x: 0, y: 0, width: vw, height: vh };
  for (const t of s.texts) expect(inside(t.x, t.y, view, 1), `text "${t.text}" at ${t.x},${t.y} inside 0 0 ${vw} ${vh}`).toBe(true);
  for (const b of s.svgs) {
    expect(inside(b.x, b.y, view, 1) && inside(b.x + b.width, b.y + b.height, view, 1), `svg ${JSON.stringify(b)} inside the viewBox`).toBe(true);
  }
  // Real text bounds, not centres: every label's rendered box lies inside the image.
  for (const t of s.textBoxes) {
    expect(t.x >= -1 && t.y >= -1 && t.x + t.width <= vw + 1 && t.y + t.height <= vh + 1, `text "${t.text}" box ${JSON.stringify(t)} inside 0 0 ${vw} ${vh}`).toBe(true);
  }
  const plot = plotOf(s);
  expect(plot, 'plot surface').toBeDefined();
  expect(paintedShapes(plot), `plot has painted marks (exported paints: ${JSON.stringify([...new Set(plot.paints.flat())].slice(0, 8))})`).toBeGreaterThan(0);
  // The data marks themselves: the exported scene holds exactly the live scene's shapes, with their geometry.
  expect([...s.marks.map(m => m.shape)].sort(), 'exported scene shapes = live scene shapes').toEqual([...s.dom.marks].sort());
  expect(s.marks.some(m => concretePaint(m.fill) || concretePaint(m.stroke)), 'scene marks painted in a concrete colour').toBe(true);
  // Each line of a multi-line label is its own exported text.
  for (const line of s.dom.labelLines) expect(s.texts.some(t => squash(t.text) === squash(line)), `label line "${line}"`).toBe(true);
  expect(s.dom.name.length).toBeGreaterThan(0);
  expect(s.title).toBe(s.dom.name);
  expect(s.desc?.length ?? 0).toBeGreaterThan(0);
  expect(s.dom.rotatedLabels > 0 ? s.texts.filter(t => t.rotate !== 0).length : 0).toBeGreaterThanOrEqual(s.dom.rotatedLabels);

  const all = squash(s.texts.map(t => t.text).join(' '));
  const chrome = [s.dom.title, s.dom.subtitle, s.dom.note, ...s.dom.legend, ...s.dom.legendValues].filter((t): t is string => !!t);
  if (options.plotOnly) {
    // No caption, legend (labels, values, swatches) or note: only texts inside the plot, and one SVG.
    for (const t of [s.dom.title, s.dom.subtitle, s.dom.note]) if (t) expect(all.includes(squash(t)), `plotOnly omits "${t}"`).toBe(false);
    for (const t of s.texts) expect(inside(t.x, t.y, plot, 1), `plotOnly text "${t.text}" inside the plot`).toBe(true);
    expect(s.svgs, 'plotOnly exports no swatch').toHaveLength(1);
    expect(s.swatchShapes).toEqual([]);
    expect(Math.abs(vw - plot.width)).toBeLessThanOrEqual(2);
    return;
  }
  expect(vw).toBeGreaterThanOrEqual(Math.floor(s.dom.figure.width));
  expect(vh).toBeGreaterThanOrEqual(Math.floor(s.dom.figure.height));
  for (const t of chrome) expect(all, `exported SVG shows "${t}"`).toContain(squash(t));
  // Every nested SVG but the plot is chrome graphics: the legend's swatches (20 × 12) and, W4, a family's marked
  // chrome (a colour bar, a nested-circle size legend). Each is painted in a concrete colour.
  const swatches = s.svgs.filter(b => b !== plot);
  expect(swatches.filter(b => b.viewBox === '0 0 20 12').length, 'every visible 20 × 12 swatch exported')
    .toBeGreaterThanOrEqual(s.dom.swatches - s.dom.chromeGraphics);
  expect(swatches.length, 'every visible swatch and chrome graphic exported').toBeGreaterThanOrEqual(s.dom.swatches);
  for (const w of swatches) expect(paintedShapes(w), 'swatch painted in a concrete colour').toBeGreaterThan(0);
  // Mark-aware swatches: each exported swatch draws the live swatch's shapes (bar, area, line, range, error bar).
  expect(s.swatchShapes, 'swatch geometry as shown').toEqual(s.dom.swatchShapes);
  // Chrome text (caption, legend, note) is beside the plot, never over it: each piece has an exported text
  // outside the plot surface (an axis title inside the plot may repeat a series name).
  const outside = s.texts.filter(t => !inside(t.x, t.y, plot));
  for (const c of chrome) {
    expect(outside.some(t => squash(t.text) !== '' && squash(c).includes(squash(t.text))), `"${c}" exported outside the plot`).toBe(true);
  }
  const first = (needle: string | null) => needle ? outside.find(t => squash(t.text) !== '' && squash(needle).startsWith(squash(t.text))) : undefined;
  const title = first(s.dom.title), note = first(s.dom.note);
  if (title) expect(title.y, 'title above the plot').toBeLessThan(plot.y);
  if (note) expect(note.y, 'note below the plot').toBeGreaterThan(plot.y + plot.height);
  // True bounds: chrome text neither overlaps the plot surface nor another chrome text.
  const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const chromeBoxes = s.textBoxes.filter(t => !inside(t.x + t.width / 2, t.y + t.height / 2, plot));
  for (const [i, a] of chromeBoxes.entries()) {
    expect(overlap(a, plot), `"${a.text}" clear of the plot`).toBeLessThanOrEqual(2 * a.height);
    for (const b of chromeBoxes.slice(i + 1)) expect(overlap(a, b), `"${a.text}" and "${b.text}" do not overlap`).toBeLessThanOrEqual(4);
  }
}

/** Painted marks whose box centre falls in the band [from, to] of the plot's height (0 top, 1 bottom). */
export function marksInBand(s: ExportSummary, from: number, to: number): number {
  const plot = plotOf(s);
  return s.marks.filter(m => {
    const y = (m.y + m.height / 2 - plot.y) / plot.height;
    return y >= from && y <= to && m.width < plot.width * 0.9 && (concretePaint(m.fill) || concretePaint(m.stroke));
  }).length;
}

/** The PNG decodes at the SVG's size times the scale and is not blank. */
export function expectPng(dataUrl: string, s: ExportSummary, scale: number): void {
  expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  const image = decodePng(Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));
  expect(image.width).toBe(Math.round(s.width * scale));
  expect(image.height).toBe(Math.round(s.height * scale));
  const colours = new Set<number>();
  for (let i = 0; i < image.rgba.length && colours.size < 8; i += 4 * 97) {
    colours.add((image.rgba[i]! << 16) | (image.rgba[i + 1]! << 8) | image.rgba[i + 2]!);
  }
  expect(colours.size, 'PNG has drawn content').toBeGreaterThan(2);
}

/**
 * The pixels of the decoded PNG inside `box` (viewBox coordinates, at `scale`): the share that is fully
 * transparent and the share within 3 of `rgb` on each channel and opaque.
 */
export function pngRegion(dataUrl: string, box: Box, scale: number, rgb?: readonly [number, number, number]): { transparent: number; matching: number } {
  const image = decodePng(Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));
  let total = 0, clear = 0, same = 0;
  const x0 = Math.ceil(box.x * scale), y0 = Math.ceil(box.y * scale);
  const x1 = Math.min(image.width, Math.floor((box.x + box.width) * scale)), y1 = Math.min(image.height, Math.floor((box.y + box.height) * scale));
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const i = (y * image.width + x) * 4;
    total++;
    if (image.rgba[i + 3] === 0) clear++;
    else if (rgb && image.rgba[i + 3] === 255 && rgb.every((c, k) => Math.abs(image.rgba[i + k]! - c) <= 3)) same++;
  }
  return { transparent: clear / (total || 1), matching: same / (total || 1) };
}

export interface CsvClosedOpen {
  readonly closedTarget: string;
  readonly closedHandle: string | null;
  readonly openTarget: string;
  readonly openHandle: string | null;
  /** The open table's header cells and first page of body rows, as shown. */
  readonly shownHeaders: readonly string[];
  readonly shownRows: readonly (readonly string[])[];
  readonly parsed: readonly (readonly string[])[];
}

/**
 * Exports `selector` with its table closed, opens the table ("View as table", page 1 shown) and exports
 * again, through the target and, when the page put the chart on `window.__charts[key]`, through the handle.
 */
export async function csvClosedOpen(page: Page, selector: string, key?: string): Promise<CsvClosedOpen> {
  const read = () => page.evaluate(({ selector, key }) => {
    const w = window as unknown as { __exp: { exportCsv(t: unknown): string }; __charts?: Record<string, object> };
    const handle = key ? w.__charts?.[key] : undefined;
    return { target: w.__exp.exportCsv(selector), handle: handle ? w.__exp.exportCsv(handle) : null };
  }, { selector, key });
  const closed = await read();
  const tablesBefore = await page.locator(`${selector} table`).count();
  expect(tablesBefore, 'table closed before the first export').toBe(0);
  await page.locator(selector).getByRole('button', { name: /View as table/i }).click();
  await page.waitForSelector(`${selector} table tbody tr`);
  const open = await read();
  const shown = await page.evaluate(sel => {
    const table = document.querySelector(`${sel} table`)!;
    return {
      headers: [...table.querySelectorAll('thead th')].map(c => c.textContent ?? ''),
      rows: [...table.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('th, td')].map(c => c.textContent ?? '')),
    };
  }, selector);
  const parsed = await page.evaluate(text => (window as unknown as { __exp: { parseCsv(s: string): string[][] } }).__exp.parseCsv(text), closed.target);
  return {
    closedTarget: closed.target, closedHandle: closed.handle, openTarget: open.target, openHandle: open.handle,
    shownHeaders: shown.headers, shownRows: shown.rows, parsed,
  };
}

/** Closed and open exports are byte-identical, hold the header and every row, and agree with the shown page. */
export function expectClosedOpenCsv(c: CsvClosedOpen, rowCount: number): void {
  expect(c.openTarget).toBe(c.closedTarget);
  if (c.closedHandle !== null) expect(c.closedHandle).toBe(c.closedTarget);
  if (c.openHandle !== null) expect(c.openHandle).toBe(c.closedTarget);
  expect(c.parsed).toHaveLength(rowCount + 1);
  expect(c.parsed[0]).toEqual(c.shownHeaders);
  expect(c.shownRows.length).toBeGreaterThan(0);
  expect(c.shownRows.length).toBeLessThan(rowCount);
  expect(c.parsed.slice(1, 1 + c.shownRows.length)).toEqual(c.shownRows);
}

/** Relative luminance (0 dark … 1 light) of an `rgb()`/`rgba()` colour, for light/dark checks. */
export function luminance(color: string): number {
  const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color.length === 4 ? color.replace(/[\da-f]/gi, d => d + d) : color);
  const m = hex ? [0, ...hex.slice(1).map(h => parseInt(h, 16))] : /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(color);
  if (!m) return NaN;
  const [r, g, b] = [m[1], m[2], m[3]].map(v => {
    const c = Number(v) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
