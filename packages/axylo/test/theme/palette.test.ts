import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { contrastRatio, parseColor, type Rgba } from '../../src/theme/color';
import { DARK, LIGHT } from '../../src/theme/palette';
import { AXYLO_CSS } from '../../src/theme/css';

const c = (s: string): Rgba => parseColor(s)!;
const research = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../../../research/palette/feasibility.json'), 'utf8')) as
  Record<string, { background: string; colors: string[]; contrast: number[] }>;

describe('default palette (spec A5)', () => {
  for (const [name, scheme, source] of [['light', LIGHT, 'usable-light-8'], ['dark', DARK, 'usable-dark-8']] as const) {
    it(`${name}: the eight series colors are the provisional research set`, () => {
      expect(scheme.series).toEqual(research[source]!.colors);
      expect(scheme.background).toBe(research[source]!.background);
    });

    it(`${name}: every series color reaches 3:1 on the default background`, () => {
      const bg = c(scheme.background);
      expect(scheme.series).toHaveLength(8);
      scheme.series.forEach((color, i) => {
        const k = contrastRatio(c(color), bg);
        expect(k, `${color}`).toBeGreaterThanOrEqual(3);
        // Independent check of the contrast code against the ratios the palette search recorded.
        expect(k).toBeCloseTo(research[source]!.contrast[i]!, 1);
      });
    });

    it(`${name}: token colors meet spec L2 (axis and focus 3:1; muted and reference 4.5:1, they label text)`, () => {
      const bg = c(scheme.background);
      expect(contrastRatio(c(scheme.axis), bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c(scheme.focus), bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c(scheme.muted), bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c(scheme.reference), bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('default stylesheet', () => {
  it('defines the light and dark token sets, forced colors and the dash switch', () => {
    for (let i = 1; i <= 8; i++) {
      expect(AXYLO_CSS).toContain(`--axylo-series-${i}: ${LIGHT.series[i - 1]};`);
      expect(AXYLO_CSS).toContain(`--axylo-series-${i}: ${DARK.series[i - 1]};`);
      expect(AXYLO_CSS).toContain(`--axylo-series-${i}: CanvasText !important;`);
    }
    expect(AXYLO_CSS).toContain('.axylo[data-axylo-scheme="dark"]');
    expect(AXYLO_CSS).toContain('@media (forced-colors: active)');
    expect(AXYLO_CSS).toMatch(/@media \(prefers-contrast: more\), \(forced-colors: active\) \{\s*\.axylo-svg \.axylo-dashed \{ stroke-dasharray: var\(--axylo-dash-contrast/);
    expect(AXYLO_CSS).toContain('--axylo-stylesheet: loaded');
  });

  it('never sets what scheme detection reads (color-scheme, color, --axylo-background) outside forced colors', () => {
    const outsideForced = AXYLO_CSS.replace(/@media \(forced-colors: active\) \{[\s\S]*?\n {2}\}\n/, '');
    expect(outsideForced).not.toMatch(/color-scheme\s*:/);
    expect(outsideForced).not.toMatch(/--axylo-background\s*:/);
    expect(outsideForced).not.toMatch(/\.axylo\s*\{[^}]*[^-]color\s*:/);
  });

  it('ends with the marker for the figure module', () => {
    expect(AXYLO_CSS.trimEnd().endsWith('*/')).toBe(true);
    expect(AXYLO_CSS).toContain('/* structure: added by the figure module');
  });

  it('balances its braces', () => {
    expect(AXYLO_CSS.split('{').length).toBe(AXYLO_CSS.split('}').length);
  });
});
