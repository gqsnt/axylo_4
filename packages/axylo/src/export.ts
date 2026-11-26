/**
 * Opt-in standalone export utilities for Axylo (`axylo/export`, C6.1):
 * - `exportSvg(target, options?)`: serializes a rendered chart into a self-contained SVG string with
 *   all CSS custom properties (`var(--axylo-...)`) resolved to concrete colors/styles and HTML text
 *   overlays converted into positioned `<text>` elements (strict-CSP safe, zero host DOM mutation).
 * - `exportPng(target, options?)` / `exportPngDataUrl(target, options?)`: rasterizes the resolved
 *   standalone SVG onto an offscreen canvas at the requested DPR scale.
 * - `exportCsv(source, options?)` / `parseCsv(text, delimiter?)`: RFC 4180 CSV serialization matching
 *   Axylo's accessible table model (`TableModel`, rendered `<table>`, or `Data<Row>`), Node/SSR safe.
 *
 * Zero runtime dependencies, zero DOM access at import time, 0 raw bytes on bare import.
 */
import type { Data, Target } from './public.js';

export interface ExportSvgOptions {
  /** Override output width in CSS pixels (defaults to rendered figure/plot width). */
  readonly width?: number;
  /** Override output height in CSS pixels (defaults to rendered figure/plot height). */
  readonly height?: number;
  /** Background color fill (default: resolved figure background, or `'#ffffff'` if transparent; pass `'transparent'` to omit). */
  readonly background?: string;
  /** Include `<title>` and `<desc>` metadata from the chart's accessible heading and summary. Default `true`. */
  readonly includeMetadata?: boolean;
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
  /** Prepend UTF-8 BOM (`\uFEFF`) for Excel compatibility. Default `false`. */
  readonly bom?: boolean;
  /** Include header row. Default `true`. */
  readonly includeHeader?: boolean;
  /** Optional explicit column field order when exporting `Data<Row>`. */
  readonly fields?: readonly string[];
  /** Optional custom header labels aligned to `fields`. */
  readonly headers?: readonly string[];
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveElement(target: Target): HTMLElement {
  if (typeof target !== 'string') return target;
  if (typeof document === 'undefined') {
    throw new Error('axylo/export: CSS selector targets require a browser DOM.');
  }
  const el = document.querySelector<HTMLElement>(target);
  if (!el) throw new Error(`axylo/export: target '${target}' was not found in the document.`);
  return el;
}

function isTransparent(color: string | null | undefined): boolean {
  if (!color) return true;
  const c = color.trim().toLowerCase();
  return c === '' || c === 'transparent' || c === 'rgba(0, 0, 0, 0)' || c === 'rgba(0,0,0,0)';
}

function resolveBackground(root: HTMLElement, win: Window, requested?: string): string | null {
  if (requested === 'transparent' || requested === 'none') return null;
  if (requested) return requested;
  let cur: HTMLElement | null = root;
  while (cur) {
    const bg = win.getComputedStyle(cur).backgroundColor;
    if (!isTransparent(bg)) return bg;
    cur = cur.parentElement;
  }
  return '#ffffff';
}

const RESOLVED_SVG_PROPS: readonly [string, string][] = [
  ['fill', 'fill'],
  ['fillOpacity', 'fill-opacity'],
  ['stroke', 'stroke'],
  ['strokeWidth', 'stroke-width'],
  ['strokeOpacity', 'stroke-opacity'],
  ['strokeDasharray', 'stroke-dasharray'],
  ['strokeLinecap', 'stroke-linecap'],
  ['strokeLinejoin', 'stroke-linejoin'],
  ['opacity', 'opacity'],
];

function inlineResolvedSvgStyles(source: Element, clone: Element, win: Window): void {
  const tag = source.tagName.toLowerCase();
  if (tag !== 'clippath' && tag !== 'defs' && tag !== 'pattern') {
    const cs = win.getComputedStyle(source);
    for (const [prop, attr] of RESOLVED_SVG_PROPS) {
      const val = cs[prop as keyof CSSStyleDeclaration];
      if (typeof val !== 'string' || val === '' || val === 'normal') continue;
      if (attr === 'stroke-dasharray' && val === 'none') continue;
      if (attr === 'opacity' && val === '1') continue;
      if (attr === 'fill-opacity' && val === '1') continue;
      if (attr === 'stroke-opacity' && val === '1') continue;
      clone.setAttribute(attr, val);
    }
  }
  // Remove inline style attributes so no unresolved var(--axylo-...) remains in standalone SVG.
  clone.removeAttribute('style');
  const srcKids = source.children;
  const dstKids = clone.children;
  const len = Math.min(srcKids.length, dstKids.length);
  for (let i = 0; i < len; i++) {
    inlineResolvedSvgStyles(srcKids[i]!, dstKids[i]!, win);
  }
}

function parseRotationDegrees(transform: string): number {
  if (!transform || transform === 'none') return 0;
  const m = /^matrix\(([^)]+)\)/.exec(transform);
  if (!m) return 0;
  const parts = m[1]!.split(',').map(Number);
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return 0;
  return Math.round(Math.atan2(parts[1]!, parts[0]!) * (180 / Math.PI) * 100) / 100;
}

