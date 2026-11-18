/**
 * Spec L1 after a font that loads late: once the load is noted, the measurer measures with the new font in
 * every engine. WebKit's canvas keeps the font it resolved when `font` was assigned, and does not resolve it
 * again when the same string is assigned (engines report, WebKit section). Run on chromium, firefox and webkit
 * (AXYLO_ENGINE). No CDP: it is Chrome-only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { openEntry, start, stop } from '../harness';

beforeAll(start);
afterAll(stop);

describe('the measurer after a late font load', () => {
  it('a label measured after the load has its rendered width, within 0.5 px', async () => {
    const page = await openEntry('packages/axylo/test/browser/chart/entries/measure.entry.ts');
    const font = fs.readFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf').toString('base64');
    const css = '16px "Late Sans", sans-serif';
    const result = await page.evaluate(async ({ f, css }) => {
      const text = '14,000 Sessions';
      const span = document.body.appendChild(document.createElement('span'));
      span.style.font = css;
      span.style.whiteSpace = 'pre';
      span.textContent = text;
      const before = { measured: window.measure.width(text, css), rendered: span.getBoundingClientRect().width };
      const bytes = Uint8Array.from(atob(f), c => c.charCodeAt(0));
      const face = new FontFace('Late Sans', bytes);
      await face.load();
      document.fonts.add(face);
      await document.fonts.ready;
      window.measure.fontsLoaded();
      await new Promise(r => requestAnimationFrame(() => r(null)));
      return { before, after: { measured: window.measure.width(text, css), rendered: span.getBoundingClientRect().width } };
    }, { f: font, css });
    // The font did change the width, so the check after it is about a real change.
    expect(Math.abs(result.after.rendered - result.before.rendered)).toBeGreaterThan(5);
    expect(Math.abs(result.before.measured - result.before.rendered)).toBeLessThan(0.5);
    expect(Math.abs(result.after.measured - result.after.rendered)).toBeLessThan(0.5);
    await page.context().close();
  });
});
