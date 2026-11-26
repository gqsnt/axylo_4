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

/** Each default as `light-dark(light, dark)`: the browser picks by the chart's used colour scheme. */
function following(light: SchemeColors, dark: SchemeColors): string {
  const pair = (a: string, b: string) => `light-dark(${a}, ${b})`;
  const series = light.series.map((v, i) => `    --axylo-default-series-${i + 1}: ${pair(v, dark.series[i]!)};`).join('\n');
  return `${series}
    --axylo-default-background: ${pair(light.background, dark.background)};
    --axylo-default-axis: ${pair(light.axis, dark.axis)};
    --axylo-default-grid: ${pair(light.grid, dark.grid)};
    --axylo-default-muted: ${pair(light.muted, dark.muted)};
    --axylo-default-reference: ${pair(light.reference, dark.reference)};
    --axylo-default-focus: ${pair(light.focus, dark.focus)};`;
}

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

  /*
   * tokens: private defaults that follow the chart's used colour scheme (spec L4). Where the page gives the
   * chart a color-scheme (light dark, dark, light, only …), resolveTheme writes no scheme attribute and these
   * apply: a prefers-color-scheme change switches every var(--axylo-default-…) in the same frame as the media
   * query. light-dark() is supported by the current and previous major versions of the
   * four browsers in spec 2.3.
   */
  .axylo {
${following(LIGHT, DARK)}
  }

  /* tokens: one fixed set, where the chart resolved its scheme itself (color-scheme normal; --axylo-background) */
  .axylo[data-axylo-scheme="light"] {
${tokens(LIGHT)}
  }
  .axylo[data-axylo-scheme="dark"] {
${tokens(DARK)}
  }

  @media (forced-colors: active) {
    .axylo {
${forced}
    }
  }

  /* marks */
  .axylo .axylo-svg { position: absolute; left: 0; top: 0; display: block; pointer-events: none; overflow: hidden; }

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
    color: var(--axylo-text, currentColor);
    font-family: var(--axylo-font-family, inherit);
    font-size: var(--axylo-font-size, max(12px, 1em));
    font-weight: var(--axylo-font-weight, inherit);
    line-height: var(--axylo-line-height, inherit);
    letter-spacing: var(--axylo-letter-spacing, inherit);
    white-space: nowrap;
  }
}

