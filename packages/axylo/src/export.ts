/**
 * Opt-in standalone export for Axylo (`axylo/export`, C6.1, N7b):
 * - `exportSvg(target, options?)`: the whole visible figure as one self-contained SVG. For a mounted chart
 *   (found through the shared export registry, export/contract.ts) that is its registered plot (marks with
 *   their clip paths, patterns and transforms; axis and data labels, rotated or on several lines;
 *   annotations; every pane) and its chrome: the caption's visible title and subtitle, legend entries with
 *   their swatches (and a donut's values and percentages), a family's own marked parts, and the reader's
 *   note, each where the page shows it and clipped where the page clips it, in one coordinate system.
 *   Colours, fonts, spacing and strokes are the computed values, so no `var(--axylo-…)` is left; references
 *   are local fragments and nothing active or external is kept. `plotOnly: true` keeps only the plot.
 * - `exportPng(target, options?)` / `exportPngDataUrl(target, options?)`: that SVG rasterized offscreen at a
 *   scale (device pixel ratio).
 * - `exportCsv(source, options?)` / `parseCsv(text, delimiter?)`: RFC 4180 CSV of the chart's accessible
 *   table, every row of every page whether the table is open or closed, with the very text the table shows
 *   (read through the chart's export capability), or of a `TableModel`, a plain `<table>` or `Data<Row>`
 *   (Node/SSR safe).
 *
 * No runtime dependency, no DOM access at import time, 0 raw bytes on a bare import, and the page is never
 * changed (no node is added, moved or restyled).
 */
import type { Data, Target } from './public.js';
import { CHROME, seamOf } from './export/contract';

export interface ExportSvgOptions {
  /** Output width in CSS pixels (default: the figure's, or the plot's with `plotOnly`). The drawing scales to it. */
  readonly width?: number;
  /** Output height in CSS pixels (default: the figure's, or the plot's with `plotOnly`). */
  readonly height?: number;
  /**
   * Background fill (default: the first opaque background behind the chart, else its backdrop, else `'#ffffff'`,
   * and the plot keeps the chart's own `--axylo-background`). An explicit value is the whole image's, the plot
   * included; `'transparent'` or `'none'` leaves every pixel not covered by the figure clear.
   */
  readonly background?: string;
  /** Include `<title>` and `<desc>` from the figure's accessible name and description. Default `true`. */
  readonly includeMetadata?: boolean;
  /** Only the plot (marks and their labels), without the caption, legend and note. Default `false`. */
  readonly plotOnly?: boolean;
}

export interface ExportPngOptions extends ExportSvgOptions {
  /** Rasterization scale factor (device pixel ratio). Default `Math.max(1, window.devicePixelRatio || 1)`. */
  readonly scale?: number;
}

export interface CsvTableLike {
  readonly headers: readonly string[];
  readonly rowCount: number;
  row(index: number): readonly string[] | null;
}

export interface ExportCsvOptions {
  /** Field delimiter. Default `','`. */
  readonly delimiter?: string;
  /** Line ending. Default `'\r\n'` (RFC 4180). */
  readonly lineEnding?: '\r\n' | '\n';
  /** Prepend UTF-8 BOM (`﻿`) for Excel compatibility. Default `false`. */
  readonly bom?: boolean;
  /** Include header row. Default `true`. */
  readonly includeHeader?: boolean;
  /** Optional explicit column field order when exporting `Data<Row>`. */
  readonly fields?: readonly string[];
  /** Optional custom header labels (aligned to `fields` for `Data<Row>`). */
  readonly headers?: readonly string[];
}

/** A chart handle from any Axylo entry (root, static, stream, cartesian, finance …). */
export type ChartLike = object;

/**
 * What is never part of an exported figure, inside the plot and the chrome: what is not shown, the font probe,
 * the focus proxy and the interaction overlay, and active or embedded content (scripts, foreign objects),
 * which a standalone image must not carry. The other controls and the transient layers (tooltip, readout,
 * live region, table) sit outside the plot and the chrome, so the walk never draws them.
 */
const SKIP = '[hidden],.axylo-visually-hidden,.axylo-font-probe,.axylo-overlay,input,script,style,foreignObject,animate,animateMotion,animateTransform,set';
type Box = DOMRect;

function fail(text: string): never { throw new Error(`axylo/export: ${text}`); }
const escapeXml = (text: string): string => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const pixels = (v: number): number => Math.max(1, Math.round(v));
const transparent = (color: string): boolean => /^(transparent|rgba\(.*,\s*0\))?$/.test(color);
function combine(a: Box, b: Box | null, low = Math.max, high = Math.min): Box {
  if (!b) return a;
  const x = low(a.x, b.x), y = low(a.y, b.y);
  return new DOMRect(x, y, high(a.right, b.right) - x, high(a.bottom, b.bottom) - y);
}

