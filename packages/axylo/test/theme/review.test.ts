/** Regression tests for the render review (reviews/2026-11-18/impl/wp/render.review.md), color math. */
import { describe, expect, it } from 'vitest';
import { lowContrastSeries } from '../../src/theme/color';
import type { ResolvedTheme } from '../../src/core/contracts';
import { AXYLO_CSS } from '../../src/theme/css';
import { DARK, LIGHT } from '../../src/theme/palette';

const theme = (background: string, series: string[]): ResolvedTheme => ({
  scheme: 'dark', forcedColors: false, moreContrast: false,
  paints: { tokens: { axis: '', grid: '', reference: '', muted: '', focus: '', background, text: '' }, series },
});
const check = lowContrastSeries as (t: ResolvedTheme, backdrop?: string) => number[];

describe('finding 9: contrast is measured over the real backdrop', () => {
  it('a translucent background over a black panel is measured as composited over that panel', () => {
    // rgba(0,0,0,0.1) over black is black: black ink on it is 1:1, not the 15:1 a white backdrop would give.
    expect(check(theme('rgba(0, 0, 0, 0.1)', ['rgb(0, 0, 0)']), 'rgb(0, 0, 0)')).toEqual([0]);
  });

  it('a transparent background still checks every series against the backdrop', () => {
    expect(check(theme('rgba(0, 0, 0, 0)', ['rgb(10, 10, 10)', 'rgb(255, 255, 255)']), 'rgb(0, 0, 0)')).toEqual([0]);
  });

  it('a translucent series color is composited over the background first', () => {
    expect(lowContrastSeries(theme('rgb(0, 0, 0)', ['rgba(255, 255, 255, 0.1)', 'rgb(255, 255, 255)']))).toEqual([0]);
  });

  it('without a backdrop a translucent background is read over white (the initial page canvas)', () => {
    expect(check(theme('rgba(0, 0, 0, 0)', ['rgb(250, 250, 250)', 'rgb(0, 0, 0)']))).toEqual([0]);
  });
});

describe('L4 without a script: the private defaults follow the used colour scheme (seventh pass)', () => {
  const block = (selector: string): string => {
    const at = AXYLO_CSS.indexOf(`  ${selector} {\n`);
    if (at < 0) throw new Error(`no block ${selector}`);
    return AXYLO_CSS.slice(at, AXYLO_CSS.indexOf('\n  }', at));
  };

  it('the .axylo defaults are light-dark(light, dark) pairs, so a media change switches them in the same frame', () => {
    const base = block('.axylo');
    LIGHT.series.forEach((light, i) => {
      expect(base).toContain(`--axylo-default-series-${i + 1}: light-dark(${light}, ${DARK.series[i]});`);
    });
    for (const key of ['background', 'axis', 'grid', 'muted', 'reference', 'focus'] as const) {
      expect(base).toContain(`--axylo-default-${key}: light-dark(${LIGHT[key]}, ${DARK[key]});`);
    }
  });

  it('a scheme the chart resolved itself (color-scheme normal) still selects one fixed set', () => {
    const light = block('.axylo[data-axylo-scheme="light"]');
    const dark = block('.axylo[data-axylo-scheme="dark"]');
    LIGHT.series.forEach((c, i) => expect(light).toContain(`--axylo-default-series-${i + 1}: ${c};`));
    DARK.series.forEach((c, i) => expect(dark).toContain(`--axylo-default-series-${i + 1}: ${c};`));
  });
});
