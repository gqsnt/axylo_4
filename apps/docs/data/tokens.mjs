// The CSS custom properties Axylo reads, for the theming page. `default` names the private property in the
// library's stylesheet that supplies the value when the public one is unset; the build reads both schemes'
// values from packages/axylo/dist/axylo.css. `unset` describes a property that has no colour default.
// apps/docs/test/theming.test.ts fails when this list and packages/axylo/src/theme/css.ts disagree.

const series = Array.from({ length: 8 }, (_, i) => ({
  name: `--axylo-series-${i + 1}`,
  default: `--axylo-default-series-${i + 1}`,
  affects: `The colour of the ${['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'][i]} series or slice: its marks, legend entry and tooltip swatch.`,
}));

export const tokens = [
  ...series,
  {
    name: '--axylo-background', default: '--axylo-default-background',
    affects: 'When set, painted behind the plot and used by the tooltip, the controls and the open table; it also decides light or dark for the chart, and is what the palette is checked against (AX141). Unset, the chart paints no background of its own: those use the colour found behind the chart, and the default shown here only when none can be found.',
  },
  {
    name: '--axylo-text', unset: 'Not set: the chart uses the inherited `color`.',
    affects: 'Text drawn over the plot (tick labels, axis titles, reference labels), the tooltip and the controls. The title, the legend list and the table inherit the page\'s `color` directly.',
  },
  { name: '--axylo-axis', default: '--axylo-default-axis', affects: 'Axis lines and tick marks; the borders of the tooltip, the controls and the Jump to field.' },
  { name: '--axylo-grid', default: '--axylo-default-grid', affects: 'Gridlines and the rules of the data table.' },
  { name: '--axylo-muted', default: '--axylo-default-muted', affects: 'The subtitle, the loading, empty and error messages, the "no data" mark of a missing bar, and the donut\'s "Other" slice.' },
  { name: '--axylo-reference', default: '--axylo-default-reference', affects: 'Reference lines and bands.' },
  { name: '--axylo-focus', default: '--axylo-default-focus', affects: 'Every focus indicator (plot, controls, table) and the drag-to-zoom selection.' },
  { name: '--axylo-font-family', unset: 'Not set: inherited from the page.', affects: 'The font of text drawn over the plot (tick labels, axis titles, reference labels); layout measures in it. The rest of the chart inherits the page font directly.' },
  { name: '--axylo-font-size', unset: 'Not set: `max(12px, 1em)`.', affects: 'The size of text drawn over the plot.' },
  { name: '--axylo-font-weight', unset: 'Not set: inherited from the page.', affects: 'The weight of text drawn over the plot.' },
  { name: '--axylo-line-height', unset: 'Not set: inherited from the page.', affects: 'The line height of wrapped tick labels.' },
  { name: '--axylo-letter-spacing', unset: 'Not set: inherited from the page.', affects: 'Letter spacing of text drawn over the plot; user text-spacing overrides apply as well.' },
];

// Names in the stylesheet that are not for authors. Listed so the theming test can tell them from an
// undocumented public property; setting them is unsupported and may break in any release.
export const internalTokens = [
  { name: '--axylo-stylesheet', why: 'Marks that the default stylesheet is present, so the chart does not apply it twice.' },
  { name: '--axylo-backdrop', why: 'Written by the chart on its own element: the opaque colour found behind it, used where `--axylo-background` is unset.' },
  { name: '--axylo-forced-series', why: 'Set only in forced-colours mode, where it replaces colours pinned with the `colors` option by a system colour.' },
  { name: '--axylo-dash-contrast', why: 'Written on dashed marks: the dash pattern used under `prefers-contrast: more` and forced colours.' },
  { name: '--axylo-swatch-dash', why: 'Written on legend and tooltip swatches: the dash pattern the series uses.' },
  { name: '--axylo-swatch-dash-contrast', why: 'The same, under `prefers-contrast: more` and forced colours.' },
];
