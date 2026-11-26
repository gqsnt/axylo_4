/**
 * `axylo/stream`: the chart functions with streaming storage, for pages that append rows. They are the root
 * entry's functions (streaming compositions, `createChart`), named so a page can state that it streams.
 * Importing this module touches no DOM.
 */
export { area, bar, donut, histogram, line, scatter, validate } from './index.js';

export type * from './public.js';