const windowOf = (el: Element) => el.ownerDocument.defaultView ?? fail('no window.');

function resolveTarget<T extends object>(target: T | string): T | HTMLElement {
  if (typeof target !== 'string') return target;
  return globalThis.document?.querySelector<HTMLElement>(target) ?? fail(`Selectors require a browser DOM match for ${target}`);
}

function lines(node: Text, range: Range, deg: number, visit: (content: string, r: Box) => void): void {
  const { data } = node;
  range.selectNodeContents(node);
  let start = 0;
  const slice = (from: number, to: number) => {
    range.setStart(node, from);
    range.setEnd(node, to);
    return range.getBoundingClientRect();
  };
  const emit = (end: number) => {
    const content = data.slice(start, end).trim();
    if (content) visit(content, slice(start, end));
    start = end;
  };
  if (!deg && range.getClientRects().length > 1) {
    let top = NaN;
    for (let i = 0; i < data.length; i++) {
      const r = slice(i, i + 1);
      if (!r.width) continue;
      // Even with overlapping lines, their tops move. Measure the entire line so RTL text
      // and characters of different widths are placed at their actual bounds.
      if (Math.abs(r.y - top) > 1) emit(i);
      top = r.y;
    }
  }
  emit(data.length);
}

/**
 * The standalone SVG. Only the registered plot and the figure's chrome (`CHROME`) are
 * composed, each at its page position, inside one group that moves the union of what is visible to the
 * origin. What the page clips (the plot's edges, a legend rail that scrolls, a clamped note) is clipped the
 * same way, and the box grows only by what is shown.
 */
