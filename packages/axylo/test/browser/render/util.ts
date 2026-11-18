import type { BrowserContextOptions, Page } from 'playwright-core';
import { openEntry } from '../harness';
import { decodePng, type Image } from './png';
import { parseColor } from '../../../src/theme/color';

export const ENTRY = 'packages/axylo/test/browser/render/entries/axylo-render.entry.ts';

/** Opens the blank page with the render entry loaded. The page's two buttons are hidden so nothing sits behind the marks. */
export async function open(options: BrowserContextOptions = {}): Promise<Page> {
  const page = await openEntry(ENTRY, options);
  await page.addStyleTag({ content: '#before, #after { display: none; }' });
  return page;
}

export async function close(page: Page): Promise<void> {
  const errors = (page as Page & { errors: string[] }).errors;
  await page.context().close();
  if (errors.length > 0) throw new Error(`page errors: ${errors.join('; ')}`);
}

/** Screenshot of a page region, decoded. At device scale factor k the image is k times the CSS size. */
export async function shot(page: Page, x: number, y: number, width: number, height: number): Promise<Image> {
  return decodePng(await page.screenshot({ clip: { x, y, width, height }, animations: 'disabled', caret: 'hide' }));
}

export type RGB = readonly [number, number, number];

export function at(img: Image, x: number, y: number): RGB {
  const o = (Math.floor(y) * img.width + Math.floor(x)) * 4;
  return [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!];
}

export function rgb(color: string): RGB {
  const c = parseColor(color);
  if (c === null) throw new Error(`not a color: ${color}`);
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

export const WHITE: RGB = [255, 255, 255];

/** Largest channel difference. */
export const diff = (a: RGB | readonly number[], b: RGB | readonly number[]): number =>
  Math.max(Math.abs(a[0]! - b[0]!), Math.abs(a[1]! - b[1]!), Math.abs(a[2]! - b[2]!));

/** `color` at `alpha` over `under`. */
export const blend = (color: RGB, alpha: number, under: RGB = WHITE): RGB =>
  [0, 1, 2].map(i => color[i]! * alpha + under[i]! * (1 - alpha)) as unknown as RGB;

export function ink(img: Image, x0: number, y0: number, x1: number, y1: number, background: RGB = WHITE, threshold = 40): number {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (diff(at(img, x, y), background) > threshold) n++;
  return n;
}

export const frames = (page: Page, n = 2): Promise<void> => page.evaluate(k => window.axr.frames(k), n);
