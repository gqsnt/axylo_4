// Deliberately wrong: uPlot with its y range pinned far away from the data. It draws without error, and a timing of
// it would look plausible; the admission check must reject it. Used by test/admission.test.mjs only.
import base, { createUplot } from '../../src/adapters/uplot.js';

export default {
  ...base,
  id: 'uplot-pinned-y',
  config: 'BROKEN: y range pinned to [1e6, 2e6]',
  create: (el, fix, opts) => createUplot(el, fix, opts, { options: o => { o.scales = { y: { range: [1e6, 2e6] } }; } }),
};