/* structure: added by the figure module (inside "@layer axylo { … }") */
@layer axylo {
  .axylo .axylo-text, .axylo .axylo-tick-x-group { position: absolute; inset: 0; pointer-events: none; contain: layout style; }
  .axylo .axylo-text .axylo-label { position: absolute; left: 0; top: 0; transform-origin: 0 0; white-space: pre; text-align: right; }
  .axylo .axylo-text .axylo-label > div { display: block; }
  .axylo .axylo-label.axylo-label-start { text-align: left; }
  .axylo .axylo-label.axylo-label-middle { text-align: center; }
  .axylo [hidden] { display: none !important; }
  .axylo-visually-hidden {
    position: absolute !important; width: 1px !important; height: 1px !important; margin: -1px !important;
    padding: 0 !important; border: 0 !important; overflow: hidden !important; clip-path: inset(50%) !important;
    white-space: nowrap !important;
  }
  /* The figure fills a container that has a definite height; otherwise it is as tall as its content. */
  .axylo-figure {
    position: relative; display: flex; flex-direction: column; box-sizing: border-box;
    font-family: var(--axylo-font-family, inherit); letter-spacing: var(--axylo-letter-spacing, inherit);
    margin: 0; padding: 0; height: 100%; min-width: 0; min-height: 0;
  }
  .axylo .axylo-caption, .axylo .axylo-note, .axylo .axylo-legend-list, .axylo .axylo-table { color: var(--axylo-text, currentColor); }
  .axylo-caption { flex: none; margin: 0 0 0.5em; min-width: 0; }
  .axylo-caption:not(:has(> :not([hidden]):not(.axylo-visually-hidden))) { margin: 0; }
  .axylo-title { font-weight: 600; font-size: max(12px, 1.125em); line-height: 1.3; overflow-wrap: anywhere; }
  .axylo-subtitle { margin: 0.125em 0 0; font-size: max(12px, 0.875em); color: var(--axylo-muted, var(--axylo-default-muted)); overflow-wrap: anywhere; }
  .axylo-summary { margin: 0.25em 0 0; font-size: max(12px, 0.875em); }
  /* Shown in the too-small state (spec L8): the first sentence of the generated summary, on at most two lines,
     cut with an ellipsis beyond that; the whole text stays the figure's description. */
  .axylo-summary:not(.axylo-visually-hidden) {
    overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden;
  }
  /*
   * The plot takes what the caption and note leave. Its content is a spacer that is 16:9 of its width,
   * clamped to 160–480 px (spec L3): that is its height when the container has none of its own, and only
   * its starting size when it does (flex then grows or shrinks it to fit).
   */
  /* The plot and a legend beside it share one row, which takes what the caption and the controls leave. */
  .axylo-body, .axylo-stage, .axylo-plot { flex: auto; min-height: 0; min-width: 0; }
  .axylo-body, .axylo-stage { display: flex; }
  .axylo-stage, .axylo-plot { position: relative; }
  /* The plot's column: the plot, and the open table over it. */
  .axylo-stage { flex-direction: column; }
  .axylo-plot { overflow: hidden; }
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
  /* Measures nothing on screen: it has the labels' font, and its size changes when that font arrives. */
  .axylo .axylo-text > .axylo-font-probe { position: absolute; left: 0; top: 0; white-space: pre; visibility: hidden; pointer-events: none; }
  .axylo .axylo-text > .axylo-font-probe::before { content: "Mg 0123456789"; }
  /* Decision 0004 revision 3: a hovered tooltip is text that never takes the pointer (rule 3); a pinned one
     takes events and its rows are buttons of at least 24 px (rule 4). */
  .axylo .axylo-tooltip {
    contain: layout style;
    position: absolute; left: 0; top: 0; z-index: 3; box-sizing: border-box; pointer-events: none;
    max-width: min(320px, 100%); padding: 4px 8px; border: 1px solid var(--axylo-axis, var(--axylo-default-axis)); border-radius: 4px;
    background: var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background))); color: var(--axylo-text, currentColor);
    font-size: max(12px, 0.875em); line-height: 1.4;
    /* Never larger than the visible part of the plot (rule 6): the layer sets both maxima; content wraps. */
    overflow: hidden; overflow-wrap: anywhere;
  }
  .axylo .axylo-tooltip.axylo-tooltip-pinned { pointer-events: auto; border-width: 2px; }
  /* Readout mode (rule 5): a strip of two lines reserved under the plot, in the plot's column, as running
     text. Outside readout mode it does not exist. */
  .axylo .axylo-readout { display: none; }
  .axylo .axylo-readout-mode .axylo-readout {
    /* Two actual line heights of the strip's own font: em here is that font, whatever the page's size. */
    display: block; flex: none; box-sizing: border-box; height: calc(2 * max(24px, 1.4em));
    margin: 0; padding: 0 4px; overflow: hidden; font-size: max(12px, 0.875em); line-height: max(24px, 1.4em);
    color: var(--axylo-text, currentColor); overflow-wrap: anywhere;
  }
  .axylo .axylo-readout-mode .axylo-readout[hidden] { display: block !important; visibility: hidden; }
  /* The x on one line at most, cut with an ellipsis, so a long title never crowds out the first value. */
  .axylo .axylo-readout .axylo-tooltip-title {
    display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom;
  }
  .axylo .axylo-readout .axylo-readout-entry, .axylo .axylo-readout .axylo-tooltip-series { display: inline; }
  .axylo .axylo-readout .axylo-swatch { vertical-align: middle; margin-inline-end: 0.25em; }
  /* A pinned row or a slice-list entry can be chosen with a click or a tap (WCAG 2.5.1): real buttons, at
     least 24 × 24 px (WCAG 2.5.8), that look like the text they hold. */
  .axylo .axylo-tooltip-choice, .axylo .axylo-legend-choice {
    cursor: pointer; box-sizing: border-box; margin: 0; padding: 0; border: 0; background: none;
    font: inherit; color: inherit; text-align: inherit; align-items: center; min-height: 24px; min-width: 24px;
  }
  .axylo .axylo-tooltip-choice:hover, .axylo button.axylo-tooltip-more { text-decoration: underline; text-underline-offset: 2px; }
  .axylo .axylo-tooltip-more:not(button) { color: var(--axylo-muted, var(--axylo-default-muted)); }
  .axylo .axylo-tooltip .axylo-tooltip-choice { width: 100%; }
  .axylo .axylo-readout .axylo-tooltip-choice { display: inline-flex; vertical-align: middle; }
  .axylo .axylo-legend-choice { max-width: 100%; overflow-wrap: anywhere; display: inline-flex; gap: 0.375em; }
  .axylo .axylo-tooltip-title { font-weight: 600; }
  .axylo .axylo-tooltip-row { display: flex; gap: 1em; justify-content: space-between; }
  .axylo .axylo-tooltip-series { display: inline-flex; align-items: center; gap: 0.375em; min-width: 0; overflow-wrap: anywhere; }
  .axylo .axylo-tooltip-value { font-variant-numeric: tabular-nums; white-space: nowrap; }
  /* A value that cannot fit on one line wraps, anywhere if it must (rule 6); short ones keep number and unit together. */
  .axylo .axylo-tooltip-wrap .axylo-tooltip-value, .axylo .axylo-readout-wrap .axylo-tooltip-value { white-space: normal; overflow-wrap: anywhere; min-width: 0; }
  /* A strip row that still cannot fit is cut to one line with an ellipsis. */
  .axylo .axylo-readout-cut .axylo-readout-entry { display: inline-flex; max-width: 100%; overflow: hidden; vertical-align: bottom; }
  .axylo .axylo-readout-cut .axylo-readout-entry > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .axylo .axylo-tooltip-total {
    margin-top: 2px; padding-top: 2px; border-top: 1px solid var(--axylo-axis, var(--axylo-default-axis));
    text-align: end;
  }
  .axylo .axylo-tooltip-total, .axylo .axylo-readout-total { font-weight: 600; font-variant-numeric: tabular-nums; }
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
    opacity: 0; pointer-events: none; appearance: none; -webkit-appearance: none; background: none;
  }
  /* The plot's focus indicator (spec A2): 2 px in the focus token, at least 3:1 in both schemes. */
  .axylo .axylo-focus-ring {
    position: absolute; z-index: 2; display: none; box-sizing: border-box; pointer-events: none;
    /* Inside the plot's box: the plot clips, and a ring outside it would not be seen (review 2, finding 14). */
    outline: 2px solid var(--axylo-focus, var(--axylo-default-focus)); outline-offset: -3px;
    /* Two tones (WCAG 1.4.11): 1 px of the background colour on each side of the 2 px outline, so the focus
       colour is separated from any mark under it and needs 3:1 against the background only. */
    box-shadow: inset 0 0 0 4px var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background)));
    /* Kept in forced colours, where both tokens are system colours already (Highlight on Canvas). */
    forced-color-adjust: none;
  }
  .axylo .axylo-proxy:focus-visible + .axylo-focus-ring, .axylo .axylo-proxy.axylo-keyed:focus + .axylo-focus-ring { display: block; }
  /* The donut slice the keyboard is on, also when it has no arc. */
  .axylo .axylo-legend-list > li.axylo-legend-current { outline: 2px solid var(--axylo-focus, var(--axylo-default-focus)); outline-offset: 1px; }
  .axylo .axylo-selection {
    position: absolute; z-index: 1; box-sizing: border-box; pointer-events: none;
    border: 1px solid var(--axylo-focus, var(--axylo-default-focus));
    background: color-mix(in srgb, var(--axylo-focus, var(--axylo-default-focus)) 16%, transparent);
  }

  /* Legend, toolbar and table, under the plot. */
  .axylo .axylo-controls, .axylo .axylo-controls-top, .axylo .axylo-controls-side { flex: none; display: flex; flex-direction: column; gap: 0.5em; min-width: 0; }
  .axylo .axylo-controls { margin: 0.5em 0 0; }
  /* legend: 'top' puts the legend and its toolbar above the plot; 'right' beside it, entries stacked. */
  .axylo .axylo-controls-top { margin: 0 0 0.5em; }
  .axylo .axylo-controls-side { margin: 0; margin-inline-start: 0.75em; max-width: 40%; overflow: auto; }
  .axylo .axylo-controls-side .axylo-toolbar { flex-direction: column; align-items: stretch; flex-wrap: nowrap; }
  .axylo .axylo-controls-side .axylo-legend-list { flex-direction: column; flex-wrap: nowrap; }
  .axylo .axylo-controls-side .axylo-legend-entry + .axylo-control:not(.axylo-legend-entry) { margin-inline-start: 0; margin-block-start: 0.5em; }
  /* Tight: the Select range toggle may not cost a wrapped toolbar a row (its 26 px are won back here). */
  .axylo .axylo-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 2px; min-width: 0; }
  .axylo .axylo-control {
    display: inline-flex; align-items: center; gap: 0.375em; box-sizing: border-box; min-width: 24px; min-height: 24px;
    margin: 0; padding: 2px 5px; border: 1px solid var(--axylo-axis, var(--axylo-default-axis)); border-radius: 4px;
    background: var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background))); color: var(--axylo-text, currentColor);
    font: inherit; font-size: max(12px, 0.875em); line-height: 1.25; text-align: start; cursor: pointer;
  }
  /* Legend entries first; the other controls start on the right. */
  .axylo .axylo-legend-entry + .axylo-control:not(.axylo-legend-entry) { margin-inline-start: auto; }
  .axylo .axylo-control:focus-visible, .axylo .axylo-legend-choice:focus-visible, .axylo .axylo-tooltip-choice:focus-visible { outline: 2px solid var(--axylo-focus, var(--axylo-default-focus)); outline-offset: 1px; }
  .axylo .axylo-tooltip-choice:focus-visible, .axylo .axylo-controls-side .axylo-control:focus-visible, .axylo .axylo-controls-side .axylo-legend-choice:focus-visible { outline-offset: -2px; }
  .axylo .axylo-control[aria-disabled="true"] { cursor: default; border-style: dashed; color: var(--axylo-muted, var(--axylo-default-muted)); border-color: var(--axylo-muted, var(--axylo-default-muted)); }
  /* A symbol button (Select range): 24 × 24, so it adds no toolbar row; its name stays as hidden text. */
  .axylo .axylo-control.axylo-control-symbol { width: 24px; height: 24px; padding: 0; justify-content: center; }
  .axylo .axylo-symbol { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; }
  /* A pressed toggle (not a legend entry): a heavier border, which forced colours keep. */
  .axylo .axylo-control[aria-pressed="true"]:not(.axylo-legend-entry) { border-width: 2px; }
  /* Legend toggles read as legend entries; a hidden series keeps full-contrast text, struck through (spec L2). */
  .axylo .axylo-control-label { min-width: 0; overflow-wrap: anywhere; }
  .axylo .axylo-legend-entry { max-width: 100%; border-color: transparent; padding-inline: 4px; }
  .axylo .axylo-legend-entry:hover { border-color: var(--axylo-axis, var(--axylo-default-axis)); }
  .axylo .axylo-legend-entry.axylo-struck .axylo-control-label { text-decoration: line-through; text-decoration-thickness: 1px; }
  .axylo .axylo-legend-list {
    display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 0; padding: 0; list-style: none; font-size: max(12px, 0.875em);
  }
  .axylo .axylo-legend-list > li { display: inline-flex; align-items: center; gap: 0.375em; min-width: 0; }
  .axylo .axylo-legend-value { font-variant-numeric: tabular-nums; }
  .axylo .axylo-table { display: flex; flex-direction: column; gap: 0.5em; min-width: 0; }
  /* The open table takes the plot's place at the plot's size, so nothing else moves (spec A4; review 2, finding 15). */
  /* Keep the table and its pager reachable even when the caption leaves no plot height. */
  .axylo-figure:has(.axylo-table), .axylo .axylo-stage > .axylo-table { overflow: auto; }
  .axylo .axylo-body:has(.axylo-table) { min-height: 4.5em; }
  .axylo .axylo-stage > .axylo-table {
    position: absolute; inset: 0; z-index: 4; box-sizing: border-box;
    background: var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background)));
  }
  .axylo .axylo-stage > .axylo-table > .axylo-table-scroll { flex: auto; }
  .axylo .axylo-table-scroll { overflow: auto; box-sizing: border-box; min-height: 4.5em; border: 1px solid var(--axylo-grid, var(--axylo-default-grid)); }
  .axylo .axylo-table-scroll:focus-visible { outline: 2px solid var(--axylo-focus, var(--axylo-default-focus)); outline-offset: -2px; }
  .axylo .axylo-table table { border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%; font-size: max(12px, 0.875em); font-variant-numeric: tabular-nums; }
  .axylo .axylo-table caption { padding: 4px 8px; text-align: start; font-weight: 600; caption-side: top; }
  .axylo .axylo-table th, .axylo .axylo-table td {
    padding: 2px 8px; border-bottom: 1px solid var(--axylo-grid, var(--axylo-default-grid)); text-align: end; white-space: nowrap;
  }
  .axylo .axylo-table th[scope="row"], .axylo .axylo-table thead th:first-child { text-align: start; }
  .axylo .axylo-table thead th { position: sticky; top: 0; border-bottom-color: var(--axylo-axis, var(--axylo-default-axis)); background: var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background))); }
  .axylo .axylo-pager { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: max(12px, 0.875em); }
  .axylo .axylo-jump { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.375em; margin: 0; }
  .axylo .axylo-jump-field {
    box-sizing: border-box; min-height: 24px; width: 12em; max-width: 100%; padding: 2px 4px; font: inherit;
    border: 1px solid var(--axylo-axis, var(--axylo-default-axis)); border-radius: 2px;
    background: var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background))); color: var(--axylo-text, currentColor);
  }
  .axylo .axylo-jump-field[aria-invalid="true"] { border-width: 2px; }
  .axylo .axylo-jump-error:empty { position: absolute; }
  .axylo .axylo-jump-error { flex-basis: 100%; margin: 0; font-size: max(12px, 0.875em); }
  .axylo .axylo-jump-field:focus-visible { outline: 2px solid var(--axylo-focus, var(--axylo-default-focus)); outline-offset: 1px; }
}
`;
