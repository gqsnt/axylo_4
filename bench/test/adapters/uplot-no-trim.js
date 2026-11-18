// Deliberately wrong: a streaming uPlot that appends but never drops the oldest point, so its window grows past 600
// (cheaper per update than a correct window would be on some libraries). The admission check must reject it.
// Used by test/admission.test.mjs only.
import base, { createUplot } from '../../src/adapters/uplot.js';

export default {
  ...base,
  id: 'uplot-no-trim',
  config: 'BROKEN: streaming window never trimmed',
  create: (el, fix, opts) => createUplot(el, fix, opts, { noTrim: true }),
};
