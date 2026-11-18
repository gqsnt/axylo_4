/**
 * Default colors (decision 0003, docs/decisions/0003-default-palette.md). Each scheme has eight series colors
 * in slot order: blue, orange, green, purple, red, cyan, magenta, slate. Slot k is the same hue family in both
 * schemes. packages/axylo/test/theme/palette.test.ts measures the decision's constraints: 3:1 on the scheme's
 * background; at least 0.10 apart in OKLab under normal vision and simulated protanopia, deuteranopia and
 * tritanopia, 0.14 among the first four; clear of the focus, reference and muted tokens; neighbours still apart
 * as 25% and 80% fills; the distances and fills also after rounding to bytes, as an 8-bit image holds them. The
 * sets were fitted by research/palette/fit.mjs (configs/fit-final.json) and are scored in
 * research/palette/palette.json.
 *
 * The dark focus token is a near-white rather than a blue so that the first dark series can be an ordinary
 * dark-mode blue: a blue focus at that lightness left no room for one (decision 0003).
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
  series: ['#4a94eb', '#e97200', '#136102', '#7314a2', '#bd585e', '#007baa', '#a52265', '#9293a5'],
};

export const DARK: SchemeColors = {
  background: '#16181d',
  axis: '#8b909c',
  grid: '#30343c',
  muted: '#9da2ad',
  reference: '#bcc0c9',
  focus: '#e3e8f0',
  series: ['#64acfa', '#de7b2e', '#b2e390', '#9149b9', '#c3513d', '#71d8ff', '#f898b5', '#7a7f93'],
};

export const SERIES_COUNT = 8;
