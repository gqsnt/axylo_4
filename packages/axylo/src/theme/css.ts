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
import { DARK, LIGHT, type SchemeColors } from './palette';

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
  .axylo-subtitle { margin: 0.125em 0 0; font-size: max(12px, 0.875em); color: var(--axylo-muted, var(--axylo-default-muted)); overflow-wrap: anywhere; }
  .axylo-summary { margin: 0.25em 0 0; font-size: max(12px, 0.875em); }
  /*
   * The plot takes what the caption and note leave. Its content is a spacer that is 16:9 of its width,
   * clamped to 160–480 px (spec L3): that is its height when the container has none of its own, and only
   * its starting size when it does (flex then grows or shrinks it to fit).
   */
  /* The plot and a legend beside it share one row, which takes what the caption and the controls leave. */
  .axylo-body { flex: 1 1 auto; display: flex; flex-direction: row; min-height: 0; min-width: 0; }
  .axylo-plot { position: relative; flex: 1 1 auto; min-height: 0; min-width: 0; overflow: hidden; }
  .axylo-plot::before { content: ""; display: block; width: 100%; aspect-ratio: 16 / 9; min-height: 160px; max-height: 480px; }
  .axylo-compact .axylo-plot::before { aspect-ratio: auto; min-height: 0; max-height: none; height: 32px; }
  .axylo-message {
    position: absolute; inset: 0; margin: 0; padding: 8px; box-sizing: border-box;
    display: flex; align-items: center; justify-content: center; text-align: center;
    font-size: max(12px, 1em); color: var(--axylo-muted, var(--axylo-default-muted)); overflow-wrap: anywhere;
  }
  .axylo-corner {
    position: absolute; top: 0; right: 0; padding: 0 2px; font-size: 12px; line-height: 1;
    color: var(--axylo-text, currentColor); pointer-events: none;
  }
  .axylo-note { flex: none; margin: 0.5em 0 0; font-size: max(12px, 0.875em); }
  /* The tooltip can itself be hovered (spec I1, WCAG 1.4.13), so it takes pointer events. */
  .axylo .axylo-tooltip, .axylo .axylo-readout {
    position: absolute; left: 0; top: 0; z-index: 3; box-sizing: border-box;
    max-width: min(320px, 100%); padding: 4px 8px; border: 1px solid var(--axylo-axis, var(--axylo-default-axis)); border-radius: 4px;
    background: var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background))); color: var(--axylo-text, currentColor);
    font-size: max(12px, 0.875em); line-height: 1.4;
  }
  /* The fixed readout under the plot of a narrow tile (spec I1): it overlays what is below, so showing it
     never changes the figure's size. */
  .axylo .axylo-readout { right: 0; max-width: none; }
  /* A readout pinned by touch over the controls lets taps through to them (review 2, finding 13). */
  .axylo .axylo-readout.axylo-passive { pointer-events: none; }
  /* A tooltip row can be chosen with a click or a tap (WCAG 2.5.1). */
  .axylo .axylo-tooltip-choice { cursor: pointer; }
  .axylo .axylo-tooltip-title { font-weight: 600; }
  .axylo .axylo-tooltip-row { display: flex; gap: 1em; justify-content: space-between; }
  .axylo .axylo-tooltip-series { display: inline-flex; align-items: center; gap: 0.375em; min-width: 0; overflow-wrap: anywhere; }
  .axylo .axylo-tooltip-value { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .axylo .axylo-tooltip-total {
    margin-top: 2px; padding-top: 2px; border-top: 1px solid var(--axylo-axis, var(--axylo-default-axis));
    text-align: end; font-weight: 600; font-variant-numeric: tabular-nums;
  }
  .axylo .axylo-swatch { flex: none; display: inline-block; overflow: visible; }
  /* The swatch repeats the dash the marks use, normal or contrast (spec A5; review 2, finding 22). */
  .axylo .axylo-swatch-line { stroke-dasharray: var(--axylo-swatch-dash, none); }
  @media (prefers-contrast: more), (forced-colors: active) {
    .axylo .axylo-swatch-line { stroke-dasharray: var(--axylo-swatch-dash-contrast, none); }
  }
  /* A reference label sits on a plate of the backdrop color, so it stays readable over marks (spec L6). */
  .axylo .axylo-label[data-role="reference"] {
    background: var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background)));
    box-shadow: 0 0 0 2px var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background)));
  }

  /*
   * Interaction. The plot keeps a one-finger drag for the page (spec I4); with zoom: 'touch' pinch and
   * two-finger pan come to the chart. Tick text is not selectable, so a drag selects a range, not text.
   */
  .axylo .axylo-plot { user-select: none; -webkit-user-select: none; touch-action: manipulation; }
  .axylo .axylo-plot.axylo-touch-zoom { touch-action: pan-x pan-y; }
  .axylo .axylo-plot.axylo-zoomable { cursor: crosshair; }
  /* The keyboard proxy (decision 0001): a native range over the plot, transparent, never in the pointer's way. */
  .axylo .axylo-proxy {
    position: absolute; z-index: 2; margin: 0; padding: 0; border: 0; box-sizing: border-box;
    opacity: 0; pointer-events: none; appearance: none; -webkit-appearance: none; background: transparent;
  }
  /* The plot's focus indicator (spec A2): 2 px in the focus token, at least 3:1 in both schemes. */
  .axylo .axylo-focus-ring {
    position: absolute; z-index: 2; display: none; box-sizing: border-box; pointer-events: none;
    /* Inside the plot's box: the plot clips, and a ring outside it would not be seen (review 2, finding 14). */
    outline: 2px solid var(--axylo-focus, var(--axylo-default-focus)); outline-offset: -3px;
  }
  .axylo .axylo-proxy:focus-visible + .axylo-focus-ring { display: block; }
  /* The donut slice the keyboard is on, also when it has no arc. */
  .axylo .axylo-legend-list > li.axylo-legend-current { outline: 2px solid var(--axylo-focus, var(--axylo-default-focus)); outline-offset: 1px; }
  .axylo .axylo-selection {
    position: absolute; z-index: 1; box-sizing: border-box; pointer-events: none;
    border: 1px solid var(--axylo-focus, var(--axylo-default-focus));
    background: color-mix(in srgb, var(--axylo-focus, var(--axylo-default-focus)) 16%, transparent);
  }

  /* Legend, toolbar and table, under the plot. */
  .axylo .axylo-controls { flex: none; display: flex; flex-direction: column; gap: 0.5em; margin: 0.5em 0 0; min-width: 0; }
  /* legend: 'top' puts the legend and its toolbar above the plot; 'right' beside it, entries stacked. */
  .axylo .axylo-controls-top, .axylo .axylo-controls-side { flex: none; display: flex; flex-direction: column; gap: 0.5em; min-width: 0; }
  .axylo .axylo-controls-top { margin: 0 0 0.5em; }
  .axylo .axylo-controls-side { margin: 0 0 0 0.75em; max-width: 40%; overflow: auto; }
  .axylo .axylo-controls-side .axylo-toolbar { flex-direction: column; align-items: stretch; flex-wrap: nowrap; }
  .axylo .axylo-controls-side .axylo-legend-list { flex-direction: column; flex-wrap: nowrap; }
  .axylo .axylo-controls-side .axylo-legend-entry + .axylo-control:not(.axylo-legend-entry) { margin-inline-start: 0; margin-block-start: 0.5em; }
  .axylo .axylo-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; min-width: 0; }
  .axylo .axylo-control {
    display: inline-flex; align-items: center; gap: 0.375em; box-sizing: border-box; min-width: 24px; min-height: 24px;
    margin: 0; padding: 2px 8px; border: 1px solid var(--axylo-axis, var(--axylo-default-axis)); border-radius: 4px;
    background: var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background))); color: var(--axylo-text, currentColor);
    font: inherit; font-size: max(12px, 0.875em); line-height: 1.25; text-align: start; cursor: pointer;
  }
  /* Legend entries first; the other controls start on the right. */
  .axylo .axylo-legend-entry + .axylo-control:not(.axylo-legend-entry) { margin-inline-start: auto; }
  .axylo .axylo-control:focus-visible { outline: 2px solid var(--axylo-focus, var(--axylo-default-focus)); outline-offset: 1px; }
  .axylo .axylo-control[aria-disabled="true"] { cursor: default; border-style: dashed; }
  /* Legend toggles read as legend entries; a hidden series keeps full-contrast text, struck through (spec L2). */
  .axylo .axylo-legend-entry { border-color: transparent; padding-inline: 4px; }
  .axylo .axylo-legend-entry:hover { border-color: var(--axylo-axis, var(--axylo-default-axis)); }
  .axylo .axylo-legend-entry.axylo-struck .axylo-control-label { text-decoration: line-through; text-decoration-thickness: 1px; }
  .axylo .axylo-legend-list {
    display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 0; padding: 0; list-style: none; font-size: max(12px, 0.875em);
  }
  .axylo .axylo-legend-list > li { display: inline-flex; align-items: center; gap: 0.375em; min-width: 0; }
  .axylo .axylo-legend-value { font-variant-numeric: tabular-nums; }
  .axylo .axylo-table { display: flex; flex-direction: column; gap: 0.5em; min-width: 0; }
  /* The open table takes the plot's place at the plot's size, so nothing else moves (spec A4; review 2, finding 15). */
  .axylo .axylo-table-open .axylo-body { position: relative; }
  .axylo .axylo-body > .axylo-table {
    position: absolute; inset: 0; z-index: 4; box-sizing: border-box;
    background: var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background)));
  }
  .axylo .axylo-body > .axylo-table > .axylo-table-scroll { flex: 1 1 auto; }
  .axylo .axylo-table-scroll { overflow: auto; box-sizing: border-box; min-height: 0; border: 1px solid var(--axylo-grid, var(--axylo-default-grid)); }
  .axylo .axylo-table-scroll:focus-visible { outline: 2px solid var(--axylo-focus, var(--axylo-default-focus)); outline-offset: 1px; }
  .axylo .axylo-table table { border-collapse: collapse; width: max-content; min-width: 100%; font-size: max(12px, 0.875em); font-variant-numeric: tabular-nums; }
  .axylo .axylo-table caption { padding: 4px 8px; text-align: start; font-weight: 600; caption-side: top; }
  .axylo .axylo-table th, .axylo .axylo-table td {
    padding: 2px 8px; border-bottom: 1px solid var(--axylo-grid, var(--axylo-default-grid)); text-align: end; white-space: nowrap;
  }
  .axylo .axylo-table th[scope="row"], .axylo .axylo-table thead th:first-child { text-align: start; }
  .axylo .axylo-table thead th { position: sticky; top: 0; background: var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background))); }
  .axylo .axylo-pager { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: max(12px, 0.875em); }
  .axylo .axylo-jump { display: inline-flex; align-items: center; gap: 0.375em; margin: 0; }
  .axylo .axylo-jump-field {
    box-sizing: border-box; min-height: 24px; width: 12em; padding: 2px 4px; font: inherit;
    border: 1px solid var(--axylo-axis, var(--axylo-default-axis)); border-radius: 2px;
    background: var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background))); color: var(--axylo-text, currentColor);
  }
  .axylo .axylo-jump-field:focus-visible { outline: 2px solid var(--axylo-focus, var(--axylo-default-focus)); outline-offset: 1px; }
}
`;
