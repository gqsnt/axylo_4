/**
 * Default colors. The series sets are the provisional "usable-light-8" and "usable-dark-8" results of the
 * palette search (research/palette/feasibility.json); a later milestone tunes them. Token colors meet spec
 * L2 on their scheme's background: axis and focus at least 3:1, muted and reference at least 4.5:1 because
 * they are also used for text (hidden legend entries, reference labels). Grid is exempt.
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
  series: ['#7d2960', '#9584f2', '#620ab4', '#ca7b9b', '#f3471b', '#9b578a', '#b12508', '#6a41f6'],
};

export const DARK: SchemeColors = {
  background: '#16181d',
  axis: '#8b909c',
  grid: '#30343c',
  muted: '#9da2ad',
  reference: '#bcc0c9',
  focus: '#79a8ff',
  series: ['#674cf5', '#5af0e9', '#b2ac04', '#837b16', '#b73795', '#c4e61a', '#f166a0', '#06a6fa'],
};

export const SERIES_COUNT = 8;
