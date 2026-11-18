/**
 * The library's default stylesheet as a string. `ensureStyles` adopts it as a constructable stylesheet; the
 * build writes the same string to dist/axylo.css for pages that prefer to load it themselves.
 *
 * Everything sits in the `axylo` cascade layer so that any unlayered rule of the page wins over a default
 * without a specificity contest, whichever order the sheets arrive in.
 *
 * Two things this sheet must never do, because scheme detection (spec L4) reads them from the chart root:
 * set `color-scheme` or `color` on `.axylo`, or set `--axylo-background`. The default background therefore
 * lives in the private `--axylo-default-background`, and the background paint is
 * `var(--axylo-background, var(--axylo-default-background))`.
 */
import { DARK, LIGHT, type SchemeColors } from './palette';

function tokens(c: SchemeColors): string {
  const series = c.series.map((v, i) => `    --axylo-series-${i + 1}: ${v};`).join('\n');
  return `${series}
    --axylo-default-background: ${c.background};
    --axylo-axis: ${c.axis};
    --axylo-grid: ${c.grid};
    --axylo-muted: ${c.muted};
    --axylo-reference: ${c.reference};
    --axylo-focus: ${c.focus};`;
}

// Forced colors: every paint becomes a system color. `!important` so an author's custom property on the
// chart cannot leak a brand color into a mode where the user chose the colors.
const forced = [
  ...LIGHT.series.map((_, i) => `    --axylo-series-${i + 1}: CanvasText !important;`),
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
  /* Lets ensureStyles see that this sheet is already loaded. */
  :root { --axylo-stylesheet: loaded; }

  /* tokens: light set (default) */
  .axylo {
${tokens(LIGHT)}
  }

  /* tokens: dark set, selected by the scheme the chart resolved */
  .axylo[data-axylo-scheme="dark"] {
${tokens(DARK)}
  }

  @media (forced-colors: active) {
    .axylo {
${forced}
    }
  }

  /* marks */
  .axylo-svg, .axylo-canvas { position: absolute; left: 0; top: 0; display: block; pointer-events: none; }
  .axylo-svg { overflow: hidden; }
  .axylo-canvas > canvas { position: absolute; left: 0; top: 0; display: block; }

  /*
   * Dash patterns of the SVG renderer. Each dashed element carries its normal pattern inline and both
   * patterns as custom properties; this switch needs no redraw (spec A5).
   */
  @media (prefers-contrast: more), (forced-colors: active) {
    .axylo-svg .axylo-dashed { stroke-dasharray: var(--axylo-dash-contrast, none) !important; }
  }

  /* text layer: real HTML text, so it inherits the page font, honours text spacing and forced colors */
  .axylo-text {
    position: absolute;
    inset: 0;
    pointer-events: none;
    color: var(--axylo-text, currentColor);
    font-size: max(12px, 1em);
    white-space: nowrap;
  }
  .axylo-text > .axylo-label { position: absolute; left: 0; top: 0; transform-origin: 0 0; white-space: pre; }
  .axylo-text > .axylo-label > div { display: block; }
}

/* structure: added by the figure module (inside "@layer axylo { … }") */
`;
