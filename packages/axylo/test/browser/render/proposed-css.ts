/**
 * The library's default stylesheet as a string. `ensureStyles` adopts it as a constructable stylesheet; the
 * build writes the same string to dist/axylo.css for pages that prefer to load it themselves.
 *
 * Everything sits in the `axylo` cascade layer so that any unlayered rule of the page wins over a default
 * without a specificity contest, whichever order the sheets arrive in.
 *
 * Token scheme: the sheet sets only private defaults (`--axylo-default-axis`, `--axylo-default-series-1`, …)
 * on `.axylo`. The public names (`--axylo-axis`, `--axylo-series-1`, `--axylo-background`, `--axylo-text`,
 * `--axylo-font-family`, …) are never set outside forced colors, so an author may set them anywhere,
 * including `:root`, and inheritance carries them in. Every use reads `var(--axylo-x, var(--axylo-default-x))`.
 *
 * Things this sheet must never do, because scheme detection (spec L4) reads them from the chart root: set
 * `color-scheme` or `color` on `.axylo`, or set `--axylo-background` outside forced colors.
 *
 * Component selectors are scoped beneath `.axylo`, so a page's own `.axylo-text` is left alone.
 */
import { DARK, LIGHT, type SchemeColors } from '../../../src/theme/palette';

function tokens(c: SchemeColors): string {
  const series = c.series.map((v, i) => `    --axylo-default-series-${i + 1}: ${v};`).join('\n');
  return `${series}
    --axylo-default-background: ${c.background};
    --axylo-default-axis: ${c.axis};
    --axylo-default-grid: ${c.grid};
    --axylo-default-muted: ${c.muted};
    --axylo-default-reference: ${c.reference};
    --axylo-default-focus: ${c.focus};`;
}

// Forced colors: every paint becomes a system color. `!important` so an author's custom property, whether
// inherited or set on the chart, cannot leak a brand color into a mode where the user chose the colors.
// `--axylo-forced-series` switches off the author's pinned series colors (resolveTheme writes each as
// `var(--axylo-forced-series, <author color>)` on the chart root), so they return when forced colors ends.
const forced = [
  ...LIGHT.series.map((_, i) => `    --axylo-series-${i + 1}: CanvasText !important;`),
  '    --axylo-forced-series: CanvasText !important;',
  '    --axylo-background: Canvas !important;',
  '    --axylo-default-background: Canvas !important;',
  '    --axylo-text: CanvasText !important;',
  '    --axylo-axis: CanvasText !important;',
  '    --axylo-grid: GrayText !important;',
  '    --axylo-muted: GrayText !important;',
  '    --axylo-reference: CanvasText !important;',
  '    --axylo-focus: Highlight !important;',
].join('\n');

export const AXYLO_CSS = `/* Axylo default stylesheet */
@layer axylo {
  /* Lets ensureStyles find this sheet; it checks the sheet's effect as well, not only this sentinel. */
  :root { --axylo-stylesheet: loaded; }

  /* tokens: private defaults, light set */
  .axylo {
${tokens(LIGHT)}
  }

  /* tokens: private defaults, dark set, selected by the scheme the chart resolved */
  .axylo[data-axylo-scheme="dark"] {
${tokens(DARK)}
  }

  @media (forced-colors: active) {
    .axylo {
${forced}
    }
  }

  /* marks */
  .axylo .axylo-svg, .axylo .axylo-canvas { position: absolute; left: 0; top: 0; display: block; pointer-events: none; }
  .axylo .axylo-svg { overflow: hidden; }
  .axylo .axylo-canvas > canvas { position: absolute; left: 0; top: 0; display: block; }

  /*
   * Dash patterns of the SVG renderer. Each dashed element carries its normal pattern inline and both
   * patterns as custom properties; this switch needs no redraw (spec A5).
   */
  @media (prefers-contrast: more), (forced-colors: active) {
    .axylo .axylo-svg .axylo-dashed { stroke-dasharray: var(--axylo-dash-contrast, none) !important; }
  }

  /*
   * text layer: real HTML text, so it inherits the page font, honours text spacing and forced colors.
   * Typography custom properties (spec DX6): --axylo-font-family, --axylo-font-size, --axylo-font-weight,
   * --axylo-line-height, --axylo-letter-spacing. Unset, each inherits from the page. Layout measures with
   * this layer's computed font, so the same values reach measurement.
   */
  .axylo .axylo-text {
    position: absolute;
    inset: 0;
    pointer-events: none;
    color: var(--axylo-text, currentColor);
    font-family: var(--axylo-font-family, inherit);
    font-size: var(--axylo-font-size, max(12px, 1em));
    font-weight: var(--axylo-font-weight, inherit);
    line-height: var(--axylo-line-height, inherit);
    letter-spacing: var(--axylo-letter-spacing, inherit);
    white-space: nowrap;
  }
  .axylo .axylo-text > .axylo-label { position: absolute; left: 0; top: 0; transform-origin: 0 0; white-space: pre; }
  .axylo .axylo-text > .axylo-label > div { display: block; }
}

/* structure: added by the figure module (inside "@layer axylo { … }") */
`;
