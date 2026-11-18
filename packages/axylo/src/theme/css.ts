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
@layer axylo {
  .axylo [hidden] { display: none !important; }
  .axylo-visually-hidden {
    position: absolute !important; width: 1px !important; height: 1px !important; margin: -1px !important;
    padding: 0 !important; border: 0 !important; overflow: hidden !important; clip-path: inset(50%) !important;
    white-space: nowrap !important;
  }
  /* The figure fills a container that has a definite height; otherwise it is as tall as its content. */
  .axylo-figure {
    position: relative; display: flex; flex-direction: column; box-sizing: border-box;
    margin: 0; padding: 0; height: 100%; min-width: 0; min-height: 0;
  }
  .axylo-caption { flex: none; margin: 0 0 0.5em; min-width: 0; }
  .axylo-caption:has(> :not([hidden]):not(.axylo-visually-hidden)) { margin-bottom: 0.5em; }
  .axylo-caption:not(:has(> :not([hidden]):not(.axylo-visually-hidden))) { margin: 0; }
  .axylo-title { font-weight: 600; font-size: 1.125em; line-height: 1.3; overflow-wrap: anywhere; }
  .axylo-subtitle { margin: 0.125em 0 0; font-size: max(12px, 0.875em); color: var(--axylo-muted); overflow-wrap: anywhere; }
  .axylo-summary { margin: 0.25em 0 0; font-size: max(12px, 0.875em); }
  /*
   * The plot takes what the caption and note leave. Its content is a spacer that is 16:9 of its width,
   * clamped to 160–480 px (spec L3): that is its height when the container has none of its own, and only
   * its starting size when it does (flex then grows or shrinks it to fit).
   */
  .axylo-plot { position: relative; flex: 1 1 auto; min-height: 0; min-width: 0; overflow: hidden; }
  .axylo-plot::before { content: ""; display: block; width: 100%; aspect-ratio: 16 / 9; min-height: 160px; max-height: 480px; }
  .axylo-compact .axylo-plot::before { aspect-ratio: auto; min-height: 0; max-height: none; height: 32px; }
  .axylo-message {
    position: absolute; inset: 0; margin: 0; padding: 8px; box-sizing: border-box;
    display: flex; align-items: center; justify-content: center; text-align: center;
    font-size: max(12px, 1em); color: var(--axylo-muted); overflow-wrap: anywhere;
  }
  .axylo-corner {
    position: absolute; top: 0; right: 0; padding: 0 2px; font-size: 12px; line-height: 1;
    color: var(--axylo-text, currentColor); pointer-events: none;
  }
  .axylo-note { flex: none; margin: 0.5em 0 0; font-size: max(12px, 0.875em); }
  .axylo-tooltip {
    position: absolute; left: 0; top: 0; z-index: 1; pointer-events: none; box-sizing: border-box;
    max-width: min(320px, 100%); padding: 4px 8px; border: 1px solid var(--axylo-axis); border-radius: 4px;
    background: var(--axylo-background, var(--axylo-default-background)); color: var(--axylo-text, currentColor);
    font-size: max(12px, 0.875em); line-height: 1.4;
  }
  .axylo-tooltip-title { font-weight: 600; }
  .axylo-tooltip-row { display: flex; gap: 1em; justify-content: space-between; }
  .axylo-tooltip-value { font-variant-numeric: tabular-nums; white-space: nowrap; }
}
`;