/**
 * Serializes a rendered Axylo chart into a standalone, self-contained SVG string with resolved
 * colors, stroke/fill attributes, background, text overlays, and accessible metadata.
 */
export function exportSvg(target: Target, options: ExportSvgOptions = {}): string {
  const root = resolveElement(target);
  const doc = root.ownerDocument;
  const win = doc?.defaultView;
  if (!doc || !win) throw new Error('axylo/export: exportSvg requires a browser DOM window.');

  const figure = (root.tagName.toLowerCase() === 'figure' ? root : root.querySelector<HTMLElement>('figure')) ?? root;
  const srcSvg = figure.querySelector<SVGSVGElement>('svg');
  if (!srcSvg) throw new Error('axylo/export: no rendered <svg> chart surface found inside target.');

  const svgRect = srcSvg.getBoundingClientRect();
  const attrW = Number(srcSvg.getAttribute('width'));
  const attrH = Number(srcSvg.getAttribute('height'));
  const width = Math.max(1, Math.round(options.width ?? (svgRect.width > 0 ? svgRect.width : Number.isFinite(attrW) && attrW > 0 ? attrW : 600)));
  const height = Math.max(1, Math.round(options.height ?? (svgRect.height > 0 ? svgRect.height : Number.isFinite(attrH) && attrH > 0 ? attrH : 320)));

  const clone = srcSvg.cloneNode(true) as SVGSVGElement;
  inlineResolvedSvgStyles(srcSvg, clone, win);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  clone.removeAttribute('aria-hidden');

  const parts: string[] = [];
  if (options.includeMetadata !== false) {
    const titleEl = figure.querySelector<HTMLElement>('figcaption h2, figcaption h3, figcaption h4, figcaption h5, figcaption h6, .axylo-title');
    const titleText = titleEl?.textContent?.trim();
    if (titleText) parts.push(`<title>${escapeXml(titleText)}</title>`);
    const descId = figure.getAttribute('aria-describedby') ?? figure.querySelector('[aria-describedby]')?.getAttribute('aria-describedby');
    const descText = descId ? doc.getElementById(descId)?.textContent?.trim() : undefined;
    if (descText) parts.push(`<desc>${escapeXml(descText)}</desc>`);
  }

  const bg = resolveBackground(figure, win, options.background);
  if (bg) parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(bg)}" />`);

  // Inner SVG marks with resolved styles
  parts.push(clone.innerHTML);

  // Convert positioned HTML `.axylo-text` overlay spans into concrete SVG `<text>` elements
  const textLayer = figure.querySelector<HTMLElement>('.axylo-text');
  if (textLayer && svgRect.width > 0 && svgRect.height > 0) {
    const scaleX = width / svgRect.width;
    const scaleY = height / svgRect.height;
    const spans = textLayer.querySelectorAll<HTMLElement>('span, div');
    const textEls: string[] = [];
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i]!;
      // Only serialize leaf text elements to avoid duplicating nested spans.
      if (span.children.length > 0) continue;
      const content = span.textContent?.trim();
      if (!content) continue;
      const r = span.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const cs = win.getComputedStyle(span);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
      const cx = Math.round(((r.left + r.width / 2) - svgRect.left) * scaleX * 100) / 100;
      const cy = Math.round(((r.top + r.height / 2) - svgRect.top) * scaleY * 100) / 100;
      const deg = parseRotationDegrees(cs.transform);
      const transformAttr = deg !== 0 ? ` transform="rotate(${deg} ${cx} ${cy})"` : '';
      const fill = escapeXml(cs.color || '#111111');
      const family = escapeXml(cs.fontFamily || 'sans-serif');
      const size = escapeXml(cs.fontSize || '12px');
      const weight = escapeXml(cs.fontWeight || '400');
      textEls.push(
        `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" fill="${fill}" font-family="${family}" font-size="${size}" font-weight="${weight}"${transformAttr}>${escapeXml(content)}</text>`,
      );
    }
    if (textEls.length > 0) parts.push(`<g class="axylo-export-text">${textEls.join('')}</g>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
}

async function rasterizeSvgToCanvas(target: Target, options: ExportPngOptions = {}): Promise<HTMLCanvasElement> {
  const root = resolveElement(target);
  const doc = root.ownerDocument;
  const win = doc?.defaultView;
  if (!doc || !win) throw new Error('axylo/export: exportPng requires a browser DOM window.');

  const svgText = exportSvg(root, options);
  const wMatch = /\bwidth="(\d+)"/.exec(svgText);
  const hMatch = /\bheight="(\d+)"/.exec(svgText);
  const width = Math.max(1, Number(wMatch?.[1] ?? 600));
  const height = Math.max(1, Number(hMatch?.[1] ?? 320));
  const scale = typeof options.scale === 'number' && Number.isFinite(options.scale) && options.scale > 0
    ? options.scale
    : Math.max(1, win.devicePixelRatio || 1);

  const canvas = doc.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('axylo/export: failed to acquire 2D canvas context.');

  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new win.Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('axylo/export: failed to load SVG image for PNG rasterization.'));
      img.src = url;
    });
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Rasterizes a rendered Axylo chart into an `image/png` Blob at the requested DPR scale. */
export async function exportPng(target: Target, options: ExportPngOptions = {}): Promise<Blob> {
  const canvas = await rasterizeSvgToCanvas(target, options);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('axylo/export: canvas.toBlob() returned null.'));
    }, 'image/png');
  });
}

/** Rasterizes a rendered Axylo chart into a `data:image/png;base64,...` data URL. */
export async function exportPngDataUrl(target: Target, options: ExportPngOptions = {}): Promise<string> {
  const canvas = await rasterizeSvgToCanvas(target, options);
  return canvas.toDataURL('image/png');
}

// ── RFC 4180 CSV Export & Round-Trip Parser ─────────────────────────────────────────────────────

function formatCsvCell(raw: unknown, delimiter: string): string {
  const text = raw === null || raw === undefined ? '' : raw instanceof Date ? raw.toISOString() : String(raw);
  if (text.includes(delimiter) || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function serializeCsvRows(headers: readonly string[] | null, rows: readonly (readonly unknown[])[], options: ExportCsvOptions): string {
  const delimiter = options.delimiter ?? ',';
  const eol = options.lineEnding ?? '\r\n';
  const lines: string[] = [];
  if (options.includeHeader !== false && headers && headers.length > 0) {
    lines.push(headers.map(h => formatCsvCell(h, delimiter)).join(delimiter));
  }
  for (let i = 0; i < rows.length; i++) {
    lines.push(rows[i]!.map(cell => formatCsvCell(cell, delimiter)).join(delimiter));
  }
  const body = lines.join(eol);
  return options.bom ? `\uFEFF${body}` : body;
}

function isTableModel(v: unknown): v is CsvTableLike {
  return v !== null && typeof v === 'object' && Array.isArray((v as CsvTableLike).headers)
    && typeof (v as CsvTableLike).rowCount === 'number' && typeof (v as CsvTableLike).row === 'function';
}

function isDomTarget(v: unknown): v is Target {
  if (typeof v === 'string') return true;
  return typeof HTMLElement !== 'undefined' && v instanceof HTMLElement;
}

/**
 * Exports RFC 4180 CSV matching Axylo's accessible table semantics.
 * Accepts:
 * 1. A `TableModel` (`{ headers, rowCount, row(i) }`) directly,
 * 2. A mounted DOM `Target` containing an Axylo `<table>` (opens/reads exact rendered headers & cells), or
 * 3. Any Axylo `Data<Row>` (`readonly Row[]` or `{ columns }`) for Node/SSR export.
 */
export function exportCsv<Row = Record<string, unknown>>(
  source: Target | CsvTableLike | Data<Row>,
  options: ExportCsvOptions = {},
): string {
  if (isTableModel(source)) {
    const rows: (readonly string[])[] = [];
    for (let i = 0; i < source.rowCount; i++) {
      const r = source.row(i);
      if (r) rows.push(r);
    }
    return serializeCsvRows(options.headers ?? source.headers, rows, options);
  }

  if (isDomTarget(source)) {
    const root = resolveElement(source);
    const table = root.tagName.toLowerCase() === 'table' ? root : root.querySelector('table');
    if (!table) {
      throw new Error('axylo/export: no rendered <table> found inside target. Open the accessible table or pass a TableModel / Data<Row>.');
    }
    const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent?.trim() ?? '');
    const rows = [...table.querySelectorAll('tbody tr')].map(tr =>
      [...tr.querySelectorAll('th, td')].map(cell => cell.textContent?.trim() ?? ''),
    );
    return serializeCsvRows(options.headers ?? headers, rows, options);
  }

  // Data<Row>: either row array or { columns }
  if (Array.isArray(source)) {
    const fields = options.fields ?? (source.length > 0 && source[0] && typeof source[0] === 'object'
      ? Object.keys(source[0] as Record<string, unknown>) : []);
    const headers = options.headers ?? fields;
    const rows = source.map(row => {
      const rec = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
      return fields.map(f => rec[f]);
    });
    return serializeCsvRows(headers, rows, options);
  }

  if (source && typeof source === 'object' && 'columns' in source) {
    const cols = source.columns as Record<string, ArrayLike<unknown>>;
    const fields = options.fields ?? Object.keys(cols);
    const headers = options.headers ?? fields;
    const len = fields.reduce((m, f) => Math.max(m, cols[f]?.length ?? 0), 0);
    const rows: unknown[][] = new Array(len);
    for (let i = 0; i < len; i++) {
      rows[i] = fields.map(f => cols[f]?.[i]);
    }
    return serializeCsvRows(headers, rows, options);
  }

  throw new Error('axylo/export: unsupported CSV source.');
}

/** RFC 4180 CSV parser for verification and consumer round-trip parity (strips optional UTF-8 BOM). */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const src = text.startsWith('\uFEFF') ? text.slice(1) : text;
  if (src.length === 0) return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < src.length) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else if (ch === '"' && field.length === 0) {
      inQuotes = true;
      i++;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
      i++;
    } else if (ch === '\r' || ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (ch === '\r' && src[i + 1] === '\n') i += 2;
      else i++;
    } else {
      field += ch;
      i++;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

export type { Data, Target } from './public.js';
