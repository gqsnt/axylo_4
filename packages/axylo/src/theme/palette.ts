/**
 * Default colors (decision 0003, docs/decisions/0003-default-palette.md). Each scheme has eight series colors
 * in slot order: blue, orange, green, purple, red, cyan, magenta, slate. Slot k is the same hue family in both
 * schemes. packages/axylo/test/theme/palette.test.ts measures the decision's constraints: 3:1 on the scheme's
 * background; at least 0.10 apart in OKLab under normal vision and simulated protanopia, deuteranopia and
 * tritanopia, 0.14 among the first four; clear of the focus, reference and muted tokens; neighbours still apart
 * as 25% and 80% fills. The sets were fitted by research/palette/fit.mjs and are scored in
 * research/palette/palette.json.
 *
 * Token colors meet spec L2 on their scheme's background: axis and focus at least 3:1, muted and reference at
 * least 4.5:1 because they are also used for text (hidden legend entries, reference labels). Grid is exempt.
 *
 * Text has no default: the chart inherits the page's `color` (spec DX6).
 */
export interface SchemeColors {
  readonly background: string;
  readonly axis: string;
  readonly grid: string;
  readonly muted: string;
  readonly reference: string;
  readonly focus: string;
  readonly series: readonly string[];
}

export const LIGHT: SchemeColors = {
  background: '#ffffff',
  axis: '#5f6470',
  grid: '#e2e4e9',
  muted: '#62666f',
  reference: '#474b55',
  focus: '#1f5fcc',
  series: ['#4395ea', '#e77412', '#085e01', '#5f2083', '#ba5f50', '#087ca6', '#a12c63', '#8f9299'],
};

export const DARK: SchemeColors = {
  background: '#16181d',
  axis: '#8b909c',
  grid: '#30343c',
  muted: '#9da2ad',
  reference: '#bcc0c9',
  focus: '#79a8ff',
  series: ['#1c73c5', '#d77939', '#b0e391', '#bf93f1', '#bc5145', '#71daff', '#fa93b5', '#82828f'],
};

export const SERIES_COUNT = 8;
