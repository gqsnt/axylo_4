/**
 * The DOM text layer: labels land where their `box` says (the boxes are computed in the entry from canvas
 * metrics of the layer's own font, as layout will), and they are real text that honours the WCAG 1.4.12
 * text-spacing overrides (spec A6).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import type { TextProbe } from './entries/api';
import { close, open } from './util';

beforeAll(start);
afterAll(stop);

describe('text layer', () => {
  let page: Page;
  let probes: TextProbe[];
  beforeAll(async () => {
    page = await open();
    probes = await page.evaluate(() => window.axr.mountText(20, 60));
  });
  afterAll(async () => { await close(page); });

  const names = ['rotated -45, end-anchored', 'two lines, middle, top', 'end-anchored', 'rotated -90'];

  it('each label lands on its box within 1.5 px', () => {
    expect(probes).toHaveLength(4);
    probes.forEach((p, i) => {
      for (const k of ['x', 'y', 'width', 'height'] as const) {
        expect(Math.abs(p.rect[k] - p.box[k]), `${names[i]} ${k}: rect ${p.rect[k]} box ${p.box[k]}`).toBeLessThanOrEqual(1.5);
      }
    });
  });

  it('the anchors hold: end-anchored text ends on x, the two-line label is centred on x and starts at y', () => {
    const end = probes[2]!.rect;
    expect(Math.abs(end.x + end.width - 380)).toBeLessThanOrEqual(1.5);
    const two = probes[1]!.rect;
    expect(Math.abs(two.x + two.width / 2 - 100)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(two.y - 200)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(two.height - 36)).toBeLessThanOrEqual(1.5);
  });

  it('reuses its elements and inserts text as text, never as HTML', async () => {
    expect(await page.evaluate(() => window.axr.textReuse())).toEqual({ sameNodes: true, markupInert: true });
  });

  it('honours the WCAG 1.4.12 text-spacing overrides from a user stylesheet', async () => {
    const before = await page.evaluate(() => window.axr.measureText());
    await page.addStyleTag({ content: '* { letter-spacing: 0.12em !important; word-spacing: 0.16em !important; line-height: 1.5 !important; }' });
    const after = await page.evaluate(() => window.axr.measureText());
    // "1,250 kWh": 9 characters and one space at 14 px, so about 9 × 1.68 + 2.24 = 17.4 px wider.
    const grew = after[2]!.rect.width - before[2]!.rect.width;
    expect(grew).toBeGreaterThan(14);
    expect(grew).toBeLessThan(21);
    // Still end-anchored with the new metrics.
    expect(Math.abs(after[2]!.rect.x + after[2]!.rect.width - 380)).toBeLessThanOrEqual(1.5);
    // Two lines at line-height 1.5 × 14 px.
    expect(Math.abs(after[1]!.rect.height - 42)).toBeLessThanOrEqual(1.5);
  });
});