export function exportSvg(target: Target, options: ExportSvgOptions = {}): string {
  const root = resolveTarget(target);
  const doc = root.ownerDocument, win = windowOf(root);
  const seam = seamOf(root);
  const figure = seam ? seam.figure : root;
  const plot = seam ? seam.plot : root.querySelector('svg')?.parentElement;
  if (!figure || !plot) fail('no rendered <svg> chart surface.');
  // An explicit background is the image's: the renderer's own background layer would cover it in the plot.
  let { background } = options;
  const skip = background ? SKIP + ',.axylo-background' : SKIP;
  const here = doc.URL.split('#')[0];
  // The figure's (or with `plotOnly` the plot's) own box, grown by what is shown outside it.
  const surface = options.plotOnly ? plot : figure;
  let view = surface.getBoundingClientRect();
  let parts = '';
  const range = doc.createRange();
  const style = (el: Element) => win.getComputedStyle(el);

  const PAINT = 'stop-color color fill fill-opacity stroke stroke-width stroke-opacity stroke-dasharray stroke-linecap stroke-linejoin opacity visibility clip-path mask transform'.split(' ');
  const TEXT = 'font-family font-size font-weight font-style letter-spacing word-spacing text-decoration'.split(' ');
  const serializer = new win.XMLSerializer();

  /**
   * Copies the computed paint of each element onto its clone and drops what is not displayed, inline styles,
   * event handlers and references out of the document. A computed `url(…)` names the page; the reference is
   * made a local fragment (the clip paths and patterns are serialized in the same image), and a value that
   * still points elsewhere is left out.
   */
  function inlinePaint(source: Element, clone: Element, root?: CSSStyleDeclaration): void {
    const cs = root ?? style(source);
    // Paint servers and clip paths inside <defs> are not displayed themselves but are referenced: kept.
    if ((cs.display === 'none' && !source.closest('defs')) || source.matches(skip)) return clone.remove();
    for (const name of PAINT) {
      const value = cs.getPropertyValue(name);
      if (value) clone.setAttribute(name, value);
    }
    for (const { name, value } of [...clone.attributes]) {
      const local = value.replace(/url\(["']?([^#)"']*)#([^)"']+)["']?\)/gi,
        (url, base: string, id: string) => !base || base === here ? `url(#${id})` : url);
      if ((root && /^(class|aria-hidden|focusable|transform-origin)$/.test(name)) ||
          /^on|^style$/i.test(name) || (/href$/i.test(name) && value[0] !== '#') || /url\((?!#)/i.test(local)) {
        clone.removeAttribute(name);
      } else if (local !== value) clone.setAttribute(name, local);
    }
    // Work backwards over the live collection: removing a hidden child cannot shift the next pair.
    for (let i = clone.children.length; i--;) {
      inlinePaint(source.children[i]!, clone.children[i]!);
    }
  }

  /** Adds a part with its box, clipped to what the page shows of it; nothing if none of it is. */
  const put = (part: string, r: Box, clip: Box | null): void => {
    const visible = combine(r, clip);
    const { width, height } = visible;
    if (!(width > 0 && height > 0)) return;
    view = combine(view, visible, Math.min, Math.max);
    if (width < r.width || height < r.height) {
      const id = `axylo-export-clip-${parts.length}`;
      part = `<clipPath id="${id}"><rect x="${visible.x}" y="${visible.y}" width="${width}" height="${height}"/></clipPath><g clip-path="url(#${id})">${part}</g>`;
    }
    parts += part;
  };

  const walk = (el: Element, deg: number, on: boolean, clip: Box | null): void => {
    if (el.matches(skip)) return;
    const cs = style(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
    on ||= el === plot || el.matches(CHROME);
    const matrix = cs.transform !== 'none' && new win.DOMMatrix(cs.transform);
    if (cs.overflow !== 'visible') clip = combine(el.getBoundingClientRect(), clip);
    if (el.localName === 'svg') {
      if (!on) return;
      const box = el.getBoundingClientRect();
      const clone = el.cloneNode(true) as Element;
      inlinePaint(el, clone, cs);
      let rect = box;
      if (matrix) {
        // An affine transform maps the viewport centre to the centre of its live bounding box.
        // Keeping that point fixed includes transform-origin and avoids applying translation twice.
        const w = parseFloat(cs.width), h = parseFloat(cs.height);
        rect = new DOMRect(-w / 2, -h / 2, w, h);
        matrix.e = box.x + box.width / 2;
        matrix.f = box.y + box.height / 2;
        clone.setAttribute('transform', String(matrix));
      }
      for (const key of ['x', 'y', 'width', 'height'] as const) clone.setAttribute(key, String(rect[key]));
      return put(serializer.serializeToString(clone), box, clip);
    }
    if (matrix) deg += Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
    for (const node of el.childNodes) {
      if (node.nodeType === 1) walk(node as Element, deg, on, clip);
      else if (on && node.nodeType === 3) {
        lines(node as Text, range, deg, (content, r) => {
          const x = r.x + r.width / 2, y = r.y + r.height / 2;
          put(`<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" fill="${escapeXml(cs.color)}"${
            TEXT.map(key => ` ${key}="${escapeXml(cs.getPropertyValue(key))}"`).join('')}${deg ? ` transform="rotate(${deg} ${x} ${y})"` : ''}>${escapeXml(content)}</text>`, r, clip);
        });
      }
    }
  };
  walk(surface, 0, false, null);

  let head = '';
  const meta = (tag: string, attr: string, name?: string | null) => {
    const value = name || (figure.getRootNode() as Document).getElementById?.(figure.getAttribute(attr) ?? '')?.textContent!.trim();
    if (value) head += `<${tag}>${escapeXml(value)}</${tag}>`;
  };
  if (options.includeMetadata !== false) {
    meta('title', 'aria-labelledby', figure.getAttribute('aria-label'));
    meta('desc', 'aria-describedby');
  }
  for (let at: Element | null = figure; at && !background; at = at.parentElement) {
    const color = style(at).backgroundColor;
    if (!transparent(color)) background = color;
  }
  background ||= style(figure).getPropertyValue('--axylo-backdrop').trim() || '#ffffff';
  if (background !== 'none' && !transparent(background)) head += `<rect width="100%" height="100%" fill="${escapeXml(background)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" width="${pixels(options.width ?? view.width)}" height="${pixels(options.height ?? view.height)}" viewBox="0 0 ${view.width} ${view.height}">${head}<g transform="translate(${-view.x} ${-view.y})">${parts}</g></svg>`;
}

async function rasterize(target: Target, options: ExportPngOptions = {}): Promise<HTMLCanvasElement> {
  const root = resolveTarget(target), win = windowOf(root);
  const svg = exportSvg(root, options);
  const requested = options.scale ?? 0;
  const scale = requested > 0 && requested < Infinity ? requested : Math.max(1, win.devicePixelRatio || 1);
  const canvas = win.document.createElement('canvas');

  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new win.Image();
    img.src = url;
    await img.decode();
    canvas.width = pixels(img.width * scale);
    canvas.height = pixels(img.height * scale);
    (canvas.getContext('2d') ?? fail('no 2D canvas.')).drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The figure rasterized into an `image/png` Blob at the requested scale. */
export async function exportPng(target: Target, options?: ExportPngOptions): Promise<Blob> {
  const canvas = await rasterize(target, options);
  return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve)) ?? fail('no PNG.');
}

/** The figure rasterized into a `data:image/png;base64,...` URL. */
export async function exportPngDataUrl(target: Target, options?: ExportPngOptions): Promise<string> {
  return (await rasterize(target, options)).toDataURL();
}

// ── RFC 4180 CSV Export & Round-Trip Parser ─────────────────────────────────────────────────────

/**
 * RFC 4180 CSV of Axylo's accessible table. The source can be:
 * 1. a chart handle, or a mounted chart target (selector, root, figure, or an element around or inside it):
 *    every row of every page of the committed table, the same whether the reader has the table open or
 *    closed, and the same text the table shows (a chart without a table, compact or `table: false`, not
 *    drawn yet or destroyed, throws);
 * 2. a `TableModel` (`{ headers, rowCount, row(i) }`);
 * 3. any other element or selector containing a `<table>`: its header and body cells as shown;
 * 4. `Data<Row>` (`readonly Row[]` or `{ columns }`), for Node/SSR export.
 */
export function exportCsv<Row = Record<string, unknown>>(
  source: Target | ChartLike | CsvTableLike | Data<Row>,
  options: ExportCsvOptions = {},
): string {
  const input = resolveTarget(source);
  const seam = seamOf(input);
  const model = seam
    ? seam.table ?? fail('no committed data table (compact, table: false or inactive).')
    : input as CsvTableLike;
  let headers = options.headers;
  const { fields, delimiter = ',', lineEnding = '\r\n' } = options;
  let count: number, row: (i: number) => readonly unknown[] | null;
  if (typeof model.row === 'function') {
    headers ??= model.headers;
    count = model.rowCount;
    row = i => model.row(i);
  } else if ((input as HTMLElement).nodeType === 1) {
    const el = input as HTMLElement;
    const table = el.localName === 'table' ? el : el.querySelector('table') ?? fail('no rendered <table>.');
    const texts = (root: Element, selector: string) => Array.from(root.querySelectorAll(selector), cell => cell.textContent!);
    const rows = table.querySelectorAll('tbody tr');
    headers ??= texts(table, 'thead th');
    count = rows.length;
    row = i => texts(rows[i]!, 'th, td');
  } else {
    const rows = input as readonly Record<string, unknown>[];
    const cols = Array.isArray(rows) ? null : (input as { columns?: Record<string, ArrayLike<unknown>> }).columns ?? fail('unsupported CSV source.');
    // A row that is not an object has no fields (C6): a string's length, say, is not exported.
    const record = (r: unknown) => (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
    const keys = fields ?? Object.keys(cols ?? record(rows[0]));
    headers ??= keys;
    count = cols ? keys.reduce((n, key) => Math.max(n, cols[key]?.length ?? 0), 0) : rows.length;
    row = i => keys.map(key => cols ? cols[key]?.[i] : record(rows[i])[key]);
  }
  const encode = (raw: unknown) => {
    const text = raw instanceof Date ? raw.toISOString() : String(raw ?? '');
    return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  let out = options.bom ? '﻿' : '', separator = '';
  for (let i = options.includeHeader !== false && headers?.length ? -1 : 0; i < count; i++) {
    const cells = i < 0 ? headers : row(i);
    // Formatting a header or row may destroy the chart or synchronously commit its replacement.
    if (seam && seam.table !== model) fail('destroyed or drew another table.');
    if (cells) {
      // One empty field needs quotes to distinguish the row from the empty file.
      const line = cells.map(encode).join(delimiter);
      out += separator + (!line && i >= 0 && cells.length === 1 ? '""' : line);
      separator = lineEnding;
    }
  }
  return out;
}

/** RFC 4180 CSV parser for verification and consumer round-trip parity (strips optional UTF-8 BOM). */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let i = text[0] === '﻿' ? 1 : 0;
  while (i < text.length) {
    const row: string[] = [];
    let field = '', quoted = false;
    rows.push(row);
    for (;;) {
      const ch = text[i++];
      if (ch === '"' && (quoted || !field)) {
        if (quoted && text[i] === '"') field += text[i++];
        else quoted = !quoted;
      } else if (ch === undefined || !quoted && (ch === delimiter || ch === '\r' || ch === '\n')) {
        row.push(field);
        if (ch !== delimiter) {
          if (ch === '\r' && text[i] === '\n') i++;
          break;
        }
        field = '';
      } else field += ch;
    }
  }
  return rows;
}

export type { Data, Target } from './public.js';
