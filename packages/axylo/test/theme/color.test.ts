import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { composite, contrastRatio, isLightColor, lowContrastSeries, parseColor, relativeLuminance, type Rgba } from '../../src/theme/color';
import type { ResolvedTheme } from '../../src/core/contracts';

const c = (s: string): Rgba => {
  const v = parseColor(s);
  if (v === null) throw new Error(`unparsed ${s}`);
  return v;
};

describe('parseColor', () => {
  it('reads the forms getComputedStyle returns', () => {
    expect(c('rgb(255, 0, 0)')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(c('rgba(0, 0, 255, 0.5)')).toEqual({ r: 0, g: 0, b: 1, a: 0.5 });
    expect(c('rgb(0 128 0 / 25%)').a).toBeCloseTo(0.25, 9);
    expect(c('rgb(0 128 0 / 25%)').g).toBeCloseTo(128 / 255, 9);
    expect(c('color(srgb 0.5 0.25 1)')).toEqual({ r: 0.5, g: 0.25, b: 1, a: 1 });
    expect(c('color(srgb 1 1 1 / 0.2)').a).toBeCloseTo(0.2, 9);
    expect(c('#767676').r).toBeCloseTo(0x76 / 255, 9);
    expect(c('#fff')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(c('transparent').a).toBe(0);
  });

  it('returns null rather than guessing', () => {
    for (const s of ['oklch(0.5 0.1 200)', 'lab(50 10 10)', 'color(display-p3 1 0 0)', 'red', 'rgb(1, 2)', '#12', 'var(--x)', '']) {
      expect(parseColor(s)).toBeNull();
    }
  });
});

describe('contrast (WCAG 2)', () => {
  it('black on white is 21:1', () => {
    expect(contrastRatio(c('#000'), c('#fff'))).toBeCloseTo(21, 9);
    expect(contrastRatio(c('#fff'), c('#000'))).toBeCloseTo(21, 9);
  });

  it('#767676 on white is about 4.54:1, the smallest gray that passes AA', () => {
    expect(contrastRatio(c('#767676'), c('#ffffff'))).toBeCloseTo(4.54, 2);
    expect(contrastRatio(c('#777777'), c('#ffffff'))).toBeLessThan(4.5);
  });

  it('luminance endpoints', () => {
    expect(relativeLuminance(c('#000'))).toBe(0);
    expect(relativeLuminance(c('#fff'))).toBeCloseTo(1, 12);
  });

  it('a translucent color is measured as it appears on the background', () => {
    const half = c('rgba(0, 0, 0, 0.5)');
    expect(contrastRatio(half, c('#fff'))).toBeCloseTo(contrastRatio(composite(half, c('#fff')), c('#fff')), 12);
    expect(contrastRatio(c('rgba(0, 0, 0, 0)'), c('#fff'))).toBeCloseTo(1, 12);
  });

  it('is symmetric and between 1 and 21 (property)', () => {
    const color = fc.record({ r: fc.double({ min: 0, max: 1, noNaN: true }), g: fc.double({ min: 0, max: 1, noNaN: true }), b: fc.double({ min: 0, max: 1, noNaN: true }) })
      .map(v => ({ ...v, a: 1 }));
    fc.assert(fc.property(color, color, (x, y) => {
      const k = contrastRatio(x, y);
      expect(k).toBeGreaterThanOrEqual(1 - 1e-12);
      expect(k).toBeLessThanOrEqual(21 + 1e-9);
      expect(contrastRatio(y, x)).toBeCloseTo(k, 9);
    }));
  });
});

describe('isLightColor', () => {
  it('splits where contrast with black equals contrast with white', () => {
    expect(isLightColor(c('#fff'))).toBe(true);
    expect(isLightColor(c('#000'))).toBe(false);
    expect(isLightColor(c('#16181d'))).toBe(false);
    expect(isLightColor(c('#e8eaee'))).toBe(true);
    fc.assert(fc.property(fc.integer({ min: 0, max: 255 }), v => {
      const gray = { r: v / 255, g: v / 255, b: v / 255, a: 1 };
      const black = { r: 0, g: 0, b: 0, a: 1 };
      const white = { r: 1, g: 1, b: 1, a: 1 };
      expect(isLightColor(gray)).toBe(contrastRatio(gray, black) > contrastRatio(gray, white));
    }));
  });
});

describe('lowContrastSeries', () => {
  const theme = (background: string, series: string[]): ResolvedTheme => ({
    scheme: 'light', forcedColors: false, moreContrast: false,
    paints: { tokens: { axis: '', grid: '', reference: '', muted: '', focus: '', background, text: '' }, series },
  });

  it('lists the series below 3:1 against the resolved background', () => {
    // #949494 on white is 3.03:1, #959595 is 2.99:1 (computed by the WCAG formula by hand for the check).
    const t = theme('rgb(255, 255, 255)', ['rgb(0, 0, 0)', 'rgb(149, 149, 149)', 'rgb(148, 148, 148)', 'rgb(255, 255, 0)']);
    expect(lowContrastSeries(t)).toEqual([1, 3]);
  });

  it('skips colors it cannot read and an unreadable background', () => {
    expect(lowContrastSeries(theme('rgb(255, 255, 255)', ['oklch(0.9 0 0)']))).toEqual([]);
    expect(lowContrastSeries(theme('nonsense', ['rgb(255, 255, 255)']))).toEqual([]);
  });
});
