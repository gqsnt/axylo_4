/**
 * Default colors (decision 0003, docs/decisions/0003-default-palette.md). Each scheme has eight series colors
 * in slot order: blue, orange, green, purple, red, cyan, magenta, slate. Slot k is the same hue family in both
 * schemes. packages/axylo/test/theme/palette.test.ts measures the decision's constraints: 3:1 on the scheme's
 * background; at least 0.10 apart in OKLab under normal vision and simulated protanopia, deuteranopia and
 * tritanopia, 0.14 among the first four; clear of the focus, reference and muted tokens; neighbours still apart
 * as 25% and 80% fills; the distances and fills also after rounding to bytes, as an 8-bit image holds them. The
 * sets were fitted by research/palette/fit.mjs (configs/fit-final.json) and are scored in
 * research/palette/palette.json. They are the decision's candidate B, which the owner chose on 2026-11-18 over
 * the previous sets for a more even light scheme, a calmer first three and a neutral eighth.
 *
 * The dark focus token is a near-white rather than a blue so that the first dark series can be an ordinary
 * dark-mode blue: with the blue focus #79a8ff kept, the bounded searches recorded in decision 0003 found no dark
 * set whose first blue was lighter than OKLab L 0.55 (a search limit, not a proof). Under the two-tone focus ring,
 * the focus color must reach 3:1 against the background and the background-colored surround carries the contrast
 * against marks (decision 0003, "Focus token under a two-tone ring").
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
  series: ['#2b97ee', '#cf8020', '#0b6c49', '#812cc4', '#be1506', '#0380a8', '#8c1382', '#8e948f'],
};

export const DARK: SchemeColors = {
  background: '#16181d',
  axis: '#8b909c',
  grid: '#30343c',
  muted: '#9da2ad',
  reference: '#bcc0c9',
  focus: '#e3e8f0',
  series: ['#5d9afd', '#dc772f', '#ade4ba', '#9443a9', '#ba4f1f', '#38c7fe', '#d991b8', '#6d736e'],
};

export const SERIES_COUNT = 8;
